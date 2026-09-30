/**
 * Cover (FEATURES_PLAN.md F1): a teacher away for a day, a range of days or
 * some periods of one day; the lessons that leaves without a teacher; free,
 * qualified teachers suggested for each; the cover assigned (or the lesson
 * cancelled), the cover teacher and the class told; a log and a report.
 *
 * - Qualified means linked to the lesson's subject (`subject_teacher`, as the
 *   Subjects page links them). A group taught outside the exam catalogue has
 *   no subject to be qualified in, so any free teacher may supervise it (said
 *   beside each suggestion).
 * - Free means: not teaching or covering in those periods that date (after
 *   any cover already arranged), not away then, not unavailable by the year's
 *   rules, and under their periods per day.
 * - An assignment is judged inside its transaction holding the lesson's row
 *   and the cover teacher's row, so two coordinators cannot give one lesson
 *   two covers, nor one teacher two lessons at the same time; the database
 *   also keeps one live cover per lesson and date.
 * - A cover teacher reaches that lesson's students on that date only
 *   (schedule.services lessonAccess).
 */

import {
  db, teacherAbsence, coverAssignment, timetableLesson, teachingGroup, teacher, subjectTeacher, subject, scheduleUnavailability, teacherLoadLimit,
  user, eq, and, inArray, isNull, sql, asc, desc, gte, lte, ne,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  schoolDateString, type CreateAbsenceType, type CancelAbsenceType, type AssignCoverType, type RemoveCoverType, type RangeQueryType,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { createBulkNotifications } from './notification.services';
import { getScheduleRange, getScheduleFor, lessonOnDate, type LessonOnDay } from './schedule.services';
import { SchedulingError, isUniqueViolation, addDays, readableDate, groupMembersBetween, type Tx } from './scheduling-shared.services';

// ─── Absences ────────────────────────────────────────────────────────────────

export async function listAbsences(q: RangeQueryType) {
  const today = schoolDateString(new Date());
  const from = q.from ?? addDays(today, -14);
  const to = q.to ?? addDays(today, 60);
  const rows = await db.select({ a: teacherAbsence, teacherName: teacher.name, recordedByName: user.name })
    .from(teacherAbsence).innerJoin(teacher, eq(teacher.id, teacherAbsence.teacherId)).leftJoin(user, eq(user.id, teacherAbsence.recordedBy))
    .where(and(lte(teacherAbsence.startsOn, to), gte(teacherAbsence.endsOn, from)))
    .orderBy(desc(teacherAbsence.startsOn), asc(teacher.name));
  const out = [];
  for (const r of rows) {
    const affected = r.a.cancelledAt ? [] : await affectedLessons(r.a);
    out.push({
      ...r.a, teacherName: r.teacherName, recordedByName: r.recordedByName,
      lessons: affected.length,
      covered: affected.filter((l) => l.lesson.status === 'covered').length,
      cancelled: affected.filter((l) => l.lesson.status === 'cancelled').length,
      uncovered: affected.filter((l) => l.lesson.status === 'uncovered').length,
    });
  }
  return { from, to, absences: out };
}

async function affectedLessons(a: typeof teacherAbsence.$inferSelect) {
  const days = await getScheduleRange({ teacherId: a.teacherId }, a.startsOn, a.endsOn);
  const out: { date: string; lesson: LessonOnDay }[] = [];
  for (const d of days) for (const l of d.lessons) {
    if (l.status === 'covering') continue;
    if (a.periods && !a.periods.some((p) => l.periods.includes(p))) continue;
    // Seen from the students' side: covered, cancelled, or waiting for cover.
    out.push({ date: d.date, lesson: { ...l, status: l.status === 'covered_by_other' ? 'covered' : l.status === 'scheduled' ? 'uncovered' : l.status } });
  }
  return out;
}

/** An absence and every lesson it touches, each with its cover (if any). */
export async function getAbsence(id: string) {
  const [r] = await db.select({ a: teacherAbsence, teacherName: teacher.name }).from(teacherAbsence).innerJoin(teacher, eq(teacher.id, teacherAbsence.teacherId)).where(eq(teacherAbsence.id, id));
  if (!r) throw new SchedulingError('Absence not found', 404);
  const lessons = r.a.cancelledAt ? [] : await affectedLessons(r.a);
  return { ...r.a, teacherName: r.teacherName, lessons };
}

export async function recordAbsence(data: CreateAbsenceType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(teacher).where(eq(teacher.id, data.teacherId)).for('update');
    if (!t) throw new SchedulingError('Teacher not found', 404);
    const overlap = await tx.select().from(teacherAbsence)
      .where(and(eq(teacherAbsence.teacherId, t.id), isNull(teacherAbsence.cancelledAt), lte(teacherAbsence.startsOn, data.endsOn), gte(teacherAbsence.endsOn, data.startsOn)));
    const clash = overlap.find((o) => !o.periods || !data.periods || o.periods.some((p) => data.periods!.includes(p)));
    if (clash) {
      throw new SchedulingError(`${t.name} is already recorded as away ${clash.startsOn === clash.endsOn ? `on ${readableDate(clash.startsOn)}` : `from ${readableDate(clash.startsOn)} to ${readableDate(clash.endsOn)}`} — change that absence instead`, 409);
    }
    const id = randomUUID();
    await tx.insert(teacherAbsence).values({
      id, teacherId: t.id, startsOn: data.startsOn, endsOn: data.endsOn, periods: data.periods ?? null, reason: data.reason, note: data.note ?? null, recordedBy: actorId,
    });
    await logAction(actorId, 'TEACHER_ABSENCE_RECORDED', 'teacher_absence', id, null, { teacherId: t.id, startsOn: data.startsOn, endsOn: data.endsOn, periods: data.periods ?? null, reason: data.reason }, ctx, tx);
    return { id };
  }).then(async (r) => ({ ...r, ...(await getAbsence(r.id)) }));
}

/** The teacher is not away after all: the absence and its covers are withdrawn (kept as history). */
export async function cancelAbsence(id: string, data: CancelAbsenceType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(teacherAbsence).where(eq(teacherAbsence.id, id)).for('update');
    if (!a) throw new SchedulingError('Absence not found', 404);
    if (a.cancelledAt) throw new SchedulingError('This absence was already withdrawn', 409);
    await tx.update(teacherAbsence).set({ cancelledAt: new Date(), cancelledBy: actorId }).where(eq(teacherAbsence.id, id));
    const live = await tx.update(coverAssignment).set({ status: 'removed', removedAt: new Date(), removedBy: actorId })
      .where(and(eq(coverAssignment.absenceId, id), ne(coverAssignment.status, 'removed'))).returning({ id: coverAssignment.id });
    await logAction(actorId, 'TEACHER_ABSENCE_CANCELLED', 'teacher_absence', id, null, { reason: data.reason, coversRemoved: live.length }, ctx, tx);
    return { id, coversRemoved: live.length };
  });
}

// ─── Suggestions ─────────────────────────────────────────────────────────────

type Candidate = {
  teacherId: string;
  name: string;
  qualified: boolean;
  available: boolean;
  /** Why they cannot take it, when they cannot. */
  reasons: string[];
  lessonsThatDay: number;
  coversThisTerm: number;
};

/**
 * Who could cover a lesson on a date: every active teacher, the free and
 * qualified first (then those with the fewest lessons that day, then the
 * fewest covers this term, then by name), each with the reasons they cannot.
 */
export async function suggestCover(lessonId: string, date: string) {
  const held = await lessonOnDate(lessonId, date);
  if (!held) throw new SchedulingError('That lesson does not take place on that date', 404);
  const g = held.group;
  const lessonPeriods = held.day.periods.filter((p) => p.kind === 'lesson');
  const periods = Array.from({ length: held.lesson.length }, (_, k) => held.lesson.period! + k).filter((p) => p <= lessonPeriods.length);
  const teachers = await db.select().from(teacher).where(eq(teacher.isActive, true)).orderBy(asc(teacher.name));
  const qualifiedIds = g.subjectId
    ? new Set((await db.select({ teacherId: subjectTeacher.teacherId }).from(subjectTeacher).where(eq(subjectTeacher.subjectId, g.subjectId))).map((r) => r.teacherId))
    : null;
  const [subj] = g.subjectId ? await db.select({ name: subject.name }).from(subject).where(eq(subject.id, g.subjectId)) : [];
  const termStart = held.day.term ? (await db.execute(sql`select starts_on from academic_term where id = ${held.day.term.id}`)).rows[0] as { starts_on: string } | undefined : undefined;
  const out: Candidate[] = [];
  for (const t of teachers) {
    if (t.id === g.teacherId) continue;
    const c = await judgeCandidate(t.id, t.name, date, periods, held.lesson.weekday!, g.academicYearId, qualifiedIds, subj?.name ?? null, termStart?.starts_on ?? date);
    out.push(c);
  }
  out.sort((a, b) =>
    Number(b.available && b.qualified) - Number(a.available && a.qualified)
    || Number(b.available) - Number(a.available)
    || a.lessonsThatDay - b.lessonsThatDay
    || a.coversThisTerm - b.coversThisTerm
    || a.name.localeCompare(b.name));
  return {
    lesson: { id: lessonId, date, groupName: g.name, subject: subj?.name ?? null, periods, label: periods.map((p) => lessonPeriods[p - 1]!.label).join('–') },
    supervisionOnly: !g.subjectId,
    candidates: out,
  };
}

async function judgeCandidate(
  teacherId: string, name: string, date: string, periods: number[], weekday: number, academicYearId: string,
  qualifiedIds: Set<string> | null, subjectName: string | null, termStart: string, executor: typeof db | Tx = db,
): Promise<Candidate> {
  const reasons: string[] = [];
  const qualified = qualifiedIds === null || qualifiedIds.has(teacherId);
  if (!qualified) reasons.push(`does not teach ${subjectName}`);
  const day = await getScheduleFor({ teacherId }, date);
  const busy = day.lessons.filter((l) => (l.status === 'scheduled' || l.status === 'covering' || l.status === 'uncovered') && l.periods.some((p) => periods.includes(p)));
  for (const b of busy) reasons.push(b.status === 'covering' ? `covers ${b.groupName} then` : `teaches ${b.groupName} then`);
  const [away] = await executor.select().from(teacherAbsence)
    .where(and(eq(teacherAbsence.teacherId, teacherId), isNull(teacherAbsence.cancelledAt), lte(teacherAbsence.startsOn, date), gte(teacherAbsence.endsOn, date)));
  if (away && (!away.periods || away.periods.some((p) => periods.includes(p)))) reasons.push('is away that day');
  const off = await executor.select().from(scheduleUnavailability)
    .where(and(eq(scheduleUnavailability.academicYearId, academicYearId), eq(scheduleUnavailability.teacherId, teacherId), eq(scheduleUnavailability.weekday, weekday)));
  if (off.some((o) => o.period === null || periods.includes(o.period))) reasons.push('is not available then');
  const lessonsThatDay = day.lessons.filter((l) => l.status === 'scheduled' || l.status === 'covering' || l.status === 'uncovered').reduce((n, l) => n + l.length, 0);
  const [lim] = await executor.select().from(teacherLoadLimit).where(and(eq(teacherLoadLimit.academicYearId, academicYearId), eq(teacherLoadLimit.teacherId, teacherId)));
  if (lim?.maxPerDay != null && lessonsThatDay + periods.length > lim.maxPerDay) reasons.push(`would teach more than ${lim.maxPerDay} periods that day`);
  const [{ n }] = (await executor.select({ n: sql<number>`count(*)::int` }).from(coverAssignment)
    .where(and(eq(coverAssignment.coverTeacherId, teacherId), eq(coverAssignment.status, 'assigned'), gte(coverAssignment.date, termStart), lte(coverAssignment.date, date)))) as [{ n: number }];
  const blocking = reasons.filter((r) => !r.startsWith('does not teach'));
  return { teacherId, name, qualified, available: blocking.length === 0, reasons, lessonsThatDay, coversThisTerm: n };
}

// ─── Assigning ───────────────────────────────────────────────────────────────

export async function assignCover(data: AssignCoverType, actorId: string, ctx?: AuditContext) {
  let notice: { coverTeacherUserId: string | null; coverTeacherName: string | null; groupId: string; groupName: string; label: string; date: string; cancelled: boolean } | null = null;
  const result = await db.transaction(async (tx) => {
    // The lesson's row, then the cover teacher's: two assignments for one lesson, or for one teacher, wait for each other.
    const [lessonRow] = await tx.select().from(timetableLesson).where(eq(timetableLesson.id, data.lessonId)).for('update');
    if (!lessonRow) throw new SchedulingError('Lesson not found', 404);
    const held = await lessonOnDate(data.lessonId, data.date);
    if (!held) throw new SchedulingError('That lesson does not take place on that date', 404);
    const g = held.group;
    const lessonPeriods = held.day.periods.filter((p) => p.kind === 'lesson');
    const periods = Array.from({ length: held.lesson.length }, (_, k) => held.lesson.period! + k).filter((p) => p <= lessonPeriods.length);
    const label = periods.map((p) => lessonPeriods[p - 1]!.label).join('–');
    const [existing] = await tx.select().from(coverAssignment)
      .where(and(eq(coverAssignment.lessonId, data.lessonId), eq(coverAssignment.date, data.date), ne(coverAssignment.status, 'removed')));
    if (existing) throw new SchedulingError('This lesson already has cover arranged — remove it first to change it', 409);
    const [owner] = g.teacherId ? await tx.select().from(teacher).where(eq(teacher.id, g.teacherId)) : [];
    const absences = g.teacherId
      ? await tx.select().from(teacherAbsence).where(and(eq(teacherAbsence.teacherId, g.teacherId), isNull(teacherAbsence.cancelledAt), lte(teacherAbsence.startsOn, data.date), gte(teacherAbsence.endsOn, data.date)))
      : [];
    const absence = absences.find((a) => !a.periods || a.periods.some((p) => periods.includes(p))) ?? null;
    if (g.teacherId && !absence) {
      throw new SchedulingError(`${owner?.name ?? 'The teacher'} is not recorded as away then — record the absence first`, 409);
    }
    let coverTeacher: typeof teacher.$inferSelect | null = null;
    if (!data.cancel) {
      coverTeacher = (await tx.select().from(teacher).where(eq(teacher.id, data.coverTeacherId!)).for('update'))[0] ?? null;
      if (!coverTeacher) throw new SchedulingError('Teacher not found', 404);
      if (!coverTeacher.isActive) throw new SchedulingError(`${coverTeacher.name} is inactive`, 409);
      if (coverTeacher.id === g.teacherId) throw new SchedulingError(`${coverTeacher.name} is the lesson's own teacher`, 409);
      const qualifiedIds = g.subjectId
        ? new Set((await tx.select({ teacherId: subjectTeacher.teacherId }).from(subjectTeacher).where(eq(subjectTeacher.subjectId, g.subjectId))).map((r) => r.teacherId))
        : null;
      const [subj] = g.subjectId ? await tx.select({ name: subject.name }).from(subject).where(eq(subject.id, g.subjectId)) : [];
      const c = await judgeCandidate(coverTeacher.id, coverTeacher.name, data.date, periods, held.lesson.weekday!, g.academicYearId, qualifiedIds, subj?.name ?? null, data.date, tx);
      // Anything the teacher already covers that date was committed before this transaction took their row.
      const [clash] = await tx.select({ groupName: teachingGroup.name }).from(coverAssignment)
        .innerJoin(timetableLesson, eq(timetableLesson.id, coverAssignment.lessonId))
        .innerJoin(teachingGroup, eq(teachingGroup.id, coverAssignment.groupId))
        .where(and(eq(coverAssignment.coverTeacherId, coverTeacher.id), eq(coverAssignment.date, data.date), eq(coverAssignment.status, 'assigned'),
          sql`${timetableLesson.period} <= ${periods[periods.length - 1]!} and ${timetableLesson.period} + ${timetableLesson.length} - 1 >= ${periods[0]!}`));
      if (clash && !c.reasons.some((r) => r.includes(clash.groupName))) c.reasons.push(`covers ${clash.groupName} then`);
      if (!c.qualified) throw new SchedulingError(`${coverTeacher.name} does not teach ${subj?.name} — choose a teacher linked to the subject`, 409);
      const blocking = c.reasons.filter((r) => !r.startsWith('does not teach'));
      if (blocking.length) throw new SchedulingError(`${coverTeacher.name} ${blocking.join('; ')}`, 409);
    }
    const id = randomUUID();
    await tx.insert(coverAssignment).values({
      id, absenceId: absence?.id ?? null, date: data.date, timetableId: held.timetable.id, lessonId: data.lessonId, groupId: g.id,
      originalTeacherId: g.teacherId, coverTeacherId: coverTeacher?.id ?? null, status: data.cancel ? 'cancelled' : 'assigned', note: data.note ?? null, assignedBy: actorId,
    });
    await logAction(actorId, data.cancel ? 'LESSON_CANCELLED' : 'COVER_ASSIGNED', 'cover_assignment', id, null,
      { lessonId: data.lessonId, date: data.date, group: g.name, originalTeacherId: g.teacherId, coverTeacherId: coverTeacher?.id ?? null, note: data.note ?? null }, ctx, tx);
    notice = { coverTeacherUserId: coverTeacher?.userId ?? null, coverTeacherName: coverTeacher?.name ?? null, groupId: g.id, groupName: g.name, label, date: data.date, cancelled: !!data.cancel };
    return { id, status: data.cancel ? 'cancelled' as const : 'assigned' as const, coverTeacherId: coverTeacher?.id ?? null };
  }).catch((err) => {
    if (isUniqueViolation(err)) throw new SchedulingError('Someone arranged cover for this lesson a moment ago — look again', 409);
    throw err;
  });
  if (notice) await notifyCover(notice).catch((err) => console.error('[cover] notices failed:', err));
  return result;
}

async function notifyCover(n: { coverTeacherUserId: string | null; coverTeacherName: string | null; groupId: string; groupName: string; label: string; date: string; cancelled: boolean }) {
  const when = `${readableDate(n.date)}, ${n.label}`;
  if (!n.cancelled && n.coverTeacherUserId) {
    await createBulkNotifications([n.coverTeacherUserId], 'COVER_ASSIGNED', `Cover: ${n.groupName}`, `You are covering ${n.groupName} on ${when}.`, { date: n.date, link: '/today' });
  }
  const members = await groupMembersBetween([n.groupId], n.date, n.date);
  const students = [...new Set(members.map((m) => m.studentId))];
  if (!students.length) return;
  if (n.cancelled) {
    await createBulkNotifications(students, 'LESSON_CANCELLED', `${n.groupName} is cancelled`, `${n.groupName} on ${when} does not take place.`, { date: n.date, link: '/timetable/mine' });
  } else {
    await createBulkNotifications(students, 'LESSON_COVERED', `${n.groupName}: cover teacher`, `${n.coverTeacherName} takes ${n.groupName} on ${when}.`, { date: n.date, link: '/timetable/mine' });
  }
}

export async function removeCover(id: string, data: RemoveCoverType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(coverAssignment).where(eq(coverAssignment.id, id)).for('update');
    if (!c) throw new SchedulingError('Cover not found', 404);
    if (c.status === 'removed') throw new SchedulingError('This cover was already removed', 409);
    await tx.update(coverAssignment).set({ status: 'removed', removedAt: new Date(), removedBy: actorId }).where(eq(coverAssignment.id, id));
    await logAction(actorId, 'COVER_REMOVED', 'cover_assignment', id, { status: c.status, coverTeacherId: c.coverTeacherId }, { status: 'removed', reason: data.reason }, ctx, tx);
    return { id };
  });
}

// ─── The log and the report ──────────────────────────────────────────────────

/** Every cover and cancellation between two dates (removed ones included, marked). */
export async function coverLog(from: string, to: string) {
  const rows = await db.select({
    c: coverAssignment, groupName: teachingGroup.name, period: timetableLesson.period, length: timetableLesson.length,
    original: sql<string | null>`(select name from ${teacher} t where t.id = ${coverAssignment.originalTeacherId})`,
    cover: sql<string | null>`(select name from ${teacher} t where t.id = ${coverAssignment.coverTeacherId})`,
    assignedByName: sql<string | null>`(select name from ${user} u where u.id = ${coverAssignment.assignedBy})`,
  }).from(coverAssignment)
    .innerJoin(teachingGroup, eq(teachingGroup.id, coverAssignment.groupId))
    .innerJoin(timetableLesson, eq(timetableLesson.id, coverAssignment.lessonId))
    .where(and(gte(coverAssignment.date, from), lte(coverAssignment.date, to)))
    .orderBy(asc(coverAssignment.date), asc(timetableLesson.period));
  return rows.map((r) => ({ ...r.c, groupName: r.groupName, period: r.period, length: r.length, originalTeacher: r.original, coverTeacher: r.cover, assignedByName: r.assignedByName }));
}

/** Per teacher between two dates: days away, lessons missed, covered, cancelled, left uncovered, and covers given. */
export async function coverReport(from: string, to: string) {
  const absences = await db.select().from(teacherAbsence).where(and(isNull(teacherAbsence.cancelledAt), lte(teacherAbsence.startsOn, to), gte(teacherAbsence.endsOn, from)));
  const teachers = await db.select({ id: teacher.id, name: teacher.name }).from(teacher).orderBy(asc(teacher.name));
  const given = await db.select({ teacherId: coverAssignment.coverTeacherId, n: sql<number>`count(*)::int` }).from(coverAssignment)
    .where(and(eq(coverAssignment.status, 'assigned'), gte(coverAssignment.date, from), lte(coverAssignment.date, to)))
    .groupBy(coverAssignment.coverTeacherId);
  const rows = [];
  for (const t of teachers) {
    const mine = absences.filter((a) => a.teacherId === t.id);
    let missed = 0, covered = 0, cancelled = 0, uncovered = 0, daysAway = 0;
    for (const a of mine) {
      const s = a.startsOn < from ? from : a.startsOn;
      const e = a.endsOn > to ? to : a.endsOn;
      const lessons = await affectedLessons({ ...a, startsOn: s, endsOn: e });
      daysAway += new Set(lessons.map((l) => l.date)).size;
      missed += lessons.length;
      covered += lessons.filter((l) => l.lesson.status === 'covered').length;
      cancelled += lessons.filter((l) => l.lesson.status === 'cancelled').length;
      uncovered += lessons.filter((l) => l.lesson.status === 'uncovered').length;
    }
    const coversGiven = given.find((g) => g.teacherId === t.id)?.n ?? 0;
    if (mine.length || coversGiven) rows.push({ teacherId: t.id, name: t.name, absences: mine.length, daysAway, lessonsMissed: missed, covered, cancelled, uncovered, coversGiven });
  }
  return { from, to, rows, totals: rows.reduce((s, r) => ({
    lessonsMissed: s.lessonsMissed + r.lessonsMissed, covered: s.covered + r.covered, cancelled: s.cancelled + r.cancelled, uncovered: s.uncovered + r.uncovered, coversGiven: s.coversGiven + r.coversGiven,
  }), { lessonsMissed: 0, covered: 0, cancelled: 0, uncovered: 0, coversGiven: 0 }) };
}

export function coverReportCsv(report: Awaited<ReturnType<typeof coverReport>>) {
  const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [['Teacher', 'Absences', 'Days away', 'Lessons missed', 'Covered', 'Cancelled', 'Uncovered', 'Covers given'].join(',')];
  for (const r of report.rows) lines.push([r.name, r.absences, r.daysAway, r.lessonsMissed, r.covered, r.cancelled, r.uncovered, r.coversGiven].map(cell).join(','));
  return lines.join('\n') + '\n';
}

export { inArray };
