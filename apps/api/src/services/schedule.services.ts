/**
 * What happens on a date (FEATURES_PLAN.md F1, "Views" and §2's contract).
 *
 * `getScheduleFor(target, date)` and `getScheduleRange(target, from, to)` —
 * the contract F2 (campus leave: the lessons and teachers a leave affects)
 * and F3 (attendance: the lessons a student is expected at, the registers a
 * teacher takes) read. For a student or a teacher, each date gives:
 * - what the day is (F0a's calendar: a school day, a holiday, the weekend,
 *   between terms, an early dismissal or an exam-only day) and which published
 *   timetable is in force;
 * - the lessons held that day, each with its period(s), times from that day's
 *   bells, group, subject, room, the teacher who teaches it that day (cover
 *   applied) and the one scheduled, and its status;
 * - the lessons not held and why (a short day's bells have no such period; an
 *   exam-only day holds no lessons).
 * A student's lessons are those of the groups they are in on that date (the
 * membership rules of scheduling-shared: section groups follow the section,
 * the later membership wins a shared day, nothing after leaving the school).
 * A teacher's are the lessons of the groups they teach — minus those another
 * teacher covers or that are cancelled (listed with that status) — plus the
 * lessons they cover.
 *
 * `lessonAccess` and `classListFor` decide who may see a lesson's students on
 * a date: its own teacher, a cover teacher on the covered date only, and the
 * coordinator and admin (F3's registers build on it).
 *
 * The calendar feed: a per-user secret link (only its hash is kept) that a
 * calendar app polls; revoking it ends the feed at once.
 */

import {
  db, timetable, timetableLesson, teachingGroup, academicTerm, subject, teacher, room, coverAssignment, teacherAbsence, section,
  sectionMembership, user, parentStudentLink, calendarFeedToken, eq, and, inArray, isNull, sql, asc, or, gte, lte, ne,
} from '@repo/db';
import { randomBytes, createHash, randomUUID } from 'crypto';
import { ACADEMIC_ROLES, hasRole, schoolDateString, WEEKDAY_NAMES, type LessonStatus, type LessonOnDay, type DaySchedule, type SchedulePerson } from '@repo/validations';
import { getSchoolDays } from './academic.services';
import { logAction, type AuditContext } from './audit.services';
import { gridOfYear } from './timetable.services';
import {
  SchedulingError, addDays, maxDate, minDate, weekStartOf, cairoInstant, readableDate, groupMembersBetween, candidateGroupsOfStudent, type MemberInterval,
} from './scheduling-shared.services';

export type ScheduleTarget = { studentId: string } | { teacherId: string } | { roomId: string } | { sectionId: string };

// The shape of a day (§2's contract) lives in @repo/validations so the web can name it.
export type { LessonStatus, LessonOnDay, NotHeld, DaySchedule } from '@repo/validations';
type Person = SchedulePerson;

// ─── The range ───────────────────────────────────────────────────────────────

/**
 * Each date's schedule for a student, a teacher, a room or a section, from
 * `from` to `to` (at most 400 days). The one reader every view, the cover
 * screen, the calendar feed, F2 and F3 go through.
 */
export async function getScheduleRange(target: ScheduleTarget, from: string, to: string): Promise<DaySchedule[]> {
  const days = await getSchoolDays(from, to);
  const termIds = [...new Set(days.map((d) => d.term?.id).filter((x): x is string => !!x))];
  const versions = termIds.length
    ? await db.select().from(timetable).where(and(inArray(timetable.termId, termIds), eq(timetable.status, 'published')))
    : [];
  const versionOn = (termId: string | undefined, date: string) => versions
    .filter((v) => v.termId === termId && v.effectiveFrom! <= date)
    .sort((a, b) => b.effectiveFrom!.localeCompare(a.effectiveFrom!) || b.publishedAt!.getTime() - a.publishedAt!.getTime())[0] ?? null;
  const usedVersionIds = [...new Set(days.map((d) => versionOn(d.term?.id, d.date)?.id).filter((x): x is string => !!x))];

  // Which groups (and, for students, when) the target reaches.
  let memberIntervals: MemberInterval[] = [];
  let groupFilter: Set<string> | null = null;
  let coverTeacherId: string | null = null;
  let leftOn: string | null = null;
  let sectionStudentsOn: ((date: string) => Set<string>) | null = null;
  if ('studentId' in target) {
    const [s] = await db.select({ leftOn: user.leftOn }).from(user).where(eq(user.id, target.studentId));
    leftOn = s?.leftOn ?? null;
    const candidates = await candidateGroupsOfStudent(target.studentId, from, to);
    memberIntervals = (await groupMembersBetween(candidates, from, to)).filter((m) => m.studentId === target.studentId);
    groupFilter = new Set(memberIntervals.map((m) => m.groupId));
  } else if ('teacherId' in target) {
    coverTeacherId = target.teacherId;
    const taught = await db.select({ id: teachingGroup.id }).from(teachingGroup).where(eq(teachingGroup.teacherId, target.teacherId));
    groupFilter = new Set(taught.map((g) => g.id));
  } else if ('sectionId' in target) {
    const [sec] = await db.select().from(section).where(eq(section.id, target.sectionId));
    if (!sec) throw new SchedulingError('Section not found', 404);
    const yearGroups = await db.select({ id: teachingGroup.id }).from(teachingGroup).where(eq(teachingGroup.academicYearId, sec.academicYearId));
    memberIntervals = await groupMembersBetween(yearGroups.map((g) => g.id), from, to);
    const own = await db.select({ id: teachingGroup.id }).from(teachingGroup).where(and(eq(teachingGroup.kind, 'section'), eq(teachingGroup.sectionId, sec.id)));
    const ownMembers = await groupMembersBetween([own[0]?.id ?? '__none__'], from, to);
    // The section's students on a date: read through a group of its own when it has one, else from its membership rows.
    const rows = await db.select().from(sectionMembership).where(eq(sectionMembership.sectionId, sec.id));
    sectionStudentsOn = (date: string) => new Set(
      own.length
        ? ownMembers.filter((m) => m.from <= date && m.to >= date).map((m) => m.studentId)
        : rows.filter((r) => r.startedOn <= date && (r.endedOn === null || r.endedOn >= date)).map((r) => r.studentId),
    );
  }

  const lessons = usedVersionIds.length
    ? await db.select({
      l: timetableLesson, groupName: teachingGroup.name, groupTeacherId: teachingGroup.teacherId, archivedOn: teachingGroup.archivedOn,
      subjectId: subject.id, subjectName: subject.name, subjectCode: subject.code, roomName: room.name,
    }).from(timetableLesson)
      .innerJoin(teachingGroup, eq(teachingGroup.id, timetableLesson.groupId))
      .leftJoin(subject, eq(subject.id, teachingGroup.subjectId))
      .leftJoin(room, eq(room.id, timetableLesson.roomId))
      .where(and(inArray(timetableLesson.timetableId, usedVersionIds), sql`${timetableLesson.weekday} IS NOT NULL`))
    : [];
  const lessonIds = lessons.map((x) => x.l.id);
  const covers = lessonIds.length || coverTeacherId
    ? await db.select().from(coverAssignment).where(and(
      gte(coverAssignment.date, from), lte(coverAssignment.date, to), ne(coverAssignment.status, 'removed'),
      coverTeacherId
        ? or(inArray(coverAssignment.lessonId, lessonIds.concat('__none__')), eq(coverAssignment.coverTeacherId, coverTeacherId))
        : inArray(coverAssignment.lessonId, lessonIds.concat('__none__')),
    ))
    : [];
  // Lessons a teacher covers may belong to versions or groups not loaded yet.
  const extraIds = covers.map((c) => c.lessonId).filter((id) => !lessonIds.includes(id));
  if (extraIds.length) {
    lessons.push(...await db.select({
      l: timetableLesson, groupName: teachingGroup.name, groupTeacherId: teachingGroup.teacherId, archivedOn: teachingGroup.archivedOn,
      subjectId: subject.id, subjectName: subject.name, subjectCode: subject.code, roomName: room.name,
    }).from(timetableLesson)
      .innerJoin(teachingGroup, eq(teachingGroup.id, timetableLesson.groupId))
      .leftJoin(subject, eq(subject.id, teachingGroup.subjectId))
      .leftJoin(room, eq(room.id, timetableLesson.roomId))
      .where(inArray(timetableLesson.id, extraIds)));
  }
  const teacherIds = [...new Set([
    ...lessons.map((x) => x.groupTeacherId), ...covers.map((c) => c.coverTeacherId), ...covers.map((c) => c.originalTeacherId),
  ].filter((x): x is string => !!x))];
  const teachers = new Map((teacherIds.length ? await db.select({ id: teacher.id, name: teacher.name }).from(teacher).where(inArray(teacher.id, teacherIds)) : []).map((t) => [t.id, t]));
  const absences = teacherIds.length
    ? await db.select().from(teacherAbsence).where(and(inArray(teacherAbsence.teacherId, teacherIds), isNull(teacherAbsence.cancelledAt), lte(teacherAbsence.startsOn, to), gte(teacherAbsence.endsOn, from)))
    : [];
  const absent = (teacherId: string | null, date: string, periods: number[]) => !!teacherId && absences.some((a) =>
    a.teacherId === teacherId && a.startsOn <= date && a.endsOn >= date && (!a.periods || a.periods.some((p) => periods.includes(p))));

  const out: DaySchedule[] = [];
  for (const d of days) {
    const version = d.isSchoolDay ? versionOn(d.term?.id, d.date) : null;
    const day: DaySchedule = {
      date: d.date, weekday: d.weekday, kind: d.kind, isSchoolDay: d.isSchoolDay, term: d.term, entry: d.entry ? { kind: d.entry.kind, name: d.entry.name } : null,
      bellSchedule: d.bellSchedule, timetable: version ? { id: version.id, name: version.name, effectiveFrom: version.effectiveFrom! } : null,
      note: null, lessons: [], notHeld: [],
    };
    out.push(day);
    if (!d.isSchoolDay) {
      day.note = d.kind === 'holiday' ? 'holiday' : d.kind === 'weekend' ? 'weekend' : d.kind === 'no_academic_year' ? 'no_academic_year' : 'out_of_term';
      continue;
    }
    if (leftOn && d.date > leftOn) { day.note = 'left'; continue; }
    const lessonPeriods = d.periods.filter((p) => p.kind === 'lesson');
    const sectionNow = sectionStudentsOn ? sectionStudentsOn(d.date) : null;
    const coverHere = covers.filter((c) => c.date === d.date);
    const todays = lessons.filter((x) => {
      const inVersion = !!version && x.l.timetableId === version.id && x.l.weekday === d.weekday;
      if (x.archivedOn && x.archivedOn <= d.date) return false;
      if ('teacherId' in target) {
        const covering = coverHere.some((c) => c.lessonId === x.l.id && c.coverTeacherId === target.teacherId && c.status === 'assigned');
        return covering || (inVersion && groupFilter!.has(x.l.groupId));
      }
      if (!inVersion) return false;
      if ('studentId' in target) return memberIntervals.some((m) => m.groupId === x.l.groupId && m.from <= d.date && m.to >= d.date);
      if ('roomId' in target) return x.l.roomId === target.roomId;
      if ('sectionId' in target) return memberIntervals.some((m) => m.groupId === x.l.groupId && m.from <= d.date && m.to >= d.date && sectionNow!.has(m.studentId));
      return false;
    });
    if (d.kind === 'exam_only') {
      day.note = 'exam_only';
      day.notHeld = todays.map((x) => ({ lessonId: x.l.id, groupName: x.groupName, period: x.l.period!, reason: 'exam_only' as const }));
      continue;
    }
    if (!version && !('teacherId' in target && todays.length)) { day.note = 'no_timetable'; continue; }
    for (const x of todays.sort((a, b) => a.l.period! - b.l.period! || a.groupName.localeCompare(b.groupName))) {
      const periods = Array.from({ length: x.l.length }, (_, k) => x.l.period! + k).filter((p) => p <= lessonPeriods.length);
      if (!periods.length) {
        day.notHeld.push({ lessonId: x.l.id, groupName: x.groupName, period: x.l.period!, reason: 'short_day' });
        continue;
      }
      const first = lessonPeriods[periods[0]! - 1]!;
      const last = lessonPeriods[periods[periods.length - 1]! - 1]!;
      const cover = coverHere.find((c) => c.lessonId === x.l.id) ?? null;
      const scheduled = x.groupTeacherId ? teachers.get(x.groupTeacherId) ?? null : null;
      const coverTeacher = cover?.coverTeacherId ? teachers.get(cover.coverTeacherId) ?? null : null;
      let status: LessonStatus;
      let who: Person | null = scheduled;
      if (cover?.status === 'cancelled') { status = 'cancelled'; who = null; }
      else if (cover?.status === 'assigned') { status = 'covered'; who = coverTeacher; }
      else if (absent(x.groupTeacherId, d.date, periods)) { status = 'uncovered'; who = null; }
      else status = 'scheduled';
      if ('teacherId' in target) {
        if (cover?.status === 'assigned' && cover.coverTeacherId === target.teacherId) status = 'covering';
        else if (cover?.status === 'assigned') status = 'covered_by_other';
      }
      const item: LessonOnDay = {
        lessonId: x.l.id, timetableId: x.l.timetableId, groupId: x.l.groupId, groupName: x.groupName,
        subject: x.subjectId ? { id: x.subjectId, name: x.subjectName!, code: x.subjectCode! } : null,
        period: x.l.period!, periods, label: periods.length > 1 ? `${first.label}–${last.label}` : first.label,
        startsAt: first.startsAt, endsAt: last.endsAt, length: periods.length,
        room: x.l.roomId ? { id: x.l.roomId, name: x.roomName ?? '' } : null,
        teacher: who, scheduledTeacher: scheduled, status,
        cover: cover ? { assignmentId: cover.id, status: cover.status as 'assigned' | 'cancelled', teacher: coverTeacher } : null,
      };
      if (sectionNow) item.sectionStudents = new Set(memberIntervals.filter((m) => m.groupId === x.l.groupId && m.from <= d.date && m.to >= d.date && sectionNow.has(m.studentId)).map((m) => m.studentId)).size;
      day.lessons.push(item);
    }
  }
  return out;
}

/** One date's schedule — the contract F2 and F3 call. */
export async function getScheduleFor(target: { studentId: string } | { teacherId: string }, date: string): Promise<DaySchedule> {
  return (await getScheduleRange(target, date, date))[0]!;
}

// ─── Views ───────────────────────────────────────────────────────────────────

/** A week (Sunday to Saturday) around a date, with the year's periods for the grid. */
export async function getWeek(target: ScheduleTarget, date: string) {
  const from = weekStartOf(date);
  const to = addDays(from, 6);
  const days = await getScheduleRange(target, from, to);
  const withTerm = days.find((d) => d.term);
  const yearId = (await getSchoolDays(date, date))[0]?.academicYear?.id
    ?? (withTerm ? (await getSchoolDays(withTerm.date, withTerm.date))[0]?.academicYear?.id : undefined);
  const grid = yearId ? await gridOfYear(yearId) : { days: [], bellScheduleName: null };
  let name = '';
  if ('studentId' in target) name = (await db.select({ name: user.name }).from(user).where(eq(user.id, target.studentId)))[0]?.name ?? '';
  if ('teacherId' in target) name = (await db.select({ name: teacher.name }).from(teacher).where(eq(teacher.id, target.teacherId)))[0]?.name ?? '';
  if ('roomId' in target) name = (await db.select({ name: room.name }).from(room).where(eq(room.id, target.roomId)))[0]?.name ?? '';
  if ('sectionId' in target) name = (await db.select({ name: section.name }).from(section).where(eq(section.id, target.sectionId)))[0]?.name ?? '';
  const kind = 'studentId' in target ? 'student' : 'teacherId' in target ? 'teacher' : 'roomId' in target ? 'room' : 'section';
  const id = 'studentId' in target ? target.studentId : 'teacherId' in target ? target.teacherId : 'roomId' in target ? target.roomId : target.sectionId;
  return { target: { kind, id, name }, date, from, to, grid: grid.days, days };
}

/**
 * May this account read this student's or teacher's timetable? A student
 * their own; a parent their linked child's; the desk, the coordinator and
 * admin any student's; a teacher their own teaching; the coordinator and
 * admin any teacher's, room's or section's. Anyone else is told it does not
 * exist (404), so nothing about another family or class is learned.
 */
export async function assertMayRead(viewer: { id: string; role?: string | null }, target: ScheduleTarget) {
  const academic = hasRole(viewer.role, ...ACADEMIC_ROLES);
  if ('studentId' in target) {
    if (viewer.id === target.studentId) return;
    if (hasRole(viewer.role, 'finance_officer', 'finance_admin', 'coordinator', 'admin')) {
      const [s] = await db.select({ role: user.role }).from(user).where(eq(user.id, target.studentId));
      if (s?.role === 'student') return;
      throw new SchedulingError('Student not found', 404);
    }
    if (viewer.role === 'parent') {
      const [link] = await db.select({ id: parentStudentLink.id }).from(parentStudentLink)
        .where(and(eq(parentStudentLink.parentId, viewer.id), eq(parentStudentLink.studentId, target.studentId), eq(parentStudentLink.status, 'approved')));
      if (link) return;
    }
    throw new SchedulingError('Student not found', 404);
  }
  if ('teacherId' in target) {
    if (academic) {
      const [t] = await db.select({ id: teacher.id }).from(teacher).where(eq(teacher.id, target.teacherId));
      if (t) return;
    } else {
      const [t] = await db.select({ id: teacher.id }).from(teacher).where(and(eq(teacher.id, target.teacherId), eq(teacher.userId, viewer.id)));
      if (t) return;
    }
    throw new SchedulingError('Teacher not found', 404);
  }
  if (!academic) throw new SchedulingError('Only the coordinator and the admin see room and section timetables', 403);
}

/** The signed-in account's own timetable target: a student's, or the teaching of a linked teacher record. */
export async function ownTarget(viewer: { id: string; role?: string | null }): Promise<{ studentId: string } | { teacherId: string }> {
  if (viewer.role === 'student') return { studentId: viewer.id };
  const [t] = await db.select({ id: teacher.id }).from(teacher).where(eq(teacher.userId, viewer.id));
  if (t) return { teacherId: t.id };
  if (viewer.role === 'parent') throw new SchedulingError("Choose a child to see their timetable", 404);
  throw new SchedulingError('Your account is not linked to a teacher record — ask the admin to link it on the Team page', 404);
}

// ─── A lesson on a date, and who may see its students ───────────────────────

/** The lesson as held on a date (from the version in force), or null when it does not take place then. */
export async function lessonOnDate(lessonId: string, date: string) {
  const [x] = await db.select({ l: timetableLesson, t: timetable, g: teachingGroup }).from(timetableLesson)
    .innerJoin(timetable, eq(timetable.id, timetableLesson.timetableId))
    .innerJoin(teachingGroup, eq(teachingGroup.id, timetableLesson.groupId))
    .where(eq(timetableLesson.id, lessonId));
  if (!x || x.t.status !== 'published' || x.l.weekday === null) return null;
  const day = (await getSchoolDays(date, date))[0]!;
  if (!day.isSchoolDay || day.kind === 'exam_only' || day.term?.id !== x.t.termId || day.weekday !== x.l.weekday) return null;
  const [inForce] = await db.select({ id: timetable.id }).from(timetable)
    .where(and(eq(timetable.termId, x.t.termId), eq(timetable.status, 'published'), sql`${timetable.effectiveFrom} <= ${date}`))
    .orderBy(sql`${timetable.effectiveFrom} desc`, sql`${timetable.publishedAt} desc`).limit(1);
  if (inForce?.id !== x.t.id) return null;
  if (x.g.archivedOn && x.g.archivedOn <= date) return null;
  const lessonPeriods = day.periods.filter((p) => p.kind === 'lesson');
  if (x.l.period! > lessonPeriods.length) return null;
  return { lesson: x.l, timetable: x.t, group: x.g, day };
}

/**
 * How an account may reach a lesson on a date: 'staff' (coordinator, admin),
 * 'teacher' (the group's own teacher), 'cover' (the teacher covering it that
 * date — that lesson and that date only), or null.
 */
export async function lessonAccess(viewer: { id: string; role?: string | null }, lessonId: string, date: string): Promise<'staff' | 'teacher' | 'cover' | null> {
  const held = await lessonOnDate(lessonId, date);
  if (!held) return null;
  if (hasRole(viewer.role, ...ACADEMIC_ROLES)) return 'staff';
  const [t] = await db.select({ id: teacher.id }).from(teacher).where(eq(teacher.userId, viewer.id));
  if (!t) return null;
  if (held.group.teacherId === t.id) return 'teacher';
  const [c] = await db.select({ id: coverAssignment.id }).from(coverAssignment)
    .where(and(eq(coverAssignment.lessonId, lessonId), eq(coverAssignment.date, date), eq(coverAssignment.status, 'assigned'), eq(coverAssignment.coverTeacherId, t.id)));
  return c ? 'cover' : null;
}

/** A lesson's students on a date, for whoever may reach it (404 otherwise: another class is not theirs). */
export async function classListFor(viewer: { id: string; role?: string | null }, lessonId: string, date: string) {
  const access = await lessonAccess(viewer, lessonId, date);
  if (!access) throw new SchedulingError('Lesson not found on that date', 404);
  const held = (await lessonOnDate(lessonId, date))!;
  const members = await groupMembersBetween([held.group.id], date, date);
  const ids = [...new Set(members.map((m) => m.studentId))];
  const students = ids.length
    ? await db.select({ id: user.id, name: user.name, studentCode: user.studentId }).from(user).where(inArray(user.id, ids)).orderBy(asc(user.name))
    : [];
  const sectionRows = ids.length
    ? await db.select({ studentId: sectionMembership.studentId, name: section.name, startedOn: sectionMembership.startedOn, createdAt: sectionMembership.createdAt })
      .from(sectionMembership).innerJoin(section, eq(section.id, sectionMembership.sectionId))
      .where(and(inArray(sectionMembership.studentId, ids), sql`${sectionMembership.startedOn} <= ${date}`, sql`(${sectionMembership.endedOn} IS NULL OR ${sectionMembership.endedOn} >= ${date})`))
    : [];
  const sectionOf = new Map<string, string>();
  for (const r of sectionRows.sort((a, b) => a.startedOn.localeCompare(b.startedOn) || a.createdAt.getTime() - b.createdAt.getTime())) sectionOf.set(r.studentId, r.name);
  const lessonPeriods = held.day.periods.filter((p) => p.kind === 'lesson');
  const periods = Array.from({ length: held.lesson.length }, (_, k) => held.lesson.period! + k).filter((p) => p <= lessonPeriods.length);
  const first = lessonPeriods[periods[0]! - 1]!;
  const last = lessonPeriods[periods[periods.length - 1]! - 1]!;
  const [cover] = await db.select({ status: coverAssignment.status, coverTeacherId: coverAssignment.coverTeacherId }).from(coverAssignment)
    .where(and(eq(coverAssignment.lessonId, lessonId), eq(coverAssignment.date, date), ne(coverAssignment.status, 'removed')));
  const teacherId = cover?.status === 'assigned' ? cover.coverTeacherId : cover?.status === 'cancelled' ? null : held.group.teacherId;
  const [who] = teacherId ? await db.select({ id: teacher.id, name: teacher.name }).from(teacher).where(eq(teacher.id, teacherId)) : [];
  const [where] = held.lesson.roomId ? await db.select({ id: room.id, name: room.name }).from(room).where(eq(room.id, held.lesson.roomId)) : [];
  return {
    access,
    date,
    lesson: {
      id: lessonId, groupId: held.group.id, groupName: held.group.name, period: held.lesson.period!, length: periods.length,
      label: periods.length > 1 ? `${first.label}–${last.label}` : first.label, startsAt: first.startsAt, endsAt: last.endsAt,
      status: cover?.status === 'cancelled' ? 'cancelled' : cover?.status === 'assigned' ? 'covered' : 'scheduled',
      teacher: who ?? null, room: where ?? null,
    },
    students: students.map((s) => ({ ...s, section: sectionOf.get(s.id) ?? null })),
  };
}

// ─── The calendar feed ───────────────────────────────────────────────────────

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

async function feedTargets(userId: string): Promise<{ target: { studentId: string } | { teacherId: string }; prefix: string | null }[]> {
  const [u] = await db.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, userId));
  if (!u) return [];
  const out: { target: { studentId: string } | { teacherId: string }; prefix: string | null }[] = [];
  if (u.role === 'student') out.push({ target: { studentId: u.id }, prefix: null });
  if (u.role === 'parent') {
    const kids = await db.select({ id: user.id, name: user.name }).from(parentStudentLink).innerJoin(user, eq(user.id, parentStudentLink.studentId))
      .where(and(eq(parentStudentLink.parentId, u.id), eq(parentStudentLink.status, 'approved'))).orderBy(asc(user.name));
    for (const k of kids) out.push({ target: { studentId: k.id }, prefix: k.name });
  }
  const [t] = await db.select({ id: teacher.id }).from(teacher).where(eq(teacher.userId, u.id));
  if (t) out.push({ target: { teacherId: t.id }, prefix: null });
  return out;
}

export async function feedStatus(userId: string) {
  const [live] = await db.select().from(calendarFeedToken).where(and(eq(calendarFeedToken.userId, userId), isNull(calendarFeedToken.revokedAt)));
  const targets = await feedTargets(userId);
  return { available: targets.length > 0, active: !!live, createdAt: live?.createdAt ?? null, lastUsedAt: live?.lastUsedAt ?? null };
}

/** A new feed link (any earlier one stops working). The link is shown once; only its hash is kept. */
export async function createFeedToken(userId: string, ctx?: AuditContext) {
  if (!(await feedTargets(userId)).length) throw new SchedulingError('This account has no timetable to follow', 409);
  const token = randomBytes(24).toString('base64url');
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'calendar-feed:' + userId}))`);
    await tx.update(calendarFeedToken).set({ revokedAt: new Date() }).where(and(eq(calendarFeedToken.userId, userId), isNull(calendarFeedToken.revokedAt)));
    await tx.insert(calendarFeedToken).values({ id, userId, tokenHash: hashToken(token) });
    await logAction(userId, 'CALENDAR_FEED_CREATED', 'calendar_feed', id, null, { userId }, ctx, tx);
  });
  const path = `/v1/ical/${token}.ics`;
  return { path, url: `${(process.env.BETTER_AUTH_URL ?? '').replace(/\/$/, '')}${path}`, createdAt: new Date().toISOString() };
}

export async function revokeFeedToken(userId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const revoked = await tx.update(calendarFeedToken).set({ revokedAt: new Date() })
      .where(and(eq(calendarFeedToken.userId, userId), isNull(calendarFeedToken.revokedAt))).returning({ id: calendarFeedToken.id });
    for (const r of revoked) await logAction(userId, 'CALENDAR_FEED_REVOKED', 'calendar_feed', r.id, null, { userId }, ctx, tx);
    return { revoked: revoked.length };
  });
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTime = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Lines longer than 75 octets are folded (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let first = true;
  while (start < bytes.length) {
    let end = Math.min(bytes.length, start + (first ? 75 : 74));
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    parts.push((first ? '' : ' ') + bytes.subarray(start, end).toString('utf8'));
    start = end;
    first = false;
  }
  return parts.join('\r\n');
}

/**
 * The feed behind a token: the lessons of every published term that is not
 * over (from a week ago), for the account's own timetable — a parent's
 * children's, a student's own, a teacher's teaching and cover. Null for a
 * token that is unknown or revoked: the caller answers 404 and nothing else.
 */
export async function calendarFeed(rawToken: string): Promise<string | null> {
  const token = rawToken.replace(/\.ics$/i, '');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await db.select().from(calendarFeedToken).where(and(eq(calendarFeedToken.tokenHash, hashToken(token)), isNull(calendarFeedToken.revokedAt)));
  if (!row) return null;
  await db.update(calendarFeedToken).set({ lastUsedAt: new Date() }).where(eq(calendarFeedToken.id, row.id));
  const targets = await feedTargets(row.userId);
  const today = schoolDateString(new Date());
  const since = addDays(today, -7);
  const terms = await db.selectDistinct({ id: academicTerm.id, startsOn: academicTerm.startsOn, endsOn: academicTerm.endsOn })
    .from(academicTerm).innerJoin(timetable, eq(timetable.termId, academicTerm.id))
    .where(and(eq(timetable.status, 'published'), gte(academicTerm.endsOn, since)))
    .orderBy(asc(academicTerm.startsOn));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//IGCSE School//Timetable//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Timetable', 'X-WR-TIMEZONE:Africa/Cairo'];
  const stamp = icsTime(new Date());
  for (const term of terms) {
    const from = maxDate(term.startsOn, since);
    const to = minDate(term.endsOn, addDays(from, 199));
    for (const { target, prefix } of targets) {
      const days = await getScheduleRange(target, from, to);
      for (const d of days) {
        for (const l of d.lessons) {
          if (l.status === 'covered_by_other') continue;
          const who = l.teacher?.name ?? (l.status === 'cancelled' ? null : l.scheduledTeacher?.name ?? null);
          const title = `${prefix ? `${prefix}: ` : ''}${l.status === 'cancelled' ? 'Cancelled: ' : ''}${l.groupName}${l.status === 'covering' ? ' (cover)' : ''}`;
          lines.push('BEGIN:VEVENT');
          lines.push(`UID:${l.lessonId}-${d.date}${prefix ? `-${'studentId' in target ? target.studentId : ''}` : ''}@igcse-timetable`);
          lines.push(`DTSTAMP:${stamp}`);
          lines.push(`DTSTART:${icsTime(cairoInstant(d.date, l.startsAt))}`);
          lines.push(`DTEND:${icsTime(cairoInstant(d.date, l.endsAt))}`);
          lines.push(fold(`SUMMARY:${icsText(title)}`));
          if (l.room) lines.push(fold(`LOCATION:${icsText(l.room.name)}`));
          lines.push(fold(`DESCRIPTION:${icsText([`${l.label}`, who ? `Teacher: ${who}` : null, l.status === 'covered' ? 'Cover lesson' : null, l.status === 'uncovered' ? 'The teacher is away' : null].filter(Boolean).join('\n'))}`));
          if (l.status === 'cancelled') lines.push('STATUS:CANCELLED');
          lines.push('END:VEVENT');
        }
      }
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export { WEEKDAY_NAMES, readableDate };
