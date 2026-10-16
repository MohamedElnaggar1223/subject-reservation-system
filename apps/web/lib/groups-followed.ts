/**
 * What happened to a student's group when their teacher changed, in the school's words
 * (docs/features/CYCLE_FOLLOWUPS.md §2): the desk's teacher change on a line (B's
 * `PUT /v1/registrations/:id/teacher`) and the Session screen's "Replace a teacher" (A's
 * `POST …/offers/:offerId/replace-teacher`) both return F1's follow-up outcome (`groupsFollowed`,
 * `followEnrolments` in apps/api/src/services/group.services.ts); this turns it into sentences.
 *
 * A group is F1's teaching group, named as the coordinator named it — "group" / مجموعة everywhere (the
 * lead's decision of 16 Oct 2026, 12; a section, 11A, is فصل). The sentences are English, one
 * text each, translated on the page by `translateReservationsText` (lib/i18n-reservations.ts); a
 * refusal's reason is the API's own sentence, kept apart so F1's rules translate it
 * (`translateSchedulingText`). No React here: the API suite reads the real outcomes through it
 * (08s6, "the desk's sentence").
 */

import type { hc } from 'hono/client';
import type { AppType } from '@repo/api';
import type { apiResponse } from '@repo/validations';

type Client = ReturnType<typeof hc<AppType>>;
type LineTeacherChange = Awaited<ReturnType<typeof apiResponse<ReturnType<Client['v1']['registrations'][':id']['teacher']['$put']>>>>;
/** F1's follow-up outcome as the desk's teacher change answers it (A's replace-teacher answers the same). */
export type GroupsFollowed = NonNullable<LineTeacherChange['groupsFollowed']>;

export type FollowSentence = {
  /** The sentence, in English (the page translates it). */
  text: string;
  /** A refusal's reason, the API's sentence (the clash in the published timetable), or null. */
  reason: string | null;
  tone: 'success' | 'warning';
};

/** "1 student moves" / "3 students move": a count and its verb, one text for the translator. */
const students = (n: number, singular: string, plural: string) => (n === 1 ? `1 student ${singular}` : `${n} students ${plural}`);

/**
 * The sentences for one outcome. `one`: the outcome is about one student (the desk: "the student
 * moves …"); otherwise the students are counted per group (the Session screen's replacement).
 * `teacherName` names a teacher by id (the screen has its teachers); a teacher it cannot name is
 * "The new teacher". Nothing to say (the student is in no group of the subject yet): no sentence.
 */
export function followSentences(
  f: GroupsFollowed | null | undefined,
  opts: { one: boolean; teacherName: (id: string) => string | null | undefined },
): FollowSentence[] {
  if (!f) return [];
  const out: FollowSentence[] = [];
  const add = (s: FollowSentence) => {
    if (!out.some((x) => x.text === s.text && x.reason === s.reason)) out.push(s);
  };
  const nameOf = (id: string | null) => (id ? opts.teacherName(id) || 'The new teacher' : null);
  /** Entries grouped by what the sentence says, counting the students of each. */
  const tally = <T>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, { row: T; n: number }>();
    for (const r of rows) {
      const k = key(r);
      const e = m.get(k);
      if (e) e.n++;
      else m.set(k, { row: r, n: 1 });
    }
    return [...m.values()];
  };

  for (const g of f.groupsGiven) {
    const t = nameOf(g.teacherId);
    const tail = opts.one ? ': the student stays in it.' : '.';
    add({ text: t ? `The whole group ${g.groupName} goes to ${t}${tail}` : `The whole group ${g.groupName} waits for a teacher${tail}`, reason: null, tone: 'success' });
  }
  for (const { row, n } of tally(f.moved, (m) => m.toGroupName)) {
    add({ text: opts.one ? `The student moves to the group ${row.toGroupName}.` : `${students(n, 'moves', 'move')} to the group ${row.toGroupName}.`, reason: null, tone: 'success' });
  }
  for (const { row, n } of tally(f.left, (l) => l.groupName)) {
    const who = opts.one ? 'The student leaves' : students(n, 'leaves', 'leave');
    add({ text: `${who} the group ${row.groupName} after today: self-study from now.`, reason: null, tone: 'success' });
  }
  for (const { row, n } of tally(f.waiting, (w) => `${w.kind}|${w.groupName}|${w.teacherId ?? ''}|${w.kind === 'refused' ? w.why : ''}`)) {
    const stays = opts.one ? 'the student stays' : students(n, 'stays', 'stay');
    if (row.kind === 'refused') {
      add({ text: `The move was refused: ${stays} in ${row.groupName}.`, reason: row.why, tone: 'warning' });
      continue;
    }
    const waits = opts.one || n === 1 ? 'waits' : 'wait';
    const t = nameOf(row.teacherId);
    add({
      text: t
        ? `${t} has no group of this subject yet: ${stays} in ${row.groupName} and ${waits} to be placed.`
        : `No group of this subject is without a teacher yet: ${stays} in ${row.groupName} and ${waits} to be placed.`,
      reason: null, tone: 'warning',
    });
  }
  return out;
}
