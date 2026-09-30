/**
 * Timetables (FEATURES_PLAN.md F1): versions per term, the grid editor's
 * picture, moves, the generator, publishing, and exports.
 *
 * - A term has drafts and published versions. A draft starts with every
 *   lesson card of the year's groups unplaced, or as a copy of another version
 *   of the year (its placements and locks). Publishing gives a draft the date
 *   it takes effect (today or later, inside the term) and freezes it; the
 *   version in force on a date is the term's published one with the latest
 *   effective date on or before it. Published versions are kept, never
 *   changed or deleted.
 * - Every change to a draft takes the draft's row lock and is judged by the
 *   engine against the draft as it stands then, so two coordinators moving
 *   lessons at once cannot both make the clash the other's move would reveal;
 *   a move names where the editor saw the lesson and is refused if someone
 *   moved it since.
 * - The generator reads the draft, runs outside any lock, then writes only if
 *   the draft and everything it was given are unchanged (else nothing is
 *   written and the coordinator runs it again).
 * - Publishing refuses clashes, and unplaced lessons unless accepted; it
 *   notifies the students, parents and teachers of the timetable (of the
 *   groups whose lessons changed, when it replaces a version).
 */

import {
  db, timetable, timetableLesson, timetableGenerationRun, teachingGroup, academicTerm, academicYear, bellSchedule, bellPeriod, room,
  teacher, teacherLoadLimit, scheduleUnavailability, groupDayRule, subject, section, sectionMembership, user, parentStudentLink,
  eq, and, inArray, isNull, sql, asc, desc, ne,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  gridFromBells, evaluate, measure, judgeMove, generate, canonicalInput, cardsFor, schoolDateString, slotName, WEEKDAY_NAMES,
  type EngineInput, type GridDay, type CreateTimetableType, type UpdateTimetableType, type MoveLessonType, type UnplaceLessonType,
  type LockLessonType, type GenerateTimetableType, type PublishTimetableType, type ExportCsvQueryType,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { getSetting } from './settings.services';
import { createBulkNotifications } from './notification.services';
import { groupsForTerm, syncDraftCards } from './group.services';
import {
  SchedulingError, readableDate, groupMembersBetween, peakSize, overlapsOf, csvCell, type Tx, type Executor,
} from './scheduling-shared.services';

// ─── Loading ─────────────────────────────────────────────────────────────────

async function timetableOrThrow(id: string, executor: Executor = db, lock = false) {
  const q = executor.select().from(timetable).where(eq(timetable.id, id));
  const [t] = lock ? await q.for('update') : await q;
  if (!t) throw new SchedulingError('Timetable not found', 404);
  return t;
}

async function termOf(termId: string, executor: Executor = db) {
  const [t] = await executor.select().from(academicTerm).where(eq(academicTerm.id, termId));
  if (!t) throw new SchedulingError('Term not found', 404);
  return t;
}

/** The year's week: its school weekdays, each with the default bell schedule's lesson periods. */
export async function gridOfYear(academicYearId: string, executor: Executor = db): Promise<{ days: GridDay[]; bellScheduleName: string | null }> {
  const [schedule] = await executor.select().from(bellSchedule).where(and(eq(bellSchedule.academicYearId, academicYearId), eq(bellSchedule.isDefault, true)));
  if (!schedule) return { days: [], bellScheduleName: null };
  const rows = await executor.select().from(bellPeriod).where(eq(bellPeriod.bellScheduleId, schedule.id)).orderBy(asc(bellPeriod.position));
  const weekdays = await getSetting('calendar.schoolWeekdays');
  return { days: gridFromBells(rows, weekdays), bellScheduleName: schedule.name };
}

/**
 * Everything the engine judges a timetable against, plus what the editor
 * shows: groups with their subject, teacher, students and sections; the
 * teachers' and rooms' rules; the students.
 */
export async function loadTimetableModel(timetableId: string, executor: Executor = db) {
  const tt = await timetableOrThrow(timetableId, executor);
  const term = await termOf(tt.termId, executor);
  const [year] = await executor.select().from(academicYear).where(eq(academicYear.id, tt.academicYearId));
  const grid = await gridOfYear(tt.academicYearId, executor);
  const lessons = await executor.select().from(timetableLesson).where(eq(timetableLesson.timetableId, tt.id)).orderBy(asc(timetableLesson.groupId), asc(timetableLesson.seq));
  const groupIds = [...new Set(lessons.map((l) => l.groupId))];
  const groups = groupIds.length
    ? await executor.select({
      g: teachingGroup,
      subjectName: subject.name, subjectCode: subject.code,
      teacherName: teacher.name,
      sectionName: section.name, sectionRoomId: section.roomId,
    }).from(teachingGroup)
      .leftJoin(subject, eq(subject.id, teachingGroup.subjectId))
      .leftJoin(teacher, eq(teacher.id, teachingGroup.teacherId))
      .leftJoin(section, eq(section.id, teachingGroup.sectionId))
      .where(inArray(teachingGroup.id, groupIds))
    : [];
  const members = await groupMembersBetween(groupIds, term.startsOn, term.endsOn, executor);
  const studentIds = [...new Set(members.map((m) => m.studentId))];
  const students = studentIds.length
    ? await executor.select({ id: user.id, name: user.name, studentCode: user.studentId }).from(user).where(inArray(user.id, studentIds)).orderBy(asc(user.name))
    : [];
  // Each student's section during the term (the latest membership that touches it).
  const sectionRows = studentIds.length
    ? await executor.select({ studentId: sectionMembership.studentId, sectionId: section.id, name: section.name, startedOn: sectionMembership.startedOn, createdAt: sectionMembership.createdAt })
      .from(sectionMembership).innerJoin(section, eq(section.id, sectionMembership.sectionId))
      .where(and(inArray(sectionMembership.studentId, studentIds), eq(sectionMembership.academicYearId, tt.academicYearId),
        sql`${sectionMembership.startedOn} <= ${term.endsOn}`, sql`(${sectionMembership.endedOn} IS NULL OR ${sectionMembership.endedOn} >= ${term.startsOn})`))
    : [];
  const sectionOf = new Map<string, { id: string; name: string }>();
  for (const r of [...sectionRows].sort((a, b) => a.startedOn.localeCompare(b.startedOn) || a.createdAt.getTime() - b.createdAt.getTime())) {
    sectionOf.set(r.studentId, { id: r.sectionId, name: r.name });
  }
  const teacherIds = [...new Set(groups.map((g) => g.g.teacherId).filter((x): x is string => !!x))];
  const teachers = teacherIds.length ? await executor.select().from(teacher).where(inArray(teacher.id, teacherIds)) : [];
  const limits = teacherIds.length
    ? await executor.select().from(teacherLoadLimit).where(and(eq(teacherLoadLimit.academicYearId, tt.academicYearId), inArray(teacherLoadLimit.teacherId, teacherIds)))
    : [];
  const rooms = await executor.select().from(room).orderBy(asc(room.name));
  const unavailable = await executor.select().from(scheduleUnavailability).where(eq(scheduleUnavailability.academicYearId, tt.academicYearId));
  const dayRules = groupIds.length
    ? await executor.select().from(groupDayRule).where(and(eq(groupDayRule.academicYearId, tt.academicYearId), inArray(groupDayRule.groupAId, groupIds), inArray(groupDayRule.groupBId, groupIds)))
    : [];

  const intervalsOf = new Map<string, typeof members>();
  for (const m of members) {
    if (!intervalsOf.has(m.groupId)) intervalsOf.set(m.groupId, []);
    intervalsOf.get(m.groupId)!.push(m);
  }
  const input: EngineInput = {
    days: grid.days,
    groups: groups.map(({ g, sectionRoomId }) => {
      const iv = intervalsOf.get(g.id) ?? [];
      return {
        id: g.id,
        name: g.name,
        teacherId: g.teacherId,
        size: peakSize(iv),
        students: [...new Set(iv.map((i) => i.studentId))].sort(),
        roomType: g.roomType,
        roomFeatures: g.roomFeatures,
        roomId: g.roomId,
        preferredRoomId: sectionRoomId ?? null,
      };
    }).sort((a, b) => a.id.localeCompare(b.id)),
    lessons: lessons.map((l) => ({ id: l.id, groupId: l.groupId, seq: l.seq, length: l.length, weekday: l.weekday, period: l.period, roomId: l.roomId, locked: l.locked })),
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, type: r.type, capacity: r.capacity, features: r.features, isActive: r.isActive })),
    teachers: teachers.map((t) => {
      const lim = limits.find((x) => x.teacherId === t.id);
      return { id: t.id, name: t.name, maxPerDay: lim?.maxPerDay ?? null, maxPerWeek: lim?.maxPerWeek ?? null };
    }).sort((a, b) => a.id.localeCompare(b.id)),
    unavailable: unavailable
      .filter((u) => !u.teacherId || teacherIds.includes(u.teacherId))
      .map((u) => ({ teacherId: u.teacherId, roomId: u.roomId, weekday: u.weekday, period: u.period })),
    overlaps: overlapsOf(members),
    dayRules: dayRules.map((r) => ({ a: r.groupAId, b: r.groupBId })),
    roomsRequired: rooms.some((r) => r.isActive),
  };
  return {
    timetable: tt,
    term,
    year: year!,
    grid,
    input,
    display: {
      groups: groups.map(({ g, subjectName, subjectCode, teacherName, sectionName }) => {
        const iv = intervalsOf.get(g.id) ?? [];
        const ids = [...new Set(iv.map((i) => i.studentId))];
        const bySection = new Map<string, { id: string; name: string; count: number }>();
        for (const s of ids) {
          const sec = sectionOf.get(s);
          if (!sec) continue;
          if (!bySection.has(sec.id)) bySection.set(sec.id, { ...sec, count: 0 });
          bySection.get(sec.id)!.count++;
        }
        return {
          id: g.id, name: g.name, kind: g.kind, subjectId: g.subjectId, subjectName, subjectCode, teacherId: g.teacherId, teacherName,
          sectionId: g.sectionId, sectionName, weeklyPeriods: g.weeklyPeriods, doublePeriods: g.doublePeriods, roomType: g.roomType,
          roomFeatures: g.roomFeatures, roomId: g.roomId, archivedOn: g.archivedOn, memberIds: ids.sort(),
          sections: [...bySection.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })),
        };
      }).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })),
      students: students.map((s) => ({ ...s, section: sectionOf.get(s.id) ?? null })),
      teachers: teachers.map((t) => ({ id: t.id, name: t.name, isActive: t.isActive })).sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

// ─── Versions ────────────────────────────────────────────────────────────────

/** The year's (or a term's) timetables, newest first, and which one is in force today. */
export async function listTimetables(filters: { academicYearId?: string; termId?: string }) {
  const rows = await db.select({
    t: timetable, termName: academicTerm.name, termStartsOn: academicTerm.startsOn, termEndsOn: academicTerm.endsOn,
    lessons: sql<number>`(select count(*)::int from ${timetableLesson} l where l.timetable_id = ${timetable.id})`,
    placed: sql<number>`(select count(*)::int from ${timetableLesson} l where l.timetable_id = ${timetable.id} and l.weekday is not null)`,
    publishedByName: sql<string | null>`(select u.name from ${user} u where u.id = ${timetable.publishedBy})`,
  })
    .from(timetable).innerJoin(academicTerm, eq(academicTerm.id, timetable.termId))
    .where(and(
      filters.academicYearId ? eq(timetable.academicYearId, filters.academicYearId) : undefined,
      filters.termId ? eq(timetable.termId, filters.termId) : undefined,
    ))
    .orderBy(asc(academicTerm.startsOn), desc(timetable.createdAt));
  const today = schoolDateString(new Date());
  const inForce = new Set<string>();
  const byTerm = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byTerm.has(r.t.termId)) byTerm.set(r.t.termId, []);
    byTerm.get(r.t.termId)!.push(r);
  }
  for (const list of byTerm.values()) {
    const current = list
      .filter((r) => r.t.status === 'published' && r.t.effectiveFrom! <= maxOf(today, r.termStartsOn))
      .sort((a, b) => b.t.effectiveFrom!.localeCompare(a.t.effectiveFrom!) || b.t.publishedAt!.getTime() - a.t.publishedAt!.getTime())[0];
    if (current) inForce.add(current.t.id);
  }
  return rows.map((r) => ({
    ...r.t,
    term: { id: r.t.termId, name: r.termName, startsOn: r.termStartsOn, endsOn: r.termEndsOn },
    lessons: r.lessons,
    placed: r.placed,
    publishedByName: r.publishedByName,
    inForce: inForce.has(r.t.id),
  }));
}

const maxOf = (a: string, b: string) => (a > b ? a : b);

export async function createTimetable(data: CreateTimetableType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const term = await termOf(data.termId, tx);
    let source: typeof timetable.$inferSelect | null = null;
    if (data.copyFromId) {
      source = await timetableOrThrow(data.copyFromId, tx);
      if (source.academicYearId !== term.academicYearId) throw new SchedulingError('A timetable can be copied only within its academic year');
    }
    const id = randomUUID();
    await tx.insert(timetable).values({ id, termId: term.id, academicYearId: term.academicYearId, name: data.name, basedOnId: source?.id ?? null, createdBy: actorId });
    const groups = await groupsForTerm(tx, term.academicYearId, term.startsOn);
    const active = new Set(groups.map((g) => g.id));
    let copied = 0;
    if (source) {
      const lessons = await tx.select().from(timetableLesson).where(eq(timetableLesson.timetableId, source.id));
      const keep = lessons.filter((l) => active.has(l.groupId));
      if (keep.length) {
        await tx.insert(timetableLesson).values(keep.map((l) => ({
          id: randomUUID(), timetableId: id, groupId: l.groupId, seq: l.seq, length: l.length, weekday: l.weekday, period: l.period, roomId: l.roomId, locked: l.locked,
        })));
      }
      copied = keep.length;
    }
    const cards = await syncDraftCards(tx, groups.map((g) => g.id));
    await logAction(actorId, 'TIMETABLE_CREATED', 'timetable', id, null, { termId: term.id, name: data.name, copiedFrom: source?.id ?? null, copied, cards }, ctx, tx);
    return { id };
  });
}

export async function updateTimetable(id: string, data: UpdateTimetableType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const t = await timetableOrThrow(id, tx, true);
    const next = { name: data.name ?? t.name, notes: data.notes !== undefined ? data.notes : t.notes };
    await tx.update(timetable).set({ ...next, updatedAt: new Date() }).where(eq(timetable.id, id));
    await logAction(actorId, 'TIMETABLE_UPDATED', 'timetable', id, { name: t.name, notes: t.notes }, next, ctx, tx);
    return { id };
  });
}

export async function deleteTimetable(id: string, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const t = await timetableOrThrow(id, tx, true);
    if (t.status === 'published') throw new SchedulingError('A published timetable is kept for good — make a new draft instead', 409);
    await tx.update(timetable).set({ basedOnId: null }).where(eq(timetable.basedOnId, id));
    await tx.delete(timetable).where(eq(timetable.id, id));
    await logAction(actorId, 'TIMETABLE_DELETED', 'timetable', id, { name: t.name, termId: t.termId }, null, ctx, tx);
    return { id };
  });
}

/** The grid editor's picture: the timetable, its week, its groups and lessons, its clashes and measures. */
export async function getTimetable(id: string) {
  const model = await loadTimetableModel(id);
  const { clashes, unplaced } = evaluate(model.input);
  const runs = await db.select().from(timetableGenerationRun).where(eq(timetableGenerationRun.timetableId, id)).orderBy(desc(timetableGenerationRun.startedAt)).limit(5);
  const problems: string[] = [];
  if (!model.grid.days.length) problems.push(model.grid.bellScheduleName ? 'The default bell schedule has no lesson periods on the school days' : 'This year has no default bell schedule — set one up on the Bell schedules screen');
  const noTeacher = model.display.groups.filter((g) => !g.teacherId);
  if (noTeacher.length) problems.push(`${noTeacher.length} ${noTeacher.length === 1 ? 'group has' : 'groups have'} no teacher yet: ${noTeacher.map((g) => g.name).join(', ')}`);
  return {
    timetable: model.timetable,
    term: model.term,
    academicYear: { id: model.year.id, startYear: model.year.startYear },
    bellScheduleName: model.grid.bellScheduleName,
    engine: model.input,
    groups: model.display.groups,
    students: model.display.students,
    teachers: model.display.teachers,
    clashes,
    unplaced,
    measures: measure(model.input),
    problems,
    runs: runs.map((r) => ({ ...r, explanations: r.explanations as { lessonId: string; groupName: string; seq: number; length: number; reasons: string[]; summary: string }[] })),
  };
}

// ─── Editing a draft ─────────────────────────────────────────────────────────

async function draftForEdit(tx: Tx, id: string) {
  const t = await timetableOrThrow(id, tx, true);
  if (t.status !== 'draft') throw new SchedulingError('A published timetable does not change — make a new draft from it on the Versions screen', 409);
  return t;
}

async function lessonIn(tx: Tx, timetableId: string, lessonId: string) {
  const [l] = await tx.select().from(timetableLesson).where(and(eq(timetableLesson.id, lessonId), eq(timetableLesson.timetableId, timetableId))).for('update');
  if (!l) throw new SchedulingError('Lesson not found in this timetable', 404);
  return l;
}

function assertWhereSeen(l: { weekday: number | null; period: number | null }, from: { weekday: number | null; period: number | null }) {
  if (l.weekday !== from.weekday || l.period !== from.period) {
    throw new SchedulingError('Someone else moved this lesson a moment ago — the grid shows where it is now', 409);
  }
}

async function bump(tx: Tx, id: string) {
  const [r] = await tx.update(timetable).set({ revision: sql`${timetable.revision} + 1`, updatedAt: new Date() }).where(eq(timetable.id, id)).returning({ revision: timetable.revision });
  return r!.revision;
}

/** Put a lesson at a slot (and a room): refused if it would clash, unless the coordinator places it anyway. */
export async function moveLesson(id: string, lessonId: string, data: MoveLessonType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    await draftForEdit(tx, id);
    const l = await lessonIn(tx, id, lessonId);
    assertWhereSeen(l, data.from);
    if (l.locked) throw new SchedulingError('This lesson is locked — unlock it to move it', 409);
    const model = await loadTimetableModel(id, tx);
    const option = judgeMove(model.input, lessonId, data.weekday, data.period, data.roomId);
    if (!option.ok && !data.allowClash) {
      throw new SchedulingError(`It would clash: ${option.reasons.map((r) => r.message).join('; ')}`, 409);
    }
    await tx.update(timetableLesson).set({ weekday: data.weekday, period: data.period, roomId: option.roomId, updatedAt: new Date() }).where(eq(timetableLesson.id, lessonId));
    const revision = await bump(tx, id);
    await logAction(actorId, 'TIMETABLE_LESSON_MOVED', 'timetable', id,
      { lessonId, weekday: l.weekday, period: l.period, roomId: l.roomId },
      { lessonId, weekday: data.weekday, period: data.period, roomId: option.roomId, clashes: option.reasons.map((r) => r.message) }, ctx, tx);
    return { lessonId, weekday: data.weekday, period: data.period, roomId: option.roomId, revision, clashes: option.reasons };
  });
}

export async function unplaceLesson(id: string, lessonId: string, data: UnplaceLessonType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    await draftForEdit(tx, id);
    const l = await lessonIn(tx, id, lessonId);
    assertWhereSeen(l, data.from);
    if (l.locked) throw new SchedulingError('This lesson is locked — unlock it to take it off the grid', 409);
    await tx.update(timetableLesson).set({ weekday: null, period: null, roomId: null, updatedAt: new Date() }).where(eq(timetableLesson.id, lessonId));
    const revision = await bump(tx, id);
    await logAction(actorId, 'TIMETABLE_LESSON_MOVED', 'timetable', id, { lessonId, weekday: l.weekday, period: l.period }, { lessonId, weekday: null, period: null }, ctx, tx);
    return { lessonId, revision };
  });
}

export async function lockLesson(id: string, lessonId: string, data: LockLessonType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    await draftForEdit(tx, id);
    const l = await lessonIn(tx, id, lessonId);
    if (data.locked && l.weekday === null) throw new SchedulingError('Place the lesson before locking it', 409);
    await tx.update(timetableLesson).set({ locked: data.locked, updatedAt: new Date() }).where(eq(timetableLesson.id, lessonId));
    const revision = await bump(tx, id);
    await logAction(actorId, 'TIMETABLE_LESSON_LOCKED', 'timetable', id, { lessonId, locked: l.locked }, { lessonId, locked: data.locked }, ctx, tx);
    return { lessonId, locked: data.locked, revision };
  });
}

// ─── The generator ───────────────────────────────────────────────────────────

/** What the generator starts from: the draft with its unlocked lessons taken off. */
function startingPoint(input: EngineInput): EngineInput {
  return { ...input, lessons: input.lessons.map((l) => (l.locked ? l : { ...l, weekday: null, period: null, roomId: null })) };
}

/**
 * Generate a draft: every unlocked lesson placed afresh by the generator
 * (deterministic: the same draft and rules give the same timetable), locked
 * lessons kept. Written only if nothing changed while it ran.
 */
export async function generateTimetable(id: string, data: GenerateTimetableType, actorId: string, ctx?: AuditContext) {
  const before = await loadTimetableModel(id);
  if (before.timetable.status !== 'draft') throw new SchedulingError('A published timetable does not change — make a new draft from it', 409);
  if (!before.input.days.length) throw new SchedulingError('This year has no lesson periods to place lessons in — set up the default bell schedule first', 409);
  const start = startingPoint(before.input);
  const started = Date.now();
  const result = generate(start, { iterations: data.iterations });
  const durationMs = Date.now() - started;
  const run = {
    id: randomUUID(), timetableId: id, startedBy: actorId, durationMs, inputHash: result.inputHash, outputHash: result.outputHash,
    seed: String(result.stats.seed), iterations: result.stats.iterations, lessons: result.stats.lessons, placed: result.stats.placed,
    unplaced: result.stats.unplaced, locked: result.stats.locked, measures: result.measures as unknown as Record<string, unknown>,
    explanations: result.unplaced as unknown[],
  };
  const outcome = await db.transaction(async (tx) => {
    const t = await timetableOrThrow(id, tx, true);
    const now = await loadTimetableModel(id, tx);
    const unchanged = t.revision === before.timetable.revision && t.status === 'draft'
      && canonicalInput(startingPoint(now.input)) === canonicalInput(start);
    if (!unchanged) {
      await tx.insert(timetableGenerationRun).values({ ...run, outcome: 'stale' });
      return 'stale' as const;
    }
    const placedAt = new Map(result.placements.map((p) => [p.lessonId, p]));
    for (const l of start.lessons) {
      if (l.locked) continue;
      const p = placedAt.get(l.id);
      await tx.update(timetableLesson)
        .set({ weekday: p?.weekday ?? null, period: p?.period ?? null, roomId: p?.roomId ?? null, updatedAt: new Date() })
        .where(eq(timetableLesson.id, l.id));
    }
    await bump(tx, id);
    await tx.insert(timetableGenerationRun).values({ ...run, outcome: 'applied' });
    await logAction(actorId, 'TIMETABLE_GENERATED', 'timetable', id, null,
      { runId: run.id, placed: run.placed, unplaced: run.unplaced, locked: run.locked, durationMs, outputHash: run.outputHash }, ctx, tx);
    return 'applied' as const;
  });
  if (outcome === 'stale') {
    throw new SchedulingError('The timetable changed while the generator ran, so nothing was written — run it again', 409);
  }
  return { runId: run.id, durationMs, ...result };
}

// ─── Publishing ──────────────────────────────────────────────────────────────

/** The version in force on a date for a term (null before its first effective date). */
export async function versionInForce(termId: string, date: string, executor: Executor = db, excludeId?: string) {
  const [t] = await executor.select().from(timetable)
    .where(and(eq(timetable.termId, termId), eq(timetable.status, 'published'), sql`${timetable.effectiveFrom} <= ${date}`, excludeId ? ne(timetable.id, excludeId) : undefined))
    .orderBy(desc(timetable.effectiveFrom), desc(timetable.publishedAt))
    .limit(1);
  return t ?? null;
}

export async function publishTimetable(id: string, data: PublishTimetableType, actorId: string, ctx?: AuditContext) {
  const result = await db.transaction(async (tx) => {
    const draft = await timetableOrThrow(id, tx);
    // One publication per term at a time; then the draft itself.
    await tx.select({ id: academicTerm.id }).from(academicTerm).where(eq(academicTerm.id, draft.termId)).for('update');
    const t = await draftForEdit(tx, id);
    const term = await termOf(t.termId, tx);
    const today = schoolDateString(new Date());
    if (data.effectiveFrom < term.startsOn || data.effectiveFrom > term.endsOn) {
      throw new SchedulingError(`${term.name} runs from ${readableDate(term.startsOn)} to ${readableDate(term.endsOn)}: the timetable takes effect inside it`);
    }
    if (data.effectiveFrom < today) {
      throw new SchedulingError(`A timetable takes effect today or later (today is ${readableDate(today)}): what has been taught is not rewritten`);
    }
    const model = await loadTimetableModel(id, tx);
    const { clashes, unplaced } = evaluate(model.input);
    if (clashes.length) {
      throw new SchedulingError(`Resolve the clashes before publishing (${clashes.length}): ${clashes.slice(0, 3).map((c) => c.message).join('; ')}${clashes.length > 3 ? '; …' : ''}`, 409);
    }
    if (unplaced.length && !data.acceptUnplaced) {
      throw new SchedulingError(`${unplaced.length} ${unplaced.length === 1 ? 'lesson is' : 'lessons are'} not on the grid — place ${unplaced.length === 1 ? 'it' : 'them'}, or publish without ${unplaced.length === 1 ? 'it' : 'them'}`, 409);
    }
    const previous = await versionInForce(term.id, data.effectiveFrom, tx, id);
    const publishedAt = new Date();
    await tx.update(timetable).set({ status: 'published', effectiveFrom: data.effectiveFrom, publishedBy: actorId, publishedAt, publishNote: data.note ?? null, updatedAt: publishedAt })
      .where(eq(timetable.id, id));
    const changedGroups = await changedGroupsSince(tx, previous?.id ?? null, id);
    await logAction(actorId, 'TIMETABLE_PUBLISHED', 'timetable', id, { status: 'draft' },
      { status: 'published', effectiveFrom: data.effectiveFrom, replaces: previous?.id ?? null, lessons: model.input.lessons.length, unplaced: unplaced.length, changedGroups: changedGroups.length, note: data.note ?? null }, ctx, tx);
    return { term, previous, changedGroups, name: t.name, unplaced: unplaced.length };
  });
  // After the commit: tell the people whose timetable this is (or changed for).
  const notified = await notifyPublished(id, result.term, data.effectiveFrom, result.changedGroups, !!result.previous)
    .catch((err) => { console.error('[timetable] publish notices failed:', err); return { students: 0, parents: 0, teachers: 0 }; });
  return { id, effectiveFrom: data.effectiveFrom, replaces: result.previous?.id ?? null, changedGroups: result.changedGroups.length, unplaced: result.unplaced, notified };
}

/** Groups whose lessons (slots, rooms, teacher) differ between two versions — every group when there is no previous one. */
async function changedGroupsSince(tx: Executor, previousId: string | null, nextId: string) {
  const next = await tx.select({ groupId: timetableLesson.groupId, weekday: timetableLesson.weekday, period: timetableLesson.period, length: timetableLesson.length, roomId: timetableLesson.roomId })
    .from(timetableLesson).where(eq(timetableLesson.timetableId, nextId));
  const nextGroups = [...new Set(next.map((l) => l.groupId))];
  if (!previousId) return nextGroups;
  const prev = await tx.select({ groupId: timetableLesson.groupId, weekday: timetableLesson.weekday, period: timetableLesson.period, length: timetableLesson.length, roomId: timetableLesson.roomId })
    .from(timetableLesson).where(eq(timetableLesson.timetableId, previousId));
  const sig = (rows: typeof next, g: string) => rows.filter((r) => r.groupId === g).map((r) => `${r.weekday}|${r.period}|${r.length}|${r.roomId}`).sort().join(',');
  const all = [...new Set([...nextGroups, ...prev.map((p) => p.groupId)])];
  return all.filter((g) => sig(next, g) !== sig(prev, g)).sort();
}

async function notifyPublished(id: string, term: { name: string; startsOn: string; endsOn: string }, effectiveFrom: string, groupIds: string[], replaces: boolean) {
  if (!groupIds.length) return { students: 0, parents: 0, teachers: 0 };
  const members = await groupMembersBetween(groupIds, effectiveFrom, term.endsOn);
  const studentIds = [...new Set(members.map((m) => m.studentId))];
  const groups = await db.select({ teacherId: teachingGroup.teacherId }).from(teachingGroup).where(inArray(teachingGroup.id, groupIds));
  const teacherIds = [...new Set(groups.map((g) => g.teacherId).filter((x): x is string => !!x))];
  const teacherUsers = teacherIds.length
    ? (await db.select({ userId: teacher.userId }).from(teacher).where(inArray(teacher.id, teacherIds))).map((t) => t.userId).filter((x): x is string => !!x)
    : [];
  const when = readableDate(effectiveFrom);
  const title = replaces ? `Timetable changes for ${term.name}` : `Timetable for ${term.name}`;
  const data = { timetableId: id, effectiveFrom, link: '/my-timetable' };
  if (studentIds.length) {
    await createBulkNotifications(studentIds, 'TIMETABLE_PUBLISHED', title,
      replaces ? `Your timetable changes from ${when}. Open Timetable to see it.` : `Your timetable from ${when} is ready. Open Timetable to see it.`, data);
  }
  const parents = studentIds.length
    ? await db.select({ parentId: parentStudentLink.parentId, studentName: user.name }).from(parentStudentLink)
      .innerJoin(user, eq(user.id, parentStudentLink.studentId))
      .where(and(inArray(parentStudentLink.studentId, studentIds), eq(parentStudentLink.status, 'approved')))
    : [];
  const byParent = new Map<string, string[]>();
  for (const p of parents) {
    if (!byParent.has(p.parentId)) byParent.set(p.parentId, []);
    byParent.get(p.parentId)!.push(p.studentName);
  }
  for (const [parentId, names] of byParent) {
    const who = names.sort().join(' and ');
    await createBulkNotifications([parentId], 'TIMETABLE_PUBLISHED', title,
      replaces ? `${who}'s timetable changes from ${when}. Open Timetable to see it.` : `${who}'s timetable from ${when} is ready. Open Timetable to see it.`, data);
  }
  if (teacherUsers.length) {
    await createBulkNotifications(teacherUsers, 'TIMETABLE_PUBLISHED', title,
      replaces ? `Your teaching timetable changes from ${when}. Open My teaching to see it.` : `Your teaching timetable from ${when} is ready. Open My teaching to see it.`,
      { ...data, link: '/teaching' });
  }
  return { students: studentIds.length, parents: byParent.size, teachers: teacherUsers.length };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

const xml = (s: string | number | null | undefined) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const shortOf = (name: string, max = 10) => name.replace(/[^A-Za-z0-9]+/g, '').slice(0, max) || 'X';

/**
 * The timetable for FET (the free timetabler, .fet): days, hours, subjects,
 * teachers, each group as a student set with its size, an activity per
 * lesson card, the teachers' unavailable times and limits, locked lessons as
 * fixed times, rooms with their capacity, and groups that share students kept
 * apart with "activities not overlapping".
 */
export async function exportFet(id: string) {
  const model = await loadTimetableModel(id);
  const { input, display, grid } = model;
  const maxP = Math.max(0, ...grid.days.map((d) => d.periods.length));
  const dayName = (w: number) => WEEKDAY_NAMES[w]!;
  const hourName = (p: number) => `P${p}`;
  const groupName = (gid: string) => display.groups.find((g) => g.id === gid)?.name ?? gid;
  const subjects = [...new Set(display.groups.map((g) => g.subjectName ?? g.name))].sort();
  const acts = input.lessons.map((l, i) => ({ ...l, actId: i + 1 }));
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<fet version="6.9.0">');
  lines.push(`<Institution_Name>${xml('IGCSE School')}</Institution_Name>`);
  lines.push(`<Comments>${xml(`${model.timetable.name} — ${model.term.name}`)}</Comments>`);
  lines.push(`<Days_List><Number_of_Days>${grid.days.length}</Number_of_Days>${grid.days.map((d) => `<Day><Name>${dayName(d.weekday)}</Name></Day>`).join('')}</Days_List>`);
  lines.push(`<Hours_List><Number_of_Hours>${maxP}</Number_of_Hours>${Array.from({ length: maxP }, (_, k) => `<Hour><Name>${hourName(k + 1)}</Name></Hour>`).join('')}</Hours_List>`);
  lines.push(`<Subjects_List>${subjects.map((s) => `<Subject><Name>${xml(s)}</Name></Subject>`).join('')}</Subjects_List>`);
  lines.push(`<Teachers_List>${display.teachers.map((t) => `<Teacher><Name>${xml(t.name)}</Name></Teacher>`).join('')}</Teachers_List>`);
  lines.push(`<Students_List>${input.groups.map((g) => `<Year><Name>${xml(groupName(g.id))}</Name><Number_of_Students>${g.size}</Number_of_Students></Year>`).join('')}</Students_List>`);
  lines.push('<Activities_List>');
  for (const a of acts) {
    const g = display.groups.find((x) => x.id === a.groupId)!;
    lines.push(`<Activity>${g.teacherName ? `<Teacher>${xml(g.teacherName)}</Teacher>` : ''}<Subject>${xml(g.subjectName ?? g.name)}</Subject><Students>${xml(g.name)}</Students><Duration>${a.length}</Duration><Total_Duration>${a.length}</Total_Duration><Id>${a.actId}</Id><Activity_Group_Id>0</Activity_Group_Id><Active>true</Active><Comments>${xml(`${g.name} #${a.seq}`)}</Comments></Activity>`);
  }
  lines.push('</Activities_List>');
  lines.push(`<Buildings_List></Buildings_List>`);
  lines.push(`<Rooms_List>${input.rooms.filter((r) => r.isActive).map((r) => `<Room><Name>${xml(r.name)}</Name><Building></Building><Capacity>${r.capacity ?? 1000}</Capacity></Room>`).join('')}</Rooms_List>`);
  lines.push('<Time_Constraints_List>');
  lines.push('<ConstraintBasicCompulsoryTime><Weight_Percentage>100</Weight_Percentage><Active>true</Active></ConstraintBasicCompulsoryTime>');
  // Periods a day does not have, for everyone.
  const missing = grid.days.flatMap((d) => Array.from({ length: maxP }, (_, k) => k + 1).filter((p) => !d.periods.some((x) => x.period === p)).map((p) => ({ d: d.weekday, p })));
  if (missing.length) {
    lines.push(`<ConstraintBreakTimes><Weight_Percentage>100</Weight_Percentage><Number_of_Break_Times>${missing.length}</Number_of_Break_Times>${missing.map((m) => `<Break_Time><Day>${dayName(m.d)}</Day><Hour>${hourName(m.p)}</Hour></Break_Time>`).join('')}<Active>true</Active></ConstraintBreakTimes>`);
  }
  for (const t of input.teachers) {
    const off = input.unavailable.filter((u) => u.teacherId === t.id).flatMap((u) => (u.period === null ? (grid.days.find((d) => d.weekday === u.weekday)?.periods ?? []).map((p) => ({ d: u.weekday, p: p.period })) : [{ d: u.weekday, p: u.period }]));
    if (off.length) lines.push(`<ConstraintTeacherNotAvailableTimes><Weight_Percentage>100</Weight_Percentage><Teacher>${xml(t.name)}</Teacher><Number_of_Not_Available_Times>${off.length}</Number_of_Not_Available_Times>${off.map((o) => `<Not_Available_Time><Day>${dayName(o.d)}</Day><Hour>${hourName(o.p)}</Hour></Not_Available_Time>`).join('')}<Active>true</Active></ConstraintTeacherNotAvailableTimes>`);
    if (t.maxPerDay !== null) lines.push(`<ConstraintTeacherMaxHoursDaily><Weight_Percentage>100</Weight_Percentage><Teacher_Name>${xml(t.name)}</Teacher_Name><Maximum_Hours_Daily>${t.maxPerDay}</Maximum_Hours_Daily><Active>true</Active></ConstraintTeacherMaxHoursDaily>`);
  }
  for (const o of input.overlaps) {
    const ids = acts.filter((a) => a.groupId === o.a || a.groupId === o.b).map((a) => a.actId);
    lines.push(`<ConstraintActivitiesNotOverlapping><Weight_Percentage>100</Weight_Percentage><Number_of_Activities>${ids.length}</Number_of_Activities>${ids.map((x) => `<Activity_Id>${x}</Activity_Id>`).join('')}<Active>true</Active><Comments>${xml(`${groupName(o.a)} and ${groupName(o.b)} share ${o.students} students`)}</Comments></ConstraintActivitiesNotOverlapping>`);
  }
  for (const r of input.dayRules) {
    const ids = acts.filter((a) => a.groupId === r.a || a.groupId === r.b).map((a) => a.actId);
    lines.push(`<ConstraintMinDaysBetweenActivities><Weight_Percentage>100</Weight_Percentage><Consecutive_If_Same_Day>false</Consecutive_If_Same_Day><Number_of_Activities>${ids.length}</Number_of_Activities>${ids.map((x) => `<Activity_Id>${x}</Activity_Id>`).join('')}<MinDays>1</MinDays><Active>true</Active></ConstraintMinDaysBetweenActivities>`);
  }
  for (const a of acts.filter((x) => x.locked && x.weekday !== null)) {
    lines.push(`<ConstraintActivityPreferredStartingTime><Weight_Percentage>100</Weight_Percentage><Activity_Id>${a.actId}</Activity_Id><Preferred_Day>${dayName(a.weekday!)}</Preferred_Day><Preferred_Hour>${hourName(a.period!)}</Preferred_Hour><Permanently_Locked>true</Permanently_Locked><Active>true</Active></ConstraintActivityPreferredStartingTime>`);
  }
  lines.push('</Time_Constraints_List>');
  lines.push('<Space_Constraints_List>');
  lines.push('<ConstraintBasicCompulsorySpace><Weight_Percentage>100</Weight_Percentage><Active>true</Active></ConstraintBasicCompulsorySpace>');
  for (const a of acts) {
    const g = input.groups.find((x) => x.id === a.groupId)!;
    const fitting = input.rooms.filter((r) => r.isActive && (!g.roomId || g.roomId === r.id) && (!g.roomType || r.type === g.roomType)
      && g.roomFeatures.every((f) => r.features.includes(f)) && (r.capacity === null || r.capacity >= g.size));
    if (fitting.length && fitting.length < input.rooms.filter((r) => r.isActive).length) {
      lines.push(`<ConstraintActivityPreferredRooms><Weight_Percentage>100</Weight_Percentage><Activity_Id>${a.actId}</Activity_Id><Number_of_Preferred_Rooms>${fitting.length}</Number_of_Preferred_Rooms>${fitting.map((r) => `<Preferred_Room>${xml(r.name)}</Preferred_Room>`).join('')}<Active>true</Active></ConstraintActivityPreferredRooms>`);
    }
  }
  lines.push('</Space_Constraints_List>');
  lines.push('</fet>');
  return { filename: `${fileSafe(model.timetable.name)}.fet`, body: lines.join('\n') + '\n' };
}

/**
 * The timetable in aSc Timetables' XML import format ("aSc XML"): periods,
 * days, subjects, teachers, classrooms, the sections as classes, the students,
 * each group as a lesson with its students, and a card per placed lesson.
 */
export async function exportAsc(id: string) {
  const model = await loadTimetableModel(id);
  const { input, display, grid } = model;
  const maxP = Math.max(0, ...grid.days.map((d) => d.periods.length));
  const first = grid.days[0];
  const dayIdx = new Map(grid.days.map((d, i) => [d.weekday, i]));
  const dayBits = (w: number) => grid.days.map((_, i) => (i === dayIdx.get(w) ? '1' : '0')).join('');
  const subjects = [...new Map(display.groups.map((g) => [g.subjectId ?? `course:${g.name}`, { id: g.subjectId ?? `course:${g.id}`, name: g.subjectName ?? g.name, code: g.subjectCode ?? shortOf(g.name) }])).values()];
  const sections = [...new Map(display.students.filter((s) => s.section).map((s) => [s.section!.id, s.section!])).values()];
  const L: string[] = [];
  L.push('<?xml version="1.0" encoding="UTF-8"?>');
  L.push(`<timetable importtype="database" options="idprefix:IGCSE,daynumbering1" displayname="${xml(model.timetable.name)}">`);
  L.push('<periods options="canadd,export:silent" columns="period,name,short,starttime,endtime">');
  for (let p = 1; p <= maxP; p++) {
    const at = first?.periods.find((x) => x.period === p);
    L.push(`<period name="${xml(at?.label ?? `P${p}`)}" short="${p}" period="${p}" starttime="${at?.startsAt ?? ''}" endtime="${at?.endsAt ?? ''}"/>`);
  }
  L.push('</periods>');
  L.push('<daysdefs options="canadd,export:silent" columns="id,days,name,short">');
  L.push(`<daysdef id="alldays" name="Every day" short="X" days="${grid.days.map(() => '1').join('')}"/>`);
  for (const d of grid.days) L.push(`<daysdef id="day${d.weekday}" name="${WEEKDAY_NAMES[d.weekday]}" short="${WEEKDAY_NAMES[d.weekday]!.slice(0, 2)}" days="${dayBits(d.weekday)}"/>`);
  L.push('</daysdefs>');
  L.push('<weeksdefs options="canadd,export:silent" columns="id,weeks,name,short"><weeksdef id="allweeks" name="Every week" short="All" weeks="1"/></weeksdefs>');
  L.push(`<termsdefs options="canadd,export:silent" columns="id,terms,name,short"><termsdef id="term" name="${xml(model.term.name)}" short="T" terms="1"/></termsdefs>`);
  L.push('<subjects options="canadd,export:silent" columns="id,name,short,partner_id">');
  for (const s of subjects) L.push(`<subject id="${xml(s.id)}" name="${xml(s.name)}" short="${xml(s.code)}" partner_id=""/>`);
  L.push('</subjects>');
  L.push('<teachers options="canadd,export:silent" columns="id,name,short,partner_id">');
  for (const t of display.teachers) L.push(`<teacher id="${xml(t.id)}" name="${xml(t.name)}" short="${xml(shortOf(t.name, 6))}" partner_id=""/>`);
  L.push('</teachers>');
  L.push('<classrooms options="canadd,export:silent" columns="id,name,short,capacity,partner_id">');
  for (const r of input.rooms.filter((x) => x.isActive)) L.push(`<classroom id="${xml(r.id)}" name="${xml(r.name)}" short="${xml(shortOf(r.name, 6))}" capacity="${r.capacity ?? ''}" partner_id=""/>`);
  L.push('</classrooms>');
  L.push('<classes options="canadd,export:silent" columns="id,name,short,classroomids,teacherid,partner_id">');
  for (const s of sections) L.push(`<class id="${xml(s.id)}" name="${xml(s.name)}" short="${xml(shortOf(s.name, 6))}" classroomids="" teacherid="" partner_id=""/>`);
  L.push('</classes>');
  L.push('<groups options="canadd,export:silent" columns="id,classid,name,entireclass,divisiontag,studentcount">');
  for (const s of sections) L.push(`<group id="${xml(s.id)}-all" classid="${xml(s.id)}" name="Entire class" entireclass="1" divisiontag="0" studentcount="${display.students.filter((x) => x.section?.id === s.id).length}"/>`);
  L.push('</groups>');
  L.push('<students options="canadd,export:silent" columns="id,classid,name">');
  for (const s of display.students) L.push(`<student id="${xml(s.id)}" classid="${xml(s.section?.id ?? '')}" name="${xml(s.name)}"/>`);
  L.push('</students>');
  L.push('<lessons options="canadd,export:silent" columns="id,subjectid,classids,groupids,studentids,teacherids,classroomids,periodspercard,periodsperweek,daysdefid,weeksdefid,termsdefid">');
  const lessonRows: { id: string; groupId: string; length: number }[] = [];
  for (const g of display.groups) {
    for (const len of [...new Set(input.lessons.filter((l) => l.groupId === g.id).map((l) => l.length))].sort()) {
      const cards = input.lessons.filter((l) => l.groupId === g.id && l.length === len);
      const lid = `${g.id}-${len}`;
      lessonRows.push({ id: lid, groupId: g.id, length: len });
      const eg = input.groups.find((x) => x.id === g.id)!;
      const rooms = input.rooms.filter((r) => r.isActive && (!eg.roomId || eg.roomId === r.id) && (!eg.roomType || r.type === eg.roomType)
        && eg.roomFeatures.every((f) => r.features.includes(f)) && (r.capacity === null || r.capacity >= eg.size));
      L.push(`<lesson id="${xml(lid)}" subjectid="${xml(g.subjectId ?? `course:${g.id}`)}" classids="${g.sections.map((s) => xml(s.id)).join(',')}" groupids="${g.sections.map((s) => xml(`${s.id}-all`)).join(',')}" studentids="${g.memberIds.map(xml).join(',')}" teacherids="${xml(g.teacherId ?? '')}" classroomids="${rooms.map((r) => xml(r.id)).join(',')}" periodspercard="${len}" periodsperweek="${cards.length * len}" daysdefid="alldays" weeksdefid="allweeks" termsdefid="term"/>`);
    }
  }
  L.push('</lessons>');
  L.push('<cards options="canadd,export:silent" columns="lessonid,period,days,weeks,terms,classroomids">');
  for (const l of input.lessons.filter((x) => x.weekday !== null)) {
    L.push(`<card lessonid="${xml(`${l.groupId}-${l.length}`)}" period="${l.period}" days="${dayBits(l.weekday!)}" weeks="1" terms="1" classroomids="${xml(l.roomId ?? '')}"/>`);
  }
  L.push('</cards>');
  L.push('</timetable>');
  return { filename: `${fileSafe(model.timetable.name)}.xml`, body: L.join('\n') + '\n' };
}


/** One row per placed lesson (and each unplaced one), for a spreadsheet — the whole timetable, or one section, teacher, room or student. */
export async function exportCsv(id: string, q: ExportCsvQueryType) {
  const model = await loadTimetableModel(id);
  const { input, display, grid } = model;
  const view = q.view ?? 'all';
  if (view !== 'all' && !q.id) throw new SchedulingError('Say which one to export');
  const groupShown = (gid: string) => {
    const g = display.groups.find((x) => x.id === gid)!;
    if (view === 'all') return true;
    if (view === 'teacher') return g.teacherId === q.id;
    if (view === 'section') return g.sections.some((s) => s.id === q.id) || g.sectionId === q.id;
    if (view === 'student') return g.memberIds.includes(q.id!);
    return true;
  };
  const rows = input.lessons
    .filter((l) => groupShown(l.groupId) && (view !== 'room' || l.roomId === q.id))
    .sort((a, b) => (a.weekday ?? 99) - (b.weekday ?? 99) || (a.period ?? 99) - (b.period ?? 99) || a.groupId.localeCompare(b.groupId));
  const out = [['Day', 'Period', 'Starts', 'Ends', 'Length', 'Group', 'Subject', 'Teacher', 'Room', 'Students', 'Sections', 'Locked'].join(',')];
  for (const l of rows) {
    const g = display.groups.find((x) => x.id === l.groupId)!;
    const day = grid.days.find((d) => d.weekday === l.weekday);
    const p1 = day?.periods.find((p) => p.period === l.period);
    const p2 = day?.periods.find((p) => p.period === (l.period ?? 0) + l.length - 1);
    const eg = input.groups.find((x) => x.id === l.groupId)!;
    out.push([
      l.weekday === null ? 'Not placed' : WEEKDAY_NAMES[l.weekday], p1?.label ?? '', p1?.startsAt ?? '', p2?.endsAt ?? '', l.length === 2 ? 'double' : 'single',
      g.name, g.subjectName ?? '', g.teacherName ?? '', input.rooms.find((r) => r.id === l.roomId)?.name ?? '', eg.size,
      g.sections.map((s) => `${s.name} (${s.count})`).join('; '), l.locked ? 'yes' : '',
    ].map(csvCell).join(','));
  }
  return { filename: `${fileSafe(model.timetable.name)}${view === 'all' ? '' : `-${view}`}.csv`, body: out.join('\n') + '\n' };
}

const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-') || 'timetable';

export { slotName, cardsFor };
