/**
 * Preregistration Service (V3 §6.8, D-E/D-J)
 *
 * Parents preregister subjects for DRAFT (not-yet-open) sessions —
 * e.g. paying for the whole of Year 11 at the start of the year:
 *
 * 1. Prereg rows are created at status 'preregistered' with the price
 *    locked at preregistration time (D-E).
 * 2. The parent pays through the shared pipeline; on completion the
 *    money credits the HELD wallet (prereg_hold) and receipts are
 *    issued (D-J).
 * 3. When the session activates, the scheduler auto-captures: held is
 *    debited (prereg_capture) and the registration confirms. Unfunded
 *    preregs fall back to pending_payment.
 * 4. Cancellation before activation releases held funds and walks the
 *    normal receipt-gated refund path with refund windows applied (D-J).
 */

import { db, registration, eq, and } from '@repo/db';
import { randomUUID } from 'crypto';
import type { PreregisterRegistrationType } from '@repo/validations';
import { prepareRegistrationInputs } from './registration.services';
import { creditHeld, debitHeld, getEscrowBalance } from './escrow.services';
import { executeReceiptGatedDrop } from './receipt.services';
import { refundPercentage } from './refund.services';
import { isGraduated } from './grade.services';
import { logger } from '../lib/logger';
import { entryDeadlineMessage } from './window.services';
import { logAction } from './audit.services';

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

/**
 * Parent creates preregistrations against a draft session.
 */
export async function createPreregistration(parentId: string, data: PreregisterRegistrationType) {
  const linked = await validateParentStudentLink(parentId, data.studentId);
  if (!linked) throw new Error('You are not linked to this student');

  if (await isGraduated(data.studentId)) {
    throw new Error('Graduated students cannot be preregistered for new subjects');
  }

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, data.sessionId),
  });
  if (!sess) throw new Error('Session not found');
  if (sess.status !== 'draft') {
    throw new Error('Preregistration is only available for upcoming (not-yet-open) sessions');
  }
  // Past the series' board deadline nothing more can be entered (MO-10).
  if (sess.entryDeadline && sess.entryDeadline <= new Date()) throw new Error(entryDeadlineMessage(sess.entryDeadline));

  const subjects = await db.query.subject.findMany({
    where: (s, { eq, and, inArray }) =>
      and(eq(s.isActive, true), inArray(s.id, data.subjectIds)),
  });
  if (subjects.length !== data.subjectIds.length) {
    throw new Error('One or more subjects are invalid or inactive');
  }

  const existing = await db.query.registration.findMany({
    where: (r, { eq, and, notInArray, inArray }) =>
      and(
        eq(r.studentId, data.studentId),
        eq(r.sessionId, data.sessionId),
        inArray(r.subjectId, data.subjectIds),
        notInArray(r.status, ['dropped', 'rejected', 'expired'])
      ),
    columns: { subjectId: true },
  });
  if (existing.length > 0) {
    throw new Error('Some subjects are already preregistered for this session');
  }

  // Same V3 pipeline: level match, school-fee gate, retakes, teachers,
  // pricing engine + exceptions. Price locks NOW (D-E).
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
      status: 'preregistered' as const,
      requestedBy: parentId,
      approvedBy: parentId,
      approvedAt: now,
    };
  });

  return db.insert(registration).values(records).returning();
}

/**
 * Is this prereg funded? (a completed payment covers it)
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Whether a preregistration is paid for, and whether a payment for it is
 * still open. Callers ask inside their transaction, after locking the row:
 * asked before it, a confirmation landing in between went unseen (money
 * audit review, second round).
 */
async function preregPaymentState(registrationId: string, executor: typeof db | Tx) {
  const links = await executor.query.paymentRegistration.findMany({
    where: (pr, { eq }) => eq(pr.registrationId, registrationId),
    with: { payment: { columns: { status: true } } },
  });
  return {
    funded: links.some((l) => l.payment.status === 'completed'),
    open: links.some((l) => l.payment.status === 'pending' || l.payment.status === 'pending_verification'),
  };
}

/**
 * Parent cancels a preregistration before the session opens (D-J):
 * held funds release and the refund walks the normal receipt-gated
 * path with refund windows applied at cancellation time.
 */
export async function cancelPreregistration(registrationId: string, parentId: string) {
  const reg = await db.query.registration.findFirst({
    where: (r, { eq }) => eq(r.id, registrationId),
    with: { session: { columns: { id: true, status: true } } },
  });
  if (!reg) throw new Error('Registration not found');
  if (reg.status !== 'preregistered') {
    throw new Error('Only preregistered subjects can be cancelled this way');
  }
  if (reg.session.status !== 'draft') {
    throw new Error('The session has already opened — use a normal drop instead');
  }

  const linked = await validateParentStudentLink(parentId, reg.studentId);
  if (!linked) throw new Error('You are not linked to this student');

  const pct = await refundPercentage(new Date(), reg.sessionId, reg.studentId);

  const result = await db.transaction(async (tx) => {
    // Lock the row, then decide. A payment still open for it means money may
    // be on its way: cancelling now dropped the row with nothing refunded and
    // left finance unable to confirm the transfer.
    await tx.select({ id: registration.id }).from(registration).where(eq(registration.id, registrationId)).for('update');
    const { funded, open } = await preregPaymentState(registrationId, tx);
    if (open) {
      throw new Error('A payment for this subject is in progress — cancel that checkout first, or wait for the finance office to confirm or reject the transfer');
    }
    const refundAmount = funded ? round2((reg.priceAtRegistration * pct) / 100) : 0;

    // Release the full held amount; the refundable portion re-enters the
    // free balance (receipt-gated); the remainder is retained per the
    // refund windows.
    if (funded) {
      await debitHeld(
        {
          studentId: reg.studentId,
          amount: reg.priceAtRegistration,
          reason: 'prereg_release',
          initiatedBy: parentId,
          relatedRegistrationId: registrationId,
        },
        tx
      );
    }

    const dropOutcome = await executeReceiptGatedDrop(tx, {
      registrationId,
      studentId: reg.studentId,
      refundAmount,
      refundReason: 'drop',
      initiatedBy: parentId,
      fromStatus: 'preregistered',
    });

    return { success: true, funded, refundPercentage: funded ? pct : 0, ...dropOutcome };
  });

  return result;
}

/**
 * A series still in draft when its exam-board entry deadline passes never
 * opens (the scheduler will not open it, nor an admin), so its
 * preregistrations can never be entered. Owner decision MO-21: the family
 * gets the full price back — the refund windows are for a family's own drop,
 * and here the school never ran the window. Run by the deadline sweep for
 * such a series; idempotent (only rows still preregistered move).
 *
 * A paid row releases its held money and is dropped with a 100% refund on
 * the same receipt-gated path as a cancellation, so paper already handed to
 * the family must come back first (MA-16). An unpaid row expires. Each
 * money move writes its audit row in its transaction.
 */
export async function refundPreregistrationsAtDeadline(sessionId: string) {
  const preregs = await db.query.registration.findMany({
    where: (r, { eq: eqOp, and: andOp }) => andOp(eqOp(r.sessionId, sessionId), eqOp(r.status, 'preregistered')),
    columns: { id: true, studentId: true, subjectId: true, priceAtRegistration: true },
  });

  const outcomes: { studentId: string; subjectId: string; refunded: number; gated: boolean }[] = [];
  for (const reg of preregs) {
    try {
      const outcome = await db.transaction(async (tx) => {
        const [row] = await tx.select({ status: registration.status }).from(registration).where(eq(registration.id, reg.id)).for('update');
        if (row?.status !== 'preregistered') return undefined;
        const { funded, open } = await preregPaymentState(reg.id, tx);
        // The sweep closes open payments first; one still open waits for the next tick.
        if (open) return undefined;

        if (!funded) {
          await tx.update(registration).set({ status: 'expired', updatedAt: new Date() })
            .where(and(eq(registration.id, reg.id), eq(registration.status, 'preregistered')));
          return { refunded: 0, gated: false };
        }
        await debitHeld(
          { studentId: reg.studentId, amount: reg.priceAtRegistration, reason: 'prereg_release', initiatedBy: reg.studentId, relatedRegistrationId: reg.id },
          tx
        );
        const drop = await executeReceiptGatedDrop(tx, {
          registrationId: reg.id,
          studentId: reg.studentId,
          refundAmount: reg.priceAtRegistration,
          refundReason: 'drop',
          initiatedBy: reg.studentId,
          fromStatus: 'preregistered',
        });
        await logAction(null, 'PREREG_REFUNDED_AT_DEADLINE', 'registration', reg.id, { status: 'preregistered' },
          { status: drop.gated ? 'dropped_pending_receipt' : 'dropped', refundAmount: drop.refundAmount, refundPercentage: 100, gated: drop.gated }, undefined, tx);
        return { refunded: drop.refundAmount, gated: drop.gated };
      });
      if (outcome) outcomes.push({ studentId: reg.studentId, subjectId: reg.subjectId, ...outcome });
    } catch (err) {
      logger.error(`[prereg] Deadline refund failed for registration ${reg.id}:`, err);
    }
  }
  return outcomes;
}

/**
 * Auto-capture on session activation (V3 §6.8 step 4). Idempotent —
 * status-guarded updates; safe to run on every scheduler tick.
 *
 * Funded preregs: held is debited by the locked price and the
 * registration confirms. Unfunded preregs: fall back to
 * pending_payment so the parent pays through the normal open-session
 * flow.
 */
export async function capturePreregistrationsForSession(sessionId: string): Promise<{
  captured: number;
  movedToPendingPayment: number;
}> {
  const preregs = await db.query.registration.findMany({
    where: (r, { eq, and }) =>
      and(eq(r.sessionId, sessionId), eq(r.status, 'preregistered')),
    columns: { id: true, studentId: true, priceAtRegistration: true },
  });

  let captured = 0;
  let movedToPendingPayment = 0;

  for (const reg of preregs) {
    try {
      // Lock the row, then ask whether it is paid for. Asked before the lock,
      // a confirmation committing in between moved a paid row to
      // pending_payment and stranded its held money (the MA-15 outcome).
      const outcome = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ status: registration.status })
          .from(registration)
          .where(eq(registration.id, reg.id))
          .for('update');
        if (row?.status !== 'preregistered') return 'skipped' as const;

        const { funded } = await preregPaymentState(reg.id, tx);
        await tx
          .update(registration)
          .set({ status: funded ? 'confirmed' : 'pending_payment', updatedAt: new Date() })
          .where(eq(registration.id, reg.id));
        if (!funded) return 'moved' as const;

        await debitHeld(
          {
            studentId: reg.studentId,
            amount: reg.priceAtRegistration,
            reason: 'prereg_capture',
            initiatedBy: reg.studentId,
            relatedRegistrationId: reg.id,
          },
          tx
        );
        return 'captured' as const;
      });
      if (outcome === 'captured') captured++;
      if (outcome === 'moved') movedToPendingPayment++;
    } catch (err) {
      // A single failed capture (e.g. insufficient held after manual
      // intervention) must not block the rest; the row stays
      // preregistered and the next tick retries.
      logger.error(`[prereg] Capture failed for registration ${reg.id}:`, err);
    }
  }

  return { captured, movedToPendingPayment };
}

/** Held-balance snapshot used by the escrow UI */
export async function getHeldSummary(studentId: string) {
  const balance = await getEscrowBalance(studentId);
  const account = await db.query.escrow.findFirst({
    where: (e, { eq }) => eq(e.studentId, studentId),
    columns: { heldBalance: true },
  });
  return { freeBalance: balance, heldBalance: account?.heldBalance ?? 0 };
}
