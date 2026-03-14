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
  RejectRegistrationsType,
  AdminOverrideApprovalType,
  ListRegistrationsQueryType,
} from '@repo/validations';
import {
  notifyRegistrationRequestReceived,
  notifyRegistrationDecision,
} from './notification.services';
import { isGraduated } from './grade.services';

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Resolve the price to charge for a subject at the time of registration.
 * Uses customPrice when the subject is not offered at school; falls back
 * to priceInSchool as a safety net if customPrice was not set.
 */
function resolveRegistrationPrice(sub: {
  isOfferedAtSchool: boolean;
  priceInSchool: number;
  customPrice: number | null;
}): number {
  if (sub.isOfferedAtSchool) return sub.priceInSchool;
  return sub.customPrice ?? sub.priceInSchool;
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
        notInArray(r.status, ['dropped', 'rejected'])
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

  if (!studentRecord || !sessionRecord) {
    return { valid: true, missingCoreSubjects: [] };
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
 * For Grade 10 June sessions, core subjects are always included in the result
 * even if already registered (they will be filtered/locked on the client).
 */
export async function getAvailableSubjects(
  studentId: string,
  sessionId: string
) {
  const alreadyRegistered = await getExistingRegistrationSubjectIds(
    studentId,
    sessionId
  );

  return db.query.subject.findMany({
    where: (s, { eq, and, notInArray }) => {
      const conditions = [eq(s.isActive, true)];
      if (alreadyRegistered.length > 0) {
        conditions.push(notInArray(s.id, alreadyRegistered));
      }
      return and(...conditions);
    },
    orderBy: (s, { asc }) => [asc(s.name)],
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

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, data.sessionId),
  });
  if (!sess) throw new Error('Session not found');
  if (sess.status !== 'active') throw new Error('Registration window is not open');

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

  const records = subjects.map((sub) => ({
    id: randomUUID(),
    studentId,
    sessionId: data.sessionId,
    subjectId: sub.id,
    priceAtRegistration: resolveRegistrationPrice(sub),
    status: 'pending_approval' as const,
    requestedBy,
  }));

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
        price: resolveRegistrationPrice(sub),
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
  if (sess.status !== 'active') throw new Error('Registration window is not open');

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

  const now = new Date();
  const records = subjects.map((sub) => ({
    id: randomUUID(),
    studentId: data.studentId,
    sessionId: data.sessionId,
    subjectId: sub.id,
    priceAtRegistration: resolveRegistrationPrice(sub),
    status: 'pending_payment' as const,
    requestedBy: parentId,
    approvedBy: parentId,
    approvedAt: now,
  }));

  return db.insert(registration).values(records).returning();
}

/**
 * Parent approves one or more pending registration requests from their child.
 *
 * - All registrations must be in 'pending_approval' status.
 * - Parent must be linked (approved) to the student for each registration.
 * - Registrations move to 'pending_payment' status.
 */
export async function approveRegistrationRequest(
  data: ApproveRegistrationsType,
  parentId: string
) {
  const regs = await db.query.registration.findMany({
    where: (r, { inArray }) => inArray(r.id, data.registrationIds),
  });

  if (regs.length === 0) throw new Error('No registrations found');

  const notPending = regs.filter((r) => r.status !== 'pending_approval');
  if (notPending.length > 0) {
    throw new Error('One or more registrations are not awaiting approval');
  }

  // Validate parent link for every unique student in this batch
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
  const updated = await db
    .update(registration)
    .set({
      status: 'pending_payment',
      approvedBy: parentId,
      approvedAt: now,
      approvalComments: data.comments ?? null,
      updatedAt: now,
    })
    .where(inArray(registration.id, data.registrationIds))
    .returning();

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

  const notPending = regs.filter((r) => r.status !== 'pending_approval');
  if (notPending.length > 0) {
    throw new Error('One or more registrations are not awaiting approval');
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
  const updated = await db
    .update(registration)
    .set({
      status: 'rejected',
      approvedBy: parentId,
      approvedAt: now,
      approvalComments: data.comments,
      updatedAt: now,
    })
    .where(inArray(registration.id, data.registrationIds))
    .returning();

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
  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, data.sessionId),
  });
  if (!sess) throw new Error('Session not found');
  if (sess.status !== 'active') throw new Error('Registration window is not open');

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

  const now = new Date();
  const records = subjects.map((sub) => ({
    id: randomUUID(),
    studentId: data.studentId,
    sessionId: data.sessionId,
    subjectId: sub.id,
    priceAtRegistration: resolveRegistrationPrice(sub),
    status: 'pending_payment' as const,
    requestedBy: adminId,
    approvedBy: adminId,
    approvedAt: now,
    approvalComments: `[ADMIN OVERRIDE] ${data.reason}`,
  }));

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
  return db.query.registration.findMany({
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
          subjectCode: true,
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
            columns: { id: true, name: true, subjectCode: true },
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
