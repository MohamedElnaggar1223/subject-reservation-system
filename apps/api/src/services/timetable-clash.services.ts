/**
 * Changes after publishing (FEATURES_PLAN.md F1; review flag 3). A published
 * timetable never changes, but the people in it do: a student added to a
 * group, moved into another group by a merge, moved between sections (their
 * section's lessons follow them), rolled into next year's sections, or a group
 * given another teacher. Any of these can put a student or a teacher in two
 * lessons at once in the version in force or a version already scheduled.
 *
 * Each such change is checked from the day it takes effect: the clashes it
 * would add (those already there before it are not its doing) refuse it with
 * every clash listed, unless the coordinator confirms going ahead with exactly
 * those — the refusal carries a confirmation code made from the clashes it
 * lists, and a confirmation whose list has since grown is refused with the new
 * list. Clashes gone ahead with are recorded (published_clash) and listed on
 * the Timetables screen, each followed by its group pair and slot (not one
 * version's lesson ids), so it is shown as still happening while any version
 * in force still has it.
 *
 * A version being published judges its own dated teacher changes itself: the
 * engine is given every teacher of its groups over its time
 * (`teacherOverlaps`, timetable.services), so the grid, the generator and
 * publishing refuse them as any clash.
 *
 * Concurrency (docs/features/SCHEDULING.md §17, the lock order): before
 * anything is read, the check takes every term still running from the change's
 * day FOR SHARE (a publication holds its term FOR UPDATE: a change and a
 * publication run one after the other, and the second sees the first), then
 * the teachers the change concerns FOR UPDATE in id order (two changes giving
 * one teacher two lessons at once cannot both pass); students and groups are
 * locked by the paths that move them, before this.
 */
import {
  db, timetable, timetableLesson, teachingGroup, academicTerm, publishedClash, user, teacher,
  eq, and, inArray, sql, asc,
} from '@repo/db';
import { randomUUID, createHash } from 'crypto';
import { WEEKDAY_NAMES } from '@repo/validations';
import {
  SchedulingError, addDays, minDate, maxDate, readableDate, groupMembersBetween, candidateGroupsOfStudent, groupsTaughtBetween,
  type Executor, type Tx, type TeacherInterval,
} from './scheduling-shared.services';
import { todayAtSchool } from '../lib/clock';

export type ClashFound = {
  /** The clash itself: who, which two groups, which slot — the same in every version that has it. */
  pairKey: string;
  /** The clash in one version (what a change adds, what a confirmation covers). */
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
type Lesson = { id: string; timetableId: string; groupId: string; weekday: number | null; period: number | null; length: number; groupName: string };

/** The days each published version is in force, from `from` on (a version replaced on its first day is never in force). */
export async function versionWindows(executor: Executor, from: string): Promise<Window[]> {
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

/** The identity of a clash across versions: who, the two groups, the slot. */
export const clashPairKey = (kind: string, personId: string, groupA: string, groupB: string, weekday: number, period: number) => {
  const [a, b] = [groupA, groupB].sort();
  return `${kind}|${personId}|${a}|${b}|${weekday}|${period}`;
};

async function lessonsOfWindows(executor: Executor, windows: Window[]) {
  const lessons: Lesson[] = windows.length
    ? await executor.select({ id: timetableLesson.id, timetableId: timetableLesson.timetableId, groupId: timetableLesson.groupId, weekday: timetableLesson.weekday, period: timetableLesson.period, length: timetableLesson.length, groupName: teachingGroup.name })
      .from(timetableLesson).innerJoin(teachingGroup, eq(teachingGroup.id, timetableLesson.groupId))
      .where(and(inArray(timetableLesson.timetableId, windows.map((w) => w.id)), sql`${timetableLesson.weekday} IS NOT NULL`))
    : [];
  const lessonsOf = new Map<string, Lesson[]>();
  for (const l of lessons) {
    const k = `${l.timetableId}|${l.groupId}`;
    if (!lessonsOf.has(k)) lessonsOf.set(k, []);
    lessonsOf.get(k)!.push(l);
  }
  return lessonsOf;
}

/** Two of one person's groups over two date ranges: every pair of their lessons at one time, on a day both apply. */
function judgePair(
  found: Map<string, ClashFound>, windows: Window[], lessonsOf: Map<string, Lesson[]>,
  kind: ClashFound['kind'], personId: string, person: string,
  p: { groupId: string; from: string; to: string }, q: { groupId: string; from: string; to: string },
) {
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
        const period = Math.max(la.period!, lb.period!);
        const pairKey = clashPairKey(kind, personId, la.groupId, lb.groupId, la.weekday!, period);
        const key = `${pairKey}|${w.id}`;
        const prev = found.get(key);
        if (prev && prev.fromDate <= days[0]) continue;
        // The sentence names the groups in alphabetical order.
        const [x, y] = [la, lb].sort((m, n) => m.id.localeCompare(n.id)) as [Lesson, Lesson];
        const [first, second] = [la, lb].sort((m, n) => m.groupName.localeCompare(n.groupName, 'en', { numeric: true }) || m.id.localeCompare(n.id)) as [Lesson, Lesson];
        const slot = `${WEEKDAY_NAMES[la.weekday!]} period ${period}`;
        found.set(key, {
          pairKey, key, timetableId: w.id, timetableName: w.name, kind,
          studentId: kind === 'students_busy' ? personId : null, teacherId: kind === 'teacher_busy' ? personId : null, person,
          lessonAId: x.id, lessonBId: y.id, groupA: x.groupName, groupB: y.groupName, weekday: la.weekday!, period,
          fromDate: days[0], toDate: days[1],
          message: kind === 'students_busy'
            ? `${person} would be in ${first.groupName} and ${second.groupName} at ${slot} from ${readableDate(days[0])} (${w.name})`
            : `${person} would teach ${first.groupName} and ${second.groupName} at ${slot} from ${readableDate(days[0])} (${w.name})`,
        });
      }
    }
  }
}

/** Teacher intervals without the days after each group is retired. */
async function withoutRetired(executor: Executor, taught: TeacherInterval[]) {
  const archivedOn = new Map(taught.length
    ? (await executor.select({ id: teachingGroup.id, archivedOn: teachingGroup.archivedOn }).from(teachingGroup).where(inArray(teachingGroup.id, [...new Set(taught.map((x) => x.groupId))]))).map((g) => [g.id, g.archivedOn])
    : []);
  return taught
    .map((x) => { const arch = archivedOn.get(x.groupId); return arch ? { ...x, to: minDate(x.to, addDays(arch, -1)) } : x; })
    .filter((x) => x.from <= x.to);
}

function sorted(found: Map<string, ClashFound>) {
  return [...found.values()].sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.message.localeCompare(b.message));
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
  const lessonsOf = await lessonsOfWindows(executor, windows);
  const found = new Map<string, ClashFound>();

  if (studentIds.length) {
    const names = new Map((await executor.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, studentIds))).map((u) => [u.id, u.name]));
    const groupIds = new Set<string>();
    for (const s of studentIds) for (const g of await candidateGroupsOfStudent(s, from, horizon, executor)) groupIds.add(g);
    const intervals = (await groupMembersBetween([...groupIds], from, horizon, executor)).filter((i) => studentIds.includes(i.studentId));
    for (const s of studentIds) {
      const mine = intervals.filter((i) => i.studentId === s);
      for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) judgePair(found, windows, lessonsOf, 'students_busy', s, names.get(s) ?? 'A student', mine[i]!, mine[j]!);
    }
  }
  if (teacherIds.length) {
    const names = new Map((await executor.select({ id: teacher.id, name: teacher.name }).from(teacher).where(inArray(teacher.id, teacherIds))).map((t) => [t.id, t.name]));
    for (const t of teacherIds) {
      const mine = await withoutRetired(executor, await groupsTaughtBetween(t, from, horizon, executor));
      for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) judgePair(found, windows, lessonsOf, 'teacher_busy', t, names.get(t) ?? 'A teacher', mine[i]!, mine[j]!);
    }
  }
  return sorted(found);
}

/** A short code for exactly these clashes: a confirmation carries it back, so it covers only what was shown. */
export function clashConfirmation(clashes: ClashFound[]): string {
  return createHash('sha256').update(clashes.map((c) => c.key).sort().join('\n')).digest('hex').slice(0, 12);
}

export type GoAhead = { anyway?: boolean; clashToken?: string | null; cause: string; actorId: string };

/**
 * Clashes a change or a publication would add: refused with every one listed
 * and a confirmation code, unless the coordinator confirms with the code of
 * this very list — then each is recorded. A confirmation whose list has
 * changed is refused with the new list and a new code.
 */
export async function settleClashes(tx: Tx, fresh: ClashFound[], opts: GoAhead): Promise<ClashFound[]> {
  if (!fresh.length) return [];
  const code = clashConfirmation(fresh);
  if (!opts.anyway || opts.clashToken !== code) {
    const changed = opts.anyway ? ' The clashes are not the ones confirmed (they changed since they were shown); here they are now.' : '';
    throw new SchedulingError(
      `${PUBLISHED_CLASH_REFUSAL}, this would add ${fresh.length === 1 ? 'a clash' : `${fresh.length} clashes`}: ${fresh.map((c) => c.message).join('; ')}.${changed} Change it, or confirm to go ahead anyway (the clash is then listed on the Timetables screen) [confirm ${code}]`,
      409,
    );
  }
  await tx.insert(publishedClash).values(fresh.map((c) => ({
    id: randomUUID(), timetableId: c.timetableId, kind: c.kind, studentId: c.studentId, teacherId: c.teacherId,
    lessonAId: c.lessonAId, lessonBId: c.lessonBId, fromDate: c.fromDate, toDate: c.toDate, message: c.message, cause: opts.cause, acceptedBy: opts.actorId,
  })));
  return fresh;
}

/**
 * Before a change: lock the running terms (shared) and the teachers it
 * concerns (in id order), and note the clashes already there; `settle` after
 * the change refuses or records what it added. For changes whose body is not
 * one function (the roll-over, the enrolment's follow-up of a group).
 */
export async function checkpointPublished(tx: Tx, persons: { studentIds?: string[]; teacherIds?: string[] }, from: string) {
  // Every term still running from that day, shared: a publication of any of them (FOR UPDATE on its
  // term) waits for this change, or this change waits for it and then judges the new version.
  await tx.select({ id: academicTerm.id }).from(academicTerm).where(sql`${academicTerm.endsOn} >= ${from}`).orderBy(asc(academicTerm.id)).for('share');
  const teacherIds = [...new Set(persons.teacherIds ?? [])].sort();
  if (teacherIds.length) {
    await tx.select({ id: teacher.id }).from(teacher).where(inArray(teacher.id, teacherIds)).orderBy(asc(teacher.id)).for('update');
  }
  const before = new Set((await publishedClashesFor(tx, persons, from)).map((c) => c.key));
  return {
    settle: async (opts: GoAhead) => settleClashes(tx, (await publishedClashesFor(tx, persons, from)).filter((c) => !before.has(c.key)), opts),
  };
}

/**
 * Make a change that could put people in two lessons at once in a published
 * timetable: refused with the clashes it adds, unless confirmed (`settleClashes`).
 * Runs in the caller's transaction (a refusal rolls the change back).
 */
export async function guardPublishedTimetable<T>(
  tx: Tx,
  persons: { studentIds?: string[]; teacherIds?: string[] },
  from: string,
  opts: GoAhead,
  change: () => Promise<T>,
): Promise<{ result: T; accepted: ClashFound[] }> {
  const checkpoint = await checkpointPublished(tx, persons, from);
  const result = await change();
  return { result, accepted: await checkpoint.settle(opts) };
}

/**
 * The accepted clashes of a year's published timetables, each with whether it
 * still happens from today — in any version in force from then, by its group
 * pair and slot (a republished version that keeps it keeps it listed).
 */
export async function listPublishedClashes(academicYearId: string) {
  const rows = await db.select({
    c: publishedClash, timetableName: timetable.name, termName: academicTerm.name,
    student: sql<string | null>`(select name from ${user} u where u.id = ${publishedClash.studentId})`,
    teacherName: sql<string | null>`(select name from ${teacher} t where t.id = ${publishedClash.teacherId})`,
    acceptedByName: sql<string | null>`(select name from ${user} u where u.id = ${publishedClash.acceptedBy})`,
    groupA: sql<string>`(select group_id from ${timetableLesson} l where l.id = ${publishedClash.lessonAId})`,
    groupB: sql<string>`(select group_id from ${timetableLesson} l where l.id = ${publishedClash.lessonBId})`,
    weekday: sql<number>`(select weekday from ${timetableLesson} l where l.id = ${publishedClash.lessonAId})`,
    period: sql<number>`greatest((select period from ${timetableLesson} l where l.id = ${publishedClash.lessonAId}), (select period from ${timetableLesson} l where l.id = ${publishedClash.lessonBId}))`,
  }).from(publishedClash)
    .innerJoin(timetable, eq(timetable.id, publishedClash.timetableId))
    .innerJoin(academicTerm, eq(academicTerm.id, timetable.termId))
    .where(eq(timetable.academicYearId, academicYearId))
    .orderBy(asc(publishedClash.fromDate), asc(publishedClash.acceptedAt));
  const today = todayAtSchool();
  const out = [];
  for (const r of rows) {
    const since = maxDate(r.c.fromDate, today);
    const personId = r.c.studentId ?? r.c.teacherId!;
    const pairKey = clashPairKey(r.c.kind, personId, r.groupA, r.groupB, Number(r.weekday), Number(r.period));
    const now = await publishedClashesFor(db, r.c.studentId ? { studentIds: [r.c.studentId] } : { teacherIds: [r.c.teacherId!] }, since);
    out.push({
      id: r.c.id, timetableId: r.c.timetableId, timetableName: r.timetableName, termName: r.termName, kind: r.c.kind,
      person: r.student ?? r.teacherName ?? '', fromDate: r.c.fromDate, toDate: r.c.toDate, message: r.c.message, cause: r.c.cause,
      acceptedBy: r.acceptedByName, acceptedAt: r.c.acceptedAt, stillHappens: now.some((x) => x.pairKey === pairKey),
    });
  }
  return out;
}
