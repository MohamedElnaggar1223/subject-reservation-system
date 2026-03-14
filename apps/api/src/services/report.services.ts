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

  const [
    studentsByGrade,
    parentCount,
    activeSessions,
    pendingApprovalRegs,
    pendingPaymentRegs,
    pendingChangeRequests,
    pendingBankTransfers,
    confirmedThisMonth,
    escrowLiability,
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

    // Active sessions
    db
      .select({ count: count() })
      .from(registrationSession)
      .where(eq(registrationSession.status, 'active')),

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
  ]);

  // Map grade counts
  const gradeMap: Record<string, number> = { grade10: 0, grade11: 0, grade12: 0, graduated: 0 };
  for (const row of studentsByGrade) {
    if (row.grade === 10)   gradeMap.grade10    = Number(row.count);
    else if (row.grade === 11) gradeMap.grade11 = Number(row.count);
    else if (row.grade === 12) gradeMap.grade12 = Number(row.count);
    else                    gradeMap.graduated  = Number(row.count); // grade = null
  }

  return {
    students: {
      grade10:   gradeMap.grade10,
      grade11:   gradeMap.grade11,
      grade12:   gradeMap.grade12,
      graduated: gradeMap.graduated,
      total:     gradeMap.grade10 + gradeMap.grade11 + gradeMap.grade12 + gradeMap.graduated,
    },
    parents:             Number(parentCount[0]?.count ?? 0),
    activeSessions:      Number(activeSessions[0]?.count ?? 0),
    pendingApprovals:    Number(pendingApprovalRegs[0]?.count ?? 0),
    pendingPayments:     Number(pendingPaymentRegs[0]?.count ?? 0),
    pendingChangeReqs:   Number(pendingChangeRequests[0]?.count ?? 0),
    pendingBankTransfers:Number(pendingBankTransfers[0]?.count ?? 0),
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
  filters?: { grade?: number; status?: string }
) {
  const rows = await db.query.registration.findMany({
    where: (r, { eq, and }) => {
      const conds = [eq(r.sessionId, sessionId)];
      if (filters?.status) conds.push(eq(r.status, filters.status));
      return and(...conds);
    },
    with: {
      student: { columns: { id: true, name: true, grade: true, studentId: true, email: true } },
      subject: { columns: { id: true, name: true, code: true, council: true, isOfferedAtSchool: true } },
      approvedBy: { columns: { id: true, name: true, role: true } },
    },
    orderBy: (r, { asc }) => [asc(r.createdAt)],
  });

  // Filter by grade in memory (join makes SQL harder with nullable field)
  const filtered = filters?.grade
    ? rows.filter((r) => r.student?.grade === filters.grade)
    : rows;

  return filtered.map((r) => ({
    studentName:       r.student?.name ?? '—',
    studentGrade:      r.student?.grade ?? 'Graduated',
    studentId:         r.student?.studentId ?? '—',
    studentEmail:      r.student?.email ?? '—',
    subjectName:       r.subject?.name ?? '—',
    subjectCode:       r.subject?.code ?? '—',
    council:           r.subject?.council ?? '—',
    offeredAtSchool:   r.subject?.isOfferedAtSchool ? 'Yes' : 'No',
    status:            r.status,
    priceEGP:          Number(r.priceAtRegistration),
    approvedBy:        r.approvedBy?.name ?? '—',
    approvalComments:  r.approvalComments ?? '—',
    registeredAt:      r.createdAt.toISOString(),
  }));
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
export async function generateFinancialSummary(sessionId: string) {
  const rows = await db.query.registration.findMany({
    where: (r, { eq, and, inArray }) =>
      and(
        eq(r.sessionId, sessionId),
        inArray(r.status, ['confirmed', 'pending_payment'])
      ),
    with: {
      subject: { columns: { isOfferedAtSchool: true } },
      payments: {
        with: {
          payment: { columns: { paymentMethod: true, status: true, totalAmount: true } },
        },
      },
    },
  });

  let confirmedSchool = 0;
  let confirmedNonSchool = 0;
  let pendingRevenue = 0;
  const byMethod: Record<string, number> = {};

  for (const reg of rows) {
    const price = Number(reg.priceAtRegistration);
    const isSchool = reg.subject?.isOfferedAtSchool ?? true;

    if (reg.status === 'confirmed') {
      if (isSchool) confirmedSchool += price;
      else confirmedNonSchool += price;

      // Aggregate by payment method from linked payments
      for (const pr of reg.payments ?? []) {
        const method = pr.payment?.paymentMethod ?? 'unknown';
        byMethod[method] = (byMethod[method] ?? 0) + price;
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
    generatedAt:                  new Date(),
  };
}

// ─── REP-003: Escrow Report ───────────────────────────────────────────────────

/**
 * Escrow report — current balances and pending withdrawals (REP-003).
 * Returns one row per escrow account with linked student + parent info.
 */
export async function generateEscrowReport() {
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
    columns: { studentId: true, amount: true },
  });
  const pendingByStudent: Record<string, number> = {};
  for (const pw of pendingWithdrawals) {
    pendingByStudent[pw.studentId] = (pendingByStudent[pw.studentId] ?? 0) + Number(pw.amount);
  }

  // Linked parents per student
  const links = await db.query.parentStudentLink.findMany({
    where: (l, { eq }) => eq(l.status, 'accepted'),
    with: {
      parent: { columns: { id: true, name: true, email: true } },
    },
    columns: { studentId: true },
  });
  const parentsByStudent: Record<string, { id: string; name: string; email: string }[]> = {};
  for (const link of links) {
    if (!parentsByStudent[link.studentId]) parentsByStudent[link.studentId] = [];
    if (link.parent) parentsByStudent[link.studentId].push(link.parent);
  }

  return accounts.map((acc) => ({
    studentName:          acc.student?.name ?? '—',
    studentGrade:         acc.student?.grade ?? 'Graduated',
    studentIdCode:        acc.student?.studentId ?? '—',
    studentEmail:         acc.student?.email ?? '—',
    balanceEGP:           Number(acc.balance),
    pendingWithdrawalEGP: pendingByStudent[acc.studentId] ?? 0,
    availableEGP:         Number(acc.balance) - (pendingByStudent[acc.studentId] ?? 0),
    linkedParents:        (parentsByStudent[acc.studentId] ?? []).map((p) => p.name).join(', '),
  }));
}

// ─── REP-004: Subject Enrollment Report ──────────────────────────────────────

/**
 * Subject enrollment counts for a session (REP-004).
 * Groups by subject, shows school vs. non-school and enrollment counts.
 */
export async function generateSubjectEnrollmentReport(sessionId: string) {
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
    const entry = subjectMap[sub.id];
    if (reg.status === 'confirmed') {
      entry.confirmed++;
      entry.totalRevenue += Number(reg.priceAtRegistration);
    } else if (reg.status === 'pending_payment') {
      entry.pendingPayment++;
    } else {
      entry.pendingApproval++;
    }
  }

  return Object.values(subjectMap).sort((a, b) => b.confirmed - a.confirmed);
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
    regMap[reg.studentId][reg.subjectId] = reg.status;
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
export async function generateStudentRoster(grade?: number | null) {
  const students = await db.query.user.findMany({
    where: (u, { eq, and, isNull }) => {
      if (grade === null) {
        return and(eq(u.role, 'student'), isNull(u.grade)); // graduated
      }
      if (grade !== undefined) {
        return and(eq(u.role, 'student'), eq(u.grade, grade));
      }
      return eq(u.role, 'student');
    },
    columns: { id: true, name: true, email: true, grade: true, studentId: true, phone: true, createdAt: true },
    orderBy: (u, { asc }) => [asc(u.grade), asc(u.name)],
  });

  if (students.length === 0) return [];

  const studentIds = students.map((s) => s.id);
  const links = await db.query.parentStudentLink.findMany({
    where: (l, { eq, and, inArray }) =>
      and(eq(l.status, 'accepted'), inArray(l.studentId, studentIds)),
    with: {
      parent: { columns: { name: true, email: true, phone: true } },
    },
    columns: { studentId: true },
  });

  const parentsByStudent: Record<string, { name: string; email: string; phone: string | null }[]> = {};
  for (const link of links) {
    if (!parentsByStudent[link.studentId]) parentsByStudent[link.studentId] = [];
    if (link.parent) parentsByStudent[link.studentId].push(link.parent);
  }

  return students.map((stu) => ({
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
export async function generatePendingApprovalsReport() {
  const now = Date.now();

  const [pendingRegs, pendingCRs] = await Promise.all([
    db.query.registration.findMany({
      where: (r, { eq }) => eq(r.status, 'pending_approval'),
      with: {
        student:  { columns: { id: true, name: true, grade: true, studentId: true } },
        subject:  { columns: { name: true, code: true } },
        session:  { columns: { name: true, sessionType: true } },
        approvedBy: { columns: { name: true } },
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

  return {
    pendingRegistrations: pendingRegs.map((r) => ({
      registrationId:  r.id,
      studentName:     r.student?.name ?? '—',
      studentIdCode:   r.student?.studentId ?? '—',
      studentGrade:    r.student?.grade ?? 'Graduated',
      subjectName:     r.subject?.name ?? '—',
      subjectCode:     r.subject?.code ?? '—',
      sessionName:     r.session?.name ?? '—',
      priceEGP:        Number(r.priceAtRegistration),
      daysWaiting:     daysSince(r.createdAt),
      submittedAt:     r.createdAt.toISOString(),
    })),

    pendingChangeRequests: pendingCRs.map((cr) => ({
      changeRequestId: cr.id,
      type:            cr.type,
      studentName:     cr.requestedByUser?.name ?? '—',
      studentGrade:    cr.requestedByUser?.grade ?? 'Graduated',
      currentSubject:  cr.registration?.subject?.name ?? '—',
      newSubject:      cr.newSubject?.name ?? '—',
      sessionName:     cr.registration?.session?.name ?? '—',
      priceDiffEGP:    Number(cr.priceDifference ?? 0),
      daysWaiting:     daysSince(cr.createdAt),
      submittedAt:     cr.createdAt.toISOString(),
      reason:          cr.reason ?? '—',
    })),
  };
}
