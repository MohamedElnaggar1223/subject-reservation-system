/**
 * Board series and the windows that feed them (FEATURES_PLAN.md F0b;
 * DISCOVERY_RESEARCH.md §5 note 1; IMPORT_SPIKE.md IS-05, IS-14).
 *
 * A board series is one board's sitting — Pearson IAL October 2026,
 * Cambridge November 2026 — with every date the board sets. A registration
 * window feeds one or more of them: per board one is the window's default,
 * and a subject can be routed to another series of its board ("Biology sits
 * in January"). Every registration is entered in exactly one series
 * (`registration.board_series_id`), chosen when it is made.
 *
 * The exam board's entry deadline is a date of the series (owner decision
 * MO-10, A-08): past it, nothing more is entered, paid, referenced or
 * confirmed for that series, and the scheduler's sweep closes what is still
 * open on it — per series, so a window feeding two series with different
 * deadlines enforces each at its own time. The late-fee dates are shown for
 * information only: the school's hard stop stays.
 *
 * Every series a window feeds is in the window's academic year and, like the
 * window, a June series or not. So the window's own series (F0a's
 * sessionType and seriesYear) gives the same answer to mayRegisterFor as any
 * series it feeds: the grade is read in one academic year, the grade-10
 * June-only rule and the graduates' retake series (A-12) read one kind of
 * series. The routes refuse a series that breaks this with a sentence; the
 * database refuses whatever gets past them (migration 0038's triggers).
 */

import {
  db, boardSeries, sessionBoardSeries, sessionSubjectSeries, registrationSession, registration, subject, examBoard,
  eq, and, inArray, notInArray, isNull, sql, asc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  seriesAcademicYearStart, academicYearShortLabel, seriesLabel, A_LEVEL_ONLY_SESSION_TYPES, ROLES,
  BOARD_SERIES_DATE_FIELDS,
  type CreateBoardSeriesType, type UpdateBoardSeriesType, type SetSessionBoardSeriesType,
  type MoveRegistrationsToSeriesType, type ListBoardSeriesQueryType, type SessionType,
} from '@repo/validations';
import { logAction, logActions, type AuditContext } from './audit.services';
import { schoolDate, entryDeadlineMessage } from './window.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/** A refusal with the status the route answers. */
export class SeriesError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

const DONE = ['rejected', 'expired', 'dropped'] as const;

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
 * The rule the database refused, as the sentence a route answers — for a
 * change that got past the service's own checks (a race, or a path that
 * does not check). Null when the error is something else.
 */
export function seriesRuleSentence(err: unknown): string | null {
  const cause = (err as { cause?: { constraint?: string } } | null)?.cause ?? (err as { constraint?: string } | null);
  switch (cause?.constraint) {
    case 'window_closes_before_series_deadline':
      return 'A window must close before the exam board\'s entry deadline of every series it feeds — the window or the deadline changed at the same moment; reload and try again';
    case 'window_series_same_academic_year':
      return 'Every series a window feeds is in the window\'s academic year';
    case 'window_series_same_kind':
      return 'A June window feeds June series only, and a window for another series feeds no June series';
    case 'registration_board_series_routed':
      return 'This window feeds no board series for the subject\'s board — ask the admin to add one to the window';
    case 'registration_board_series_board':
      return 'A registration is entered in a series of its subject\'s board';
    case 'board_series_board_fixed':
      return 'A series fed by a window keeps its board';
    case 'registration_board_series_link_fk':
      return 'The window\'s board series changed while this was being saved — reload and try again';
    default:
      return null;
  }
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/**
 * The series of an academic year (or all), each with every date, the windows
 * feeding it, and the registrations entered in it by status — what each
 * deadline will close. Ordered by entry deadline, then month.
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

function assertDeadlineChangeAllowed(actorRole: string | null | undefined) {
  if (actorRole !== ROLES.ADMIN) {
    throw new SeriesError("Only an admin sets the exam board's entry deadline: past it the school closes every unconfirmed payment on the series (MO-10)", 403);
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
  try {
    return await db.transaction(async (tx) => {
      const { entryDeadline, ...rest } = data;
      const [created] = await tx.insert(boardSeries).values({
        id: randomUUID(), ...rest, entryDeadline: entryDeadline ?? null, notes: data.notes ?? null,
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
 * Change a series' dates. The entry deadline is the admin's (MO-10): after
 * every window feeding the series closes, in the future, with a reason,
 * audited in the transaction. Locks the windows feeding it, then the series
 * — the order a window's own change takes — so a window moved at the same
 * moment is either seen or refused.
 */
/**
 * One entry deadline per open checkout (F0b, MO-10 per series): the deadline
 * sweep closes a payment at its series' deadline, so a checkout paying for
 * series with different deadlines would lose the later series' subjects at
 * the earlier one. Asked after a change, inside its transaction: how many
 * checkouts still open, among those holding a registration in `scope`, now
 * pay for registrations whose series have different deadlines (no series and
 * no deadline count as one "none"). Every path that changes a registration's
 * series or a series' deadline asks it: a deadline change, the admin's move,
 * a window's first series entering its registrations.
 */
async function openCheckoutsSpanningDeadlines(tx: Tx, scope: { boardSeriesId: string } | { registrationIds: string[] }): Promise<number> {
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
      left join board_series b on b.id = r.board_series_id
      where p.status in ('pending', 'pending_verification')
        and p.id in (select pr0.payment_id from payment_registration pr0 join registration r0 on r0.id = pr0.registration_id where ${inScope})
      group by p.id
      having count(distinct coalesce(b.entry_deadline::text, 'none')) > 1) spanning`);
  return Number((r.rows[0] as { n: number } | undefined)?.n ?? 0);
}

const checkouts = (n: number) => `${n} checkout${n === 1 ? '' : 's'} still open pay${n === 1 ? 's' : ''}`;
const settleFirst = (n: number) => `confirm or cancel ${n === 1 ? 'it' : 'them'} first`;

export async function updateBoardSeries(
  id: string, data: UpdateBoardSeriesType, actorId: string, actorRole: string | null | undefined, ctx?: AuditContext,
) {
  const { names } = await boardNameMap();
  try {
    return await db.transaction(async (tx) => {
      const windows = await tx
        .select({ id: registrationSession.id, name: registrationSession.name, endDate: registrationSession.endDate })
        .from(sessionBoardSeries)
        .innerJoin(registrationSession, eq(registrationSession.id, sessionBoardSeries.sessionId))
        .where(eq(sessionBoardSeries.boardSeriesId, id))
        .orderBy(registrationSession.id)
        .for('share', { of: registrationSession });
      const [s] = await tx.select().from(boardSeries).where(eq(boardSeries.id, id)).for('update');
      if (!s) throw new SeriesError('Board series not found', 404);

      const { reason, entryDeadline, ...dates } = data;
      const deadlineChanges = entryDeadline !== undefined && (entryDeadline?.getTime() ?? null) !== (s.entryDeadline?.getTime() ?? null);
      if (deadlineChanges) {
        assertDeadlineChangeAllowed(actorRole);
        if (!reason || reason.trim().length < 5) throw new SeriesError('Please provide a reason (min 5 characters)');
        if (entryDeadline) {
          const late = windows.find((w) => w.endDate >= entryDeadline);
          if (late) throw new SeriesError("The board's entry deadline must be after the registration window closes");
          if (entryDeadline <= new Date()) throw new SeriesError("The board's entry deadline must be in the future");
        }
      }
      for (const f of BOARD_SERIES_DATE_FIELDS) if (dates[f] === undefined) delete dates[f];
      const next = { ...dates, ...(deadlineChanges ? { entryDeadline: entryDeadline ?? null } : {}) };
      const [updated] = await tx.update(boardSeries).set({ ...next, updatedAt: new Date() }).where(eq(boardSeries.id, id)).returning();
      if (deadlineChanges) {
        // A checkout still open that pays for this series together with
        // another would span two deadlines after the change: refused until it
        // is settled (series with the same deadline may share a checkout).
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
      const otherChanges = Object.keys(dates).length > 0;
      if (otherChanges) {
        await logAction(actorId, 'BOARD_SERIES_UPDATED', 'board_series', id,
          Object.fromEntries(Object.keys(dates).map((k) => [k, s[k as keyof typeof s] ?? null])), dates as Record<string, unknown>, ctx, tx);
      }
      return { ...updated!, name: boardSeriesName(names, updated!) };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new SeriesError('Another series of this board, month and year already has that label', 409);
    const sentence = seriesRuleSentence(err);
    if (sentence) throw new SeriesError(sentence, 409);
    throw err;
  }
}

/** Remove a series no window feeds (a mistake). One with windows is kept: its registrations are history. */
export async function deleteBoardSeries(id: string, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(boardSeries).where(eq(boardSeries.id, id)).for('update');
    if (!s) throw new SeriesError('Board series not found', 404);
    const [linked] = await tx.select({ id: sessionBoardSeries.id }).from(sessionBoardSeries).where(eq(sessionBoardSeries.boardSeriesId, id)).limit(1);
    if (linked) throw new SeriesError('A window feeds this series — take it off the window first', 409);
    await tx.delete(boardSeries).where(eq(boardSeries.id, id));
    await logAction(actorId, 'BOARD_SERIES_DELETED', 'board_series', id, s as Record<string, unknown>, null, ctx, tx);
    return s;
  });
}

// ─── A window's series ───────────────────────────────────────────────────────

/**
 * What the window's series panel shows: the series it feeds (default per
 * board, deadline, how many of the window's registrations each holds), the
 * window's subjects grouped by board with the series each is entered in, and
 * the series of its academic year it could add.
 */
export async function getWindowSeries(sessionId: string) {
  const [w] = await db.select().from(registrationSession).where(eq(registrationSession.id, sessionId));
  if (!w) throw new SeriesError('Session not found', 404);
  const { names } = await boardNameMap();
  const ay = seriesAcademicYearStart(w.sessionType, w.seriesYear);
  const [links, routes, subjects, counts, candidates] = await Promise.all([
    db.select({ link: sessionBoardSeries, series: boardSeries })
      .from(sessionBoardSeries).innerJoin(boardSeries, eq(boardSeries.id, sessionBoardSeries.boardSeriesId))
      .where(eq(sessionBoardSeries.sessionId, sessionId)),
    db.select().from(sessionSubjectSeries).where(eq(sessionSubjectSeries.sessionId, sessionId)),
    db.execute(sql`
      select s.id, s.name, s.code, s.council, s.is_active as "isActive"
      from subject s
      where (s.is_active and s.qualification_level = ${w.qualificationLevel})
         or exists (select 1 from registration r where r.session_id = ${sessionId} and r.subject_id = s.id)
      order by s.name`).then((r) => r.rows as { id: string; name: string; code: string; council: string; isActive: boolean }[]),
    db.select({ boardSeriesId: registration.boardSeriesId, subjectId: registration.subjectId, status: registration.status, n: sql<number>`count(*)::int` })
      .from(registration).where(eq(registration.sessionId, sessionId))
      .groupBy(registration.boardSeriesId, registration.subjectId, registration.status),
    listBoardSeries({ academicYear: ay }),
  ]);
  const live = (c: (typeof counts)[number]) => !(DONE as readonly string[]).includes(c.status);
  const now = new Date();
  return {
    session: {
      id: w.id, name: w.name, status: w.status, sessionType: w.sessionType, seriesYear: w.seriesYear,
      qualificationLevel: w.qualificationLevel, endDate: w.endDate,
      series: seriesLabel(w.sessionType, w.seriesYear), academicYearStart: ay, academicYear: academicYearShortLabel(ay),
    },
    series: links
      .map(({ link, series: s }) => ({
        boardSeriesId: s.id, name: boardSeriesName(names, s), boardCode: s.boardCode, boardName: names.get(s.boardCode) ?? s.boardCode,
        month: s.month, year: s.year, label: s.label, isDefault: link.isDefault,
        entryDeadline: s.entryDeadline, entryDeadlinePassed: !!s.entryDeadline && s.entryDeadline <= now,
        lateFeeFrom: s.lateFeeFrom, highLateFeeFrom: s.highLateFeeFrom,
        registrations: counts.filter((c) => c.boardSeriesId === s.id && live(c)).reduce((a, c) => a + c.n, 0),
        allRegistrations: counts.filter((c) => c.boardSeriesId === s.id).reduce((a, c) => a + c.n, 0),
      }))
      .sort((a, b) => a.boardCode.localeCompare(b.boardCode) || Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
    subjects: subjects.map((s) => {
      const route = routes.find((r) => r.subjectId === s.id);
      const def = links.find(({ link }) => link.boardCode === s.council && link.isDefault);
      return {
        ...s,
        boardName: names.get(s.council) ?? s.council,
        routedTo: route?.boardSeriesId ?? null,
        entersIn: route?.boardSeriesId ?? def?.series.id ?? null,
        registrations: counts.filter((c) => c.subjectId === s.id && live(c)).reduce((a, c) => a + c.n, 0),
      };
    }),
    unrouted: counts.filter((c) => c.boardSeriesId === null && live(c)).reduce((a, c) => a + c.n, 0),
    // Series of the window's academic year and kind the panel can add.
    candidates: candidates
      .filter((c) => (c.month === 'june') === (w.sessionType === 'june'))
      .filter((c) => !(w.qualificationLevel === 'igcse' && A_LEVEL_ONLY_SESSION_TYPES.includes(c.month as SessionType)))
      .map((c) => ({ id: c.id, name: c.name, boardCode: c.boardCode, boardName: c.boardName, month: c.month, year: c.year, entryDeadline: c.entryDeadline, entryDeadlinePassed: c.entryDeadlinePassed })),
  };
}

type SeriesRow = typeof boardSeries.$inferSelect;

/** Why a series cannot feed this window, or null. */
function seriesMisfit(
  w: { sessionType: string; seriesYear: number; qualificationLevel: string; endDate: Date },
  s: SeriesRow,
  names: Map<string, string>,
): string | null {
  const name = boardSeriesName(names, s);
  if (w.qualificationLevel === 'igcse' && A_LEVEL_ONLY_SESSION_TYPES.includes(s.month as SessionType)) {
    return `January and October series are A-Level only — an IGCSE window cannot feed ${name}`;
  }
  const wYear = seriesAcademicYearStart(w.sessionType, w.seriesYear);
  const sYear = seriesAcademicYearStart(s.month, s.year);
  if (wYear !== sYear) {
    return `${name} is in ${academicYearShortLabel(sYear)}; this window is for ${seriesLabel(w.sessionType, w.seriesYear)}, in ${academicYearShortLabel(wYear)}. Every series a window feeds is in the window's academic year`;
  }
  if ((s.month === 'june') !== (w.sessionType === 'june')) {
    return w.sessionType === 'june'
      ? `A June window feeds June series only (grade 10 sits June only): ${name} is not a June series`
      : `This window is for ${seriesLabel(w.sessionType, w.seriesYear)}: it feeds October, November or January series, not ${name}`;
  }
  if (s.entryDeadline && w.endDate >= s.entryDeadline) {
    return `${name}'s entry deadline (${schoolDate(s.entryDeadline)}) is before this window closes (${schoolDate(w.endDate)}): the window must close first — move the window's end or the board deadline`;
  }
  return null;
}

/**
 * Refuse a change to a window (its series, level or end) that the series it
 * feeds would not fit, naming the first that would not. Null: it fits.
 */
export async function windowChangeMisfit(
  executor: Executor,
  sessionId: string,
  proposed: { sessionType: string; seriesYear: number; qualificationLevel: string; endDate: Date },
): Promise<string | null> {
  const rows = await executor
    .select({ series: boardSeries })
    .from(sessionBoardSeries).innerJoin(boardSeries, eq(boardSeries.id, sessionBoardSeries.boardSeriesId))
    .where(eq(sessionBoardSeries.sessionId, sessionId));
  if (!rows.length) return null;
  const { names } = await boardNameMap(executor);
  for (const { series } of rows) {
    const misfit = seriesMisfit(proposed, series, names);
    if (misfit) return `This window feeds ${boardSeriesName(names, series)}, which would no longer fit: ${misfit} — change the window's series on its board series panel first`;
  }
  return null;
}

/**
 * Link series to a window (at its creation, or from its panel), in the
 * caller's transaction, the window row already locked. Validates each fit
 * and one default per board.
 */
async function writeWindowSeries(
  tx: Tx,
  w: typeof registrationSession.$inferSelect,
  data: { series: { boardSeriesId: string; isDefault: boolean }[]; routes?: { subjectId: string; boardSeriesId: string }[] },
  actorId: string | null,
  names: Map<string, string>,
) {
  const ids = data.series.map((s) => s.boardSeriesId);
  // The subjects whose routes this writes or removes, read FOR SHARE before
  // the window's links are touched: a board change holds its subject FOR
  // UPDATE while it re-points that subject's routes, so the two run one after
  // the other (subject, then links — the order the board change takes).
  const existingRoutes = await tx.select({ subjectId: sessionSubjectSeries.subjectId }).from(sessionSubjectSeries).where(eq(sessionSubjectSeries.sessionId, w.id));
  const routedSubjects = [...new Set([...(data.routes ?? []).map((r) => r.subjectId), ...existingRoutes.map((r) => r.subjectId)])];
  if (routedSubjects.length) {
    await tx.select({ id: subject.id }).from(subject).where(inArray(subject.id, routedSubjects)).orderBy(subject.id).for('share');
  }
  const rows = ids.length
    ? await tx.select().from(boardSeries).where(inArray(boardSeries.id, ids)).orderBy(boardSeries.id).for('share')
    : [];
  if (rows.length !== ids.length) throw new SeriesError('One or more board series were not found', 404);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) {
    const misfit = seriesMisfit(w, r, names);
    if (misfit) throw new SeriesError(misfit);
  }
  // One default per board: the only series of a board is its default.
  const defaults = new Map<string, string>();
  for (const board of new Set(rows.map((r) => r.boardCode))) {
    const ofBoard = data.series.filter((s) => byId.get(s.boardSeriesId)!.boardCode === board);
    const marked = ofBoard.filter((s) => s.isDefault);
    if (ofBoard.length === 1) defaults.set(board, ofBoard[0]!.boardSeriesId);
    else if (marked.length === 1) defaults.set(board, marked[0]!.boardSeriesId);
    else throw new SeriesError(`Choose which ${names.get(board) ?? board} series is the default for this window`);
  }

  const current = await tx.select().from(sessionBoardSeries).where(eq(sessionBoardSeries.sessionId, w.id)).for('update');
  const removed = current.filter((c) => !ids.includes(c.boardSeriesId));
  if (removed.length) {
    const held = await tx
      .select({ boardSeriesId: registration.boardSeriesId, n: sql<number>`count(*)::int` })
      .from(registration)
      .where(and(eq(registration.sessionId, w.id), inArray(registration.boardSeriesId, removed.map((r) => r.boardSeriesId))))
      .groupBy(registration.boardSeriesId);
    if (held.length) {
      const s = await seriesOrThrow(held[0]!.boardSeriesId!, tx);
      throw new SeriesError(`${boardSeriesName(names, s)} has ${held[0]!.n} registration${held[0]!.n === 1 ? '' : 's'} in this window — move them to another series first; its entries stay on record`, 409);
    }
  }
  // Every board with live registrations keeps a series here.
  const liveBoards = await tx
    .select({ council: subject.council, n: sql<number>`count(*)::int` })
    .from(registration)
    .innerJoin(subject, eq(subject.id, registration.subjectId))
    .where(and(eq(registration.sessionId, w.id), notInArray(registration.status, [...DONE])))
    .groupBy(subject.council);
  if (ids.length) {
    const missing = liveBoards.find((b) => !defaults.has(b.council));
    if (missing) {
      throw new SeriesError(`This window has ${missing.n} registration${missing.n === 1 ? '' : 's'} entered with ${names.get(missing.council) ?? missing.council} — it must feed a ${names.get(missing.council) ?? missing.council} series too`);
    }
  }
  // Routes: to one of these series, of the subject's own board.
  const routes = data.routes ?? [];
  if (routes.length) {
    const subs = await tx.select({ id: subject.id, name: subject.name, council: subject.council }).from(subject).where(inArray(subject.id, routes.map((r) => r.subjectId)));
    for (const r of routes) {
      const s = subs.find((x) => x.id === r.subjectId);
      if (!s) throw new SeriesError('Subject not found', 404);
      const target = byId.get(r.boardSeriesId);
      if (!target) throw new SeriesError(`${s.name} can be routed only to a series this window feeds`);
      if (target.boardCode !== s.council) {
        throw new SeriesError(`${s.name} is entered with ${names.get(s.council) ?? s.council}; ${boardSeriesName(names, target)} is another board's series`);
      }
    }
  }

  // Apply: routes are rewritten, links removed, defaults cleared then set.
  await tx.delete(sessionSubjectSeries).where(eq(sessionSubjectSeries.sessionId, w.id));
  if (removed.length) await tx.delete(sessionBoardSeries).where(inArray(sessionBoardSeries.id, removed.map((r) => r.id)));
  await tx.update(sessionBoardSeries).set({ isDefault: false }).where(eq(sessionBoardSeries.sessionId, w.id));
  for (const r of rows) {
    const isDefault = defaults.get(r.boardCode) === r.id;
    const existing = current.find((c) => c.boardSeriesId === r.id);
    if (existing) await tx.update(sessionBoardSeries).set({ isDefault }).where(eq(sessionBoardSeries.id, existing.id));
    else {
      await tx.insert(sessionBoardSeries).values({
        id: randomUUID(), sessionId: w.id, boardSeriesId: r.id, boardCode: r.boardCode, isDefault, createdBy: actorId,
      });
    }
  }
  // A route to the board's default is no route at all.
  const kept = routes.filter((r) => defaults.get(byId.get(r.boardSeriesId)!.boardCode) !== r.boardSeriesId);
  if (kept.length) {
    await tx.insert(sessionSubjectSeries).values(kept.map((r) => ({ sessionId: w.id, subjectId: r.subjectId, boardSeriesId: r.boardSeriesId, createdBy: actorId })));
  }
  // Live registrations with no series yet (made while the window fed none) are entered now.
  const routed = ids.length
    ? await tx.execute(sql`
        update registration r set board_series_id = coalesce(
          (select ss.board_series_id from session_subject_series ss where ss.session_id = r.session_id and ss.subject_id = r.subject_id),
          (select l.board_series_id from session_board_series l join subject s on s.id = r.subject_id
            where l.session_id = r.session_id and l.board_code = s.council and l.is_default)
        ), updated_at = now()
        where r.session_id = ${w.id} and r.board_series_id is null and r.status not in ('rejected', 'expired', 'dropped')
        returning r.id`).then((r) => (r.rows as { id: string }[]).map((x) => x.id))
    : [];
  // Entering them must not leave an open checkout paying for two deadlines.
  const spanning = await openCheckoutsSpanningDeadlines(tx, { registrationIds: routed });
  if (spanning > 0) {
    throw new SeriesError(
      `${checkouts(spanning)} for this window's registrations, which these series would enter with different deadlines — ${settleFirst(spanning)}, or route the subjects to series with the same deadline`,
      409,
    );
  }
  return {
    before: current.map((c) => ({ boardSeriesId: c.boardSeriesId, isDefault: c.isDefault })),
    after: rows.map((r) => ({ boardSeriesId: r.id, isDefault: defaults.get(r.boardCode) === r.id })),
    routes: kept,
    registrationsRouted: routed.length,
  };
}

/**
 * Set the series a window feeds, its defaults and its subject routes, in one
 * go. The window row is locked first, as a registration holds it: a
 * registration made at the same moment is entered by the old rules or the
 * new, never half. Existing registrations stay in their series (move them
 * explicitly); those made while the window fed no series are entered now.
 */
export async function setWindowSeries(sessionId: string, data: SetSessionBoardSeriesType, actorId: string, ctx?: AuditContext) {
  const { names } = await boardNameMap();
  try {
    return await db.transaction(async (tx) => {
      const [w] = await tx.select().from(registrationSession).where(eq(registrationSession.id, sessionId)).for('update');
      if (!w) throw new SeriesError('Session not found', 404);
      const result = await writeWindowSeries(tx, w, data, actorId, names);
      await logAction(actorId, 'SESSION_BOARD_SERIES_SET', 'session', sessionId,
        { series: result.before }, { series: result.after, routes: result.routes, registrationsRouted: result.registrationsRouted, reason: data.reason ?? null }, ctx, tx);
      return { sessionId, series: result.after.length, routes: result.routes.length, registrationsRouted: result.registrationsRouted };
    });
  } catch (err) {
    const sentence = seriesRuleSentence(err);
    if (sentence) throw new SeriesError(sentence, 409);
    throw err;
  }
}

/** A new window's series, in the transaction that creates it. */
export async function linkNewWindowSeries(
  tx: Tx, w: typeof registrationSession.$inferSelect, series: { boardSeriesId: string; isDefault: boolean }[], actorId: string | null,
) {
  if (!series.length) return;
  const { names } = await boardNameMap(tx);
  await writeWindowSeries(tx, w, { series }, actorId, names);
}

/**
 * Move registrations to another series the same window feeds, of their
 * subject's board. Refused once the series a registration is in, or the one
 * it would go to, is past its entry deadline: the entry is made, or can no
 * longer be. Each move is audited in the transaction.
 */
export async function moveRegistrations(sessionId: string, data: MoveRegistrationsToSeriesType, actorId: string, ctx?: AuditContext) {
  const { names } = await boardNameMap();
  try {
    return await db.transaction(async (tx) => {
      const [link] = await tx
        .select({ series: boardSeries })
        .from(sessionBoardSeries).innerJoin(boardSeries, eq(boardSeries.id, sessionBoardSeries.boardSeriesId))
        .where(and(eq(sessionBoardSeries.sessionId, sessionId), eq(sessionBoardSeries.boardSeriesId, data.boardSeriesId)))
        .for('share', { of: boardSeries });
      if (!link) throw new SeriesError('This window does not feed that series', 404);
      const target = link.series;
      const now = new Date();
      if (target.entryDeadline && target.entryDeadline <= now) throw new SeriesError(entryDeadlineMessage(target.entryDeadline));
      const regs = await tx
        .select({ id: registration.id, sessionId: registration.sessionId, status: registration.status, boardSeriesId: registration.boardSeriesId, council: subject.council, subjectName: subject.name })
        .from(registration).innerJoin(subject, eq(subject.id, registration.subjectId))
        .where(inArray(registration.id, data.registrationIds))
        .orderBy(registration.id)
        .for('update', { of: registration });
      if (regs.length !== data.registrationIds.length || regs.some((r) => r.sessionId !== sessionId)) {
        throw new SeriesError('One or more registrations are not in this window', 404);
      }
      const done = regs.find((r) => (DONE as readonly string[]).includes(r.status));
      if (done) throw new SeriesError(`${done.subjectName} is ${done.status}: its registration is history and stays where it was`, 409);
      const otherBoard = regs.find((r) => r.council !== target.boardCode);
      if (otherBoard) {
        throw new SeriesError(`${otherBoard.subjectName} is entered with ${names.get(otherBoard.council) ?? otherBoard.council}; ${boardSeriesName(names, target)} is another board's series`);
      }
      const sourceIds = [...new Set(regs.map((r) => r.boardSeriesId).filter((x): x is string => !!x))];
      const sources = sourceIds.length ? await tx.select().from(boardSeries).where(inArray(boardSeries.id, sourceIds)).orderBy(boardSeries.id).for('share') : [];
      const passed = sources.find((s) => s.entryDeadline && s.entryDeadline <= now);
      if (passed) {
        throw new SeriesError(`${boardSeriesName(names, passed)} is past its entry deadline (${schoolDate(passed.entryDeadline!)}): its entries stand`, 409);
      }
      const moving = regs.filter((r) => r.boardSeriesId !== target.id);
      for (const r of moving) {
        await tx.update(registration).set({ boardSeriesId: target.id, updatedAt: now }).where(eq(registration.id, r.id));
      }
      // A registration paid for with another in an open checkout may not move
      // to a series with another deadline: the checkout would span two.
      const spanning = await openCheckoutsSpanningDeadlines(tx, { registrationIds: moving.map((r) => r.id) });
      if (spanning > 0) {
        throw new SeriesError(
          `${checkouts(spanning)} for these registrations together with others whose entry deadline would then differ — ${settleFirst(spanning)}, or move them together`,
          409,
        );
      }
      await logActions(moving.map((r) => ({
        userId: actorId, action: 'REGISTRATION_SERIES_MOVED' as const, entityType: 'registration' as const, entityId: r.id,
        previousData: { boardSeriesId: r.boardSeriesId }, newData: { boardSeriesId: target.id, reason: data.reason },
      })), tx);
      return { moved: moving.length, alreadyThere: regs.length - moving.length, boardSeriesId: target.id, series: boardSeriesName(names, target) };
    });
  } catch (err) {
    const sentence = seriesRuleSentence(err);
    if (sentence) throw new SeriesError(sentence, 409);
    throw err;
  }
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

// ─── One checkout per entry deadline ─────────────────────────────────────────

export type DeadlineGroup = {
  entryDeadline: Date | null;
  series: { id: string; name: string }[];
  registrationIds: string[];
  subjects: string[];
};

/**
 * The board series a set of registrations is entered in, grouped by entry
 * deadline (F0b, MO-10 per series): money is taken per group — the deadline
 * sweep closes a checkout at its series' deadline, so a checkout never spans
 * two deadlines. Series with the same deadline share a group. Earliest
 * deadline first; no deadline last. `lock` reads the series FOR SHARE
 * (inside the transaction that takes the money), so a deadline changing at
 * the same moment waits for it.
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
  const { names } = await boardNameMap(executor);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const groups = new Map<string, DeadlineGroup>();
  for (const r of regs) {
    const sr = r.boardSeriesId ? byId.get(r.boardSeriesId) : undefined;
    const deadline = sr?.entryDeadline ?? null;
    const key = deadline ? String(deadline.getTime()) : 'none';
    const g = groups.get(key) ?? { entryDeadline: deadline, series: [], registrationIds: [], subjects: [] };
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
    const when = g.entryDeadline ? `entry deadline ${schoolDate(g.entryDeadline)}` : 'no entry deadline yet';
    return `${series} (${when}): ${g.subjects.join(', ')}`;
  });
  return `These subjects are entered in exam board series with different entry deadlines, so each series is paid for on its own: ${parts.join('; ')}`;
}

// ─── Routing a new registration ──────────────────────────────────────────────

export type Route = { boardSeriesId: string; entryDeadline: Date | null; name: string };

/**
 * The series each subject is entered in when registered in this window: the
 * route the window names for it, else the window's default series of its
 * board. `feedsSeries` false: the window feeds none, and registrations carry
 * none (as before F0b). Inside a transaction the window's links are held
 * FOR SHARE, so a change to them waits for the registration.
 */
export async function routeSubjects(
  executor: Executor,
  sessionId: string,
  subjects: { id: string; council: string }[],
  lock = false,
): Promise<{ feedsSeries: boolean; routes: Map<string, Route | null> }> {
  const q = executor
    .select({ boardSeriesId: sessionBoardSeries.boardSeriesId, boardCode: sessionBoardSeries.boardCode, isDefault: sessionBoardSeries.isDefault, series: boardSeries })
    .from(sessionBoardSeries).innerJoin(boardSeries, eq(boardSeries.id, sessionBoardSeries.boardSeriesId))
    .where(eq(sessionBoardSeries.sessionId, sessionId));
  const links = lock ? await q.for('share', { of: sessionBoardSeries }) : await q;
  const routes = new Map<string, Route | null>();
  if (!links.length) return { feedsSeries: false, routes };
  const { names } = await boardNameMap(executor);
  const explicit = subjects.length
    ? await executor.select().from(sessionSubjectSeries)
        .where(and(eq(sessionSubjectSeries.sessionId, sessionId), inArray(sessionSubjectSeries.subjectId, subjects.map((s) => s.id))))
    : [];
  for (const s of subjects) {
    const routedTo = explicit.find((e) => e.subjectId === s.id)?.boardSeriesId;
    const link = routedTo ? links.find((l) => l.boardSeriesId === routedTo) : links.find((l) => l.boardCode === s.council && l.isDefault);
    routes.set(s.id, link ? { boardSeriesId: link.series.id, entryDeadline: link.series.entryDeadline, name: boardSeriesName(names, link.series) } : null);
  }
  return { feedsSeries: true, routes };
}

/**
 * Refuse a registration whose subject the window enters in no series, or in
 * a series past its entry deadline (MO-10, per series). Returns the series
 * id each subject goes to (null in a window that feeds none).
 */
export function assertRoutesOpen(
  routing: { feedsSeries: boolean; routes: Map<string, Route | null> },
  subjects: { id: string; name: string; council: string }[],
  now: Date = new Date(),
  boardNamesByCode?: Map<string, string>,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const s of subjects) {
    if (!routing.feedsSeries) { out.set(s.id, null); continue; }
    const r = routing.routes.get(s.id);
    if (!r) {
      const board = boardNamesByCode?.get(s.council) ?? s.council;
      throw new SeriesError(`${s.name} is entered with ${board}, and this window feeds no ${board} series — ask the admin to add one to the window`);
    }
    if (r.entryDeadline && r.entryDeadline <= now) throw new SeriesError(entryDeadlineMessage(r.entryDeadline));
    out.set(s.id, r.boardSeriesId);
  }
  return out;
}

/**
 * Route and check in one step, with the board names for the sentence. With
 * `lock` (inside the transaction that inserts): each subject's board is read
 * again `FOR SHARE`, so a board change (which holds the subject `FOR UPDATE`
 * while it moves the subject's registrations) and this registration run one
 * after the other — the registration is routed by the board it is entered
 * with, never by one being replaced.
 */
export async function routeAndCheck(
  executor: Executor, sessionId: string, subjects: { id: string; name: string; council: string }[], lock = false,
) {
  let current = subjects;
  if (lock && subjects.length) {
    const boards = await executor.select({ id: subject.id, council: subject.council }).from(subject)
      .where(inArray(subject.id, [...new Set(subjects.map((s) => s.id))]))
      .orderBy(subject.id)
      .for('share');
    const by = new Map(boards.map((b) => [b.id, b.council]));
    current = subjects.map((s) => ({ ...s, council: by.get(s.id) ?? s.council }));
  }
  const routing = await routeSubjects(executor, sessionId, current, lock);
  const { names } = await boardNameMap(executor);
  return assertRoutesOpen(routing, current, new Date(), names);
}

/** The refusal when a window would close on or after a fed series' entry deadline (MO-10). */
export function windowPastDeadlineSentence(earliest: Date) {
  return `The window cannot close on or after the exam board's entry deadline (${schoolDate(earliest)}) — move the board deadline first`;
}

/**
 * The entry deadlines of the series a window feeds: the earliest is the one
 * the window must close before (strict order). Not a deadline for the window's
 * registrations: each is judged by its own series (sessionWindow).
 */
export async function windowDeadlines(sessionId: string, executor: Executor = db) {
  const rows = await executor
    .select({ entryDeadline: boardSeries.entryDeadline })
    .from(sessionBoardSeries).innerJoin(boardSeries, eq(boardSeries.id, sessionBoardSeries.boardSeriesId))
    .where(eq(sessionBoardSeries.sessionId, sessionId));
  const set = rows.map((r) => r.entryDeadline).filter((d): d is Date => !!d);
  return {
    feedsSeries: rows.length > 0,
    earliest: set.length ? new Date(Math.min(...set.map((d) => d.getTime()))) : null,
  };
}

/** The entry deadline of one series. */
export async function seriesDeadline(boardSeriesId: string, executor: Executor = db): Promise<Date | null> {
  const [s] = await executor.select({ entryDeadline: boardSeries.entryDeadline }).from(boardSeries).where(eq(boardSeries.id, boardSeriesId));
  return s?.entryDeadline ?? null;
}

/** The series (id, deadline) whose entry deadline has passed — what the sweep closes. */
export async function seriesPastDeadline(now: Date) {
  return db.select({ id: boardSeries.id, entryDeadline: boardSeries.entryDeadline, boardCode: boardSeries.boardCode, month: boardSeries.month, year: boardSeries.year, label: boardSeries.label })
    .from(boardSeries)
    .where(sql`${boardSeries.entryDeadline} is not null and ${boardSeries.entryDeadline} <= ${now}`)
    .orderBy(boardSeries.entryDeadline);
}

/** The windows feeding a series, by status. */
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

/** Registrations of a window no series holds yet (made while it fed none). */
export async function unroutedCount(sessionId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(registration)
    .where(and(eq(registration.sessionId, sessionId), isNull(registration.boardSeriesId), notInArray(registration.status, [...DONE])));
  return r?.n ?? 0;
}
