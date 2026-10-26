/**
 * What the school knows a student sat (COORDINATOR_REWORK.md F2, D7): one rule for the family page and the line
 * rules, so what a family is shown and what a reservation is refused never disagree.
 *
 * A student the system knows has sat a row's subject — a confirmed line of it in another session, of a sitting
 * before the row's, whose codes meet the row's where both name codes; or F4's result or sent entry for the
 * subject's award before the row's sitting — sees the retake options only, with that sitting filled in (the
 * latest). Every other student sees first entry and retake (a student may have sat elsewhere, so a retake the
 * system cannot rule out is never hidden).
 */

import { db, sql } from '@repo/db';
import { examSittingsOf } from './reservation.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

const MONTH_ORDER: Record<string, number> = { january: 1, june: 6, october: 10, november: 11 };
const order = (month: string, year: number) => year * 12 + (MONTH_ORDER[month] ?? 0);

export type StudentRecord = {
  lines: { subjectId: string; seriesId: string; codes: string[]; month: string; year: number }[];
  exams: Awaited<ReturnType<typeof examSittingsOf>>;
};

/** The student's record as F2 reads it: confirmed lines in the other sessions, and F4's results and sent entries. */
export async function studentRecordOf(executor: Executor, studentId: string, sessionId: string): Promise<StudentRecord> {
  const lines = (await executor.execute(sql`
    select r.subject_id as "subjectId", r.board_series_id as "seriesId", i.reference_codes as codes, bs.month, bs.year
    from registration r join session_offer_item i on i.id = r.offer_item_id join board_series bs on bs.id = r.board_series_id
    where r.student_id = ${studentId} and r.session_id <> ${sessionId} and r.status = 'confirmed'`)).rows as StudentRecord['lines'];
  return { lines: lines.map((l) => ({ ...l, year: Number(l.year) })), exams: await examSittingsOf(studentId) };
}

/** The latest sitting of the row's subject the record shows before the row's own sitting (F2), or null. */
export function knownSittingOf(
  record: StudentRecord,
  row: { subjectId: string; subjectQualificationId: string | null; referenceCodes: string[]; month: string | null; year: number | null },
): { id: string; month: string; year: number } | null {
  const here = row.month && row.year ? order(row.month, row.year) : Infinity;
  const known = [
    ...record.lines.filter((h) => h.subjectId === row.subjectId && order(h.month, h.year) < here
      && (!h.codes.length || !row.referenceCodes.length || h.codes.some((c) => row.referenceCodes.includes(c))))
      .map((h) => ({ id: h.seriesId, month: h.month, year: h.year })),
    ...record.exams.filter((e) => row.subjectQualificationId && e.key === `q:${row.subjectQualificationId}` && order(e.month, e.year) < here)
      .map((e) => ({ id: e.seriesId, month: e.month, year: e.year })),
  ].sort((a, b) => order(b.month, b.year) - order(a.month, a.year));
  return known[0] ?? null;
}
