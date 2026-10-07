/**
 * Deadlines per line and due dates (RESERVATIONS_REWORK.md §3.1, §3.3; docs/features/RESERVATIONS.md §2.6).
 *
 * The cut-off is per item, and per line: a line's **effective deadline** is its series' retake
 * deadline when the line is a retake whose prior sitting is the board's latest sitting before
 * this series (what Cambridge's later date covers), else the series' entry deadline (MO-10's
 * hard stop), else — a series with no entry deadline — the start of its exams_start day in
 * Cairo, else none. One rule in SQL (`line_effective_deadline`, migration 0042), read here and
 * by every query that groups or sweeps by deadline.
 *
 * A line's **due date** is when the school expects the money (`due_at`): the session's payment
 * due date; a line reserved after it, the reservation plus `payment.graceDays`; a line whose
 * board fee is provisional, no earlier than the fee's confirmation plus the grace; a
 * `deadline.payment` exception replaces it; never later than the effective deadline. It drives
 * reminders, "overdue" and the statement; it expires nothing by itself.
 */

import { db, registration, registrationSession, boardFee, sql, eq, inArray } from '@repo/db';
import { getSetting } from './settings.services';
import { lineExceptions, type ExceptionScope } from './line-exceptions';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type LineDeadlineKey = { boardSeriesId: string | null; attempt: string; priorSittingSeriesId: string | null };
export type DeadlineKind = 'retake' | 'entry' | 'exams_start';
export type EffectiveDeadline = { at: Date | null; kind: DeadlineKind | null };

const asDate = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

/** The SQL expression of a registration row's effective deadline (`alias` is the row's table alias). */
export function lineDeadlineSql(alias = 'r') {
  return sql.raw(`line_effective_deadline(${alias}.attempt, ${alias}.prior_sitting_series_id, ${alias}.board_series_id)`);
}

/** One line's effective deadline and which date it is. */
export async function effectiveDeadlineFor(executor: Executor, line: LineDeadlineKey): Promise<EffectiveDeadline> {
  if (!line.boardSeriesId) return { at: null, kind: null };
  const r = await executor.execute(sql`
    select line_effective_deadline(${line.attempt}, ${line.priorSittingSeriesId}, ${line.boardSeriesId}) as at,
           line_effective_deadline_kind(${line.attempt}, ${line.priorSittingSeriesId}, ${line.boardSeriesId}) as kind`);
  const row = r.rows[0] as { at: unknown; kind: DeadlineKind | null } | undefined;
  return { at: asDate(row?.at), kind: row?.kind ?? null };
}

/** The effective deadlines of stored lines, by id. */
export async function effectiveDeadlinesOf(executor: Executor, registrationIds: string[]): Promise<Map<string, EffectiveDeadline>> {
  const out = new Map<string, EffectiveDeadline>();
  if (!registrationIds.length) return out;
  const r = await executor.execute(sql`
    select r.id,
      line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id) as at,
      line_effective_deadline_kind(r.attempt, r.prior_sitting_series_id, r.board_series_id) as kind
    from registration r where r.id in (${sql.join(registrationIds.map((id) => sql`${id}`), sql`, `)})`);
  for (const row of r.rows as { id: string; at: unknown; kind: DeadlineKind | null }[]) {
    out.set(row.id, { at: asDate(row.at), kind: row.kind });
  }
  return out;
}

/** The sentence a refusal gives once a line's deadline has passed. */
export function deadlinePassedSentence(d: EffectiveDeadline, schoolDate: (d: Date) => string): string {
  const when = d.at ? schoolDate(d.at) : '';
  if (d.kind === 'retake') return `The registration window is not open: the exam board's retake deadline for this series (${when}) has passed`;
  if (d.kind === 'exams_start') return `The registration window is not open: this series' exams start on ${when} and it has no entry deadline`;
  return `The registration window is not open: the exam board's entry deadline for this series (${when}) has passed`;
}

// ─── Due dates ───────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

/** The due-date rule itself, with everything it reads passed in. */
export function computeDueAt(a: {
  basis: Date;                 // the session's payment due date, or a charge's own
  reservedAt: Date;
  graceDays: number;
  provisional: boolean;        // the board fee read is still provisional
  feeConfirmedAt: Date | null; // when the last fee row read was confirmed (once none is provisional)
  exceptionDate: Date | null;  // a deadline.payment exception
  cap: Date | null;            // the line's effective deadline (or a service's)
}): Date {
  let due = a.basis;
  if (a.reservedAt > due) due = new Date(a.reservedAt.getTime() + a.graceDays * DAY);
  if (!a.provisional && a.feeConfirmedAt) {
    const afterConfirm = new Date(a.feeConfirmedAt.getTime() + a.graceDays * DAY);
    // Only a confirmation that came after the line was reserved moves it.
    if (a.feeConfirmedAt > a.reservedAt && afterConfirm > due) due = afterConfirm;
  }
  if (a.exceptionDate) due = a.exceptionDate;
  if (a.cap && due > a.cap) due = a.cap;
  return due;
}

export type DueDateInput =
  | { kind: 'line'; lineId: string }
  | { kind: 'charge'; studentId: string; baseDueAt: Date; reservedAt: Date; cap: Date | null; scope: ExceptionScope };

/**
 * A line's or a charge's due date (§3.1). A line is read with its session, its pricing basis'
 * fee rows and its effective deadline; a charge (step C) brings its own base and cap.
 */
export async function dueDateFor(executor: Executor, input: DueDateInput): Promise<Date> {
  const graceDays = await getSetting('payment.graceDays', executor);
  if (input.kind === 'charge') {
    const exc = await lineExceptions.active(executor, input.studentId, ['deadline.payment'], input.scope);
    return computeDueAt({
      basis: input.baseDueAt, reservedAt: input.reservedAt, graceDays, provisional: false, feeConfirmedAt: null,
      exceptionDate: exc.find((e) => e.valueDate)?.valueDate ?? null, cap: input.cap,
    });
  }
  const [line] = await executor
    .select({
      id: registration.id, studentId: registration.studentId, sessionId: registration.sessionId, subjectId: registration.subjectId,
      offerItemId: registration.offerItemId, boardSeriesId: registration.boardSeriesId, attempt: registration.attempt,
      priorSittingSeriesId: registration.priorSittingSeriesId, createdAt: registration.createdAt,
      priceProvisional: registration.priceProvisional, pricingBasis: registration.pricingBasis, paymentDueAt: registrationSession.paymentDueAt,
    })
    .from(registration)
    .innerJoin(registrationSession, eq(registrationSession.id, registration.sessionId))
    .where(eq(registration.id, input.lineId));
  if (!line) throw new Error('Registration not found');
  const feeIds = ((line.pricingBasis as { feeRows?: { id: string }[] } | null)?.feeRows ?? []).map((f) => f.id);
  const rows = feeIds.length
    ? await executor.select({ confirmedAt: boardFee.confirmedAt }).from(boardFee).where(inArray(boardFee.id, feeIds))
    : [];
  const confirmed = rows.map((r) => r.confirmedAt).filter((d): d is Date => !!d);
  const feeConfirmedAt = !line.priceProvisional && confirmed.length ? new Date(Math.max(...confirmed.map((d) => d.getTime()))) : null;
  const [deadline, exc] = await Promise.all([
    effectiveDeadlineFor(executor, line),
    lineExceptions.active(executor, line.studentId, ['deadline.payment'], {
      sessionId: line.sessionId, subjectId: line.subjectId, offerItemId: line.offerItemId, registrationId: line.id,
    }),
  ]);
  return computeDueAt({
    basis: line.paymentDueAt, reservedAt: line.createdAt, graceDays, provisional: line.priceProvisional, feeConfirmedAt,
    exceptionDate: exc.find((e) => e.valueDate)?.valueDate ?? null, cap: deadline.at,
  });
}
