/**
 * The year's timetable rules (FEATURES_PLAN.md F1, "Constraints"): when a
 * teacher or a room cannot be used, a teacher's most periods per day and per
 * week, and groups whose lessons must not share a day. The rest of the hard
 * rules come from the data itself (a teacher's groups, the students each
 * group shares, room types and sizes, locked lessons).
 *
 * Each teacher's or room's rules are saved together (replace, in one
 * transaction, audited), so the screen's grid of ticks is the whole truth.
 */

import {
  db, scheduleUnavailability, teacherLoadLimit, groupDayRule, teachingGroup, teacher, room, academicYear, eq, and, asc, inArray, isNull, sql,
} from '@repo/db';
import { randomUUID } from 'crypto';
import { cardsFor, type PutTeacherConstraintsType, type PutRoomConstraintsType, type CreateDayRuleType } from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { gridOfYear } from './timetable.services';
import { SchedulingError, isUniqueViolation } from './scheduling-shared.services';
import { todayAtSchool } from '../lib/clock';

async function yearOrThrow(id: string) {
  const [y] = await db.select().from(academicYear).where(eq(academicYear.id, id));
  if (!y) throw new SchedulingError('Academic year not found', 404);
  return y;
}

/** Everything the rules screen shows: the week, each teacher's limits, load and unavailable periods, each room's, the day rules. */
export async function getRules(academicYearId: string) {
  const y = await yearOrThrow(academicYearId);
  const grid = await gridOfYear(y.id);
  const teachers = await db.select({ id: teacher.id, name: teacher.name, isActive: teacher.isActive }).from(teacher).orderBy(asc(teacher.name));
  const rooms = await db.select().from(room).orderBy(asc(room.name));
  const limits = await db.select().from(teacherLoadLimit).where(eq(teacherLoadLimit.academicYearId, y.id));
  const off = await db.select().from(scheduleUnavailability).where(eq(scheduleUnavailability.academicYearId, y.id));
  const groups = await db.select().from(teachingGroup).where(and(eq(teachingGroup.academicYearId, y.id), isNull(teachingGroup.archivedOn))).orderBy(asc(teachingGroup.name));
  const rules = await db.select().from(groupDayRule).where(eq(groupDayRule.academicYearId, y.id));
  const periodsInWeek = grid.days.reduce((n, d) => n + d.periods.length, 0);
  return {
    academicYear: { id: y.id, startYear: y.startYear },
    days: grid.days,
    periodsInWeek,
    teachers: teachers.map((t) => {
      const lim = limits.find((l) => l.teacherId === t.id);
      const load = groups.filter((g) => g.teacherId === t.id).reduce((n, g) => n + g.weeklyPeriods, 0);
      return {
        ...t,
        maxPerDay: lim?.maxPerDay ?? null,
        maxPerWeek: lim?.maxPerWeek ?? null,
        load,
        groups: groups.filter((g) => g.teacherId === t.id).map((g) => ({ id: g.id, name: g.name, weeklyPeriods: g.weeklyPeriods })),
        unavailable: off.filter((o) => o.teacherId === t.id).map((o) => ({ weekday: o.weekday, period: o.period, note: o.note })),
      };
    }).filter((t) => t.isActive || t.load > 0),
    rooms: rooms.map((r) => ({ ...r, unavailable: off.filter((o) => o.roomId === r.id).map((o) => ({ weekday: o.weekday, period: o.period, note: o.note })) })),
    groups: groups.map((g) => ({ id: g.id, name: g.name, cards: cardsFor(g.weeklyPeriods, g.doublePeriods).length })),
    dayRules: rules.map((r) => ({
      id: r.id, groupAId: r.groupAId, groupBId: r.groupBId, note: r.note,
      groupA: groups.find((g) => g.id === r.groupAId)?.name ?? null, groupB: groups.find((g) => g.id === r.groupBId)?.name ?? null,
    })),
  };
}

function dedupe<T extends { weekday: number; period: number | null }>(rows: T[]) {
  const whole = new Set(rows.filter((r) => r.period === null).map((r) => r.weekday));
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (r.period !== null && whole.has(r.weekday)) return false;
    const k = `${r.weekday}:${r.period}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function putTeacherRules(teacherId: string, data: PutTeacherConstraintsType, actorId: string, ctx?: AuditContext) {
  await yearOrThrow(data.academicYearId);
  const cover = await import('./cover.services');
  const result = await db.transaction(async (tx) => {
    const [t] = await tx.select().from(teacher).where(eq(teacher.id, teacherId)).for('update');
    if (!t) throw new SchedulingError('Teacher not found', 404);
    const beforeOff = await tx.select().from(scheduleUnavailability).where(and(eq(scheduleUnavailability.academicYearId, data.academicYearId), eq(scheduleUnavailability.teacherId, teacherId)));
    const [beforeLim] = await tx.select().from(teacherLoadLimit).where(and(eq(teacherLoadLimit.academicYearId, data.academicYearId), eq(teacherLoadLimit.teacherId, teacherId)));
    await tx.delete(scheduleUnavailability).where(and(eq(scheduleUnavailability.academicYearId, data.academicYearId), eq(scheduleUnavailability.teacherId, teacherId)));
    const rows = dedupe(data.unavailable);
    if (rows.length) {
      await tx.insert(scheduleUnavailability).values(rows.map((r) => ({
        id: randomUUID(), academicYearId: data.academicYearId, teacherId, weekday: r.weekday, period: r.period, note: r.note ?? null, createdBy: actorId,
      })));
    }
    if (data.maxPerDay === null && data.maxPerWeek === null) {
      await tx.delete(teacherLoadLimit).where(and(eq(teacherLoadLimit.academicYearId, data.academicYearId), eq(teacherLoadLimit.teacherId, teacherId)));
    } else {
      await tx.insert(teacherLoadLimit).values({ id: randomUUID(), academicYearId: data.academicYearId, teacherId, maxPerDay: data.maxPerDay, maxPerWeek: data.maxPerWeek, updatedBy: actorId })
        .onConflictDoUpdate({ target: [teacherLoadLimit.academicYearId, teacherLoadLimit.teacherId], set: { maxPerDay: data.maxPerDay, maxPerWeek: data.maxPerWeek, updatedBy: actorId, updatedAt: new Date() } });
    }
    await logAction(actorId, 'SCHEDULE_RULES_SET', 'teacher', teacherId,
      { maxPerDay: beforeLim?.maxPerDay ?? null, maxPerWeek: beforeLim?.maxPerWeek ?? null, unavailable: beforeOff.length },
      { academicYearId: data.academicYearId, maxPerDay: data.maxPerDay, maxPerWeek: data.maxPerWeek, unavailable: rows.length }, ctx, tx);
    // The cover this teacher gives from today is judged again by the new rules (round two, flag 2: a
    // period they can no longer teach, or a day's limit now passed, and it is theirs no longer).
    const coversLost = await cover.recheckCovers(tx, await cover.liveCoversFrom(tx, { teacherIds: [teacherId], from: todayAtSchool() }), actorId, `${t.name}'s timetable rules changed`, ctx);
    return { teacherId, unavailable: rows.length, maxPerDay: data.maxPerDay, maxPerWeek: data.maxPerWeek, coversLost };
  });
  await cover.coverChangeNotices(result.coversLost, 'no_longer_holds').catch((err) => console.error('[rules] cover notices failed:', err));
  return { ...result, coversLost: await cover.describeCovers(result.coversLost) };
}

export async function putRoomRules(roomId: string, data: PutRoomConstraintsType, actorId: string, ctx?: AuditContext) {
  await yearOrThrow(data.academicYearId);
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(room).where(eq(room.id, roomId)).for('update');
    if (!r) throw new SchedulingError('Room not found', 404);
    const before = await tx.select().from(scheduleUnavailability).where(and(eq(scheduleUnavailability.academicYearId, data.academicYearId), eq(scheduleUnavailability.roomId, roomId)));
    await tx.delete(scheduleUnavailability).where(and(eq(scheduleUnavailability.academicYearId, data.academicYearId), eq(scheduleUnavailability.roomId, roomId)));
    const rows = dedupe(data.unavailable);
    if (rows.length) {
      await tx.insert(scheduleUnavailability).values(rows.map((x) => ({
        id: randomUUID(), academicYearId: data.academicYearId, roomId, weekday: x.weekday, period: x.period, note: x.note ?? null, createdBy: actorId,
      })));
    }
    await logAction(actorId, 'SCHEDULE_RULES_SET', 'room', roomId, { unavailable: before.length }, { academicYearId: data.academicYearId, unavailable: rows.length }, ctx, tx);
    return { roomId, unavailable: rows.length };
  });
}

export async function createDayRule(data: CreateDayRuleType, actorId: string, ctx?: AuditContext) {
  const [a, b] = [data.groupAId, data.groupBId].sort() as [string, string];
  try {
    return await db.transaction(async (tx) => {
      const groups = await tx.select().from(teachingGroup).where(inArray(teachingGroup.id, [a, b]));
      if (groups.length !== new Set([a, b]).size) throw new SchedulingError('Teaching group not found', 404);
      if (groups.some((g) => g.academicYearId !== data.academicYearId)) throw new SchedulingError('Both groups must belong to the year');
      const id = randomUUID();
      await tx.insert(groupDayRule).values({ id, academicYearId: data.academicYearId, groupAId: a, groupBId: b, note: data.note ?? null, createdBy: actorId });
      const names = groups.map((g) => g.name);
      await logAction(actorId, 'SCHEDULE_RULES_SET', 'schedule_rules', id, null, { kind: 'not_same_day', groups: names, note: data.note ?? null }, ctx, tx);
      return { id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new SchedulingError('That rule already exists', 409);
    throw err;
  }
}

export async function deleteDayRule(id: string, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [r] = await tx.delete(groupDayRule).where(eq(groupDayRule.id, id)).returning();
    if (!r) throw new SchedulingError('Rule not found', 404);
    await logAction(actorId, 'SCHEDULE_RULES_SET', 'schedule_rules', id, { kind: 'not_same_day', groupAId: r.groupAId, groupBId: r.groupBId }, null, ctx, tx);
    return { id };
  });
}

export { sql };
