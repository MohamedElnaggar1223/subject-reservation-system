/**
 * The boards' fees per series (RESERVATIONS_REWORK.md §3.4, §4.2 Fees tab; docs/features/RESERVATIONS.md §1.5).
 *
 * A series' fee grid is the board's fee list: one row per unit, option code, qualification or
 * (unmapped) subject row, with its amount. A row copied from an earlier series, or typed before
 * the board publishes, is **provisional**: a line priced from it can be reserved, is marked
 * `price_provisional`, and cannot be paid (unless `pricing.payOnProvisionalFee`). "Confirm"
 * clears it, at the same amount or another. When the amount differs, "Re-price unpaid lines"
 * re-prices the board part of every line of that key with **no payment history at all**, with
 * the exceptions its basis recorded; every other line is listed, not touched (a difference on it
 * is finance's explicit act). The re-price locks the lines FOR UPDATE first and reads their
 * payment history after, so a checkout committing while it waits is seen.
 */

import {
  db, boardSeries, boardFee, examBoard, examUnit, qualification, qualificationOption, subject, registration,
  sessionOfferItem, sessionOfferItemFeeKey, sessionOffer, registrationSession,
  and, or, eq, inArray, sql, asc,
} from '@repo/db';
import { paymentHistoryOf, PAYMENT_HISTORY_REASON } from './line-history.services';
import { randomUUID } from 'crypto';
import type { PutBoardFeesType, ConfirmBoardFeesType, RepriceBoardFeesType, PricingBasis } from '@repo/validations';
import { logAction, logActions, type AuditContext } from './audit.services';
import { boardSeriesName } from './series.services';
import { repriceBoardPart, round2 } from './pricing.services';
import { dueDateFor } from './deadline.services';
import { createNotification } from './notification.services';
import { lockFeeGrids } from '../lib/fee-grid-lock';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export class BoardFeeError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

const WAITING = ['pending_approval', 'pending_payment', 'preregistered'] as const;
const LIVE = ['pending_approval', 'pending_payment', 'preregistered', 'confirmed', 'dropped_pending_receipt'] as const;

async function seriesOrThrow(executor: Executor, seriesId: string) {
  const [s] = await executor.select().from(boardSeries).where(eq(boardSeries.id, seriesId));
  if (!s) throw new BoardFeeError('Board series not found', 404);
  const names = new Map((await executor.select({ code: examBoard.code, name: examBoard.name }).from(examBoard)).map((b) => [b.code, b.name]));
  return { series: s, name: boardSeriesName(names, s), boardName: names.get(s.boardCode) ?? s.boardCode };
}

/** What a key is, as the fee list names it: "WMA11 P1", "0970 CX", "4HB1", a subject's code. */
async function keyLabels(executor: Executor, keys: { kind: string; id: string }[]) {
  const ids = (k: string) => [...new Set(keys.filter((x) => x.kind === k).map((x) => x.id))];
  const [units, options, quals, subjects] = await Promise.all([
    ids('unit').length ? executor.select({ id: examUnit.id, code: examUnit.code, shortCode: examUnit.shortCode, title: examUnit.title }).from(examUnit).where(inArray(examUnit.id, ids('unit'))) : [],
    ids('option').length ? executor.select({ id: qualificationOption.id, code: qualificationOption.code, label: qualificationOption.label, qCode: qualification.code, qTitle: qualification.title, level: qualification.level })
      .from(qualificationOption).innerJoin(qualification, eq(qualification.id, qualificationOption.qualificationId)).where(inArray(qualificationOption.id, ids('option'))) : [],
    ids('qualification').length ? executor.select({ id: qualification.id, code: qualification.code, title: qualification.title, level: qualification.level }).from(qualification).where(inArray(qualification.id, ids('qualification'))) : [],
    ids('subject').length ? executor.select({ id: subject.id, code: subject.code, name: subject.name }).from(subject).where(inArray(subject.id, ids('subject'))) : [],
  ]);
  const out = new Map<string, { code: string; title: string }>();
  for (const u of units) out.set(`unit|${u.id}`, { code: u.code, title: u.shortCode ? `${u.shortCode} — ${u.title}` : u.title });
  for (const o of options) out.set(`option|${o.id}`, { code: `${o.qCode} ${o.code}`, title: `${o.qTitle} — ${o.label}` });
  for (const q of quals) out.set(`qualification|${q.id}`, { code: q.code, title: q.title });
  for (const s of subjects) out.set(`subject|${s.id}`, { code: s.code, title: s.name });
  return out;
}

/**
 * A series' grid (§4.2 Fees tab): its rows with their labels and the lines priced from each,
 * and the keys its items read that have no row yet ("no fee" — those items cannot be reserved).
 */
export async function getFeeGrid(seriesId: string) {
  const { series, name, boardName } = await seriesOrThrow(db, seriesId);
  const rows = await db.select().from(boardFee).where(eq(boardFee.boardSeriesId, seriesId)).orderBy(asc(boardFee.keyKind), asc(boardFee.keyId));
  const used = await db.select({ keyKind: sessionOfferItemFeeKey.keyKind, keyId: sessionOfferItemFeeKey.keyId, itemId: sessionOfferItem.id, label: sessionOfferItem.label,
    subjectName: subject.name, sessionName: registrationSession.name, availability: sessionOfferItem.availability })
    .from(sessionOfferItemFeeKey)
    .innerJoin(sessionOfferItem, eq(sessionOfferItem.id, sessionOfferItemFeeKey.itemId))
    .innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId))
    .innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
    .innerJoin(registrationSession, eq(registrationSession.id, sessionOfferItem.sessionId))
    .where(and(eq(sessionOfferItem.boardSeriesId, seriesId), sql`${registrationSession.status} <> 'closed'`));
  const labels = await keyLabels(db, [...rows.map((r) => ({ kind: r.keyKind, id: r.keyId })), ...used.map((u) => ({ kind: u.keyKind, id: u.keyId }))]);
  // Lines priced from each row, and those whose recorded amount differs from the row now (to re-price).
  const lineRows = rows.length ? await db.execute(sql`
    select f.id as fee_id, r.id, r.status, (fr->>'amount')::numeric as recorded
    from board_fee f
    join registration r on r.pricing_basis is not null
    cross join lateral jsonb_array_elements(r.pricing_basis->'feeRows') fr
    where f.board_series_id = ${seriesId} and fr->>'id' = f.id`).then((x) => x.rows as { fee_id: string; id: string; status: string; recorded: string }[]) : [];
  // The re-price's own test of a payment history (a payment, a live plan, a price adjustment or an
  // instalment paid toward the line: line-history.services.ts), so the count is what it will do.
  const history = await paymentHistoryOf(db, [...new Set(lineRows.map((l) => l.id))]);
  const out = rows.map((r) => {
    const mine = lineRows.filter((l) => l.fee_id === r.id && (LIVE as readonly string[]).includes(l.status))
      .map((l) => ({ ...l, has_payment: history.has(l.id) }));
    const differ = mine.filter((l) => Number(l.recorded) !== r.amount);
    return {
      ...r,
      code: labels.get(`${r.keyKind}|${r.keyId}`)?.code ?? r.keyId,
      title: labels.get(`${r.keyKind}|${r.keyId}`)?.title ?? '',
      items: used.filter((u) => u.keyKind === r.keyKind && u.keyId === r.keyId).map((u) => ({ itemId: u.itemId, label: u.label, subjectName: u.subjectName, sessionName: u.sessionName })),
      lines: mine.length,
      // What "Re-price unpaid lines" would do for this row: re-price these, list the others.
      toReprice: differ.filter((l) => !l.has_payment && (WAITING as readonly string[]).includes(l.status)).length,
      toList: differ.filter((l) => l.has_payment || !(WAITING as readonly string[]).includes(l.status)).length,
    };
  });
  const missing = used
    .filter((u) => u.availability !== 'closed' && !rows.some((r) => r.keyKind === u.keyKind && r.keyId === u.keyId))
    .map((u) => ({ keyKind: u.keyKind, keyId: u.keyId, code: labels.get(`${u.keyKind}|${u.keyId}`)?.code ?? u.keyId, title: labels.get(`${u.keyKind}|${u.keyId}`)?.title ?? '', itemLabel: u.label, subjectName: u.subjectName, sessionName: u.sessionName }));
  // Waiting lines read from this series' rows that are still provisional though every row their
  // basis names is confirmed at the amount they recorded: not payable, and no Confirm left to make
  // them so (09's rule; none should exist — the screen shows any, and "Confirm again" settles them).
  const stuck = rows.length ? await db.execute(sql`
    select r.id, r.student_id as "studentId", u.name as "studentName", s.name as "subjectName", w.name as "sessionName",
      r.price_at_registration::float as price,
      (select array_agg(distinct f.id) from jsonb_array_elements(r.pricing_basis->'feeRows') fr join board_fee f on f.id = fr->>'id'
        where f.board_series_id = ${seriesId}) as "feeIds"
    from registration r
    join "user" u on u.id = r.student_id join subject s on s.id = r.subject_id join registration_session w on w.id = r.session_id
    where r.price_provisional and r.status in ('pending_approval', 'pending_payment', 'preregistered')
      and jsonb_array_length(coalesce(r.pricing_basis->'feeRows', '[]'::jsonb)) > 0
      and exists (select 1 from jsonb_array_elements(r.pricing_basis->'feeRows') fr join board_fee f on f.id = fr->>'id' where f.board_series_id = ${seriesId})
      and not exists (select 1 from jsonb_array_elements(r.pricing_basis->'feeRows') fr left join board_fee f on f.id = fr->>'id'
        where f.id is null or f.provisional or f.amount <> (fr->>'amount')::numeric)
    order by w.name, s.name, u.name`).then((x) => x.rows as {
      id: string; studentId: string; studentName: string; subjectName: string; sessionName: string; price: number; feeIds: string[];
    }[]) : [];
  // The board's other series a grid can be copied from (earlier first).
  const others = await db.select().from(boardSeries).where(and(eq(boardSeries.boardCode, series.boardCode), sql`${boardSeries.id} <> ${seriesId}`))
    .orderBy(sql`${boardSeries.year} desc`, sql`school_month_order(${boardSeries.month}) desc`);
  const counts = others.length ? await db.select({ id: boardFee.boardSeriesId, n: sql<number>`count(*)::int` }).from(boardFee).where(inArray(boardFee.boardSeriesId, others.map((o) => o.id))).groupBy(boardFee.boardSeriesId) : [];
  return {
    series: { ...series, name, boardName },
    rows: out,
    missing: [...new Map(missing.map((m) => [`${m.keyKind}|${m.keyId}`, m])).values()],
    stuck,
    copyFrom: others.filter((o) => counts.some((c) => c.id === o.id)).map((o) => ({ id: o.id, name: boardSeriesName(new Map([[series.boardCode, boardName]]), o), rows: counts.find((c) => c.id === o.id)!.n })),
  };
}

const keyColumns = (kind: string, id: string) => ({
  unitId: kind === 'unit' ? id : null,
  qualificationOptionId: kind === 'option' ? id : null,
  qualificationId: kind === 'qualification' ? id : null,
  subjectId: kind === 'subject' ? id : null,
});

/** A key must be of the series' board (a subject row: entered with it). */
async function assertKeysOfBoard(tx: Tx, boardCode: string, rows: { keyKind: string; keyId: string }[]) {
  for (const r of rows) {
    const board = r.keyKind === 'unit'
      ? (await tx.select({ b: examUnit.boardCode }).from(examUnit).where(eq(examUnit.id, r.keyId)))[0]?.b
      : r.keyKind === 'option'
        ? (await tx.select({ b: qualification.boardCode }).from(qualificationOption).innerJoin(qualification, eq(qualification.id, qualificationOption.qualificationId)).where(eq(qualificationOption.id, r.keyId)))[0]?.b
        : r.keyKind === 'qualification'
          ? (await tx.select({ b: qualification.boardCode }).from(qualification).where(eq(qualification.id, r.keyId)))[0]?.b
          : (await tx.select({ b: subject.council }).from(subject).where(eq(subject.id, r.keyId)))[0]?.b;
    if (!board) throw new BoardFeeError(`${r.keyKind} ${r.keyId} was not found`, 404);
    if (board !== boardCode) throw new BoardFeeError('A fee row is for the series\' own board');
  }
}

/**
 * Set rows of a grid: a new key is added (provisional when typed before the board publishes), a
 * provisional row's amount changes; a confirmed row changes only by "Confirm" at another amount.
 * A provisional row put as published (the grid's "published fees" save, a pasted published list)
 * is confirmed as Confirm confirms it: the lines priced from it are settled the same way.
 * The series' fee grid is taken exclusive first (§2.1: a move into it waits, or it waits for one).
 */
export async function putFees(seriesId: string, data: PutBoardFeesType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(boardSeries).where(eq(boardSeries.id, seriesId)).for('share');
    if (!s) throw new BoardFeeError('Board series not found', 404);
    await lockFeeGrids(tx, [seriesId], 'exclusive');
    await assertKeysOfBoard(tx, s.boardCode, data.rows);
    const now = new Date();
    const changed: Record<string, unknown>[] = [];
    const confirmedByPut: string[] = [];
    // The rows the request names that exist, FOR UPDATE in one statement in id order (as Confirm
    // takes them; a reservation takes its rows FOR SHARE in id order): a paste out of id order
    // never locks them one by one against it (the review of 40c1447..af33662, item 4).
    const existing = data.rows.length ? await tx.select().from(boardFee)
      .where(and(eq(boardFee.boardSeriesId, seriesId), or(...data.rows.map((r) => and(eq(boardFee.keyKind, r.keyKind), eq(boardFee.keyId, r.keyId))))))
      .orderBy(boardFee.id).for('update') : [];
    for (const r of data.rows) {
      if (r.amount === 0 && !r.zeroReason) throw new BoardFeeError('A fee of 0 needs a reason (why the board charges nothing)');
      const cur = existing.find((x) => x.keyKind === r.keyKind && x.keyId === r.keyId);
      if (!cur) {
        const id = randomUUID();
        await tx.insert(boardFee).values({
          id, boardSeriesId: seriesId, keyKind: r.keyKind, ...keyColumns(r.keyKind, r.keyId), amount: r.amount,
          provisional: r.provisional, confirmedAt: r.provisional ? null : now, confirmedBy: r.provisional ? null : actorId,
          zeroReason: r.amount === 0 ? r.zeroReason ?? null : null, createdBy: actorId,
        });
        changed.push({ id, keyKind: r.keyKind, keyId: r.keyId, amount: r.amount, provisional: r.provisional });
        continue;
      }
      if (!cur.provisional && cur.amount !== r.amount) {
        throw new BoardFeeError('A confirmed fee changes only by "Confirm" at the new amount (the lines priced from it are then re-priced or listed)', 409);
      }
      if (cur.amount === r.amount && cur.provisional === (r.provisional && cur.provisional)) continue;
      const toConfirm = cur.provisional && !r.provisional;
      await tx.update(boardFee).set({
        amount: r.amount, zeroReason: r.amount === 0 ? r.zeroReason ?? null : null, updatedAt: now,
        ...(toConfirm ? { provisional: false, confirmedAt: now, confirmedBy: actorId } : {}),
      }).where(eq(boardFee.id, cur.id));
      if (toConfirm) confirmedByPut.push(cur.id);
      changed.push({ id: cur.id, keyKind: r.keyKind, keyId: r.keyId, amount: r.amount, before: cur.amount, provisional: !toConfirm && cur.provisional });
    }
    // Confirmed by the put: its lines settled as Confirm settles them (the rows, then the lines).
    const settled = await settleLinesOfConfirmed(tx, confirmedByPut, actorId, now);
    if (changed.length) {
      await logAction(actorId, 'BOARD_FEES_SET', 'board_series', seriesId, null,
        { rows: changed, reason: data.reason ?? null, linesNoLongerProvisional: settled.cleared, dueDatesMoved: settled.moved }, ctx, tx);
    }
    return { changed: changed.length, linesNoLongerProvisional: settled.cleared };
  });
}

/** Copy the grid of an earlier series of the board: every row provisional (where this one has none). */
export async function copyFees(seriesId: string, fromSeriesId: string, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [to] = await tx.select().from(boardSeries).where(eq(boardSeries.id, seriesId)).for('share');
    const [from] = await tx.select().from(boardSeries).where(eq(boardSeries.id, fromSeriesId));
    if (!to || !from) throw new BoardFeeError('Board series not found', 404);
    await lockFeeGrids(tx, [seriesId], 'exclusive');
    if (to.boardCode !== from.boardCode) throw new BoardFeeError('Copy from a series of the same board');
    const rows = await tx.select().from(boardFee).where(eq(boardFee.boardSeriesId, fromSeriesId));
    let copied = 0;
    for (const r of rows) {
      const made = await tx.insert(boardFee).values({
        id: randomUUID(), boardSeriesId: seriesId, keyKind: r.keyKind, ...keyColumns(r.keyKind, r.keyId), amount: r.amount,
        provisional: true, confirmedAt: null, zeroReason: r.zeroReason, copiedFromFeeId: r.id, createdBy: actorId,
      }).onConflictDoNothing().returning({ id: boardFee.id });
      copied += made.length;
    }
    await logAction(actorId, 'BOARD_FEES_COPIED', 'board_series', seriesId, null, { fromSeriesId, copied, provisional: true }, ctx, tx);
    return { copied, skipped: rows.length - copied };
  });
}

/**
 * Lines priced from these fee rows that are still live, locked FOR UPDATE in id order — first,
 * before anything about their payments is read (§3.4: a checkout committing while this waits is
 * then seen).
 */
/**
 * The lines priced from these rows, locked in id order: found by the rows their pricing basis
 * recorded, wherever the line is entered now (a line that moved with a payment keeps its record,
 * and its old series' Confirm and Re-price still reach it — the review of 977848d, flag 2).
 */
async function lockLinesOfFees(tx: Tx, feeIds: string[]) {
  if (!feeIds.length) return [];
  const ids = await tx.execute(sql`
    select distinct r.id from registration r
    cross join lateral jsonb_array_elements(coalesce(r.pricing_basis->'feeRows', '[]'::jsonb)) fr
    where r.status in ('pending_approval', 'pending_payment', 'preregistered', 'confirmed', 'dropped_pending_receipt')
      and fr->>'id' in (${sql.join(feeIds.map((id) => sql`${id}`), sql`, `)})`).then((x) => (x.rows as { id: string }[]).map((r) => r.id));
  if (!ids.length) return [];
  return tx.select().from(registration).where(inArray(registration.id, ids)).orderBy(registration.id).for('update');
}

/**
 * Confirm rows (the board published), at their amount or another. A line priced from rows that
 * are now all confirmed at the amounts it recorded is no longer provisional, and its due date
 * moves (§3.1); a line whose recorded amount differs stays provisional until "Re-price".
 */
export async function confirmFees(seriesId: string, data: ConfirmBoardFeesType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(boardSeries).where(eq(boardSeries.id, seriesId)).for('share');
    if (!s) throw new BoardFeeError('Board series not found', 404);
    // The series' fee grid, exclusive, before its rows (§2.1): a move into this series waits for
    // the Confirm, or the Confirm for the move — never inside it.
    await lockFeeGrids(tx, [seriesId], 'exclusive');
    const ids = [...new Set(data.rows.map((r) => r.feeId))].sort();
    const rows = await tx.select().from(boardFee).where(and(eq(boardFee.boardSeriesId, seriesId), inArray(boardFee.id, ids))).orderBy(boardFee.id).for('update');
    if (rows.length !== ids.length) throw new BoardFeeError('One or more fee rows are not in this series', 404);
    const now = new Date();
    const confirmed: Record<string, unknown>[] = [];
    for (const r of rows) {
      const amount = data.rows.find((x) => x.feeId === r.id)?.amount ?? r.amount;
      if (amount === 0 && !r.zeroReason) throw new BoardFeeError('A fee of 0 needs a reason: set it on the grid first');
      await tx.update(boardFee).set({ amount, provisional: false, confirmedAt: now, confirmedBy: actorId, updatedAt: now }).where(eq(boardFee.id, r.id));
      confirmed.push({ id: r.id, keyKind: r.keyKind, keyId: r.keyId, before: r.amount, amount, wasProvisional: r.provisional });
    }
    const settled = await settleLinesOfConfirmed(tx, ids, actorId, now);
    await logAction(actorId, 'BOARD_FEES_CONFIRMED', 'board_series', seriesId, null,
      { rows: confirmed, linesNoLongerProvisional: settled.cleared, dueDatesMoved: settled.moved, reason: data.reason ?? null }, ctx, tx);
    const differing = confirmed.filter((c) => c.before !== c.amount).length;
    return { confirmed: confirmed.length, differing, linesNoLongerProvisional: settled.cleared, dueDatesMoved: settled.moved };
  });
}

/**
 * After rows are confirmed (Confirm, or the grid's put of a published fee over a provisional row),
 * in the caller's transaction, the rows already locked: each line priced from them (found by its
 * basis, locked FOR UPDATE in id order) whose rows are now all confirmed at the amounts it recorded
 * is no longer provisional, and a waiting one's due date moves (§3.1, `LINE_DUE_MOVED`); a line
 * whose recorded amount differs stays provisional until "Re-price".
 */
async function settleLinesOfConfirmed(tx: Tx, feeIds: string[], actorId: string, now: Date) {
  const lines = await lockLinesOfFees(tx, feeIds);
  const moved: { id: string; from: Date; to: Date }[] = [];
  let cleared = 0;
  for (const l of lines) {
    if (!l.priceProvisional) continue;
    const basis = l.pricingBasis as PricingBasis | null;
    const feeRows = basis?.feeRows ?? [];
    const now2 = await tx.select({ id: boardFee.id, amount: boardFee.amount, provisional: boardFee.provisional }).from(boardFee).where(inArray(boardFee.id, feeRows.map((f) => f.id)));
    const allConfirmedSame = feeRows.every((f) => { const n = now2.find((x) => x.id === f.id); return n && !n.provisional && n.amount === f.amount; });
    if (!allConfirmedSame) continue;
    await tx.update(registration).set({ priceProvisional: false, updatedAt: now }).where(eq(registration.id, l.id));
    cleared++;
    if ((WAITING as readonly string[]).includes(l.status)) {
      const due = await dueDateFor(tx, { kind: 'line', lineId: l.id });
      if (due.getTime() !== l.dueAt.getTime()) {
        await tx.update(registration).set({ dueAt: due }).where(eq(registration.id, l.id));
        moved.push({ id: l.id, from: l.dueAt, to: due });
      }
    }
  }
  await logActions(moved.map((m) => ({
    userId: actorId, action: 'LINE_DUE_MOVED' as const, entityType: 'registration' as const, entityId: m.id,
    previousData: { dueAt: m.from.toISOString() }, newData: { dueAt: m.to.toISOString(), reason: 'board fee confirmed' },
  })), tx);
  return { cleared, moved: moved.length };
}

/**
 * Re-price unpaid lines (§3.4): for lines read from these confirmed rows whose recorded amount
 * differs, with no payment history at all (no payment_registration row of any status), the board
 * part is re-priced with the exceptions their basis recorded; every other such line — paid, in
 * an open or a failed checkout, preregistered and paid — is listed, untouched. One audited batch,
 * `LINE_REPRICED` per line, each family told the old and the new price.
 */
export async function repriceLines(seriesId: string, data: RepriceBoardFeesType, actorId: string, ctx?: AuditContext) {
  const outcome = await db.transaction(async (tx) => {
    const { name } = await seriesOrThrow(tx, seriesId);
    const ids = [...new Set(data.feeIds)].sort();
    const rows = await tx.select().from(boardFee).where(and(eq(boardFee.boardSeriesId, seriesId), inArray(boardFee.id, ids))).orderBy(boardFee.id).for('share');
    if (rows.length !== ids.length) throw new BoardFeeError('One or more fee rows are not in this series', 404);
    const prov = rows.find((r) => r.provisional);
    if (prov) throw new BoardFeeError('Confirm a fee before re-pricing the lines read from it');
    // The lines first, locked; their payment history after (a checkout committing meanwhile is seen).
    const lines = await lockLinesOfFees(tx, ids);
    // A payment of the line, a live instalment plan on it, or a price adjustment or an instalment
    // paid or being paid (line-history.services.ts; the review of step C, items 9 and 14): its price stays.
    const withHistory = await paymentHistoryOf(tx, lines.map((l) => l.id));
    const repriced: { id: string; studentId: string; subjectId: string; from: number; to: number }[] = [];
    const listed: { id: string; studentId: string; status: string; price: number; reason: string }[] = [];
    const now = new Date();
    for (const l of lines) {
      const basis = l.pricingBasis as PricingBasis | null;
      const recordedDiffers = (basis?.feeRows ?? []).some((f) => { const r = rows.find((x) => x.id === f.id); return r && r.amount !== f.amount; });
      if (!recordedDiffers) continue;
      const waiting = (WAITING as readonly string[]).includes(l.status);
      if (!basis || withHistory.has(l.id) || !waiting) {
        listed.push({ id: l.id, studentId: l.studentId, status: l.status, price: l.priceAtRegistration,
          reason: !basis ? 'converted line (no pricing basis)' : withHistory.has(l.id) ? PAYMENT_HISTORY_REASON[withHistory.get(l.id)!] : `is ${l.status}` });
        if (l.priceProvisional) {
          await tx.update(registration).set({ priceProvisional: false, updatedAt: now }).where(eq(registration.id, l.id));
          // Its price stands (finance adjusts it); the mark it loses is recorded per line.
          await logAction(actorId, 'LINE_PRICE_KEPT', 'registration', l.id, { priceAtRegistration: l.priceAtRegistration, provisional: true },
            { priceAtRegistration: l.priceAtRegistration, provisional: false, reason: data.reason, why: listed[listed.length - 1]!.reason }, ctx, tx);
        }
        continue;
      }
      const next = await repriceBoardPart(tx, { offerItemId: l.offerItemId, pricingBasis: basis });
      if (!next) continue;
      await tx.update(registration).set({
        priceAtRegistration: next.total, courseFeeAtRegistration: next.courseFee, registrationFeeAtRegistration: next.registrationFee,
        priceProvisional: next.provisional, pricingBasis: next.basis as unknown as Record<string, unknown>, updatedAt: now,
      }).where(eq(registration.id, l.id));
      const due = await dueDateFor(tx, { kind: 'line', lineId: l.id });
      if (due.getTime() !== l.dueAt.getTime()) await tx.update(registration).set({ dueAt: due }).where(eq(registration.id, l.id));
      repriced.push({ id: l.id, studentId: l.studentId, subjectId: l.subjectId, from: l.priceAtRegistration, to: next.total });
    }
    await logAction(actorId, 'BOARD_FEES_REPRICED', 'board_series', seriesId, null,
      { feeIds: ids, repriced: repriced.length, listed: listed.map((x) => ({ id: x.id, reason: x.reason })), reason: data.reason, series: name }, ctx, tx);
    await logActions(repriced.map((r) => ({
      userId: actorId, action: 'LINE_REPRICED' as const, entityType: 'registration' as const, entityId: r.id,
      previousData: { priceAtRegistration: r.from }, newData: { priceAtRegistration: r.to, reason: data.reason, part: 'board' },
    })), tx);
    return { repriced, listed, seriesName: name };
  });
  // Each family told the old and the new price (after the commit; a failed notice is logged).
  const subjects = outcome.repriced.length
    ? new Map((await db.select({ id: subject.id, name: subject.name }).from(subject).where(inArray(subject.id, [...new Set(outcome.repriced.map((r) => r.subjectId))]))).map((s) => [s.id, s.name]))
    : new Map<string, string>();
  for (const r of outcome.repriced) {
    const subjectName = subjects.get(r.subjectId) ?? 'a subject';
    await createNotification(r.studentId, 'PRICE_CHANGED', `The price of ${subjectName} changed`,
      `The exam board confirmed its fee for ${outcome.seriesName}. ${subjectName} was ${r.from.toFixed(2)} EGP and is now ${r.to.toFixed(2)} EGP.`,
      { registrationId: r.id, from: r.from, to: r.to })
      .catch((err) => console.error('[board-fees] Price change notice failed:', err));
  }
  return {
    repriced: outcome.repriced.map((r) => ({ id: r.id, from: r.from, to: r.to })),
    listed: outcome.listed,
    totalDifference: round2(outcome.repriced.reduce((a, r) => a + (r.to - r.from), 0)),
  };
}

/**
 * Rows pasted from a fee list, one per line, matched to the series' board: "0970 CX 10,850"
 * (Cambridge syllabus and option), "WMA11 4,800" (a Pearson unit), "4HB1 9,840" (a qualification),
 * or a subject's code. Unknown codes are listed to map.
 */
export async function parseFees(seriesId: string, text: string) {
  const { series } = await seriesOrThrow(db, seriesId);
  const board = series.boardCode;
  const matched: { line: string; keyKind: 'unit' | 'option' | 'qualification' | 'subject'; keyId: string; code: string; title: string; amount: number }[] = [];
  const unknown: { line: string; reason: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.*?)[\s\t]+([\d.,]+)\s*(?:EGP)?$/i.exec(line);
    if (!m) { unknown.push({ line, reason: 'no amount at the end of the line' }); continue; }
    const codePart = m[1]!.trim().replace(/\s+/g, ' ');
    const amount = Number(m[2]!.replace(/,/g, ''));
    if (!Number.isFinite(amount)) { unknown.push({ line, reason: 'the amount is not a number' }); continue; }
    const tokens = codePart.split(/[\s/]+/).filter(Boolean);
    let found: (typeof matched)[number] | null = null;
    // A Cambridge syllabus and option code: "0970 CX".
    if (tokens.length >= 2) {
      const [o] = await db.select({ id: qualificationOption.id, code: qualificationOption.code, qCode: qualification.code, title: qualification.title, label: qualificationOption.label })
        .from(qualificationOption).innerJoin(qualification, eq(qualification.id, qualificationOption.qualificationId))
        .where(and(eq(qualification.boardCode, board), sql`lower(${qualification.code}) = lower(${tokens[0]!})`, sql`lower(${qualificationOption.code}) = lower(${tokens[1]!})`));
      if (o) found = { line, keyKind: 'option', keyId: o.id, code: `${o.qCode} ${o.code}`, title: `${o.title} — ${o.label}`, amount };
    }
    if (!found) {
      for (const t of tokens) {
        const [u] = await db.select({ id: examUnit.id, code: examUnit.code, title: examUnit.title }).from(examUnit)
          .where(and(eq(examUnit.boardCode, board), sql`lower(${examUnit.code}) = lower(${t})`));
        if (u) { found = { line, keyKind: 'unit', keyId: u.id, code: u.code, title: u.title, amount }; break; }
        const qs = await db.select({ id: qualification.id, code: qualification.code, title: qualification.title }).from(qualification)
          .where(and(eq(qualification.boardCode, board), sql`lower(${qualification.code}) = lower(${t})`));
        if (qs.length === 1) { found = { line, keyKind: 'qualification', keyId: qs[0]!.id, code: qs[0]!.code, title: qs[0]!.title, amount }; break; }
        const [s] = await db.select({ id: subject.id, code: subject.code, name: subject.name }).from(subject)
          .where(and(eq(subject.council, board), sql`lower(${subject.code}) = lower(${t})`));
        if (s) { found = { line, keyKind: 'subject', keyId: s.id, code: s.code, title: s.name, amount }; break; }
      }
    }
    if (found) matched.push(found);
    else unknown.push({ line, reason: `no unit, option, award or subject of this board has the code "${codePart}"` });
  }
  return { matched, unknown };
}
