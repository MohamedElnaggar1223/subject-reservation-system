/**
 * What every F4 service shares (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md):
 * the refusal type, a board series with its name, each board's rules (data,
 * staff-editable), the school's centre number and route per board (a
 * setting), the hard stop at a series' entry deadline (MO-10), and who may
 * read one student's exam records (the student, a linked parent, the staff
 * who keep student records).
 */

import {
  db, boardSeries, examBoard, examBoardRule, parentStudentLink, user, eq, and, inArray, sql,
} from '@repo/db';
import { ROLES, STUDENT_RECORD_ROLES, hasRole, schoolDateString, type ExamCentres } from '@repo/validations';
import { boardSeriesName } from './series.services';
import { getSetting } from './settings.services';
import { schoolDate, schoolDateTime } from './window.services';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

/** A refusal with the status the route answers. */
export class ExamError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 | 422 = 400) {
    super(message);
  }
}

export const isUniqueViolation = (err: unknown) =>
  (err as { code?: string } | null)?.code === '23505' || (err as { cause?: { code?: string } } | null)?.cause?.code === '23505';

/** The constraint a database error names, if any. */
export const violatedConstraint = (err: unknown): string | undefined =>
  (err as { constraint?: string } | null)?.constraint ?? (err as { cause?: { constraint?: string } } | null)?.cause?.constraint;

export async function boardNameMap(executor: Executor = db) {
  const rows = await executor.select({ code: examBoard.code, name: examBoard.name }).from(examBoard);
  return new Map(rows.map((r) => [r.code, r.name]));
}

export type SeriesRow = typeof boardSeries.$inferSelect & { name: string; boardName: string };

/** A board series with its display name ("Cambridge International November 2026"). */
export async function seriesOrThrow(id: string, executor: Executor = db, lock?: 'share' | 'update'): Promise<SeriesRow> {
  const q = executor.select().from(boardSeries).where(eq(boardSeries.id, id));
  const [s] = lock === 'update' ? await q.for('update') : lock === 'share' ? await q.for('share') : await q;
  if (!s) throw new ExamError('Board series not found', 404);
  const names = await boardNameMap(executor);
  return { ...s, name: boardSeriesName(names, s), boardName: names.get(s.boardCode) ?? s.boardCode };
}

/** The series' entry deadline has passed at `at` (the school's hard stop, MO-10). */
export function pastEntryDeadline(s: { entryDeadline: Date | null }, at: Date = new Date()): boolean {
  return !!s.entryDeadline && s.entryDeadline.getTime() <= at.getTime();
}

/** The refusal for a new entry after the series' entry deadline (MO-10, A-08). */
export function hardStopSentence(s: { name: string; entryDeadline: Date | null }): string {
  return `The entry deadline for ${s.name} (${schoolDateTime(s.entryDeadline!)}) has passed: the school makes no new entries after it — the board's late entries are not taken (MO-10)`;
}

export type BoardRules = typeof examBoardRule.$inferSelect & { recorded: boolean };

const DEFAULT_RULES = (boardCode: string): BoardRules => ({
  boardCode,
  forecastRequired: false,
  forecastLockedOnSubmit: false,
  optionCodeRequired: false,
  uciRequired: false,
  candidateNumberFixed: true,
  amendmentAfterDeadline: 'allowed_with_fee',
  amendmentFeeFrom: 'entry_deadline',
  amendmentFeeNote: null,
  withdrawalRefundUntil: 'entry_deadline',
  withdrawalFeeNote: null,
  carryForwardMonths: null,
  resultsKey: 'candidate_number',
  notes: null,
  updatedBy: null,
  updatedAt: new Date(0),
  recorded: false,
});

/** A board's entry rules; a board with none recorded reads lenient defaults and says so (`recorded: false`). */
export async function boardRulesFor(boardCode: string, executor: Executor = db): Promise<BoardRules> {
  const [r] = await executor.select().from(examBoardRule).where(eq(examBoardRule.boardCode, boardCode));
  return r ? { ...r, recorded: true } : DEFAULT_RULES(boardCode);
}

export async function boardRulesMap(boardCodes: string[], executor: Executor = db): Promise<Map<string, BoardRules>> {
  const codes = [...new Set(boardCodes)];
  const rows = codes.length ? await executor.select().from(examBoardRule).where(inArray(examBoardRule.boardCode, codes)) : [];
  return new Map(codes.map((c) => {
    const r = rows.find((x) => x.boardCode === c);
    return [c, r ? { ...r, recorded: true } : DEFAULT_RULES(c)];
  }));
}

/** The school's centre number and entry route with a board (the `exams.centres` setting). */
export async function centreFor(boardCode: string, centres?: ExamCentres) {
  const all = centres ?? (await getSetting('exams.centres'));
  const c = all[boardCode];
  return { centreNumber: c?.centreNumber ?? null, route: c?.route ?? 'direct' };
}

/** The date a series' named date falls on, as the rules read it. */
export function seriesDate(
  s: { entryDeadline: Date | null; lateFeeFrom: string | null; highLateFeeFrom: string | null },
  which: 'entry_deadline' | 'late_fee_from' | 'high_late_fee_from' | 'never',
): string | null {
  if (which === 'never') return null;
  if (which === 'entry_deadline') return s.entryDeadline ? schoolDateString(s.entryDeadline) : null;
  return which === 'late_fee_from' ? s.lateFeeFrom : s.highLateFeeFrom;
}

/** "31 August 2026" from a YYYY-MM-DD date. */
export function dateWords(date: string): string {
  return schoolDate(new Date(`${date}T12:00:00Z`));
}

/**
 * What a withdrawal costs with the board, as a sentence (information only:
 * nothing here moves family money). A draft was never sent, so it costs
 * nothing; a submitted entry is refunded by the board up to the rule's date.
 */
export function withdrawalCharge(
  rules: BoardRules,
  s: SeriesRow,
  entryStatus: string,
  at: Date = new Date(),
): { refunded: boolean | null; sentence: string } {
  if (entryStatus === 'draft') {
    return { refunded: null, sentence: 'Never submitted to the board: nothing to pay and nothing to refund.' };
  }
  const board = s.boardName;
  const until = seriesDate(s, rules.withdrawalRefundUntil as 'entry_deadline');
  const today = schoolDateString(at);
  const note = rules.withdrawalFeeNote ? ` ${rules.withdrawalFeeNote}` : '';
  if (rules.withdrawalRefundUntil === 'never') {
    return { refunded: false, sentence: `${board} keeps the entry fee for a withdrawn entry.${note}` };
  }
  if (!until) {
    return { refunded: null, sentence: `${board}'s refund date for ${s.name} is not recorded — check the board's rules on the Board series screen.${note}` };
  }
  if (today <= until) {
    return { refunded: true, sentence: `Withdrawn on or before ${dateWords(until)}: ${board} refunds the entry fee.${note}` };
  }
  return { refunded: false, sentence: `Withdrawn after ${dateWords(until)}: ${board} keeps the entry fee.${note}` };
}

/** What an amendment of a submitted entry costs with the board, as a sentence (information only). */
export function amendmentCharge(rules: BoardRules, s: SeriesRow, at: Date = new Date()): { feeDue: boolean; sentence: string } {
  const from = seriesDate(s, rules.amendmentFeeFrom as 'entry_deadline');
  const today = schoolDateString(at);
  const board = s.boardName;
  const note = rules.amendmentFeeNote ? ` ${rules.amendmentFeeNote}` : '';
  if (!from) return { feeDue: false, sentence: `No fee date recorded for ${s.name}: ${board}'s own rules apply.${note}` };
  if (today > from || (rules.amendmentFeeFrom === 'entry_deadline' && pastEntryDeadline(s, at))) {
    return { feeDue: true, sentence: `Changed after ${dateWords(from)}: ${board} charges a fee for this change.${note}` };
  }
  return { feeDue: false, sentence: `Changed before ${dateWords(from)}: no fee from ${board}.` };
}

/**
 * May this account read one student's exam records (statement, timetable,
 * results, sittings)? The student themself, an approved linked parent, and
 * the staff who keep student records. Another family's child is "not found".
 */
export async function assertMayReadStudent(viewer: { id: string; role?: string | null }, studentId: string) {
  if (viewer.role === ROLES.STUDENT) {
    if (viewer.id !== studentId) throw new ExamError('Student not found', 404);
    return;
  }
  if (viewer.role === ROLES.PARENT) {
    const [link] = await db.select({ id: parentStudentLink.id }).from(parentStudentLink)
      .where(and(eq(parentStudentLink.parentId, viewer.id), eq(parentStudentLink.studentId, studentId), eq(parentStudentLink.status, 'approved')));
    if (!link) throw new ExamError('Student not found', 404);
    return;
  }
  if (!hasRole(viewer.role, ...STUDENT_RECORD_ROLES)) throw new ExamError('Forbidden', 403);
}

/** Whether the viewer is the family (not staff): families see only what has been published. */
export const isFamily = (role: string | null | undefined) => role === ROLES.STUDENT || role === ROLES.PARENT;

export async function studentOrThrow(studentId: string, executor: Executor = db) {
  const [s] = await executor.select({ id: user.id, name: user.name, role: user.role, cohortYear: user.cohortYear, studentCode: user.studentId, email: user.email, leftOn: user.leftOn })
    .from(user).where(eq(user.id, studentId));
  if (!s || s.role !== ROLES.STUDENT) throw new ExamError('Student not found', 404);
  return s;
}

/** The student and their approved linked parents: who a family notice goes to. */
export async function familyOf(studentIds: string[]): Promise<Map<string, string[]>> {
  const ids = [...new Set(studentIds)];
  const out = new Map(ids.map((id) => [id, [id]]));
  if (!ids.length) return out;
  const links = await db.select({ parentId: parentStudentLink.parentId, studentId: parentStudentLink.studentId })
    .from(parentStudentLink)
    .where(and(inArray(parentStudentLink.studentId, ids), eq(parentStudentLink.status, 'approved')));
  for (const l of links) out.get(l.studentId)!.push(l.parentId);
  return out;
}

/** One transaction-scoped advisory lock per key: serializes two people doing the same bulk step. */
export async function advisoryLock(tx: Tx, key: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}
