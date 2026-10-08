/**
 * Reservations (RESERVATIONS_REWORK.md §3.5, §4.3, §4.4; docs/features/RESERVATIONS_LINES.md).
 *
 * Step B's part of making a line: what the page sent (`ReservationLine`) becomes the line
 * `insertLines` makes (docs/features/RESERVATIONS.md §2.2) — the sitting a retake or a
 * carry-forward follows resolved to a board series (created with no dates when a family names
 * one not on record) and how it is known decided here, never by the page; the teacher defaulted
 * where the offer has one. Then, in the same transaction, the line's two consent rows and the
 * refund steps the family consented to (`refund_policy_snapshot`, §2.6). A swap's new line
 * inherits the dropped line's consent.
 *
 * Every reservation path (the request, the direct reservation, the desk, the admin's override,
 * preregistration, swaps) calls `reserveLines` inside its transaction, after
 * `assertMayRegisterForInTx` (the student lock, §2.1): so a student's reservations are
 * serialised, and "already reserved" is judged under that lock.
 */

import {
  db, registration, registrationConsent, registrationSession, refundWindow, boardSeries, sessionOffer, sessionOfferItem,
  sessionOfferTeacher, sessionOfferItemTeacher, subject,
  and, eq, inArray, sql, asc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  CONSENT_TEXT_VERSIONS,
  type Eligibility,
  type LineInputType,
  type PriorSittingSource,
  type RefundPolicy,
  type RefundPolicySnapshot,
  type ReservationLineType,
  type SeriesMonth,
} from '@repo/validations';
import { insertLines, type InsertLinesInput } from './line.services';
import { findOrCreateSeries, OfferError } from './offer.services';
import { PRICE_CHANGED_REFUSAL, round2 } from './pricing.services';
import { schoolMonthIndex } from './series.services';
import { academicYearForDate } from './school-fee.services';
import { refundPercentage } from './refund.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export class ReservationError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 | 422 = 400) {
    super(message);
  }
}

/** Who names a sitting not known to the system: the family (app) or the school's staff (desk). */
export type DeclaredBy = 'family' | 'desk';
export type ConsentChannel = 'app' | 'desk' | 'imported';

const LIVE = ['pending_approval', 'pending_payment', 'preregistered', 'confirmed', 'dropped_pending_receipt'] as const;

// ─── Known sittings ──────────────────────────────────────────────────────────

type ItemFacts = {
  id: string; label: string; kind: string; sessionId: string; offerId: string; subjectId: string; subjectName: string;
  subjectActive: boolean; entersKind: string; qualificationId: string | null; needsPriorSeries: boolean;
  seriesId: string | null; boardCode: string | null; month: string | null; year: number | null; boardName: string | null; units: string[];
};

async function itemFacts(executor: Executor, itemIds: string[]): Promise<Map<string, ItemFacts>> {
  if (!itemIds.length) return new Map();
  const r = await executor.execute(sql`
    select i.id, i.label, i.kind, i.session_id as "sessionId", i.offer_id as "offerId", o.subject_id as "subjectId", s.name as "subjectName",
      s.is_active as "subjectActive", i.enters_kind as "entersKind", i.qualification_id as "qualificationId",
      i.needs_prior_series as "needsPriorSeries", i.board_series_id as "seriesId",
      coalesce(bs.board_code, s.council) as "boardCode", bs.month, bs.year, b.name as "boardName",
      coalesce((select array_agg(u.unit_id order by u.unit_id) from session_offer_item_unit u where u.item_id = i.id), '{}') as units
    from session_offer_item i
    join session_offer o on o.id = i.offer_id
    join subject s on s.id = o.subject_id
    left join board_series bs on bs.id = i.board_series_id
    left join exam_board b on b.code = coalesce(bs.board_code, s.council)
    where i.id in (${sql.join(itemIds.map((id) => sql`${id}`), sql`, `)})`);
  return new Map((r.rows as ItemFacts[]).map((x) => [x.id, x]));
}

/** What an item enters, as keys two sittings share: an award (q:), a unit (u:), an unmapped row (s:). */
function entryKeys(x: { entersKind: string; qualificationId: string | null; subjectId: string; units: string[] }) {
  if (x.entersKind === 'award' || x.entersKind === 'option') return x.qualificationId ? [`q:${x.qualificationId}`] : [`s:${x.subjectId}`];
  if (x.entersKind === 'units') return x.units.map((u) => `u:${u}`);
  return [`s:${x.subjectId}`];
}

/**
 * The student's known sittings of what an item enters — their confirmed lines in other sessions
 * (sat: a dropped line was never sat, so naming it is a declaration the school verifies), in a
 * series, entering the same award, unit or row, or of the same subject — latest first. The
 * Reserve page reads the offers read's `knownSittings` the same way (its confirmed ones).
 */
export async function knownSittingsOf(executor: Executor, studentId: string, sessionId: string, item: ItemFacts) {
  const r = await executor.execute(sql`
    select r.id, r.board_series_id as "seriesId", r.subject_id as "subjectId", i.enters_kind as "entersKind", i.qualification_id as "qualificationId",
      coalesce((select array_agg(u.unit_id) from session_offer_item_unit u where u.item_id = i.id), '{}') as units,
      bs.year, bs.month
    from registration r join session_offer_item i on i.id = r.offer_item_id join board_series bs on bs.id = r.board_series_id
    where r.student_id = ${studentId} and r.session_id <> ${sessionId} and r.status = 'confirmed'
    order by bs.year desc, r.created_at desc, r.id desc`);
  const keys = entryKeys(item);
  return (r.rows as { id: string; seriesId: string; subjectId: string; entersKind: string; qualificationId: string | null; units: string[]; year: number; month: string }[])
    .filter((h) => entryKeys(h).some((k) => keys.includes(k)) || h.subjectId === item.subjectId)
    .sort((a, b) => (b.year * 12 + schoolMonthIndex(b.month)) - (a.year * 12 + schoolMonthIndex(a.month)))
    .map((h) => ({ registrationId: h.id, seriesId: h.seriesId }));
}

/** The teachers who may be named on a line of an item: the item's own, else the offer's. */
async function teachersOf(executor: Executor, itemId: string, offerId: string) {
  const own = await executor.select({ teacherId: sessionOfferItemTeacher.teacherId }).from(sessionOfferItemTeacher)
    .where(eq(sessionOfferItemTeacher.itemId, itemId)).orderBy(asc(sessionOfferItemTeacher.sortOrder));
  if (own.length) return own.map((t) => t.teacherId);
  return (await executor.select({ teacherId: sessionOfferTeacher.teacherId }).from(sessionOfferTeacher)
    .where(eq(sessionOfferTeacher.offerId, offerId)).orderBy(asc(sessionOfferTeacher.sortOrder))).map((t) => t.teacherId);
}

const itemName = (it: { kind: string; subjectName: string; label: string }) => (it.kind === 'whole' ? it.subjectName : `${it.subjectName} — ${it.label}`);

// ─── From the page's lines to insertLines' lines ─────────────────────────────

/**
 * Resolve what a page sent into the lines `insertLines` makes, in the caller's transaction:
 * - the sitting a retake (or a carry-forward item) follows: the series named, or the series of
 *   the month and year named, created with no dates when not on record; with none named, the
 *   student's latest known sitting of what the item enters;
 * - how it is known: `known` when it is one of the student's known sittings, else declared by
 *   whoever is reserving (`declared_by_family` from the app, `declared_by_desk` from staff) —
 *   listed on the session's To verify tab;
 * - a first entry names no earlier sitting unless its item carries one forward;
 * - the teacher: none in self-study; the item's (or offer's) only teacher when the page named
 *   none or "no preference"; "no preference" (null) where there are several.
 */
export async function resolveReservationLines(
  tx: Tx,
  a: { studentId: string; sessionId: string; lines: ReservationLineType[]; declaredBy: DeclaredBy; actorId: string },
): Promise<LineInputType[]> {
  const facts = await itemFacts(tx, a.lines.map((l) => l.offerItemId));
  const out: LineInputType[] = [];
  for (const l of a.lines) {
    const it = facts.get(l.offerItemId);
    if (!it || it.sessionId !== a.sessionId) throw new ReservationError('That item is not on offer in this session', 404);
    if (!it.subjectActive) throw new ReservationError(`${it.subjectName} is no longer offered`);
    const name = itemName(it);

    // The sitting it follows.
    let priorId: string | null = l.priorSittingSeriesId ?? null;
    if (l.priorSitting) {
      if (!it.boardCode) throw new ReservationError(`${name} has no board to name a sitting of`);
      try {
        priorId = (await findOrCreateSeries(tx, it.boardCode, l.priorSitting.month as SeriesMonth, l.priorSitting.year, '', a.actorId,
          `Created when ${a.declaredBy === 'family' ? 'a family' : 'the desk'} declared a sitting not on record (no dates yet)`)).id;
      } catch (err) {
        if (err instanceof OfferError) throw new ReservationError(err.message, err.status === 404 ? 404 : 400);
        throw err;
      }
    }
    const carries = l.attempt === 'retake' || it.needsPriorSeries;
    if (priorId && !carries) throw new ReservationError(`A first entry of ${name} follows no earlier sitting: choose "retake" to name one`);
    const known = carries ? await knownSittingsOf(tx, a.studentId, a.sessionId, it) : [];
    if (carries && !priorId && known.length) priorId = known[0]!.seriesId;
    let source: PriorSittingSource | null = null;
    if (priorId) {
      const [p] = await tx.select({ boardCode: boardSeries.boardCode, month: boardSeries.month, year: boardSeries.year })
        .from(boardSeries).where(eq(boardSeries.id, priorId));
      if (!p) throw new ReservationError('The earlier sitting named was not found', 404);
      if (it.boardCode && p.boardCode !== it.boardCode) {
        throw new ReservationError(`${name} follows a sitting of ${it.boardName ?? 'its own board'}: the sitting named is another board's`);
      }
      if (it.year && it.month && p.year * 12 + schoolMonthIndex(p.month) >= it.year * 12 + schoolMonthIndex(it.month)) {
        throw new ReservationError(`The earlier sitting of ${name} must come before the series it is entered in`);
      }
      source = known.some((k) => k.seriesId === priorId) ? 'known' : a.declaredBy === 'family' ? 'declared_by_family' : 'declared_by_desk';
      // A family declares a sitting of the board's last two years (§3.5: its picker offers those);
      // an older one is declared at the desk, which sees the family's papers.
      if (source === 'declared_by_family' && it.year && it.month
        && it.year * 12 + schoolMonthIndex(it.month) - (p.year * 12 + schoolMonthIndex(p.month)) > 24) {
        throw new ReservationError(`A sitting of ${name} more than two years before this series is declared at the finance desk, with the board's statement`);
      }
    }

    // The teacher.
    let teacherId: string | null = null;
    if (l.mode === 'in_school') {
      if (l.teacherId) teacherId = l.teacherId;
      else {
        const pool = await teachersOf(tx, it.id, it.offerId);
        teacherId = pool.length === 1 ? pool[0]! : null;
      }
    }
    out.push({ offerItemId: it.id, attempt: l.attempt, mode: l.mode, teacherId, priorSittingSeriesId: priorId, priorSittingSource: source });
  }
  return out;
}

// ─── Consent ─────────────────────────────────────────────────────────────────

/**
 * The refund steps a line of this session snapshots at consent (§2.6): the session's policy in
 * weeks; for a converted session with none, its absolute refund windows (the session's own, else
 * those of its academic year, as refund.services reads them), as dates. The same terms the family
 * is shown before it ticks (`GET /sessions/:id/refund-terms`, the checkout's family consent).
 */
export async function refundTermsFor(executor: Executor, sessionId: string): Promise<RefundPolicySnapshot> {
  const [s] = await executor.select({ refundPolicy: registrationSession.refundPolicy, startDate: registrationSession.startDate })
    .from(registrationSession).where(eq(registrationSession.id, sessionId));
  const policy = s?.refundPolicy as RefundPolicy | null | undefined;
  if (policy?.steps?.length) return { kind: 'weeks', steps: policy.steps };
  let windows = await executor.select().from(refundWindow).where(eq(refundWindow.sessionId, sessionId)).orderBy(asc(refundWindow.startsAt));
  if (!windows.length && s) {
    windows = await executor.select().from(refundWindow).where(eq(refundWindow.academicYear, academicYearForDate(s.startDate))).orderBy(asc(refundWindow.startsAt));
  }
  return { kind: 'dates', windows: windows.map((w) => ({ startsAt: w.startsAt.toISOString(), endsAt: w.endsAt.toISOString(), percent: w.percentage })) };
}

/**
 * Write the two consent rows (the refund policy and the declaration) of each line on one channel,
 * and freeze each line's refund steps (`refund_policy_snapshot`) where none is frozen yet — in the
 * caller's transaction. Idempotent per (line, kind, channel).
 */
export async function writeConsents(
  tx: Tx,
  registrationIds: string[],
  a: { channel: ConsentChannel; confirmedBy: string | null; at?: Date },
) {
  if (!registrationIds.length) return;
  const at = a.at ?? new Date();
  await tx.insert(registrationConsent).values(registrationIds.flatMap((registrationId) => (['refund_policy', 'declaration'] as const).map((kind) => ({
    id: randomUUID(), registrationId, kind, textVersion: CONSENT_TEXT_VERSIONS[kind], confirmedBy: a.confirmedBy, channel: a.channel, at,
  })))).onConflictDoNothing();
  const lines = await tx.select({ id: registration.id, sessionId: registration.sessionId, snapshot: registration.refundPolicySnapshot })
    .from(registration).where(inArray(registration.id, registrationIds));
  const bySession = new Map<string, RefundPolicySnapshot>();
  for (const l of lines) {
    if (l.snapshot) continue;
    if (!bySession.has(l.sessionId)) bySession.set(l.sessionId, await refundTermsFor(tx, l.sessionId));
    await tx.update(registration).set({ refundPolicySnapshot: bySession.get(l.sessionId) as unknown as Record<string, unknown> })
      .where(eq(registration.id, l.id));
  }
}

/**
 * A swap's new lines inherit the dropped line's consent (§3.5): its rows, as given (who, which
 * channel, when), and its refund steps. False when the dropped line has none to give — a line
 * converted from before the rework — and the caller asks for the family's consent instead.
 */
export async function inheritConsents(tx: Tx, fromRegistrationId: string, toRegistrationIds: string[]): Promise<boolean> {
  const rows = await tx.select().from(registrationConsent).where(eq(registrationConsent.registrationId, fromRegistrationId));
  if (new Set(rows.map((r) => r.kind)).size < 2) return false;
  await tx.insert(registrationConsent).values(toRegistrationIds.flatMap((registrationId) => rows.map((r) => ({
    id: randomUUID(), registrationId, kind: r.kind, textVersion: r.textVersion, confirmedBy: r.confirmedBy, channel: r.channel, at: r.at,
  })))).onConflictDoNothing();
  const [from] = await tx.select({ snapshot: registration.refundPolicySnapshot }).from(registration).where(eq(registration.id, fromRegistrationId));
  if (from?.snapshot) {
    await tx.update(registration).set({ refundPolicySnapshot: from.snapshot }).where(inArray(registration.id, toRegistrationIds));
  } else {
    // The dropped line consented before snapshots existed: the new line freezes its session's steps now.
    const lines = await tx.select({ id: registration.id, sessionId: registration.sessionId }).from(registration).where(inArray(registration.id, toRegistrationIds));
    for (const l of lines) {
      await tx.update(registration).set({ refundPolicySnapshot: (await refundTermsFor(tx, l.sessionId)) as unknown as Record<string, unknown> })
        .where(eq(registration.id, l.id));
    }
  }
  return true;
}

/**
 * The consent standing of lines about to be paid or confirmed: `missing` — a line made since the
 * rework with fewer than its two consents (none is ever made so; the structure refuses its
 * confirmation too, migration 0045); `schoolOnly` — a line the school reserved (grade 10) whose
 * family has not yet given its own pair, which the checkout or the desk takes when it is paid.
 */
export async function consentStanding(executor: Executor, registrationIds: string[]) {
  if (!registrationIds.length) return { missing: [] as string[], schoolOnly: [] as string[] };
  const r = await executor.execute(sql`
    select r.id,
      (r.legacy is not null and r.legacy ? 'converted') as converted,
      (select count(distinct c.kind) from registration_consent c where c.registration_id = r.id) as kinds,
      (select count(distinct c.kind) from registration_consent c where c.registration_id = r.id and c.channel <> 'school') as family_kinds
    from registration r where r.id in (${sql.join(registrationIds.map((id) => sql`${id}`), sql`, `)})`);
  const rows = r.rows as { id: string; converted: boolean; kinds: string | number; family_kinds: string | number }[];
  return {
    missing: rows.filter((x) => !x.converted && Number(x.kinds) < 2).map((x) => x.id),
    schoolOnly: rows.filter((x) => !x.converted && Number(x.kinds) >= 2 && Number(x.family_kinds) < 2).map((x) => x.id),
  };
}

export const CONSENT_MISSING_REFUSAL = 'A line cannot be confirmed without the family\'s consent to the refund policy and the declaration — reserve it again with both ticked';
export const FAMILY_CONSENT_NEEDED = 'The school reserved these subjects for the family: tick the refund policy and the declaration before paying';

// ─── Making the lines ────────────────────────────────────────────────────────

/**
 * Make a reservation's lines in the caller's transaction, after `assertMayRegisterForInTx`: the
 * lines resolved from what the page sent, refused when one of the items is already reserved for
 * the student in the session, made by `insertLines` (its rules, price, due date and series),
 * refused when a price differs from the one the page showed (a re-price committed in between,
 * PRICE_CHANGED_REFUSAL), then the consent rows and refund steps on `channel`.
 */
export async function reserveLines(
  tx: Tx,
  a: Omit<InsertLinesInput, 'lines'> & {
    lines: ReservationLineType[];
    declaredBy: DeclaredBy;
    /** The consent rows' channel; null when the caller writes them (a swap inherits the dropped line's). */
    channel: ConsentChannel | null;
    eligibility: Eligibility;
  },
) {
  const held = await tx.select({ itemId: registration.offerItemId, label: sessionOfferItem.label, kind: sessionOfferItem.kind, subjectName: subject.name })
    .from(registration)
    .innerJoin(sessionOfferItem, eq(sessionOfferItem.id, registration.offerItemId))
    .innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId))
    .innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
    .where(and(eq(registration.studentId, a.studentId), eq(registration.sessionId, a.sessionId), inArray(registration.status, [...LIVE]),
      inArray(registration.offerItemId, a.lines.map((l) => l.offerItemId))));
  if (held.length) {
    throw new ReservationError(`Already reserved for this student in this session: ${held.map((h) => itemName({ kind: h.kind, subjectName: h.subjectName, label: h.label })).join(', ')}`, 409);
  }
  const lines = await resolveReservationLines(tx, { studentId: a.studentId, sessionId: a.sessionId, lines: a.lines, declaredBy: a.declaredBy, actorId: a.requestedBy });
  const { declaredBy: _d, channel, lines: asked, ...rest } = a;
  const inserted = await insertLines(tx, { ...rest, lines });
  const expected = new Map(asked.filter((l) => l.expectedPrice !== undefined).map((l) => [l.offerItemId, l.expectedPrice!]));
  if (inserted.some((r) => expected.has(r.offerItemId) && round2(expected.get(r.offerItemId)!) !== round2(r.priceAtRegistration))) {
    throw new ReservationError(PRICE_CHANGED_REFUSAL, 409);
  }
  if (channel) await writeConsents(tx, inserted.map((r) => r.id), { channel, confirmedBy: a.requestedBy });
  return inserted;
}

// ─── The refund of a drop the system makes (§3.5) ────────────────────────────

/**
 * What a line dropped by the system on a declared sitting gets back: a rejection after the
 * first-entry deadline (the board fee by the "sent" rule) or `hold` at the deadline (the board
 * fee counted not sent). The design's rule with today's percentage (the refund windows', or the
 * custom exception's: refund.services `refundPercentage`) until step C's `refundFor(line, at)`
 * lands and replaces this body:
 * - the board fee not sent: the percentage of the whole price;
 * - the board fee sent (the school has paid the board): the percentage of the price less the
 *   board fee the line recorded (`registration_fee_at_registration`) — that fee is not refunded.
 */
export async function refundForSystemDrop(
  line: { sessionId: string; studentId: string; priceAtRegistration: number; registrationFeeAtRegistration: number },
  at: Date,
  opts: { boardSent: boolean },
): Promise<{ amount: number; percentage: number; boardFeeKept: number }> {
  const percentage = await refundPercentage(at, line.sessionId, line.studentId);
  const boardFeeKept = opts.boardSent ? Math.min(line.priceAtRegistration, Math.max(0, line.registrationFeeAtRegistration)) : 0;
  return { amount: round2(((line.priceAtRegistration - boardFeeKept) * percentage) / 100), percentage, boardFeeKept: round2(boardFeeKept) };
}
