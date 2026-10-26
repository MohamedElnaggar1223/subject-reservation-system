/**
 * The reference data as staff read it (COORDINATOR_REWORK.md §7, D1; Appendix A `GET /reference/*`):
 * the boards with their rules and sittings (the board dates, information and the money safety net of
 * C6), and per board the subjects with their suggested rows. Read-only: loaded by the seed
 * (`loadReference`, @repo/db), never edited by staff.
 */

import { db, examBoard, boardSeries, referenceSubject, referenceRow, sessionBoardSeries, registrationSession, referenceDeadline, and, eq, inArray, asc, sql } from '@repo/db';
import type { EnterBoardDateType } from '@repo/validations';
import { logAction, type AuditContext } from '../audit.services';
import { redateSeriesLines } from '../deadline.services';
import { SetupError, setupRethrow } from './offering.services';
import { logger } from '../../lib/logger';

type Executor = Pick<typeof db, 'select'>;

const MONTH_NUMBER: Record<string, number> = { january: 1, june: 6, october: 10, november: 11 };

/** GET /reference/boards: each board, its rules, and its sittings with their dates. */
export async function referenceBoards(executor: Executor = db) {
  const boards = await executor.select().from(examBoard).orderBy(asc(examBoard.sortOrder), asc(examBoard.code));
  const sittings = await executor.select().from(boardSeries).where(eq(boardSeries.label, ''))
    .orderBy(asc(boardSeries.year), sql`school_month_order(${boardSeries.month})`);
  return boards.map((b) => ({
    code: b.code,
    name: b.name,
    // E5: what a one-paper retake's exam fee is — the syllabus's or the paper's own row.
    onePaperFee: b.onePaperFeeKey === 'unit' ? ('paper' as const) : ('syllabus' as const),
    onePaperAsksSitting: b.onePaperAsksSitting,
    // D6: a warning past it, not a refusal.
    carryForwardMonths: b.carryForwardMonths,
    aliases: b.referenceAliases,
    sittings: sittings.filter((s) => s.boardCode === b.code).map((s) => ({
      id: s.id, month: s.month, monthNumber: MONTH_NUMBER[s.month] ?? null, year: s.year,
      entryDeadline: s.entryDeadline, retakeDeadline: s.retakeDeadline, examsStart: s.examsStart,
      levels: s.levels, source: s.datesSource, confirmed: s.datesConfirmed,
    })),
  }));
}

/** GET /reference/subjects?board=: the subjects with code, name, group and their suggested rows (D1–D2). */
export async function referenceSubjects(board?: string, executor: Executor = db) {
  const subjects = await executor.select().from(referenceSubject)
    .where(board ? eq(referenceSubject.boardCode, board) : undefined)
    // D10: O.L. subjects, then A.S. / A.L.
    .orderBy(asc(referenceSubject.boardCode), sql`${referenceSubject.group} = 'O.L.' desc`, asc(referenceSubject.sortOrder), asc(referenceSubject.name));
  const rows = subjects.length
    ? await executor.select().from(referenceRow).where(inArray(referenceRow.referenceSubjectId, subjects.map((s) => s.id))).orderBy(asc(referenceRow.sortOrder))
    : [];
  return subjects.map((s) => ({
    board: s.boardCode, code: s.code, name: s.name, group: s.group, level: s.level, confirmed: s.confirmed, note: s.note,
    winterSitting: s.winterSitting,
    rows: rows.filter((r) => r.referenceSubjectId === s.id).map((r) => ({
      key: r.key, kind: r.kind, codes: r.codes, priceCodes: r.priceCodes, short: r.short,
      label: { en: r.labelEn, ar: r.labelAr }, sumOfUnits: r.sumOfUnits,
      // null: the subject's winter sitting; 'none': not sat in winter.
      winterSitting: r.winterSitting,
    })),
  }));
}

export type ReferenceSubjectView = Awaited<ReturnType<typeof referenceSubjects>>[number];

/** One reference subject by its code (and board, when two boards print the same code). */
export async function findReferenceSubject(executor: Executor, code: string, board?: string) {
  const found = await executor.select().from(referenceSubject)
    .where(board ? and(eq(referenceSubject.code, code), eq(referenceSubject.boardCode, board)) : eq(referenceSubject.code, code));
  if (found.length !== 1) return { subject: null, ambiguous: found.length > 1 };
  const rows = await executor.select().from(referenceRow).where(eq(referenceRow.referenceSubjectId, found[0]!.id)).orderBy(asc(referenceRow.sortOrder));
  return { subject: found[0]!, rows, ambiguous: false };
}

const cairoDay = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' }).format(d);

/**
 * PUT /reference/sittings/:id/board-date — C6's one exception, the admin's alone: a sitting with no board
 * entry deadline (the reference data gives none yet, or a session's own sitting) gets it once, with its
 * retake deadline when the board has one. Marked as the admin's (dates_source 'admin'), so the reference
 * loader keeps it. Audited; the waiting lines of the sitting are re-dated once it commits. The same dates
 * sent again answer 200 and re-date the lines again (a failed re-date is retried so); any other date on a
 * sitting that has its deadline is refused (the reference data owns it).
 */
export async function enterBoardDate(seriesId: string, data: EnterBoardDateType, actorId: string, ctx?: AuditContext) {
  let out: typeof boardSeries.$inferSelect;
  try {
    out = await db.transaction(async (tx) => {
      // As every series writer: the sessions it is attached to (FOR SHARE), then the series.
      await tx.select({ id: registrationSession.id }).from(sessionBoardSeries)
        .innerJoin(registrationSession, eq(registrationSession.id, sessionBoardSeries.sessionId))
        .where(eq(sessionBoardSeries.boardSeriesId, seriesId)).orderBy(registrationSession.id).for('share', { of: registrationSession });
      const [s] = await tx.select().from(boardSeries).where(eq(boardSeries.id, seriesId)).for('update');
      if (!s) throw new SetupError('That sitting was not found', 404);
      const now = new Date();
      // The end of the day in Cairo, as the reference data's dates are stored (referenceDeadline).
      const entry = referenceDeadline(data.entryDeadline)!;
      const retake = data.retakeDeadline === undefined ? undefined : referenceDeadline(data.retakeDeadline);
      if (s.entryDeadline) {
        // The admin's own dates sent again: nothing to write — the waiting lines are re-dated again below (the way to
        // retry a re-date that failed). Any other date on a sitting that has its deadline is refused.
        const same = (a: Date | null, b: Date | null | undefined) => b === undefined || (a?.getTime() ?? null) === (b?.getTime() ?? null);
        if (s.datesSource === 'admin' && same(s.entryDeadline, entry) && same(s.retakeDeadline, retake)) return s;
        throw new SetupError(`This sitting has its board entry deadline (${cairoDay(s.entryDeadline)}): the reference data keeps it`, 409);
      }
      if (entry <= now) throw new SetupError("The board's entry deadline must be in the future");
      if (retake && retake < entry) throw new SetupError('The retake deadline cannot be before the entry deadline');
      const [updated] = await tx.update(boardSeries).set({
        entryDeadline: entry, ...(retake !== undefined ? { retakeDeadline: retake } : {}),
        datesSource: 'admin', updatedAt: now,
      }).where(eq(boardSeries.id, seriesId)).returning();
      await logAction(actorId, 'BOARD_SERIES_DEADLINE_SET', 'board_series', seriesId,
        { entryDeadline: null, retakeDeadline: s.retakeDeadline?.toISOString() ?? null, datesSource: s.datesSource },
        { entryDeadline: entry.toISOString(), retakeDeadline: (retake !== undefined ? retake : s.retakeDeadline)?.toISOString() ?? null, datesSource: 'admin',
          via: 'the check list (C6: the admin enters a missing board date once)' }, ctx, tx);
      return updated!;
    });
  } catch (err) {
    setupRethrow(err);
  }
  // The waiting lines' due dates follow, once the deadline has committed: a series' writer may not lock lines
  // after the series (a checkout locks its lines before their series, MA-06 — redateSeriesLines' own
  // transaction). The deadline is saved whatever happens here: a failure is logged and reported (null), and
  // running the re-date again changes nothing it already did.
  let linesRedated: number | null;
  try {
    linesRedated = await redateSeriesLines(seriesId, actorId, 'the admin entered the board\'s entry deadline');
  } catch (err) {
    logger.error(`[board-date] the waiting lines of sitting ${seriesId} were not re-dated:`, err);
    linesRedated = null;
  }
  return {
    id: out.id, boardCode: out.boardCode, month: out.month, year: out.year, label: out.label,
    entryDeadline: out.entryDeadline, retakeDeadline: out.retakeDeadline, examsStart: out.examsStart, datesSource: out.datesSource, linesRedated,
  };
}
