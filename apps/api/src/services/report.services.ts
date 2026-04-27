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
  eq,
  and,
  inArray,
  isNull,
  isNotNull,
  sql,
  count,
} from '@repo/db';

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
    // Student counts by grade + graduated
    db
      .select({ grade: user.grade, count: count() })
      .from(user)
      .where(eq(user.role, 'student'))
      .groupBy(user.grade),

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
  const gradeMap: Record<string, number> = { grade10: 0, grade11: 0, grade12: 0, graduated: 0 };
  for (const row of studentsByGrade) {
    if (row.grade === 10)   gradeMap.grade10    = Number(row.count);
    else if (row.grade === 11) gradeMap.grade11 = Number(row.count);
    else if (row.grade === 12) gradeMap.grade12 = Number(row.count);
    else                    gradeMap.graduated  = Number(row.count); // grade = null
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
      active:    activeStudents,
      total:     activeStudents + (gradeMap.graduated ?? 0),
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
        ...(filters?.grade !== undefined ? [eq(user.grade, filters.grade)] : []),
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
        ...(filters?.grade !== undefined ? [eq(user.grade, filters.grade)] : []),
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
      student: { columns: { id: true, name: true, grade: true, studentId: true, email: true } },
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
      studentGrade:      r.student.grade ?? 'Graduated',
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
        columns: { id: true, name: true, grade: true, studentId: true, email: true },
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
    studentGrade:         acc.student?.grade ?? 'Graduated',
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

  // Get all Grade 10 students
  const grade10Students = await db.query.user.findMany({
    where: (u, { eq, and }) => and(eq(u.role, 'student'), eq(u.grade, 10)),
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

  const gradeCondition = (u: typeof user) => {
    if (grade === null) return and(eq(u.role, 'student'), isNull(u.grade));
    if (grade !== undefined) return and(eq(u.role, 'student'), eq(u.grade, grade));
    return eq(u.role, 'student');
  };

  const totalRow = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(user)
    .where(gradeCondition(user));
  const total = Number(totalRow[0]?.count ?? 0);

  if (total === 0) return { data: [] as Record<string, unknown>[], total };

  const students = await db.query.user.findMany({
    where: (u, { eq: eqOp, and: andOp, isNull: isNullOp }) => {
      if (grade === null) return andOp(eqOp(u.role, 'student'), isNullOp(u.grade));
      if (grade !== undefined) return andOp(eqOp(u.role, 'student'), eqOp(u.grade, grade));
      return eqOp(u.role, 'student');
    },
    columns: { id: true, name: true, email: true, grade: true, studentId: true, phone: true, createdAt: true },
    orderBy: (u, { asc }) => [asc(u.grade), asc(u.name)],
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
    grade:         stu.grade ?? 'Graduated',
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
        student:  { columns: { id: true, name: true, grade: true, studentId: true } },
        subject:  { columns: { name: true, code: true } },
        session:  { columns: { name: true, sessionType: true } },
        approvedByUser: { columns: { name: true } },
      },
      orderBy: (r, { asc }) => [asc(r.createdAt)],
    }),

    db.query.changeRequest.findMany({
      where: (cr, { eq }) => eq(cr.status, 'pending_approval'),
      with: {
        requestedByUser: { columns: { id: true, name: true, grade: true } },
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
    studentGrade:    r.student?.grade ?? 'Graduated',
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
    studentGrade:    cr.requestedByUser?.grade ?? 'Graduated',
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
