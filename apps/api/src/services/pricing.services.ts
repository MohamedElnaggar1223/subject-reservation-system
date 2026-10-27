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
 * Version 1 — the fee grid's path (a series' fee rows read through an item's fee keys) — left with P1c: no
 * line is priced so any more. A line priced so before keeps its stored price and basis (PricingBasisV1); its
 * row took the grid's amount as its exam fee (migration 0072), so a re-price of the row prices it as version 2.
 *
 * The result and its basis are snapshotted on the line, so the receipt and the statement say why.
 */

import { db, registrationSession, sessionOffer, sessionOfferItem, subject, eq, inArray } from '@repo/db';
import type { PricingBasisV2, Attempt, LineMode } from '@repo/validations';
import { lineExceptions, type PolicyException } from './line-exceptions';
import { coded } from '../lib/refusal';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export class PricingError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

/**
 * A checkout's refusal when a line's price changed between the family's (or the desk's) reading
 * and the checkout's lock: a re-price committed in between (§3.4) — a row's fee, the session's self-study share or a
 * grant changed by the school. The payment would otherwise
 * charge the old price for a line that now costs another (09: a payment charges exactly what it
 * covers).
 */
export const PRICE_CHANGED_REFUSAL = 'The price of one or more of these subjects changed while this was open (the school updated it) — look at the new price and pay again';

/**
 * The prices a checkout or a desk collection was shown (P1c), against the lines' prices under their locks: a line
 * priced otherwise now — a re-price committed after the page was read — is refused (PRICE_CHANGED), never charged.
 * A line the page sent no price for is compared with the caller's own earlier read only.
 */
export function assertExpectedPrices(locked: { id: string; price: number }[], expected: { registrationId: string; price: number }[] | undefined) {
  if (!expected?.length) return;
  const shown = new Map(expected.map((e) => [e.registrationId, e.price]));
  if (locked.some((l) => shown.has(l.id) && round2(shown.get(l.id)!) !== round2(l.price))) throw coded(new Error(PRICE_CHANGED_REFUSAL), 'PRICE_CHANGED');
}

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
  /** The session's prices are not final (E6). */
  provisional: boolean;
  basis: PricingBasisV2;
};

export type PriceLineInput = {
  item: { id: string };
  attempt: Attempt;
  mode: LineMode;
  studentId: string;
  sessionId: string;
};

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

/** Whether a stored basis is version 2 (the row's exam fee) — readers that only v1 concerns skip it. */
export function isBasisV2(basis: unknown): basis is PricingBasisV2 {
  return !!basis && typeof basis === 'object' && (basis as { v?: number }).v === 2;
}

