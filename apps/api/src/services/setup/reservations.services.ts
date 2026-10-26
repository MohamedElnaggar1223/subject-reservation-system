/**
 * The session's Reservations, read (COORDINATOR_REWORK.md B1, D13, §5; Appendix A
 * `GET /sessions/:id/reservations` + `?format=csv`): who reserved what, paid or not, and the answers to
 * the extra questions — the coordinator's read access to who reserved and who paid (she does not take
 * payments). Nothing here writes.
 */

import { db, registrationSession, sessionQuestion, registrationAnswer, eq, asc, sql } from '@repo/db';
import { csvCell } from '../scheduling-shared.services';
import { SetupError } from './offering.services';
import { optionLabel, labelRowOf } from './labels';
import { LIVE_LINE_STATUSES as LIVE } from './model';

export async function sessionReservations(sessionId: string) {
  const [s] = await db.select().from(registrationSession).where(eq(registrationSession.id, sessionId));
  if (!s) throw new SetupError('Session not found', 404);
  const lines = (await db.execute(sql`
    select r.id, r.student_id as "studentId", st.name as "studentName", s.name as subject, i.label as row, i.kind, i.reference_codes as codes,
      (i.self_study_fee is not null) as "ownSelfStudy",
      (select rr.short from reference_row rr join session_offer o on o.id = i.offer_id
        where rr.id = s.council || ':' || o.reference_code || ':' || i.reference_key) as short,
      r.attempt, r.mode, t.name as teacher, r.price_at_registration::float as price, r.status, r.due_at as "dueAt",
      r.price_provisional as provisional, r.created_at as "reservedAt",
      case when ps.id is null then null else initcap(ps.month) || ' ' || ps.year end as "carriedFrom"
    from registration r
    join "user" st on st.id = r.student_id
    join subject s on s.id = r.subject_id
    join session_offer_item i on i.id = r.offer_item_id
    left join teacher t on t.id = r.teacher_id
    left join board_series ps on ps.id = r.prior_sitting_series_id
    where r.session_id = ${sessionId} and r.status in (${sql.join(LIVE.map((x) => sql`${x}`), sql`, `)})
    order by st.name, s.name, i.sort_order, r.id`)).rows as {
      id: string; studentId: string; studentName: string; subject: string; row: string; kind: string; codes: string[]; ownSelfStudy: boolean; short: string | null; attempt: 'first' | 'retake'; mode: 'in_school' | 'self_study';
      teacher: string | null; price: number; status: string; dueAt: Date | string; provisional: boolean; reservedAt: Date | string; carriedFrom: string | null;
    }[];
  const questions = await db.select().from(sessionQuestion).where(eq(sessionQuestion.sessionId, sessionId)).orderBy(asc(sessionQuestion.sortOrder));
  const answers = await db.select().from(registrationAnswer).where(eq(registrationAnswer.sessionId, sessionId));
  const students = [...new Map(lines.map((l) => [l.studentId, l.studentName])).entries()].map(([id, name]) => {
    const mine = lines.filter((l) => l.studentId === id);
    return {
      id, name, lines: mine.length, paid: mine.filter((l) => l.status === 'confirmed').length,
      owed: Math.round(mine.filter((l) => l.status === 'pending_payment').reduce((a, l) => a + l.price, 0) * 100) / 100,
      answers: answers.filter((a) => a.studentId === id).map((a) => ({ questionId: a.questionId, value: a.value })),
    };
  });
  return {
    session: { id: s.id, name: s.name, status: s.status },
    lines: lines.map((l) => ({
      ...l,
      option: optionLabel(labelRowOf({ kind: l.kind, label: l.row, short: l.short, referenceCodes: l.codes, fromReference: l.short !== null }), { attempt: l.attempt, mode: l.mode }, { selfStudyShare: l.ownSelfStudy ? null : s.selfStudyPercent, lang: 'en' }),
      paid: l.status === 'confirmed',
    })),
    questions: questions.map(({ id, offeringId, kind, prompt, choices }) => ({ id, offeringId, kind, prompt, choices })),
    students,
    totals: {
      lines: lines.length, students: students.length, paid: lines.filter((l) => l.status === 'confirmed').length,
      unpaid: lines.filter((l) => l.status === 'pending_payment' || l.status === 'pending_approval').length,
    },
  };
}

/** The same read for a spreadsheet: one line per reservation, the student's answers beside it. */
export function sessionReservationsCsv(r: Awaited<ReturnType<typeof sessionReservations>>) {
  const header = ['Student', 'Subject', 'Option', 'Teacher', 'Carried from', 'Price (EGP)', 'Paid', 'Status', ...r.questions.map((q) => q.prompt)];
  const out = [header.map(csvCell).join(',')];
  for (const l of r.lines) {
    const st = r.students.find((s) => s.id === l.studentId);
    const cells = [
      l.studentName, l.subject, l.option, l.teacher ?? '', l.carriedFrom ?? '', l.price, l.paid ? 'yes' : 'no', l.status,
      ...r.questions.map((q) => st?.answers.find((a) => a.questionId === q.id)?.value ?? ''),
    ];
    out.push(cells.map(csvCell).join(','));
  }
  return `${out.join('\r\n')}\r\n`;
}
