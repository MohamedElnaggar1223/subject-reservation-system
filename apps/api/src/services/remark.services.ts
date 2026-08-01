/**
 * Remark Service (V3 §6.10)
 *
 * Post-results services (Enquiries About Results) — the school submits
 * to the board; parents request, consent, and pay in-app.
 *
 * Status flow:
 *   student request:  pending_approval → (parent approves) → pending_consent
 *   parent request:   pending_consent
 *   → (consent attested) → pending_payment (fee > 0) | awaiting_submission
 *   → (fee paid via shared pipeline) → awaiting_submission
 *   → (staff submits to board) → submitted
 *   → (staff records outcome) → outcome_recorded
 *
 * Council rules (research-verified, V3_PLAN §2.2):
 * - All boards are per-paper.
 * - Cambridge: ONE request ever per (candidate, syllabus, series) with a
 *   single service type — enforced here.
 * - OxfordAQA: once per paper — duplicate paper codes across requests
 *   for the same registration are rejected.
 * - Fee refund on grade change: papers in one request are "submitted
 *   together", so a grade change refunds the whole request's fee
 *   (to the escrow free balance).
 * - Grades can go DOWN: consent is blocking and audited.
 */

import { db, remarkRequest, remarkRequestItem, remarkFeeSchedule, remarkDeadline, registration, payment, eq, and, inArray, isNull } from '@repo/db';
import { randomUUID } from 'crypto';
import type {
  CreateRemarkRequestType,
  ConfirmRemarkConsentType,
  RecordRemarkOutcomeType,
  UpsertRemarkFeeType,
  UpsertRemarkDeadlineType,
} from '@repo/validations';
import { creditEscrow, getEscrowBalance } from './escrow.services';
import { notifyEscrowBalanceChanged } from './notification.services';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function validateParentStudentLink(parentId: string, studentId: string): Promise<boolean> {
  const link = await db.query.parentStudentLink.findFirst({
    where: (l, { eq, and }) =>
      and(eq(l.parentId, parentId), eq(l.studentId, studentId), eq(l.status, 'approved')),
    columns: { id: true },
  });
  return !!link;
}

// ─── Fees + deadlines config ─────────────────────────────────────────────────

export async function getRemarkFees() {
  return db.query.remarkFeeSchedule.findMany({
    orderBy: (f, { asc }) => [asc(f.council), asc(f.serviceType)],
  });
}

export async function upsertRemarkFee(data: UpsertRemarkFeeType) {
  const existing = await db.query.remarkFeeSchedule.findFirst({
    where: (f, { eq, and }) =>
      and(eq(f.council, data.council), eq(f.serviceType, data.serviceType)),
  });
  if (existing) {
    const [updated] = await db
      .update(remarkFeeSchedule)
      .set({ amountPerPaper: data.amountPerPaper, updatedAt: new Date() })
      .where(eq(remarkFeeSchedule.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(remarkFeeSchedule)
    .values({
      id: randomUUID(),
      council: data.council,
      serviceType: data.serviceType,
      amountPerPaper: data.amountPerPaper,
    })
    .returning();
  return created;
}

export async function upsertRemarkDeadline(data: UpsertRemarkDeadlineType) {
  const existing = await db.query.remarkDeadline.findFirst({
    where: (d, { eq, and }) =>
      and(
        eq(d.council, data.council),
        eq(d.sessionId, data.sessionId),
        eq(d.serviceType, data.serviceType)
      ),
  });
  if (existing) {
    const [updated] = await db
      .update(remarkDeadline)
      .set({ deadline: data.deadline })
      .where(eq(remarkDeadline.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(remarkDeadline)
    .values({
      id: randomUUID(),
      council: data.council,
      sessionId: data.sessionId,
      serviceType: data.serviceType,
      deadline: data.deadline,
    })
    .returning();
  return created;
}

export async function getRemarkDeadlines() {
  return db.query.remarkDeadline.findMany({
    orderBy: (d, { asc }) => [asc(d.deadline)],
  });
}

// ─── Request lifecycle ───────────────────────────────────────────────────────

/**
 * Create a remark request. Students → pending_approval (parent must
 * approve, mirroring registrations); parents → pending_consent.
 */
export async function createRemarkRequest(
  requesterId: string,
  requesterRole: string,
  data: CreateRemarkRequestType
) {
  const reg = await db.query.registration.findFirst({
    where: (r, { eq }) => eq(r.id, data.registrationId),
    with: {
      subject: { columns: { id: true, name: true, council: true } },
      session: { columns: { id: true, name: true } },
    },
  });
  if (!reg) throw new Error('Registration not found');
  if (reg.status !== 'confirmed') {
    throw new Error('Remarks are only available for confirmed registrations');
  }
  if (!reg.gradeReceived) {
    throw new Error('Results have not been recorded for this subject yet');
  }

  // Requester scoping: student = own row; parent = linked child's row
  let studentId = reg.studentId;
  let initialStatus: 'pending_approval' | 'pending_consent';
  if (requesterRole === 'student') {
    if (reg.studentId !== requesterId) throw new Error('You can only request remarks for your own subjects');
    initialStatus = 'pending_approval';
  } else if (requesterRole === 'parent') {
    if (!(await validateParentStudentLink(requesterId, reg.studentId))) {
      throw new Error('You are not linked to this student');
    }
    initialStatus = 'pending_consent';
  } else {
    throw new Error('Only students and parents can request remarks');
  }

  // Deadline check (per council + series + service, when configured)
  const deadlineRow = await db.query.remarkDeadline.findFirst({
    where: (d, { eq, and }) =>
      and(
        eq(d.council, reg.subject.council),
        eq(d.sessionId, reg.sessionId),
        eq(d.serviceType, data.serviceType)
      ),
  });
  if (deadlineRow && deadlineRow.deadline < new Date()) {
    throw new Error(
      `The board deadline for this service passed on ${deadlineRow.deadline.toLocaleDateString('en-GB')}`
    );
  }

  const priorRequests = await db.query.remarkRequest.findMany({
    where: (rr, { eq, and, notInArray }) =>
      and(
        eq(rr.registrationId, data.registrationId),
        notInArray(rr.status, ['cancelled', 'rejected'])
      ),
    with: { items: { columns: { paperCode: true } } },
  });

  // Cambridge atomic one-shot rule: one request ever per candidate+syllabus+series
  if (reg.subject.council === 'cambridge' && priorRequests.length > 0) {
    throw new Error(
      'Cambridge accepts only ONE enquiry per subject per series — all papers must be submitted together, and a request already exists. Cancel it first if it has not been submitted.'
    );
  }

  // OxfordAQA: once per paper
  if (reg.subject.council === 'oxford') {
    const usedPapers = new Set(priorRequests.flatMap((r) => r.items.map((i) => i.paperCode)));
    const dupes = data.papers.filter((p) => usedPapers.has(p.paperCode));
    if (dupes.length > 0) {
      throw new Error(
        `OxfordAQA allows one review per paper — already requested: ${dupes.map((d) => d.paperCode).join(', ')}`
      );
    }
  }

  // Fee from the configured schedule (per paper)
  const feeRow = await db.query.remarkFeeSchedule.findFirst({
    where: (f, { eq, and }) =>
      and(eq(f.council, reg.subject.council), eq(f.serviceType, data.serviceType)),
  });
  if (!feeRow) {
    throw new Error(
      'The remark fee for this council and service has not been configured yet — ask the school to set it up'
    );
  }
  const feeCharged = round2(feeRow.amountPerPaper * data.papers.length);

  const requestId = randomUUID();
  const created = await db.transaction(async (tx) => {
    const [header] = await tx
      .insert(remarkRequest)
      .values({
        id: requestId,
        studentId,
        registrationId: data.registrationId,
        serviceType: data.serviceType,
        status: initialStatus,
        requestedBy: requesterId,
        ...(requesterRole === 'parent'
          ? { approvedBy: requesterId, approvedAt: new Date() }
          : {}),
        feeCharged,
      })
      .returning();

    await tx.insert(remarkRequestItem).values(
      data.papers.map((p) => ({
        id: randomUUID(),
        remarkRequestId: requestId,
        paperCode: p.paperCode.trim().toUpperCase(),
        paperName: p.paperName ?? null,
      }))
    );

    return header;
  });

  return created;
}

/** Parent approves/rejects a student-initiated request */
export async function decideRemarkRequest(
  id: string,
  parentId: string,
  approve: boolean,
  comments?: string
) {
  const rr = await db.query.remarkRequest.findFirst({
    where: (r, { eq }) => eq(r.id, id),
  });
  if (!rr) throw new Error('Remark request not found');
  if (!(await validateParentStudentLink(parentId, rr.studentId))) {
    throw new Error('You are not linked to this student');
  }

  const [updated] = await db
    .update(remarkRequest)
    .set({
      status: approve ? 'pending_consent' : 'rejected',
      approvedBy: parentId,
      approvedAt: new Date(),
      comments: comments ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(remarkRequest.id, id), eq(remarkRequest.status, 'pending_approval')))
    .returning();
  if (!updated) throw new Error('Request is not awaiting approval');
  return updated;
}

/**
 * Blocking consent step. Moves to pending_payment (fee > 0) or straight
 * to awaiting_submission.
 */
export async function confirmConsent(
  id: string,
  parentId: string,
  data: ConfirmRemarkConsentType
) {
  const rr = await db.query.remarkRequest.findFirst({
    where: (r, { eq }) => eq(r.id, id),
  });
  if (!rr) throw new Error('Remark request not found');
  if (!(await validateParentStudentLink(parentId, rr.studentId))) {
    throw new Error('You are not linked to this student');
  }

  const nextStatus = rr.feeCharged > 0 ? 'pending_payment' : 'awaiting_submission';
  const [updated] = await db
    .update(remarkRequest)
    .set({
      status: nextStatus,
      consentFileId: data.consentFileId ?? null,
      consentConfirmedBy: parentId,
      consentConfirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(remarkRequest.id, id), eq(remarkRequest.status, 'pending_consent')))
    .returning();
  if (!updated) throw new Error('Request is not awaiting consent');
  return updated;
}

/**
 * Parent pays the remark fee through the shared payments pipeline
 * (purpose='remark'). On finance confirmation the payment hook moves
 * the request to awaiting_submission.
 */
export async function initiateRemarkPayment(
  id: string,
  parentId: string,
  paymentMethod: 'in_school' | 'instapay',
  schoolAccountDetails: Record<string, unknown>
) {
  const rr = await db.query.remarkRequest.findFirst({
    where: (r, { eq }) => eq(r.id, id),
    with: {
      registration: { with: { subject: { columns: { name: true } } } },
    },
  });
  if (!rr) throw new Error('Remark request not found');
  if (rr.status !== 'pending_payment') throw new Error('Request is not awaiting payment');
  if (!(await validateParentStudentLink(parentId, rr.studentId))) {
    throw new Error('You are not linked to this student');
  }

  const existing = await db.query.payment.findFirst({
    where: (p, { eq, and, inArray, sql: sqlOp }) =>
      and(
        eq(p.purpose, 'remark'),
        inArray(p.status, ['pending', 'pending_verification']),
        sqlOp`${p.metadata} ->> 'remarkRequestId' = ${id}`
      ),
    columns: { id: true },
  });
  if (existing) throw new Error('A payment for this remark request is already pending');

  const paymentId = randomUUID();
  let metadata: Record<string, unknown>;
  let externalReference: string | null = null;

  if (paymentMethod === 'in_school') {
    externalReference = `SCH-${paymentId.slice(0, 8).toUpperCase()}`;
    metadata = {
      remarkRequestId: id,
      inSchool: { referenceNumber: externalReference },
      instructions: `Remark fee — ${rr.registration.subject.name}. Pay at the finance desk.`,
    };
  } else {
    metadata = {
      remarkRequestId: id,
      instapay: { account: schoolAccountDetails, amountDue: rr.feeCharged },
      instructions:
        'Transfer the exact remark fee via InstaPay to the school account, then submit your transaction reference.',
    };
  }

  const [created] = await db
    .insert(payment)
    .values({
      id: paymentId,
      studentId: rr.studentId,
      parentId,
      amount: rr.feeCharged,
      escrowAmountApplied: 0,
      paymentMethod,
      purpose: 'remark',
      status: 'pending',
      externalReference,
      metadata,
    })
    .returning();

  return created;
}

/**
 * Payment hook — called by confirmPayment when a purpose='remark'
 * payment completes. Idempotent via the status guard.
 */
export async function onRemarkPaymentCompleted(remarkRequestId: string) {
  await db
    .update(remarkRequest)
    .set({ status: 'awaiting_submission', updatedAt: new Date() })
    .where(
      and(eq(remarkRequest.id, remarkRequestId), eq(remarkRequest.status, 'pending_payment'))
    );
}

/** Staff records the board submission (the school is the exam centre) */
export async function markSubmittedToBoard(id: string, boardReference: string) {
  const [updated] = await db
    .update(remarkRequest)
    .set({ status: 'submitted', boardReference, updatedAt: new Date() })
    .where(and(eq(remarkRequest.id, id), eq(remarkRequest.status, 'awaiting_submission')))
    .returning();
  if (!updated) throw new Error('Request is not awaiting board submission');
  return updated;
}

/**
 * Staff records the outcome. A subject-grade change triggers the fee
 * refund (papers in one request were submitted together): fee back to
 * the escrow FREE balance, cash-refundable via the normal flow.
 */
export async function recordOutcome(
  id: string,
  staffId: string,
  data: RecordRemarkOutcomeType
) {
  const rr = await db.query.remarkRequest.findFirst({
    where: (r, { eq }) => eq(r.id, id),
    with: { items: true },
  });
  if (!rr) throw new Error('Remark request not found');
  if (rr.status !== 'submitted') throw new Error('Request has not been submitted to the board');

  const itemIds = new Set(rr.items.map((i) => i.id));
  for (const item of data.items) {
    if (!itemIds.has(item.itemId)) throw new Error('Unknown remark item');
  }

  const refundDue = data.gradeChanged && rr.feeCharged > 0 && !rr.feeRefunded;

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(remarkRequest)
      .set({
        status: 'outcome_recorded',
        feeRefunded: refundDue ? true : rr.feeRefunded,
        comments: data.comments ?? rr.comments,
        updatedAt: new Date(),
      })
      .where(and(eq(remarkRequest.id, id), eq(remarkRequest.status, 'submitted')))
      .returning();
    if (!updated) throw new Error('Request already processed');

    for (const item of data.items) {
      await tx
        .update(remarkRequestItem)
        .set({ outcome: item.outcome, gradeAfter: item.gradeAfter ?? null })
        .where(eq(remarkRequestItem.id, item.itemId));
    }

    if (refundDue) {
      await creditEscrow(
        {
          studentId: rr.studentId,
          amount: rr.feeCharged,
          reason: 'payment_refund',
          initiatedBy: staffId,
          relatedRegistrationId: rr.registrationId,
        },
        tx
      );
    }
  });

  if (refundDue) {
    const newBalance = await getEscrowBalance(rr.studentId);
    const student = await db.query.user.findFirst({
      where: (u, { eq }) => eq(u.id, rr.studentId),
      columns: { name: true },
    });
    notifyEscrowBalanceChanged({
      studentId: rr.studentId,
      studentName: student?.name ?? 'Student',
      previousBalance: newBalance - rr.feeCharged,
      newBalance,
      changeAmount: rr.feeCharged,
      reason: 'Remark fee refunded — grade changed',
    }).catch((err) => console.error('[notification] remark refund notify failed:', err));
  }

  return { refunded: refundDue };
}

export async function cancelRemarkRequest(id: string, userId: string, role: string) {
  const rr = await db.query.remarkRequest.findFirst({
    where: (r, { eq }) => eq(r.id, id),
  });
  if (!rr) throw new Error('Remark request not found');

  const isOwner =
    (role === 'student' && rr.studentId === userId) ||
    (role === 'parent' && (await validateParentStudentLink(userId, rr.studentId)));
  if (!isOwner) throw new Error('You are not authorized to cancel this request');

  const [updated] = await db
    .update(remarkRequest)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(remarkRequest.id, id),
        // Cancellable until money/board involvement
        eq(remarkRequest.status, rr.status)
      )
    )
    .returning();
  if (
    !updated ||
    !['pending_approval', 'pending_consent', 'pending_payment'].includes(rr.status)
  ) {
    throw new Error('This request can no longer be cancelled');
  }
  return updated;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function getRemarkRequests(scope: {
  studentIds?: string[];
  staff?: boolean;
}) {
  return db.query.remarkRequest.findMany({
    where: scope.staff
      ? undefined
      : (r, { inArray }) => inArray(r.studentId, scope.studentIds ?? ['__none__']),
    with: {
      items: true,
      student: { columns: { id: true, name: true, grade: true } },
      registration: {
        columns: { id: true, gradeReceived: true },
        with: {
          subject: { columns: { id: true, name: true, code: true, council: true } },
          session: { columns: { id: true, name: true } },
        },
      },
    },
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  });
}


// ─── Results entry (V3 §5.4) ─────────────────────────────────────────────────

/**
 * Confirmed registrations in a session awaiting a grade — the staff
 * results-entry grid ("Beat Excel": one screen, inline grades, save all).
 */
export async function getPendingResults(sessionId: string) {
  return db.query.registration.findMany({
    where: (r, { eq, and }) => and(eq(r.sessionId, sessionId), eq(r.status, 'confirmed')),
    columns: { id: true, gradeReceived: true },
    with: {
      student: { columns: { id: true, name: true, studentId: true, grade: true } },
      subject: { columns: { id: true, name: true, code: true, council: true } },
    },
    orderBy: (r, { asc }) => [asc(r.createdAt)],
  });
}

/**
 * Bulk-record grades. Only confirmed registrations accept results;
 * re-recording overwrites (typo fixes) and is audited by the route.
 */
export async function recordResults(
  staffId: string,
  entries: { registrationId: string; grade: string }[]
) {
  let recorded = 0;
  for (const entry of entries) {
    const [updated] = await db
      .update(registration)
      .set({
        gradeReceived: entry.grade.trim().toUpperCase(),
        resultRecordedAt: new Date(),
        resultRecordedBy: staffId,
        updatedAt: new Date(),
      })
      .where(and(eq(registration.id, entry.registrationId), eq(registration.status, 'confirmed')))
      .returning({ id: registration.id });
    if (updated) recorded++;
  }
  return { recorded, skipped: entries.length - recorded };
}
