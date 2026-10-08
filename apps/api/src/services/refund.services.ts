/**
 * Refunds (V3 §6.12, D-L; the reservations rework, RESERVATIONS_REWORK.md §3.9, Q-19).
 *
 * `refundFor(line, at)` is the one answer to "what does a drop of this line give back now?",
 * asked by every drop: a family's (directly or through a change request), a swap's drop leg, a
 * preregistration cancelled, the desk's drop past a deadline, and an instalment plan's settlement.
 *
 * - **A line reserved since the rework** refunds from its `refund_policy_snapshot` — the steps in
 *   weeks the family consented to (step B writes it at consent; a line made before consent existed
 *   reads its session's policy instead) — counted from its **anchor**, resolved now: a
 *   `refund.courseStart` exception (line or offer scope) › the first lesson of the student's
 *   teaching group (F1, when it is live: the seam `firstLessonFor`) › the offer's
 *   `course_starts_on` › the session's. Then a `refund.percent` exception replaces the step.
 *   **The percent applies to the course fee**; the board fee comes back in full while the entry
 *   has **not been sent** and not at all after: a line never confirmed was never sent; a confirmed
 *   line is sent from the earliest time any of its entries was marked sent (F4's `sentEntriesOf`,
 *   withdrawn ones included: a partly sent line is a sent line, the lead, 8 Oct), else once its effective
 *   deadline (the retake deadline, the entry deadline, or its series' exams' start) has passed.
 *   A custom-priced line (course = the total, board = 0) refunds its total by the course rule.
 * - **A converted line** (`legacy.converted`, or a session with no policy) refunds as V3 did:
 *   the session's absolute refund windows (else its academic year's; none: 100%; a gap: 0%), or
 *   a `refund.percent` exception, on the whole price (Q-19's default keeps today's basis for
 *   them).
 * - MO-21 (a series that never opened refunds 100% of the whole price) is the caller's: the
 *   deadline sweep's preregistration refund and a cancellation past the deadline do not ask here.
 * - A line under an instalment plan refunds nothing itself (nothing was paid to it); its deposits
 *   are settled by plan.services' rule, which asks here what a paid drop would give back.
 *
 * The percentage locks when the drop is decided (never at receipt-return time — paperwork delay
 * must not cost the parent money).
 */

import { db, refundWindow, registration, registrationSession, sessionOffer, sessionOfferItem, examEntry, eq, and, isNotNull, asc } from '@repo/db';
import { randomUUID } from 'crypto';
import type { CreateRefundWindowType, RefundPolicy } from '@repo/validations';
import { academicYearForDate } from './school-fee.services';
import { activeExceptions } from './exception-registry.services';
import { effectiveDeadlineFor } from './deadline.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The absolute windows of a session (else its academic year): V3's rule, for converted lines. */
async function windowsPercent(executor: Executor, at: Date, sessionId: string, sessionStart: Date): Promise<number> {
  let windows = await executor.select().from(refundWindow).where(eq(refundWindow.sessionId, sessionId));
  if (windows.length === 0) {
    windows = await executor.select().from(refundWindow).where(eq(refundWindow.academicYear, academicYearForDate(sessionStart)));
  }
  if (windows.length === 0) return 100; // nothing configured → gate off
  const match = windows.find((w) => w.startsAt <= at && at <= w.endsAt);
  return match ? match.percentage : 0;
}

/**
 * F1's seam (§3.1): the first lesson of the student's teaching group for the line's offer and
 * unit, once scheduling is live. Until then none, and the offer's or the session's course start
 * anchors the line.
 */
export async function firstLessonFor(_executor: Executor, _line: { id: string; studentId: string; offerItemId: string }): Promise<string | null> {
  return null;
}

/**
 * F4's entries made from a line that were marked sent to the board ("mark as sent",
 * exam-entry.services `submitEntries`), earliest first — withdrawn ones included: the board
 * received them (whether it refunds the school is its own withdrawal rule, shown as a sentence;
 * the family's board fee stays either way, the lead's decision of 8 Oct). The one seam `refundFor`
 * reads (the review of 093dbd1, item 9: C's `entrySentAt` stand-in removed); the earliest one's
 * time is when the line's board fee became sent. Wired by F4 on resuming (RESERVATIONS_MONEY.md §10).
 */
export async function sentEntriesOf(executor: Executor, lineId: string) {
  const rows = await executor.select({ entryCode: examEntry.entryCode, title: examEntry.title, submittedAt: examEntry.submittedAt, status: examEntry.status })
    .from(examEntry).where(and(eq(examEntry.registrationId, lineId), isNotNull(examEntry.submittedAt)))
    .orderBy(asc(examEntry.submittedAt), asc(examEntry.entryCode));
  return rows.map((r) => ({ ...r, submittedAt: r.submittedAt! }));
}

/** "8 October 2026" in Cairo. */
const dayWords = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long', year: 'numeric' }).format(d);

const DAY = 24 * 60 * 60 * 1000;

/** The start of a school day (Africa/Cairo), as an instant. */
export function cairoDayStart(day: string): Date {
  const probe = new Date(`${day}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(probe);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const cairoAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  const offset = cairoAsUtc - probe.getTime();
  return new Date(Date.parse(`${day}T00:00:00Z`) - offset);
}

/** The policy week `at` falls in, counted from the anchor day (week 1: its first seven days). */
export function policyWeek(anchorDay: string, at: Date): number {
  const days = Math.floor((at.getTime() - cairoDayStart(anchorDay).getTime()) / DAY);
  return days < 0 ? 1 : Math.floor(days / 7) + 1;
}

/** The step of a policy for a week. */
export function stepPercent(steps: RefundPolicy['steps'], week: number): number {
  for (const s of steps) if (s.throughWeek === null || week <= s.throughWeek) return s.percent;
  return steps[steps.length - 1]?.percent ?? 0;
}

const asDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);

type Snapshot =
  | { kind: 'weeks'; steps: RefundPolicy['steps'] }
  | { kind: 'dates'; windows: { startsAt: string; endsAt: string; percent: number }[] };

export type RefundQuote = {
  registrationId: string;
  /** The percent that applies (to the course fee; to the whole price on a converted line). */
  percent: number;
  /** 'policy': the line's steps; 'windows': V3's absolute windows (a converted line). */
  basis: 'policy' | 'windows';
  /** A refund.percent exception decided the percent. */
  byException: boolean;
  /** The anchor day and week, for a policy line. */
  anchor: string | null;
  week: number | null;
  coursePart: number;
  boardPart: number;
  /** Whether the line's entry counts as sent to the board now (its board fee then stays). */
  boardSent: boolean;
  /** F4's entries of the line marked sent by then (code, title, when), earliest first. */
  sentEntries: { entryCode: string; title: string; submittedAt: Date }[];
  /** Why the board fee comes back or stays, naming the entries sent and when (null on a converted line). */
  boardNote: string | null;
  amount: number;
  fullPrice: number;
};

/**
 * What a drop of this line at `at` gives back (§3.9). `neverSent`: count the board fee as not
 * sent whatever the line's status (a line held at its deadline under `hold`, never entered).
 */
export async function refundFor(
  executor: Executor,
  lineId: string,
  at: Date = new Date(),
  opts: { neverSent?: boolean } = {},
): Promise<RefundQuote> {
  const [l] = await executor
    .select({
      id: registration.id, studentId: registration.studentId, sessionId: registration.sessionId, subjectId: registration.subjectId,
      offerItemId: registration.offerItemId, status: registration.status, price: registration.priceAtRegistration,
      courseFee: registration.courseFeeAtRegistration, boardFee: registration.registrationFeeAtRegistration,
      snapshot: registration.refundPolicySnapshot, legacy: registration.legacy,
      boardSeriesId: registration.boardSeriesId, attempt: registration.attempt, priorSittingSeriesId: registration.priorSittingSeriesId,
      declarationRejected: registration.declarationRejected,
      sessionStart: registrationSession.startDate, sessionCourseStart: registrationSession.courseStartsOn, sessionPolicy: registrationSession.refundPolicy,
      offerId: sessionOffer.id, offerCourseStart: sessionOffer.courseStartsOn,
    })
    .from(registration)
    .innerJoin(registrationSession, eq(registrationSession.id, registration.sessionId))
    .innerJoin(sessionOfferItem, eq(sessionOfferItem.id, registration.offerItemId))
    .innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId))
    .where(eq(registration.id, lineId));
  if (!l) throw new Error('Registration not found');

  const scope = { sessionId: l.sessionId, subjectId: l.subjectId, offerId: l.offerId, offerItemId: l.offerItemId, registrationId: l.id };
  // The oldest active one, as V3's custom refund percent was read (exception.services, hook 4).
  const [percentExc] = (await activeExceptions(executor, l.studentId, ['refund.percent'], scope, { now: at })).filter((r) => r.value != null);

  const converted = (l.legacy as { converted?: boolean } | null)?.converted === true;
  const snapshot: Snapshot | null = (l.snapshot as Snapshot | null) ?? (l.sessionPolicy ? { kind: 'weeks', steps: l.sessionPolicy.steps } : null);
  if (converted || !snapshot) {
    // V3's rule on the whole price, as today.
    const percent = percentExc ? percentExc.value! : await windowsPercent(executor, at, l.sessionId, l.sessionStart);
    const amount = round2((l.price * percent) / 100);
    return {
      registrationId: l.id, percent, basis: 'windows', byException: !!percentExc, anchor: null, week: null,
      coursePart: amount, boardPart: 0, boardSent: false, sentEntries: [], boardNote: null, amount, fullPrice: l.price,
    };
  }

  let percent: number;
  let anchor: string | null = null;
  let week: number | null = null;
  if (snapshot.kind === 'dates') {
    const w = snapshot.windows;
    const match = w.find((x) => new Date(x.startsAt) <= at && at <= new Date(x.endsAt));
    percent = w.length === 0 ? 100 : match ? match.percent : 0;
  } else {
    const [startExc] = (await activeExceptions(executor, l.studentId, ['refund.courseStart'], scope, { now: at })).filter((r) => r.valueDate);
    anchor = startExc ? asDay(startExc.valueDate!) : (await firstLessonFor(executor, l)) ?? l.offerCourseStart ?? l.sessionCourseStart;
    week = policyWeek(anchor, at);
    percent = stepPercent(snapshot.steps, week);
  }
  if (percentExc) percent = percentExc.value!;

  // "Sent" is per line: never confirmed, never sent; else F4's mark (the earliest entry marked
  // sent), else the effective deadline.
  let boardSent = false;
  let sentEntries: RefundQuote['sentEntries'] = [];
  let boardNote: string | null = 'The board fee comes back: the entry has not been sent to the board.';
  if (opts.neverSent) {
    boardNote = 'The board fee comes back: the line was never entered with the board.';
  } else if (l.status === 'confirmed' || l.status === 'dropped_pending_receipt') {
    const all = await sentEntriesOf(executor, l.id);
    sentEntries = all.filter((e) => e.submittedAt <= at).map(({ entryCode, title, submittedAt }) => ({ entryCode, title, submittedAt }));
    const marked = all[0]?.submittedAt ?? null;
    if (marked) {
      boardSent = marked <= at;
      if (boardSent) {
        const unsent = (await executor.select({ entryCode: examEntry.entryCode }).from(examEntry)
          .where(and(eq(examEntry.registrationId, l.id), eq(examEntry.status, 'draft')))).map((e) => e.entryCode);
        boardNote = `The board fee stays with the board: the school sent ${sentEntries.map((e) => `${e.entryCode} ${e.title} on ${dayWords(e.submittedAt)}`).join(', ')}`
          + `${unsent.length ? ` (${unsent.join(', ')} not sent yet)` : ''}.`;
      }
    } else {
      const d = await effectiveDeadlineFor(executor, l);
      boardSent = !!d.at && d.at <= at;
      if (boardSent) boardNote = `The board fee stays with the board: the ${d.kind === 'retake' ? 'retake deadline' : d.kind === 'exams_start' ? "exams' start" : 'entry deadline'} (${dayWords(d.at!)}) has passed.`;
    }
  } else {
    boardNote = 'The board fee comes back: a line not paid was never sent to the board.';
  }
  const coursePart = round2((l.courseFee * percent) / 100);
  const boardPart = boardSent ? 0 : round2(l.boardFee);
  return {
    registrationId: l.id, percent, basis: 'policy', byException: !!percentExc, anchor, week,
    coursePart, boardPart, boardSent, sentEntries, boardNote, amount: round2(coursePart + boardPart), fullPrice: l.price,
  };
}

/** How a refund reads in a notice: "EGP 1,000.00 (50% of the course fee and the board fee)". */
export function refundSentence(q: Pick<RefundQuote, 'amount' | 'percent' | 'basis' | 'boardPart'>): string {
  if (q.basis === 'windows') return `EGP ${q.amount.toFixed(2)} (${q.percent}%)`;
  return `EGP ${q.amount.toFixed(2)} (${q.percent}% of the course fee${q.boardPart > 0 ? ' and the board fee' : ''})`;
}

/**
 * Preview for the confirm dialogs: "You will receive EGP Y back" before deciding a drop or a
 * swap (§6.12; §3.9 for its parts).
 */
export async function previewRefund(registrationId: string) {
  const q = await refundFor(db, registrationId, new Date());
  return {
    registrationId: q.registrationId,
    percentage: q.percent,
    amount: q.amount,
    fullPrice: q.fullPrice,
    coursePart: q.coursePart,
    boardPart: q.boardPart,
    boardSent: q.boardSent,
    sentEntries: q.sentEntries,
    boardNote: q.boardNote,
    basis: q.basis,
  };
}

// ─── Window management (finance admin) ───────────────────────────────────────

/**
 * Windows in one scope may not overlap: a converted line's refund takes the first window
 * containing the date, so two overlapping windows made the refund depend on row order (money
 * audit MA-11). Windows are inclusive at both ends, so one ending exactly when the next starts
 * overlaps too. Since the reservations rework only converted sessions and academic years read
 * them (§3.9): a new line refunds from its own snapshot.
 */
export async function createWindow(data: CreateRefundWindowType) {
  const sameScope = await db.query.refundWindow.findMany({
    where: (w, { eq }) =>
      data.sessionId ? eq(w.sessionId, data.sessionId) : eq(w.academicYear, data.academicYear!),
  });
  const clash = sameScope.find((w) => w.startsAt <= data.endsAt && data.startsAt <= w.endsAt);
  if (clash) {
    throw new Error(
      `This window overlaps "${clash.label ?? 'an existing window'}" (${clash.startsAt.toISOString().slice(0, 10)} to ${clash.endsAt.toISOString().slice(0, 10)}, ${clash.percentage}%) — a date can have only one refund percentage`
    );
  }

  const [created] = await db
    .insert(refundWindow)
    .values({
      id: randomUUID(),
      sessionId: data.sessionId ?? null,
      academicYear: data.academicYear ?? null,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      percentage: data.percentage,
      label: data.label ?? null,
    })
    .returning();
  return created;
}

export async function deleteWindow(id: string) {
  const [deleted] = await db.delete(refundWindow).where(eq(refundWindow.id, id)).returning();
  return deleted;
}

export async function getWindows() {
  return db.query.refundWindow.findMany({
    with: { },
    orderBy: (w, { asc }) => [asc(w.startsAt)],
  });
}
