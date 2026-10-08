/**
 * Teaching groups (FEATURES_PLAN.md F1): who is taught together, by whom, and
 * how many periods a week.
 *
 * - Formed from the year's course enrolment (F0b's `getTeachingDemand`): one
 *   group per subject — or unit, when the enrolments are per unit (the
 *   reservations rework, RESERVATIONS_REWORK.md §10) — and teacher, the
 *   students taught in school, with the offer teacher's delivery (online:
 *   timetabled without a room; a provider's group has no lessons) — self-study
 *   forms no group. Forming is a preview, then a commit; running it again
 *   adds only the students not yet in a group of the subject or unit, and takes
 *   out of formed groups the students no longer enrolled in school.
 * - The group follows the enrolment (`followEnrolments`, called by every path
 *   that changes an enrolment's teacher or mode: a line's teacher, a teacher
 *   replaced on an offer, the enrolment screen): self-study leaves the group; a
 *   new teacher takes the whole group when every member now has them, else the
 *   student moves to that teacher's group of the subject or unit; with none,
 *   or a move that would clash in a published timetable, the student stays and
 *   the coordinator sees them (`groupsWaiting`). "No preference" lines get
 *   their teacher here (`assignGroupTeacher`).
 * - From homeroom sections, for a subject a section is taught together (a
 *   national subject, PE): one group per section, whose students are the
 *   section's on each date.
 * - Staff add and take out students, split a group (some students into new
 *   groups), merge groups, and retire one; history is kept (a membership ends,
 *   it is never deleted). A student is in one open group per unit a year when
 *   the group has a unit, else per subject (the enrolment's two keys; the
 *   database holds both), and a move cannot be dated before the student
 *   joined their current group (the lesson of STATE_AUDIT ST-16).
 * - Locks (docs/features/SCHEDULING.md §17): students first (FOR NO KEY
 *   UPDATE, id order, as RESERVATIONS.md §2.1 begins), then the groups (FOR
 *   UPDATE, id order), then the member rows; the published-timetable check
 *   after them (running terms shared, then teachers). A path that arrives
 *   holding lines and enrolments (the follow-up) takes the groups after them.
 * - Draft timetables of the year follow a group's weekly periods: its lesson
 *   cards are added or taken away (`syncDraftCards`). Published timetables
 *   never change.
 */

import {
  db, teachingGroup, teachingGroupMember, teachingGroupTeacher, timetable, timetableLesson, academicYear, academicTerm, subject, teacher, section,
  courseEnrolment, user, room, subjectTeacher, examUnit, registration, registrationSession, sessionOfferItem, sessionOfferItemUnit, sessionOffer,
  sessionOfferTeacher, sessionOfferItemTeacher, eq, and, or, inArray, isNull, sql, asc, ne,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  cardsFor, gradeInAcademicYear,
  type FormGroupsType, type CreateSectionGroupsType, type CreateGroupType, type UpdateGroupType, type AddGroupMembersType,
  type EndGroupMembersType, type SplitGroupType, type MergeGroupsType, type ArchiveGroupType, type AssignGroupTeacherType,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { getTeachingDemand, upsertEnrolments, type EnrolmentChange } from './enrolment.services';
import {
  SchedulingError, isUniqueViolation, addDays, readableDate, groupMembersBetween, peakSize, teachersOn, type Tx, type Executor,
} from './scheduling-shared.services';
import { todayAtSchool } from '../lib/clock';
import { guardPublishedTimetable, checkpointPublished } from './timetable-clash.services';

/**
 * The last day of a membership that ends on `lastDay`: a membership that has
 * not begun by then ends the day before its first day — an empty stay, kept as
 * history, with no day the student was never there (unlike a clamp to the
 * start day: STATE_AUDIT SO-9).
 */
const lastDayOf = (startedOn: string, lastDay: string) => (lastDay < startedOn ? addDays(startedOn, -1) : lastDay);

async function yearOrThrow(id: string, executor: Executor = db) {
  const [y] = await executor.select().from(academicYear).where(eq(academicYear.id, id));
  if (!y) throw new SchedulingError('Academic year not found — set the year up on the Academic year screen first', 404);
  return y;
}

/** The day a change made now takes effect in a year: its first day before it starts, today while it runs. */
function defaultStart(y: { startsOn: string; endsOn: string }, asked?: string) {
  if (asked) {
    if (asked < y.startsOn || asked > y.endsOn) throw new SchedulingError(`The date falls inside the school year (${readableDate(y.startsOn)} – ${readableDate(y.endsOn)})`);
    return asked;
  }
  const today = todayAtSchool();
  return today < y.startsOn ? y.startsOn : today > y.endsOn ? y.startsOn : today;
}

async function groupOrThrow(id: string, executor: Executor = db, lock = false) {
  const q = executor.select().from(teachingGroup).where(eq(teachingGroup.id, id));
  const [g] = lock ? await q.for('update') : await q;
  if (!g) throw new SchedulingError('Teaching group not found', 404);
  return g;
}

async function assertTeacher(tx: Executor, teacherId: string | null | undefined) {
  if (!teacherId) return null;
  const [t] = await tx.select({ id: teacher.id, name: teacher.name, isActive: teacher.isActive }).from(teacher).where(eq(teacher.id, teacherId));
  if (!t) throw new SchedulingError('Teacher not found', 404);
  if (!t.isActive) throw new SchedulingError(`${t.name} is inactive — bring them back on the Teachers page first`);
  return t;
}

/** A group's teacher teaches its subject (as the Subjects page and the enrolment would link them). */
async function linkTeacherToSubject(tx: Tx, teacherId: string | null, subjectId: string | null) {
  if (!teacherId || !subjectId) return false;
  const [have] = await tx.select({ id: subjectTeacher.id }).from(subjectTeacher)
    .where(and(eq(subjectTeacher.teacherId, teacherId), eq(subjectTeacher.subjectId, subjectId)));
  if (have) return false;
  await tx.insert(subjectTeacher).values({ id: randomUUID(), teacherId, subjectId });
  return true;
}

/**
 * Who teaches a group from a day on: the open row ends the day before (an
 * empty stay if it began that day) and a new one starts, so earlier weeks keep
 * their teacher; the group's own teacher_id follows the latest row. A change
 * dated before the current teacher began is refused (it would rewrite a week
 * already given to them).
 */
async function setGroupTeacher(tx: Tx, groupId: string, teacherId: string | null, from: string, reason: string, actorId: string) {
  const [g] = await tx.select().from(teachingGroup).where(eq(teachingGroup.id, groupId)).for('update');
  const rows = await tx.select().from(teachingGroupTeacher).where(eq(teachingGroupTeacher.groupId, groupId)).for('update');
  const open = rows.find((r) => r.endedOn === null) ?? null;
  if (open && (open.teacherId ?? null) === (teacherId ?? null)) return false;
  if (!rows.length && g!.teacherId && (g!.teacherId ?? null) !== (teacherId ?? null)) {
    // A group whose teacher was never dated: its teacher so far taught it from the year's start.
    const [y] = await tx.select({ startsOn: academicYear.startsOn }).from(academicYear).where(eq(academicYear.id, g!.academicYearId));
    await tx.insert(teachingGroupTeacher).values({
      id: randomUUID(), groupId, teacherId: g!.teacherId, startedOn: y!.startsOn, endedOn: lastDayOf(y!.startsOn, addDays(from, -1)), reason: 'The teacher before the first dated change', setBy: actorId,
    });
  }
  if (open) {
    if (from < open.startedOn) {
      throw new SchedulingError(`The new teacher's first day must be on or after ${readableDate(open.startedOn)}, when the current teacher began`, 409);
    }
    await tx.update(teachingGroupTeacher).set({ endedOn: lastDayOf(open.startedOn, addDays(from, -1)) }).where(eq(teachingGroupTeacher.id, open.id));
  }
  if (teacherId || open || rows.length) {
    await tx.insert(teachingGroupTeacher).values({ id: randomUUID(), groupId, teacherId, startedOn: from, reason, setBy: actorId });
  }
  await tx.update(teachingGroup).set({ teacherId, updatedAt: new Date() }).where(eq(teachingGroup.id, groupId));
  return true;
}

async function assertRoom(tx: Executor, roomId: string | null | undefined) {
  if (!roomId) return;
  const [r] = await tx.select({ name: room.name, isActive: room.isActive }).from(room).where(eq(room.id, roomId));
  if (!r) throw new SchedulingError('Room not found', 404);
  if (!r.isActive) throw new SchedulingError(`${r.name} is out of use`);
}

// ─── Keys and locks ──────────────────────────────────────────────────────────

/**
 * What a membership is one of, as an enrolment is (RESERVATIONS_REWORK.md
 * §3.2, §10): its unit when the group has one, else its subject. A unit's
 * group and the subject's group are two keys: a student may hold both (an
 * enrolment from before the rework, subject-level, beside a unit's; F0b's
 * check flags it).
 */
export const memberKey = (r: { subjectId: string | null; unitId?: string | null }) =>
  (r.unitId ? `u:${r.unitId}` : r.subjectId ? `s:${r.subjectId}` : null);

/** The member rows of one key (open or not: the caller adds the rest of the condition). */
const sameKey = (r: { subjectId: string | null; unitId?: string | null }) =>
  (r.unitId
    ? eq(teachingGroupMember.unitId, r.unitId)
    : and(eq(teachingGroupMember.subjectId, r.subjectId!), isNull(teachingGroupMember.unitId)));

/**
 * The locks a membership change takes before it reads anything it decides on
 * (docs/features/SCHEDULING.md §17): the students FOR NO KEY UPDATE in id
 * order — first, as RESERVATIONS.md §2.1's order begins (a reservation, a
 * leaving, an enrolment run hold them too) — then the groups FOR UPDATE in id
 * order. The member rows come after, in the change itself.
 */
async function lockMembershipChange(tx: Tx, opts: { studentIds?: string[]; groupIds?: string[] }) {
  const studentIds = [...new Set(opts.studentIds ?? [])].sort();
  const groupIds = [...new Set(opts.groupIds ?? [])].sort();
  if (studentIds.length) await tx.select({ id: user.id }).from(user).where(inArray(user.id, studentIds)).orderBy(asc(user.id)).for('no key update');
  if (groupIds.length) await tx.select({ id: teachingGroup.id }).from(teachingGroup).where(inArray(teachingGroup.id, groupIds)).orderBy(asc(teachingGroup.id)).for('update');
}

/** A provider (an external team the links sheet names) teaches outside the timetable: its groups have no lessons. */
async function isProvider(executor: Executor, teacherId: string | null | undefined) {
  if (!teacherId) return false;
  const [t] = await executor.select({ kind: teacher.kind }).from(teacher).where(eq(teacher.id, teacherId));
  return t?.kind === 'provider';
}

/** A version in force or scheduled, from a day, that holds lessons of this group (published, so they stay). */
async function publishedLessonsOf(executor: Executor, groupId: string, from: string) {
  const [v] = await executor.select({ name: timetable.name }).from(timetableLesson)
    .innerJoin(timetable, eq(timetable.id, timetableLesson.timetableId))
    .innerJoin(academicTerm, eq(academicTerm.id, timetable.termId))
    .where(and(eq(timetableLesson.groupId, groupId), eq(timetable.status, 'published'), sql`${academicTerm.endsOn} >= ${from}`, sql`${timetableLesson.weekday} IS NOT NULL`))
    .limit(1);
  return v?.name ?? null;
}

/**
 * A group's teacher changed from a day (F1's dated change): checked against
 * the published timetables first (refused with the clashes, or recorded when
 * the coordinator confirms exactly those), then the cover arranged from that
 * day judged again (a new teacher who now covers their own lesson, or is busy
 * at a cover they give, loses it; a cover for a teacher no longer the lesson's
 * goes). A provider teaches outside the timetable: a group with published
 * lessons from that day is not given to one. Returns the clashes gone ahead
 * with and the covers lost (the caller tells their people after its commit).
 */
async function changeGroupTeacher(
  tx: Tx, g: { id: string; name: string; teacherId: string | null; subjectId: string | null },
  teacherId: string | null, from: string, reason: string, actorId: string, ctx: AuditContext | undefined,
  opts: { anyway?: boolean; clashToken?: string | null; cause?: string },
) {
  if (await isProvider(tx, teacherId)) {
    const version = await publishedLessonsOf(tx, g.id, from);
    if (version) {
      throw new SchedulingError(`${g.name} has lessons in ${version}: a provider teaches outside the timetable — retire the group from that day and form one for the provider, or publish a version without its lessons first`, 409);
    }
  }
  const [t] = teacherId ? await tx.select({ name: teacher.name }).from(teacher).where(eq(teacher.id, teacherId)) : [];
  const { accepted } = await guardPublishedTimetable(tx, { teacherIds: teacherId ? [teacherId] : [] }, from,
    { anyway: opts.anyway, clashToken: opts.clashToken, cause: opts.cause ?? `${g.name}: teacher changed to ${t?.name ?? 'nobody'}`, actorId },
    () => setGroupTeacher(tx, g.id, teacherId, from, reason, actorId));
  const cover = await import('./cover.services');
  const coversLost = await cover.recheckCovers(tx, await cover.liveCoversFrom(tx, { groupIds: [g.id], teacherIds: teacherId ? [teacherId] : [], from }),
    actorId, `${g.name}: teacher changed from ${readableDate(from)}`, ctx);
  return { accepted, coversLost };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** The year's groups with their teacher, subject, section, size today and weekly load. */
export async function listGroups(academicYearId: string) {
  const y = await yearOrThrow(academicYearId);
  const groups = await db.query.teachingGroup.findMany({
    where: (g, { eq: eqOp }) => eqOp(g.academicYearId, y.id),
    with: {
      subject: { columns: { id: true, name: true, code: true, qualificationLevel: true } },
      unit: { columns: { id: true, code: true, shortCode: true, title: true } },
      teacher: { columns: { id: true, name: true, isActive: true, kind: true } },
      section: { columns: { id: true, name: true, grade: true, roomId: true } },
      room: { columns: { id: true, name: true } },
    },
    orderBy: (g, { asc: a }) => [a(g.name)],
  });
  const today = defaultStart(y);
  const members = await groupMembersBetween(groups.map((g) => g.id), today, today);
  const sizeOf = new Map<string, number>();
  for (const m of members) sizeOf.set(m.groupId, (sizeOf.get(m.groupId) ?? 0) + 1);
  return {
    academicYear: { id: y.id, startYear: y.startYear, startsOn: y.startsOn, endsOn: y.endsOn },
    asOf: today,
    groups: groups.map((g) => ({
      ...g,
      archived: !!g.archivedOn && g.archivedOn <= today,
      size: sizeOf.get(g.id) ?? 0,
      // A provider's group has no lessons (it is taught outside the timetable).
      providerTaught: g.teacher?.kind === 'provider',
      cards: g.teacher?.kind === 'provider' ? 0 : cardsFor(g.weeklyPeriods, g.doublePeriods).length,
    })),
  };
}

/** One group: its students today (with section), its history, its splits. */
export async function getGroup(id: string) {
  const g = await db.query.teachingGroup.findFirst({
    where: (x, { eq: eqOp }) => eqOp(x.id, id),
    with: {
      subject: { columns: { id: true, name: true, code: true } },
      unit: { columns: { id: true, code: true, shortCode: true, title: true } },
      teacher: { columns: { id: true, name: true, kind: true } },
      section: { columns: { id: true, name: true, grade: true } },
      room: { columns: { id: true, name: true } },
      academicYear: { columns: { id: true, startYear: true, startsOn: true, endsOn: true } },
    },
  });
  if (!g) throw new SchedulingError('Teaching group not found', 404);
  const today = defaultStart(g.academicYear);
  const now = await groupMembersBetween([g.id], today, today);
  const ids = [...new Set(now.map((m) => m.studentId))];
  const students = ids.length
    ? await db.select({ id: user.id, name: user.name, studentCode: user.studentId, cohortYear: user.cohortYear }).from(user).where(inArray(user.id, ids)).orderBy(asc(user.name))
    : [];
  const history = g.kind === 'section'
    ? []
    : await db
      .select({ id: teachingGroupMember.id, studentId: teachingGroupMember.studentId, name: user.name, startedOn: teachingGroupMember.startedOn, endedOn: teachingGroupMember.endedOn, endReason: teachingGroupMember.endReason })
      .from(teachingGroupMember).innerJoin(user, eq(user.id, teachingGroupMember.studentId))
      .where(eq(teachingGroupMember.groupId, g.id))
      .orderBy(asc(user.name), asc(teachingGroupMember.startedOn));
  return {
    ...g,
    asOf: today,
    students: students.map((s) => ({ ...s, grade: gradeInAcademicYear(s.cohortYear, g.academicYear.startYear) })),
    history,
  };
}

// ─── Forming from the course enrolment ───────────────────────────────────────

type Planned = {
  groupId: string | null;
  name: string;
  subject: { id: string; name: string; code: string };
  /** The unit taught, when the enrolments are per unit. */
  unit: { id: string; code: string } | null;
  teacher: { id: string; name: string; kind: string } | null;
  /** How the offer teaches it: online is timetabled without a room. */
  delivery: 'in_school' | 'online';
  /** A provider's group has no lessons. */
  providerTaught: boolean;
  action: 'create' | 'update' | 'unchanged';
  adding: { studentId: string; name: string; section: string | null; enrolmentId: string; startedOn: string }[];
  removing: { studentId: string; name: string; memberId: string; why: string }[];
  total: number;
};

/**
 * The year's groups from its course enrolment: a group per subject — or per
 * unit, for enrolments per unit — and teacher of the in-school enrolments,
 * taught as the offer gives it (in school, online; a provider's group has no
 * lessons); students already in a group of the subject or unit stay where
 * they are (a split or a merge made by hand is kept: those whose enrolled
 * teacher differs are listed, with the group they would move to); a formed
 * group's student with no in-school enrolment of its subject or unit any more
 * is taken out. Preview (commit false) writes nothing; commit is idempotent
 * and one at a time per year. A group is made only for students to put in it.
 */
export async function formGroups(data: FormGroupsType, actorId: string, ctx?: AuditContext) {
  const y = await yearOrThrow(data.academicYearId);
  const startsOn = defaultStart(y, data.startsOn);
  const weeklyPeriods = data.weeklyPeriods ?? 4;
  const run = async (tx: Tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'teaching-groups:' + y.id}))`);
    const demand = await getTeachingDemand(y.id);
    const enrolments = await tx
      .select({ id: courseEnrolment.id, studentId: courseEnrolment.studentId, subjectId: courseEnrolment.subjectId, unitId: courseEnrolment.unitId, teacherId: courseEnrolment.teacherId, startedOn: courseEnrolment.startedOn })
      .from(courseEnrolment)
      .where(and(eq(courseEnrolment.academicYearId, y.id), isNull(courseEnrolment.endedOn), eq(courseEnrolment.mode, 'in_school')));
    const enrolmentOf = new Map(enrolments.map((e) => [`${e.studentId}|${memberKey(e)}`, e]));
    const groups = await tx.select().from(teachingGroup).where(and(eq(teachingGroup.academicYearId, y.id), isNull(teachingGroup.archivedOn)));
    const open = await tx
      .select({ id: teachingGroupMember.id, groupId: teachingGroupMember.groupId, studentId: teachingGroupMember.studentId, subjectId: teachingGroupMember.subjectId, unitId: teachingGroupMember.unitId, name: user.name })
      .from(teachingGroupMember).innerJoin(user, eq(user.id, teachingGroupMember.studentId))
      .where(and(eq(teachingGroupMember.academicYearId, y.id), isNull(teachingGroupMember.endedOn)));
    const openOf = new Map(open.filter((m) => memberKey(m)).map((m) => [`${m.studentId}|${memberKey(m)}`, m]));
    const sizeNow = new Map<string, number>();
    for (const m of open) sizeNow.set(m.groupId, (sizeNow.get(m.groupId) ?? 0) + 1);
    const groupTeacherNow = await teachersOn(groups.map((g) => g.id), startsOn, tx);
    const teacherOfGroup = (g: { id: string; teacherId: string | null }) => (groupTeacherNow.has(g.id) ? groupTeacherNow.get(g.id)! : g.teacherId) ?? null;
    const keyOfGroup = (g: { subjectId: string | null; unitId: string | null }) => memberKey(g);

    const plans: Planned[] = [];
    const teacherDiffers: {
      studentId: string; name: string; subject: string; group: string; groupId: string; enrolledWith: string | null; enrolledTeacherId: string | null;
      /** The live group of their enrolled teacher it would move to (the smallest), or null: none yet. */
      target: { id: string; name: string } | null;
    }[] = [];
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const smallestOf = (key: string | null, teacherId: string | null) => groups
      .filter((g) => g.kind !== 'section' && keyOfGroup(g) === key && teacherOfGroup(g) === (teacherId ?? null))
      .sort((a, b) => (sizeNow.get(a.id) ?? 0) - (sizeNow.get(b.id) ?? 0) || a.name.localeCompare(b.name))[0] ?? null;
    for (const d of demand) {
      const key = memberKey(d)!;
      const target = smallestOf(key, d.teacherId);
      const label = `${d.subjectName}${d.unitId ? ` ${d.unitName ?? d.unitCode}` : ''}`;
      const oneTeacher = new Set(demand.filter((x) => memberKey(x) === key).map((x) => x.teacherId)).size === 1;
      const name = target?.name
        ?? (d.teacherId ? (oneTeacher ? label : `${label} — ${d.teacherName}`) : `${label} (no teacher yet)`);
      const adding: Planned['adding'] = [];
      for (const s of d.students) {
        const m = openOf.get(`${s.studentId}|${key}`);
        if (m) {
          const g = groupById.get(m.groupId);
          if (g && teacherOfGroup(g) !== (d.teacherId ?? null)) {
            const to = smallestOf(key, d.teacherId);
            teacherDiffers.push({
              studentId: s.studentId, name: s.name, subject: label, group: g.name, groupId: g.id, enrolledWith: d.teacherName, enrolledTeacherId: d.teacherId,
              target: to ? { id: to.id, name: to.name } : null,
            });
          }
          continue;
        }
        const e = enrolmentOf.get(`${s.studentId}|${key}`)!;
        adding.push({ studentId: s.studentId, name: s.name, section: s.section, enrolmentId: e.id, startedOn: e.startedOn > startsOn ? e.startedOn : startsOn });
      }
      // A group is made only for students to put in it.
      if (!target && !adding.length) continue;
      plans.push({
        groupId: target?.id ?? null,
        name,
        subject: { id: d.subjectId, name: d.subjectName, code: d.subjectCode },
        unit: d.unitId ? { id: d.unitId, code: d.unitName ?? d.unitCode ?? '' } : null,
        teacher: d.teacherId ? { id: d.teacherId, name: d.teacherName ?? '', kind: d.teacherKind ?? 'person' } : null,
        delivery: (target?.delivery as 'in_school' | 'online' | undefined) ?? d.delivery,
        providerTaught: d.teacherKind === 'provider',
        action: target ? (adding.length ? 'update' : 'unchanged') : 'create',
        adding,
        removing: [],
        total: (target ? sizeNow.get(target.id) ?? 0 : 0) + adding.length,
      });
    }
    // Formed groups' students no longer taught the subject or unit in school.
    for (const g of groups.filter((x) => x.kind === 'enrolment')) {
      const leaving = open.filter((m) => m.groupId === g.id && !enrolmentOf.has(`${m.studentId}|${memberKey(m)}`));
      if (!leaving.length) continue;
      let plan = plans.find((p) => p.groupId === g.id);
      if (!plan) {
        const [s] = await tx.select({ id: subject.id, name: subject.name, code: subject.code }).from(subject).where(eq(subject.id, g.subjectId!));
        const [u] = g.unitId ? await tx.select({ id: examUnit.id, code: examUnit.code, shortCode: examUnit.shortCode }).from(examUnit).where(eq(examUnit.id, g.unitId)) : [];
        const tid = teacherOfGroup(g);
        const [t] = tid ? await tx.select({ id: teacher.id, name: teacher.name, kind: teacher.kind }).from(teacher).where(eq(teacher.id, tid)) : [];
        plan = {
          groupId: g.id, name: g.name, subject: s!, unit: u ? { id: u.id, code: u.shortCode ?? u.code } : null, teacher: t ?? null,
          delivery: g.delivery as 'in_school' | 'online', providerTaught: t?.kind === 'provider', action: 'update', adding: [], removing: [], total: sizeNow.get(g.id) ?? 0,
        };
        plans.push(plan);
      }
      plan.action = 'update';
      for (const m of leaving) plan.removing.push({ studentId: m.studentId, name: m.name, memberId: m.id, why: 'no longer enrolled in school in this subject' });
      plan.total -= leaving.length;
    }
    plans.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

    let created = 0;
    let added = 0;
    let removed = 0;
    let accepted: { message: string }[] = [];
    if (data.commit) {
      // The students it moves, then the groups it adds to, each in id order (§17): a change to the
      // same students or groups elsewhere waits, then sees this one.
      await lockMembershipChange(tx, {
        studentIds: plans.flatMap((p) => p.adding.map((a) => a.studentId)),
        groupIds: plans.filter((p) => p.groupId && p.action !== 'unchanged').map((p) => p.groupId!),
      });
      // Read again under the locks: a student another change put in a group of the key meanwhile (a
      // move, the enrolment's follow-up) stays there — this run does not add them a second time.
      const addingIds = [...new Set(plans.flatMap((p) => p.adding.map((a) => a.studentId)))];
      if (addingIds.length) {
        const nowOpen = await tx.select({ studentId: teachingGroupMember.studentId, subjectId: teachingGroupMember.subjectId, unitId: teachingGroupMember.unitId })
          .from(teachingGroupMember)
          .where(and(inArray(teachingGroupMember.studentId, addingIds), eq(teachingGroupMember.academicYearId, y.id), isNull(teachingGroupMember.endedOn)));
        const grouped = new Set(nowOpen.map((m) => `${m.studentId}|${memberKey(m)}`));
        for (const p of plans) {
          const key = memberKey({ subjectId: p.subject.id, unitId: p.unit?.id ?? null });
          const before = p.adding.length;
          p.adding = p.adding.filter((a) => !grouped.has(`${a.studentId}|${key}`));
          p.total -= before - p.adding.length;
          if (p.action === 'update' && !p.adding.length && !p.removing.length) p.action = 'unchanged';
          if (p.action === 'create' && !p.adding.length) p.action = 'unchanged';
        }
      }
      const commit = async () => {
        const touched: string[] = [];
        for (const p of plans) {
          if (p.action === 'unchanged') continue;
          let groupId = p.groupId;
          if (!groupId) {
            groupId = randomUUID();
            await tx.insert(teachingGroup).values({
              id: groupId, academicYearId: y.id, name: uniqueName(p.name, groups.map((g) => g.name)), subjectId: p.subject.id, unitId: p.unit?.id ?? null,
              teacherId: p.teacher?.id ?? null, delivery: p.delivery,
              // A provider teaches outside the timetable: its group asks for no periods.
              kind: 'enrolment', weeklyPeriods: p.providerTaught ? 0 : weeklyPeriods, doublePeriods: 0, createdBy: actorId,
            });
            if (p.teacher) await tx.insert(teachingGroupTeacher).values({ id: randomUUID(), groupId, teacherId: p.teacher.id, startedOn: startsOn, reason: 'Formed from the course enrolment', setBy: actorId });
            groups.push({ name: p.name } as typeof groups[number]);
            p.groupId = groupId;
            created++;
          }
          if (p.adding.length) {
            await tx.insert(teachingGroupMember).values(p.adding.map((a) => ({
              id: randomUUID(), groupId: groupId!, studentId: a.studentId, academicYearId: y.id, subjectId: p.subject.id, unitId: p.unit?.id ?? null,
              enrolmentId: a.enrolmentId, startedOn: a.startedOn, addedBy: actorId,
            })));
            added += p.adding.length;
          }
          for (const r of p.removing) {
            const [m] = await tx.select({ startedOn: teachingGroupMember.startedOn }).from(teachingGroupMember).where(eq(teachingGroupMember.id, r.memberId)).for('update');
            const endedOn = lastDayOf(m!.startedOn, addDays(startsOn, -1));
            await tx.update(teachingGroupMember).set({ endedOn, endReason: 'No longer enrolled in school in this subject', endedBy: actorId }).where(eq(teachingGroupMember.id, r.memberId));
            removed++;
          }
          touched.push(groupId!);
        }
        if (touched.length) {
          await syncDraftCards(tx, touched);
        }
      };
      const adding = plans.flatMap((p) => p.adding.map((a) => a.studentId));
      accepted = (await guardPublishedTimetable(tx, { studentIds: adding }, startsOn, { anyway: data.anyway, clashToken: data.clashToken, cause: 'Groups formed from the course enrolment', actorId }, commit)).accepted;
      if (created || added || removed) {
        await logAction(actorId, 'TEACHING_GROUPS_FORMED', 'academic_year', y.id, null, { created, added, removed, startsOn, clashesAccepted: accepted.map((c) => c.message) }, ctx, tx);
      }
    }
    return { academicYearId: y.id, startsOn, committed: data.commit, groups: plans, teacherDiffers, created, added, removed, clashesAccepted: accepted.map((c) => c.message) };
  };
  try {
    return await db.transaction(run);
  } catch (err) {
    if (isUniqueViolation(err)) throw new SchedulingError('Someone changed these groups at the same moment — run it again', 409);
    throw err;
  }
}

function uniqueName(name: string, taken: string[]) {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) if (!lower.has(`${name} (${i})`.toLowerCase())) return `${name} (${i})`;
}

// ─── Section groups, and groups made by hand ─────────────────────────────────

export async function createSectionGroups(data: CreateSectionGroupsType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const y = await yearOrThrow(data.academicYearId, tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'teaching-groups:' + y.id}))`);
    await assertTeacher(tx, data.teacherId);
    await assertRoom(tx, data.roomId);
    if (data.subjectId) {
      const [s] = await tx.select({ id: subject.id }).from(subject).where(eq(subject.id, data.subjectId));
      if (!s) throw new SchedulingError('Subject not found', 404);
    }
    const sections = await tx.select().from(section).where(inArray(section.id, data.sectionIds)).orderBy(asc(section.name));
    if (sections.length !== new Set(data.sectionIds).size) throw new SchedulingError('One or more sections were not found', 404);
    const wrongYear = sections.filter((s) => s.academicYearId !== y.id);
    if (wrongYear.length) throw new SchedulingError(`${wrongYear.map((s) => s.name).join(', ')} belong to another academic year`);
    const existing = await tx.select({ name: teachingGroup.name }).from(teachingGroup).where(and(eq(teachingGroup.academicYearId, y.id), isNull(teachingGroup.archivedOn)));
    const taken = new Set(existing.map((e) => e.name.toLowerCase()));
    const made: { id: string; name: string }[] = [];
    const skipped: string[] = [];
    for (const s of sections) {
      const name = `${data.name} ${s.name}`;
      if (taken.has(name.toLowerCase())) { skipped.push(name); continue; }
      const id = randomUUID();
      await tx.insert(teachingGroup).values({
        id, academicYearId: y.id, name, subjectId: data.subjectId ?? null, teacherId: data.teacherId ?? null, kind: 'section', sectionId: s.id,
        weeklyPeriods: data.weeklyPeriods, doublePeriods: data.doublePeriods, roomType: data.roomType ?? null, roomFeatures: data.roomFeatures ?? [], roomId: data.roomId ?? null,
        createdBy: actorId,
      });
      if (data.teacherId) await tx.insert(teachingGroupTeacher).values({ id: randomUUID(), groupId: id, teacherId: data.teacherId, startedOn: defaultStart(y), reason: 'Group made', setBy: actorId });
      made.push({ id, name });
    }
    const linked = await linkTeacherToSubject(tx, data.teacherId ?? null, data.subjectId ?? null);
    if (made.length) {
      await syncDraftCards(tx, made.map((m) => m.id));
      await logAction(actorId, 'TEACHING_GROUP_CREATED', 'academic_year', y.id, null, { kind: 'section', groups: made, skipped, teacherLinkedToSubject: linked }, ctx, tx);
    }
    return { created: made, skipped };
  });
}

export async function createGroup(data: CreateGroupType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      const y = await yearOrThrow(data.academicYearId, tx);
      if (data.studentIds?.length) await lockMembershipChange(tx, { studentIds: data.studentIds });
      await assertTeacher(tx, data.teacherId);
      await assertRoom(tx, data.roomId);
      if (data.subjectId) {
        const [s] = await tx.select({ id: subject.id }).from(subject).where(eq(subject.id, data.subjectId));
        if (!s) throw new SchedulingError('Subject not found', 404);
      }
      if (data.unitId) {
        if (!data.subjectId) throw new SchedulingError('A group of a unit names its subject too');
        const [u] = await tx.select({ id: examUnit.id }).from(examUnit).where(eq(examUnit.id, data.unitId));
        if (!u) throw new SchedulingError('Unit not found', 404);
      }
      const online = data.delivery === 'online';
      if (online && (data.roomId || data.roomType)) throw new SchedulingError('An online group takes no room: leave its room needs empty');
      const provider = await isProvider(tx, data.teacherId);
      const id = randomUUID();
      await tx.insert(teachingGroup).values({
        id, academicYearId: y.id, name: data.name, subjectId: data.subjectId ?? null, unitId: data.unitId ?? null, teacherId: data.teacherId ?? null, kind: 'manual',
        delivery: data.delivery ?? 'in_school',
        // A provider teaches outside the timetable: its group asks for no periods.
        weeklyPeriods: provider ? 0 : data.weeklyPeriods, doublePeriods: provider ? 0 : data.doublePeriods,
        roomType: data.roomType ?? null, roomFeatures: data.roomFeatures ?? [], roomId: data.roomId ?? null,
        createdBy: actorId,
      });
      if (data.teacherId) await tx.insert(teachingGroupTeacher).values({ id: randomUUID(), groupId: id, teacherId: data.teacherId, startedOn: defaultStart(y, data.startsOn), reason: 'Group made', setBy: actorId });
      const linked = await linkTeacherToSubject(tx, data.teacherId ?? null, data.subjectId ?? null);
      let moved = 0;
      if (data.studentIds?.length) moved = (await addMembersTx(tx, id, data.studentIds, defaultStart(y, data.startsOn), actorId)).moved;
      await syncDraftCards(tx, [id]);
      await logAction(actorId, 'TEACHING_GROUP_CREATED', 'teaching_group', id, null, { ...data, teacherLinkedToSubject: linked, moved }, ctx, tx);
      return { id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new SchedulingError(`That year already has a group named ${data.name}`, 409);
    throw err;
  }
}

export async function updateGroup(id: string, data: UpdateGroupType, actorId: string, ctx?: AuditContext) {
  let coversLost: string[] = [];
  try {
    const result = await db.transaction(async (tx) => {
      const g = await groupOrThrow(id, tx, true);
      if (g.archivedOn) throw new SchedulingError('This group is retired — it is kept as history', 409);
      if (data.teacherId !== undefined) await assertTeacher(tx, data.teacherId);
      if (data.roomId) await assertRoom(tx, data.roomId);
      const weeklyPeriods = data.weeklyPeriods ?? g.weeklyPeriods;
      const doublePeriods = data.doublePeriods ?? g.doublePeriods;
      if (doublePeriods * 2 > weeklyPeriods) throw new SchedulingError('Doubles take two periods each: they cannot exceed the weekly periods');
      const delivery = data.delivery ?? g.delivery;
      const online = delivery === 'online';
      const next = {
        name: data.name ?? g.name,
        teacherId: data.teacherId !== undefined ? data.teacherId : g.teacherId,
        weeklyPeriods,
        doublePeriods,
        delivery,
        // An online group takes no room: its room needs are cleared.
        roomType: online ? null : data.roomType !== undefined ? data.roomType : g.roomType,
        roomFeatures: online ? [] : data.roomFeatures ?? g.roomFeatures,
        roomId: online ? null : data.roomId !== undefined ? data.roomId : g.roomId,
      };
      if (online && (data.roomId || data.roomType)) throw new SchedulingError('An online group takes no room: leave its room needs empty');
      if (await isProvider(tx, next.teacherId) && weeklyPeriods > 0 && data.weeklyPeriods !== undefined) {
        throw new SchedulingError('A provider teaches outside the timetable: its group has no lessons, so no weekly periods');
      }
      const { teacherId: nextTeacher, ...rest } = next;
      await tx.update(teachingGroup).set({ ...rest, updatedAt: new Date() }).where(eq(teachingGroup.id, id));
      // Gone online: the drafts' lessons of the group give up their rooms.
      if (online && g.delivery !== 'online') {
        await tx.execute(sql`update ${timetableLesson} l set room_id = null, updated_at = now() from ${timetable} t
          where l.timetable_id = t.id and t.status = 'draft' and l.group_id = ${id}`);
      }
      let teacherFrom: string | null = null;
      let accepted: { message: string }[] = [];
      if ((nextTeacher ?? null) !== (g.teacherId ?? null)) {
        const [y] = await tx.select().from(academicYear).where(eq(academicYear.id, g.academicYearId));
        teacherFrom = defaultStart(y!, data.teacherFrom);
        const changed = await changeGroupTeacher(tx, g, nextTeacher, teacherFrom, `Teacher changed from ${readableDate(teacherFrom)}`, actorId, ctx,
          { anyway: data.anyway, clashToken: data.clashToken });
        accepted = changed.accepted;
        coversLost = changed.coversLost;
      }
      const linked = nextTeacher !== g.teacherId ? await linkTeacherToSubject(tx, nextTeacher, g.subjectId) : false;
      const cards = weeklyPeriods !== g.weeklyPeriods || doublePeriods !== g.doublePeriods || (nextTeacher ?? null) !== (g.teacherId ?? null)
        ? await syncDraftCards(tx, [id]) : { drafts: 0, added: 0, removed: 0 };
      await logAction(actorId, 'TEACHING_GROUP_UPDATED', 'teaching_group', id,
        { name: g.name, teacherId: g.teacherId, weeklyPeriods: g.weeklyPeriods, doublePeriods: g.doublePeriods, delivery: g.delivery, roomType: g.roomType, roomFeatures: g.roomFeatures, roomId: g.roomId },
        { ...next, teacherFrom, teacherLinkedToSubject: linked, cards, clashesAccepted: accepted.map((c) => c.message), coversLost }, ctx, tx);
      return { id, cards, teacherFrom, clashesAccepted: accepted.map((c) => c.message) };
    });
    const cover = await import('./cover.services');
    await cover.coverChangeNotices(coversLost, 'no_longer_holds').catch((err) => console.error('[groups] cover notices failed:', err));
    return { ...result, coversLost: await cover.describeCovers(coversLost) };
  } catch (err) {
    if (isUniqueViolation(err)) throw new SchedulingError(`That year already has a group named ${data.name}`, 409);
    throw err;
  }
}

// ─── Membership ──────────────────────────────────────────────────────────────

/**
 * Put students in a group from a day (moving them out of their group of the
 * same subject or unit). The caller holds the students' locks (§17: the
 * membership paths take them first, `lockMembershipChange`; the enrolment's
 * follow-up arrives holding them, or their lines and enrolments); this takes
 * the group FOR UPDATE, then the member rows it ends.
 */
async function addMembersTx(tx: Tx, groupId: string, studentIds: string[], startsOn: string, actorId: string) {
  const g = await groupOrThrow(groupId, tx, true);
  if (g.kind === 'section') throw new SchedulingError("This group's students are its section's — change the section on the Sections screen", 409);
  if (g.archivedOn) throw new SchedulingError('This group is retired — it is kept as history', 409);
  const [y] = await tx.select().from(academicYear).where(eq(academicYear.id, g.academicYearId));
  const ids = [...new Set(studentIds)];
  const students = await tx.select({ id: user.id, name: user.name, role: user.role, cohortYear: user.cohortYear, leftOn: user.leftOn })
    .from(user).where(inArray(user.id, ids)).orderBy(user.id);
  if (students.length !== ids.length) throw new SchedulingError('One or more students were not found', 404);
  const problems: string[] = [];
  for (const s of students) {
    if (s.role !== 'student') problems.push(`${s.name} is not a student`);
    else if (s.leftOn) problems.push(`${s.name} has left the school`);
    else {
      const grade = gradeInAcademicYear(s.cohortYear, y!.startYear);
      if (grade === null || grade < 10 || grade > 12) problems.push(`${s.name} is not in grades 10–12 that year`);
    }
  }
  if (problems.length) throw new SchedulingError(problems.join('; '));

  // Already in a group of this subject or unit: moved from it (the move cannot predate joining it).
  const current = g.subjectId
    ? await tx.select({ id: teachingGroupMember.id, studentId: teachingGroupMember.studentId, groupId: teachingGroupMember.groupId, startedOn: teachingGroupMember.startedOn, groupName: teachingGroup.name })
      .from(teachingGroupMember).innerJoin(teachingGroup, eq(teachingGroup.id, teachingGroupMember.groupId))
      .where(and(inArray(teachingGroupMember.studentId, ids), sameKey(g), eq(teachingGroupMember.academicYearId, g.academicYearId), isNull(teachingGroupMember.endedOn)))
      .for('update', { of: teachingGroupMember })
    : await tx.select({ id: teachingGroupMember.id, studentId: teachingGroupMember.studentId, groupId: teachingGroupMember.groupId, startedOn: teachingGroupMember.startedOn, groupName: teachingGroup.name })
      .from(teachingGroupMember).innerJoin(teachingGroup, eq(teachingGroup.id, teachingGroupMember.groupId))
      .where(and(inArray(teachingGroupMember.studentId, ids), eq(teachingGroupMember.groupId, g.id), isNull(teachingGroupMember.endedOn)))
      .for('update', { of: teachingGroupMember });
  const tooEarly = current.filter((c) => c.groupId !== g.id && c.startedOn > startsOn);
  if (tooEarly.length) {
    throw new SchedulingError(`A move must start on or after the day the student joined their current group: ${tooEarly.map((c) => `${students.find((s) => s.id === c.studentId)!.name} joined ${c.groupName} on ${readableDate(c.startedOn)}`).join('; ')}`, 409);
  }
  let moved = 0;
  const toAdd: string[] = [];
  for (const id of ids) {
    const c = current.find((x) => x.studentId === id);
    if (c && c.groupId === g.id) continue;
    if (c) {
      // A move on the day they joined replaces that membership (it ends the day before it began).
      const endedOn = lastDayOf(c.startedOn, addDays(startsOn, -1));
      await tx.update(teachingGroupMember).set({ endedOn, endReason: `Moved to ${g.name}`, endedBy: actorId }).where(eq(teachingGroupMember.id, c.id));
      moved++;
    }
    toAdd.push(id);
  }
  if (toAdd.length) {
    const enrolments = g.subjectId
      ? await tx.select({ id: courseEnrolment.id, studentId: courseEnrolment.studentId }).from(courseEnrolment)
        .where(and(
          inArray(courseEnrolment.studentId, toAdd), eq(courseEnrolment.academicYearId, g.academicYearId), isNull(courseEnrolment.endedOn),
          g.unitId ? eq(courseEnrolment.unitId, g.unitId) : and(eq(courseEnrolment.subjectId, g.subjectId), isNull(courseEnrolment.unitId)),
        ))
      : [];
    await tx.insert(teachingGroupMember).values(toAdd.map((studentId) => ({
      id: randomUUID(), groupId: g.id, studentId, academicYearId: g.academicYearId, subjectId: g.subjectId, unitId: g.unitId,
      enrolmentId: enrolments.find((e) => e.studentId === studentId)?.id ?? null, startedOn: startsOn, addedBy: actorId,
    })));
  }
  return { added: toAdd.length, moved, alreadyIn: ids.length - toAdd.length };
}

export async function addGroupMembers(groupId: string, data: AddGroupMembersType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      // §17: the students, then the group, then the published-timetable check.
      await lockMembershipChange(tx, { studentIds: data.studentIds, groupIds: [groupId] });
      const g = await groupOrThrow(groupId, tx);
      const [y] = await tx.select().from(academicYear).where(eq(academicYear.id, g.academicYearId));
      const startsOn = defaultStart(y!, data.startsOn);
      const { result: r, accepted } = await guardPublishedTimetable(tx, { studentIds: data.studentIds }, startsOn,
        { anyway: data.anyway, clashToken: data.clashToken, cause: `Added to ${g.name}`, actorId }, () => addMembersTx(tx, groupId, data.studentIds, startsOn, actorId));
      const clashesAccepted = accepted.map((c) => c.message);
      if (r.added) await logAction(actorId, 'TEACHING_GROUP_MEMBERS_ADDED', 'teaching_group', groupId, null, { studentIds: data.studentIds, startsOn, ...r, clashesAccepted }, ctx, tx);
      return { ...r, clashesAccepted };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new SchedulingError('Someone changed this group at the same moment — look again', 409);
    throw err;
  }
}

export async function endGroupMembers(groupId: string, data: EndGroupMembersType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const g = await groupOrThrow(groupId, tx, true);
    if (g.kind === 'section') throw new SchedulingError("This group's students are its section's — change the section on the Sections screen", 409);
    const endedOn = data.endedOn ?? todayAtSchool();
    const rows = await tx.select({ id: teachingGroupMember.id, studentId: teachingGroupMember.studentId, startedOn: teachingGroupMember.startedOn, name: user.name })
      .from(teachingGroupMember).innerJoin(user, eq(user.id, teachingGroupMember.studentId))
      .where(and(eq(teachingGroupMember.groupId, groupId), inArray(teachingGroupMember.studentId, data.studentIds), isNull(teachingGroupMember.endedOn)))
      .for('update', { of: teachingGroupMember });
    if (!rows.length) throw new SchedulingError('None of those students is in this group', 404);
    const early = rows.filter((r) => endedOn < r.startedOn);
    if (early.length) throw new SchedulingError(`A membership cannot end before it started: ${early.map((r) => `${r.name} joined on ${readableDate(r.startedOn)}`).join('; ')}`);
    for (const r of rows) {
      await tx.update(teachingGroupMember).set({ endedOn, endReason: data.reason, endedBy: actorId }).where(eq(teachingGroupMember.id, r.id));
    }
    await logAction(actorId, 'TEACHING_GROUP_MEMBERS_ENDED', 'teaching_group', groupId, null, { studentIds: rows.map((r) => r.studentId), endedOn, reason: data.reason }, ctx, tx);
    return { ended: rows.length };
  });
}

/** Some students into new groups of the same subject (the rest stay). */
export async function splitGroup(groupId: string, data: SplitGroupType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      // §17: the students it moves, then the group.
      await lockMembershipChange(tx, { studentIds: data.parts.flatMap((p) => p.studentIds), groupIds: [groupId] });
      const g = await groupOrThrow(groupId, tx, true);
      if (g.kind === 'section') throw new SchedulingError("A section's group follows its section — split the section instead, or make a group by hand", 409);
      if (g.archivedOn) throw new SchedulingError('This group is retired — it is kept as history', 409);
      const [y] = await tx.select().from(academicYear).where(eq(academicYear.id, g.academicYearId));
      const startsOn = defaultStart(y!, data.startsOn);
      const all = data.parts.flatMap((p) => p.studentIds);
      if (new Set(all).size !== all.length) throw new SchedulingError('A student can go to one new group only');
      const open = await tx.select({ studentId: teachingGroupMember.studentId }).from(teachingGroupMember)
        .where(and(eq(teachingGroupMember.groupId, groupId), isNull(teachingGroupMember.endedOn)));
      const inGroup = new Set(open.map((o) => o.studentId));
      const strangers = all.filter((s) => !inGroup.has(s));
      if (strangers.length) throw new SchedulingError(`${strangers.length} of the chosen students ${strangers.length === 1 ? 'is' : 'are'} not in ${g.name}`);
      const made: { id: string; name: string; students: number }[] = [];
      const partTeachers = data.parts.map((p) => (p.teacherId !== undefined ? p.teacherId : g.teacherId)).filter((x): x is string => !!x);
      const { accepted } = await guardPublishedTimetable(tx, { studentIds: all, teacherIds: partTeachers }, startsOn, { anyway: data.anyway, clashToken: data.clashToken, cause: `Split from ${g.name}`, actorId }, async () => {
        for (const p of data.parts) {
          await assertTeacher(tx, p.teacherId);
          const id = randomUUID();
          const partTeacher = p.teacherId !== undefined ? p.teacherId : g.teacherId;
          await tx.insert(teachingGroup).values({
            id, academicYearId: g.academicYearId, name: p.name, subjectId: g.subjectId, unitId: g.unitId, teacherId: partTeacher, delivery: g.delivery,
            kind: 'manual', weeklyPeriods: g.weeklyPeriods, doublePeriods: g.doublePeriods, roomType: g.roomType, roomFeatures: g.roomFeatures, roomId: g.roomId,
            splitFromGroupId: g.id, createdBy: actorId,
          });
          if (partTeacher) await tx.insert(teachingGroupTeacher).values({ id: randomUUID(), groupId: id, teacherId: partTeacher, startedOn: startsOn, reason: `Split from ${g.name}`, setBy: actorId });
          await linkTeacherToSubject(tx, p.teacherId ?? null, g.subjectId);
          await addMembersTx(tx, id, p.studentIds, startsOn, actorId);
          made.push({ id, name: p.name, students: p.studentIds.length });
        }
      });
      await syncDraftCards(tx, made.map((m) => m.id));
      // A published timetable has no lessons for groups made after it: say so, so a new version follows.
      const published = await tx.select({ id: timetable.id }).from(timetable).innerJoin(academicTerm, eq(academicTerm.id, timetable.termId))
        .where(and(eq(timetable.academicYearId, g.academicYearId), eq(timetable.status, 'published'), sql`${academicTerm.endsOn} >= ${startsOn}`));
      const clashesAccepted = accepted.map((c) => c.message);
      await logAction(actorId, 'TEACHING_GROUP_SPLIT', 'teaching_group', groupId, null, { into: made, startsOn, clashesAccepted }, ctx, tx);
      return { groups: made, startsOn, clashesAccepted, notInPublishedTimetable: published.length > 0 };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new SchedulingError('A group with one of those names already exists this year', 409);
    throw err;
  }
}

/** Groups of one subject into one: their students move, and they are retired from the day. */
export async function mergeGroups(data: MergeGroupsType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    // §17: the students who move (read first, then locked), then every group concerned in id order.
    const allIds = [...new Set([data.intoGroupId, ...data.groupIds])];
    const movingNow = (await tx.select({ studentId: teachingGroupMember.studentId }).from(teachingGroupMember)
      .where(and(inArray(teachingGroupMember.groupId, allIds.filter((x) => x !== data.intoGroupId)), isNull(teachingGroupMember.endedOn)))).map((m) => m.studentId);
    await lockMembershipChange(tx, { studentIds: movingNow, groupIds: allIds });
    const into = await groupOrThrow(data.intoGroupId, tx, true);
    const others: Awaited<ReturnType<typeof groupOrThrow>>[] = [];
    for (const id of [...new Set(data.groupIds)].filter((x) => x !== into.id)) others.push(await groupOrThrow(id, tx, true));
    if (!others.length) throw new SchedulingError('Choose the groups to merge in');
    for (const g of [into, ...others]) {
      if (g.kind === 'section') throw new SchedulingError(`${g.name} follows its section and cannot be merged — retire it and add its students to a group by hand`, 409);
      if (g.archivedOn) throw new SchedulingError(`${g.name} is retired`, 409);
      if (g.academicYearId !== into.academicYearId) throw new SchedulingError(`${g.name} belongs to another academic year`);
      if ((g.subjectId ?? null) !== (into.subjectId ?? null)) throw new SchedulingError(`${g.name} teaches another subject than ${into.name}`);
      if ((g.unitId ?? null) !== (into.unitId ?? null)) throw new SchedulingError(`${g.name} teaches another unit than ${into.name}`);
    }
    const [y] = await tx.select().from(academicYear).where(eq(academicYear.id, into.academicYearId));
    const startsOn = defaultStart(y!, data.startsOn);
    let movedStudents = 0;
    const moving = (await tx.select({ studentId: teachingGroupMember.studentId }).from(teachingGroupMember)
      .where(and(inArray(teachingGroupMember.groupId, others.map((g) => g.id)), isNull(teachingGroupMember.endedOn)))).map((m) => m.studentId);
    const { accepted } = await guardPublishedTimetable(tx, { studentIds: moving }, startsOn, { anyway: data.anyway, clashToken: data.clashToken, cause: `Merged into ${into.name}`, actorId }, async () => {
      for (const g of others) {
        const members = await tx.select({ studentId: teachingGroupMember.studentId }).from(teachingGroupMember)
          .where(and(eq(teachingGroupMember.groupId, g.id), isNull(teachingGroupMember.endedOn)));
        if (members.length) movedStudents += (await addMembersTx(tx, into.id, members.map((m) => m.studentId), startsOn, actorId)).added;
        await archiveTx(tx, g.id, startsOn, `Merged into ${into.name}`, actorId);
      }
    });
    const clashesAccepted = accepted.map((c) => c.message);
    await logAction(actorId, 'TEACHING_GROUPS_MERGED', 'teaching_group', into.id, null, { merged: others.map((g) => ({ id: g.id, name: g.name })), startsOn, movedStudents, clashesAccepted }, ctx, tx);
    return { into: into.id, merged: others.length, movedStudents, startsOn, clashesAccepted };
  });
}

async function archiveTx(tx: Tx, groupId: string, archivedOn: string, reason: string, actorId: string) {
  const g = await groupOrThrow(groupId, tx, true);
  if (g.archivedOn) throw new SchedulingError(`${g.name} is already retired`, 409);
  const members = await tx.select({ id: teachingGroupMember.id, startedOn: teachingGroupMember.startedOn }).from(teachingGroupMember)
    .where(and(eq(teachingGroupMember.groupId, groupId), isNull(teachingGroupMember.endedOn))).for('update');
  for (const m of members) {
    const endedOn = lastDayOf(m.startedOn, addDays(archivedOn, -1));
    await tx.update(teachingGroupMember).set({ endedOn, endReason: reason, endedBy: actorId }).where(eq(teachingGroupMember.id, m.id));
  }
  await tx.update(teachingGroup).set({ archivedOn, archivedReason: reason, updatedAt: new Date() }).where(eq(teachingGroup.id, groupId));
  await syncDraftCards(tx, [groupId]);
  return { membersEnded: members.length };
}

export async function archiveGroup(groupId: string, data: ArchiveGroupType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const g = await groupOrThrow(groupId, tx, true);
    const [y] = await tx.select().from(academicYear).where(eq(academicYear.id, g.academicYearId));
    const archivedOn = defaultStart(y!, data.archivedOn);
    const r = await archiveTx(tx, groupId, archivedOn, data.reason, actorId);
    await logAction(actorId, 'TEACHING_GROUP_ARCHIVED', 'teaching_group', groupId, null, { archivedOn, reason: data.reason, ...r }, ctx, tx);
    return { archivedOn, ...r };
  });
}

// ─── Hooks the student record and the enrolment call ─────────────────────────

/** A student left the school: their open group memberships end with the leaving (in its transaction). */
export async function endGroupMembershipsOnLeaving(tx: Tx, studentId: string, leftOn: string, reason: string, actorId: string) {
  const open = await tx.select({ id: teachingGroupMember.id, startedOn: teachingGroupMember.startedOn }).from(teachingGroupMember)
    .where(and(eq(teachingGroupMember.studentId, studentId), isNull(teachingGroupMember.endedOn))).for('update');
  for (const m of open) {
    await tx.update(teachingGroupMember)
      .set({ endedOn: lastDayOf(m.startedOn, leftOn), endReason: reason, endedBy: actorId })
      .where(eq(teachingGroupMember.id, m.id));
  }
  return open.length;
}

/**
 * A student stopped being taught a subject — or a unit, for an enrolment per
 * unit — in school (the enrolment ended or became self-study): they leave its
 * group from the next day, in the same transaction. The key is the
 * enrolment's (§10): the unit when given, else the subject with no unit.
 */
export async function endGroupMembershipsForSubject(tx: Tx, studentId: string, subjectId: string, unitId: string | null, academicYearId: string, lastDay: string, reason: string, actorId: string) {
  const open = await tx.select({ id: teachingGroupMember.id, startedOn: teachingGroupMember.startedOn }).from(teachingGroupMember)
    .where(and(eq(teachingGroupMember.studentId, studentId), sameKey({ subjectId, unitId }), eq(teachingGroupMember.academicYearId, academicYearId), isNull(teachingGroupMember.endedOn)))
    .for('update');
  for (const m of open) {
    await tx.update(teachingGroupMember)
      .set({ endedOn: lastDayOf(m.startedOn, lastDay), endReason: reason, endedBy: actorId })
      .where(eq(teachingGroupMember.id, m.id));
  }
  return open.length;
}

// ─── The group follows the enrolment (RESERVATIONS_REWORK.md §10) ─────────────

export type FollowOutcome = {
  /** Studies it alone now: out of the group after today. */
  left: { studentId: string; groupId: string; groupName: string }[];
  /** Moved into their new teacher's group of the subject or unit. */
  moved: { studentId: string; fromGroupId: string; toGroupId: string; toGroupName: string }[];
  /** Every member now has the new teacher: the group's teacher changed (dated). */
  groupsGiven: { groupId: string; groupName: string; teacherId: string | null }[];
  /** Stayed where they are — no group of the new teacher, or the move would clash: the coordinator sees them (`groupsWaiting`). */
  waiting: { studentId: string; groupId: string; groupName: string; teacherId: string | null; why: string }[];
  /** Cover a group's new teacher made no longer holding (told after the commit: `groupFollowNotices`). */
  coversLost: string[];
};

/** A savepoint: what `run` writes is undone if it throws a refusal, which is returned instead. */
async function attempt<T>(tx: Tx, run: (sp: Tx) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; why: string }> {
  try {
    return { ok: true, value: await tx.transaction(async (sp) => run(sp as unknown as Tx)) };
  } catch (err) {
    if (err instanceof SchedulingError) return { ok: false, why: err.message };
    throw err;
  }
}

/**
 * The teaching group follows an enrolment whose teacher or mode changed, in
 * the caller's transaction, from today (RESERVATIONS_REWORK.md §10: a line's
 * teacher, its change or its replacement reaches the group through
 * `upsertEnrolments` with the unit). Rules, per student and enrolment key:
 * - self-study now: they leave the group after today;
 * - a new teacher: if every open member of their group now has that teacher,
 *   the group's teacher changes from today (F1's dated change, checked against
 *   the published timetables, and the cover from then judged again); otherwise
 *   they move into the smallest live group of that subject or unit whose
 *   teacher today is the new one;
 * - with no such group, or a move or a change of teacher that would add a
 *   clash to a published timetable, or a group with published lessons given to
 *   a provider, they stay where they are and are listed (`groupsWaiting`): a
 *   desk's or admin's change never fails for a timetable reason.
 * An enrolment just made is not placed here: forming from the course enrolment
 * adds it. Each move writes its own audit row in the transaction.
 *
 * Locks (§17): called after the caller's lines and enrolments; takes every
 * group concerned FOR UPDATE in id order, then the member rows; the published
 * check's running terms (shared) and teachers after them, then the cover.
 */
export async function followEnrolments(tx: Tx, changes: EnrolmentChange[], actorId: string, ctx?: AuditContext): Promise<FollowOutcome> {
  const out: FollowOutcome = { left: [], moved: [], groupsGiven: [], waiting: [], coversLost: [] };
  const relevant = changes.filter((c) => c.before && ((c.before.teacherId ?? null) !== (c.after.teacherId ?? null) || c.before.mode !== c.after.mode));
  if (!relevant.length) return out;
  const yearIds = [...new Set(relevant.map((c) => c.academicYearId))];
  const years = new Map((await tx.select().from(academicYear).where(inArray(academicYear.id, yearIds))).map((y) => [y.id, y]));
  const keyCond = (c: { studentId: string; subjectId: string; unitId: string | null; academicYearId: string }) =>
    and(eq(teachingGroupMember.studentId, c.studentId), eq(teachingGroupMember.academicYearId, c.academicYearId), sameKey(c), isNull(teachingGroupMember.endedOn));
  // Read where each student is and every live group of their keys, then lock those groups in id order.
  const readMembers = async (lock: boolean) => {
    const q = tx.select({ m: teachingGroupMember, g: teachingGroup }).from(teachingGroupMember)
      .innerJoin(teachingGroup, eq(teachingGroup.id, teachingGroupMember.groupId))
      .where(and(or(...relevant.map(keyCond)), ne(teachingGroup.kind, 'section')))
      .orderBy(asc(teachingGroupMember.id));
    return lock ? q.for('update', { of: teachingGroupMember }) : q;
  };
  const before = await readMembers(false);
  const keyGroups = await tx.select().from(teachingGroup).where(and(
    inArray(teachingGroup.academicYearId, yearIds), ne(teachingGroup.kind, 'section'), isNull(teachingGroup.archivedOn),
    or(...relevant.map((c) => (c.unitId ? eq(teachingGroup.unitId, c.unitId) : and(eq(teachingGroup.subjectId, c.subjectId), isNull(teachingGroup.unitId))))),
  ));
  await lockMembershipChange(tx, { groupIds: [...before.map((x) => x.g.id), ...keyGroups.map((g) => g.id)] });
  const members = await readMembers(true);
  const memberOf = new Map(members.map((x) => [`${x.m.studentId}|${x.m.academicYearId}|${memberKey(x.m)}`, x]));
  const fromOf = (yearId: string) => defaultStart(years.get(yearId)!);
  const sizes = new Map<string, number>();
  for (const x of await groupMembersBetween(keyGroups.map((g) => g.id), todayAtSchool(), todayAtSchool(), tx)) sizes.set(x.groupId, (sizes.get(x.groupId) ?? 0) + 1);

  // Self-study now: out of the group after today.
  for (const c of relevant.filter((x) => x.after.mode === 'self_study' && x.before!.mode !== 'self_study')) {
    const at = memberOf.get(`${c.studentId}|${c.academicYearId}|${memberKey(c)}`);
    if (!at) continue;
    const ended = await endGroupMembershipsForSubject(tx, c.studentId, c.subjectId, c.unitId, c.academicYearId, todayAtSchool(), 'Now studies this subject alone', actorId);
    if (ended) {
      await logAction(actorId, 'TEACHING_GROUP_MEMBERS_ENDED', 'teaching_group', at.g.id, null,
        { studentIds: [c.studentId], endedOn: todayAtSchool(), reason: 'Now studies this subject alone', followed: 'enrolment', enrolmentId: c.enrolmentId }, ctx, tx);
      out.left.push({ studentId: c.studentId, groupId: at.g.id, groupName: at.g.name });
    }
  }

  // A new teacher: per current group, the whole group or the student.
  const teacherChanges = relevant.filter((x) => x.after.mode === 'in_school' && (x.before!.teacherId ?? null) !== (x.after.teacherId ?? null));
  const byGroup = new Map<string, { g: typeof teachingGroup.$inferSelect; changes: EnrolmentChange[] }>();
  for (const c of teacherChanges) {
    const at = memberOf.get(`${c.studentId}|${c.academicYearId}|${memberKey(c)}`);
    if (!at) continue;
    if (!byGroup.has(at.g.id)) byGroup.set(at.g.id, { g: at.g, changes: [] });
    byGroup.get(at.g.id)!.changes.push(c);
  }
  for (const { g, changes: mine } of [...byGroup.values()].sort((a, b) => a.g.id.localeCompare(b.g.id))) {
    const from = fromOf(g.academicYearId);
    const nowTeacher = (await teachersOn([g.id], from, tx)).get(g.id) ?? g.teacherId ?? null;
    const wanted = [...new Set(mine.map((c) => c.after.teacherId ?? null))];
    // Every open member now enrolled (in school, this key) with one teacher: the group goes to them.
    const open = await tx.select({ studentId: teachingGroupMember.studentId }).from(teachingGroupMember)
      .where(and(eq(teachingGroupMember.groupId, g.id), isNull(teachingGroupMember.endedOn)));
    const enrolledWith = open.length
      ? await tx.select({ studentId: courseEnrolment.studentId, teacherId: courseEnrolment.teacherId, mode: courseEnrolment.mode }).from(courseEnrolment)
        .where(and(inArray(courseEnrolment.studentId, open.map((o) => o.studentId)), eq(courseEnrolment.academicYearId, g.academicYearId), isNull(courseEnrolment.endedOn),
          g.unitId ? eq(courseEnrolment.unitId, g.unitId) : and(eq(courseEnrolment.subjectId, g.subjectId!), isNull(courseEnrolment.unitId))))
      : [];
    const whole = wanted.length === 1 && open.length > 0 && open.every((o) => enrolledWith.some((e) => e.studentId === o.studentId && e.mode === 'in_school' && (e.teacherId ?? null) === wanted[0]));
    if (whole) {
      const to = wanted[0]!;
      if (to === nowTeacher) continue;
      const done = await attempt(tx, async (sp) => {
        const r = await changeGroupTeacher(sp, g, to, from, `Followed the course enrolment from ${readableDate(from)}`, actorId, ctx, { cause: `${g.name}: its students' teacher changed` });
        // A group formed while it had no teacher takes its teacher's name.
        let name = g.name;
        if (/\(no teacher yet\)$/.test(g.name) && to) {
          const [t] = await sp.select({ name: teacher.name }).from(teacher).where(eq(teacher.id, to));
          const taken = (await sp.select({ name: teachingGroup.name }).from(teachingGroup).where(and(eq(teachingGroup.academicYearId, g.academicYearId), isNull(teachingGroup.archivedOn), ne(teachingGroup.id, g.id)))).map((x) => x.name);
          name = uniqueName(g.name.replace(/ \(no teacher yet\)$/, ` — ${t?.name ?? ''}`), taken);
          await sp.update(teachingGroup).set({ name, updatedAt: new Date() }).where(eq(teachingGroup.id, g.id));
        }
        await syncDraftCards(sp, [g.id]);
        await logAction(actorId, 'TEACHING_GROUP_UPDATED', 'teaching_group', g.id, { teacherId: nowTeacher, name: g.name },
          { teacherId: to, teacherFrom: from, name, followed: 'enrolment', enrolmentIds: mine.map((c) => c.enrolmentId), coversLost: r.coversLost }, ctx, sp);
        return { ...r, name };
      });
      if (done.ok) {
        out.groupsGiven.push({ groupId: g.id, groupName: done.value.name, teacherId: to });
        out.coversLost.push(...done.value.coversLost);
      } else {
        for (const c of mine) out.waiting.push({ studentId: c.studentId, groupId: g.id, groupName: g.name, teacherId: c.after.teacherId, why: done.why });
      }
      continue;
    }
    for (const c of [...mine].sort((a, b) => a.studentId.localeCompare(b.studentId))) {
      const to = c.after.teacherId ?? null;
      if (to === nowTeacher) continue;
      const teacherNow = await teachersOn(keyGroups.map((x) => x.id), from, tx);
      const target = keyGroups
        .filter((x) => x.id !== g.id && memberKey(x) === memberKey(c) && x.academicYearId === c.academicYearId && (teacherNow.get(x.id) ?? x.teacherId ?? null) === to)
        .sort((a, b) => (sizes.get(a.id) ?? 0) - (sizes.get(b.id) ?? 0) || a.name.localeCompare(b.name))[0];
      if (!target) {
        const [t] = to ? await tx.select({ name: teacher.name }).from(teacher).where(eq(teacher.id, to)) : [];
        out.waiting.push({ studentId: c.studentId, groupId: g.id, groupName: g.name, teacherId: to, why: `No group of ${t?.name ?? 'no teacher'} for this subject yet` });
        continue;
      }
      const done = await attempt(tx, async (sp) => {
        const checkpoint = await checkpointPublished(sp, { studentIds: [c.studentId] }, from);
        const r = await addMembersTx(sp, target.id, [c.studentId], from, actorId);
        await checkpoint.settle({ cause: `Moved to ${target.name}`, actorId });
        await syncDraftCards(sp, [target.id, g.id]);
        await logAction(actorId, 'TEACHING_GROUP_MEMBERS_ADDED', 'teaching_group', target.id, null,
          { studentIds: [c.studentId], startsOn: from, ...r, fromGroupId: g.id, followed: 'enrolment', enrolmentId: c.enrolmentId }, ctx, sp);
        return r;
      });
      if (done.ok) {
        out.moved.push({ studentId: c.studentId, fromGroupId: g.id, toGroupId: target.id, toGroupName: target.name });
        sizes.set(target.id, (sizes.get(target.id) ?? 0) + 1);
      } else {
        out.waiting.push({ studentId: c.studentId, groupId: g.id, groupName: g.name, teacherId: to, why: done.why });
      }
    }
  }
  return out;
}

/**
 * Who is not in the group their enrolment says, and who has no teacher yet —
 * the coordinator's list on Teaching groups (the follow-up's "the student
 * stays"): each with the group they would move to (a guarded Move, the add
 * with its clash confirmation), a group whose every member is enrolled with
 * one other teacher (Give it to them), and per subject or unit the students
 * with no teacher yet with the teachers their lines may take (Assign).
 */
export async function groupsWaiting(academicYearId: string) {
  const y = await yearOrThrow(academicYearId);
  const today = defaultStart(y);
  const groups = await db.select({ g: teachingGroup, subjectName: subject.name, unitCode: examUnit.code, unitShortCode: examUnit.shortCode }).from(teachingGroup)
    .leftJoin(subject, eq(subject.id, teachingGroup.subjectId)).leftJoin(examUnit, eq(examUnit.id, teachingGroup.unitId))
    .where(and(eq(teachingGroup.academicYearId, y.id), ne(teachingGroup.kind, 'section'), sql`(${teachingGroup.archivedOn} IS NULL OR ${teachingGroup.archivedOn} > ${today})`));
  const teacherNow = await teachersOn(groups.map((x) => x.g.id), today);
  const teacherOfGroup = (id: string) => teacherNow.get(id) ?? groups.find((x) => x.g.id === id)?.g.teacherId ?? null;
  const members = await groupMembersBetween(groups.map((x) => x.g.id), today, today);
  const sizes = new Map<string, number>();
  for (const m of members) sizes.set(m.groupId, (sizes.get(m.groupId) ?? 0) + 1);
  const enrolments = await db.select({ e: courseEnrolment, name: user.name }).from(courseEnrolment).innerJoin(user, eq(user.id, courseEnrolment.studentId))
    .where(and(eq(courseEnrolment.academicYearId, y.id), isNull(courseEnrolment.endedOn), eq(courseEnrolment.mode, 'in_school')));
  const teacherIds = [...new Set([...enrolments.map((x) => x.e.teacherId), ...groups.map((x) => teacherOfGroup(x.g.id))].filter((t): t is string => !!t))];
  const names = new Map((teacherIds.length ? await db.select({ id: teacher.id, name: teacher.name }).from(teacher).where(inArray(teacher.id, teacherIds)) : []).map((t) => [t.id, t.name]));
  const groupOfKey = new Map<string, string>();
  for (const m of members) {
    const x = groups.find((gg) => gg.g.id === m.groupId)!;
    const key = memberKey(x.g);
    if (key) groupOfKey.set(`${m.studentId}|${key}`, m.groupId);
  }
  const label = (x: { subjectName: string | null; unitShortCode: string | null; unitCode: string | null; g: { unitId: string | null } }) =>
    `${x.subjectName ?? ''}${x.g.unitId ? ` ${x.unitShortCode ?? x.unitCode}` : ''}`;
  const students: {
    studentId: string; name: string; subject: string; groupId: string; group: string; groupTeacher: string | null;
    enrolledTeacherId: string | null; enrolledTeacher: string | null; target: { id: string; name: string } | null;
  }[] = [];
  for (const { e, name } of enrolments) {
    const key = memberKey(e)!;
    const gid = groupOfKey.get(`${e.studentId}|${key}`);
    if (!gid) continue;
    const gt = teacherOfGroup(gid);
    if ((gt ?? null) === (e.teacherId ?? null)) continue;
    const x = groups.find((gg) => gg.g.id === gid)!;
    const target = groups
      .filter((gg) => gg.g.id !== gid && memberKey(gg.g) === key && (teacherOfGroup(gg.g.id) ?? null) === (e.teacherId ?? null))
      .sort((a, b) => (sizes.get(a.g.id) ?? 0) - (sizes.get(b.g.id) ?? 0) || a.g.name.localeCompare(b.g.name))[0];
    students.push({
      studentId: e.studentId, name, subject: label(x), groupId: gid, group: x.g.name, groupTeacher: gt ? names.get(gt) ?? null : null,
      enrolledTeacherId: e.teacherId, enrolledTeacher: e.teacherId ? names.get(e.teacherId) ?? null : null, target: target ? { id: target.g.id, name: target.g.name } : null,
    });
  }
  // A group whose every member is enrolled with one other teacher: give it to them.
  const giveTo: { groupId: string; group: string; teacherId: string; teacher: string | null; students: number }[] = [];
  for (const x of groups) {
    const here = members.filter((m) => m.groupId === x.g.id).map((m) => m.studentId);
    if (!here.length) continue;
    const off = students.filter((s) => s.groupId === x.g.id);
    const ts = [...new Set(off.map((s) => s.enrolledTeacherId))];
    if (off.length === new Set(here).size && ts.length === 1 && ts[0]) giveTo.push({ groupId: x.g.id, group: x.g.name, teacherId: ts[0], teacher: names.get(ts[0]) ?? null, students: off.length });
  }
  // No teacher yet ("no preference"), per subject or unit, with the teachers their live lines may take.
  const none = enrolments.filter((x) => !x.e.teacherId);
  const noTeacher: { subjectId: string; unitId: string | null; subject: string; students: { studentId: string; name: string; lines: number }[]; teachers: { id: string; name: string }[] }[] = [];
  const byKey = new Map<string, typeof none>();
  for (const x of none) {
    const k = `${x.e.subjectId}|${x.e.unitId ?? ''}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(x);
  }
  for (const list of byKey.values()) {
    const e0 = list[0]!.e;
    const [s] = await db.select({ name: subject.name }).from(subject).where(eq(subject.id, e0.subjectId));
    const [u] = e0.unitId ? await db.select({ code: examUnit.code, shortCode: examUnit.shortCode }).from(examUnit).where(eq(examUnit.id, e0.unitId)) : [];
    const lines = await noPreferenceLines(db, y, e0.subjectId, e0.unitId, list.map((x) => x.e.studentId));
    const pool = await teacherPoolOf(db, lines.map((l) => l.itemId), e0.subjectId);
    noTeacher.push({
      subjectId: e0.subjectId, unitId: e0.unitId, subject: `${s?.name ?? ''}${u ? ` ${u.shortCode ?? u.code}` : ''}`,
      students: list.map((x) => ({ studentId: x.e.studentId, name: x.name, lines: lines.filter((l) => l.studentId === x.e.studentId).length })).sort((a, b) => a.name.localeCompare(b.name)),
      teachers: pool,
    });
  }
  students.sort((a, b) => a.subject.localeCompare(b.subject) || a.name.localeCompare(b.name));
  noTeacher.sort((a, b) => a.subject.localeCompare(b.subject));
  return { academicYearId: y.id, asOf: today, students, giveTo, noTeacher };
}

/**
 * A student's live in-school lines with no teacher ("no preference", §3.5)
 * that this year's enrolment of a subject or unit is taught through
 * (`lineEnrolmentUnits`' rule: per unit, else the subject's own row).
 */
async function noPreferenceLines(executor: Executor, y: { id: string; startYear: number }, subjectId: string, unitId: string | null, studentIds: string[]) {
  if (!studentIds.length) return [];
  const rows = await executor.select({
    id: registration.id, studentId: registration.studentId, itemId: registration.offerItemId, entersKind: sessionOfferItem.entersKind, label: sessionOfferItem.label,
    units: sql<string[]>`coalesce((select array_agg(u.unit_id order by u.unit_id) from ${sessionOfferItemUnit} u where u.item_id = ${registration.offerItemId}), '{}')`,
  }).from(registration)
    .innerJoin(registrationSession, eq(registrationSession.id, registration.sessionId))
    .innerJoin(sessionOfferItem, eq(sessionOfferItem.id, registration.offerItemId))
    .where(and(
      inArray(registration.studentId, studentIds), eq(registration.subjectId, subjectId), isNull(registration.teacherId), eq(registration.mode, 'in_school'),
      inArray(registration.status, ['pending_approval', 'pending_payment', 'preregistered', 'confirmed']),
      sql`school_series_academic_year_start(${registrationSession.sessionType}, ${registrationSession.seriesYear}) = ${y.startYear}`,
    ))
    .orderBy(asc(registration.id));
  const { lineEnrolmentUnits } = await import('./enrolment.services');
  const out: (typeof rows)[number][] = [];
  for (const r of rows) {
    const units = r.entersKind === 'units' ? r.units ?? [] : [];
    const keys = await lineEnrolmentUnits(executor, y.id, r.studentId, subjectId, units);
    if (keys.includes(unitId)) out.push(r);
  }
  return out;
}

/** The teachers lines of these items may take: each item's own, else its offer's (the line's rule); none — the subject's pool. */
async function teacherPoolOf(executor: Executor, itemIds: (string | null)[], subjectId: string) {
  const ids = [...new Set(itemIds.filter((x): x is string => !!x))];
  const pool = new Map<string, string>();
  for (const itemId of ids) {
    const own = await executor.select({ id: teacher.id, name: teacher.name }).from(sessionOfferItemTeacher)
      .innerJoin(teacher, eq(teacher.id, sessionOfferItemTeacher.teacherId)).where(and(eq(sessionOfferItemTeacher.itemId, itemId), eq(teacher.isActive, true)));
    const list = own.length ? own : await executor.select({ id: teacher.id, name: teacher.name }).from(sessionOfferItem)
      .innerJoin(sessionOfferTeacher, eq(sessionOfferTeacher.offerId, sessionOfferItem.offerId))
      .innerJoin(teacher, eq(teacher.id, sessionOfferTeacher.teacherId)).where(and(eq(sessionOfferItem.id, itemId), eq(teacher.isActive, true)));
    for (const t of list) pool.set(t.id, t.name);
  }
  if (!ids.length) {
    for (const t of await executor.select({ id: teacher.id, name: teacher.name }).from(subjectTeacher).innerJoin(teacher, eq(teacher.id, subjectTeacher.teacherId))
      .where(and(eq(subjectTeacher.subjectId, subjectId), eq(teacher.isActive, true)))) pool.set(t.id, t.name);
  }
  return [...pool.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * "No preference" assigned later (RESERVATIONS_REWORK.md §3.5, §10): these
 * students of a subject or unit get a teacher. Each of their live in-school
 * lines with no teacher entering it this year takes the teacher by the line's
 * own rules (B's `changeLineTeacherTx`, one audit row per line; a line the
 * rules refuse is reported by name and the others proceed); a student with no
 * such line has their enrolment given the teacher; the enrolments and the
 * group then follow once for all (`followEnrolments`).
 * Locks (§17): the students FOR SHARE in id order (each line's change takes
 * its student so too), then line by line in id order B's own (the offer and
 * the item shared, the line, its enrolment), then the follow-up's groups FOR
 * UPDATE in id order and their member rows — the order RESERVATIONS.md §2.1
 * gives, with F1's at its end.
 */
export async function assignGroupTeacher(data: AssignGroupTeacherType, actorId: string, ctx?: AuditContext) {
  const result = await db.transaction(async (tx) => {
    const y = await yearOrThrow(data.academicYearId, tx);
    const studentIds = [...new Set(data.studentIds)].sort();
    await tx.select({ id: user.id }).from(user).where(inArray(user.id, studentIds)).orderBy(asc(user.id)).for('share');
    const [t] = await tx.select({ id: teacher.id, name: teacher.name, isActive: teacher.isActive }).from(teacher).where(eq(teacher.id, data.teacherId));
    if (!t) throw new SchedulingError('Teacher not found', 404);
    if (!t.isActive) throw new SchedulingError(`${t.name} is inactive — bring them back on the Teachers page first`);
    const unitId = data.unitId ?? null;
    const lines = await noPreferenceLines(tx, y, data.subjectId, unitId, studentIds);
    const { changeLineTeacherTx, LineTeacherError } = await import('./line-teacher.services');
    const changes: EnrolmentChange[] = [];
    const assigned: { studentId: string; registrationId: string | null; label: string }[] = [];
    const refused: { studentId: string; name: string; registrationId: string | null; label: string; why: string }[] = [];
    const nameOf = new Map((await tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, studentIds))).map((u) => [u.id, u.name]));
    for (const line of lines) {
      try {
        const r = await tx.transaction(async (sp) => changeLineTeacherTx(sp as unknown as Tx, line.id, { teacherId: data.teacherId, reason: data.reason }, actorId, ctx, { deferFollow: true }));
        changes.push(...r.changes);
        assigned.push({ studentId: line.studentId, registrationId: line.id, label: line.label });
      } catch (err) {
        if (!(err instanceof LineTeacherError)) throw err;
        refused.push({ studentId: line.studentId, name: nameOf.get(line.studentId) ?? '', registrationId: line.id, label: line.label, why: err.message });
      }
    }
    // A student with no line to carry the teacher: their enrolment takes it.
    const withLines = new Set(lines.map((l) => l.studentId));
    const bare = studentIds.filter((s) => !withLines.has(s));
    if (bare.length) {
      const open = await tx.select().from(courseEnrolment).where(and(
        inArray(courseEnrolment.studentId, bare), eq(courseEnrolment.academicYearId, y.id), isNull(courseEnrolment.endedOn), eq(courseEnrolment.mode, 'in_school'),
        unitId ? eq(courseEnrolment.unitId, unitId) : and(eq(courseEnrolment.subjectId, data.subjectId), isNull(courseEnrolment.unitId)),
      ));
      for (const s of bare) {
        const e = open.find((x) => x.studentId === s);
        if (!e) { refused.push({ studentId: s, name: nameOf.get(s) ?? '', registrationId: null, label: '', why: `${nameOf.get(s) ?? 'The student'} is not enrolled in school in this subject this year` }); continue; }
        if (e.teacherId) { refused.push({ studentId: s, name: nameOf.get(s) ?? '', registrationId: null, label: '', why: `${nameOf.get(s) ?? 'The student'} already has a teacher` }); continue; }
      }
      const rows = open.filter((e) => !e.teacherId).map((e) => ({ studentId: e.studentId, subjectId: e.subjectId, unitId: e.unitId, teacherId: data.teacherId, mode: 'in_school' as const, sourceRef: `assigned:${actorId}` }));
      if (rows.length) {
        const r = await upsertEnrolments(tx, y.id, rows, actorId, { source: 'manual', commit: true, ctx, follow: 'defer' });
        changes.push(...r.changes);
        for (const row of r.rows.filter((x) => x.outcome === 'updated')) assigned.push({ studentId: row.studentId, registrationId: null, label: '' });
      }
    }
    // The groups follow once, for everyone at a time.
    const followed = await followEnrolments(tx, changes, actorId, ctx);
    await logAction(actorId, 'TEACHING_GROUP_TEACHER_ASSIGNED', 'academic_year', y.id, null, {
      subjectId: data.subjectId, unitId, teacherId: data.teacherId, reason: data.reason,
      lines: assigned.filter((a) => a.registrationId).map((a) => a.registrationId), enrolments: changes.map((c) => c.enrolmentId),
      refused: refused.map((r) => ({ studentId: r.studentId, registrationId: r.registrationId, why: r.why })),
      moved: followed.moved.length, groupsGiven: followed.groupsGiven.map((g) => g.groupId), waiting: followed.waiting.length,
    }, ctx, tx);
    return { teacher: { id: t.id, name: t.name }, assigned, refused, followed };
  });
  const cover = await import('./cover.services');
  await cover.coverChangeNotices(result.followed.coversLost, 'no_longer_holds').catch((err) => console.error('[groups] cover notices failed:', err));
  return result;
}

// ─── For step D's "a teaching group" audience (RESERVATIONS_MESSAGES.md §2) ──

/**
 * The students in a group on a date (today by default), by §2's rules — a section's group follows
 * the section, the later membership wins a shared day, nobody after leaving. Step D's teaching-group
 * list reads it once F1 is on main (with `listGroups(academicYearId)` for its picker), in place of
 * the course enrolments it reads until then.
 */
export async function studentsOfGroup(groupId: string, date: string = todayAtSchool(), executor: Executor = db): Promise<string[]> {
  return [...new Set((await groupMembersBetween([groupId], date, date, executor)).map((m) => m.studentId))].sort();
}

// ─── Draft timetables follow the groups ──────────────────────────────────────

/**
 * Bring the lesson cards of the year's draft timetables in line with these
 * groups: a retired group loses its cards; a group's weekly periods and
 * doubles decide how many single and double cards it has (surplus cards go
 * unplaced first, then unlocked, then locked; new cards start unplaced).
 * Published timetables are never touched.
 */
export async function syncDraftCards(tx: Tx, groupIds: string[]) {
  const today = todayAtSchool();
  if (!groupIds.length) return { drafts: 0, added: 0, removed: 0 };
  const groups = await tx.select().from(teachingGroup).where(inArray(teachingGroup.id, groupIds));
  // A provider teaches outside the timetable: their groups have no lesson cards.
  const providerIds = new Set(groups.some((g) => g.teacherId)
    ? (await tx.select({ id: teacher.id }).from(teacher).where(and(inArray(teacher.id, groups.map((g) => g.teacherId).filter((x): x is string => !!x)), eq(teacher.kind, 'provider')))).map((t) => t.id)
    : []);
  const years = [...new Set(groups.map((g) => g.academicYearId))];
  const drafts = await tx.select({ id: timetable.id, academicYearId: timetable.academicYearId, termStart: academicTerm.startsOn, termEnd: academicTerm.endsOn })
    .from(timetable).innerJoin(academicTerm, eq(academicTerm.id, timetable.termId))
    .where(and(inArray(timetable.academicYearId, years), eq(timetable.status, 'draft')))
    .for('update', { of: timetable });
  let added = 0;
  let removed = 0;
  const changed = new Set<string>();
  for (const d of drafts) {
    for (const g of groups.filter((x) => x.academicYearId === d.academicYearId)) {
      const cards = await tx.select().from(timetableLesson).where(and(eq(timetableLesson.timetableId, d.id), eq(timetableLesson.groupId, g.id)));
      // A draft takes effect today or later (inside its term): a group retired by then is never taught under it.
      const retired = !!g.archivedOn && g.archivedOn <= (d.termStart > today ? d.termStart : today);
      const want = retired || (g.teacherId && providerIds.has(g.teacherId)) ? [] : cardsFor(g.weeklyPeriods, g.doublePeriods);
      const keep = new Set<string>();
      const pool = [...cards];
      const rank = (c: typeof cards[number]) => (c.weekday === null ? 0 : c.locked ? 2 : 1);
      const missing: number[] = [];
      for (const len of want) {
        const candidates = pool.filter((c) => c.length === len && !keep.has(c.id)).sort((a, b) => rank(b) - rank(a) || a.seq - b.seq);
        const pick = candidates[0];
        if (pick) keep.add(pick.id);
        else missing.push(len);
      }
      const drop = cards.filter((c) => !keep.has(c.id));
      if (drop.length) {
        await tx.delete(timetableLesson).where(inArray(timetableLesson.id, drop.map((c) => c.id)));
        removed += drop.length;
        changed.add(d.id);
      }
      let seq = Math.max(0, ...cards.map((c) => c.seq));
      if (missing.length) {
        await tx.insert(timetableLesson).values(missing.map((len) => ({ id: randomUUID(), timetableId: d.id, groupId: g.id, seq: ++seq, length: len })));
        added += missing.length;
        changed.add(d.id);
      }
    }
  }
  for (const id of changed) {
    await tx.update(timetable).set({ revision: sql`${timetable.revision} + 1`, updatedAt: new Date() }).where(eq(timetable.id, id));
  }
  return { drafts: changed.size, added, removed };
}

/**
 * The groups a new draft of a term holds: those not retired by the day it can
 * first take effect (the term's start, or today once the term has begun).
 */
export async function groupsForTerm(tx: Executor, academicYearId: string, termStart: string) {
  const today = todayAtSchool();
  const from = termStart > today ? termStart : today;
  return tx.select().from(teachingGroup)
    .where(and(eq(teachingGroup.academicYearId, academicYearId), sql`(${teachingGroup.archivedOn} IS NULL OR ${teachingGroup.archivedOn} > ${from})`));
}

export { peakSize };
