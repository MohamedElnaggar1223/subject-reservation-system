/**
 * Reserving and paying, two checks (COORDINATOR_REWORK.md §6, C4, C6, C10, G4; P1b).
 *
 * **May reserve** (`mayReserveSession` before a reservation's lines exist, `mayReserveRow` per line, asked by
 * insertLines through assertLineRules under the session, offering and row locks): the session open — active
 * and not past its optional close date; the subject accepting and not past its close; the row not past its
 * close; and never past the line's board deadline (line_effective_deadline, reference dates). A student's G4
 * later reserve date (`deadline.reserve`, until its date) overrides her dates — the session's, the subject's
 * and the row's close — never the board deadline, and never a draft (C4: a draft is invisible to families).
 * The cells, D8, F2, the allowed sittings and the grade list are the line rules' (line-rules.services.ts).
 *
 * **May pay** (`mayPay`, per line — the checkout, the desk's collection, a payment closing): the line waiting
 * (pending_payment), not past its cut-off, its price final, the student still at the school. Closing a
 * subject or the session never stops a waiting line from being paid. A G4 later pay date (`deadline.payment`)
 * moves the line's due date (dueDateFor), so its cut-off follows; never past the board deadline.
 *
 * **The cut-off** of a line = the earlier of its due date + its session's unpaid-cancel days and its board
 * deadline (SQL `line_cut_off`, migration 0068). Confirming a transfer under verification and capturing an
 * instalment plan check the board deadline instead (payment.services confirmPayment, plan.services
 * capturePlanInTx): a transfer protects its lines past their cut-off until the earliest board deadline among
 * them (the cut-off sweep, overdue.services.ts).
 */

import { db, registrationSession, sessionOffer, sessionOfferItem, subject, sql, eq, inArray } from '@repo/db';
import { lineExceptions } from './line-exceptions';
import { effectiveDeadlineFor, deadlinePassedSentence, type DeadlineKind } from './deadline.services';
import { mayRegisterFor } from './eligibility.services';
import { coded } from '../lib/refusal';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/** A date as the school reads it, in Cairo time. */
export function schoolDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' });
}

/** A date and time as the school reads it, in Cairo time. */
export function schoolDateTime(d: Date): string {
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo',
  });
}

/** The sentence the parked series moves give once a board's deadline has passed (as before the rework). */
export function entryDeadlineMessage(entryDeadline: Date, kind: DeadlineKind | null = 'entry'): string {
  return deadlinePassedSentence({ at: entryDeadline, kind }, schoolDate);
}

// ─── Refusals (Appendix A's codes, as the sentences the envelope carries) ────────────────────────

/** NOT_ACCEPTING: the session, the subject or the row takes no new reservation. */
export const NOT_ACCEPTING_REFUSAL = (what: string, since: Date | null) =>
  `${what} is not taking reservations${since ? ` (it closed on ${schoolDate(since)})` : ''}`;
/** A draft session: invisible to families (C4). */
export const NOT_OPEN_REFUSAL = (session: string) => `${session} is not open for reservations yet`;
/** BOARD_DEADLINE_PASSED: past the board's deadline nothing is reserved, paid or confirmed (C6). */
export const BOARD_DEADLINE_PASSED_REFUSAL = (what: string, at: Date, kind: DeadlineKind | null = 'entry') =>
  kind === 'exams_start'
    ? `${what}: its exams start on ${schoolDate(at)} and its board takes no more entries`
    : `${what}: the exam board's ${kind === 'retake' ? 'retake' : 'entry'} deadline (${schoolDate(at)}) has passed`;
/** CUT_OFF_PASSED: an unpaid line past its cut-off (due date + the session's days) is no longer payable (C10). */
export const CUT_OFF_PASSED_REFUSAL = (what: string, at: Date) =>
  `${what} was not paid by ${schoolDate(at)}, its last day to pay: it can no longer be paid — reserve it again while it is offered`;
/** PRICES_NOT_FINAL (payment): reserved before the prices are final, paid once they are (E6). */
export const PRICES_NOT_FINAL_REFUSAL = 'The prices of this session are not final yet: the subject is reserved, and it can be paid once the school confirms its prices';
/**
 * PRICES_NOT_FINAL for one line when its session's prices are final: an older line priced from a fee not confirmed
 * (the deprecated fee grid) whose row has no exam fee of its own yet. Its subject's price, not the session's.
 */
export const LINE_PRICE_NOT_FINAL_REFUSAL = (what: string) =>
  `${what}'s price is not confirmed yet: the subject is reserved, and it can be paid once the school confirms its price`;

export type ReserveVerdict =
  | { allowed: true; by: 'open' | 'later_reserve_date' }
  | { allowed: false; code: 'NOT_OPEN' | 'NOT_ACCEPTING' | 'BOARD_DEADLINE_PASSED' | 'NOT_FOUND'; message: string };

/** A may-reserve refusal as the error a path throws, with its code (NOT_FOUND carries none). */
export function reserveRefusal(v: Extract<ReserveVerdict, { allowed: false }>): Error {
  const err = new Error(v.message);
  return v.code === 'NOT_FOUND' ? err : coded(err, v.code);
}

/**
 * A G4 later reserve date covering the scope (the student's own or their family's), still ahead: one with no
 * date covers until it is revoked.
 */
async function laterReserveDate(executor: Executor, studentId: string, scope: { sessionId: string; subjectId?: string }, now: Date) {
  const rows = await lineExceptions.active(executor, studentId, ['deadline.reserve'], scope);
  return rows.some((r) => !r.valueDate || r.valueDate > now);
}

/** The session's own Accepting state: active and not past its optional close date (the scheduler closes it at that date). */
function sessionOpen(s: { status: string; endDate: Date | null }, now: Date) {
  return s.status === 'active' && !(s.endDate && s.endDate <= now);
}

/**
 * May this student start a reservation in the session (before its lines exist)? The session open, or a G4
 * later reserve date covering it (with `subjectIds`, covering each of them: a subject's own date covers that
 * subject alone). Each line's subject, row and board deadline are asked when it is made (`mayReserveRow`).
 */
export async function mayReserveSession(
  executor: Executor, studentId: string, sessionId: string, now: Date = new Date(), subjectIds?: readonly string[],
): Promise<ReserveVerdict> {
  const [s] = await executor.select({ name: registrationSession.name, status: registrationSession.status, endDate: registrationSession.endDate, closedAt: registrationSession.closedAt })
    .from(registrationSession).where(eq(registrationSession.id, sessionId));
  if (!s) return { allowed: false, code: 'NOT_FOUND', message: 'Session not found' };
  if (s.status === 'draft') return { allowed: false, code: 'NOT_OPEN', message: NOT_OPEN_REFUSAL(s.name) };
  if (sessionOpen(s, now)) return { allowed: true, by: 'open' };
  const subjects = [...new Set(subjectIds ?? [])];
  const covered = subjects.length
    ? (await Promise.all(subjects.map((subjectId) => laterReserveDate(executor, studentId, { sessionId, subjectId }, now)))).every(Boolean)
    : await laterReserveDate(executor, studentId, { sessionId }, now);
  if (covered) return { allowed: true, by: 'later_reserve_date' };
  return { allowed: false, code: 'NOT_ACCEPTING', message: NOT_ACCEPTING_REFUSAL(s.name, s.closedAt ?? s.endDate) };
}

/**
 * May this student reserve this option of this row now (§6)? The session open, the subject accepting and not
 * past its close, the row not past its close — or a G4 later reserve date covering it — and never past the
 * line's board deadline. Called inside the creating transaction, after insertLines has locked the session,
 * the offering and the row FOR SHARE (a close or a reopen at the same moment waits for it, or it for them).
 */
export async function mayReserveRow(
  executor: Executor,
  a: { studentId: string; offerItemId: string; attempt: string; priorSittingSeriesId: string | null },
  now: Date = new Date(),
): Promise<ReserveVerdict> {
  const [r] = await executor.select({
    sessionId: registrationSession.id, sessionName: registrationSession.name, status: registrationSession.status, endDate: registrationSession.endDate,
    closedAt: registrationSession.closedAt, accepting: sessionOffer.accepting, offerClosesAt: sessionOffer.closesAt, subjectId: sessionOffer.subjectId,
    subjectName: subject.name, rowClosesAt: sessionOfferItem.closesAt, kind: sessionOfferItem.kind, label: sessionOfferItem.label,
    boardSeriesId: sessionOfferItem.boardSeriesId,
  })
    .from(sessionOfferItem)
    .innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId))
    .innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
    .innerJoin(registrationSession, eq(registrationSession.id, sessionOfferItem.sessionId))
    .where(eq(sessionOfferItem.id, a.offerItemId));
  if (!r) return { allowed: false, code: 'NOT_FOUND', message: 'That item is not on offer in this session' };
  const what = r.kind === 'all_papers' ? r.subjectName : `${r.subjectName} — ${r.label}`;
  // The board's deadline first: nothing lifts it (C6).
  const deadline = await effectiveDeadlineFor(executor, { boardSeriesId: r.boardSeriesId, attempt: a.attempt, priorSittingSeriesId: a.priorSittingSeriesId, declarationRejected: false });
  if (deadline.at && deadline.at <= now) return { allowed: false, code: 'BOARD_DEADLINE_PASSED', message: BOARD_DEADLINE_PASSED_REFUSAL(what, deadline.at, deadline.kind) };
  if (r.status === 'draft') return { allowed: false, code: 'NOT_OPEN', message: NOT_OPEN_REFUSAL(r.sessionName) };
  // Her dates (C4, D12): the session's, the subject's and the row's.
  const closed: { what: string; since: Date | null } | null = !sessionOpen(r, now) ? { what: r.sessionName, since: r.closedAt ?? r.endDate }
    : !r.accepting ? { what: r.subjectName, since: null }
      : r.offerClosesAt && r.offerClosesAt <= now ? { what: r.subjectName, since: r.offerClosesAt }
        : r.rowClosesAt && r.rowClosesAt <= now ? { what, since: r.rowClosesAt }
          : null;
  if (!closed) return { allowed: true, by: 'open' };
  if (await laterReserveDate(executor, a.studentId, { sessionId: r.sessionId, subjectId: r.subjectId }, now)) return { allowed: true, by: 'later_reserve_date' };
  return { allowed: false, code: 'NOT_ACCEPTING', message: NOT_ACCEPTING_REFUSAL(closed.what, closed.since) };
}

// ─── Paying ──────────────────────────────────────────────────────────────────

/** The SQL of a registration row's cut-off (`alias`: the row's table alias). */
export function lineCutOffSql(alias = 'r') {
  return sql.raw(`line_cut_off(${alias}.due_at, ${alias}.session_id, ${alias}.attempt, ${alias}.prior_sitting_series_id, ${alias}.board_series_id, ${alias}.declaration_rejected)`);
}

export type LineCutOff = {
  /** The last moment the line can be paid: the earlier of due + the session's days and the board deadline. */
  cutOff: Date;
  /** Its board deadline (reference dates), or null when its sitting has none. */
  boardDeadline: Date | null;
  /** Which date the cut-off is: the board's (`entry_deadline`) when it is the earlier, else the session's own (`cut_off`). */
  reason: 'entry_deadline' | 'cut_off';
};

const asDate = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

/** The cut-offs of stored lines, by id. */
export async function cutOffsOf(executor: Executor, registrationIds: string[]): Promise<Map<string, LineCutOff>> {
  const out = new Map<string, LineCutOff>();
  const ids = [...new Set(registrationIds)];
  if (!ids.length) return out;
  const rows = (await executor.execute(sql`
    select r.id, ${lineCutOffSql('r')} as "cutOff",
      line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected) as "boardDeadline"
    from registration r where r.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)).rows as { id: string; cutOff: unknown; boardDeadline: unknown }[];
  for (const r of rows) {
    const cutOff = asDate(r.cutOff)!;
    const boardDeadline = asDate(r.boardDeadline);
    out.set(r.id, { cutOff, boardDeadline, reason: boardDeadline && boardDeadline.getTime() <= cutOff.getTime() ? 'entry_deadline' : 'cut_off' });
  }
  return out;
}

export type PayLine = {
  id: string;
  studentId: string;
  sessionId: string;
  status: string;
  priceProvisional: boolean;
};

export type PayVerdict =
  | { allowed: true; cutOff: LineCutOff }
  | { allowed: false; code: 'NOT_WAITING' | 'CUT_OFF_PASSED' | 'BOARD_DEADLINE_PASSED' | 'PRICES_NOT_FINAL' | 'NOT_ELIGIBLE'; message: string; cutOff: LineCutOff | null };

/**
 * May this line be paid now (§6)? Waiting (pending_payment), not past its cut-off, its price final, the student
 * still at the school. The session's or the subject's close does not enter: a waiting line is payable until its
 * cut-off. `what` names the line in a refusal.
 */
export async function mayPay(executor: Executor, line: PayLine, what: string, now: Date = new Date()): Promise<PayVerdict> {
  const cutOff = (await cutOffsOf(executor, [line.id])).get(line.id) ?? null;
  if (line.status !== 'pending_payment') return { allowed: false, code: 'NOT_WAITING', message: `${what} is not waiting for payment`, cutOff };
  if (cutOff && cutOff.cutOff <= now) {
    return cutOff.reason === 'entry_deadline'
      ? { allowed: false, code: 'BOARD_DEADLINE_PASSED', message: BOARD_DEADLINE_PASSED_REFUSAL(what, cutOff.cutOff), cutOff }
      : { allowed: false, code: 'CUT_OFF_PASSED', message: CUT_OFF_PASSED_REFUSAL(what, cutOff.cutOff), cutOff };
  }
  if (line.priceProvisional) {
    // The session's prices final yet this line's not: its own subject's price is what waits (L-lead of the P1b review).
    const [s] = await executor.select({ pricesFinal: registrationSession.pricesFinal }).from(registrationSession).where(eq(registrationSession.id, line.sessionId));
    return { allowed: false, code: 'PRICES_NOT_FINAL', message: s?.pricesFinal ? LINE_PRICE_NOT_FINAL_REFUSAL(what) : PRICES_NOT_FINAL_REFUSAL, cutOff };
  }
  // Still at the school (F0a: left, cohort corrected): the grade list does not enter — changing it never strands a line.
  const e = await mayRegisterFor(line.studentId, line.sessionId, executor, { forNewReservation: false });
  if (!e.allowed) return { allowed: false, code: 'NOT_ELIGIBLE', message: e.reason!, cutOff };
  return { allowed: true, cutOff: cutOff! };
}

/** The names of lines as a refusal reads them (the subject, and the row when it is not all papers). */
export async function lineNames(executor: Executor, registrationIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(registrationIds)];
  if (!ids.length) return new Map();
  const rows = (await executor.execute(sql`
    select r.id, s.name, i.kind, i.label from registration r join subject s on s.id = r.subject_id join session_offer_item i on i.id = r.offer_item_id
    where r.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)).rows as { id: string; name: string; kind: string; label: string }[];
  return new Map(rows.map((r) => [r.id, r.kind === 'all_papers' ? r.name : `${r.name} — ${r.label}`]));
}

/**
 * Refuse unless every line may be paid now: the first refusal's sentence and its code. Returns each line's cut-off.
 * The prices-final refusal is the session's (one sentence for the checkout and the desk), or the line's own subject's
 * when the session's prices are final and its price is not.
 */
export async function assertMayPay(executor: Executor, lines: PayLine[], now: Date = new Date()): Promise<Map<string, LineCutOff>> {
  const names = await lineNames(executor, lines.map((l) => l.id));
  const out = new Map<string, LineCutOff>();
  for (const l of lines) {
    const v = await mayPay(executor, l, names.get(l.id) ?? 'This subject', now);
    if (!v.allowed) throw coded(new Error(v.message), v.code);
    out.set(l.id, v.cutOff);
  }
  return out;
}

/**
 * The subjects of a new reservation's items, for the session-level check's subject-scoped later reserve dates.
 * An id not on offer is left out: the reservation refuses it.
 */
export async function subjectsOfItems(executor: Executor, itemIds: readonly string[]): Promise<string[]> {
  if (!itemIds.length) return [];
  const rows = await executor.selectDistinct({ subjectId: sessionOffer.subjectId }).from(sessionOfferItem)
    .innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId))
    .where(inArray(sessionOfferItem.id, [...itemIds]));
  return rows.map((r) => r.subjectId);
}
