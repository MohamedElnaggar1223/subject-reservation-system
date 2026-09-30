/**
 * Changes after publishing (FEATURES_PLAN.md F1; review flag 3). A published
 * timetable never changes, but the people in it do: a student added to a
 * group, moved into another group by a merge, moved between sections (their
 * section's lessons follow them), or a group given another teacher. Any of
 * these can put a student or a teacher in two lessons at once in the version in
 * force or a version already scheduled to take effect.
 *
 * Each such change is checked from the day it takes effect: the clashes it
 * would add (those already there before it are not its doing) refuse it with
 * the clashes listed, unless the coordinator confirms going ahead anyway —
 * then each clash is recorded (published_clash) and listed on the Timetables
 * screen under "Clashes in the published timetable" until a new version
 * resolves it.
 */
import {
  db, timetable, timetableLesson, teachingGroup, academicTerm, publishedClash, user, teacher,
  eq, and, inArray, sql, asc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import { WEEKDAY_NAMES } from '@repo/validations';
import {
  SchedulingError, addDays, minDate, maxDate, readableDate, groupMembersBetween, candidateGroupsOfStudent, groupsTaughtBetween,
  type Executor, type Tx,
} from './scheduling-shared.services';
import { todayAtSchool } from '../lib/clock';

export type ClashFound = {
  key: string;
  timetableId: string;
  timetableName: string;
  kind: 'students_busy' | 'teacher_busy';
  studentId: string | null;
  teacherId: string | null;
  person: string;
  lessonAId: string;
  lessonBId: string;
  groupA: string;
  groupB: string;
  weekday: number;
  period: number;
  fromDate: string;
  toDate: string;
  message: string;
};

/** The start of every refusal this module gives: the screens offer "go ahead anyway" on it. */
export const PUBLISHED_CLASH_REFUSAL = 'In the published timetable';

type Window = { id: string; name: string; from: string; to: string };

/** The days each published version is in force, from `from` on (a version replaced on its first day is never in force). */
async function versionWindows(executor: Executor, from: string): Promise<Window[]> {
  const rows = await executor.select({ id: timetable.id, name: timetable.name, termId: timetable.termId, effectiveFrom: timetable.effectiveFrom, publishedAt: timetable.publishedAt, termEnd: academicTerm.endsOn })
    .from(timetable).innerJoin(academicTerm, eq(academicTerm.id, timetable.termId))
    .where(and(eq(timetable.status, 'published'), sql`${academicTerm.endsOn} >= ${from}`))
    .orderBy(asc(timetable.termId), asc(timetable.effectiveFrom), asc(timetable.publishedAt));
  const out: Window[] = [];
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i]!;
    const later = rows.slice(i + 1).filter((x) => x.termId === v.termId);
    // The same day published again: the later publication wins that day and after.
    if (later.some((x) => x.effectiveFrom === v.effectiveFrom)) continue;
    const next = later.find((x) => x.effectiveFrom! > v.effectiveFrom!);
    const to = next ? minDate(addDays(next.effectiveFrom!, -1), v.termEnd) : v.termEnd;
    const a = maxDate(v.effectiveFrom!, from);
    if (a <= to) out.push({ id: v.id, name: v.name, from: a, to });
  }
  return out;
}

/** The first and last dates between two dates that fall on a weekday, or null. */
function weekdayDates(from: string, to: string, weekday: number): [string, string] | null {
  const wd = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
  let first = from;
  for (let k = 0; k < 7 && wd(first) !== weekday; k++) first = addDays(first, 1);
  if (first > to || wd(first) !== weekday) return null;
  let last = to;
  for (let k = 0; k < 7 && wd(last) !== weekday; k++) last = addDays(last, -1);
  return [first, last];
}

/**
 * Every clash in the published timetables, from `from` on, that involves
 * these students or teachers: two of their lessons at one time, on a day the
 * version is in force and they are in both groups (or teach both).
 */
export async function publishedClashesFor(executor: Executor, persons: { studentIds?: string[]; teacherIds?: string[] }, from: string): Promise<ClashFound[]> {
  const studentIds = [...new Set(persons.studentIds ?? [])];
  const teacherIds = [...new Set(persons.teacherIds ?? [])];
  if (!studentIds.length && !teacherIds.length) return [];
  const windows = await versionWindows(executor, from);
  if (!windows.length) return [];
  const horizon = windows.map((w) => w.to).sort().pop()!;
  const lessons = await executor.select({ id: timetableLesson.id, timetableId: timetableLesson.timetableId, groupId: timetableLesson.groupId, weekday: timetableLesson.weekday, period: timetableLesson.period, length: timetableLesson.length, groupName: teachingGroup.name })
    .from(timetableLesson).innerJoin(teachingGroup, eq(teachingGroup.id, timetableLesson.groupId))
    .where(and(inArray(timetableLesson.timetableId, windows.map((w) => w.id)), sql`${timetableLesson.weekday} IS NOT NULL`));
  const lessonsOf = new Map<string, typeof lessons>();
  for (const l of lessons) {
    const k = `${l.timetableId}|${l.groupId}`;
    if (!lessonsOf.has(k)) lessonsOf.set(k, []);
    lessonsOf.get(k)!.push(l);
  }
  const found = new Map<string, ClashFound>();
  const judge = (kind: ClashFound['kind'], personId: string, person: string, p: { groupId: string; from: string; to: string }, q: { groupId: string; from: string; to: string }) => {
    if (p.groupId === q.groupId) return;
    const a = maxDate(p.from, q.from);
    const b = minDate(p.to, q.to);
    if (a > b) return;
    for (const w of windows) {
      const wa = maxDate(a, w.from);
      const wb = minDate(b, w.to);
      if (wa > wb) continue;
      for (const la of lessonsOf.get(`${w.id}|${p.groupId}`) ?? []) {
        for (const lb of lessonsOf.get(`${w.id}|${q.groupId}`) ?? []) {
          if (la.weekday !== lb.weekday) continue;
          if (la.period! > lb.period! + lb.length - 1 || lb.period! > la.period! + la.length - 1) continue;
          const days = weekdayDates(wa, wb, la.weekday!);
          if (!days) continue;
          // The key by lesson id; the sentence names the groups in alphabetical order.
          const [x, y] = [la, lb].sort((m, n) => m.id.localeCompare(n.id)) as [typeof la, typeof lb];
          const [first, second] = [la, lb].sort((m, n) => m.groupName.localeCompare(n.groupName, 'en', { numeric: true }) || m.id.localeCompare(n.id)) as [typeof la, typeof lb];
          const key = `${kind}|${personId}|${w.id}|${x.id}|${y.id}`;
          const prev = found.get(key);
          if (prev && prev.fromDate <= days[0]) continue;
          const slot = `${WEEKDAY_NAMES[la.weekday!]} period ${Math.max(la.period!, lb.period!)}`;
          found.set(key, {
            key, timetableId: w.id, timetableName: w.name, kind,
            studentId: kind === 'students_busy' ? personId : null, teacherId: kind === 'teacher_busy' ? personId : null, person,
            lessonAId: x.id, lessonBId: y.id, groupA: x.groupName, groupB: y.groupName, weekday: la.weekday!, period: Math.max(la.period!, lb.period!),
            fromDate: days[0], toDate: days[1],
            message: kind === 'students_busy'
              ? `${person} would be in ${first.groupName} and ${second.groupName} at ${slot} from ${readableDate(days[0])} (${w.name})`
              : `${person} would teach ${first.groupName} and ${second.groupName} at ${slot} from ${readableDate(days[0])} (${w.name})`,
          });
        }
      }
    }
  };

  if (studentIds.length) {
    const names = new Map((await executor.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, studentIds))).map((u) => [u.id, u.name]));
    const groupIds = new Set<string>();
    for (const s of studentIds) for (const g of await candidateGroupsOfStudent(s, from, horizon, executor)) groupIds.add(g);
    const intervals = (await groupMembersBetween([...groupIds], from, horizon, executor)).filter((i) => studentIds.includes(i.studentId));
    for (const s of studentIds) {
      const mine = intervals.filter((i) => i.studentId === s);
      for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) judge('students_busy', s, names.get(s) ?? 'A student', mine[i]!, mine[j]!);
    }
  }
  if (teacherIds.length) {
    const names = new Map((await executor.select({ id: teacher.id, name: teacher.name }).from(teacher).where(inArray(teacher.id, teacherIds))).map((t) => [t.id, t.name]));
    for (const t of teacherIds) {
      const taught = await groupsTaughtBetween(t, from, horizon, executor);
      // A retired group is not taught from the day it was retired.
      const archivedOn = new Map(taught.length
        ? (await executor.select({ id: teachingGroup.id, archivedOn: teachingGroup.archivedOn }).from(teachingGroup).where(inArray(teachingGroup.id, taught.map((x) => x.groupId)))).map((g) => [g.id, g.archivedOn])
        : []);
      const mine = taught
        .map((x) => { const arch = archivedOn.get(x.groupId); return arch ? { ...x, to: minDate(x.to, addDays(arch, -1)) } : x; })
        .filter((x) => x.from <= x.to);
      for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) judge('teacher_busy', t, names.get(t) ?? 'A teacher', mine[i]!, mine[j]!);
    }
  }
  return [...found.values()].sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.message.localeCompare(b.message));
}

/**
 * Make a change that could put people in two lessons at once in a published
 * timetable: refused with the clashes it adds, unless `anyway`, when they are
 * recorded. Runs in the caller's transaction (a refusal rolls the change back).
 */
export async function guardPublishedTimetable<T>(
  tx: Tx,
  persons: { studentIds?: string[]; teacherIds?: string[] },
  from: string,
  opts: { anyway?: boolean; cause: string; actorId: string },
  change: () => Promise<T>,
): Promise<{ result: T; accepted: ClashFound[] }> {
  const before = new Set((await publishedClashesFor(tx, persons, from)).map((c) => c.key));
  const result = await change();
  const fresh = (await publishedClashesFor(tx, persons, from)).filter((c) => !before.has(c.key));
  if (!fresh.length) return { result, accepted: [] };
  if (!opts.anyway) {
    const shown = fresh.slice(0, 4).map((c) => c.message).join('; ');
    throw new SchedulingError(`${PUBLISHED_CLASH_REFUSAL}, this would add ${fresh.length === 1 ? 'a clash' : `${fresh.length} clashes`}: ${shown}${fresh.length > 4 ? '; …' : ''}. Change it, or confirm to go ahead anyway (the clash is then listed on the Timetables screen)`, 409);
  }
  await tx.insert(publishedClash).values(fresh.map((c) => ({
    id: randomUUID(), timetableId: c.timetableId, kind: c.kind, studentId: c.studentId, teacherId: c.teacherId,
    lessonAId: c.lessonAId, lessonBId: c.lessonBId, fromDate: c.fromDate, toDate: c.toDate, message: c.message, cause: opts.cause, acceptedBy: opts.actorId,
  })));
  return { result, accepted: fresh };
}

/** The accepted clashes of a year's published timetables, each with whether it still happens from today. */
export async function listPublishedClashes(academicYearId: string) {
  const rows = await db.select({
    c: publishedClash, timetableName: timetable.name, termName: academicTerm.name,
    student: sql<string | null>`(select name from ${user} u where u.id = ${publishedClash.studentId})`,
    teacherName: sql<string | null>`(select name from ${teacher} t where t.id = ${publishedClash.teacherId})`,
    acceptedByName: sql<string | null>`(select name from ${user} u where u.id = ${publishedClash.acceptedBy})`,
  }).from(publishedClash)
    .innerJoin(timetable, eq(timetable.id, publishedClash.timetableId))
    .innerJoin(academicTerm, eq(academicTerm.id, timetable.termId))
    .where(eq(timetable.academicYearId, academicYearId))
    .orderBy(asc(publishedClash.fromDate), asc(publishedClash.acceptedAt));
  const today = todayAtSchool();
  const out = [];
  for (const r of rows) {
    const since = maxDate(r.c.fromDate, today);
    const now = r.c.toDate !== null && r.c.toDate < since ? [] : await publishedClashesFor(db, r.c.studentId ? { studentIds: [r.c.studentId] } : { teacherIds: [r.c.teacherId!] }, since);
    const still = now.some((x) => x.timetableId === r.c.timetableId && [x.lessonAId, x.lessonBId].sort().join('|') === [r.c.lessonAId, r.c.lessonBId].sort().join('|'));
    out.push({
      id: r.c.id, timetableId: r.c.timetableId, timetableName: r.timetableName, termName: r.termName, kind: r.c.kind,
      person: r.student ?? r.teacherName ?? '', fromDate: r.c.fromDate, toDate: r.c.toDate, message: r.c.message, cause: r.c.cause,
      acceptedBy: r.acceptedByName, acceptedAt: r.c.acceptedAt, stillHappens: still,
    });
  }
  return out;
}
