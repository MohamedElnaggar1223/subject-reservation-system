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
import { refundPercentage } from './refund.services';
import { executeReceiptGatedDrop } from './receipt.services';
import { computeRegistrationPricing } from './pricing.services';
import {
  notifyDropSwapRequestReceived,
  notifyDropSwapProcessed,
  notifyDirectDropSwapExecuted,
  notifyEscrowBalanceChanged,
} from './notification.services';
import { isGraduated } from './grade.services';

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

export const isParentLinkedToStudent = validateParentStudentLink;

/**
 * Resolves the price for a subject following the same logic as
 * registration.services.ts → resolveRegistrationPrice.
 *
 * Previously this helper fell through to 0 when isOfferedAtSchool=false
 * and customPrice was null, which under-charged the student on a swap
 * into such a subject. Registration-time logic uses priceInSchool as the
 * safety net instead — we mirror that here so a swap into the same
 * subject charges the same price as a fresh registration into it.
 */
function resolveSubjectPrice(sub: {
  isOfferedAtSchool: boolean;
  courseFee: number;
  registrationFee: number;
}): number {
  // V3 (§5.3): swaps price the new subject through the shared engine —
  // in-school by default; the 50% rule applies automatically when the
  // subject isn't offered at school.
  return computeRegistrationPricing(sub, { isRetake: false, takeOutsideSchool: false }).total;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

  // Core subject check: Grade 10 June session core subjects are locked.
  // URD CORE-002 explicitly requires the lock to survive later admin edits
  // that toggle subject.isCore — so the authoritative flag is the
  // registration-time snapshot (wasCoreAtRegistration), not the live
  // subject.isCore. A fallback to reg.subject.isCore keeps legacy rows
  // (pre-backfill) safe if ever encountered.
  const coreAtRegistration =
    reg.wasCoreAtRegistration ?? reg.subject.isCore;
  if (
    studentRecord?.grade === 10 &&
    reg.session.sessionType === 'june' &&
    coreAtRegistration
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
      courseFee: true,
      registrationFee: true,
      isCore: true,
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
        notInArray(r.status, ['dropped', 'rejected', 'expired'])
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

  let newSubjectIsCore = false;
  if (cr.type === 'swap' && cr.newSubjectId) {
    const newSubject = await db.query.subject.findFirst({
      where: (s, { eq: eqOp }) => eqOp(s.id, cr.newSubjectId!),
      columns: { id: true, isActive: true, isCore: true },
    });
    if (!newSubject || !newSubject.isActive) {
      throw new Error('The requested subject is no longer available');
    }
    newSubjectIsCore = newSubject.isCore;

    const existingReg = await db.query.registration.findFirst({
      where: (r, { eq: eqOp, and: andOp, notInArray: niArr }) =>
        andOp(
          eqOp(r.studentId, cr.registration.studentId),
          eqOp(r.sessionId, cr.registration.session.id),
          eqOp(r.subjectId, cr.newSubjectId!),
          niArr(r.status, ['dropped', 'rejected', 'expired']),
        ),
      columns: { id: true },
    });
    if (existingReg) {
      throw new Error('Student is already registered for the requested subject');
    }
  }

  const now = new Date();

  // V3 §6.12: the refund percentage locks at drop-APPROVAL time
  const pct = await refundPercentage(now, cr.registration.sessionId);
  const refundAmount = round2((cr.registration.priceAtRegistration * pct) / 100);

  const result = await db.transaction(async (tx) => {
    // Status guard: prevent concurrent double-approval
    const [updatedCR] = await tx
      .update(changeRequest)
      .set({ status: 'approved', approvedBy: parentId, comments: data.comments ?? null, processedAt: now, updatedAt: now })
      .where(and(eq(changeRequest.id, changeRequestId), eq(changeRequest.status, 'pending_approval')))
      .returning({ id: changeRequest.id });

    if (!updatedCR) {
      throw new Error('Change request already processed.');
    }

    // V3 D-D: receipt-gated, status-guarded drop. If the paper receipt
    // is out with the parent, the drop parks at dropped_pending_receipt
    // and the (window-scaled) refund fires when the receipt comes back.
    const dropOutcome = await executeReceiptGatedDrop(tx, {
      registrationId: cr.registrationId,
      studentId: cr.registration.studentId,
      refundAmount,
      refundReason: cr.type === 'drop' ? 'drop' : 'swap_refund',
      initiatedBy: parentId,
    });

    if (cr.type === 'swap' && cr.newSubjectId) {
      const newSubjectPrice = cr.priceAtRequest;

      await tx.insert(registration).values({
        id: randomUUID(),
        studentId: cr.registration.studentId,
        sessionId: cr.registration.sessionId,
        subjectId: cr.newSubjectId,
        priceAtRegistration: newSubjectPrice,
        courseFeeAtRegistration: newSubjectPrice,
        wasCoreAtRegistration: newSubjectIsCore,
        status: 'pending_payment',
        requestedBy: cr.registration.studentId,
        approvedBy: parentId,
        approvedAt: now,
        approvalComments: `Swap from registration ${cr.registrationId}`,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { success: true, type: cr.type, ...dropOutcome, refundPercentage: pct };
  });

  // NOT-007: Notify student of approval (fire-and-forget)
  // NOT-008: Notify parents of escrow balance change (fire-and-forget)
  const studentId = cr.registration.studentId;

  const refundText =
    result.refundAmount <= 0
      ? `No refund applies (${result.refundPercentage}% refund window)`
      : result.gated
        ? `EGP ${result.refundAmount.toFixed(2)} (${result.refundPercentage}%) will be credited once the subject's receipt is returned to the school`
        : `EGP ${result.refundAmount.toFixed(2)} (${result.refundPercentage}%) credited to your escrow`;

  notifyDropSwapProcessed({
    studentId,
    parentId,
    changeType:       cr.type as 'drop' | 'swap',
    subjectName:      cr.registration.subject?.name ?? 'the subject',
    newSubjectName:   cr.newSubject?.name,
    approved:         true,
    financialImpact:  refundText,
    comments:         data.comments,
    changeRequestId,
  }).catch((err) => console.error('[notification] NOT-007 (approve) failed:', err));

  if (!result.gated && result.refundAmount > 0) {
    getEscrowBalance(studentId).then(async (newBalance) => {
      const previousBalance = newBalance - result.refundAmount;
      const studentUser = await db.query.user.findFirst({
        where: (u, { eq: eqOp }) => eqOp(u.id, studentId),
        columns: { name: true },
      });
      notifyEscrowBalanceChanged({
        studentId,
        studentName:      studentUser?.name ?? 'Student',
        previousBalance,
        newBalance,
        changeAmount:     result.refundAmount,
        reason:           cr.type === 'drop' ? 'Subject drop refund' : 'Subject swap refund',
      }).catch((err) => console.error('[notification] NOT-008 (approve change) failed:', err));
    }).catch((err) => console.error('[notification] NOT-008 balance fetch failed:', err));
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

  // Status-guarded UPDATE: the read-check above and this UPDATE are
  // separated by a network round-trip, so two parents clicking reject
  // near-simultaneously could both pass the pre-check. Adding
  // status='pending_approval' to the WHERE clause guarantees exactly one
  // transition; the loser's UPDATE returns zero rows and we surface a
  // clear error rather than silently duplicate the rejection.
  const [updated] = await db
    .update(changeRequest)
    .set({
      status: 'rejected',
      approvedBy: parentId,
      comments: data.comments,
      processedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(changeRequest.id, changeRequestId),
        eq(changeRequest.status, 'pending_approval')
      )
    )
    .returning();

  if (!updated) {
    throw new Error('Change request already processed.');
  }

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

  return updated;
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

  // V3 §6.12: refund percentage locks at drop time
  const pct = await refundPercentage(now, reg.sessionId);
  const refundAmount = round2((reg.priceAtRegistration * pct) / 100);

  // Atomic transaction (OI-009) — receipt-gated (D-D)
  const result = await db.transaction(async (tx) => {
    const dropOutcome = await executeReceiptGatedDrop(tx, {
      registrationId,
      studentId: reg.studentId,
      refundAmount,
      refundReason: 'drop',
      initiatedBy: parentId,
    });
    return { success: true, creditedAmount: dropOutcome.gated ? 0 : refundAmount, ...dropOutcome, refundPercentage: pct };
  });

  const impact =
    refundAmount <= 0
      ? `No refund applies (${pct}% refund window).`
      : result.gated
        ? `EGP ${refundAmount.toFixed(2)} (${pct}%) will be credited once the receipt is returned to the school.`
        : `EGP ${refundAmount.toFixed(2)} (${pct}%) credited to your escrow.`;

  // NOT-007 / SWAP-004: Student receives email + in-app notification when
  // a parent directly drops a subject for them.
  notifyDirectDropSwapExecuted({
    studentId: reg.studentId,
    parentId,
    changeType: 'drop',
    subjectName: reg.subject.name,
    financialImpact: impact,
  }).catch((err) => console.error('[notification] NOT-007 (direct drop) failed:', err));

  // NOT-008: Notify parents of escrow credit from direct drop (fire-and-forget)
  if (!result.gated && refundAmount > 0) {
    const newBalance = await getEscrowBalance(reg.studentId);
    const studentUser = await db.query.user.findFirst({
      where: (u, { eq: eqOp }) => eqOp(u.id, reg.studentId),
      columns: { name: true },
    });

    notifyEscrowBalanceChanged({
      studentId:       reg.studentId,
      studentName:     studentUser?.name ?? 'Student',
      previousBalance: newBalance - refundAmount,
      newBalance,
      changeAmount:    refundAmount,
      reason:          'Direct subject drop — refund to escrow',
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

  // V3 §6.12: refund percentage locks at swap time (drop leg)
  const pct = await refundPercentage(now, reg.sessionId);
  const refundAmount = round2((reg.priceAtRegistration * pct) / 100);

  // Atomic transaction (OI-009) — drop leg receipt-gated (D-D)
  const result = await db.transaction(async (tx) => {
    const dropOutcome = await executeReceiptGatedDrop(tx, {
      registrationId,
      studentId: reg.studentId,
      refundAmount,
      refundReason: 'swap_refund',
      initiatedBy: parentId,
    });

    // Create new pending_payment registration
    const newRegId = randomUUID();
    await tx.insert(registration).values({
      id: newRegId,
      studentId: reg.studentId,
      sessionId: reg.sessionId,
      subjectId: data.newSubjectId,
      priceAtRegistration: newSubjectPrice,
      courseFeeAtRegistration: newSubjectPrice,
      wasCoreAtRegistration: newSub.isCore,
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
      creditedAmount: dropOutcome.gated ? 0 : refundAmount,
      newRegistrationId: newRegId,
      newSubjectPrice,
      ...dropOutcome,
      refundPercentage: pct,
    };
  });

  // NOT-007 / SWAP-004: Student receives email + in-app notification when
  // a parent directly swaps a subject for them.
  const swapImpact =
    refundAmount <= 0
      ? `No refund applies for the dropped subject (${pct}% refund window); payment for the new subject is pending.`
      : result.gated
        ? `EGP ${refundAmount.toFixed(2)} (${pct}%) will be credited once the old receipt is returned; payment for the new subject is pending.`
        : `EGP ${refundAmount.toFixed(2)} (${pct}%) credited to your escrow; payment for the new subject is pending.`;

  notifyDirectDropSwapExecuted({
    studentId: reg.studentId,
    parentId,
    changeType: 'swap',
    subjectName: reg.subject.name,
    newSubjectName: newSub.name,
    financialImpact: swapImpact,
  }).catch((err) => console.error('[notification] NOT-007 (direct swap) failed:', err));

  // NOT-008: Notify parents of escrow credit from direct swap (fire-and-forget)
  if (!result.gated && refundAmount > 0) {
    const newBalance = await getEscrowBalance(reg.studentId);
    const studentUser = await db.query.user.findFirst({
      where: (u, { eq: eqOp }) => eqOp(u.id, reg.studentId),
      columns: { name: true },
    });

    notifyEscrowBalanceChanged({
      studentId:       reg.studentId,
      studentName:     studentUser?.name ?? 'Student',
      previousBalance: newBalance - refundAmount,
      newBalance,
      changeAmount:    refundAmount,
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
          subject: { columns: { id: true, name: true, code: true } },
          session: { columns: { id: true, name: true, sessionType: true } },
        },
      },
      newSubject: { columns: { id: true, name: true, code: true } },
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
          subject: { columns: { id: true, name: true, code: true } },
          session: { columns: { id: true, name: true, sessionType: true } },
          student: {
            columns: { id: true, name: true, grade: true },
          },
        },
      },
      newSubject: { columns: { id: true, name: true, code: true } },
      requestedByUser: { columns: { id: true, name: true } },
    },
    orderBy: (cr, { asc }) => [asc(cr.createdAt)],
  });

  return requests;
}

/**
 * Student cancels their own pending change request.
 *
 * - The change request must belong to the requesting student (requestedBy === userId).
 * - Status must be 'pending_approval'.
 * - Updates status to 'cancelled'.
 */
export async function cancelChangeRequest(
  changeRequestId: string,
  userId: string
) {
  const cr = await db.query.changeRequest.findFirst({
    where: (c, { eq: eqOp }) => eqOp(c.id, changeRequestId),
    columns: { id: true, requestedBy: true, status: true },
  });

  if (!cr) throw new Error('Change request not found');

  if (cr.requestedBy !== userId) {
    throw new Error('You can only cancel your own change requests');
  }

  if (cr.status !== 'pending_approval') {
    throw new Error(`Cannot cancel a request in '${cr.status}' status`);
  }

  const now = new Date();
  const [updated] = await db
    .update(changeRequest)
    .set({
      status: 'cancelled',
      processedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(changeRequest.id, changeRequestId),
        eq(changeRequest.status, 'pending_approval'),
      )
    )
    .returning();

  return updated!;
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
