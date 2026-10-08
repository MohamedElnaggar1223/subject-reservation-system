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

import { db, registration, auditLog, eq, and, sql, notInArray } from '@repo/db';
import type { PreregisterRegistrationType } from '@repo/validations';
import { prepareLegacyLines, getExistingRegistrationSubjectIds } from './registration.services';
import { insertLines } from './line.services';
import { recheckLines, LineRuleError } from './line-rules.services';
import { effectiveDeadlineFor, linesKeptByLateEntry } from './deadline.services';
import { creditHeld, debitHeld, getEscrowBalance } from './escrow.services';
import { executeReceiptGatedDrop, lockReceiptOf } from './receipt.services';
import { refundFor } from './refund.services';
import { assertMayRegisterFor, assertMayRegisterForInTx, mayRegisterForInTx } from './eligibility.services';
import { notifyFinanceOfHeldPreregistration, notifyPreregistrationsRefundedAtDeadline } from './notification.services';
import { logger } from '../lib/logger';
import { logAction, logActions, expiryEntries, type AuditContext } from './audit.services';

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

  // F0a: call site 11 of mayRegisterFor — a preregistration is for a series
  // the student may sit (a grade-10 student preregisters only for June).
  const eligibility = await assertMayRegisterFor(data.studentId, data.sessionId);

  const sess = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, data.sessionId),
  });
  if (!sess) throw new Error('Session not found');
  if (sess.status !== 'draft') {
    throw new Error('Preregistration is only available for upcoming (not-yet-open) sessions');
  }

  const subjects = await db.query.subject.findMany({
    where: (s, { eq, and, inArray }) =>
      and(eq(s.isActive, true), inArray(s.id, data.subjectIds)),
  });
  if (subjects.length !== data.subjectIds.length) {
    throw new Error('One or more subjects are invalid or inactive');
  }
  const existing = await getExistingRegistrationSubjectIds(data.studentId, data.sessionId);
  if (data.subjectIds.some((id) => existing.includes(id))) {
    throw new Error('Some subjects are already preregistered for this session');
  }

  // The school-fee gate, then each subject as a line; past a line's deadline nothing more can
  // be entered (MO-10, per line). The price locks now (D-E).
  const lines = await prepareLegacyLines(data.studentId, data.sessionId, data.subjectIds, data.subjectOptions, eligibility);
  const now = new Date();
  // Asked again with the student and window held (F0a; see assertMayRegisterForInTx).
  return db.transaction(async (tx) => {
    await assertMayRegisterForInTx(tx, data.studentId, data.sessionId);
    return insertLines(tx, {
      studentId: data.studentId, sessionId: data.sessionId, lines, status: 'preregistered',
      requestedBy: parentId, approvedBy: parentId, approvedAt: now, eligibility,
    });
  });
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
export async function cancelPreregistration(registrationId: string, parentId: string, auditCtx?: AuditContext) {
  const reg = await db.query.registration.findFirst({
    where: (r, { eq }) => eq(r.id, registrationId),
    with: {
      session: { columns: { id: true, status: true } },
      // Its line's own deadline decides (MO-10, per line since the rework).
    },
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

  // Past the board's deadline the series never opens: the full price back, as
  // the deadline sweep gives — the refund windows are for a family's own
  // drop (MO-21; review of ae4f88b, flag 1).
  const deadline = await effectiveDeadlineFor(db, reg);
  const pastDeadline = !!deadline.at && deadline.at <= new Date();
  // Before it, the family's own drop: the line's refund (refundFor, §3.9) — a preregistration was
  // never confirmed, so its board fee was never sent and comes back in full.
  const quote = pastDeadline ? null : await refundFor(db, registrationId, new Date());
  const pct = quote ? quote.percent : 100;

  const result = await db.transaction(async (tx) => {
    // Lock the row, then decide. A payment still open for it means money may
    // be on its way: cancelling now dropped the row with nothing refunded and
    // left finance unable to confirm the transfer. Its receipt first (MA-16's order).
    await lockReceiptOf(tx, registrationId);
    await tx.select({ id: registration.id }).from(registration).where(eq(registration.id, registrationId)).for('update');
    const { funded, open } = await preregPaymentState(registrationId, tx);
    if (open) {
      throw new Error('A payment for this subject is in progress — cancel that checkout first, or wait for the finance office to confirm or reject the transfer');
    }
    const refundAmount = funded ? (quote ? quote.amount : round2(reg.priceAtRegistration)) : 0;

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

    const outcome = { success: true, funded, refundPercentage: funded ? pct : 0, ...dropOutcome };
    // The release, the refund and their audit row commit together (MO-1).
    await logAction(parentId, 'PREREG_CANCELLED', 'registration', registrationId, { status: 'preregistered' },
      { ...outcome, heldReleased: funded ? reg.priceAtRegistration : 0 }, auditCtx, tx);
    return outcome;
  });

  return result;
}

/**
 * One preregistration whose line's deadline has passed, settled as MO-21 says (owner decision,
 * 28 Sep): the series never opened for it, so a **paid** one releases its held money and is
 * dropped with a 100% refund on the receipt-gated path (paper handed over comes back first,
 * MA-16), with PREREG_REFUNDED_AT_DEADLINE; an **unfunded** one expires; one with a payment
 * still **open** is left for that payment's own deadline sweep. In the caller's transaction,
 * the row already locked. Shared by the deadline sweep and the capture (§3.3).
 */
async function settlePreregistrationAtDeadline(
  tx: Tx,
  reg: { id: string; studentId: string; priceAtRegistration: number },
): Promise<{ refunded: number; gated: boolean } | 'open'> {
  const { funded, open } = await preregPaymentState(reg.id, tx);
  if (open) return 'open';
  if (!funded) {
    await tx.update(registration).set({ status: 'expired', updatedAt: new Date() })
      .where(and(eq(registration.id, reg.id), eq(registration.status, 'preregistered')));
    await logActions(expiryEntries([{ id: reg.id, from: 'preregistered' }], 'preregistration_unfunded_at_deadline'), tx);
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
}

/**
 * A session still in draft when a line's deadline passes never opens for it (the scheduler will
 * not open the series' items, and the board takes no more entries), so its preregistrations in
 * that series past their deadline are settled as MO-21 says (settlePreregistrationAtDeadline).
 * Run by the deadline sweep for such a series; idempotent (only rows still preregistered move).
 */
export async function refundPreregistrationsAtDeadline(sessionId: string, boardSeriesId: string, now: Date = new Date()) {
  // Only the preregistrations entered in that series whose own deadline has passed (a late board
  // entry, Q-20, keeps its student's to its own date).
  const kept = await linesKeptByLateEntry(db, boardSeriesId, now);
  const preregs = await db.select({ id: registration.id, studentId: registration.studentId, subjectId: registration.subjectId, priceAtRegistration: registration.priceAtRegistration })
    .from(registration)
    .where(and(
      eq(registration.sessionId, sessionId), eq(registration.boardSeriesId, boardSeriesId), eq(registration.status, 'preregistered'),
      sql`line_effective_deadline(${registration.attempt}, ${registration.priorSittingSeriesId}, ${registration.boardSeriesId}) <= ${now}`,
      kept.length ? notInArray(registration.id, kept) : undefined,
    ));

  const outcomes: { studentId: string; subjectId: string; refunded: number; gated: boolean }[] = [];
  for (const reg of preregs) {
    try {
      const outcome = await db.transaction(async (tx) => {
        // The receipt before the row (MA-16's order): the settlement may drop it on the receipt-gated path.
        await lockReceiptOf(tx, reg.id);
        const [row] = await tx.select({ status: registration.status }).from(registration).where(eq(registration.id, reg.id)).for('update');
        if (row?.status !== 'preregistered') return undefined;
        const r = await settlePreregistrationAtDeadline(tx, reg);
        // The sweep closes open payments first; one still open waits for the next tick.
        return r === 'open' ? undefined : r;
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
 * Per row, with the student locked first (as every path that puts a line into a series, §6),
 * then the row:
 * 1. **The line's deadline first** (§3.3, §3.10 item 5): past it, the row is not captured — a paid
 *    one is refunded in full (MO-21: the series never opened for it), an unfunded one expires,
 *    one with an open payment is left for that payment's sweep, and one held as ineligible under
 *    SO-4 is left as it is (the owner's decision stands). So no held money is confirmed for an
 *    entry the board refuses.
 * 2. **Eligibility** (F0a): a student who may no longer sit the series is neither confirmed nor
 *    moved to payment — the row stays preregistered with its money held, one
 *    PREREG_HELD_INELIGIBLE row says why, and finance is told (SO-4). While the window is open, a
 *    held row is captured on a later tick if the student may sit the series again.
 * 3. Funded rows confirm with their held money captured; unfunded ones move to pending_payment.
 */
export async function capturePreregistrationsForSession(sessionId: string): Promise<{
  captured: number;
  movedToPendingPayment: number;
  heldIneligible: number;
  refundedAtDeadline: number;
}> {
  const preregs = await db.query.registration.findMany({
    where: (r, { eq, and }) =>
      and(eq(r.sessionId, sessionId), eq(r.status, 'preregistered')),
    columns: { id: true, studentId: true, subjectId: true, priceAtRegistration: true, boardSeriesId: true, attempt: true, priorSittingSeriesId: true },
  });

  let captured = 0;
  let movedToPendingPayment = 0;
  let heldIneligible = 0;
  const newlyHeld: { registrationId: string; held: number; reason: string }[] = [];
  const refunded: { studentId: string; subjectId: string; refunded: number; gated: boolean; deadline: Date }[] = [];

  for (const reg of preregs) {
    try {
      const outcome = await db.transaction(async (tx) => {
        // The student first (FOR NO KEY UPDATE, with the session and what the verdict rests on),
        // then the row; asked before the row's lock, a confirmation committing in between
        // moved a paid row to pending_payment and stranded its held money (the MA-15 outcome).
        const eligibility = await mayRegisterForInTx(tx, reg.studentId, sessionId);
        // The receipt before the row (MA-16's order): a row past its deadline is dropped on the receipt-gated path.
        await lockReceiptOf(tx, reg.id);
        const [row] = await tx
          .select({ status: registration.status })
          .from(registration)
          .where(eq(registration.id, reg.id))
          .for('update');
        if (row?.status !== 'preregistered') return 'skipped' as const;

        const [held] = await tx.select({ id: auditLog.id }).from(auditLog)
          .where(and(eq(auditLog.action, 'PREREG_HELD_INELIGIBLE'), eq(auditLog.entityId, reg.id))).limit(1);
        const deadline = await effectiveDeadlineFor(tx, reg);
        if (deadline.at && deadline.at <= new Date()) {
          // A row held under SO-4 is left as it is: refunding it is the owner's call.
          if (held) return 'held' as const;
          const r = await settlePreregistrationAtDeadline(tx, reg);
          if (r === 'open') return 'skipped' as const;
          refunded.push({ studentId: reg.studentId, subjectId: reg.subjectId, ...r, deadline: deadline.at });
          return 'refunded' as const;
        }

        const { funded } = await preregPaymentState(reg.id, tx);
        // The line rules asked again where the row is (§6: capture puts it into its series): a rule
        // it now breaks holds it, as an ineligible student's row is held (SO-4: the owner decides).
        let ruleRefusal: string | null = null;
        if (eligibility.allowed) {
          try {
            await recheckLines(tx, [reg.id]);
          } catch (err) {
            if (!(err instanceof LineRuleError)) throw err;
            ruleRefusal = err.message;
          }
        }
        if (!eligibility.allowed || ruleRefusal) {
          // Recorded once: the recovery sweep asks again every tick.
          if (held) return 'held' as const;
          const heldAmount = funded ? reg.priceAtRegistration : 0;
          const code = ruleRefusal ? 'line_rule' : eligibility.code;
          const reason = ruleRefusal ?? eligibility.reason;
          await logAction(null, 'PREREG_HELD_INELIGIBLE', 'registration', reg.id, { status: 'preregistered' },
            { status: 'preregistered', heldAmount, code, reason }, undefined, tx);
          newlyHeld.push({ registrationId: reg.id, held: heldAmount, reason: reason ?? code ?? 'held' });
          return 'held' as const;
        }
        await tx
          .update(registration)
          .set({ status: funded ? 'confirmed' : 'pending_payment', updatedAt: new Date() })
          .where(eq(registration.id, reg.id));
        // The move, the held money it takes, and their audit row commit together (SO-1).
        await logAction(null, 'PREREG_CAPTURED', 'registration', reg.id, { status: 'preregistered' },
          { status: funded ? 'confirmed' : 'pending_payment', heldCaptured: funded ? reg.priceAtRegistration : 0 }, undefined, tx);
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
      if (outcome === 'held') heldIneligible++;
    } catch (err) {
      // A single failed capture (e.g. insufficient held after manual
      // intervention) must not block the rest; the row stays
      // preregistered and the next tick retries.
      logger.error(`[prereg] Capture failed for registration ${reg.id}:`, err);
    }
  }

  for (const h of newlyHeld) {
    await notifyFinanceOfHeldPreregistration(h.registrationId, h.held, h.reason)
      .catch((err) => logger.error(`[prereg] Held-preregistration notice for ${h.registrationId} failed:`, err));
  }
  if (refunded.length) {
    const earliest = new Date(Math.min(...refunded.map((r) => r.deadline.getTime())));
    await notifyPreregistrationsRefundedAtDeadline(sessionId, earliest, refunded)
      .catch((err) => logger.error(`[prereg] Deadline refund notices for session ${sessionId} failed:`, err));
  }
  return { captured, movedToPendingPayment, heldIneligible, refundedAtDeadline: refunded.length };
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
