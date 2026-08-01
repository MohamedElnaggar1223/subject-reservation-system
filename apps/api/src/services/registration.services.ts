/**
 * Registration Service
 *
 * Business logic for the full subject registration workflow:
 * - Student submits a registration request (pending parent approval)
 * - Parent approves or rejects pending requests
 * - Parent directly registers for a linked child (auto-approved)
 * - Admin overrides parent approval with mandatory audit reason
 * - Core subject validation for Grade 10 June sessions
 * - Available subject filtering (excludes already-registered subjects)
 *
 * Status flow:
 * Student-initiated:  pending_approval → (parent approves) → pending_payment → (payment) → confirmed
 * Parent-initiated:   pending_payment → (payment) → confirmed
 * Admin override:     pending_payment (directly, reason logged in approvalComments)
 * Rejected:           rejected (terminal)
 * Dropped:            dropped (via change request — Step 3.4)
 *
 * All database imports come from @repo/db — never from drizzle-orm directly.
 */

import {
  db,
  registration,
  paymentRegistration,
  subject,
  registrationSession,
  parentStudentLink,
  user,
  eq,
  and,
  inArray,
  notInArray,
} from '@repo/db';
import { randomUUID } from 'crypto';
import type {
  RequestRegistrationType,
  DirectRegistrationType,
  ApproveRegistrationsType,
  RevertApprovedRegistrationsType,
  RejectRegistrationsType,
  AdminOverrideApprovalType,
  ListRegistrationsQueryType,
} from '@repo/validations';
import {
  notifyRegistrationRequestReceived,
  notifyRegistrationDecision,
  notifyDirectRegistrationCreated,
} from './notification.services';
import { isGraduated } from './grade.services';
import { computeRegistrationPricing } from './pricing.services';
import { schoolFeeGateReason } from './school-fee.services';
import { applyPricingExceptions, hasDeadlineExtension } from './exception.services';
import type { SubjectRegistrationOptionsType } from '@repo/validations';

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Subject IDs the student has previously sat (confirmed) or dropped in
 * OTHER sessions — registering one of these again is a retake (V3 §6.9).
 */
async function getRetakeSubjectIds(
  studentId: string,
  excludeSessionId: string
): Promise<Set<string>> {
  const prior = await db.query.registration.findMany({
    where: (r, { eq, and, ne, inArray }) =>
      and(
        eq(r.studentId, studentId),
        ne(r.sessionId, excludeSessionId),
        inArray(r.status, ['confirmed', 'dropped'])
      ),
    columns: { subjectId: true },
  });
  return new Set(prior.map((r) => r.subjectId));
}

/**
 * Shared V3 pre-insert pipeline for both request and direct registration:
 * level match, teacher validation, retake detection, pricing engine, and
 * the school-fee gate. Returns per-subject computed values keyed by
 * subject ID.
 */
export async function prepareRegistrationInputs(
  studentId: string,
  sess: { id: string; qualificationLevel: string; startDate: Date },
  subjects: {
    id: string;
    qualificationLevel: string;
    courseFee: number;
    registrationFee: number;
    isOfferedAtSchool: boolean;
    name: string;
  }[],
  subjectOptions: Record<string, SubjectRegistrationOptionsType> | undefined
) {
  // Level match: an IGCSE session only takes IGCSE subjects, etc.
  const wrongLevel = subjects.filter((s) => s.qualificationLevel !== sess.qualificationLevel);
  if (wrongLevel.length > 0) {
    throw new Error(
      `These subjects don't match the session's qualification level: ${wrongLevel.map((s) => s.name).join(', ')}`
    );
  }

  // School-fee gate (D-H): unpaid school fee blocks registration
  const studentRow = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, studentId),
    columns: { grade: true },
  });
  const gate = await schoolFeeGateReason(studentId, studentRow?.grade ?? null, sess.startDate);
  if (gate) throw new Error(gate);

  // Teacher validation: chosen teacher must be linked to that subject
  const requestedTeacherIds = Object.values(subjectOptions ?? {})
    .map((o) => o.teacherId)
    .filter((t): t is string => !!t);
  const teacherLinks = requestedTeacherIds.length
    ? await db.query.subjectTeacher.findMany({
        where: (st, { inArray }) => inArray(st.teacherId, requestedTeacherIds),
        columns: { subjectId: true, teacherId: true },
      })
    : [];

  const retakeSet = await getRetakeSubjectIds(studentId, sess.id);

  const result = new Map<
    string,
    {
      pricing: ReturnType<typeof computeRegistrationPricing>;
      isRetake: boolean;
      teacherId: string | null;
    }
  >();

  for (const sub of subjects) {
    const opts = subjectOptions?.[sub.id] ?? {};
    const isRetake = retakeSet.has(sub.id);

    // Hook 1 (§6.3): per-student pricing exceptions apply after the 50% rule
    const pricing = await applyPricingExceptions(
      studentId,
      sess.id,
      sub.id,
      computeRegistrationPricing(sub, {
        isRetake,
        takeOutsideSchool: opts.takeOutsideSchool ?? false,
      })
    );

    let teacherId: string | null = null;
    if (opts.teacherId && !pricing.isOutsideSchool) {
      const linked = teacherLinks.some(
        (l) => l.subjectId === sub.id && l.teacherId === opts.teacherId
      );
      if (!linked) {
        throw new Error(`The chosen teacher is not linked to ${sub.name}`);
      }
      teacherId = opts.teacherId;
    }

    result.set(sub.id, { pricing, isRetake, teacherId });
  }

  return result;
}

/**
 * Verify that a parent has an approved link to a specific student.
 */
async function validateParentStudentLink(
  parentId: string,
  studentId: string
): Promise<boolean> {
  const link = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and }) =>
      and(
        eq(l.parentId, parentId),
        eq(l.studentId, studentId),
        eq(l.status, 'approved')
      ),
    columns: { id: true },
  });
  return !!link;
}

/**
 * Return the IDs of all students linked (approved) to a parent.
 */
async function getLinkedStudentIds(parentId: string): Promise<string[]> {
  const links = await db.query.parentStudentLink.findMany({
    where: (l, { eq, and }) =>
      and(eq(l.parentId, parentId), eq(l.status, 'approved')),
    columns: { studentId: true },
  });
  return links.map((l) => l.studentId);
}

/**
 * Return true if a student has at least one approved parent link.
 *
 * Used to block student-initiated registration requests when nobody can
 * approve them — otherwise the requests would sit forever in
 * pending_approval until session close expires them (silent hang).
 */
async function studentHasApprovedParent(studentId: string): Promise<boolean> {
  const link = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and }) =>
      and(eq(l.studentId, studentId), eq(l.status, 'approved')),
    columns: { id: true },
  });
  return !!link;
}

/**
 * Return the subject IDs for which a student already has a non-dropped,
 * non-rejected registration in the given session.
 * Used to prevent duplicate registrations.
 */
async function getExistingRegistrationSubjectIds(
  studentId: string,
  sessionId: string
): Promise<string[]> {
  const existing = await db.query.registration.findMany({
    where: (r, { eq, and, notInArray }) =>
      and(
        eq(r.studentId, studentId),
        eq(r.sessionId, sessionId),
        notInArray(r.status, ['dropped', 'rejected', 'expired'])
      ),
    columns: { subjectId: true },
  });
  return existing.map((r) => r.subjectId);
}

// ─── Public Service Functions ────────────────────────────────────────────────

/**
 * Validate that a Grade 10 student's registration request includes all
 * mandatory core subjects for a June session.
 *
 * Returns { valid: true } for non-Grade-10 students or non-June sessions.
 * Returns { valid: false, missingCoreSubjects } when core subjects are missing.
 */
export async function validateCoreSubjectRequirements(
  studentId: string,
  sessionId: string,
  subjectIds: string[]
): Promise<{
  valid: boolean;
  missingCoreSubjects: { id: string; name: string; code: string }[];
}> {
  const [studentRecord, sessionRecord] = await Promise.all([
    db.query.user.findFirst({
      where: (u, { eq }) => eq(u.id, studentId),
      columns: { grade: true },
    }),
    db.query.registrationSession.findFirst({
      where: (s, { eq }) => eq(s.id, sessionId),
      columns: { sessionType: true },
    }),
  ]);

  // Fail closed if either entity is missing: all current callers pre-check
  // student/session existence, so this branch indicates a programming bug
  // or a race (student deleted mid-request). Previously this returned
  // valid=true which would silently bypass the CORE-003 rule if the
  // helper were ever reused from a path that skipped the pre-check.
  if (!studentRecord) {
    throw new Error('Student not found during core-subject validation');
  }
  if (!sessionRecord) {
    throw new Error('Session not found during core-subject validation');
  }

  // Core requirement only applies to Grade 10 in the June session
  if (studentRecord.grade !== 10 || sessionRecord.sessionType !== 'june') {
    return { valid: true, missingCoreSubjects: [] };
  }

  const coreSubjects = await db.query.subject.findMany({
    where: (s, { eq, and }) => and(eq(s.isCore, true), eq(s.isActive, true)),
    columns: { id: true, name: true, code: true },
  });

  const missingCoreSubjects = coreSubjects.filter(
    (core) => !subjectIds.includes(core.id)
  );

  return {
    valid: missingCoreSubjects.length === 0,
    missingCoreSubjects,
  };
}

/**
 * Return all active subjects that a student has not yet registered for
 * in the given session. Used to populate the registration form.
 *
 * Subjects the student already has a non-terminal registration for
 * (pending_approval, pending_payment, confirmed) are excluded so the
 * list never contains duplicates of what the student has already acted
 * on. This includes core subjects — the frontend is responsible for
 * pre-selecting + locking any missing core subjects for Grade 10 June
 * (see register.client.tsx).
 */
export type AvailableSubjectRow = {
  id: string;
  name: string;
  code: string;
  council: string;
  qualificationLevel: string;
  courseFee: number;
  registrationFee: number;
  priceInSchool: number;
  isOfferedAtSchool: boolean;
  customPrice: number | null;
  isActive: boolean;
  isCore: boolean;
  createdAt: Date;
  updatedAt: Date;
  teachers: { id: string; name: string }[];
  isRetake: boolean;
  pricing: { courseFee: number; registrationFee: number; total: number; isOutsideSchool: boolean };
  outsidePricing: { courseFee: number; registrationFee: number; total: number; isOutsideSchool: boolean } | null;
};

// Explicit return type: the drizzle relational inference chained through
// Hono RPC + JSONParsed exceeds TS instantiation depth in the web compile
// and silently degrades the client type — a concrete type short-circuits it.
export async function getAvailableSubjects(
  studentId: string,
  sessionId: string
): Promise<AvailableSubjectRow[]> {
  // GRADE-003: Graduated students have no available subjects
  if (await isGraduated(studentId)) return [];

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, sessionId),
    columns: { id: true, qualificationLevel: true },
  });
  if (!sess) return [];

  const alreadyRegistered = await getExistingRegistrationSubjectIds(
    studentId,
    sessionId
  );

  const subjects = await db.query.subject.findMany({
    where: (s, { eq, and, notInArray }) => {
      const conditions = [
        eq(s.isActive, true),
        eq(s.qualificationLevel, sess.qualificationLevel),
      ];
      if (alreadyRegistered.length > 0) {
        conditions.push(notInArray(s.id, alreadyRegistered));
      }
      return and(...conditions);
    },
    with: {
      subjectTeachers: {
        with: { teacher: { columns: { id: true, name: true, isActive: true } } },
      },
    },
    orderBy: (s, { asc }) => [asc(s.name)],
  });

  // V3 enrichment: teachers to pick from, retake flag, and both price
  // variants so the UI can show exactly what each choice costs.
  const retakeSet = await getRetakeSubjectIds(studentId, sessionId);

  return subjects.map(({ subjectTeachers, ...sub }) => {
    const isRetake = retakeSet.has(sub.id);
    const inSchoolPricing = computeRegistrationPricing(sub, {
      isRetake,
      takeOutsideSchool: false,
    });
    const outsidePricing =
      !sub.isOfferedAtSchool || isRetake
        ? computeRegistrationPricing(sub, { isRetake, takeOutsideSchool: true })
        : null;

    return {
      ...sub,
      teachers: subjectTeachers
        .map((st) => st.teacher)
        .filter((t) => t.isActive)
        .map((t) => ({ id: t.id, name: t.name })),
      isRetake,
      pricing: inSchoolPricing,
      outsidePricing,
    };
  });
}

/**
 * Student submits a registration request for a set of subjects.
 *
 * - Session must be active.
 * - All subjects must be active.
 * - No duplicate registrations in the same session.
 * - Grade 10 June sessions must include all core subjects.
 * - Created with status 'pending_approval'; parent must approve before payment.
 */
export async function createRegistrationRequest(
  studentId: string,
  data: RequestRegistrationType,
  requestedBy: string
) {
  // GRADE-003: Graduated students cannot register for new subjects
  if (await isGraduated(studentId)) {
    throw new Error('Graduated students cannot submit new registration requests');
  }

  // AUTH-003/REG-001: A student request requires a parent to approve it.
  // Without an approved link, the request would sit in 'pending_approval'
  // until the session auto-expires it — a silent hang for orphaned students.
  // REG-007 covers exceptional cases via admin override.
  if (!(await studentHasApprovedParent(studentId))) {
    throw new Error(
      'You need an approved parent link before submitting a registration request. Ask a parent to link to your account (or contact the admin if you have no guardian).'
    );
  }

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, data.sessionId),
  });
  if (!sess) throw new Error('Session not found');
  // Hook 2 (§6.3): a deadline-extension exception treats a closed window
  // as open for this student
  if (sess.status !== 'active' && !(await hasDeadlineExtension(studentId, sess.id))) {
    throw new Error('Registration window is not open');
  }

  const subjects = await db.query.subject.findMany({
    where: (s, { eq, and, inArray }) =>
      and(eq(s.isActive, true), inArray(s.id, data.subjectIds)),
  });
  if (subjects.length !== data.subjectIds.length) {
    throw new Error('One or more subjects are invalid or inactive');
  }

  const alreadyRegistered = await getExistingRegistrationSubjectIds(
    studentId,
    data.sessionId
  );
  const duplicates = data.subjectIds.filter((id) => alreadyRegistered.includes(id));
  if (duplicates.length > 0) {
    throw new Error('Some subjects are already registered for this session');
  }

  const coreCheck = await validateCoreSubjectRequirements(
    studentId,
    data.sessionId,
    data.subjectIds
  );
  if (!coreCheck.valid) {
    const names = coreCheck.missingCoreSubjects.map((s) => s.name).join(', ');
    throw new Error(
      `Grade 10 June session requires all core subjects. Missing: ${names}`
    );
  }

  const prepared = await prepareRegistrationInputs(
    studentId,
    sess,
    subjects,
    data.subjectOptions
  );

  const records = subjects.map((sub) => {
    const p = prepared.get(sub.id)!;
    return {
      id: randomUUID(),
      studentId,
      sessionId: data.sessionId,
      subjectId: sub.id,
      priceAtRegistration: p.pricing.total,
      courseFeeAtRegistration: p.pricing.courseFee,
      registrationFeeAtRegistration: p.pricing.registrationFee,
      isRetake: p.isRetake,
      takenOutsideSchool: p.pricing.isOutsideSchool,
      teacherId: p.teacherId,
      wasCoreAtRegistration: sub.isCore,
      status: 'pending_approval' as const,
      requestedBy,
    };
  });

  const inserted = await db.insert(registration).values(records).returning();

  // NOT-003: Notify all linked parents of the new request (fire-and-forget)
  {
    const studentUser = await db.query.user.findFirst({
      where: (u, { eq: eqOp }) => eqOp(u.id, studentId),
      columns: { name: true },
    });
    const totalCost = records.reduce((sum, r) => sum + r.priceAtRegistration, 0);

    notifyRegistrationRequestReceived({
      studentId,
      studentName: studentUser?.name ?? 'Student',
      sessionName: sess.name,
      subjects: subjects.map((sub) => ({
        name: sub.name,
        price: prepared.get(sub.id)!.pricing.total,
      })),
      totalCost,
    }).catch((err) => console.error('[notification] NOT-003 failed:', err));
  }

  return inserted;
}

/**
 * Parent directly registers subjects for one of their linked children.
 *
 * - Parent must have an approved link to the student.
 * - Session must be active.
 * - No duplicate registrations.
 * - Core subject validation applies for Grade 10 June.
 * - Created with status 'pending_payment' (auto-approved by parent).
 */
export async function createDirectRegistration(
  parentId: string,
  data: DirectRegistrationType
) {
  const linked = await validateParentStudentLink(parentId, data.studentId);
  if (!linked) throw new Error('You are not linked to this student');

  // GRADE-003: Graduated students cannot be registered for new subjects
  if (await isGraduated(data.studentId)) {
    throw new Error('Graduated students cannot be registered for new subjects');
  }

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, data.sessionId),
  });
  if (!sess) throw new Error('Session not found');
  // Hook 2 (§6.3): a deadline-extension exception treats a closed window
  // as open for this student
  if (sess.status !== 'active' && !(await hasDeadlineExtension(data.studentId, sess.id))) {
    throw new Error('Registration window is not open');
  }

  const subjects = await db.query.subject.findMany({
    where: (s, { eq, and, inArray }) =>
      and(eq(s.isActive, true), inArray(s.id, data.subjectIds)),
  });
  if (subjects.length !== data.subjectIds.length) {
    throw new Error('One or more subjects are invalid or inactive');
  }

  const alreadyRegistered = await getExistingRegistrationSubjectIds(
    data.studentId,
    data.sessionId
  );
  const duplicates = data.subjectIds.filter((id) => alreadyRegistered.includes(id));
  if (duplicates.length > 0) {
    throw new Error('Some subjects are already registered for this session');
  }

  const coreCheck = await validateCoreSubjectRequirements(
    data.studentId,
    data.sessionId,
    data.subjectIds
  );
  if (!coreCheck.valid) {
    const names = coreCheck.missingCoreSubjects.map((s) => s.name).join(', ');
    throw new Error(
      `Grade 10 June session requires all core subjects. Missing: ${names}`
    );
  }

  const prepared = await prepareRegistrationInputs(
    data.studentId,
    sess,
    subjects,
    data.subjectOptions
  );

  const now = new Date();
  const records = subjects.map((sub) => {
    const p = prepared.get(sub.id)!;
    return {
      id: randomUUID(),
      studentId: data.studentId,
      sessionId: data.sessionId,
      subjectId: sub.id,
      priceAtRegistration: p.pricing.total,
      courseFeeAtRegistration: p.pricing.courseFee,
      registrationFeeAtRegistration: p.pricing.registrationFee,
      isRetake: p.isRetake,
      takenOutsideSchool: p.pricing.isOutsideSchool,
      teacherId: p.teacherId,
      wasCoreAtRegistration: sub.isCore,
      status: 'pending_payment' as const,
      requestedBy: parentId,
      approvedBy: parentId,
      approvedAt: now,
    };
  });

  const created = await db.insert(registration).values(records).returning();

  // REG-003: Notify student via in-app + email that their parent registered
  // subjects for them. Fire-and-forget so registration creation never fails
  // because of a notification/email hiccup.
  notifyDirectRegistrationCreated({
    studentId: data.studentId,
    parentId,
    sessionName: sess.name,
    subjects: subjects.map((sub) => ({
      name: sub.name,
      price: prepared.get(sub.id)!.pricing.total,
    })),
    totalCost: records.reduce((sum, r) => sum + r.priceAtRegistration, 0),
  }).catch((err) => console.error('[notification] REG-003 direct student notify failed:', err));

  return created;
}

/**
 * Parent approves one or more pending registration requests from their child.
 *
 * Strict all-or-nothing semantics:
 * - Every input ID must resolve to an existing registration
 *   (no silent phantom-ID drops).
 * - Every registration must be in 'pending_approval' status.
 * - Parent must be linked (approved) to every involved student.
 * - The guarded UPDATE is wrapped in a transaction; if any row is no
 *   longer in 'pending_approval' (concurrent approve/reject/expire),
 *   the whole operation aborts so the UI never navigates to checkout
 *   with IDs that weren't actually transitioned.
 */
export async function approveRegistrationRequest(
  data: ApproveRegistrationsType,
  parentId: string
) {
  const regs = await db.query.registration.findMany({
    where: (r, { inArray }) => inArray(r.id, data.registrationIds),
  });

  if (regs.length === 0) throw new Error('No registrations found');
  if (regs.length !== data.registrationIds.length) {
    throw new Error('One or more registration IDs are invalid');
  }

  const notPending = regs.filter((r) => r.status !== 'pending_approval');
  if (notPending.length > 0) {
    throw new Error('One or more registrations are not awaiting approval');
  }

  // GRADE-003: Cannot approve registrations for a graduated student
  const firstStudentId = regs[0]!.studentId;
  if (await isGraduated(firstStudentId)) {
    throw new Error('Cannot approve registrations for a graduated student');
  }

  // Verify the session is still active
  const sessionId = regs[0]!.sessionId;
  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq: eqOp }) => eqOp(s.id, sessionId),
    columns: { status: true },
  });
  if (!sess || sess.status !== 'active') {
    throw new Error('Registration window is closed');
  }

  const studentIds = [...new Set(regs.map((r) => r.studentId))];
  for (const studentId of studentIds) {
    const linked = await validateParentStudentLink(parentId, studentId);
    if (!linked) {
      throw new Error(
        'You are not authorized to approve registrations for one or more students'
      );
    }
  }

  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(registration)
      .set({
        status: 'pending_payment',
        approvedBy: parentId,
        approvedAt: now,
        approvalComments: data.comments ?? null,
        updatedAt: now,
      })
      .where(
        and(
          inArray(registration.id, data.registrationIds),
          eq(registration.status, 'pending_approval'),
        )
      )
      .returning();

    if (rows.length !== data.registrationIds.length) {
      throw new Error(
        'One or more registrations were concurrently processed. Please refresh and try again.'
      );
    }
    return rows;
  });

  // NOT-004: Notify each affected student that their request was approved (fire-and-forget)
  {
    const sessionId = regs[0]?.sessionId;
    const sessionRecord = sessionId
      ? await db.query.registrationSession.findFirst({
          where: (s, { eq: eqOp }) => eqOp(s.id, sessionId),
          columns: { name: true },
        })
      : null;
    const sessionName = sessionRecord?.name ?? 'the registration session';

    for (const sId of studentIds) {
      notifyRegistrationDecision({
        studentId: sId,
        parentId,
        sessionName,
        approved: true,
        comments: data.comments,
      }).catch((err) => console.error('[notification] NOT-004 (approve) failed:', err));
    }
  }

  return updated;
}

/**
 * Parent reverts unpaid approvals back to pending approval.
 *
 * This is only allowed before checkout creates a payment link. Once a
 * registration is attached to any payment row, payment/escrow state may exist
 * elsewhere and the approval cannot be safely moved backward.
 */
export async function revertApprovedRegistrationRequest(
  data: RevertApprovedRegistrationsType,
  parentId: string
) {
  const regs = await db.query.registration.findMany({
    where: (r, { inArray }) => inArray(r.id, data.registrationIds),
  });

  if (regs.length === 0) throw new Error('No registrations found');
  if (regs.length !== data.registrationIds.length) {
    throw new Error('One or more registration IDs are invalid');
  }

  const notPendingPayment = regs.filter((r) => r.status !== 'pending_payment');
  if (notPendingPayment.length > 0) {
    throw new Error('Only unpaid pending-payment registrations can be reverted');
  }

  const notOriginalStudentRequests = regs.filter((r) =>
    r.requestedBy !== r.studentId ||
    r.approvalComments?.startsWith('Swap from registration') ||
    r.approvalComments?.startsWith('Direct swap') ||
    r.approvalComments?.startsWith('[ADMIN OVERRIDE]')
  );
  if (notOriginalStudentRequests.length > 0) {
    throw new Error('Only normal student registration approvals can be reverted');
  }

  const linkedPayments = await db.query.paymentRegistration.findMany({
    where: (pr, { inArray }) => inArray(pr.registrationId, data.registrationIds),
    columns: { registrationId: true },
  });
  if (linkedPayments.length > 0) {
    throw new Error('One or more registrations already have a payment in progress and cannot be reverted');
  }

  const studentIds = [...new Set(regs.map((r) => r.studentId))];
  for (const studentId of studentIds) {
    const linked = await validateParentStudentLink(parentId, studentId);
    if (!linked) {
      throw new Error(
        'You are not authorized to revert approvals for one or more students'
      );
    }
  }

  const updated = await db.transaction(async (tx) => {
    const paymentLinksInTx = await tx.query.paymentRegistration.findMany({
      where: (pr, { inArray }) => inArray(pr.registrationId, data.registrationIds),
      columns: { registrationId: true },
    });
    if (paymentLinksInTx.length > 0) {
      throw new Error('One or more registrations already have a payment in progress and cannot be reverted');
    }

    const rows = await tx
      .update(registration)
      .set({
        status: 'pending_approval',
        approvedBy: null,
        approvedAt: null,
        approvalComments: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(registration.id, data.registrationIds),
          eq(registration.status, 'pending_payment'),
        )
      )
      .returning();

    if (rows.length !== data.registrationIds.length) {
      throw new Error(
        'One or more registrations were concurrently processed. Please refresh and try again.'
      );
    }

    return rows;
  });

  return updated;
}

/**
 * Parent rejects one or more pending registration requests.
 *
 * - All registrations must be in 'pending_approval' status.
 * - Parent must be linked to the student.
 * - A comment is required (enforced by the schema) to explain the rejection.
 * - Registrations move to 'rejected' (terminal state).
 */
export async function rejectRegistrationRequest(
  data: RejectRegistrationsType,
  parentId: string
) {
  const regs = await db.query.registration.findMany({
    where: (r, { inArray }) => inArray(r.id, data.registrationIds),
  });

  if (regs.length === 0) throw new Error('No registrations found');
  if (regs.length !== data.registrationIds.length) {
    throw new Error('One or more registration IDs are invalid');
  }

  const notPending = regs.filter((r) => r.status !== 'pending_approval');
  if (notPending.length > 0) {
    throw new Error('One or more registrations are not awaiting approval');
  }

  // Verify the session is still active (consistency with approval path)
  const sessionId = regs[0]!.sessionId;
  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq: eqOp }) => eqOp(s.id, sessionId),
    columns: { status: true },
  });
  if (!sess || sess.status !== 'active') {
    throw new Error('Registration window is closed');
  }

  const studentIds = [...new Set(regs.map((r) => r.studentId))];
  for (const studentId of studentIds) {
    const linked = await validateParentStudentLink(parentId, studentId);
    if (!linked) {
      throw new Error(
        'You are not authorized to reject registrations for one or more students'
      );
    }
  }

  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(registration)
      .set({
        status: 'rejected',
        approvedBy: parentId,
        approvedAt: now,
        approvalComments: data.comments,
        updatedAt: now,
      })
      .where(
        and(
          inArray(registration.id, data.registrationIds),
          eq(registration.status, 'pending_approval'),
        )
      )
      .returning();

    if (rows.length !== data.registrationIds.length) {
      throw new Error(
        'One or more registrations were concurrently processed. Please refresh and try again.'
      );
    }
    return rows;
  });

  // NOT-004: Notify each affected student that their request was rejected (fire-and-forget)
  {
    const sessionId = regs[0]?.sessionId;
    const sessionRecord = sessionId
      ? await db.query.registrationSession.findFirst({
          where: (s, { eq: eqOp }) => eqOp(s.id, sessionId),
          columns: { name: true },
        })
      : null;
    const sessionName = sessionRecord?.name ?? 'the registration session';

    for (const sId of studentIds) {
      notifyRegistrationDecision({
        studentId: sId,
        parentId,
        sessionName,
        approved: false,
        comments: data.comments,
      }).catch((err) => console.error('[notification] NOT-004 (reject) failed:', err));
    }
  }

  return updated;
}

/**
 * Admin overrides the parent approval requirement (REG-007).
 *
 * Used for exceptional cases: orphaned students, legal guardianship, etc.
 * Registrations are created directly in 'pending_payment' status.
 * The admin's reason is stored in approvalComments with an [ADMIN OVERRIDE] prefix,
 * providing a clear audit trail without requiring a separate audit table.
 */
export async function adminOverrideApproval(
  data: AdminOverrideApprovalType,
  adminId: string
) {
  const student = await db.query.user.findFirst({
    where: (u, { eq: eqOp }) => eqOp(u.id, data.studentId),
    columns: { id: true, grade: true, role: true },
  });
  if (!student) throw new Error('Student not found');
  // GRADE-003: Only students with null grade are graduated; admins/parents also have null grade
  if (student.role === 'student' && student.grade === null) {
    throw new Error('Cannot register for a graduated student');
  }

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, data.sessionId),
  });
  if (!sess) throw new Error('Session not found');
  // Hook 2 (§6.3): a deadline-extension exception treats a closed window
  // as open for this student
  if (sess.status !== 'active' && !(await hasDeadlineExtension(data.studentId, sess.id))) {
    throw new Error('Registration window is not open');
  }

  const subjects = await db.query.subject.findMany({
    where: (s, { eq, and, inArray }) =>
      and(eq(s.isActive, true), inArray(s.id, data.subjectIds)),
  });
  if (subjects.length !== data.subjectIds.length) {
    throw new Error('One or more subjects are invalid or inactive');
  }

  const alreadyRegistered = await getExistingRegistrationSubjectIds(
    data.studentId,
    data.sessionId
  );
  const duplicates = data.subjectIds.filter((id) => alreadyRegistered.includes(id));
  if (duplicates.length > 0) {
    throw new Error('Some subjects are already registered for this session');
  }

  // CORE-003: Admin override bypasses parent approval (REG-007), NOT the
  // Grade 10 June core-subject curriculum rule. Core requirements must
  // still be satisfied — the admin provides the subject list that will
  // be registered, which for Grade 10 June must include the subject IDs
  // of every active core subject not already registered for this session.
  const coreCheck = await validateCoreSubjectRequirements(
    data.studentId,
    data.sessionId,
    [...data.subjectIds, ...alreadyRegistered]
  );
  if (!coreCheck.valid) {
    const names = coreCheck.missingCoreSubjects.map((s) => s.name).join(', ');
    throw new Error(
      `Grade 10 June session requires all core subjects. Missing: ${names}`
    );
  }

  // V3: same pricing/level/teacher pipeline as normal registrations.
  // (The school-fee gate applies to admin overrides too — an admin can
  // grant a fee_waiver exception when that's the intent.)
  const prepared = await prepareRegistrationInputs(
    data.studentId,
    sess,
    subjects,
    undefined
  );

  const now = new Date();
  const records = subjects.map((sub) => {
    const p = prepared.get(sub.id)!;
    return {
      id: randomUUID(),
      studentId: data.studentId,
      sessionId: data.sessionId,
      subjectId: sub.id,
      priceAtRegistration: p.pricing.total,
      courseFeeAtRegistration: p.pricing.courseFee,
      registrationFeeAtRegistration: p.pricing.registrationFee,
      isRetake: p.isRetake,
      takenOutsideSchool: p.pricing.isOutsideSchool,
      wasCoreAtRegistration: sub.isCore,
      status: 'pending_payment' as const,
      requestedBy: adminId,
      approvedBy: adminId,
      approvedAt: now,
      approvalComments: `[ADMIN OVERRIDE] ${data.reason}`,
    };
  });

  return db.insert(registration).values(records).returning();
}

/**
 * Get a single registration by ID, including subject and session details.
 */
export async function getRegistrationById(id: string) {
  return db.query.registration.findFirst({
    where: (r, { eq }) => eq(r.id, id),
    with: { subject: true, session: true },
  });
}

/**
 * Get registrations with optional filters.
 *
 * Includes subject and session details for each registration.
 * The caller (route handler) is responsible for scoping by studentId
 * based on the authenticated user's role.
 */
export async function getRegistrations(filters: ListRegistrationsQueryType & {
  studentIds?: string[]; // Used when a parent queries for multiple children
}) {
  const rows = await db.query.registration.findMany({
    where: (r, { eq, and, inArray }) => {
      const conditions = [];
      if (filters.studentId) {
        conditions.push(eq(r.studentId, filters.studentId));
      } else if (filters.studentIds && filters.studentIds.length > 0) {
        conditions.push(inArray(r.studentId, filters.studentIds));
      }
      if (filters.sessionId) conditions.push(eq(r.sessionId, filters.sessionId));
      if (filters.status)    conditions.push(eq(r.status, filters.status));
      return conditions.length > 0 ? and(...conditions) : undefined;
    },
    with: {
      subject: true,
      session: true,
      student: {
        columns: { id: true, name: true, email: true, grade: true, studentId: true },
      },
    },
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  });

  // M-18: Attach a `hasPendingChangeRequest` flag so the registrations UI
  // can correctly disable the Drop/Swap actions when an earlier request
  // is still waiting on parent approval. The DB-level partial unique
  // index already prevents a second pending change request from being
  // inserted, but the UI previously let users click through and hit an
  // error — this flag lets us grey out the buttons instead.
  if (rows.length === 0) return rows.map((r) => ({ ...r, hasPendingChangeRequest: false }));

  const regIds = rows.map((r) => r.id);
  const pendingCRs = await db.query.changeRequest.findMany({
    where: (cr, { inArray: inArr, and: andOp, eq: eqOp }) =>
      andOp(inArr(cr.registrationId, regIds), eqOp(cr.status, 'pending_approval')),
    columns: { registrationId: true },
  });
  const pendingSet = new Set(pendingCRs.map((c) => c.registrationId));

  return rows.map((r) => ({
    ...r,
    hasPendingChangeRequest: pendingSet.has(r.id),
  }));
}

/**
 * Get all pending approval requests from all students linked to a parent.
 *
 * Returns registrations in 'pending_approval' status across all linked
 * children, ordered oldest-first so parents see the most urgent items first.
 */
export async function getPendingApprovalRequests(parentId: string) {
  const linkedStudentIds = await getLinkedStudentIds(parentId);
  if (linkedStudentIds.length === 0) return [];

  return db.query.registration.findMany({
    where: (r, { eq, and, inArray }) =>
      and(
        inArray(r.studentId, linkedStudentIds),
        eq(r.status, 'pending_approval')
      ),
    with: {
      subject: true,
      session: true,
      student: {
        columns: { id: true, name: true, email: true, grade: true, studentId: true },
      },
    },
    orderBy: (r, { asc }) => [asc(r.createdAt)],
  });
}

/**
 * Get the full registration history for a student across all sessions.
 *
 * Returns a rich audit trail including:
 * - Full subject and session details
 * - Who requested and who approved/rejected (with name)
 * - All change requests (drop/swap) that were made against each registration
 * - Payment registrations to surface payment status context
 *
 * Used for the /registrations/history view.
 */
export async function getRegistrationHistory(studentId: string) {
  return db.query.registration.findMany({
    where: (r, { eq }) => eq(r.studentId, studentId),
    with: {
      subject: {
        columns: {
          id: true,
          name: true,
          code: true,
          council: true,
          isCore: true,
        },
      },
      session: {
        columns: {
          id: true,
          name: true,
          sessionType: true,
          status: true,
          startDate: true,
          endDate: true,
        },
      },
      requestedByUser: {
        columns: { id: true, name: true, role: true },
      },
      approvedByUser: {
        columns: { id: true, name: true, role: true },
      },
      changeRequests: {
        with: {
          newSubject: {
            columns: { id: true, name: true, code: true },
          },
          requestedByUser: {
            columns: { id: true, name: true },
          },
          approvedByUser: {
            columns: { id: true, name: true },
          },
        },
        orderBy: (cr, { asc }) => [asc(cr.createdAt)],
      },
    },
    orderBy: (r, { desc, asc }) => [
      desc(r.createdAt),
    ],
  });
}
