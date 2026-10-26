/**
 * The reference data as staff read it (COORDINATOR_REWORK.md §7, D1; Appendix A `GET /reference/*`):
 * the boards with their rules and sittings (the board dates, information and the money safety net of
 * C6), and per board the subjects with their suggested rows. Read-only: loaded by the seed
 * (`loadReference`, @repo/db), never edited by staff.
 */

import { db, examBoard, boardSeries, referenceSubject, referenceRow, and, eq, inArray, asc, sql } from '@repo/db';

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
    .orderBy(asc(referenceSubject.boardCode), asc(referenceSubject.group), asc(referenceSubject.sortOrder), asc(referenceSubject.name));
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
