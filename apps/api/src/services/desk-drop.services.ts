/**
 * The desk drops a line past its deadline (RESERVATIONS_REWORK.md §3.3, §5; docs/features/
 * RESERVATIONS.md §2.11).
 *
 * Past a line's effective deadline its entry is with the board, so a family's own drop or swap is
 * refused and the family is sent to the finance desk. The desk (finance officer, finance admin,
 * admin) drops it here, with a reason: through the receipt-gated drop (the paper handed over must
 * come back before the refund is credited, MA-16), refunded by refundFor at that moment — the
 * course fee by the line's policy, the board fee by the per-line "sent" rule (a line confirmed
 * and past its deadline was sent: its board fee stays with the board). F4's withdrawal of the
 * line's entries from the board runs here, in the drop's transaction (the seam `withdrawEntry`).
 *
 * In one transaction: the receipt and the line locked (the order a drop and a reversal take), the
 * drop, the refund or its parking, DESK_DROP_EXECUTED; the family is told after the commit.
 */

import { db, registration, changeRequest, receipt, eq, and } from '@repo/db';
import { logAction, type AuditContext } from './audit.services';
import { executeReceiptGatedDrop, lockReceiptOf } from './receipt.services';
import { refundFor, refundSentence } from './refund.services';
import { effectiveDeadlineFor } from './deadline.services';
import { mayRegisterFor } from './eligibility.services';
import { schoolDate } from './window.services';
import { tellFamily } from './plan.services';
import { withdrawEntriesOfLineInTx, tellWithdrawn } from './exam-entry.services';

export class DeskDropError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

/**
 * F4's seam, wired by F4 on resuming (RESERVATIONS_MONEY.md §10): the line's live exam entries are
 * withdrawn from the board in the drop's own transaction, after the receipt and the line (F4's
 * `withdrawEntriesOfLineInTx`: each with the board's fee sentence and its EXAM_ENTRY_WITHDRAWN
 * row). What the family gets back is the drop's refund, never the board's.
 */
export async function withdrawEntry(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], lineId: string, reason: string, staffId: string, ctx?: AuditContext) {
  return withdrawEntriesOfLineInTx(tx, lineId, reason, staffId, ctx);
}

export async function deskDrop(registrationId: string, staffId: string, reason: string, ctx?: AuditContext) {
  const [reg] = await db.select().from(registration).where(eq(registration.id, registrationId));
  if (!reg) throw new DeskDropError('Registration not found', 404);
  if (reg.status !== 'confirmed') throw new DeskDropError(`Only a paid line is dropped at the desk (this one is ${reg.status.replace(/_/g, ' ')})`, 409);
  const now = new Date();
  const deadline = await effectiveDeadlineFor(db, reg);
  if (!deadline.at || deadline.at > now) {
    throw new DeskDropError(`This line's deadline${deadline.at ? ` (${schoolDate(deadline.at)})` : ''} has not passed: the family drops it themselves, or the desk uses the ordinary drop`, 409);
  }
  // The core-subject lock holds at the desk too (SWAP-005): grade 10's June core subjects stay.
  const [sess] = await db.query.registrationSession.findMany({ where: (s, { eq: e }) => e(s.id, reg.sessionId), columns: { sessionType: true } });
  if (reg.wasCoreAtRegistration && sess?.sessionType === 'june' && (await mayRegisterFor(reg.studentId, reg.sessionId)).grade === 10) {
    throw new DeskDropError('Core subjects cannot be dropped or swapped for Grade 10 students (SWAP-005)', 409);
  }
  const pending = await db.select({ id: changeRequest.id }).from(changeRequest)
    .where(and(eq(changeRequest.registrationId, registrationId), eq(changeRequest.status, 'pending_approval')));
  if (pending.length) throw new DeskDropError('A drop or swap request is pending on this line: the parent answers it, or the student cancels it, first', 409);

  let withdrawn: Awaited<ReturnType<typeof withdrawEntry>> = [];
  let quote = null as Awaited<ReturnType<typeof refundFor>> | null;
  const result = await db.transaction(async (tx) => {
    // The receipt, then the line (MA-16's order), and only then the price (the review of 093dbd1,
    // item 4): the refund locks now (V3 §6.12), the course fee by the policy, the board fee by "sent".
    await lockReceiptOf(tx, registrationId);
    await tx.select({ id: registration.id }).from(registration).where(eq(registration.id, registrationId)).for('update');
    quote = await refundFor(tx, registrationId, now);
    const drop = await executeReceiptGatedDrop(tx, {
      registrationId, studentId: reg.studentId, refundAmount: quote.amount, refundReason: 'drop', initiatedBy: staffId,
    });
    // The board's entries of the line withdrawn with it (F4), after the receipt and the line the drop holds.
    withdrawn = await withdrawEntry(tx, registrationId, reason, staffId, ctx);
    const [rc] = await tx.select({ receiptNumber: receipt.receiptNumber }).from(receipt).where(eq(receipt.registrationId, registrationId));
    const outcome = {
      success: true, ...drop, refundPercentage: quote.percent, refundCoursePart: quote.coursePart, refundBoardPart: quote.boardPart,
      boardSent: quote.boardSent, boardNote: quote.boardNote, deadline: deadline.at!.toISOString(), reason, receiptNumber: rc?.receiptNumber ?? null,
      entriesWithdrawn: withdrawn.map((w) => ({ entryId: w.entry.id, entryCode: w.entry.entryCode, wasSent: w.wasSent, boardFee: w.charge.sentence })),
    };
    // The drop, its refund (or its parking on the receipt) and their audit row commit together (MO-1).
    await logAction(staffId, 'DESK_DROP_EXECUTED', 'registration', registrationId, { status: 'confirmed' }, outcome, ctx, tx);
    await tellFamily(tx, reg.studentId, 'DROP_SWAP_PROCESSED', 'A subject was dropped at the finance desk',
      drop.gated
        ? `The subject was dropped at the finance desk (${reason}). ${refundSentence(quote)} will be credited once its receipt ${rc?.receiptNumber ?? ''} is returned to the school.`
        : `The subject was dropped at the finance desk (${reason}). ${quote.amount > 0 ? `${refundSentence(quote)} was credited to the escrow balance.` : 'No refund applies.'}${quote.boardSent ? ` ${quote.boardNote ?? 'The board fee stays with the board: the entry had been sent.'}` : ''}`,
      { registrationId });
    return outcome;
  });
  await tellWithdrawn(withdrawn, reason).catch((err) => console.error('[desk-drop] Could not tell the family of the withdrawn entries:', err));
  return result;
}
