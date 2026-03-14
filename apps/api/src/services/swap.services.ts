/**
 * Swap / Change Request Service
 *
 * Business logic for student drop/swap requests and parent approval workflow
 * (SWAP-001 to SWAP-007).
 *
 * Two parallel workflows:
 * 1. Student-initiated (SWAP-001, SWAP-002):
 *    - Student creates a change request → pending_approval
 *    - Parent approves → financials processed, registration updated (SWAP-003)
 *    - Parent rejects → dismissed, no financial impact (SWAP-003)
 *
 * 2. Parent direct (SWAP-004):
 *    - Parent directly drops or swaps (no change_request record created)
 *    - Immediate financial processing via escrow credit/debit
 *
 * Key invariants (SWAP-005, SWAP-006):
 * - Core subjects (Grade 10 June session) cannot be dropped or swapped
 * - Actions only allowed when the session window is active
 * - Only confirmed registrations can be changed
 * - At most one pending_approval change request per registration (DB constraint)
 *
 * Financial logic for approved drop:
 * - Full priceAtRegistration credited to student's escrow
 * - Registration status → 'dropped'
 *
 * Financial logic for approved swap:
 * - Full priceAtRegistration of the dropped registration credited to escrow
 * - New registration created at 'pending_payment' for the new subject
 *   (parent applies escrow credit at checkout, or pays the full amount)
 *
 * OI-009 resolved: executeDirectDrop and executeDirectSwap use DB transactions.
 * The change request approval flow also runs inside a DB transaction.
 *
 * All DB imports come from @repo/db — never from drizzle-orm directly.
 * Escrow operations imported from escrow.services.ts (single source of truth).
 */

import {
  db,
  registration,
  registrationSession,
  changeRequest,
  subject,
  parentStudentLink,
  user,
  eq,
  and,
  inArray,
} from '@repo/db';
import { randomUUID } from 'crypto';
import type {
  RequestDropType,
  RequestSwapType,
  DirectDropType,
  DirectSwapType,
  ApproveChangeRequestType,
  RejectChangeRequestType,
  ChangeRequestsQueryType,
} from '@repo/validations';
import { creditEscrow, getEscrowBalance } from './escrow.services';
import {
  notifyDropSwapRequestReceived,
  notifyDropSwapProcessed,
  notifyEscrowBalanceChanged,
} from './notification.services';
import { isGraduated } from './grade.services';

// ─── Constants ────────────────────────────────────────────────────────────────

// Subjects required for Grade 10 June sessions — cannot be dropped or swapped
const CORE_SUBJECT_NAMES = [
  'English Language',
  'Arabic Language',
  'Mathematics',
  'Islamic Education',
];

// ─── Internal Helpers ─────────────────────────────────────────────────────────

async function validateParentStudentLink(
  parentId: string,
  studentId: string
): Promise<boolean> {
  const link = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and }) =>
      and(eq(l.parentId, parentId), eq(l.studentId, studentId), eq(l.status, 'approved')),
    columns: { id: true },
  });
  return !!link;
}

/**
 * Resolves the price for a subject following the same logic as registration:
 * - Not offered at school (or no school price) → use customPrice
 * - Offered at school → use priceInSchool
 */
function resolveSubjectPrice(sub: {
  isOfferedAtSchool: boolean | null;
  priceInSchool: number | null;
  customPrice: number | null;
}): number {
  if (!sub.isOfferedAtSchool || sub.priceInSchool == null) {
    return sub.customPrice ?? 0;
  }
  return sub.priceInSchool;
}

/**
 * Shared validation for any change to a confirmed registration.
 * Returns the registration with its session and subject data.
 *
 * Enforces:
 * - Registration exists and is 'confirmed'
 * - userId is the student (for student-initiated) or session owner check is skipped (for parent-direct)
 * - Session is currently 'active'
 * - Subject is NOT a core subject in Grade 10 June sessions (SWAP-005)
 * - No existing pending_approval change request for this registration
 */
async function validateChangeEligibility(
  registrationId: string,
  studentId: string,
  checkOwnership: boolean = true
) {
  const reg = await db.query.registration.findFirst({
    where: (r, { eq }) => eq(r.id, registrationId),
    with: {
      session: {
        columns: {
          id: true,
          status: true,
          sessionType: true,
        },
      },
      subject: {
        columns: {
          id: true,
          name: true,
          isCore: true,
          isOfferedAtSchool: true,
          priceInSchool: true,
          customPrice: true,
        },
      },
    },
  });

  if (!reg) throw new Error('Registration not found');

  if (checkOwnership && reg.studentId !== studentId) {
    throw new Error('You do not own this registration');
  }

  if (reg.status !== 'confirmed') {
    throw new Error(`Only confirmed registrations can be changed. Current status: ${reg.status}`);
  }

  if (!reg.session || reg.session.status !== 'active') {
    throw new Error('Changes can only be made while the registration window is open (SWAP-006)');
  }

  // Fetch student to check grade for core subject validation
  const studentRecord = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.id, reg.studentId),
    columns: { grade: true },
  });

  // Core subject check: Grade 10 June session core subjects are locked
  if (
    studentRecord?.grade === 10 &&
    reg.session.sessionType === 'june' &&
    reg.subject.isCore
  ) {
    throw new Error('Core subjects cannot be dropped or swapped for Grade 10 students (SWAP-005)');
  }

  // Check no existing pending change request for this registration
  const pending = await db.query.changeRequest.findFirst({
    where: (cr, { eq, and }) =>
      and(eq(cr.registrationId, registrationId), eq(cr.status, 'pending_approval')),
    columns: { id: true },
  });

  if (pending) {
    throw new Error('A pending change request already exists for this registration. Cancel it before submitting a new one.');
  }

  return { reg, studentGrade: studentRecord?.grade ?? null };
}

/**
 * Validate a new subject for a swap:
 * - Subject exists and is active
 * - Student is not already actively registered for it in the same session
 */
async function validateNewSubjectForSwap(
  studentId: string,
  sessionId: string,
  newSubjectId: string,
  currentRegistrationId: string
) {
  const newSub = await db.query.subject.findFirst({
    where: (s, { eq }) => eq(s.id, newSubjectId),
    columns: {
      id: true,
      name: true,
      isActive: true,
      isOfferedAtSchool: true,
      priceInSchool: true,
      customPrice: true,
    },
  });

  if (!newSub) throw new Error('New subject not found');
  if (!newSub.isActive) throw new Error('This subject is no longer available for registration');

  // Check for existing active registration for this subject in the same session
  const conflict = await db.query.registration.findFirst({
    where: (r, { eq, and, notInArray }) =>
      and(
        eq(r.studentId, studentId),
        eq(r.sessionId, sessionId),
        eq(r.subjectId, newSubjectId),
        notInArray(r.status, ['dropped', 'rejected'])
      ),
    columns: { id: true },
  });

  if (conflict) {
    throw new Error('You are already registered for this subject in the current session');
  }

  return newSub;
}

// ─── Student: Create Requests ─────────────────────────────────────────────────

/**
 * Student requests to drop a confirmed registration (SWAP-001).
 * Creates a pending_approval change_request record.
 * The full priceAtRegistration will be credited to escrow upon parent approval.
 */
export async function createDropRequest(
  registrationId: string,
  data: RequestDropType,
  requestedBy: string
) {
  // GRADE-003: Graduated students cannot create new change requests
  if (await isGraduated(requestedBy)) {
    throw new Error('Graduated students cannot submit drop requests');
  }

  const { reg } = await validateChangeEligibility(registrationId, requestedBy, true);

  const [request] = await db
    .insert(changeRequest)
    .values({
      id: randomUUID(),
      registrationId,
      type: 'drop',
      requestedBy,
      reason: data.reason,
      newSubjectId: null,
      // For drops: priceAtRequest = full amount to credit back
      priceAtRequest: reg.priceAtRegistration,
      // Dropping means student gets the full price back (negative = credit to student)
      priceDifference: -reg.priceAtRegistration,
      status: 'pending_approval',
    })
    .returning();

  // NOT-006: Notify linked parents of the drop request (fire-and-forget)
  {
    const studentUser = await db.query.user.findFirst({
      where: (u, { eq: eqOp }) => eqOp(u.id, reg.studentId),
      columns: { name: true },
    });

    notifyDropSwapRequestReceived({
      studentId:     reg.studentId,
      studentName:   studentUser?.name ?? 'Student',
      changeType:    'drop',
      subjectName:   reg.subject.name,
      financialImpact: `EGP ${reg.priceAtRegistration.toFixed(2)} will be credited to your child's escrow upon approval`,
      reason:        data.reason,
      changeRequestId: request!.id,
    }).catch((err) => console.error('[notification] NOT-006 (drop) failed:', err));
  }

  return request!;
}

/**
 * Student requests to swap a confirmed registration for another subject (SWAP-002).
 * Creates a pending_approval change_request with price difference calculated.
 * Parent sees the financial impact before deciding to approve.
 */
export async function createSwapRequest(
  registrationId: string,
  data: RequestSwapType,
  requestedBy: string
) {
  // GRADE-003: Graduated students cannot create new change requests
  if (await isGraduated(requestedBy)) {
    throw new Error('Graduated students cannot submit swap requests');
  }

  const { reg } = await validateChangeEligibility(registrationId, requestedBy, true);

  const newSub = await validateNewSubjectForSwap(
    reg.studentId,
    reg.sessionId,
    data.newSubjectId,
    registrationId
  );

  const newSubjectPrice = resolveSubjectPrice(newSub);
  const priceDifference = newSubjectPrice - reg.priceAtRegistration;

  const [request] = await db
    .insert(changeRequest)
    .values({
      id: randomUUID(),
      registrationId,
      type: 'swap',
      requestedBy,
      reason: data.reason,
      newSubjectId: data.newSubjectId,
      priceAtRequest: newSubjectPrice,
      priceDifference,
      status: 'pending_approval',
    })
    .returning();

  // NOT-006: Notify linked parents of the swap request (fire-and-forget)
  {
    const studentUser = await db.query.user.findFirst({
      where: (u, { eq: eqOp }) => eqOp(u.id, reg.studentId),
      columns: { name: true },
    });

    const impactText =
      priceDifference === 0
        ? 'No additional charge'
        : priceDifference > 0
          ? `EGP ${priceDifference.toFixed(2)} additional payment will be required`
          : `EGP ${Math.abs(priceDifference).toFixed(2)} will be credited to your child's escrow`;

    notifyDropSwapRequestReceived({
      studentId:      reg.studentId,
      studentName:    studentUser?.name ?? 'Student',
      changeType:     'swap',
      subjectName:    reg.subject.name,
      newSubjectName: newSub.name,
      financialImpact: impactText,
      reason:         data.reason,
      changeRequestId: request!.id,
    }).catch((err) => console.error('[notification] NOT-006 (swap) failed:', err));
  }

  return request!;
}

// ─── Parent: Approve / Reject ─────────────────────────────────────────────────

/**
 * Parent approves a pending change request (SWAP-003).
 *
 * Runs inside a DB transaction (OI-009):
 *
 * For drop:
 * 1. Change request → 'approved'
 * 2. Registration → 'dropped'
 * 3. Escrow credited with the full priceAtRegistration
 *
 * For swap:
 * 1. Change request → 'approved'
 * 2. Original registration → 'dropped'
 * 3. Escrow credited with the full priceAtRegistration of the dropped registration
 * 4. New registration created at 'pending_payment' for the new subject
 *    (parent applies escrow credit at checkout to cover the new subject)
 */
export async function approveChangeRequest(
  changeRequestId: string,
  data: ApproveChangeRequestType,
  parentId: string
) {
  const cr = await db.query.changeRequest.findFirst({
    where: (c, { eq }) => eq(c.id, changeRequestId),
    with: {
      registration: {
        with: {
          session: { columns: { id: true, status: true, sessionType: true } },
          subject: { columns: { id: true, name: true } },
        },
      },
      newSubject: { columns: { id: true, name: true } },
    },
  });

  if (!cr) throw new Error('Change request not found');
  if (cr.status !== 'pending_approval') {
    throw new Error(`Cannot approve a request in '${cr.status}' status`);
  }

  const linked = await validateParentStudentLink(parentId, cr.registration.studentId);
  if (!linked) throw new Error('You are not linked to this student');

  if (cr.registration.session.status !== 'active') {
    throw new Error('The registration window has closed; this request can no longer be approved');
  }

  const now = new Date();

  // Atomic transaction (OI-009)
  return db.transaction(async (tx) => {
    // 1. Mark change request approved
    await tx
      .update(changeRequest)
      .set({ status: 'approved', approvedBy: parentId, comments: data.comments ?? null, processedAt: now, updatedAt: now })
      .where(eq(changeRequest.id, changeRequestId));

    // 2. Drop the original registration
    await tx
      .update(registration)
      .set({ status: 'dropped', droppedAt: now, updatedAt: now })
      .where(eq(registration.id, cr.registrationId));

    // 3. Credit escrow with the full original price
    await creditEscrow({
      studentId:            cr.registration.studentId,
      amount:               cr.registration.priceAtRegistration,
      reason:               cr.type === 'drop' ? 'drop' : 'swap_refund',
      initiatedBy:          parentId,
      relatedRegistrationId: cr.registrationId,
    });

    // 4. For swaps: create a new pending_payment registration
    if (cr.type === 'swap' && cr.newSubjectId) {
      const newSubjectPrice = cr.priceAtRequest;

      await tx.insert(registration).values({
        id: randomUUID(),
        studentId: cr.registration.studentId,
        sessionId: cr.registration.sessionId,
        subjectId: cr.newSubjectId,
        priceAtRegistration: newSubjectPrice,
        status: 'pending_payment',
        requestedBy: cr.registration.studentId,
        approvedBy: parentId,
        approvedAt: now,
        approvalComments: `Swap from registration ${cr.registrationId}`,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { success: true, type: cr.type };
  });

  // NOT-007: Notify student that their request was approved (fire-and-forget)
  // NOT-008: Notify parents of escrow balance change (fire-and-forget)
  {
    const studentId = cr.registration.studentId;
    const subjectName = cr.registration.subject?.name ?? 'the subject';
    const newSubjectName = cr.newSubject?.name;

    notifyDropSwapProcessed({
      studentId,
      parentId,
      changeType:       cr.type as 'drop' | 'swap',
      subjectName,
      newSubjectName,
      approved:         true,
      financialImpact:  `EGP ${cr.registration.priceAtRegistration.toFixed(2)} credited to your escrow`,
      comments:         data.comments,
      changeRequestId,
    }).catch((err) => console.error('[notification] NOT-007 (approve) failed:', err));

    // Fetch balance after the transaction has committed
    const newBalance = await getEscrowBalance(studentId);
    const previousBalance = newBalance - cr.registration.priceAtRegistration;
    const studentUser = await db.query.user.findFirst({
      where: (u, { eq: eqOp }) => eqOp(u.id, studentId),
      columns: { name: true },
    });

    notifyEscrowBalanceChanged({
      studentId,
      studentName:      studentUser?.name ?? 'Student',
      previousBalance,
      newBalance,
      changeAmount:     cr.registration.priceAtRegistration,
      reason:           cr.type === 'drop' ? 'Subject drop refund' : 'Subject swap refund',
    }).catch((err) => console.error('[notification] NOT-008 (approve change) failed:', err));
  }

  return result;
}

/**
 * Parent rejects a pending change request (SWAP-003).
 * No financial impact. Comments are required.
 */
export async function rejectChangeRequest(
  changeRequestId: string,
  data: RejectChangeRequestType,
  parentId: string
) {
  const cr = await db.query.changeRequest.findFirst({
    where: (c, { eq }) => eq(c.id, changeRequestId),
    with: {
      registration: {
        columns: { studentId: true },
        with: { subject: { columns: { name: true } } },
      },
      newSubject: { columns: { name: true } },
    },
  });

  if (!cr) throw new Error('Change request not found');
  if (cr.status !== 'pending_approval') {
    throw new Error(`Cannot reject a request in '${cr.status}' status`);
  }

  const linked = await validateParentStudentLink(parentId, cr.registration.studentId);
  if (!linked) throw new Error('You are not linked to this student');

  const now = new Date();

  const [updated] = await db
    .update(changeRequest)
    .set({
      status: 'rejected',
      approvedBy: parentId,
      comments: data.comments,
      processedAt: now,
      updatedAt: now,
    })
    .where(eq(changeRequest.id, changeRequestId))
    .returning();

  // NOT-007: Notify student that their request was rejected (fire-and-forget)
  notifyDropSwapProcessed({
    studentId:       cr.registration.studentId,
    parentId,
    changeType:      cr.type as 'drop' | 'swap',
    subjectName:     cr.registration.subject?.name ?? 'the subject',
    newSubjectName:  cr.newSubject?.name,
    approved:        false,
    financialImpact: 'No changes were made to your registration',
    comments:        data.comments,
    changeRequestId,
  }).catch((err) => console.error('[notification] NOT-007 (reject) failed:', err));

  return updated!;
}

// ─── Parent: Direct Operations ────────────────────────────────────────────────

/**
 * Parent directly drops a subject for a linked child (SWAP-004).
 *
 * No change_request record is created; takes effect immediately.
 * Runs inside a DB transaction (OI-009):
 * 1. Registration → 'dropped'
 * 2. Escrow credited with the full priceAtRegistration
 */
export async function executeDirectDrop(
  registrationId: string,
  data: DirectDropType,
  parentId: string
) {
  // validateChangeEligibility is called with checkOwnership=false (parent checks their own link)
  const { reg } = await validateChangeEligibility(registrationId, '', false);

  const linked = await validateParentStudentLink(parentId, reg.studentId);
  if (!linked) throw new Error('You are not linked to this student');

  const now = new Date();

  // Atomic transaction (OI-009)
  const result = await db.transaction(async (tx) => {
    await tx
      .update(registration)
      .set({ status: 'dropped', droppedAt: now, updatedAt: now })
      .where(eq(registration.id, registrationId));

    await creditEscrow({
      studentId:            reg.studentId,
      amount:               reg.priceAtRegistration,
      reason:               'drop',
      initiatedBy:          parentId,
      relatedRegistrationId: registrationId,
    });

    return { success: true, creditedAmount: reg.priceAtRegistration };
  });

  // NOT-008: Notify parents of escrow credit from direct drop (fire-and-forget)
  {
    const newBalance = await getEscrowBalance(reg.studentId);
    const studentUser = await db.query.user.findFirst({
      where: (u, { eq: eqOp }) => eqOp(u.id, reg.studentId),
      columns: { name: true },
    });

    notifyEscrowBalanceChanged({
      studentId:       reg.studentId,
      studentName:     studentUser?.name ?? 'Student',
      previousBalance: newBalance - reg.priceAtRegistration,
      newBalance,
      changeAmount:    reg.priceAtRegistration,
      reason:          'Direct subject drop — full refund to escrow',
    }).catch((err) => console.error('[notification] NOT-008 (direct drop) failed:', err));
  }

  return result;
}

/**
 * Parent directly swaps a subject for a linked child (SWAP-004).
 *
 * No change_request record is created; takes effect immediately.
 * Runs inside a DB transaction (OI-009):
 * 1. Original registration → 'dropped'
 * 2. Escrow credited with the full original priceAtRegistration
 * 3. New registration created at 'pending_payment' for the new subject
 *    (parent can apply escrow credit at checkout)
 */
export async function executeDirectSwap(
  registrationId: string,
  data: DirectSwapType,
  parentId: string
) {
  const { reg } = await validateChangeEligibility(registrationId, '', false);

  const linked = await validateParentStudentLink(parentId, reg.studentId);
  if (!linked) throw new Error('You are not linked to this student');

  const newSub = await validateNewSubjectForSwap(
    reg.studentId,
    reg.sessionId,
    data.newSubjectId,
    registrationId
  );

  const newSubjectPrice = resolveSubjectPrice(newSub);
  const now = new Date();

  // Atomic transaction (OI-009)
  const result = await db.transaction(async (tx) => {
    // 1. Drop original registration
    await tx
      .update(registration)
      .set({ status: 'dropped', droppedAt: now, updatedAt: now })
      .where(eq(registration.id, registrationId));

    // 2. Credit escrow with original price
    await creditEscrow({
      studentId:            reg.studentId,
      amount:               reg.priceAtRegistration,
      reason:               'swap_refund',
      initiatedBy:          parentId,
      relatedRegistrationId: registrationId,
    });

    // 3. Create new pending_payment registration
    const newRegId = randomUUID();
    await tx.insert(registration).values({
      id: newRegId,
      studentId: reg.studentId,
      sessionId: reg.sessionId,
      subjectId: data.newSubjectId,
      priceAtRegistration: newSubjectPrice,
      status: 'pending_payment',
      requestedBy: parentId,
      approvedBy: parentId,
      approvedAt: now,
      approvalComments: `Direct swap from registration ${registrationId}`,
      createdAt: now,
      updatedAt: now,
    });

    return {
      success: true,
      creditedAmount: reg.priceAtRegistration,
      newRegistrationId: newRegId,
      newSubjectPrice,
    };
  });

  // NOT-008: Notify parents of escrow credit from direct swap (fire-and-forget)
  {
    const newBalance = await getEscrowBalance(reg.studentId);
    const studentUser = await db.query.user.findFirst({
      where: (u, { eq: eqOp }) => eqOp(u.id, reg.studentId),
      columns: { name: true },
    });

    notifyEscrowBalanceChanged({
      studentId:       reg.studentId,
      studentName:     studentUser?.name ?? 'Student',
      previousBalance: newBalance - reg.priceAtRegistration,
      newBalance,
      changeAmount:    reg.priceAtRegistration,
      reason:          `Direct swap: ${reg.subject.name} → ${newSub.name} (escrow refund)`,
    }).catch((err) => console.error('[notification] NOT-008 (direct swap) failed:', err));
  }

  return result;
}

// ─── Read Operations ──────────────────────────────────────────────────────────

/**
 * Get pending change requests for a specific student (SWAP-007).
 * Student views their own pending requests with subject and session info.
 */
export async function getPendingChangeRequests(
  studentId: string,
  filters?: ChangeRequestsQueryType
) {
  const requests = await db.query.changeRequest.findMany({
    where: (cr, { eq, and, ne }) =>
      and(
        eq(cr.requestedBy, studentId),
        filters?.status
          ? eq(cr.status, filters.status)
          : ne(cr.status, 'approved') // default: exclude finished approved
      ),
    with: {
      registration: {
        with: {
          subject: { columns: { id: true, name: true, subjectCode: true } },
          session: { columns: { id: true, name: true, sessionType: true } },
        },
      },
      newSubject: { columns: { id: true, name: true, subjectCode: true } },
    },
    orderBy: (cr, { desc }) => [desc(cr.createdAt)],
  });

  return requests;
}

/**
 * Get all pending change requests for a parent's linked children.
 * Used by the parent's approvals dashboard alongside registration approvals.
 */
export async function getPendingChangeRequestsForParent(parentId: string) {
  const links = await db.query.parentStudentLink.findMany({
    where: (l, { eq, and }) =>
      and(eq(l.parentId, parentId), eq(l.status, 'approved')),
    columns: { studentId: true },
  });

  const studentIds = links.map((l) => l.studentId);
  if (studentIds.length === 0) return [];

  // Get registrations belonging to these students
  const regsForStudents = await db.query.registration.findMany({
    where: (r, { inArray }) => inArray(r.studentId, studentIds),
    columns: { id: true, studentId: true },
  });

  const regIds = regsForStudents.map((r) => r.id);
  if (regIds.length === 0) return [];

  const requests = await db.query.changeRequest.findMany({
    where: (cr, { eq, and, inArray }) =>
      and(
        inArray(cr.registrationId, regIds),
        eq(cr.status, 'pending_approval')
      ),
    with: {
      registration: {
        with: {
          subject: { columns: { id: true, name: true, subjectCode: true } },
          session: { columns: { id: true, name: true, sessionType: true } },
          student: {
            columns: { id: true, name: true, grade: true },
          },
        },
      },
      newSubject: { columns: { id: true, name: true, subjectCode: true } },
      requestedByUser: { columns: { id: true, name: true } },
    },
    orderBy: (cr, { asc }) => [asc(cr.createdAt)],
  });

  return requests;
}

/**
 * Get a single change request by ID.
 * Used for detail views and action validation.
 */
export async function getChangeRequestById(id: string) {
  return db.query.changeRequest.findFirst({
    where: (cr, { eq }) => eq(cr.id, id),
    with: {
      registration: {
        with: {
          subject: true,
          session: { columns: { id: true, name: true, sessionType: true, status: true } },
        },
      },
      newSubject: true,
      requestedByUser: { columns: { id: true, name: true, grade: true } },
      approvedByUser: { columns: { id: true, name: true } },
    },
  });
}
