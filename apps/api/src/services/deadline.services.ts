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

import { db, registration, registrationSession, boardFee, sql, eq, and, inArray } from '@repo/db';
import { getSetting } from './settings.services';
import { lineExceptions, type ExceptionScope } from './line-exceptions';
import { logActions } from './audit.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type LineDeadlineKey = {
  boardSeriesId: string | null;
  attempt: string;
  priorSittingSeriesId: string | null;
  /**
   * Step B's `registration.declaration_rejected`: a retake whose declared sitting the school
   * rejected is a first entry for the board — its deadline is the entry deadline (§3.5).
   */
  declarationRejected: boolean | null;
  /** The line's student: a late board entry granted to them (Q-20) is read when given. */
  studentId?: string | null;
};
export type DeadlineKind = 'retake' | 'entry' | 'exams_start';
export type EffectiveDeadline = { at: Date | null; kind: DeadlineKind | null };

const asDate = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

/**
 * The SQL expression of a registration row's effective deadline (`alias` is the row's table alias).
 * With step B merged it passes the row's `declaration_rejected` as the fourth argument (0044).
 */
export function lineDeadlineSql(alias = 'r') {
  return sql.raw(`line_effective_deadline(${alias}.attempt, ${alias}.prior_sitting_series_id, ${alias}.board_series_id, ${alias}.declaration_rejected)`);
}

/**
 * Q-20: a late board entry granted to one student in one series (`deadline.boardEntry`, step C's
 * registry, its `value_date`) is that student's entry deadline there — read only while the setting
 * `exceptions.boardEntryDeadline` is on; off, the board's deadline is a hard stop (MO-10) and a
 * grant made while it was on changes nothing.
 */
export async function lateEntryUntil(executor: Executor, studentId: string, boardSeriesId: string): Promise<Date | null> {
  if (!(await getSetting('exceptions.boardEntryDeadline', executor))) return null;
  const granted = await lineExceptions.active(executor, studentId, ['deadline.boardEntry'], { boardSeriesId });
  const dates = granted.filter((e) => e.valueDate && e.scope.boardSeriesId === boardSeriesId).map((e) => e.valueDate!.getTime());
  return dates.length ? new Date(Math.max(...dates)) : null;
}

/**
 * One line's effective deadline and which date it is: a rejected declaration reads as a first
 * entry; with the student given, a late board entry (Q-20, while its setting is on) moves an
 * entry or retake deadline later to its date.
 */
export async function effectiveDeadlineFor(executor: Executor, line: LineDeadlineKey): Promise<EffectiveDeadline> {
  if (!line.boardSeriesId) return { at: null, kind: null };
  const rejected = !!line.declarationRejected;
  const r = await executor.execute(sql`
    select line_effective_deadline(${line.attempt}, ${line.priorSittingSeriesId}, ${line.boardSeriesId}, ${rejected}) as at,
           line_effective_deadline_kind(${line.attempt}, ${line.priorSittingSeriesId}, ${line.boardSeriesId}, ${rejected}) as kind`);
  const row = r.rows[0] as { at: unknown; kind: DeadlineKind | null } | undefined;
  const base = { at: asDate(row?.at), kind: row?.kind ?? null };
  if (line.studentId && base.at && base.kind !== 'exams_start') {
    const late = await lateEntryUntil(executor, line.studentId, line.boardSeriesId);
    if (late && late > base.at) return { at: late, kind: 'entry' };
  }
  return base;
}

/**
 * The deadline sweep's exemption (Q-20): of a series' live lines, those whose student holds a late
 * entry there still ahead of `now` — none while the setting is off.
 */
export async function linesKeptByLateEntry(executor: Executor, boardSeriesId: string, now: Date): Promise<string[]> {
  if (!(await getSetting('exceptions.boardEntryDeadline', executor))) return [];
  const rows = await executor.select({ id: registration.id, studentId: registration.studentId }).from(registration)
    .where(and(eq(registration.boardSeriesId, boardSeriesId), sql`${registration.status} not in ('rejected', 'expired', 'dropped')`));
  const until = new Map<string, Date | null>();
  const kept: string[] = [];
  for (const r of rows) {
    if (!until.has(r.studentId)) until.set(r.studentId, await lateEntryUntil(executor, r.studentId, boardSeriesId));
    const d = until.get(r.studentId);
    if (d && d > now) kept.push(r.id);
  }
  return kept;
}

/**
 * The effective deadlines of stored lines, by id — each line's student's late board entry (Q-20)
 * read as effectiveDeadlineFor reads it, while the setting is on (the review of 40c1447..af33662:
 * the InstaPay reference check and the moves read deadlines here).
 */
export async function effectiveDeadlinesOf(executor: Executor, registrationIds: string[]): Promise<Map<string, EffectiveDeadline>> {
  const out = new Map<string, EffectiveDeadline>();
  if (!registrationIds.length) return out;
  const r = await executor.execute(sql`
    select r.id, r.student_id as "studentId", r.board_series_id as "seriesId",
      line_effective_deadline(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected) as at,
      line_effective_deadline_kind(r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected) as kind
    from registration r where r.id in (${sql.join(registrationIds.map((id) => sql`${id}`), sql`, `)})`);
  const lateOn = await getSetting('exceptions.boardEntryDeadline', executor);
  const late = new Map<string, Date | null>();
  for (const row of r.rows as { id: string; studentId: string; seriesId: string | null; at: unknown; kind: DeadlineKind | null }[]) {
    let d: EffectiveDeadline = { at: asDate(row.at), kind: row.kind };
    if (lateOn && d.at && d.kind !== 'exams_start' && row.seriesId) {
      const key = `${row.studentId}|${row.seriesId}`;
      if (!late.has(key)) late.set(key, await lateEntryUntil(executor, row.studentId, row.seriesId));
      const until = late.get(key);
      if (until && until > d.at) d = { at: until, kind: 'entry' };
    }
    out.set(row.id, d);
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
      priorSittingSeriesId: registration.priorSittingSeriesId, declarationRejected: registration.declarationRejected, createdAt: registration.createdAt,
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

// ─── Re-dating (a due date follows what it is computed from) ─────────────────

const WAITING = ['pending_approval', 'pending_payment', 'preregistered'];

/**
 * Re-date waiting lines the caller has locked, in its transaction: each line's due date computed
 * again (`dueDateFor`); a changed one written and audited (`LINE_DUE_MOVED`, with why). A paid or
 * finished line keeps its date. Returns how many moved.
 */
export async function redateLines(tx: Tx, lineIds: string[], actorId: string | null, why: string) {
  if (!lineIds.length) return 0;
  const rows = await tx.select({ id: registration.id, dueAt: registration.dueAt, status: registration.status })
    .from(registration).where(inArray(registration.id, lineIds)).orderBy(registration.id);
  const moves: { id: string; from: Date; to: Date }[] = [];
  for (const r of rows) {
    if (!WAITING.includes(r.status)) continue;
    const due = await dueDateFor(tx, { kind: 'line', lineId: r.id });
    if (due.getTime() !== r.dueAt.getTime()) {
      await tx.update(registration).set({ dueAt: due }).where(eq(registration.id, r.id));
      moves.push({ id: r.id, from: r.dueAt, to: due });
    }
  }
  await logActions(moves.map((m) => ({
    userId: actorId, action: 'LINE_DUE_MOVED' as const, entityType: 'registration' as const, entityId: m.id,
    previousData: { dueAt: m.from.toISOString() }, newData: { dueAt: m.to.toISOString(), reason: why },
  })), tx);
  return moves.length;
}

/**
 * After a series' dates changed — in its own transaction, once the change has committed: a
 * checkout locks its lines before their series (MA-06), so the series' writer may not lock lines
 * after the series — the waiting lines entered in it are re-dated. Run again, it changes nothing.
 */
export async function redateSeriesLines(seriesId: string, actorId: string | null, why: string) {
  return db.transaction(async (tx) => {
    const lines = await tx.select({ id: registration.id }).from(registration)
      .where(and(eq(registration.boardSeriesId, seriesId), inArray(registration.status, WAITING as never[])))
      .orderBy(registration.id).for('update');
    return redateLines(tx, lines.map((l) => l.id), actorId, why);
  });
}
