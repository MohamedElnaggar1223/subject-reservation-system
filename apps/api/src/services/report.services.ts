/**
 * Report Generation Service
 *
 * Implements all REP-001 to REP-009 reporting requirements:
 *
 * - REP-001: Registration report (per session, with approval trail)
 * - REP-002: Financial summary (school vs. non-school revenue breakdown)
 * - REP-003: Escrow report (balances, pending withdrawals)
 * - REP-004: Subject enrollment report (students per subject, school vs. non-school)
 * - REP-005: Grade 10 compliance report (core subject check with approval status)
 * - REP-006: Audit trail (handled by audit.services.ts — see audit routes)
 * - REP-007: Student roster (by grade with contacts and linked parents)
 * - REP-008: Admin dashboard metrics (key counts including pending approvals)
 * - REP-009: Pending approvals report (all pending requests with age in days)
 *
 * All functions are read-only queries — no mutations.
 * Data is returned as plain objects, not DB row types, for easy JSON serialisation.
 *
 * CSV export: see report.routes.ts which converts these results to CSV strings.
 */

import {
  db,
  gradeTodaySql,
  gradeInYearSql,
  gradeTodayExtras,
  registration,
  registrationSession,
  subject,
  user,
  escrow,
  escrowTransaction,
  withdrawalRequest,
  payment,
  changeRequest,
  parentStudentLink,
  notification,
  auditLog,
  eq,
  and,
  inArray,
  isNull,
  isNotNull,
  sql,
  count,
} from '@repo/db';
import { academicYearLabel, academicYearStartOf, gradeLabel, gradeInAcademicYear, seriesAcademicYearStart } from '@repo/validations';

/**
 * Today's grade as a report cell (F0a): the number for grades 10–12,
 * 'graduated' past 12, 'upcoming' below 10, 'unknown' without a cohort,
 * for a raw-SQL alias of the user table.
 */
const gradeTodayLabelSql = (alias: string) => sql.raw(
  `(CASE WHEN ${alias}.cohort_year IS NULL THEN 'unknown'` +
  ` WHEN school_grade(${alias}.cohort_year, school_academic_year_start(now())) > 12 THEN 'graduated'` +
  ` WHEN school_grade(${alias}.cohort_year, school_academic_year_start(now())) < 10 THEN 'upcoming'` +
  ` ELSE school_grade(${alias}.cohort_year, school_academic_year_start(now()))::text END)`
);


// ─── Pagination Helper ──────────────────────────────────────────────────────

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

/**
 * In-memory pagination fallback.
 *
 * Prefer SQL-level LIMIT/OFFSET (used by REP-001 and REP-007) whenever
 * the underlying query can be paginated cleanly. This helper exists for
 * reports that combine data from multiple queries in JS (e.g. aggregations
 * over parent links where SQL pagination would drop rows mid-join).
 */
function paginate<T>(items: T[], params?: PaginationParams): { data: T[]; total: number } {
  const total = items.length;
  const offset = params?.offset ?? 0;
  const limit = params?.limit ?? 500;
  return { data: items.slice(offset, offset + limit), total };
}

function rowsOf<T extends Record<string, unknown>>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

function numberValue(value: unknown): number {
  return Number(value ?? 0);
}

// ─── REP-008: Admin Dashboard Metrics ────────────────────────────────────────

/**
 * Returns the key metrics shown on the admin dashboard (REP-008).
 *
 * Includes:
 * - Student counts by grade (10, 11, 12, graduated)
 * - Parent count
 * - Active session count
 * - Pending registration requests (status = 'pending_approval')
 * - Pending payment registrations (status = 'pending_payment')
 * - Pending change requests (status = 'pending_approval')
 * - Pending bank transfers (payment.status = 'pending', method = 'bank_transfer')
 * - Confirmed registrations this month
 * - Total escrow liability (sum of all positive balances)
 */
export async function getAdminDashboardMetrics() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // URD REP-008 specifies metrics for the CURRENT session. Since multiple
  // sessions can be active simultaneously (SES-001 — one per sessionType),
  // we first resolve the set of active session IDs, then aggregate
  // registrations + revenue scoped to them.
  const activeSessionRows = await db
    .select({ id: registrationSession.id, name: registrationSession.name, sessionType: registrationSession.sessionType })
    .from(registrationSession)
    .where(eq(registrationSession.status, 'active'));
  const activeSessionIds = activeSessionRows.map((s) => s.id);

  const [
    studentsByGrade,
    parentCount,
    pendingApprovalRegs,
    pendingPaymentRegs,
    pendingChangeRequests,
    pendingBankTransfers,
    confirmedThisMonth,
    escrowLiability,
    pendingWithdrawalsCount,
    pendingWithdrawalsAmount,
    currentSessionRegistrationsRow,
    currentSessionRevenueRow,
  ] = await Promise.all([
    // Student counts by today's grade (F0a: from the cohort); -1 marks a
    // student who left the school.
    db
      .select({
        grade: sql<number | null>`CASE WHEN ${user.leftOn} IS NOT NULL THEN -1 ELSE ${gradeTodaySql(user.cohortYear)} END`,
        count: count(),
      })
      .from(user)
      .where(eq(user.role, 'student'))
      .groupBy(sql`1`),

    // Parent count
    db
      .select({ count: count() })
      .from(user)
      .where(eq(user.role, 'parent')),

    // Pending approval registrations
    db
      .select({ count: count() })
      .from(registration)
      .where(eq(registration.status, 'pending_approval')),

    // Pending payment registrations
    db
      .select({ count: count() })
      .from(registration)
      .where(eq(registration.status, 'pending_payment')),

    // Pending change requests
    db
      .select({ count: count() })
      .from(changeRequest)
      .where(eq(changeRequest.status, 'pending_approval')),

    // Pending bank transfers
    db
      .select({ count: count() })
      .from(payment)
      .where(
        and(
          eq(payment.status, 'pending'),
          eq(payment.paymentMethod, 'bank_transfer')
        )
      ),

    // Confirmed registrations this month
    db
      .select({ count: count() })
      .from(registration)
      .where(
        and(
          eq(registration.status, 'confirmed'),
          sql`${registration.createdAt} >= ${monthStart}`
        )
      ),

    // Total escrow liability (sum of all positive escrow balances)
    db
      .select({ total: sql<number>`COALESCE(SUM(${escrow.balance}), 0)` })
      .from(escrow)
      .where(sql`${escrow.balance} > 0`),

    // Pending withdrawal request count — includes partially_fulfilled (H-14):
    // these still tie up liability and admin attention until either fully
    // released or rejected.
    db
      .select({ count: count() })
      .from(withdrawalRequest)
      .where(inArray(withdrawalRequest.status, ['pending', 'partially_fulfilled'])),

    // Pending withdrawal total amount — same inclusion rule as count above.
    // Uses (requestedAmount - COALESCE(releasedAmount, 0)) so partially
    // fulfilled requests only contribute the outstanding portion.
    db
      .select({
        total: sql<number>`COALESCE(SUM(${withdrawalRequest.requestedAmount} - COALESCE(${withdrawalRequest.releasedAmount}, 0)), 0)`,
      })
      .from(withdrawalRequest)
      .where(inArray(withdrawalRequest.status, ['pending', 'partially_fulfilled'])),

    // Current session registrations — non-terminal rows in any active session
    activeSessionIds.length > 0
      ? db
          .select({ count: count() })
          .from(registration)
          .where(
            and(
              inArray(registration.sessionId, activeSessionIds),
              sql`${registration.status} NOT IN ('dropped', 'rejected', 'expired')`
            )
          )
      : Promise.resolve([{ count: 0 }]),

    // Current session revenue — sum of completed payments' (amount +
    // escrowAmountApplied) where the payment is linked to a registration
    // in an active session. `SELECT DISTINCT payment.id` avoids
    // double-counting multi-registration payments.
    activeSessionIds.length > 0
      ? db.execute(sql`
          SELECT COALESCE(SUM(p.amount + p.escrow_amount_applied), 0) AS total
          FROM (
            SELECT DISTINCT pay.id, pay.amount, pay.escrow_amount_applied
            FROM ${payment} pay
            JOIN payment_registration pr ON pr.payment_id = pay.id
            JOIN ${registration} r ON r.id = pr.registration_id
            WHERE pay.status = 'completed'
              AND r.session_id IN (${sql.join(activeSessionIds.map((id) => sql`${id}`), sql`, `)})
          ) p
        `)
      : Promise.resolve({ rows: [{ total: 0 }] }),
  ]);

  // Map grade counts
  const gradeMap: Record<string, number> = { grade10: 0, grade11: 0, grade12: 0, graduated: 0, left: 0, unknown: 0, upcoming: 0 };
  for (const row of studentsByGrade) {
    const n = Number(row.count);
    const g = row.grade === null ? null : Number(row.grade);
    if (g === -1)           gradeMap.left!     += n;
    else if (g === null)    gradeMap.unknown!  += n;
    else if (g === 10)      gradeMap.grade10!  += n;
    else if (g === 11)      gradeMap.grade11!  += n;
    else if (g === 12)      gradeMap.grade12!  += n;
    else if (g > 12)        gradeMap.graduated! += n;
    else                    gradeMap.upcoming! += n;
  }

  const revenueRows = (currentSessionRevenueRow as { rows?: { total: number | string }[] }).rows ?? [];
  const currentSessionRevenueEGP = Number(revenueRows[0]?.total ?? 0);
  const currentSessionRegistrations = Number(
    (currentSessionRegistrationsRow as { count: number }[])[0]?.count ?? 0
  );

  // Active students = not graduated. Total "students" including graduated
  // is kept separately so both views are available on the dashboard.
  const activeStudents =
    (gradeMap.grade10 ?? 0) + (gradeMap.grade11 ?? 0) + (gradeMap.grade12 ?? 0);

  return {
    students: {
      grade10:   gradeMap.grade10,
      grade11:   gradeMap.grade11,
      grade12:   gradeMap.grade12,
      graduated: gradeMap.graduated,
      left:      gradeMap.left,
      unknown:   gradeMap.unknown,
      upcoming:  gradeMap.upcoming,
      active:    activeStudents,
      total:     Object.values(gradeMap).reduce((a, b) => a + b, 0),
    },
    parents:             Number(parentCount[0]?.count ?? 0),
    activeSessions:      activeSessionRows.length,
    activeSessionList:   activeSessionRows,
    pendingApprovals:    Number(pendingApprovalRegs[0]?.count ?? 0),
    pendingPayments:     Number(pendingPaymentRegs[0]?.count ?? 0),
    pendingChangeReqs:   Number(pendingChangeRequests[0]?.count ?? 0),
    pendingBankTransfers:Number(pendingBankTransfers[0]?.count ?? 0),
    pendingWithdrawals:  Number(pendingWithdrawalsCount[0]?.count ?? 0),
    pendingWithdrawalsAmountEGP: Number(pendingWithdrawalsAmount[0]?.total ?? 0),
    // URD REP-008 core metrics: registrations and revenue scoped to currently
    // active sessions. Old `confirmedThisMonth` kept for operational continuity.
    currentSessionRegistrations,
    currentSessionRevenueEGP,
    confirmedThisMonth:  Number(confirmedThisMonth[0]?.count ?? 0),
    escrowLiabilityEGP:  Number(escrowLiability[0]?.total ?? 0),
    generatedAt:         now,
  };
}

// ─── REP-001: Registration Report ────────────────────────────────────────────

/**
 * Generates a per-session registration report (REP-001).
 *
 * Returns one row per registration with:
 * - Student name, grade, student ID
 * - Subject name and code
 * - Registration status, price, payment method
 * - Approval trail: approvedBy name (if available)
 * - Registered at timestamp
 *
 * Optional filters: grade, status.
 */
export async function generateRegistrationReport(
  sessionId: string,
  filters?: { grade?: number; status?: string; council?: string },
  pagination?: PaginationParams
) {
  // M-15: Push filters AND pagination into SQL so this scales beyond what
  // a JS `Array.slice` after `findMany` can handle. Grade and council
  // filters previously ran in JS after loading every row; they now live
  // in the WHERE clause alongside status + sessionId.
  const limit = Math.min(pagination?.limit ?? 500, 5000);
  const offset = pagination?.offset ?? 0;

  // The grade in a session report is the grade in the series' academic
  // year (F0a), never today's.
  const [sessionRow] = await db
    .select({ sessionType: registrationSession.sessionType, seriesYear: registrationSession.seriesYear })
    .from(registrationSession)
    .where(eq(registrationSession.id, sessionId));
  const seriesYearStart = sessionRow ? seriesAcademicYearStart(sessionRow.sessionType, sessionRow.seriesYear) : 0;
  const gradeFilter = filters?.grade !== undefined
    ? [sql`${gradeInYearSql(user.cohortYear, seriesYearStart)} = ${filters.grade}`]
    : [];

  // 1) Count query — same filters, no joins, used for pagination totals
  const totalRow = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(registration)
    .innerJoin(user, eq(user.id, registration.studentId))
    .innerJoin(subject, eq(subject.id, registration.subjectId))
    .where(
      and(
        eq(registration.sessionId, sessionId),
        ...(filters?.status ? [eq(registration.status, filters.status)] : []),
        ...gradeFilter,
        ...(filters?.council ? [eq(subject.council, filters.council)] : []),
      ),
    );
  const total = Number(totalRow[0]?.count ?? 0);

  // 2) Page query — same filters, full joins, SQL LIMIT/OFFSET
  const studentIdsSub = db
    .select({ id: registration.id })
    .from(registration)
    .innerJoin(user, eq(user.id, registration.studentId))
    .innerJoin(subject, eq(subject.id, registration.subjectId))
    .where(
      and(
        eq(registration.sessionId, sessionId),
        ...(filters?.status ? [eq(registration.status, filters.status)] : []),
        ...gradeFilter,
        ...(filters?.council ? [eq(subject.council, filters.council)] : []),
      ),
    )
    .orderBy(registration.createdAt)
    .limit(limit)
    .offset(offset);

  const pageIds = (await studentIdsSub).map((r) => r.id);
  if (pageIds.length === 0) {
    return { data: [], total };
  }

  const rows = await db.query.registration.findMany({
    where: (r, { inArray: inArr }) => inArr(r.id, pageIds),
    with: {
      student: { columns: { id: true, name: true, cohortYear: true, studentId: true, email: true } },
      subject: { columns: { id: true, name: true, code: true, council: true, isOfferedAtSchool: true } },
      requestedByUser: { columns: { id: true, name: true, role: true } },
      approvedByUser: { columns: { id: true, name: true, role: true } },
      paymentRegistrations: {
        with: {
          payment: { columns: { paymentMethod: true, confirmedAt: true, status: true } },
        },
      },
    },
    orderBy: (r, { asc }) => [asc(r.createdAt)],
  });

  const mapped = rows.map((r) => {
    // Find the first completed payment for confirmation info
    const completedPayment = (r.paymentRegistrations ?? [])
      .map((pr) => pr.payment)
      .find((p) => p && p.status === 'completed');

    return {
      studentName:       r.student.name,
      studentGrade:      gradeLabel(gradeInAcademicYear(r.student.cohortYear, seriesYearStart)),
      studentId:         r.student.studentId ?? '—',
      studentEmail:      r.student.email,
      subjectName:       r.subject.name,
      subjectCode:       r.subject.code,
      council:           r.subject.council,
      offeredAtSchool:   r.subject.isOfferedAtSchool ? 'Yes' : 'No',
      status:            r.status,
      priceEGP:          Number(r.priceAtRegistration),
      // Approval trail: Requested by -> Approved by -> Confirmed via payment
      requestedBy:       r.requestedByUser?.name ?? '—',
      requestedByRole:   r.requestedByUser?.role ?? '—',
      approvedBy:        r.approvedByUser?.name ?? '—',
      approvedAt:        r.approvedAt?.toISOString() ?? '—',
      approvalComments:  r.approvalComments ?? '—',
      confirmedVia:      completedPayment?.paymentMethod ?? '—',
      confirmedAt:       completedPayment?.confirmedAt?.toISOString() ?? '—',
      registeredAt:      r.createdAt.toISOString(),
    };
  });

  // Pagination and filters are applied at SQL level above; `total` is the
  // filtered total, and `mapped` is already the page slice.
  return { data: mapped, total };
}

// ─── REP-002: Financial Summary ───────────────────────────────────────────────

/**
 * Financial summary for a session (REP-002).
 *
 * Breaks down confirmed revenue by:
 * - School subjects vs. non-school subjects
 * - Payment method (fawry, card, mobile_wallet, bank_transfer, escrow)
 *
 * Also shows pending revenue (pending_payment registrations).
 */
export async function generateFinancialSummary(
  sessionId: string,
  filters?: { council?: string }
) {
  const rows = await db.query.registration.findMany({
    where: (r, { eq, and, inArray }) =>
      and(
        eq(r.sessionId, sessionId),
        inArray(r.status, ['confirmed', 'pending_payment'])
      ),
    with: {
      subject: { columns: { isOfferedAtSchool: true, council: true } },
      paymentRegistrations: {
        with: {
          payment: { columns: { id: true, paymentMethod: true, status: true, amount: true, escrowAmountApplied: true } },
        },
      },
    },
  });

  let confirmedSchool = 0;
  let confirmedNonSchool = 0;
  let pendingRevenue = 0;
  const byMethod: Record<string, number> = {};
  const byCouncil: Record<string, number> = {};

  // Track which payments we have already counted for the method breakdown
  // to avoid double-counting when a payment covers multiple registrations.
  const countedPaymentIds = new Set<string>();

  for (const reg of rows) {
    const price = Number(reg.priceAtRegistration);
    const isSchool = reg.subject?.isOfferedAtSchool ?? true;
    const council = reg.subject?.council ?? 'unknown';

    // Apply optional council filter
    if (filters?.council && council !== filters.council) continue;

    if (reg.status === 'confirmed') {
      // School vs non-school breakdown uses registration price (one entry per reg)
      if (isSchool) confirmedSchool += price;
      else confirmedNonSchool += price;

      // Council breakdown
      byCouncil[council] = (byCouncil[council] ?? 0) + price;

      // Payment-method breakdown: iterate over unique payments only.
      // Each payment's (amount + escrowAmountApplied) is counted once.
      for (const pr of reg.paymentRegistrations ?? []) {
        const pay = pr.payment;
        if (!pay || countedPaymentIds.has(pay.id)) continue;
        countedPaymentIds.add(pay.id);

        const paymentTotal = Number(pay.amount) + Number(pay.escrowAmountApplied);
        const method = pay.paymentMethod ?? 'unknown';
        byMethod[method] = (byMethod[method] ?? 0) + paymentTotal;
      }
    } else {
      pendingRevenue += price;
    }
  }

  return {
    confirmedRevenueSchoolEGP:    confirmedSchool,
    confirmedRevenueNonSchoolEGP: confirmedNonSchool,
    confirmedRevenueTotalEGP:     confirmedSchool + confirmedNonSchool,
    pendingRevenueEGP:            pendingRevenue,
    revenueByPaymentMethod:       byMethod,
    revenueByCouncil:             byCouncil,
    generatedAt:                  new Date(),
  };
}

// ─── REP-003: Escrow Report ───────────────────────────────────────────────────

/**
 * Escrow report — current balances and pending withdrawals (REP-003).
 * Returns one row per escrow account with linked student + parent info.
 */
export async function generateEscrowReport(pagination?: PaginationParams) {
  const accounts = await db.query.escrow.findMany({
    with: {
      student: {
        columns: { id: true, name: true, cohortYear: true, studentId: true, email: true },
        extras: gradeTodayExtras,
      },
    },
    orderBy: (e, { desc: d }) => [d(e.balance)],
  });

  // Pending withdrawals per student
  const pendingWithdrawals = await db.query.withdrawalRequest.findMany({
    where: (wr, { eq }) => eq(wr.status, 'pending'),
    columns: { requestedAmount: true },
    with: { escrow: { columns: { studentId: true } } },
  });
  const pendingByStudent: Record<string, number> = {};
  for (const pw of pendingWithdrawals) {
    const sid = pw.escrow.studentId;
    pendingByStudent[sid] = (pendingByStudent[sid] ?? 0) + Number(pw.requestedAmount);
  }

  const links = await db.query.parentStudentLink.findMany({
    where: (l, { eq }) => eq(l.status, 'approved'),
    with: {
      parent: { columns: { id: true, name: true, email: true } },
    },
    columns: { studentId: true },
  });
  const parentsByStudent: Record<string, { id: string; name: string; email: string }[]> = {};
  for (const link of links) {
    if (!parentsByStudent[link.studentId]) parentsByStudent[link.studentId] = [];
    if (link.parent) parentsByStudent[link.studentId]!.push(link.parent);
  }

  const mapped = accounts.map((acc) => ({
    studentName:          acc.student?.name ?? '—',
    studentGrade:         gradeLabel(acc.student?.grade),
    studentIdCode:        acc.student?.studentId ?? '—',
    studentEmail:         acc.student?.email ?? '—',
    balanceEGP:           Number(acc.balance),
    pendingWithdrawalEGP: pendingByStudent[acc.studentId] ?? 0,
    availableEGP:         Number(acc.balance) - (pendingByStudent[acc.studentId] ?? 0),
    linkedParents:        (parentsByStudent[acc.studentId] ?? []).map((p) => p.name).join(', '),
  }));

  return paginate(mapped, pagination);
}

// ─── REP-004: Subject Enrollment Report ──────────────────────────────────────

/**
 * Subject enrollment counts for a session (REP-004).
 * Groups by subject, shows school vs. non-school and enrollment counts.
 */
export async function generateSubjectEnrollmentReport(sessionId: string, pagination?: PaginationParams) {
  const rows = await db.query.registration.findMany({
    where: (r, { eq, and, inArray }) =>
      and(
        eq(r.sessionId, sessionId),
        inArray(r.status, ['confirmed', 'pending_payment', 'pending_approval'])
      ),
    with: {
      subject: { columns: { id: true, name: true, code: true, council: true, isOfferedAtSchool: true, isCore: true } },
    },
  });

  const subjectMap: Record<string, {
    subjectName:     string;
    subjectCode:     string;
    council:         string;
    offeredAtSchool: boolean;
    isCore:          boolean;
    confirmed:       number;
    pendingPayment:  number;
    pendingApproval: number;
    totalRevenue:    number;
  }> = {};

  for (const reg of rows) {
    const sub = reg.subject;
    if (!sub) continue;
    if (!subjectMap[sub.id]) {
      subjectMap[sub.id] = {
        subjectName:     sub.name,
        subjectCode:     sub.code,
        council:         sub.council,
        offeredAtSchool: sub.isOfferedAtSchool,
        isCore:          sub.isCore,
        confirmed:       0,
        pendingPayment:  0,
        pendingApproval: 0,
        totalRevenue:    0,
      };
    }
    const entry = subjectMap[sub.id]!;
    if (reg.status === 'confirmed') {
      entry.confirmed++;
      entry.totalRevenue += Number(reg.priceAtRegistration);
    } else if (reg.status === 'pending_payment') {
      entry.pendingPayment++;
    } else {
      entry.pendingApproval++;
    }
  }

  const sorted = Object.values(subjectMap).sort((a, b) => b.confirmed - a.confirmed);
  return paginate(sorted, pagination);
}

// ─── REP-005: Grade 10 Compliance Report ─────────────────────────────────────

/**
 * Grade 10 core subject compliance (REP-005).
 * Shows each Grade 10 student and which core subjects they have registered for,
 * plus the approval status of each.
 */
export async function generateGrade10ComplianceReport(sessionId: string) {
  // Get all core subjects
  const coreSubjects = await db.query.subject.findMany({
    where: (s, { eq, and }) => and(eq(s.isCore, true), eq(s.isActive, true)),
    columns: { id: true, name: true, code: true },
  });

  // Every student in grade 10 in the series' academic year (F0a), still at
  // the school.
  const [sessionRow] = await db
    .select({ sessionType: registrationSession.sessionType, seriesYear: registrationSession.seriesYear })
    .from(registrationSession)
    .where(eq(registrationSession.id, sessionId));
  if (!sessionRow) return { students: [], coreSubjects: coreSubjects.map((s) => s.name) };
  const seriesYearStart = seriesAcademicYearStart(sessionRow.sessionType, sessionRow.seriesYear);
  const grade10Students = await db.query.user.findMany({
    where: and(
      eq(user.role, 'student'),
      isNull(user.leftOn),
      sql`${gradeInYearSql(user.cohortYear, seriesYearStart)} = 10`,
    ),
    columns: { id: true, name: true, studentId: true, email: true },
  });

  if (grade10Students.length === 0 || coreSubjects.length === 0) {
    return { students: [], coreSubjects: coreSubjects.map((s) => s.name) };
  }

  // Get all registrations for these students in this session
  const studentIds = grade10Students.map((s) => s.id);
  const coreIds    = coreSubjects.map((s) => s.id);

  const regs = await db.query.registration.findMany({
    where: (r, { eq, and, inArray }) =>
      and(
        eq(r.sessionId, sessionId),
        inArray(r.studentId, studentIds),
        inArray(r.subjectId, coreIds)
      ),
    columns: { studentId: true, subjectId: true, status: true },
  });

  // Build a lookup: studentId → subjectId → status
  const regMap: Record<string, Record<string, string>> = {};
  for (const reg of regs) {
    if (!regMap[reg.studentId]) regMap[reg.studentId] = {};
    regMap[reg.studentId]![reg.subjectId] = reg.status;
  }

  const students = grade10Students.map((stu) => {
    const subjectStatuses = coreSubjects.map((core) => ({
      subjectName: core.name,
      status:      regMap[stu.id]?.[core.id] ?? 'not_registered',
    }));
    const isCompliant = subjectStatuses.every(
      (s) => s.status === 'confirmed' || s.status === 'pending_payment' || s.status === 'pending_approval'
    );
    return {
      studentName:    stu.name,
      studentIdCode:  stu.studentId ?? '—',
      studentEmail:   stu.email,
      isCompliant,
      subjects:       subjectStatuses,
    };
  });

  return {
    students,
    coreSubjects: coreSubjects.map((s) => s.name),
  };
}

// ─── REP-007: Student Roster ──────────────────────────────────────────────────

/**
 * Student roster report (REP-007).
 * Optional grade filter. Returns name, contact, linked parent info.
 */
export async function generateStudentRoster(grade?: number | null, pagination?: PaginationParams) {
  // M-15: Paginate at SQL level. Only after the page slice do we load
  // parent links for those students (avoids fetching links for every
  // student in the database when only one page is rendered).
  const limit = Math.min(pagination?.limit ?? 500, 5000);
  const offset = pagination?.offset ?? 0;

  // Today's grade (F0a); null asks for graduates (past grade 12).
  const gradeCondition = (u: typeof user) => {
    if (grade === null) return and(eq(u.role, 'student'), sql`${gradeTodaySql(u.cohortYear)} > 12`);
    if (grade !== undefined) return and(eq(u.role, 'student'), sql`${gradeTodaySql(u.cohortYear)} = ${grade}`);
    return eq(u.role, 'student');
  };

  const totalRow = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(user)
    .where(gradeCondition(user));
  const total = Number(totalRow[0]?.count ?? 0);

  if (total === 0) return { data: [] as Record<string, unknown>[], total };

  const students = await db.query.user.findMany({
    where: gradeCondition(user),
    columns: { id: true, name: true, email: true, cohortYear: true, studentId: true, phone: true, createdAt: true, leftOn: true, leftKind: true },
    extras: gradeTodayExtras,
    // Grade 10 first: a later cohort is a lower grade.
    orderBy: (u, { asc, desc }) => [desc(u.cohortYear), asc(u.name)],
    limit,
    offset,
  });

  const studentIds = students.map((s) => s.id);
  const links = studentIds.length
    ? await db.query.parentStudentLink.findMany({
        where: (l, { eq: eqOp, and: andOp, inArray: inArr }) =>
          andOp(eqOp(l.status, 'approved'), inArr(l.studentId, studentIds)),
        with: {
          parent: { columns: { name: true, email: true, phone: true } },
        },
        columns: { studentId: true },
      })
    : [];

  const parentsByStudent: Record<string, { name: string; email: string; phone: string | null }[]> = {};
  for (const link of links) {
    if (!parentsByStudent[link.studentId]) parentsByStudent[link.studentId] = [];
    if (link.parent) parentsByStudent[link.studentId]!.push(link.parent);
  }

  const mapped = students.map((stu) => ({
    studentName:   stu.name,
    studentIdCode: stu.studentId ?? '—',
    email:         stu.email,
    phone:         stu.phone ?? '—',
    grade:         stu.leftOn ? `Left (${stu.leftKind})` : gradeLabel(stu.grade),
    joinedAt:      stu.createdAt.toISOString(),
    parents:       (parentsByStudent[stu.id] ?? [])
      .map((p) => `${p.name} (${p.email})`)
      .join('; '),
  }));

  return { data: mapped, total };
}

// ─── REP-009: Pending Approvals Report ───────────────────────────────────────

/**
 * All pending approval items with age in days (REP-009).
 *
 * Returns two lists:
 * - pendingRegistrations: registrations in 'pending_approval' status
 * - pendingChangeRequests: change requests in 'pending_approval' status
 *
 * Each item includes who submitted it, the student name, subject name,
 * and how many days it has been waiting.
 */
export async function generatePendingApprovalsReport(pagination?: PaginationParams) {
  const now = Date.now();

  const [pendingRegs, pendingCRs] = await Promise.all([
    db.query.registration.findMany({
      where: (r, { eq }) => eq(r.status, 'pending_approval'),
      with: {
        student:  { columns: { id: true, name: true, cohortYear: true, studentId: true }, extras: gradeTodayExtras },
        subject:  { columns: { name: true, code: true } },
        session:  { columns: { name: true, sessionType: true } },
        approvedByUser: { columns: { name: true } },
      },
      orderBy: (r, { asc }) => [asc(r.createdAt)],
    }),

    db.query.changeRequest.findMany({
      where: (cr, { eq }) => eq(cr.status, 'pending_approval'),
      with: {
        requestedByUser: { columns: { id: true, name: true, cohortYear: true }, extras: gradeTodayExtras },
        registration: {
          with: {
            subject:  { columns: { name: true, code: true } },
            session:  { columns: { name: true } },
          },
        },
        newSubject: { columns: { name: true, code: true } },
      },
      orderBy: (cr, { asc }) => [asc(cr.createdAt)],
    }),
  ]);

  const daysSince = (d: Date) => Math.floor((now - new Date(d).getTime()) / 86_400_000);

  // URD REP-009 requires a "parent" column alongside the student. Fetch
  // approved parent links for every student referenced in the two lists
  // in a single query, then attach parent name/email to each row.
  const studentIds = [
    ...new Set([
      ...pendingRegs.map((r) => r.student?.id).filter((id): id is string => !!id),
      ...pendingCRs.map((cr) => cr.requestedByUser?.id).filter((id): id is string => !!id),
    ]),
  ];

  const parentLinks = studentIds.length
    ? await db.query.parentStudentLink.findMany({
        where: (l, { and, eq, inArray }) =>
          and(eq(l.status, 'approved'), inArray(l.studentId, studentIds)),
        with: { parent: { columns: { name: true, email: true } } },
        columns: { studentId: true },
      })
    : [];

  const parentsByStudent: Record<string, string> = {};
  for (const link of parentLinks) {
    if (!link.parent) continue;
    const row = `${link.parent.name} (${link.parent.email})`;
    parentsByStudent[link.studentId] = parentsByStudent[link.studentId]
      ? `${parentsByStudent[link.studentId]}; ${row}`
      : row;
  }

  const mappedRegs = pendingRegs.map((r) => ({
    registrationId:  r.id,
    studentName:     r.student?.name ?? '—',
    studentIdCode:   r.student?.studentId ?? '—',
    studentGrade:    gradeLabel(r.student?.grade),
    parent:          r.student?.id ? parentsByStudent[r.student.id] ?? '— (no linked parent)' : '—',
    subjectName:     r.subject?.name ?? '—',
    subjectCode:     r.subject?.code ?? '—',
    sessionName:     r.session?.name ?? '—',
    priceEGP:        Number(r.priceAtRegistration),
    daysWaiting:     daysSince(r.createdAt),
    submittedAt:     r.createdAt.toISOString(),
  }));

  const mappedCRs = pendingCRs.map((cr) => ({
    changeRequestId: cr.id,
    type:            cr.type,
    studentName:     cr.requestedByUser?.name ?? '—',
    studentGrade:    gradeLabel(cr.requestedByUser?.grade),
    parent:          cr.requestedByUser?.id ? parentsByStudent[cr.requestedByUser.id] ?? '— (no linked parent)' : '—',
    currentSubject:  cr.registration?.subject?.name ?? '—',
    newSubject:      cr.newSubject?.name ?? '—',
    sessionName:     cr.registration?.session?.name ?? '—',
    priceDiffEGP:    Number(cr.priceDifference ?? 0),
    daysWaiting:     daysSince(cr.createdAt),
    submittedAt:     cr.createdAt.toISOString(),
    reason:          cr.reason ?? '—',
  }));

  return {
    pendingRegistrations:  paginate(mappedRegs, pagination),
    pendingChangeRequests: paginate(mappedCRs, pagination),
  };
}

// ─── Comprehensive Staff Analytics ──────────────────────────────────────────

/**
 * A broad reporting pack for staff analysis.
 *
 * This intentionally goes beyond the REP baseline reports and groups the
 * system's major relationships into study-ready tables: students, parents,
 * sessions, subjects, registrations, approvals, payments, escrow, withdrawals,
 * change requests, notifications, and audit activity.
 */
export async function generateComprehensiveStaffReport() {
  const [
    userRoleRows,
    gradeRows,
    sessionRows,
    registrationStatusRows,
    lifecycleFunnelRows,
    subjectDemandRows,
    gradeCouncilRows,
    paymentStatusRows,
    paymentMethodRows,
    escrowRows,
    escrowMovementRows,
    withdrawalRows,
    changeRequestRows,
    parentCoverageRows,
    notificationRows,
    auditRows,
    agingRows,
    staleApprovalRows,
    unpaidRegistrationRows,
    studentSubjectLoadRows,
    parentLinkGapRows,
    highEscrowBalanceRows,
    pendingWithdrawalDetailRows,
    paymentSettlementRows,
    subjectPairRows,
  ] = await Promise.all([
    db
      .select({
        role: sql<string>`COALESCE(${user.role}, 'unknown')`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(user)
      .groupBy(user.role)
      .orderBy(user.role),

    db
      .select({
        grade: sql<string>`${gradeTodayLabelSql('"user"')}`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(user)
      .where(eq(user.role, 'student'))
      .groupBy(sql`1`)
      .orderBy(sql`1`),

    db.execute(sql`
      SELECT
        rs.name,
        rs.session_type AS "sessionType",
        rs.status,
        COUNT(r.id)::int AS "registrationCount",
        COALESCE(SUM(r.price_at_registration), 0)::numeric AS "reservedValueEGP",
        MIN(r.created_at) AS "firstRegistrationAt",
        MAX(r.created_at) AS "lastRegistrationAt"
      FROM ${registrationSession} rs
      LEFT JOIN ${registration} r ON r.session_id = rs.id
      GROUP BY rs.id, rs.name, rs.session_type, rs.status, rs.start_date
      ORDER BY rs.start_date DESC
    `),

    db
      .select({
        status: registration.status,
        count: sql<number>`COUNT(*)::int`,
        valueEGP: sql<number>`COALESCE(SUM(${registration.priceAtRegistration}), 0)`,
      })
      .from(registration)
      .groupBy(registration.status)
      .orderBy(registration.status),

    db.execute(sql`
      SELECT
        rs.name AS "sessionName",
        COUNT(r.id)::int AS "totalRequests",
        COUNT(*) FILTER (WHERE r.status = 'pending_approval')::int AS "pendingApproval",
        COUNT(*) FILTER (WHERE r.status = 'pending_payment')::int AS "pendingPayment",
        COUNT(*) FILTER (WHERE r.status = 'confirmed')::int AS "confirmed",
        COUNT(*) FILTER (WHERE r.status = 'rejected')::int AS "rejected",
        COUNT(*) FILTER (WHERE r.status = 'dropped')::int AS "dropped",
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE r.status = 'confirmed') / NULLIF(COUNT(r.id), 0),
          2
        ) AS "confirmationRate"
      FROM ${registrationSession} rs
      LEFT JOIN ${registration} r ON r.session_id = rs.id
      GROUP BY rs.id, rs.name, rs.start_date
      ORDER BY rs.start_date DESC
    `),

    db.execute(sql`
      SELECT
        s.name AS "subjectName",
        s.code AS "subjectCode",
        s.council,
        s.is_core AS "isCore",
        s.is_offered_at_school AS "offeredAtSchool",
        COUNT(r.id)::int AS "requestCount",
        COUNT(*) FILTER (WHERE r.status = 'confirmed')::int AS "confirmedCount",
        COUNT(*) FILTER (WHERE r.status IN ('pending_approval', 'pending_payment'))::int AS "pendingCount",
        COUNT(DISTINCT r.student_id)::int AS "uniqueStudents",
        COALESCE(SUM(r.price_at_registration) FILTER (WHERE r.status = 'confirmed'), 0)::numeric AS "confirmedRevenueEGP"
      FROM ${subject} s
      LEFT JOIN ${registration} r ON r.subject_id = s.id
      GROUP BY s.id, s.name, s.code, s.council, s.is_core, s.is_offered_at_school
      ORDER BY "requestCount" DESC, s.name ASC
    `),

    db.execute(sql`
      SELECT
        ${gradeTodayLabelSql('u')} AS grade,
        s.council,
        COUNT(r.id)::int AS "registrationCount",
        COUNT(DISTINCT r.student_id)::int AS "studentCount",
        COALESCE(SUM(r.price_at_registration) FILTER (WHERE r.status = 'confirmed'), 0)::numeric AS "confirmedRevenueEGP"
      FROM ${registration} r
      JOIN ${user} u ON u.id = r.student_id
      JOIN ${subject} s ON s.id = r.subject_id
      GROUP BY u.cohort_year, s.council
      ORDER BY u.cohort_year DESC, s.council
    `),

    db
      .select({
        status: payment.status,
        count: sql<number>`COUNT(*)::int`,
        amountEGP: sql<number>`COALESCE(SUM(${payment.amount} + ${payment.escrowAmountApplied}), 0)`,
      })
      .from(payment)
      .groupBy(payment.status)
      .orderBy(payment.status),

    db
      .select({
        paymentMethod: payment.paymentMethod,
        status: payment.status,
        count: sql<number>`COUNT(*)::int`,
        amountEGP: sql<number>`COALESCE(SUM(${payment.amount} + ${payment.escrowAmountApplied}), 0)`,
      })
      .from(payment)
      .groupBy(payment.paymentMethod, payment.status)
      .orderBy(payment.paymentMethod, payment.status),

    db.execute(sql`
      SELECT
        COUNT(e.id)::int AS "accountCount",
        COUNT(*) FILTER (WHERE e.balance > 0)::int AS "accountsWithBalance",
        COALESCE(SUM(e.balance), 0)::numeric AS "totalBalanceEGP",
        COALESCE(AVG(e.balance), 0)::numeric AS "averageBalanceEGP",
        COALESCE(MAX(e.balance), 0)::numeric AS "largestBalanceEGP"
      FROM ${escrow} e
    `),

    db
      .select({
        type: escrowTransaction.type,
        reason: escrowTransaction.reason,
        count: sql<number>`COUNT(*)::int`,
        amountEGP: sql<number>`COALESCE(SUM(${escrowTransaction.amount}), 0)`,
      })
      .from(escrowTransaction)
      .groupBy(escrowTransaction.type, escrowTransaction.reason)
      .orderBy(escrowTransaction.type, escrowTransaction.reason),

    db.execute(sql`
      SELECT
        status,
        COUNT(*)::int AS count,
        COALESCE(SUM(requested_amount), 0)::numeric AS "requestedEGP",
        COALESCE(SUM(COALESCE(released_amount, 0)), 0)::numeric AS "releasedEGP",
        COALESCE(SUM(requested_amount - COALESCE(released_amount, 0)), 0)::numeric AS "outstandingEGP"
      FROM ${withdrawalRequest}
      GROUP BY status
      ORDER BY status
    `),

    db.execute(sql`
      SELECT
        type,
        status,
        COUNT(*)::int AS count,
        COALESCE(SUM(price_difference), 0)::numeric AS "netPriceDifferenceEGP",
        ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(processed_at, NOW()) - created_at)) / 86400), 2) AS "averageAgeDays"
      FROM ${changeRequest}
      GROUP BY type, status
      ORDER BY type, status
    `),

    db.execute(sql`
      SELECT
        ${gradeTodayLabelSql('u')} AS grade,
        COUNT(DISTINCT u.id)::int AS "studentCount",
        COUNT(DISTINCT psl.student_id)::int AS "studentsWithApprovedParent",
        COUNT(psl.id) FILTER (WHERE psl.status = 'pending')::int AS "pendingLinks",
        ROUND(100.0 * COUNT(DISTINCT psl.student_id) / NULLIF(COUNT(DISTINCT u.id), 0), 2) AS "coveragePercent"
      FROM ${user} u
      LEFT JOIN ${parentStudentLink} psl
        ON psl.student_id = u.id
       AND psl.status = 'approved'
      WHERE u.role = 'student'
      GROUP BY u.cohort_year
      ORDER BY u.cohort_year DESC
    `),

    db.execute(sql`
      SELECT
        type,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread,
        COUNT(*) FILTER (WHERE email_sent_at IS NOT NULL)::int AS "emailsSent",
        ROUND(100.0 * COUNT(*) FILTER (WHERE read_at IS NOT NULL) / NULLIF(COUNT(*), 0), 2) AS "readRate"
      FROM ${notification}
      GROUP BY type
      ORDER BY count DESC, type ASC
    `),

    db.execute(sql`
      SELECT
        entity_type AS "entityType",
        action,
        COUNT(*)::int AS count,
        MAX(created_at) AS "lastSeenAt"
      FROM ${auditLog}
      GROUP BY entity_type, action
      ORDER BY count DESC, entity_type ASC, action ASC
      LIMIT 200
    `),

    db.execute(sql`
      SELECT
        'registrations_pending_approval' AS queue,
        COUNT(*)::int AS count,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400), 2) AS "averageAgeDays",
        ROUND(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400), 2) AS "oldestAgeDays"
      FROM ${registration}
      WHERE status = 'pending_approval'
      UNION ALL
      SELECT
        'registrations_pending_payment' AS queue,
        COUNT(*)::int AS count,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400), 2) AS "averageAgeDays",
        ROUND(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400), 2) AS "oldestAgeDays"
      FROM ${registration}
      WHERE status = 'pending_payment'
      UNION ALL
      SELECT
        'payments_pending' AS queue,
        COUNT(*)::int AS count,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400), 2) AS "averageAgeDays",
        ROUND(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400), 2) AS "oldestAgeDays"
      FROM ${payment}
      WHERE status = 'pending'
      UNION ALL
      SELECT
        'withdrawals_open' AS queue,
        COUNT(*)::int AS count,
        ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400), 2) AS "averageAgeDays",
        ROUND(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400), 2) AS "oldestAgeDays"
      FROM ${withdrawalRequest}
      WHERE status IN ('pending', 'partially_fulfilled')
    `),

    db.execute(sql`
      SELECT
        r.id AS "registrationId",
        u.name AS "studentName",
        ${gradeTodayLabelSql('u')} AS grade,
        s.name AS "subjectName",
        s.code AS "subjectCode",
        rs.name AS "sessionName",
        r.status,
        r.price_at_registration AS "priceEGP",
        ROUND(EXTRACT(EPOCH FROM (NOW() - r.created_at)) / 86400, 2) AS "ageDays",
        requester.name AS "requestedBy",
        approver.name AS "approvedBy"
      FROM ${registration} r
      JOIN ${user} u ON u.id = r.student_id
      JOIN ${subject} s ON s.id = r.subject_id
      JOIN ${registrationSession} rs ON rs.id = r.session_id
      LEFT JOIN ${user} requester ON requester.id = r.requested_by
      LEFT JOIN ${user} approver ON approver.id = r.approved_by
      WHERE r.status IN ('pending_approval', 'pending_payment')
      ORDER BY r.created_at ASC
      LIMIT 500
    `),

    db.execute(sql`
      SELECT
        r.id AS "registrationId",
        u.name AS "studentName",
        ${gradeTodayLabelSql('u')} AS grade,
        s.name AS "subjectName",
        s.code AS "subjectCode",
        rs.name AS "sessionName",
        r.price_at_registration AS "amountDueEGP",
        ROUND(EXTRACT(EPOCH FROM (NOW() - r.created_at)) / 86400, 2) AS "daysAwaitingPayment",
        r.approved_at AS "approvedAt"
      FROM ${registration} r
      JOIN ${user} u ON u.id = r.student_id
      JOIN ${subject} s ON s.id = r.subject_id
      JOIN ${registrationSession} rs ON rs.id = r.session_id
      WHERE r.status = 'pending_payment'
      ORDER BY r.created_at ASC
      LIMIT 500
    `),

    db.execute(sql`
      SELECT
        u.name AS "studentName",
        u.student_id AS "studentIdCode",
        ${gradeTodayLabelSql('u')} AS grade,
        rs.name AS "sessionName",
        COUNT(r.id)::int AS "activeSubjectCount",
        COALESCE(SUM(r.price_at_registration), 0)::numeric AS "reservedValueEGP",
        COUNT(*) FILTER (WHERE r.status = 'confirmed')::int AS "confirmedSubjects",
        COUNT(*) FILTER (WHERE r.status IN ('pending_approval', 'pending_payment'))::int AS "pendingSubjects"
      FROM ${registration} r
      JOIN ${user} u ON u.id = r.student_id
      JOIN ${registrationSession} rs ON rs.id = r.session_id
      WHERE r.status NOT IN ('dropped', 'rejected', 'expired')
      GROUP BY u.id, u.name, u.student_id, u.cohort_year, rs.id, rs.name
      ORDER BY "activeSubjectCount" DESC, "reservedValueEGP" DESC, u.name ASC
      LIMIT 500
    `),

    db.execute(sql`
      SELECT
        u.id AS "studentId",
        u.name AS "studentName",
        u.student_id AS "studentIdCode",
        u.email AS "studentEmail",
        ${gradeTodayLabelSql('u')} AS grade,
        COUNT(psl.id) FILTER (WHERE psl.status = 'pending')::int AS "pendingLinkRequests"
      FROM ${user} u
      LEFT JOIN ${parentStudentLink} approved
        ON approved.student_id = u.id
       AND approved.status = 'approved'
      LEFT JOIN ${parentStudentLink} psl
        ON psl.student_id = u.id
       AND psl.status = 'pending'
      WHERE u.role = 'student'
        AND approved.id IS NULL
      GROUP BY u.id, u.name, u.student_id, u.email, u.cohort_year
      ORDER BY u.cohort_year DESC, u.name
      LIMIT 500
    `),

    db.execute(sql`
      SELECT
        u.name AS "studentName",
        u.student_id AS "studentIdCode",
        ${gradeTodayLabelSql('u')} AS grade,
        e.balance AS "balanceEGP",
        e.updated_at AS "lastUpdatedAt"
      FROM ${escrow} e
      JOIN ${user} u ON u.id = e.student_id
      WHERE e.balance > 0
      ORDER BY e.balance DESC
      LIMIT 200
    `),

    db.execute(sql`
      SELECT
        wr.id AS "withdrawalId",
        u.name AS "studentName",
        u.student_id AS "studentIdCode",
        wr.status,
        wr.requested_amount AS "requestedEGP",
        COALESCE(wr.released_amount, 0) AS "releasedEGP",
        wr.requested_amount - COALESCE(wr.released_amount, 0) AS "outstandingEGP",
        ROUND(EXTRACT(EPOCH FROM (NOW() - wr.created_at)) / 86400, 2) AS "ageDays",
        wr.admin_notes AS "adminNotes"
      FROM ${withdrawalRequest} wr
      JOIN ${escrow} e ON e.id = wr.escrow_id
      JOIN ${user} u ON u.id = e.student_id
      WHERE wr.status IN ('pending', 'partially_fulfilled')
      ORDER BY wr.created_at ASC
      LIMIT 500
    `),

    db.execute(sql`
      SELECT
        p.id AS "paymentId",
        student.name AS "studentName",
        parent.name AS "parentName",
        p.payment_method AS "paymentMethod",
        p.status,
        p.amount AS "chargedAmountEGP",
        p.escrow_amount_applied AS "escrowAppliedEGP",
        p.amount + p.escrow_amount_applied AS "coveredValueEGP",
        COUNT(pr.registration_id)::int AS "registrationCount",
        p.created_at AS "createdAt",
        p.confirmed_at AS "confirmedAt"
      FROM ${payment} p
      JOIN ${user} student ON student.id = p.student_id
      JOIN ${user} parent ON parent.id = p.parent_id
      LEFT JOIN payment_registration pr ON pr.payment_id = p.id
      GROUP BY p.id, student.name, parent.name, p.payment_method, p.status, p.amount, p.escrow_amount_applied, p.created_at, p.confirmed_at
      ORDER BY p.created_at DESC
      LIMIT 500
    `),

    db.execute(sql`
      WITH active_regs AS (
        SELECT student_id, session_id, subject_id
        FROM ${registration}
        WHERE status NOT IN ('dropped', 'rejected', 'expired')
      )
      SELECT
        LEAST(s1.name, s2.name) AS "subjectA",
        GREATEST(s1.name, s2.name) AS "subjectB",
        COUNT(*)::int AS "studentOverlap"
      FROM active_regs r1
      JOIN active_regs r2
        ON r1.student_id = r2.student_id
       AND r1.session_id = r2.session_id
       AND r1.subject_id < r2.subject_id
      JOIN ${subject} s1 ON s1.id = r1.subject_id
      JOIN ${subject} s2 ON s2.id = r2.subject_id
      GROUP BY LEAST(s1.name, s2.name), GREATEST(s1.name, s2.name)
      ORDER BY "studentOverlap" DESC, "subjectA", "subjectB"
      LIMIT 200
    `),
  ]);

  const registrationsByStatus = registrationStatusRows.map((row) => ({
    status: row.status,
    count: numberValue(row.count),
    valueEGP: numberValue(row.valueEGP),
  }));

  const paymentsByStatus = paymentStatusRows.map((row) => ({
    status: row.status,
    count: numberValue(row.count),
    amountEGP: numberValue(row.amountEGP),
  }));

  const totalRegistrations = registrationsByStatus.reduce((sum, row) => sum + row.count, 0);
  const confirmedRegistrations = registrationsByStatus.find((row) => row.status === 'confirmed')?.count ?? 0;
  const paymentTotal = paymentsByStatus.reduce((sum, row) => sum + row.amountEGP, 0);
  const completedPaymentTotal = paymentsByStatus.find((row) => row.status === 'completed')?.amountEGP ?? 0;
  type ParentCoverageTotals = {
    studentCount: number;
    studentsWithApprovedParent: number;
    pendingLinks: number;
  };
  const parentCoverage = rowsOf<{
    studentCount: unknown;
    studentsWithApprovedParent: unknown;
    pendingLinks: unknown;
  }>(parentCoverageRows).reduce<ParentCoverageTotals>(
    (sum, row) => ({
      studentCount: sum.studentCount + numberValue(row.studentCount),
      studentsWithApprovedParent: sum.studentsWithApprovedParent + numberValue(row.studentsWithApprovedParent),
      pendingLinks: sum.pendingLinks + numberValue(row.pendingLinks),
    }),
    { studentCount: 0, studentsWithApprovedParent: 0, pendingLinks: 0 },
  );

  return {
    generatedAt: new Date(),
    summary: {
      totalRegistrations,
      confirmedRegistrations,
      confirmationRate: totalRegistrations ? Number(((confirmedRegistrations / totalRegistrations) * 100).toFixed(2)) : 0,
      totalPaymentFlowEGP: paymentTotal,
      completedPaymentFlowEGP: completedPaymentTotal,
      parentCoveragePercent: parentCoverage.studentCount
        ? Number(((parentCoverage.studentsWithApprovedParent / parentCoverage.studentCount) * 100).toFixed(2))
        : 0,
      pendingParentLinks: parentCoverage.pendingLinks,
    },
    sections: {
      usersByRole: userRoleRows.map((row) => ({ role: row.role, count: numberValue(row.count) })),
      studentsByGrade: gradeRows.map((row) => ({ grade: row.grade, count: numberValue(row.count) })),
      sessionHealth: rowsOf(sessionRows),
      registrationsByStatus,
      lifecycleFunnel: rowsOf(lifecycleFunnelRows),
      subjectDemand: rowsOf(subjectDemandRows),
      gradeCouncilDemand: rowsOf(gradeCouncilRows),
      paymentsByStatus,
      paymentMethodMix: paymentMethodRows.map((row) => ({
        paymentMethod: row.paymentMethod,
        status: row.status,
        count: numberValue(row.count),
        amountEGP: numberValue(row.amountEGP),
      })),
      escrowHealth: rowsOf(escrowRows),
      escrowMovementByReason: escrowMovementRows.map((row) => ({
        type: row.type,
        reason: row.reason,
        count: numberValue(row.count),
        amountEGP: numberValue(row.amountEGP),
      })),
      withdrawalHealth: rowsOf(withdrawalRows),
      changeRequestAnalysis: rowsOf(changeRequestRows),
      parentLinkCoverage: rowsOf(parentCoverageRows),
      notificationEngagement: rowsOf(notificationRows),
      auditActivity: rowsOf(auditRows),
      agingQueues: rowsOf(agingRows),
      staleApprovalsAndPayments: rowsOf(staleApprovalRows),
      unpaidRegistrations: rowsOf(unpaidRegistrationRows),
      studentSubjectLoad: rowsOf(studentSubjectLoadRows),
      studentsWithoutApprovedParents: rowsOf(parentLinkGapRows),
      highEscrowBalances: rowsOf(highEscrowBalanceRows),
      pendingWithdrawalDetails: rowsOf(pendingWithdrawalDetailRows),
      paymentSettlementDetails: rowsOf(paymentSettlementRows),
      subjectPairOverlap: rowsOf(subjectPairRows),
    },
  };
}


/**
 * Setup checklist (UX_AUDIT G9): what the school has NOT configured yet,
 * surfaced to the admin before a parent trips over it.
 */
export async function getSetupChecklist() {
  // This academic year as the school counts it: 1 July, Cairo time (F0a).
  const year = academicYearLabel(academicYearStartOf());

  const [sessions, subjects, subjectTeacherLinks, schoolFeeRows, refundWindows, remarkFees] =
    await Promise.all([
      db.query.registrationSession.findMany({
        where: (s, { inArray }) => inArray(s.status, ['draft', 'active']),
        columns: { id: true, status: true },
      }),
      db.query.subject.findMany({
        where: (s, { eq }) => eq(s.isActive, true),
        columns: { id: true, council: true, courseFee: true, registrationFee: true },
      }),
      db.query.subjectTeacher.findMany({ columns: { subjectId: true } }),
      db.query.schoolFeeSchedule.findMany({
        where: (s, { eq }) => eq(s.academicYear, year),
        columns: { id: true },
      }),
      db.query.refundWindow.findMany({ columns: { id: true } }),
      db.query.remarkFeeSchedule.findMany({ columns: { council: true, serviceType: true } }),
    ]);

  const linkedSubjectIds = new Set(subjectTeacherLinks.map((l) => l.subjectId));
  const councilsInUse = [...new Set(subjects.map((s) => s.council))];
  const councilsMissingRemarkFees = councilsInUse.filter(
    (c) => !remarkFees.some((f) => f.council === c && f.serviceType === 'review_of_marking')
  );

  const activeCount = sessions.filter((s) => s.status === 'active').length;
  return {
    academicYear: year,
    hasOpenOrUpcomingSession: sessions.length > 0,
    activeSessionCount: activeCount,
    // A draft session satisfies "a session exists" but nobody can
    // register against it — the checklist looked clean while
    // registration was closed for everyone.
    draftOnly: sessions.length > 0 && activeCount === 0,
    subjectCount: subjects.length,
    zeroFeeSubjects: subjects.filter((s) => s.courseFee + s.registrationFee <= 0).length,
    subjectsWithoutTeachers: subjects.filter((s) => !linkedSubjectIds.has(s.id)).length,
    schoolFeeConfigured: schoolFeeRows.length > 0,
    refundWindowsConfigured: refundWindows.length > 0,
    councilsMissingRemarkFees,
  };
}
