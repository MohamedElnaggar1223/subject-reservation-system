/**
 * After lines move to another series (an item's series change, the admin's move, a board change,
 * the session's series correction): what they cost is read from the new series' fee grid.
 *
 * A moved line keeps the price it was given only while it has a payment (open, failed or paid) or
 * is no longer waiting; every other moved line is re-priced on its board part against the fee rows
 * its item reads in the new series (the course part and the exceptions its basis recorded stay),
 * so that series' Confirm and Re-price reach it — a provisional line would otherwise never become
 * payable (RESERVATIONS_REWORK.md §3.4; the review of 977848d, flag 2). Where finance has set no
 * row in the new series, the old series' row comes across **provisional** (as copy-from does):
 * reservable, not payable until confirmed. Each re-priced line is audited (`LINE_REPRICED`), and
 * each family whose price changed is told after the move commits (`tellPriceChanged`).
 */

import { db, registration, paymentRegistration, boardFee, sessionOfferItem, sessionOfferItemFeeKey, subject, and, eq, inArray } from '@repo/db';
import { randomUUID } from 'crypto';
import { logAction, logActions } from './audit.services';
import { repriceBoardPart } from './pricing.services';
import { createNotification } from './notification.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const WAITING = ['pending_approval', 'pending_payment', 'preregistered'];

export type RepricedLine = { id: string; studentId: string; subjectId: string; from: number; to: number };

/**
 * The fee rows an item reads in the series it is now in, carried from the series it came from
 * where the new one has none (provisional, `copied_from_fee_id`, audited). Returns how many came.
 */
export async function carryFeeRows(tx: Tx, itemId: string, fromSeriesId: string | null, actorId: string | null, why: string) {
  const [item] = await tx.select({ seriesId: sessionOfferItem.boardSeriesId }).from(sessionOfferItem).where(eq(sessionOfferItem.id, itemId));
  if (!item?.seriesId || !fromSeriesId || item.seriesId === fromSeriesId) return 0;
  const keys = await tx.select().from(sessionOfferItemFeeKey).where(eq(sessionOfferItemFeeKey.itemId, itemId));
  let carried = 0;
  for (const k of keys) {
    const [there] = await tx.select({ id: boardFee.id }).from(boardFee)
      .where(and(eq(boardFee.boardSeriesId, item.seriesId), eq(boardFee.keyKind, k.keyKind), eq(boardFee.keyId, k.keyId)));
    if (there) continue;
    const [src] = await tx.select().from(boardFee)
      .where(and(eq(boardFee.boardSeriesId, fromSeriesId), eq(boardFee.keyKind, k.keyKind), eq(boardFee.keyId, k.keyId)));
    if (!src) continue;
    const [made] = await tx.insert(boardFee).values({
      id: randomUUID(), boardSeriesId: item.seriesId, keyKind: src.keyKind, unitId: src.unitId, qualificationOptionId: src.qualificationOptionId,
      qualificationId: src.qualificationId, subjectId: src.subjectId, amount: src.amount, provisional: true, confirmedAt: null,
      zeroReason: src.zeroReason, copiedFromFeeId: src.id, createdBy: actorId,
    }).onConflictDoNothing().returning({ id: boardFee.id });
    if (!made) continue;
    carried++;
    await logAction(actorId, 'BOARD_FEES_SET', 'board_fee', made.id, null,
      { boardSeriesId: item.seriesId, keyKind: src.keyKind, keyId: src.keyId, amount: src.amount, provisional: true, copiedFromFeeId: src.id,
        reason: `${why}: the fee of the series it came from, provisional until confirmed` }, undefined, tx);
  }
  return carried;
}

/**
 * Re-price moved lines the caller holds, in its transaction: a waiting line with no payment
 * history and a pricing basis is priced again on its board part from its item's fee rows now.
 * Throws when a row it needs is missing in the new series (the move is refused, naming the grid).
 */
export async function repriceMovedLines(tx: Tx, lineIds: string[], actorId: string | null, why: string): Promise<RepricedLine[]> {
  if (!lineIds.length) return [];
  const lines = await tx.select().from(registration).where(inArray(registration.id, lineIds)).orderBy(registration.id);
  const history = new Set((await tx.select({ id: paymentRegistration.registrationId }).from(paymentRegistration)
    .where(inArray(paymentRegistration.registrationId, lineIds))).map((h) => h.id));
  const out: RepricedLine[] = [];
  const now = new Date();
  for (const l of lines) {
    if (!WAITING.includes(l.status) || history.has(l.id) || !l.pricingBasis) continue;
    const next = await repriceBoardPart(tx, { offerItemId: l.offerItemId, pricingBasis: l.pricingBasis });
    if (!next) continue;
    await tx.update(registration).set({
      priceAtRegistration: next.total, courseFeeAtRegistration: next.courseFee, registrationFeeAtRegistration: next.registrationFee,
      priceProvisional: next.provisional, pricingBasis: next.basis as unknown as Record<string, unknown>, updatedAt: now,
    }).where(eq(registration.id, l.id));
    if (next.total !== l.priceAtRegistration || next.provisional !== l.priceProvisional) {
      await logActions([{
        userId: actorId, action: 'LINE_REPRICED' as const, entityType: 'registration' as const, entityId: l.id,
        previousData: { priceAtRegistration: l.priceAtRegistration, provisional: l.priceProvisional },
        newData: { priceAtRegistration: next.total, provisional: next.provisional, reason: why, part: 'board' },
      }], tx);
    }
    if (next.total !== l.priceAtRegistration) out.push({ id: l.id, studentId: l.studentId, subjectId: l.subjectId, from: l.priceAtRegistration, to: next.total });
  }
  return out;
}

/** Each family whose price a move changed is told the old and the new price (after the commit). */
export async function tellPriceChanged(lines: RepricedLine[], because: string) {
  if (!lines.length) return;
  const names = new Map((await db.select({ id: subject.id, name: subject.name }).from(subject)
    .where(inArray(subject.id, [...new Set(lines.map((l) => l.subjectId))]))).map((s) => [s.id, s.name]));
  for (const r of lines) {
    const subjectName = names.get(r.subjectId) ?? 'a subject';
    await createNotification(r.studentId, 'PRICE_CHANGED', `The price of ${subjectName} changed`,
      `${because}. ${subjectName} was ${r.from.toFixed(2)} EGP and is now ${r.to.toFixed(2)} EGP.`, { registrationId: r.id, from: r.from, to: r.to })
      .catch((err) => console.error('[line-moves] Price change notice failed:', err));
  }
}
