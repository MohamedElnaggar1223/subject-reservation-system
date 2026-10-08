/**
 * The one pricing function (RESERVATIONS_REWORK.md §3.4; docs/features/RESERVATIONS.md §2.3).
 *
 * `priceLine(item, attempt, mode, student, session)` replaces `computeRegistrationPricing`
 * in every path that creates or re-prices a line:
 *
 *   course = (item's course fee ?? offer's) × the mode's and attempt's percent
 *            (self-study: pricing.selfStudyCoursePercent; a retake in school:
 *             pricing.retakeTaughtCoursePercent) × pricing.onePaperCoursePercent for a one-paper item
 *   board  = Σ the series' fee rows for the item's fee keys × (self-study: pricing.selfStudyBoardPercent)
 *   then the price exceptions in today's order: a custom price replaces the total (course = total,
 *   board = 0); else percent discounts on both parts; then a fixed discount (course first).
 *   total  = course + board
 *
 * The result and its basis (attempt, mode, percents, fee rows with their provisional flag,
 * exception ids) are snapshotted on the line, so the receipt and the statement say why. An item
 * whose key has no fee row cannot be priced (nor reserved) until one is set.
 */

import { db, sessionOffer, sessionOfferItem, sessionOfferItemFeeKey, boardFee, boardSeries, examBoard, and, or, eq, inArray } from '@repo/db';
import type { PricingBasis, Attempt, LineMode } from '@repo/validations';
import { seriesLabel } from '@repo/validations';
import { getSetting } from './settings.services';
import { lineExceptions, type PolicyException } from './line-exceptions';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export class PricingError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

/**
 * A checkout's refusal when a line's price changed between the family's (or the desk's) reading
 * and the checkout's lock: a re-price committed in between (§3.4). The payment would otherwise
 * charge the old price for a line that now costs another (09: a payment charges exactly what it
 * covers).
 */
export const PRICE_CHANGED_REFUSAL = 'The price of one or more of these subjects changed while this was open (the exam board confirmed its fee) — look at the new price and pay again';

/** The desk's and the checkout's refusal for a line whose board fee is not yet confirmed (§3.4). */
export const PROVISIONAL_REFUSAL = 'Board fee provisional, confirmed before payment: this line can be reserved but not paid until the exam board publishes its fee and the school confirms it';

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type LinePrice = {
  courseFee: number;
  /** The board part (the line's registration_fee_at_registration). */
  registrationFee: number;
  total: number;
  /** A fee row read is still provisional: the line can be reserved, not paid (unless the setting allows). */
  provisional: boolean;
  basis: PricingBasis;
};

export type PriceLineInput = {
  item: { id: string };
  attempt: Attempt;
  mode: LineMode;
  studentId: string;
  sessionId: string;
};

type FeeRow = typeof boardFee.$inferSelect;

/** The fee rows an item's keys read in its series; refused when one is missing. */
export async function feeRowsForItem(executor: Executor, itemId: string, opts: { lock?: boolean } = {}) {
  const [it] = await executor
    .select({ item: sessionOfferItem, subjectId: sessionOffer.subjectId, offerCourseFee: sessionOffer.courseFee, offerSessionId: sessionOffer.sessionId })
    .from(sessionOfferItem)
    .innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId))
    .where(eq(sessionOfferItem.id, itemId));
  if (!it) throw new PricingError('That item is not on offer', 404);
  if (!it.item.boardSeriesId) throw new PricingError(`${it.item.label} is entered in no board series: it cannot be reserved`);
  const keys = await executor.select().from(sessionOfferItemFeeKey).where(eq(sessionOfferItemFeeKey.itemId, itemId)).orderBy(sessionOfferItemFeeKey.id);
  if (!keys.length) throw new PricingError(`${it.item.label} names no board fee to read: set what its fee is read for on the session's Subjects tab`);
  const q = executor
    .select()
    .from(boardFee)
    .where(and(
      eq(boardFee.boardSeriesId, it.item.boardSeriesId),
      or(...keys.map((k) => and(eq(boardFee.keyKind, k.keyKind), eq(boardFee.keyId, k.keyId)))),
    ))
    .orderBy(boardFee.id);
  const rows: FeeRow[] = opts.lock ? await q.for('share') : await q;
  const missing = keys.filter((k) => !rows.some((r) => r.keyKind === k.keyKind && r.keyId === k.keyId));
  if (missing.length) {
    const [s] = await executor.select({ boardCode: boardSeries.boardCode, month: boardSeries.month, year: boardSeries.year, label: boardSeries.label, boardName: examBoard.name })
      .from(boardSeries).innerJoin(examBoard, eq(examBoard.code, boardSeries.boardCode)).where(eq(boardSeries.id, it.item.boardSeriesId));
    const series = s ? `${s.boardName} ${seriesLabel(s.month, s.year)}${s.label ? ` (${s.label})` : ''}` : 'its series';
    throw new PricingError(`${it.item.label} has no board fee in ${series} yet — set one on the session's Fees tab`);
  }
  return { item: it.item, subjectId: it.subjectId, offerCourseFee: it.offerCourseFee, sessionId: it.offerSessionId, keys, rows };
}

/** The price exceptions applied in today's order (exception.services applyPricingExceptions). */
function applyPriceExceptions(courseFee: number, registrationFee: number, exc: PolicyException[]) {
  let total = round2(courseFee + registrationFee);
  let customPrice = false;
  const custom = exc.find((e) => e.policyKey === 'price.custom' && e.value != null);
  if (custom) {
    total = round2(custom.value!);
    courseFee = total;
    registrationFee = 0;
    customPrice = true;
  }
  for (const e of exc.filter((r) => r.policyKey === 'price.discountPercent' && r.value != null)) {
    const factor = 1 - e.value! / 100;
    courseFee = round2(courseFee * factor);
    registrationFee = round2(registrationFee * factor);
    total = round2(courseFee + registrationFee);
  }
  for (const e of exc.filter((r) => r.policyKey === 'price.discountFixed' && r.value != null)) {
    const off = Math.min(e.value!, total);
    const fromCourse = Math.min(off, courseFee);
    courseFee = round2(courseFee - fromCourse);
    registrationFee = round2(registrationFee - (off - fromCourse));
    total = round2(courseFee + registrationFee);
  }
  return { courseFee, registrationFee, total, customPrice };
}

const PRICE_KEYS = ['price.custom', 'price.discountPercent', 'price.discountFixed'] as const;

/**
 * The price of one line. `exceptionIds`: a re-price applies exactly these (the ids its basis
 * recorded) instead of the student's current exceptions. `lock`: the fee rows are read FOR
 * SHARE (inside a creating transaction), so a confirm or a re-price waits for it.
 */
export async function priceLine(
  executor: Executor,
  input: PriceLineInput,
  opts: { exceptionIds?: string[]; lock?: boolean } = {},
): Promise<LinePrice> {
  const fee = await feeRowsForItem(executor, input.item.id, { lock: opts.lock });
  const [selfStudyCourse, selfStudyBoard, retakeTaught, onePaper] = await Promise.all([
    getSetting('pricing.selfStudyCoursePercent', executor),
    getSetting('pricing.selfStudyBoardPercent', executor),
    getSetting('pricing.retakeTaughtCoursePercent', executor),
    getSetting('pricing.onePaperCoursePercent', executor),
  ]);
  const courseFeeBase = fee.item.courseFee ?? fee.offerCourseFee;
  const coursePercent = input.mode === 'self_study' ? selfStudyCourse : input.attempt === 'retake' ? retakeTaught : 100;
  const onePaperPercent = fee.item.kind === 'one_paper' ? onePaper : 100;
  const boardFeeBase = round2(fee.rows.reduce((s, r) => s + r.amount, 0));
  const boardPercent = input.mode === 'self_study' ? selfStudyBoard : 100;
  const course = round2(((courseFeeBase * coursePercent) / 100) * onePaperPercent / 100);
  const board = round2((boardFeeBase * boardPercent) / 100);

  const exc = opts.exceptionIds
    ? (await lineExceptions.byIds(executor, opts.exceptionIds)).filter((e) => (PRICE_KEYS as readonly string[]).includes(e.policyKey))
    : await lineExceptions.active(executor, input.studentId, [...PRICE_KEYS], {
        sessionId: input.sessionId, subjectId: fee.subjectId, offerId: fee.item.offerId, offerItemId: fee.item.id,
        // Inside a creating transaction the exceptions it reads are held FOR SHARE (§2.1), so a
        // revocation at the same moment waits for the line, or the line for the revocation.
      }, opts.lock ? { lock: 'share' } : undefined);
  const priced = applyPriceExceptions(course, board, exc);
  const basis: PricingBasis = {
    v: 1,
    attempt: input.attempt,
    mode: input.mode,
    itemKind: fee.item.kind,
    courseFeeBase,
    coursePercent,
    onePaperPercent,
    boardFeeBase,
    boardPercent,
    feeRows: fee.rows.map((r) => ({ id: r.id, keyKind: r.keyKind, keyId: r.keyId, amount: r.amount, provisional: r.provisional })),
    exceptionIds: exc.map((e) => e.id),
    customPrice: priced.customPrice,
    courseFee: priced.courseFee,
    registrationFee: priced.registrationFee,
    total: priced.total,
  };
  return {
    courseFee: priced.courseFee,
    registrationFee: priced.registrationFee,
    total: priced.total,
    provisional: fee.rows.some((r) => r.provisional),
    basis,
  };
}

/**
 * Re-price the board part of a line whose fee rows were confirmed at another amount (§3.4): the
 * course part as its basis recorded it, the board part from the rows as they are now, then the
 * exceptions its basis recorded (not the student's current ones). Null for a line with no basis
 * (a converted line keeps its price).
 */
export async function repriceBoardPart(
  executor: Executor,
  line: { offerItemId: string; pricingBasis: unknown },
): Promise<LinePrice | null> {
  const basis = line.pricingBasis as PricingBasis | null;
  if (!basis || basis.v !== 1) return null;
  const fee = await feeRowsForItem(executor, line.offerItemId);
  const course = round2(((basis.courseFeeBase * basis.coursePercent) / 100) * basis.onePaperPercent / 100);
  const boardFeeBase = round2(fee.rows.reduce((s, r) => s + r.amount, 0));
  const board = round2((boardFeeBase * basis.boardPercent) / 100);
  const exc = (await lineExceptions.byIds(executor, basis.exceptionIds)).filter((e) => (PRICE_KEYS as readonly string[]).includes(e.policyKey));
  const priced = applyPriceExceptions(course, board, exc);
  const next: PricingBasis = {
    ...basis,
    boardFeeBase,
    feeRows: fee.rows.map((r) => ({ id: r.id, keyKind: r.keyKind, keyId: r.keyId, amount: r.amount, provisional: r.provisional })),
    customPrice: priced.customPrice,
    courseFee: priced.courseFee,
    registrationFee: priced.registrationFee,
    total: priced.total,
  };
  return { courseFee: priced.courseFee, registrationFee: priced.registrationFee, total: priced.total, provisional: fee.rows.some((r) => r.provisional), basis: next };
}

/** The fee rows of several items at once (screens): per item the sum, provisional and missing keys. */
export async function itemBoardFees(executor: Executor, itemIds: string[]) {
  const out = new Map<string, { amount: number | null; provisional: boolean; missing: number; rows: FeeRow[] }>();
  if (!itemIds.length) return out;
  const items = await executor.select({ id: sessionOfferItem.id, seriesId: sessionOfferItem.boardSeriesId }).from(sessionOfferItem).where(inArray(sessionOfferItem.id, itemIds));
  const keys = await executor.select().from(sessionOfferItemFeeKey).where(inArray(sessionOfferItemFeeKey.itemId, itemIds));
  const seriesIds = [...new Set(items.map((i) => i.seriesId).filter((s): s is string => !!s))];
  const rows = seriesIds.length ? await executor.select().from(boardFee).where(inArray(boardFee.boardSeriesId, seriesIds)) : [];
  for (const it of items) {
    const ks = keys.filter((k) => k.itemId === it.id);
    const found = ks.map((k) => rows.find((r) => r.boardSeriesId === it.seriesId && r.keyKind === k.keyKind && r.keyId === k.keyId)).filter((r): r is FeeRow => !!r);
    const missing = it.seriesId ? ks.length - found.length : ks.length;
    out.set(it.id, {
      amount: missing === 0 && ks.length ? round2(found.reduce((s, r) => s + r.amount, 0)) : null,
      provisional: found.some((r) => r.provisional),
      missing,
      rows: found,
    });
  }
  return out;
}
