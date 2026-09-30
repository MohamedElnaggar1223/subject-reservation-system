/**
 * Exams on a date, for the leave approval's "exam that day" warning
 * (FEATURES_PLAN.md F2, "Approval"; §2: F4 provides `getExamsFor(studentId,
 * date)`).
 *
 * F4 (exam entries) is being built in parallel. Until it lands this interface
 * answers "none", and campus leave builds no exam data of its own. When F4
 * lands, replace the body of `examsFor` with a call to its contract, mapping
 * each sitting to `ExamOnDate`:
 *
 *   import { getExamsFor } from './<f4 service>';
 *   export async function examsFor(studentId: string, date: string) {
 *     return (await getExamsFor(studentId, date)).map((x) => ({ title: …, startsAt: …, endsAt: …, board: … }));
 *   }
 *
 * Nothing else in campus leave changes: the queue, the family's request form
 * and the warning code `exam_that_day` already read this function.
 *
 * (The school calendar's own exam-only days are F0a data and are warned about
 * separately: `exam_only_day`.)
 */

export type ExamOnDate = {
  /** What is sat, as the family and the approver read it ("Physics 0625 Paper 4"). */
  title: string;
  /** The session's start and end, HH:MM in Cairo, when known. */
  startsAt: string | null;
  endsAt: string | null;
  /** The exam board's name, when known. */
  board: string | null;
};

/** The exams a student sits on a date (none until F4's `getExamsFor` is wired here). */
export async function examsFor(_studentId: string, _date: string): Promise<ExamOnDate[]> {
  return [];
}
