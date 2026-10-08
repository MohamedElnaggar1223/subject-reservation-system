/**
 * After lines move to another series (an item's series change, the admin's move, a board change,
 * the session's series correction): what they cost is read from the new series' fee grid.
 *
 * A moved line keeps the price it was given only while it has a payment history (a payment of any
 * status, a live instalment plan, a price adjustment or an instalment paid: lineIdsWithPaymentHistory) or
 * is no longer waiting; every other moved line is re-priced on its board part against the fee rows
 * its item reads in the new series (the course part and the exceptions its basis recorded stay),
 * so that series' Confirm and Re-price reach it — a provisional line would otherwise never become
 * payable (RESERVATIONS_REWORK.md §3.4; the review of 977848d, flag 2). Where finance has set no
 * row in the new series, the old series' row comes across **provisional** (as copy-from does):
 * reservable, not payable until confirmed. Each re-priced line is audited (`LINE_REPRICED`), and
 * each family whose price changed, or whose price became one to be confirmed, is told after the
 * move commits (`tellPriceChanged`).
 *
 * A move takes what its lines will read in Confirm's order — the target series' fee grid (shared:
 * lib/fee-grid-lock.ts), the fee rows (FOR SHARE), then the lines (`lockMoveFeeRows` before the
 * lines' FOR UPDATE): a Confirm or a fee row's creation in that series either commits first (the
 * move reads it) or waits for the move, and a Confirm then finds the moved lines by their basis, so
 * no moved line is left provisional on a confirmed row (the review of 40c1447;
 * docs/features/RESERVATIONS.md §2.1, §2.12).
 */

import { db, registration, boardFee, sessionOfferItemFeeKey, subject, sql, and, eq, inArray } from '@repo/db';
import { lineIdsWithPaymentHistory } from './line-history.services';
import { randomUUID } from 'crypto';
import { logAction, logActions } from './audit.services';
import { repriceBoardPart } from './pricing.services';
import { createNotification } from './notification.services';
import { lockFeeGrids } from '../lib/fee-grid-lock';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const WAITING = ['pending_approval', 'pending_payment', 'preregistered'];

/** A moved line whose price changed, or became one to be confirmed (`provisional` and not `wasProvisional`). */
export type RepricedLine = { id: string; studentId: string; subjectId: string; from: number; to: number; wasProvisional: boolean; provisional: boolean };

/** Fee rows by series and key, locked FOR SHARE in id order (the rows that exist; returns their ids). */
export async function lockFeeRows(tx: Tx, wanted: { seriesId: string; keyKind: string; keyId: string }[]) {
  if (!wanted.length) return [];
  const r = await tx.execute(sql`
    select f.id from board_fee f
    join (values ${sql.join(wanted.map((w) => sql`(${w.seriesId}, ${w.keyKind}, ${w.keyId})`), sql`, `)}) as w(series_id, key_kind, key_id)
      on w.series_id = f.board_series_id and w.key_kind = f.key_kind and w.key_id = f.key_id
    order by f.id
    for share of f`);
  return (r.rows as { id: string }[]).map((x) => x.id);
}

/**
 * Before a move locks its lines: the fee grids of the series it goes to, shared (no fee row is
 * created or confirmed there until the move commits: lib/fee-grid-lock.ts), then the fee rows each
 * item will read there, FOR SHARE — after carrying the old series' rows across where the new one
 * has none, so the rows the lines are priced from are all held (see the header).
 */
export async function lockMoveFeeRows(
  tx: Tx, moves: { itemId: string; fromSeriesId: string | null; toSeriesId: string | null }[], actorId: string | null, why: string,
) {
  await lockFeeGrids(tx, moves.map((m) => m.toSeriesId), 'shared');
  for (const m of moves) await carryFeeRows(tx, m.itemId, m.fromSeriesId, m.toSeriesId, actorId, why);
  const itemIds = [...new Set(moves.filter((m) => m.toSeriesId).map((m) => m.itemId))];
  if (!itemIds.length) return [];
  const keys = await tx.select().from(sessionOfferItemFeeKey).where(inArray(sessionOfferItemFeeKey.itemId, itemIds));
  const wanted = new Map<string, { seriesId: string; keyKind: string; keyId: string }>();
  for (const m of moves) {
    if (!m.toSeriesId) continue;
    for (const k of keys.filter((x) => x.itemId === m.itemId)) wanted.set(`${m.toSeriesId}|${k.keyKind}|${k.keyId}`, { seriesId: m.toSeriesId, keyKind: k.keyKind, keyId: k.keyId });
  }
  return lockFeeRows(tx, [...wanted.values()]);
}

/**
 * The fee rows an item reads in the series it goes to, carried from the series it came from
 * where the new one has none (provisional, `copied_from_fee_id`, audited). Returns how many came.
 */
export async function carryFeeRows(tx: Tx, itemId: string, fromSeriesId: string | null, toSeriesId: string | null, actorId: string | null, why: string) {
  if (!toSeriesId || !fromSeriesId || toSeriesId === fromSeriesId) return 0;
  const keys = await tx.select().from(sessionOfferItemFeeKey).where(eq(sessionOfferItemFeeKey.itemId, itemId));
  let carried = 0;
  for (const k of keys) {
    const [there] = await tx.select({ id: boardFee.id }).from(boardFee)
      .where(and(eq(boardFee.boardSeriesId, toSeriesId), eq(boardFee.keyKind, k.keyKind), eq(boardFee.keyId, k.keyId)));
    if (there) continue;
    const [src] = await tx.select().from(boardFee)
      .where(and(eq(boardFee.boardSeriesId, fromSeriesId), eq(boardFee.keyKind, k.keyKind), eq(boardFee.keyId, k.keyId)));
    if (!src) continue;
    const [made] = await tx.insert(boardFee).values({
      id: randomUUID(), boardSeriesId: toSeriesId, keyKind: src.keyKind, unitId: src.unitId, qualificationOptionId: src.qualificationOptionId,
      qualificationId: src.qualificationId, subjectId: src.subjectId, amount: src.amount, provisional: true, confirmedAt: null,
      zeroReason: src.zeroReason, copiedFromFeeId: src.id, createdBy: actorId,
    }).onConflictDoNothing().returning({ id: boardFee.id });
    if (!made) continue;
    carried++;
    await logAction(actorId, 'BOARD_FEES_SET', 'board_fee', made.id, null,
      { boardSeriesId: toSeriesId, keyKind: src.keyKind, keyId: src.keyId, amount: src.amount, provisional: true, copiedFromFeeId: src.id,
        reason: `${why}: the fee of the series it came from, provisional until confirmed` }, undefined, tx);
  }
  return carried;
}

/**
 * Re-price moved lines the caller holds, in its transaction: a waiting line with no payment
 * history and a pricing basis is priced again on its board part from its item's fee rows now.
 * Throws when a row it needs is missing in the new series (the move is refused, naming the grid).
 * Returns the lines whose price changed or became one to be confirmed (the families to tell).
 */
export async function repriceMovedLines(tx: Tx, lineIds: string[], actorId: string | null, why: string): Promise<RepricedLine[]> {
  if (!lineIds.length) return [];
  const lines = await tx.select().from(registration).where(inArray(registration.id, lineIds)).orderBy(registration.id);
  // A payment of the line, a live plan on it, or a price adjustment or an instalment paid or being paid (step C).
  const history = await lineIdsWithPaymentHistory(tx, lineIds);
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
    if (next.total !== l.priceAtRegistration || (next.provisional && !l.priceProvisional)) {
      out.push({ id: l.id, studentId: l.studentId, subjectId: l.subjectId, from: l.priceAtRegistration, to: next.total, wasProvisional: l.priceProvisional, provisional: next.provisional });
    }
  }
  return out;
}

/**
 * After the move commits: each family whose price it changed is told the old and the new price;
 * one whose price stayed but became one to be confirmed (the new series' fee is not confirmed
 * yet) is told it cannot be paid until the school confirms that fee.
 */
export async function tellPriceChanged(lines: RepricedLine[], because: string) {
  if (!lines.length) return;
  const names = new Map((await db.select({ id: subject.id, name: subject.name }).from(subject)
    .where(inArray(subject.id, [...new Set(lines.map((l) => l.subjectId))]))).map((s) => [s.id, s.name]));
  const toConfirm = 'it can be paid once the school confirms the board fee in its new series';
  for (const r of lines) {
    const subjectName = names.get(r.subjectId) ?? 'a subject';
    const turned = r.provisional && !r.wasProvisional;
    const send = r.from !== r.to
      ? createNotification(r.studentId, 'PRICE_CHANGED', `The price of ${subjectName} changed`,
        `${because}. ${subjectName} was ${r.from.toFixed(2)} EGP and is now ${r.to.toFixed(2)} EGP${turned ? `, to be confirmed: ${toConfirm}` : ''}.`,
        { registrationId: r.id, from: r.from, to: r.to, provisional: r.provisional })
      : createNotification(r.studentId, 'PRICE_TO_BE_CONFIRMED', `The price of ${subjectName} is to be confirmed`,
        `${because}. ${subjectName} stays at ${r.to.toFixed(2)} EGP, to be confirmed: ${toConfirm}.`,
        { registrationId: r.id, price: r.to, provisional: true });
    await send.catch((err) => console.error('[line-moves] Price notice failed:', err));
  }
}
