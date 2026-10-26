/**
 * The one pricing function (COORDINATOR_REWORK.md §6, §9.2; RESERVATIONS_REWORK.md §3.4).
 *
 * `priceLine(item, attempt, mode, student, session)` prices every line a path creates or re-prices.
 *
 * Version 2 — the coordinator rework (a row made through the set-up routes, or converted by
 * migration 0066 with its exam fee):
 *
 *   exam   = the row's exam fee × 100%
 *   course = the row's course fee, else the offering's
 *            × 100% in school (a first entry and a retake alike)
 *            × the session's self-study share in self study, or the row's own self-study amount in its place
 *            (the pricing.* percent settings and their exception keys left with P1b, §9.1)
 *   then the price exceptions in today's order: a custom price replaces the total (course = total,
 *   exam = 0); else percent discounts on both parts; then a fixed discount (course first).
 *   total  = course + exam
 *   provisional = !session.prices_final   (E6: reserved before, paid only once it is on)
 *
 * A row whose exam fee or course fee is not set cannot be priced (PRICE_NOT_SET_REFUSAL): it is not
 * offered to families until it is.
 *
 * Version 1 — the deprecated fee-key path: an item made by the deprecated offers/items routes that has
 * fee keys and no exam fee is priced from its series' fee grid as before, at the removed settings'
 * defaults (OLD_GRID_SHARES), provisional from the fee rows.
 *
 * The result and its basis are snapshotted on the line, so the receipt and the statement say why.
 */

import {
  db, registrationSession, sessionOffer, sessionOfferItem, sessionOfferItemFeeKey, boardFee, boardSeries, examBoard, subject,
  and, or, eq, inArray,
} from '@repo/db';
import type { PricingBasis, PricingBasisV1, PricingBasisV2, Attempt, LineMode } from '@repo/validations';
import { seriesLabel } from '@repo/validations';
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

/** PRICE_NOT_SET (Appendix A): a row whose exam fee or course fee is not set is not offered to families. */
export const PRICE_NOT_SET_REFUSAL = (what: string, part: 'exam fee' | 'course fee') =>
  `${what} has no ${part} set yet: it is not offered to families until the school sets it`;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type LinePrice = {
  courseFee: number;
  /** The exam (board) part (the line's registration_fee_at_registration). */
  registrationFee: number;
  total: number;
  /** v2: the session's prices are not final; v1: a fee row read is still provisional. */
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

/** The fee rows an item's keys read in its series; refused when one is missing (the deprecated v1 path). */
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
  return { item: it.item, subjectId: it.subjectId, offerCourseFee: it.offerCourseFee ?? 0, sessionId: it.offerSessionId, keys, rows };
}

/**
 * Whether an item is priced the deprecated way (v1): no exam fee of its own, and fee keys that read
 * the series' fee grid — an item made by the deprecated offers/items routes. Every other item is v2.
 */
export async function isFeeKeyPriced(executor: Executor, item: { id: string; examFee: number | null }): Promise<boolean> {
  if (item.examFee !== null) return false;
  const [k] = await executor.select({ id: sessionOfferItemFeeKey.id }).from(sessionOfferItemFeeKey).where(eq(sessionOfferItemFeeKey.itemId, item.id)).limit(1);
  return !!k;
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
 * The shares the deprecated fee-key path prices at: the removed pricing.* settings' defaults (§9.1: the session's
 * self-study share and a row's own fee replace them on every row priced by its own exam fee).
 */
export const OLD_GRID_SHARES = { selfStudyCoursePercent: 50, selfStudyBoardPercent: 100, retakeTaughtCoursePercent: 100, onePaperCoursePercent: 100 } as const;

/** The row, its offering and its session as version 2 reads them; held FOR SHARE in §9.2's order when `lock`. */
async function rowForPricing(executor: Executor, itemId: string, lock: boolean) {
  const [found] = await executor.select({ sessionId: sessionOfferItem.sessionId, offerId: sessionOfferItem.offerId })
    .from(sessionOfferItem).where(eq(sessionOfferItem.id, itemId));
  if (!found) throw new PricingError('That item is not on offer', 404);
  // The session, the offering, the row — FOR SHARE in that order (insertLines' order, §9.2): a share,
  // course fee or exam fee change takes them FOR UPDATE in the same order before it re-prices.
  const sq = executor.select({ selfStudyPercent: registrationSession.selfStudyPercent, pricesFinal: registrationSession.pricesFinal })
    .from(registrationSession).where(eq(registrationSession.id, found.sessionId));
  const [session] = lock ? await sq.for('share') : await sq;
  const oq = executor.select({ id: sessionOffer.id, courseFee: sessionOffer.courseFee, subjectId: sessionOffer.subjectId, subjectName: subject.name })
    .from(sessionOffer).innerJoin(subject, eq(subject.id, sessionOffer.subjectId)).where(eq(sessionOffer.id, found.offerId));
  const [offer] = lock ? await oq.for('share', { of: sessionOffer }) : await oq;
  const iq = executor.select().from(sessionOfferItem).where(eq(sessionOfferItem.id, itemId));
  const [item] = lock ? await iq.for('share') : await iq;
  if (!session || !offer || !item) throw new PricingError('That item is not on offer', 404);
  return { session, offer, item };
}

/**
 * The price of one line. `exceptionIds`: a re-price applies exactly these (the ids its basis
 * recorded) instead of the student's current exceptions. `lock`: what it reads is held FOR SHARE
 * (inside a creating transaction), so a re-price or a confirm waits for it.
 */
export async function priceLine(
  executor: Executor,
  input: PriceLineInput,
  opts: { exceptionIds?: string[]; lock?: boolean } = {},
): Promise<LinePrice> {
  const { session, offer, item } = await rowForPricing(executor, input.item.id, !!opts.lock);
  if (await isFeeKeyPriced(executor, item)) return priceLineV1(executor, input, opts);
  const what = item.kind === 'all_papers' ? offer.subjectName : `${offer.subjectName} — ${item.label}`;
  if (item.examFee === null) throw new PricingError(PRICE_NOT_SET_REFUSAL(what, 'exam fee'));
  const courseFeeBase = item.courseFee ?? offer.courseFee;
  if (courseFeeBase === null) throw new PricingError(PRICE_NOT_SET_REFUSAL(what, 'course fee'));
  const all = opts.exceptionIds
    ? await lineExceptions.byIds(executor, opts.exceptionIds)
    : await lineExceptions.active(executor, input.studentId, [...PRICE_KEYS], {
        sessionId: input.sessionId, subjectId: offer.subjectId, offerId: offer.id, offerItemId: item.id,
      }, opts.lock ? { lock: 'share' } : undefined);
  const selfStudy = input.mode === 'self_study';
  // The row's own self-study amount replaces the share (E4); else the session's share.
  const ownSelfStudy = selfStudy && item.selfStudyFee !== null;
  const coursePercent = selfStudy ? (ownSelfStudy ? 100 : session.selfStudyPercent) : 100;
  const onePaperPercent = 100;
  const courseBase = ownSelfStudy ? item.selfStudyFee! : courseFeeBase;
  const boardPercent = 100;
  const course = round2((courseBase * coursePercent) / 100);
  const exam = round2(item.examFee);
  // A re-price re-applies the ids its basis recorded: only the price keys among them count (a pricing.* key a
  // line recorded before P1b is no longer applied).
  const exc = all.filter((e) => (PRICE_KEYS as readonly string[]).includes(e.policyKey));
  const priced = applyPriceExceptions(course, exam, exc);
  const basis: PricingBasisV2 = {
    v: 2,
    rowId: item.id,
    attempt: input.attempt,
    mode: input.mode,
    itemKind: item.kind,
    examFee: item.examFee,
    examFeeSource: item.examFeeSource,
    selfStudyShare: session.selfStudyPercent,
    selfStudyFee: ownSelfStudy ? item.selfStudyFee : null,
    courseFeeBase: courseBase,
    coursePercent,
    onePaperPercent,
    boardFeeBase: item.examFee,
    boardPercent,
    feeRows: [],
    exceptionIds: exc.map((e) => e.id),
    customPrice: priced.customPrice,
    courseFee: priced.courseFee,
    registrationFee: priced.registrationFee,
    total: priced.total,
  };
  return { courseFee: priced.courseFee, registrationFee: priced.registrationFee, total: priced.total, provisional: !session.pricesFinal, basis };
}

/** The deprecated v1 price: from the series' fee grid, at OLD_GRID_SHARES (see the header). */
async function priceLineV1(executor: Executor, input: PriceLineInput, opts: { exceptionIds?: string[]; lock?: boolean }): Promise<LinePrice> {
  const fee = await feeRowsForItem(executor, input.item.id, { lock: opts.lock });
  // The student's price exceptions (the adapter: the student's own or their family's, covering the line). Inside a
  // creating transaction they are held FOR SHARE (§2.1), so a revocation at the same moment waits for the line.
  const all = opts.exceptionIds
    ? await lineExceptions.byIds(executor, opts.exceptionIds)
    : await lineExceptions.active(executor, input.studentId, [...PRICE_KEYS], {
        sessionId: input.sessionId, subjectId: fee.subjectId, offerId: fee.item.offerId, offerItemId: fee.item.id,
      }, opts.lock ? { lock: 'share' } : undefined);
  const applied: PolicyException[] = [];
  const courseFeeBase = fee.item.courseFee ?? fee.offerCourseFee;
  const coursePercent = input.mode === 'self_study' ? OLD_GRID_SHARES.selfStudyCoursePercent
    : input.attempt === 'retake' ? OLD_GRID_SHARES.retakeTaughtCoursePercent : 100;
  const onePaperPercent = fee.item.kind === 'paper' ? OLD_GRID_SHARES.onePaperCoursePercent : 100;
  const boardFeeBase = round2(fee.rows.reduce((s, r) => s + r.amount, 0));
  const boardPercent = input.mode === 'self_study' ? OLD_GRID_SHARES.selfStudyBoardPercent : 100;
  const course = round2(((courseFeeBase * coursePercent) / 100) * onePaperPercent / 100);
  const board = round2((boardFeeBase * boardPercent) / 100);

  const exc = all.filter((e) => (PRICE_KEYS as readonly string[]).includes(e.policyKey));
  const priced = applyPriceExceptions(course, board, exc);
  const basis: PricingBasisV1 = {
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
    exceptionIds: [...applied, ...exc].map((e) => e.id),
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
 * (a converted line keeps its price) and for a v2 line: its price is its row's, not its series',
 * so a series move or a fee grid's Confirm leaves it as it is (a row's fee change re-prices it,
 * setup/reprice.services.ts).
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
  const next: PricingBasisV1 = {
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

/**
 * The exam fee of several items at once (screens): per item the amount, provisional and missing keys.
 * A v2 row reads its own exam fee (provisional: its session's prices not final); a deprecated
 * fee-key item reads the series' grid as before.
 */
export async function itemBoardFees(executor: Executor, itemIds: string[]) {
  const out = new Map<string, { amount: number | null; provisional: boolean; missing: number; rows: FeeRow[] }>();
  if (!itemIds.length) return out;
  const items = await executor.select({ id: sessionOfferItem.id, seriesId: sessionOfferItem.boardSeriesId, examFee: sessionOfferItem.examFee, pricesFinal: registrationSession.pricesFinal })
    .from(sessionOfferItem).innerJoin(registrationSession, eq(registrationSession.id, sessionOfferItem.sessionId)).where(inArray(sessionOfferItem.id, itemIds));
  const keys = await executor.select().from(sessionOfferItemFeeKey).where(inArray(sessionOfferItemFeeKey.itemId, itemIds));
  const seriesIds = [...new Set(items.map((i) => i.seriesId).filter((s): s is string => !!s))];
  const rows = seriesIds.length ? await executor.select().from(boardFee).where(inArray(boardFee.boardSeriesId, seriesIds)) : [];
  for (const it of items) {
    const ks = keys.filter((k) => k.itemId === it.id);
    if (it.examFee !== null || !ks.length) {
      out.set(it.id, { amount: it.examFee, provisional: !it.pricesFinal, missing: it.examFee === null ? 1 : 0, rows: [] });
      continue;
    }
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

/** Whether a stored basis is version 2 (the row's exam fee) — readers that only v1 concerns skip it. */
export function isBasisV2(basis: unknown): basis is PricingBasisV2 {
  return !!basis && typeof basis === 'object' && (basis as { v?: number }).v === 2;
}

