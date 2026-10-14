/**
 * Board series (FEATURES_PLAN.md F0b; DISCOVERY_RESEARCH.md §5 note 1; IMPORT_SPIKE.md IS-05,
 * IS-14), as the reservations rework uses them (RESERVATIONS_REWORK.md §3.3).
 *
 * A board series is one board's sitting — Pearson IAL October 2026, Cambridge November 2026 —
 * with every date the board sets. A session's items are each entered in one series; a series is
 * attached to the session when an item is placed in it and detached when nothing references it
 * (offer.services.ts). The admin never assembles one by hand.
 *
 * The exam board's entry deadline is a date of the series (owner decision MO-10, A-08): past it
 * nothing more is entered, paid, referenced or confirmed for a first entry in that series, and
 * the sweep closes what is still open on it. The **cut-off is per line** (§3.3): a retake of the
 * board's previous sitting runs to the series' retake deadline where the board sets one; a
 * series with no entry deadline runs to its exams' start (deadline.services.ts). The late-fee
 * dates are shown for information only.
 *
 * Every series a session is fed by is in the session's academic year and, like the session, a
 * June series or not (the database's rule, 0038; its deadline clause removed by 0042: a session
 * may stay open past one of its series' deadlines — that series' items are simply closed).
 */

import {
  db, boardSeries, sessionBoardSeries, registrationSession, registration, subject, examBoard, sessionOfferItem, sessionOffer,
  eq, and, inArray, notInArray, isNull, sql, asc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  seriesAcademicYearStart, academicYearShortLabel, seriesLabel, sessionSeriesMonths, ROLES,
  BOARD_SERIES_DATE_FIELDS,
  type CreateBoardSeriesType, type UpdateBoardSeriesType,
  type MoveRegistrationsToSeriesType, type ListBoardSeriesQueryType,
} from '@repo/validations';
import { logAction, logActions, type AuditContext } from './audit.services';
import { entriesFollowMoveInTx } from './exam-entry.services';
import { schoolDate, entryDeadlineMessage } from './window.services';
import { lineDeadlineSql, effectiveDeadlinesOf, deadlinePassedSentence, redateLines, redateSeriesLines } from './deadline.services';
import { lockMoveFeeRows, repriceMovedLines, tellPriceChanged } from './line-moves.services';
import { recheckLines, LineRuleError } from './line-rules.services';
import { PricingError } from './pricing.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/** A refusal with the status the route answers. */
export class SeriesError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

const DONE = ['rejected', 'expired', 'dropped'] as const;

/** The month's place in the year (January 1 … November 11), for month arithmetic. */
export function schoolMonthIndex(month: string): number {
  return { january: 1, june: 6, october: 10, november: 11 }[month] ?? 0;
}

/** "Pearson Edexcel October 2026", "Pearson Edexcel June 2027 (IAL)". */
export function boardSeriesName(
  names: Map<string, string>,
  s: { boardCode: string | null; month: string; year: number; label: string | null },
): string {
  const board = s.boardCode ? names.get(s.boardCode) ?? s.boardCode : '';
  return `${board} ${seriesLabel(s.month, s.year)}${s.label ? ` (${s.label})` : ''}`.trim();
}

async function boardNameMap(executor: Executor = db) {
  const rows = await executor.select({ code: examBoard.code, name: examBoard.name, seriesMonths: examBoard.seriesMonths }).from(examBoard);
  return { names: new Map(rows.map((r) => [r.code, r.name])), months: new Map(rows.map((r) => [r.code, r.seriesMonths])) };
}

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string } | null)?.code === '23505' || (err as { cause?: { code?: string } } | null)?.cause?.code === '23505';

/**
 * The rule the database refused, as the sentence a route answers — for a change that got past
 * the service's own checks (a race, or a path that does not check). Null when the error is
 * something else.
 */
export function seriesRuleSentence(err: unknown): string | null {
  const cause = (err as { cause?: { constraint?: string } } | null)?.cause ?? (err as { constraint?: string } | null);
  switch (cause?.constraint) {
    case 'window_series_same_academic_year':
      return 'Every series a session is fed by is in the session\'s academic year';
    case 'window_series_same_kind':
      return 'A June session feeds June series only, and a winter session feeds no June series';
    case 'registration_board_series_board':
      return 'A registration is entered in a series of its subject\'s board';
    case 'registration_board_series_item':
      return 'A line is entered in its item\'s series — the item moved while this was being saved; reload and try again';
    case 'registration_item_of_session_subject':
      return 'That item is not this session\'s offer for the subject';
    case 'registration_offer_item_required':
      return 'A line enters an item of its session\'s offer';
    case 'board_series_board_fixed':
      return 'A series a session is fed by keeps its board';
    case 'registration_board_series_link_fk':
    case 'sessionOfferItem_series_link_fk':
      return 'The session\'s board series changed while this was being saved — reload and try again';
    case 'offer_item_series_board':
      return 'An item is entered in a series of its subject\'s board';
    case 'offer_item_igcse_month':
      return 'IGCSE sits neither October nor January: an IGCSE item is entered in a June or November series';
    case 'registration_unique_live_item_idx':
      return 'This item is already reserved for the student in this session';
    default:
      return null;
  }
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/**
 * The series of an academic year (or all), each with every date, the sessions it is attached
 * to, and the registrations entered in it by status — what each deadline will close. Ordered by
 * entry deadline, then month.
 */
export async function listBoardSeries(filters: ListBoardSeriesQueryType = {}) {
  const { names } = await boardNameMap();
  const rows = await db
    .select()
    .from(boardSeries)
    .where(and(
      filters.boardCode ? eq(boardSeries.boardCode, filters.boardCode) : undefined,
      filters.academicYear !== undefined
        ? sql`school_series_academic_year_start(${boardSeries.month}, ${boardSeries.year}) = ${filters.academicYear}`
        : undefined,
    ))
    .orderBy(asc(boardSeries.year), asc(boardSeries.month), asc(boardSeries.boardCode), asc(boardSeries.label));
  const ids = rows.map((r) => r.id);
  const [links, counts, payments] = ids.length
    ? await Promise.all([
        db.select({
          boardSeriesId: sessionBoardSeries.boardSeriesId, isDefault: sessionBoardSeries.isDefault,
          sessionId: registrationSession.id, name: registrationSession.name, status: registrationSession.status,
          endDate: registrationSession.endDate, qualificationLevel: registrationSession.qualificationLevel,
        })
          .from(sessionBoardSeries)
          .innerJoin(registrationSession, eq(registrationSession.id, sessionBoardSeries.sessionId))
          .where(inArray(sessionBoardSeries.boardSeriesId, ids)),
        db.select({ boardSeriesId: registration.boardSeriesId, status: registration.status, n: sql<number>`count(*)::int` })
          .from(registration)
          .where(inArray(registration.boardSeriesId, ids))
          .groupBy(registration.boardSeriesId, registration.status),
        db.execute(sql`
          select r.board_series_id as id, count(distinct p.id)::int as n
          from payment p join payment_registration pr on pr.payment_id = p.id join registration r on r.id = pr.registration_id
          where r.board_series_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
            and p.status in ('pending', 'pending_verification')
          group by r.board_series_id`).then((r) => r.rows as { id: string; n: number }[]),
      ])
    : [[], [], []];
  const now = new Date();
  return rows
    .map((s) => {
      const byStatus = Object.fromEntries(counts.filter((c) => c.boardSeriesId === s.id).map((c) => [c.status, c.n])) as Record<string, number>;
      const waiting = (byStatus.pending_approval ?? 0) + (byStatus.pending_payment ?? 0) + (byStatus.preregistered ?? 0);
      return {
        ...s,
        name: boardSeriesName(names, s),
        boardName: names.get(s.boardCode) ?? s.boardCode,
        academicYearStart: seriesAcademicYearStart(s.month, s.year),
        academicYear: academicYearShortLabel(seriesAcademicYearStart(s.month, s.year)),
        entryDeadlinePassed: !!s.entryDeadline && s.entryDeadline <= now,
        retakeDeadlinePassed: !!s.retakeDeadline && s.retakeDeadline <= now,
        windows: links.filter((l) => l.boardSeriesId === s.id).map(({ boardSeriesId: _b, ...w }) => w),
        registrations: {
          confirmed: byStatus.confirmed ?? 0,
          waiting,
          expired: byStatus.expired ?? 0,
          total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        },
        // What the deadline would close today: payments still open, registrations still waiting.
        openPayments: payments.find((p) => p.id === s.id)?.n ?? 0,
      };
    })
    .sort((a, b) => (a.entryDeadline?.getTime() ?? Infinity) - (b.entryDeadline?.getTime() ?? Infinity) || a.name.localeCompare(b.name));
}

async function seriesOrThrow(id: string, executor: Executor = db) {
  const [s] = await executor.select().from(boardSeries).where(eq(boardSeries.id, id));
  if (!s) throw new SeriesError('Board series not found', 404);
  return s;
}

// ─── Creating and changing a series ──────────────────────────────────────────

function assertDeadlineChangeAllowed(actorRole: string | null | undefined, which = "the exam board's entry deadline") {
  if (actorRole !== ROLES.ADMIN) {
    throw new SeriesError(`Only an admin sets ${which}: past it the school closes every unconfirmed payment on the series (MO-10)`, 403);
  }
}

export async function createBoardSeries(data: CreateBoardSeriesType, actorId: string, actorRole: string | null | undefined, ctx?: AuditContext) {
  const { names, months } = await boardNameMap();
  const board = names.get(data.boardCode);
  if (!board) throw new SeriesError('Board not found', 404);
  const runs = months.get(data.boardCode) ?? [];
  if (!runs.includes(data.month)) {
    throw new SeriesError(
      `${board} sits ${runs.map((m) => seriesLabel(m, data.year).split(' ')[0]).join(' and ')} series — change the board's months on the Catalogue screen if it now sits in ${seriesLabel(data.month, data.year).split(' ')[0]}`,
    );
  }
  if (data.entryDeadline) {
    assertDeadlineChangeAllowed(actorRole);
    if (data.entryDeadline <= new Date()) throw new SeriesError("The board's entry deadline must be in the future");
  }
  if (data.retakeDeadline) {
    assertDeadlineChangeAllowed(actorRole, "the board's retake deadline");
    if (data.retakeDeadline <= new Date()) throw new SeriesError("The board's retake deadline must be in the future");
    if (data.entryDeadline && data.retakeDeadline < data.entryDeadline) throw new SeriesError('The retake deadline cannot be before the entry deadline');
  }
  try {
    return await db.transaction(async (tx) => {
      const { entryDeadline, retakeDeadline, ...rest } = data;
      const [created] = await tx.insert(boardSeries).values({
        id: randomUUID(), ...rest, entryDeadline: entryDeadline ?? null, retakeDeadline: retakeDeadline ?? null, notes: data.notes ?? null,
      }).returning();
      await logAction(actorId, 'BOARD_SERIES_CREATED', 'board_series', created!.id, null, created as Record<string, unknown>, ctx, tx);
      return created!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new SeriesError(`${boardSeriesName(names, { ...data, label: data.label })} is already on record`, 409);
    }
    throw err;
  }
}

/**
 * One effective deadline per open checkout (F0b, MO-10 per series; per line since the rework):
 * the sweep closes a payment at its lines' deadline, so a checkout paying for lines with
 * different deadlines would lose the later ones at the earlier. Asked after a change, inside its
 * transaction: how many checkouts still open, among those holding a registration in `scope`,
 * now pay for lines whose effective deadlines differ (no deadline counts as one "none"). Every
 * path that changes a line's series or a series' deadline asks it.
 */
export async function openCheckoutsSpanningDeadlines(tx: Tx, scope: { boardSeriesId: string } | { registrationIds: string[] }): Promise<number> {
  const inScope = 'boardSeriesId' in scope
    ? sql`r0.board_series_id = ${scope.boardSeriesId}`
    : scope.registrationIds.length
      ? sql`r0.id in (${sql.join(scope.registrationIds.map((id) => sql`${id}`), sql`, `)})`
      : sql`false`;
  const r = await tx.execute(sql`
    select count(*)::int as n from (
      select p.id from payment p
      join payment_registration pr on pr.payment_id = p.id
      join registration r on r.id = pr.registration_id
      where p.status in ('pending', 'pending_verification')
        and p.id in (select pr0.payment_id from payment_registration pr0 join registration r0 on r0.id = pr0.registration_id where ${inScope})
      group by p.id
      having count(distinct coalesce(${lineDeadlineSql('r')}::text, 'none')) > 1) spanning`);
  return Number((r.rows[0] as { n: number } | undefined)?.n ?? 0);
}

const checkouts = (n: number) => `${n} checkout${n === 1 ? '' : 's'} still open pay${n === 1 ? 's' : ''}`;
const settleFirst = (n: number) => `confirm or cancel ${n === 1 ? 'it' : 'them'} first`;

/**
 * Change a series' dates. The entry deadline and the retake deadline are the admin's (MO-10):
 * in the future when set, with a reason, audited in the transaction. Since the rework a deadline
 * may fall before a session's end (the cut-off is per item); the database keeps only the
 * academic-year and kind rules. Locks the sessions it is attached to (FOR SHARE), then the series.
 */
export async function updateBoardSeries(
  id: string, data: UpdateBoardSeriesType, actorId: string, actorRole: string | null | undefined, ctx?: AuditContext,
) {
  const { names } = await boardNameMap();
  try {
    const changed = await db.transaction(async (tx) => {
      await tx
        .select({ id: registrationSession.id })
        .from(sessionBoardSeries)
        .innerJoin(registrationSession, eq(registrationSession.id, sessionBoardSeries.sessionId))
        .where(eq(sessionBoardSeries.boardSeriesId, id))
        .orderBy(registrationSession.id)
        .for('share', { of: registrationSession });
      const [s] = await tx.select().from(boardSeries).where(eq(boardSeries.id, id)).for('update');
      if (!s) throw new SeriesError('Board series not found', 404);

      const { reason, entryDeadline, retakeDeadline, ...dates } = data;
      const same = (a: Date | null | undefined, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
      const deadlineChanges = entryDeadline !== undefined && !same(entryDeadline, s.entryDeadline);
      const retakeChanges = retakeDeadline !== undefined && !same(retakeDeadline, s.retakeDeadline);
      if (deadlineChanges || retakeChanges) {
        assertDeadlineChangeAllowed(actorRole, deadlineChanges ? "the exam board's entry deadline" : "the board's retake deadline");
        if (!reason || reason.trim().length < 5) throw new SeriesError('Please provide a reason (min 5 characters)');
        if (deadlineChanges && entryDeadline && entryDeadline <= new Date()) throw new SeriesError("The board's entry deadline must be in the future");
        if (retakeChanges && retakeDeadline && retakeDeadline <= new Date()) throw new SeriesError("The board's retake deadline must be in the future");
        const entry = deadlineChanges ? entryDeadline ?? null : s.entryDeadline;
        const retake = retakeChanges ? retakeDeadline ?? null : s.retakeDeadline;
        if (entry && retake && retake < entry) throw new SeriesError('The retake deadline cannot be before the entry deadline');
      }
      for (const f of BOARD_SERIES_DATE_FIELDS) if (dates[f] === undefined) delete dates[f];
      const next = {
        ...dates,
        ...(deadlineChanges ? { entryDeadline: entryDeadline ?? null } : {}),
        ...(retakeChanges ? { retakeDeadline: retakeDeadline ?? null } : {}),
      };
      const [updated] = await tx.update(boardSeries).set({ ...next, updatedAt: new Date() }).where(eq(boardSeries.id, id)).returning();
      if (deadlineChanges || retakeChanges || dates.examsStart !== undefined) {
        // A checkout still open that pays for this series together with another would span two
        // deadlines after the change: refused until it is settled (the same deadline may share).
        const spanning = await openCheckoutsSpanningDeadlines(tx, { boardSeriesId: id });
        if (spanning > 0) {
          throw new SeriesError(
            `${checkouts(spanning)} for this series together with another whose entry deadline would then differ — ${settleFirst(spanning)}, or give the other series the same deadline`,
            409,
          );
        }
      }
      if (deadlineChanges) {
        await logAction(actorId, 'BOARD_SERIES_DEADLINE_SET', 'board_series', id,
          { entryDeadline: s.entryDeadline?.toISOString() ?? null },
          { entryDeadline: entryDeadline?.toISOString() ?? null, reason, series: boardSeriesName(names, s) }, ctx, tx);
      }
      if (retakeChanges) {
        await logAction(actorId, 'BOARD_SERIES_DEADLINE_SET', 'board_series', id,
          { retakeDeadline: s.retakeDeadline?.toISOString() ?? null },
          { retakeDeadline: retakeDeadline?.toISOString() ?? null, which: 'retake', reason, series: boardSeriesName(names, s) }, ctx, tx);
      }
      const otherChanges = Object.keys(dates).length > 0;
      if (otherChanges) {
        await logAction(actorId, 'BOARD_SERIES_UPDATED', 'board_series', id,
          Object.fromEntries(Object.keys(dates).map((k) => [k, s[k as keyof typeof s] ?? null])), dates as Record<string, unknown>, ctx, tx);
      }
      return { ...updated!, name: boardSeriesName(names, updated!), datesChanged: deadlineChanges || retakeChanges || dates.examsStart !== undefined };
    });
    // The waiting lines' due dates follow the series' dates (capped by the effective deadline),
    // once the change has committed (deadline.services.ts redateSeriesLines: the lock order).
    const { datesChanged, ...result } = changed;
    if (datesChanged) await redateSeriesLines(id, actorId, 'the series\' dates changed');
    return result;
  } catch (err) {
    if (isUniqueViolation(err)) throw new SeriesError('Another series of this board, month and year already has that label', 409);
    const sentence = seriesRuleSentence(err);
    if (sentence) throw new SeriesError(sentence, 409);
    throw err;
  }
}

/** Remove a series nothing uses (a mistake). One attached to a session or carried from is kept. */
export async function deleteBoardSeries(id: string, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(boardSeries).where(eq(boardSeries.id, id)).for('update');
    if (!s) throw new SeriesError('Board series not found', 404);
    const [linked] = await tx.select({ id: sessionBoardSeries.id }).from(sessionBoardSeries).where(eq(sessionBoardSeries.boardSeriesId, id)).limit(1);
    if (linked) throw new SeriesError('A session\'s items are entered in this series — move them first', 409);
    const [carried] = await tx.select({ id: registration.id }).from(registration).where(eq(registration.priorSittingSeriesId, id)).limit(1);
    if (carried) throw new SeriesError('A line carries a sitting from this series: it stays on record', 409);
    await tx.delete(boardSeries).where(eq(boardSeries.id, id));
    await logAction(actorId, 'BOARD_SERIES_DELETED', 'board_series', id, s as Record<string, unknown>, null, ctx, tx);
    return s;
  });
}

// ─── A session's series (derived) ────────────────────────────────────────────

/**
 * What a session's series are (read only, derived from its items): each series with its
 * dates, the items entered in it and the lines it holds.
 */
export async function getWindowSeries(sessionId: string) {
  const [w] = await db.select().from(registrationSession).where(eq(registrationSession.id, sessionId));
  if (!w) throw new SeriesError('Session not found', 404);
  const { names } = await boardNameMap();
  const ay = seriesAcademicYearStart(w.sessionType, w.seriesYear);
  const [links, items, counts] = await Promise.all([
    db.select({ series: boardSeries }).from(sessionBoardSeries).innerJoin(boardSeries, eq(boardSeries.id, sessionBoardSeries.boardSeriesId))
      .where(eq(sessionBoardSeries.sessionId, sessionId)),
    db.select({ id: sessionOfferItem.id, label: sessionOfferItem.label, boardSeriesId: sessionOfferItem.boardSeriesId, subjectName: subject.name })
      .from(sessionOfferItem).innerJoin(sessionOffer, eq(sessionOffer.id, sessionOfferItem.offerId)).innerJoin(subject, eq(subject.id, sessionOffer.subjectId))
      .where(eq(sessionOfferItem.sessionId, sessionId)),
    db.select({ boardSeriesId: registration.boardSeriesId, status: registration.status, n: sql<number>`count(*)::int` })
      .from(registration).where(eq(registration.sessionId, sessionId)).groupBy(registration.boardSeriesId, registration.status),
  ]);
  const live = (c: (typeof counts)[number]) => !(DONE as readonly string[]).includes(c.status);
  const now = new Date();
  return {
    session: {
      id: w.id, name: w.name, status: w.status, sessionType: w.sessionType, seriesYear: w.seriesYear, label: w.label, endDate: w.endDate,
      academicYearStart: ay, academicYear: academicYearShortLabel(ay), months: sessionSeriesMonths(w.sessionType, w.seriesYear),
    },
    series: links
      .map(({ series: s }) => ({
        boardSeriesId: s.id, name: boardSeriesName(names, s), boardCode: s.boardCode, boardName: names.get(s.boardCode) ?? s.boardCode,
        month: s.month, year: s.year, label: s.label,
        entryDeadline: s.entryDeadline, entryDeadlinePassed: !!s.entryDeadline && s.entryDeadline <= now,
        retakeDeadline: s.retakeDeadline, examsStart: s.examsStart, lateFeeFrom: s.lateFeeFrom, highLateFeeFrom: s.highLateFeeFrom,
        items: items.filter((i) => i.boardSeriesId === s.id).map((i) => ({ id: i.id, label: i.label, subjectName: i.subjectName })),
        registrations: counts.filter((c) => c.boardSeriesId === s.id && live(c)).reduce((a, c) => a + c.n, 0),
        allRegistrations: counts.filter((c) => c.boardSeriesId === s.id).reduce((a, c) => a + c.n, 0),
      }))
      .sort((a, b) => a.boardCode.localeCompare(b.boardCode) || a.name.localeCompare(b.name)),
  };
}

/**
 * Refuse a change to a session's series (its type or year) that the series it is fed by would
 * not fit — their academic year and kind (June or not). Null: it fits.
 */
export async function windowChangeMisfit(
  executor: Executor,
  sessionId: string,
  proposed: { sessionType: string; seriesYear: number },
): Promise<string | null> {
  const rows = await executor
    .select({ series: boardSeries })
    .from(sessionBoardSeries).innerJoin(boardSeries, eq(boardSeries.id, sessionBoardSeries.boardSeriesId))
    .where(eq(sessionBoardSeries.sessionId, sessionId));
  if (!rows.length) return null;
  const { names } = await boardNameMap(executor);
  const wYear = seriesAcademicYearStart(proposed.sessionType, proposed.seriesYear);
  for (const { series: s } of rows) {
    const sYear = seriesAcademicYearStart(s.month, s.year);
    if (wYear !== sYear || (s.month === 'june') !== (proposed.sessionType === 'june')) {
      return `This session's items are entered in ${boardSeriesName(names, s)}, which would no longer fit ${seriesLabel(proposed.sessionType, proposed.seriesYear)} (every series is in the session's academic year and, like it, June or not) — move its items first`;
    }
  }
  return null;
}

/**
 * Move lines to another series of their board in the same session — an admin's tool behind the
 * item's series (§3.3): each line goes to the item of its offer that enters the same in the
 * target series. Refused once a line's deadline in the series it is in, or the one it would go
 * to, has passed (the entry is made, or can no longer be), or when an open checkout would then
 * pay for two deadlines. Each move is audited in the transaction.
 */
export async function moveRegistrations(sessionId: string, data: MoveRegistrationsToSeriesType, actorId: string, ctx?: AuditContext) {
  const { names } = await boardNameMap();
  try {
    const out = await db.transaction(async (tx) => {
      const regs0 = await tx.select({ studentId: registration.studentId }).from(registration).where(inArray(registration.id, data.registrationIds));
      const students = [...new Set(regs0.map((r) => r.studentId))].sort();
      if (students.length) await tx.execute(sql`select id from "user" where id in (${sql.join(students.map((s) => sql`${s}`), sql`, `)}) order by id for no key update`);
      const [link] = await tx
        .select({ series: boardSeries })
        .from(sessionBoardSeries).innerJoin(boardSeries, eq(boardSeries.id, sessionBoardSeries.boardSeriesId))
        .where(and(eq(sessionBoardSeries.sessionId, sessionId), eq(sessionBoardSeries.boardSeriesId, data.boardSeriesId)))
        .for('share', { of: boardSeries });
      if (!link) throw new SeriesError('This session has no item in that series', 404);
      const target = link.series;
      const now = new Date();
      // Before the lines (§6; Confirm's order): the items they would go to in the target, FOR SHARE
      // (a change of such an item's series waits for this move), then the fee rows those read
      // there, FOR SHARE, carried provisional where finance has none (the review of 40c1447). A
      // line's item is read before its lock: its student is held, and only a move changes it.
      const pre = await tx.select({ offerItemId: registration.offerItemId, boardSeriesId: registration.boardSeriesId })
        .from(registration).where(inArray(registration.id, data.registrationIds));
      const toward = pre.filter((r) => r.boardSeriesId !== target.id);
      const siblings = await siblingItems(tx, [...new Set(toward.map((r) => r.offerItemId))], target.id);
      await lockMoveFeeRows(tx, toward.flatMap((r) => {
        const to = siblings.get(r.offerItemId);
        return to ? [{ itemId: to, fromSeriesId: r.boardSeriesId, toSeriesId: target.id }] : [];
      }), actorId, 'A line moved to another series');
      const regs = await tx
        .select({ id: registration.id, sessionId: registration.sessionId, status: registration.status, boardSeriesId: registration.boardSeriesId,
          offerItemId: registration.offerItemId, attempt: registration.attempt, priorSittingSeriesId: registration.priorSittingSeriesId,
          declarationRejected: registration.declarationRejected,
          council: subject.council, subjectName: subject.name })
        .from(registration).innerJoin(subject, eq(subject.id, registration.subjectId))
        .where(inArray(registration.id, data.registrationIds))
        .orderBy(registration.id)
        .for('update', { of: registration });
      if (regs.length !== data.registrationIds.length || regs.some((r) => r.sessionId !== sessionId)) {
        throw new SeriesError('One or more registrations are not in this session', 404);
      }
      // A series past a line's own deadline takes no more of it (MO-10 per line): past the entry
      // deadline, a retake of the board's previous sitting still goes in until the retake deadline.
      for (const r of regs) {
        const d = await tx.execute(sql`select line_effective_deadline(${r.attempt}, ${r.priorSittingSeriesId}, ${target.id}, ${r.declarationRejected}) as at,
          line_effective_deadline_kind(${r.attempt}, ${r.priorSittingSeriesId}, ${target.id}, ${r.declarationRejected}) as kind`);
        const row = d.rows[0] as { at: string | Date | null; kind: 'entry' | 'retake' | 'exams_start' | null };
        if (row.at && new Date(row.at) <= now && r.boardSeriesId !== target.id) throw new SeriesError(entryDeadlineMessage(new Date(row.at), row.kind));
      }
      const done = regs.find((r) => (DONE as readonly string[]).includes(r.status));
      if (done) throw new SeriesError(`${done.subjectName} is ${done.status}: its registration is history and stays where it was`, 409);
      const otherBoard = regs.find((r) => r.council !== target.boardCode);
      if (otherBoard) {
        throw new SeriesError(`${otherBoard.subjectName} is entered with ${names.get(otherBoard.council) ?? otherBoard.council}; ${boardSeriesName(names, target)} is another board's series`);
      }
      const current = await effectiveDeadlinesOf(tx, regs.map((r) => r.id));
      const passed = regs.find((r) => { const d = current.get(r.id); return !!d?.at && d.at <= now; });
      if (passed) {
        throw new SeriesError(`${passed.subjectName}'s deadline in its series has passed (${schoolDate(current.get(passed.id)!.at!)}): its entry stands`, 409);
      }
      const moving = regs.filter((r) => r.boardSeriesId !== target.id);
      // F4's entries of the lines that move (after the lines, §2.1): a sent one refuses the move, the
      // drafts are withdrawn with it and made again in the target series (the review of 426d565, item 2).
      const sent = await entriesFollowMoveInTx(tx, moving.map((r) => r.id), 'the line moved to another series', actorId, ctx);
      if (sent) throw new SeriesError(sent, 409);
      for (const r of moving) {
        // The same entry, in the target series: a sibling item of the line's offer (held above).
        const toItem = siblings.get(r.offerItemId);
        if (!toItem) {
          throw new SeriesError(`${r.subjectName} has no item entering the same in ${boardSeriesName(names, target)} — add one to the subject (or move the item's series) first`, 409);
        }
        await tx.update(registration).set({ offerItemId: toItem, boardSeriesId: target.id, updatedAt: now }).where(eq(registration.id, r.id));
      }
      // Each student's lines checked again where they now are (§6), then priced from the new grid.
      let repriced: Awaited<ReturnType<typeof repriceMovedLines>> = [];
      try {
        await recheckLines(tx, moving.map((r) => r.id));
        repriced = await repriceMovedLines(tx, moving.map((r) => r.id), actorId, 'moved to another series');
      } catch (err) {
        if (err instanceof LineRuleError || err instanceof PricingError) throw new SeriesError(err.message, 409);
        throw err;
      }
      // A registration paid for with another in an open checkout may not move to a series with
      // another deadline: the checkout would span two.
      const spanning = await openCheckoutsSpanningDeadlines(tx, { registrationIds: moving.map((r) => r.id) });
      if (spanning > 0) {
        throw new SeriesError(
          `${checkouts(spanning)} for these registrations together with others whose entry deadline would then differ — ${settleFirst(spanning)}, or move them together`,
          409,
        );
      }
      await logActions(moving.map((r) => ({
        userId: actorId, action: 'REGISTRATION_SERIES_MOVED' as const, entityType: 'registration' as const, entityId: r.id,
        previousData: { boardSeriesId: r.boardSeriesId, offerItemId: r.offerItemId }, newData: { boardSeriesId: target.id, reason: data.reason },
      })), tx);
      await redateLines(tx, moving.map((r) => r.id), actorId, 'moved to another series');

      return { result: { moved: moving.length, repriced: repriced.length, alreadyThere: regs.length - moving.length, boardSeriesId: target.id, series: boardSeriesName(names, target) }, repriced };
    });
    await tellPriceChanged(out.repriced, 'The subject is now entered in another exam series, with its own board fee');
    return out.result;
  } catch (err) {
    const sentence = seriesRuleSentence(err);
    if (sentence) throw new SeriesError(sentence, 409);
    throw err;
  }
}

/**
 * For each item, the item of its offer entering the same in the target series (an open one
 * first): the candidates are locked FOR SHARE first, so the one chosen stays in the target until
 * the move commits (an item's series change takes its item FOR UPDATE).
 */
async function siblingItems(tx: Tx, itemIds: string[], targetId: string) {
  const out = new Map<string, string>();
  if (!itemIds.length) return out;
  const ids = sql.join(itemIds.map((id) => sql`${id}`), sql`, `);
  const held = await tx.execute(sql`
    select i2.id from session_offer_item i2
    where i2.board_series_id = ${targetId} and i2.offer_id in (select i1.offer_id from session_offer_item i1 where i1.id in (${ids}))
    order by i2.id for share`);
  const heldIds = (held.rows as { id: string }[]).map((x) => x.id);
  if (!heldIds.length) return out;
  const r = await tx.execute(sql`
    select distinct on (i1.id) i1.id as "from", i2.id as "to" from session_offer_item i1
    join session_offer_item i2 on i2.offer_id = i1.offer_id and i2.board_series_id = ${targetId} and i2.enters_kind = i1.enters_kind
      and i2.qualification_id is not distinct from i1.qualification_id and i2.qualification_option_id is not distinct from i1.qualification_option_id
      and coalesce((select array_agg(u.unit_id order by u.unit_id) from session_offer_item_unit u where u.item_id = i2.id), '{}')
        = coalesce((select array_agg(u.unit_id order by u.unit_id) from session_offer_item_unit u where u.item_id = i1.id), '{}')
    where i1.id in (${ids}) and i2.id in (${sql.join(heldIds.map((id) => sql`${id}`), sql`, `)})
    order by i1.id, (i2.availability = 'closed'), i2.id`);
  for (const x of r.rows as { from: string; to: string }[]) out.set(x.from, x.to);
  return out;
}

// ─── What the migration inferred, for staff to check ─────────────────────────

/**
 * What migration 0038 inferred, for staff to check on the Board series screen:
 * - subjects entered with the board that sits a window's month (their board
 *   did not: the school's January and October rows), registered or only
 *   offered there, and subjects kept on their board but not offered in a
 *   window of a month it does not sit;
 * - the registrations of a re-boarded subject, entered in its new board's
 *   series.
 * A subject stays listed until staff mark it checked, map it on the
 * Catalogue, or change its board (either screen: SUBJECT_BOARD_CHANGED); a
 * registration until it is marked checked or moved.
 */
export async function listInferredRoutings() {
  const { names } = await boardNameMap();
  const subjects = await db.execute(sql`
    select a.entity_id as "subjectId", a.action, a.previous_data->>'council' as "previousBoard", a.new_data->'windows' as windows,
      a.created_at as "inferredAt", s.name as "subjectName", s.code as "subjectCode", s.council as "board",
      -- What the migration saw: registered in such a window (at any status), or only offered there.
      coalesce((a.new_data->>'registered')::boolean, false) as registered
    from audit_log a
    join subject s on s.id = a.entity_id
    where a.action in ('SUBJECT_BOARD_INFERRED', 'SUBJECT_NOT_OFFERED_INFERRED')
      and not exists (
        select 1 from audit_log c
        where c.entity_id = a.entity_id and c.created_at >= a.created_at and c.id <> a.id
          and c.action in ('SUBJECT_BOARD_INFERENCE_CHECKED', 'SUBJECT_CATALOGUE_MAPPED', 'SUBJECT_BOARD_CHANGED'))
    order by s.name`).then((r) => r.rows as {
      subjectId: string; action: string; previousBoard: string | null; windows: string[] | null; inferredAt: string;
      subjectName: string; subjectCode: string; board: string; registered: boolean;
    }[]);
  const rows = await db.execute(sql`
    select a.entity_id as "registrationId", a.previous_data->>'council' as "previousBoard", a.created_at as "inferredAt",
      r.status, r.session_id as "sessionId", w.name as "window", r.board_series_id as "boardSeriesId",
      s.id as "subjectId", s.name as "subjectName", s.code as "subjectCode", s.council as "board",
      u.id as "studentId", u.name as "studentName"
    from audit_log a
    join registration r on r.id = a.entity_id
    join subject s on s.id = r.subject_id
    join registration_session w on w.id = r.session_id
    join "user" u on u.id = r.student_id
    where a.action = 'REGISTRATION_SERIES_INFERRED'
      and not exists (
        select 1 from audit_log c
        where c.entity_id = a.entity_id and c.created_at >= a.created_at and c.id <> a.id
          and c.action in ('REGISTRATION_SERIES_INFERENCE_CHECKED', 'REGISTRATION_SERIES_MOVED'))
    order by s.name, w.name, u.name`).then((r) => r.rows as {
      registrationId: string; previousBoard: string | null; inferredAt: string; status: string; sessionId: string; window: string;
      boardSeriesId: string | null; subjectId: string; subjectName: string; subjectCode: string; board: string; studentId: string; studentName: string;
    }[]);
  const seriesIds = [...new Set(rows.map((r) => r.boardSeriesId).filter((x): x is string => !!x))];
  const series = seriesIds.length ? await db.select().from(boardSeries).where(inArray(boardSeries.id, seriesIds)) : [];
  const byId = new Map(series.map((x) => [x.id, x]));
  const boardOf = (code: string | null) => (code ? names.get(code) ?? code : null);
  return {
    subjects: subjects.map((x) => ({
      ...x,
      kind: x.action === 'SUBJECT_BOARD_INFERRED' ? ('reboarded' as const) : ('not_offered' as const),
      previousBoardName: boardOf(x.previousBoard),
      boardName: boardOf(x.board)!,
      windows: x.windows ?? [],
    })),
    registrations: rows.map((r) => ({
      ...r,
      previousBoardName: boardOf(r.previousBoard),
      boardName: boardOf(r.board)!,
      series: r.boardSeriesId && byId.get(r.boardSeriesId) ? boardSeriesName(names, byId.get(r.boardSeriesId)!) : null,
    })),
  };
}

/** Staff checked these: one audit row each, in one transaction; they leave the list. */
export async function markInferredChecked(data: { registrationIds: string[]; subjectIds: string[] }, actorId: string, ctx?: AuditContext) {
  const listed = await listInferredRoutings();
  const regs = new Set(listed.registrations.map((r) => r.registrationId));
  const subs = new Set(listed.subjects.map((x) => x.subjectId));
  if (data.registrationIds.some((id) => !regs.has(id)) || data.subjectIds.some((id) => !subs.has(id))) {
    throw new SeriesError('One or more of these are not waiting to be checked', 404);
  }
  await db.transaction(async (tx) => {
    for (const id of data.registrationIds) {
      await logAction(actorId, 'REGISTRATION_SERIES_INFERENCE_CHECKED', 'registration', id, null, { checked: true }, ctx, tx);
    }
    for (const id of data.subjectIds) {
      await logAction(actorId, 'SUBJECT_BOARD_INFERENCE_CHECKED', 'subject', id, null, { checked: true }, ctx, tx);
    }
  });
  return { checked: data.registrationIds.length + data.subjectIds.length };
}

// ─── One checkout per deadline ───────────────────────────────────────────────

export type DeadlineGroup = {
  entryDeadline: Date | null;
  /** Which date it is for these lines: the entry deadline, a retake deadline, or the exams' start. */
  deadlineKind: 'entry' | 'retake' | 'exams_start' | null;
  series: { id: string; name: string }[];
  registrationIds: string[];
  subjects: string[];
};

/**
 * The lines a payment would cover, grouped by their effective deadline (F0b, MO-10 per series;
 * per line since the rework, §3.3): money is taken per group — the sweep closes a checkout at its
 * lines' deadline, so a checkout never spans two. Lines with the same deadline share a group.
 * Earliest first; no deadline last. `lock` reads the series FOR SHARE (inside the transaction
 * that takes the money), so a deadline changing at the same moment waits for it.
 */
export async function seriesDeadlineGroups(executor: Executor, registrationIds: string[], lock = false): Promise<DeadlineGroup[]> {
  if (!registrationIds.length) return [];
  const regs = await executor
    .select({ id: registration.id, boardSeriesId: registration.boardSeriesId, subjectName: subject.name })
    .from(registration).innerJoin(subject, eq(subject.id, registration.subjectId))
    .where(inArray(registration.id, registrationIds))
    .orderBy(registration.id);
  const ids = [...new Set(regs.map((r) => r.boardSeriesId).filter((x): x is string => !!x))];
  const q = executor.select().from(boardSeries).where(inArray(boardSeries.id, ids.length ? ids : ['__none__'])).orderBy(boardSeries.id);
  const rows = ids.length ? (lock ? await q.for('share') : await q) : [];
  const deadlines = await effectiveDeadlinesOf(executor, regs.map((r) => r.id));
  const { names } = await boardNameMap(executor);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const groups = new Map<string, DeadlineGroup>();
  for (const r of regs) {
    const sr = r.boardSeriesId ? byId.get(r.boardSeriesId) : undefined;
    const d = deadlines.get(r.id) ?? { at: null, kind: null };
    const key = d.at ? String(d.at.getTime()) : 'none';
    const g = groups.get(key) ?? { entryDeadline: d.at, deadlineKind: d.kind, series: [], registrationIds: [], subjects: [] };
    if (sr && !g.series.some((x) => x.id === sr.id)) g.series.push({ id: sr.id, name: boardSeriesName(names, sr) });
    g.registrationIds.push(r.id);
    g.subjects.push(r.subjectName);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) =>
    (a.entryDeadline?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.entryDeadline?.getTime() ?? Number.MAX_SAFE_INTEGER));
}

/** The family's refusal for a checkout spanning deadlines: each group named, to pay separately. */
export function mixedDeadlinesSentence(groups: DeadlineGroup[]) {
  const parts = groups.map((g) => {
    const series = g.series.length ? g.series.map((x) => x.name).join(' and ') : 'No board series';
    const which = g.deadlineKind === 'retake' ? 'retake deadline' : g.deadlineKind === 'exams_start' ? 'exams start' : 'entry deadline';
    const when = g.entryDeadline ? `${which} ${schoolDate(g.entryDeadline)}` : 'no entry deadline yet';
    return `${series} (${when}): ${g.subjects.join(', ')}`;
  });
  return `These subjects are entered in exam board series with different entry deadlines, so each series is paid for on its own: ${parts.join('; ')}`;
}

// ─── The sweep's series ──────────────────────────────────────────────────────

/**
 * The series some deadline of which has passed — its entry deadline, its retake deadline, or
 * (with no entry deadline) its exams' start: what the sweep looks at. Which lines it closes is
 * decided per line by their effective deadline (payment.services.ts enforcePaymentDeadlines).
 */
export async function seriesPastDeadline(now: Date) {
  return db.select({ id: boardSeries.id, entryDeadline: boardSeries.entryDeadline, retakeDeadline: boardSeries.retakeDeadline, examsStart: boardSeries.examsStart,
    boardCode: boardSeries.boardCode, month: boardSeries.month, year: boardSeries.year, label: boardSeries.label })
    .from(boardSeries)
    .where(sql`(${boardSeries.entryDeadline} is not null and ${boardSeries.entryDeadline} <= ${now})
      or (${boardSeries.retakeDeadline} is not null and ${boardSeries.retakeDeadline} <= ${now})
      or (${boardSeries.entryDeadline} is null and ${boardSeries.examsStart} is not null and (${boardSeries.examsStart}::timestamp at time zone 'Africa/Cairo') <= ${now})`)
    .orderBy(boardSeries.entryDeadline);
}

/** The sessions a series is attached to, by status. */
export async function windowsOfSeries(boardSeriesId: string) {
  return db.select({ id: registrationSession.id, status: registrationSession.status, name: registrationSession.name })
    .from(sessionBoardSeries).innerJoin(registrationSession, eq(registrationSession.id, sessionBoardSeries.sessionId))
    .where(eq(sessionBoardSeries.boardSeriesId, boardSeriesId));
}

export async function seriesDisplayName(boardSeriesId: string): Promise<string | null> {
  const [s] = await db.select().from(boardSeries).where(eq(boardSeries.id, boardSeriesId));
  if (!s) return null;
  const { names } = await boardNameMap();
  return boardSeriesName(names, s);
}

/** Live lines of a session no series holds (a converted session's lines from a window that fed none). */
export async function unroutedCount(sessionId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(registration)
    .where(and(eq(registration.sessionId, sessionId), isNull(registration.boardSeriesId), notInArray(registration.status, [...DONE])));
  return r?.n ?? 0;
}
