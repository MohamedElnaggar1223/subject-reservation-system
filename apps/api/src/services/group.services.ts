/**
 * Teaching groups (FEATURES_PLAN.md F1): who is taught together, by whom, and
 * how many periods a week.
 *
 * - Formed from the year's course enrolment (F0b's `getTeachingDemand`): one
 *   group per subject and teacher, the students taught in school — self-study
 *   forms no group. Forming is a preview, then a commit; running it again
 *   adds only the students not yet in a group of the subject, and takes out
 *   of formed groups the students no longer enrolled in school.
 * - From homeroom sections, for a subject a section is taught together (a
 *   national subject, PE): one group per section, whose students are the
 *   section's on each date.
 * - Staff add and take out students, split a group (some students into new
 *   groups), merge groups, and retire one; history is kept (a membership ends,
 *   it is never deleted). A student is in one open group per subject a year
 *   (the database holds it), and a move cannot be dated before the student
 *   joined their current group (the lesson of STATE_AUDIT ST-16).
 * - Draft timetables of the year follow a group's weekly periods: its lesson
 *   cards are added or taken away (`syncDraftCards`). Published timetables
 *   never change.
 */

import {
  db, teachingGroup, teachingGroupMember, timetable, timetableLesson, academicYear, academicTerm, subject, teacher, section,
  courseEnrolment, user, room, subjectTeacher, eq, and, inArray, isNull, sql, asc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  cardsFor, gradeInAcademicYear, schoolDateString,
  type FormGroupsType, type CreateSectionGroupsType, type CreateGroupType, type UpdateGroupType, type AddGroupMembersType,
  type EndGroupMembersType, type SplitGroupType, type MergeGroupsType, type ArchiveGroupType,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { getTeachingDemand } from './enrolment.services';
import {
  SchedulingError, isUniqueViolation, addDays, readableDate, groupMembersBetween, peakSize, type Tx, type Executor,
} from './scheduling-shared.services';

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
  const today = schoolDateString(new Date());
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

async function assertRoom(tx: Executor, roomId: string | null | undefined) {
  if (!roomId) return;
  const [r] = await tx.select({ name: room.name, isActive: room.isActive }).from(room).where(eq(room.id, roomId));
  if (!r) throw new SchedulingError('Room not found', 404);
  if (!r.isActive) throw new SchedulingError(`${r.name} is out of use`);
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** The year's groups with their teacher, subject, section, size today and weekly load. */
export async function listGroups(academicYearId: string) {
  const y = await yearOrThrow(academicYearId);
  const groups = await db.query.teachingGroup.findMany({
    where: (g, { eq: eqOp }) => eqOp(g.academicYearId, y.id),
    with: {
      subject: { columns: { id: true, name: true, code: true, qualificationLevel: true } },
      teacher: { columns: { id: true, name: true, isActive: true } },
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
      cards: cardsFor(g.weeklyPeriods, g.doublePeriods).length,
    })),
  };
}

/** One group: its students today (with section), its history, its splits. */
export async function getGroup(id: string) {
  const g = await db.query.teachingGroup.findFirst({
    where: (x, { eq: eqOp }) => eqOp(x.id, id),
    with: {
      subject: { columns: { id: true, name: true, code: true } },
      teacher: { columns: { id: true, name: true } },
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
  teacher: { id: string; name: string } | null;
  action: 'create' | 'update' | 'unchanged';
  adding: { studentId: string; name: string; section: string | null; enrolmentId: string; startedOn: string }[];
  removing: { studentId: string; name: string; memberId: string; why: string }[];
  total: number;
};

/**
 * The year's groups from its course enrolment: a group per subject and
 * teacher of the in-school enrolments; students already in a group of the
 * subject stay where they are (a split or a merge made by hand is kept); a
 * formed group's student with no in-school enrolment of its subject any more
 * is taken out. Preview (commit false) writes nothing; commit is idempotent
 * and one at a time per year.
 */
export async function formGroups(data: FormGroupsType, actorId: string, ctx?: AuditContext) {
  const y = await yearOrThrow(data.academicYearId);
  const startsOn = defaultStart(y, data.startsOn);
  const weeklyPeriods = data.weeklyPeriods ?? 4;
  const run = async (tx: Tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'teaching-groups:' + y.id}))`);
    const demand = await getTeachingDemand(y.id);
    const enrolments = await tx
      .select({ id: courseEnrolment.id, studentId: courseEnrolment.studentId, subjectId: courseEnrolment.subjectId, teacherId: courseEnrolment.teacherId, startedOn: courseEnrolment.startedOn })
      .from(courseEnrolment)
      .where(and(eq(courseEnrolment.academicYearId, y.id), isNull(courseEnrolment.endedOn), eq(courseEnrolment.mode, 'in_school')));
    const enrolmentOf = new Map(enrolments.map((e) => [`${e.studentId}|${e.subjectId}`, e]));
    const groups = await tx.select().from(teachingGroup).where(and(eq(teachingGroup.academicYearId, y.id), isNull(teachingGroup.archivedOn)));
    const open = await tx
      .select({ id: teachingGroupMember.id, groupId: teachingGroupMember.groupId, studentId: teachingGroupMember.studentId, subjectId: teachingGroupMember.subjectId, name: user.name })
      .from(teachingGroupMember).innerJoin(user, eq(user.id, teachingGroupMember.studentId))
      .where(and(eq(teachingGroupMember.academicYearId, y.id), isNull(teachingGroupMember.endedOn)));
    const grouped = new Set(open.filter((m) => m.subjectId).map((m) => `${m.studentId}|${m.subjectId}`));
    const sizeNow = new Map<string, number>();
    for (const m of open) sizeNow.set(m.groupId, (sizeNow.get(m.groupId) ?? 0) + 1);

    const plans: Planned[] = [];
    const teacherDiffers: { studentId: string; name: string; subject: string; group: string; enrolledWith: string | null }[] = [];
    const groupById = new Map(groups.map((g) => [g.id, g]));
    for (const d of demand) {
      const sameSubject = groups.filter((g) => g.subjectId === d.subjectId && g.kind !== 'section');
      const mine = sameSubject
        .filter((g) => (g.teacherId ?? null) === (d.teacherId ?? null))
        .sort((a, b) => (sizeNow.get(a.id) ?? 0) - (sizeNow.get(b.id) ?? 0) || a.name.localeCompare(b.name));
      const target = mine[0] ?? null;
      const oneTeacher = new Set(demand.filter((x) => x.subjectId === d.subjectId).map((x) => x.teacherId)).size === 1;
      const name = target?.name
        ?? (d.teacherId ? (oneTeacher ? d.subjectName : `${d.subjectName} — ${d.teacherName}`) : `${d.subjectName} (no teacher yet)`);
      const adding: Planned['adding'] = [];
      for (const s of d.students) {
        if (grouped.has(`${s.studentId}|${d.subjectId}`)) {
          const m = open.find((x) => x.studentId === s.studentId && x.subjectId === d.subjectId)!;
          const g = groupById.get(m.groupId);
          if (g && (g.teacherId ?? null) !== (d.teacherId ?? null)) {
            teacherDiffers.push({ studentId: s.studentId, name: s.name, subject: d.subjectName, group: g.name, enrolledWith: d.teacherName });
          }
          continue;
        }
        const e = enrolmentOf.get(`${s.studentId}|${d.subjectId}`)!;
        adding.push({ studentId: s.studentId, name: s.name, section: s.section, enrolmentId: e.id, startedOn: e.startedOn > startsOn ? e.startedOn : startsOn });
      }
      plans.push({
        groupId: target?.id ?? null,
        name,
        subject: { id: d.subjectId, name: d.subjectName, code: d.subjectCode },
        teacher: d.teacherId ? { id: d.teacherId, name: d.teacherName ?? '' } : null,
        action: target ? (adding.length ? 'update' : 'unchanged') : 'create',
        adding,
        removing: [],
        total: (target ? sizeNow.get(target.id) ?? 0 : 0) + adding.length,
      });
    }
    // Formed groups' students no longer taught the subject in school.
    for (const g of groups.filter((x) => x.kind === 'enrolment')) {
      const leaving = open.filter((m) => m.groupId === g.id && !enrolmentOf.has(`${m.studentId}|${g.subjectId}`));
      if (!leaving.length) continue;
      let plan = plans.find((p) => p.groupId === g.id);
      if (!plan) {
        const [s] = await tx.select({ id: subject.id, name: subject.name, code: subject.code }).from(subject).where(eq(subject.id, g.subjectId!));
        const [t] = g.teacherId ? await tx.select({ id: teacher.id, name: teacher.name }).from(teacher).where(eq(teacher.id, g.teacherId)) : [];
        plan = { groupId: g.id, name: g.name, subject: s!, teacher: t ?? null, action: 'update', adding: [], removing: [], total: sizeNow.get(g.id) ?? 0 };
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
    if (data.commit) {
      const touched: string[] = [];
      for (const p of plans) {
        if (p.action === 'unchanged') continue;
        let groupId = p.groupId;
        if (!groupId) {
          groupId = randomUUID();
          await tx.insert(teachingGroup).values({
            id: groupId, academicYearId: y.id, name: uniqueName(p.name, groups.map((g) => g.name)), subjectId: p.subject.id, teacherId: p.teacher?.id ?? null,
            kind: 'enrolment', weeklyPeriods, doublePeriods: 0, createdBy: actorId,
          });
          groups.push({ name: p.name } as typeof groups[number]);
          p.groupId = groupId;
          created++;
        }
        if (p.adding.length) {
          await tx.insert(teachingGroupMember).values(p.adding.map((a) => ({
            id: randomUUID(), groupId: groupId!, studentId: a.studentId, academicYearId: y.id, subjectId: p.subject.id, enrolmentId: a.enrolmentId, startedOn: a.startedOn, addedBy: actorId,
          })));
          added += p.adding.length;
        }
        for (const r of p.removing) {
          const [m] = await tx.select({ startedOn: teachingGroupMember.startedOn }).from(teachingGroupMember).where(eq(teachingGroupMember.id, r.memberId));
          const endedOn = lastDayOf(m!.startedOn, addDays(startsOn, -1));
          await tx.update(teachingGroupMember).set({ endedOn, endReason: 'No longer enrolled in school in this subject', endedBy: actorId }).where(eq(teachingGroupMember.id, r.memberId));
          removed++;
        }
        touched.push(groupId!);
      }
      if (touched.length) {
        await syncDraftCards(tx, touched);
        await logAction(actorId, 'TEACHING_GROUPS_FORMED', 'academic_year', y.id, null, { created, added, removed, startsOn }, ctx, tx);
      }
    }
    return { academicYearId: y.id, startsOn, committed: data.commit, groups: plans, teacherDiffers, created, added, removed };
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
      await assertTeacher(tx, data.teacherId);
      await assertRoom(tx, data.roomId);
      if (data.subjectId) {
        const [s] = await tx.select({ id: subject.id }).from(subject).where(eq(subject.id, data.subjectId));
        if (!s) throw new SchedulingError('Subject not found', 404);
      }
      const id = randomUUID();
      await tx.insert(teachingGroup).values({
        id, academicYearId: y.id, name: data.name, subjectId: data.subjectId ?? null, teacherId: data.teacherId ?? null, kind: 'manual',
        weeklyPeriods: data.weeklyPeriods, doublePeriods: data.doublePeriods, roomType: data.roomType ?? null, roomFeatures: data.roomFeatures ?? [], roomId: data.roomId ?? null,
        createdBy: actorId,
      });
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
  try {
    return await db.transaction(async (tx) => {
      const g = await groupOrThrow(id, tx, true);
      if (g.archivedOn) throw new SchedulingError('This group is retired — it is kept as history', 409);
      if (data.teacherId !== undefined) await assertTeacher(tx, data.teacherId);
      if (data.roomId) await assertRoom(tx, data.roomId);
      const weeklyPeriods = data.weeklyPeriods ?? g.weeklyPeriods;
      const doublePeriods = data.doublePeriods ?? g.doublePeriods;
      if (doublePeriods * 2 > weeklyPeriods) throw new SchedulingError('Doubles take two periods each: they cannot exceed the weekly periods');
      const next = {
        name: data.name ?? g.name,
        teacherId: data.teacherId !== undefined ? data.teacherId : g.teacherId,
        weeklyPeriods,
        doublePeriods,
        roomType: data.roomType !== undefined ? data.roomType : g.roomType,
        roomFeatures: data.roomFeatures ?? g.roomFeatures,
        roomId: data.roomId !== undefined ? data.roomId : g.roomId,
      };
      await tx.update(teachingGroup).set({ ...next, updatedAt: new Date() }).where(eq(teachingGroup.id, id));
      const linked = next.teacherId !== g.teacherId ? await linkTeacherToSubject(tx, next.teacherId, g.subjectId) : false;
      const cards = weeklyPeriods !== g.weeklyPeriods || doublePeriods !== g.doublePeriods ? await syncDraftCards(tx, [id]) : { drafts: 0, added: 0, removed: 0 };
      await logAction(actorId, 'TEACHING_GROUP_UPDATED', 'teaching_group', id,
        { name: g.name, teacherId: g.teacherId, weeklyPeriods: g.weeklyPeriods, doublePeriods: g.doublePeriods, roomType: g.roomType, roomFeatures: g.roomFeatures, roomId: g.roomId },
        { ...next, teacherLinkedToSubject: linked, cards }, ctx, tx);
      return { id, cards };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new SchedulingError(`That year already has a group named ${data.name}`, 409);
    throw err;
  }
}

// ─── Membership ──────────────────────────────────────────────────────────────

async function addMembersTx(tx: Tx, groupId: string, studentIds: string[], startsOn: string, actorId: string) {
  const g = await groupOrThrow(groupId, tx, true);
  if (g.kind === 'section') throw new SchedulingError("This group's students are its section's — change the section on the Sections screen", 409);
  if (g.archivedOn) throw new SchedulingError('This group is retired — it is kept as history', 409);
  const [y] = await tx.select().from(academicYear).where(eq(academicYear.id, g.academicYearId));
  const ids = [...new Set(studentIds)];
  const students = await tx.select({ id: user.id, name: user.name, role: user.role, cohortYear: user.cohortYear, leftOn: user.leftOn })
    .from(user).where(inArray(user.id, ids)).orderBy(user.id).for('update');
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

  // Already in a group of this subject: moved from it (the move cannot predate joining it).
  const current = g.subjectId
    ? await tx.select({ id: teachingGroupMember.id, studentId: teachingGroupMember.studentId, groupId: teachingGroupMember.groupId, startedOn: teachingGroupMember.startedOn, groupName: teachingGroup.name })
      .from(teachingGroupMember).innerJoin(teachingGroup, eq(teachingGroup.id, teachingGroupMember.groupId))
      .where(and(inArray(teachingGroupMember.studentId, ids), eq(teachingGroupMember.subjectId, g.subjectId), eq(teachingGroupMember.academicYearId, g.academicYearId), isNull(teachingGroupMember.endedOn)))
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
        .where(and(inArray(courseEnrolment.studentId, toAdd), eq(courseEnrolment.subjectId, g.subjectId), eq(courseEnrolment.academicYearId, g.academicYearId), isNull(courseEnrolment.endedOn)))
      : [];
    await tx.insert(teachingGroupMember).values(toAdd.map((studentId) => ({
      id: randomUUID(), groupId: g.id, studentId, academicYearId: g.academicYearId, subjectId: g.subjectId,
      enrolmentId: enrolments.find((e) => e.studentId === studentId)?.id ?? null, startedOn: startsOn, addedBy: actorId,
    })));
  }
  return { added: toAdd.length, moved, alreadyIn: ids.length - toAdd.length };
}

export async function addGroupMembers(groupId: string, data: AddGroupMembersType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      const g = await groupOrThrow(groupId, tx);
      const [y] = await tx.select().from(academicYear).where(eq(academicYear.id, g.academicYearId));
      const startsOn = defaultStart(y!, data.startsOn);
      const r = await addMembersTx(tx, groupId, data.studentIds, startsOn, actorId);
      if (r.added) await logAction(actorId, 'TEACHING_GROUP_MEMBERS_ADDED', 'teaching_group', groupId, null, { studentIds: data.studentIds, startsOn, ...r }, ctx, tx);
      return r;
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
    const endedOn = data.endedOn ?? schoolDateString(new Date());
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
      for (const p of data.parts) {
        await assertTeacher(tx, p.teacherId);
        const id = randomUUID();
        await tx.insert(teachingGroup).values({
          id, academicYearId: g.academicYearId, name: p.name, subjectId: g.subjectId, teacherId: p.teacherId !== undefined ? p.teacherId : g.teacherId,
          kind: 'manual', weeklyPeriods: g.weeklyPeriods, doublePeriods: g.doublePeriods, roomType: g.roomType, roomFeatures: g.roomFeatures, roomId: g.roomId,
          splitFromGroupId: g.id, createdBy: actorId,
        });
        await linkTeacherToSubject(tx, p.teacherId ?? null, g.subjectId);
        await addMembersTx(tx, id, p.studentIds, startsOn, actorId);
        made.push({ id, name: p.name, students: p.studentIds.length });
      }
      await syncDraftCards(tx, made.map((m) => m.id));
      await logAction(actorId, 'TEACHING_GROUP_SPLIT', 'teaching_group', groupId, null, { into: made, startsOn }, ctx, tx);
      return { groups: made, startsOn };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new SchedulingError('A group with one of those names already exists this year', 409);
    throw err;
  }
}

/** Groups of one subject into one: their students move, and they are retired from the day. */
export async function mergeGroups(data: MergeGroupsType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const into = await groupOrThrow(data.intoGroupId, tx, true);
    const others = [];
    for (const id of [...new Set(data.groupIds)].filter((x) => x !== into.id)) others.push(await groupOrThrow(id, tx, true));
    if (!others.length) throw new SchedulingError('Choose the groups to merge in');
    for (const g of [into, ...others]) {
      if (g.kind === 'section') throw new SchedulingError(`${g.name} follows its section and cannot be merged — retire it and add its students to a group by hand`, 409);
      if (g.archivedOn) throw new SchedulingError(`${g.name} is retired`, 409);
      if (g.academicYearId !== into.academicYearId) throw new SchedulingError(`${g.name} belongs to another academic year`);
      if ((g.subjectId ?? null) !== (into.subjectId ?? null)) throw new SchedulingError(`${g.name} teaches another subject than ${into.name}`);
    }
    const [y] = await tx.select().from(academicYear).where(eq(academicYear.id, into.academicYearId));
    const startsOn = defaultStart(y!, data.startsOn);
    let movedStudents = 0;
    for (const g of others) {
      const members = await tx.select({ studentId: teachingGroupMember.studentId }).from(teachingGroupMember)
        .where(and(eq(teachingGroupMember.groupId, g.id), isNull(teachingGroupMember.endedOn)));
      if (members.length) movedStudents += (await addMembersTx(tx, into.id, members.map((m) => m.studentId), startsOn, actorId)).added;
      await archiveTx(tx, g.id, startsOn, `Merged into ${into.name}`, actorId);
    }
    await logAction(actorId, 'TEACHING_GROUPS_MERGED', 'teaching_group', into.id, null, { merged: others.map((g) => ({ id: g.id, name: g.name })), startsOn, movedStudents }, ctx, tx);
    return { into: into.id, merged: others.length, movedStudents, startsOn };
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
 * A student stopped being taught a subject in school (the enrolment ended or
 * became self-study): they leave its group from the next day, in the same
 * transaction.
 */
export async function endGroupMembershipsForSubject(tx: Tx, studentId: string, subjectId: string, academicYearId: string, lastDay: string, reason: string, actorId: string) {
  const open = await tx.select({ id: teachingGroupMember.id, startedOn: teachingGroupMember.startedOn }).from(teachingGroupMember)
    .where(and(eq(teachingGroupMember.studentId, studentId), eq(teachingGroupMember.subjectId, subjectId), eq(teachingGroupMember.academicYearId, academicYearId), isNull(teachingGroupMember.endedOn)))
    .for('update');
  for (const m of open) {
    await tx.update(teachingGroupMember)
      .set({ endedOn: lastDayOf(m.startedOn, lastDay), endReason: reason, endedBy: actorId })
      .where(eq(teachingGroupMember.id, m.id));
  }
  return open.length;
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
  if (!groupIds.length) return { drafts: 0, added: 0, removed: 0 };
  const groups = await tx.select().from(teachingGroup).where(inArray(teachingGroup.id, groupIds));
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
      const retired = !!g.archivedOn && g.archivedOn <= d.termStart;
      const want = retired ? [] : cardsFor(g.weeklyPeriods, g.doublePeriods);
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

/** The groups of a year that are taught in a term (not retired before it starts). */
export async function groupsForTerm(tx: Executor, academicYearId: string, termStart: string) {
  return tx.select().from(teachingGroup)
    .where(and(eq(teachingGroup.academicYearId, academicYearId), sql`(${teachingGroup.archivedOn} IS NULL OR ${teachingGroup.archivedOn} > ${termStart})`));
}

export { peakSize };
