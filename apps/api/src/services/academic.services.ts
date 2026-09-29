/**
 * Academic structure (FEATURES_PLAN.md F0a): academic years and terms, the
 * school calendar, bell schedules, rooms, and homeroom sections with a
 * membership that keeps its history, plus the bulk step that moves sections
 * into the new academic year.
 *
 * The coordinator and admin manage all of it; every change is audited with
 * the actor. Dates are the school's own calendar dates (YYYY-MM-DD), never
 * instants, so a day is the same day whatever the server's zone.
 *
 * Used by later features (FEATURES_PLAN.md §2): F1 builds the timetable on
 * the bell schedules, rooms and sections; F2 and F3 ask `getSchoolDay` what
 * a date is; the Student 360 shows a student's section.
 */

import {
  db, academicYear, academicTerm, calendarEntry, bellSchedule, bellPeriod, room, section, sectionMembership, user, teacher,
  eq, and, ne, inArray, isNull, sql, asc, gradeTodayExtras,
} from '@repo/db';
import { randomUUID } from 'crypto';
import {
  academicYearLabel, academicYearShortLabel, academicYearStartOf, gradeInAcademicYear, schoolDateString,
  type CreateAcademicYearType, type UpdateAcademicYearType, type CreateTermType, type UpdateTermType,
  type CreateCalendarEntryType, type CreateBellScheduleType, type UpdateBellScheduleType, type ReplaceBellPeriodsType,
  type CreateRoomType, type UpdateRoomType, type CreateSectionType, type UpdateSectionType,
  type AddSectionMembersType, type EndSectionMembershipType, type RollOverSectionsType,
} from '@repo/validations';
import { logAction, type AuditContext } from './audit.services';
import { getSetting } from './settings.services';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class AcademicError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 = 400) {
    super(message);
  }
}

const isUniqueViolation = (err: unknown) =>
  (err as { code?: string } | null)?.code === '23505' || (err as { cause?: { code?: string } } | null)?.cause?.code === '23505';

/** The day before a YYYY-MM-DD date. */
function dayBefore(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function readableDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// ─── Academic years ──────────────────────────────────────────────────────────

export async function listAcademicYears() {
  const years = await db.query.academicYear.findMany({
    with: { terms: { orderBy: (t, { asc: a }) => [a(t.startsOn)] } },
    orderBy: (y, { desc }) => [desc(y.startYear)],
  });
  const counts = await db
    .select({ academicYearId: section.academicYearId, n: sql<number>`count(*)::int` })
    .from(section)
    .groupBy(section.academicYearId);
  const sectionsBy = new Map(counts.map((c) => [c.academicYearId, c.n]));
  const current = academicYearStartOf();
  return years.map((y) => ({
    ...y,
    label: academicYearLabel(y.startYear),
    shortLabel: academicYearShortLabel(y.startYear),
    isCurrent: y.startYear === current,
    sectionCount: sectionsBy.get(y.id) ?? 0,
  }));
}

async function yearOrThrow(id: string, executor: typeof db | Tx = db) {
  const [y] = await executor.select().from(academicYear).where(eq(academicYear.id, id));
  if (!y) throw new AcademicError('Academic year not found', 404);
  return y;
}

function assertInsideYear(startYear: number, startsOn: string, endsOn: string) {
  const first = `${startYear}-07-01`;
  const last = `${startYear + 1}-06-30`;
  if (startsOn < first || endsOn > last) {
    throw new AcademicError(`${academicYearShortLabel(startYear)} runs from 1 July ${startYear} to 30 June ${startYear + 1}: its dates must fall inside it`);
  }
}

export async function createAcademicYear(data: CreateAcademicYearType, actorId: string, ctx?: AuditContext) {
  assertInsideYear(data.startYear, data.startsOn, data.endsOn);
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(academicYear).values({ id: randomUUID(), ...data }).returning();
      await logAction(actorId, 'ACADEMIC_YEAR_CREATED', 'academic_year', created!.id, null, created as Record<string, unknown>, ctx, tx);
      return created!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AcademicError(`${academicYearShortLabel(data.startYear)} already exists`, 409);
    throw err;
  }
}

export async function updateAcademicYear(id: string, data: UpdateAcademicYearType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [y] = await tx.select().from(academicYear).where(eq(academicYear.id, id)).for('update');
    if (!y) throw new AcademicError('Academic year not found', 404);
    const startsOn = data.startsOn ?? y.startsOn;
    const endsOn = data.endsOn ?? y.endsOn;
    if (endsOn < startsOn) throw new AcademicError('The last day must be on or after the first day');
    assertInsideYear(y.startYear, startsOn, endsOn);
    const outside = await tx
      .select({ name: academicTerm.name })
      .from(academicTerm)
      .where(and(eq(academicTerm.academicYearId, id), sql`(${academicTerm.startsOn} < ${startsOn} OR ${academicTerm.endsOn} > ${endsOn})`));
    if (outside.length) {
      throw new AcademicError(`These terms would fall outside the year: ${outside.map((t) => t.name).join(', ')} — change them first`);
    }
    const [updated] = await tx.update(academicYear).set({ startsOn, endsOn, updatedAt: new Date() }).where(eq(academicYear.id, id)).returning();
    await logAction(actorId, 'ACADEMIC_YEAR_UPDATED', 'academic_year', id, { startsOn: y.startsOn, endsOn: y.endsOn }, { startsOn, endsOn }, ctx, tx);
    return updated!;
  });
}

// ─── Terms ───────────────────────────────────────────────────────────────────

async function assertTermFits(tx: Tx, academicYearId: string, startsOn: string, endsOn: string, excludeId?: string) {
  const y = await yearOrThrow(academicYearId, tx);
  if (startsOn < y.startsOn || endsOn > y.endsOn) {
    throw new AcademicError(`A term falls inside the school year (${readableDate(y.startsOn)} – ${readableDate(y.endsOn)})`);
  }
  const clash = await tx
    .select({ name: academicTerm.name })
    .from(academicTerm)
    .where(and(
      eq(academicTerm.academicYearId, academicYearId),
      sql`${academicTerm.startsOn} <= ${endsOn} AND ${academicTerm.endsOn} >= ${startsOn}`,
      excludeId ? ne(academicTerm.id, excludeId) : undefined,
    ));
  if (clash.length) throw new AcademicError(`It overlaps ${clash.map((c) => c.name).join(', ')}`, 409);
}

export async function createTerm(data: CreateTermType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    // One term change per year at a time, so two overlapping terms cannot both pass the check.
    await tx.select({ id: academicYear.id }).from(academicYear).where(eq(academicYear.id, data.academicYearId)).for('update');
    await assertTermFits(tx, data.academicYearId, data.startsOn, data.endsOn);
    const [created] = await tx.insert(academicTerm).values({ id: randomUUID(), ...data }).returning();
    await logAction(actorId, 'TERM_CREATED', 'term', created!.id, null, created as Record<string, unknown>, ctx, tx);
    return created!;
  });
}

export async function updateTerm(id: string, data: UpdateTermType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(academicTerm).where(eq(academicTerm.id, id));
    if (!t) throw new AcademicError('Term not found', 404);
    await tx.select({ id: academicYear.id }).from(academicYear).where(eq(academicYear.id, t.academicYearId)).for('update');
    const next = { name: data.name ?? t.name, startsOn: data.startsOn ?? t.startsOn, endsOn: data.endsOn ?? t.endsOn };
    if (next.endsOn < next.startsOn) throw new AcademicError('The end date must be on or after the start date');
    await assertTermFits(tx, t.academicYearId, next.startsOn, next.endsOn, id);
    const [updated] = await tx.update(academicTerm).set({ ...next, updatedAt: new Date() }).where(eq(academicTerm.id, id)).returning();
    await logAction(actorId, 'TERM_UPDATED', 'term', id, { name: t.name, startsOn: t.startsOn, endsOn: t.endsOn }, next, ctx, tx);
    return updated!;
  });
}

export async function deleteTerm(id: string, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [t] = await tx.delete(academicTerm).where(eq(academicTerm.id, id)).returning();
    if (!t) throw new AcademicError('Term not found', 404);
    await logAction(actorId, 'TERM_DELETED', 'term', id, t as Record<string, unknown>, null, ctx, tx);
    return t;
  });
}

// ─── The school calendar ─────────────────────────────────────────────────────

export async function listCalendar(filters: { academicYearId?: string; from?: string; to?: string }) {
  return db.query.calendarEntry.findMany({
    where: (e, { and: andOp, eq: eqOp, gte, lte }) => andOp(
      filters.academicYearId ? eqOp(e.academicYearId, filters.academicYearId) : undefined,
      filters.to ? lte(e.startsOn, filters.to) : undefined,
      filters.from ? gte(e.endsOn, filters.from) : undefined,
    ),
    with: { bellSchedule: { columns: { id: true, name: true } } },
    orderBy: (e, { asc: a }) => [a(e.startsOn)],
  });
}

export async function createCalendarEntry(data: CreateCalendarEntryType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const y = await yearOrThrow(data.academicYearId, tx);
    if (data.startsOn < y.startsOn || data.endsOn > y.endsOn) {
      throw new AcademicError(`The days fall inside the school year (${readableDate(y.startsOn)} – ${readableDate(y.endsOn)})`);
    }
    if (data.bellScheduleId) {
      const [b] = await tx.select({ yearId: bellSchedule.academicYearId }).from(bellSchedule).where(eq(bellSchedule.id, data.bellScheduleId));
      if (!b || b.yearId !== data.academicYearId) throw new AcademicError('That bell schedule belongs to another year');
    }
    // One entry per day: the second would leave what the day is ambiguous.
    const clash = await tx
      .select({ name: calendarEntry.name, startsOn: calendarEntry.startsOn })
      .from(calendarEntry)
      .where(and(eq(calendarEntry.academicYearId, data.academicYearId), sql`${calendarEntry.startsOn} <= ${data.endsOn} AND ${calendarEntry.endsOn} >= ${data.startsOn}`));
    if (clash.length) {
      throw new AcademicError(`Those days already have an entry: ${clash.map((c) => `${c.name} (${readableDate(c.startsOn)})`).join(', ')}`, 409);
    }
    const [created] = await tx.insert(calendarEntry).values({
      id: randomUUID(),
      academicYearId: data.academicYearId,
      kind: data.kind,
      name: data.name,
      startsOn: data.startsOn,
      endsOn: data.endsOn,
      bellScheduleId: data.bellScheduleId ?? null,
      notes: data.notes ?? null,
      createdBy: actorId,
    }).returning();
    await logAction(actorId, 'CALENDAR_ENTRY_CREATED', 'calendar_entry', created!.id, null, created as Record<string, unknown>, ctx, tx);
    return created!;
  });
}

export async function deleteCalendarEntry(id: string, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [e] = await tx.delete(calendarEntry).where(eq(calendarEntry.id, id)).returning();
    if (!e) throw new AcademicError('Calendar entry not found', 404);
    await logAction(actorId, 'CALENDAR_ENTRY_DELETED', 'calendar_entry', id, e as Record<string, unknown>, null, ctx, tx);
    return e;
  });
}

/**
 * What a date is at the school: in which year and term, whether it is a
 * school day and why, and the bells that ring. The contract later features
 * build on (F1's timetable, F2's leave, F3's expected presence).
 *
 * kind: 'school_day' (an ordinary day of the school week, in term),
 * 'extra_school_day' (a calendar school_day on a day the school is usually
 * closed), 'early_dismissal', 'exam_only', 'holiday', 'weekend', 'out_of_term'
 * (between terms or outside the year), 'no_academic_year'.
 */
export async function getSchoolDay(date: string) {
  const [y] = await db.select().from(academicYear).where(sql`${academicYear.startsOn} <= ${date} AND ${academicYear.endsOn} >= ${date}`);
  const weekday = weekdayOf(date);
  if (!y) {
    return { date, weekday, academicYear: null, term: null, kind: 'no_academic_year' as const, isSchoolDay: false, entry: null, bellSchedule: null, periods: [] };
  }
  const [term] = await db.select().from(academicTerm)
    .where(and(eq(academicTerm.academicYearId, y.id), sql`${academicTerm.startsOn} <= ${date} AND ${academicTerm.endsOn} >= ${date}`));
  const [entry] = await db.select().from(calendarEntry)
    .where(and(eq(calendarEntry.academicYearId, y.id), sql`${calendarEntry.startsOn} <= ${date} AND ${calendarEntry.endsOn} >= ${date}`));
  const schoolWeekdays = await getSetting('calendar.schoolWeekdays');
  const usualDay = schoolWeekdays.includes(weekday);

  let kind: 'school_day' | 'extra_school_day' | 'early_dismissal' | 'exam_only' | 'holiday' | 'weekend' | 'out_of_term';
  if (entry?.kind === 'holiday') kind = 'holiday';
  else if (entry?.kind === 'school_day') kind = usualDay ? 'school_day' : 'extra_school_day';
  else if (!term) kind = 'out_of_term';
  else if (!usualDay) kind = 'weekend';
  else if (entry?.kind === 'early_dismissal') kind = 'early_dismissal';
  else if (entry?.kind === 'exam_only') kind = 'exam_only';
  else kind = 'school_day';
  const isSchoolDay = ['school_day', 'extra_school_day', 'early_dismissal', 'exam_only'].includes(kind);

  let schedule: typeof bellSchedule.$inferSelect | undefined;
  if (isSchoolDay) {
    if (entry?.bellScheduleId) {
      [schedule] = await db.select().from(bellSchedule).where(eq(bellSchedule.id, entry.bellScheduleId));
    }
    schedule ??= (await db.select().from(bellSchedule).where(and(eq(bellSchedule.academicYearId, y.id), eq(bellSchedule.isDefault, true))))[0];
  }
  let periods: (typeof bellPeriod.$inferSelect)[] = [];
  if (schedule) {
    const all = await db.select().from(bellPeriod).where(eq(bellPeriod.bellScheduleId, schedule.id)).orderBy(asc(bellPeriod.position));
    const today = all.filter((p) => p.weekday === weekday);
    periods = today.length ? today : all.filter((p) => p.weekday === null);
  }
  return {
    date,
    weekday,
    academicYear: { id: y.id, startYear: y.startYear, label: academicYearLabel(y.startYear) },
    term: term ? { id: term.id, name: term.name } : null,
    kind,
    isSchoolDay,
    entry: entry ? { id: entry.id, kind: entry.kind, name: entry.name } : null,
    bellSchedule: schedule ? { id: schedule.id, name: schedule.name } : null,
    periods: periods.map((p) => ({ label: p.label, kind: p.kind, startsAt: p.startsAt, endsAt: p.endsAt })),
  };
}

/** Today's school day, in Cairo time. */
export async function getSchoolToday() {
  return getSchoolDay(schoolDateString(new Date()));
}

// ─── Bell schedules ──────────────────────────────────────────────────────────

export async function listBellSchedules(academicYearId?: string) {
  return db.query.bellSchedule.findMany({
    where: academicYearId ? (b, { eq: eqOp }) => eqOp(b.academicYearId, academicYearId) : undefined,
    with: { periods: { orderBy: (p, { asc: a }) => [a(p.position)] } },
    orderBy: (b, { desc, asc: a }) => [desc(b.isDefault), a(b.name)],
  });
}

export async function createBellSchedule(data: CreateBellScheduleType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    await yearOrThrow(data.academicYearId, tx);
    if (data.isDefault) {
      await tx.update(bellSchedule).set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(bellSchedule.academicYearId, data.academicYearId), eq(bellSchedule.isDefault, true)));
    }
    const [created] = await tx.insert(bellSchedule).values({ id: randomUUID(), ...data }).returning();
    await logAction(actorId, 'BELL_SCHEDULE_CREATED', 'bell_schedule', created!.id, null, created as Record<string, unknown>, ctx, tx);
    return created!;
  });
}

export async function updateBellSchedule(id: string, data: UpdateBellScheduleType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(bellSchedule).where(eq(bellSchedule.id, id)).for('update');
    if (!b) throw new AcademicError('Bell schedule not found', 404);
    if (data.isDefault === true && !b.isDefault) {
      await tx.update(bellSchedule).set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(bellSchedule.academicYearId, b.academicYearId), eq(bellSchedule.isDefault, true)));
    }
    const [updated] = await tx.update(bellSchedule).set({ ...data, updatedAt: new Date() }).where(eq(bellSchedule.id, id)).returning();
    await logAction(actorId, 'BELL_SCHEDULE_UPDATED', 'bell_schedule', id, { name: b.name, isDefault: b.isDefault }, data, ctx, tx);
    return updated!;
  });
}

/**
 * Save a schedule's whole day grid at once. Periods of one day may not
 * overlap: a lesson and a break at the same minute cannot both ring.
 */
export async function replaceBellPeriods(id: string, data: ReplaceBellPeriodsType, actorId: string, ctx?: AuditContext) {
  const byDay = new Map<string, typeof data.periods>();
  for (const p of data.periods) {
    const key = p.weekday === null ? 'every' : String(p.weekday);
    byDay.set(key, [...(byDay.get(key) ?? []), p]);
  }
  for (const [, list] of byDay) {
    const sorted = [...list].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.startsAt < sorted[i - 1]!.endsAt) {
        throw new AcademicError(`${sorted[i - 1]!.label} (${sorted[i - 1]!.startsAt}–${sorted[i - 1]!.endsAt}) and ${sorted[i]!.label} (${sorted[i]!.startsAt}–${sorted[i]!.endsAt}) overlap`);
      }
    }
  }
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(bellSchedule).where(eq(bellSchedule.id, id)).for('update');
    if (!b) throw new AcademicError('Bell schedule not found', 404);
    const before = await tx.select().from(bellPeriod).where(eq(bellPeriod.bellScheduleId, id));
    await tx.delete(bellPeriod).where(eq(bellPeriod.bellScheduleId, id));
    const ordered = [...data.periods].sort((a, c) =>
      (a.weekday ?? -1) - (c.weekday ?? -1) || a.startsAt.localeCompare(c.startsAt));
    if (ordered.length) {
      await tx.insert(bellPeriod).values(ordered.map((p, i) => ({ id: randomUUID(), bellScheduleId: id, position: i, ...p })));
    }
    await logAction(actorId, 'BELL_PERIODS_REPLACED', 'bell_schedule', id, { periods: before.length }, { periods: ordered.length }, ctx, tx);
    return tx.select().from(bellPeriod).where(eq(bellPeriod.bellScheduleId, id)).orderBy(asc(bellPeriod.position));
  });
}

export async function deleteBellSchedule(id: string, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [b] = await tx.delete(bellSchedule).where(eq(bellSchedule.id, id)).returning();
    if (!b) throw new AcademicError('Bell schedule not found', 404);
    await logAction(actorId, 'BELL_SCHEDULE_DELETED', 'bell_schedule', id, b as Record<string, unknown>, null, ctx, tx);
    return b;
  });
}

// ─── Rooms ───────────────────────────────────────────────────────────────────

export async function listRooms() {
  return db.query.room.findMany({ orderBy: (r, { desc, asc: a }) => [desc(r.isActive), a(r.name)] });
}

export async function createRoom(data: CreateRoomType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(room).values({
        id: randomUUID(), name: data.name, capacity: data.capacity ?? null, type: data.type, features: data.features, notes: data.notes ?? null,
      }).returning();
      await logAction(actorId, 'ROOM_CREATED', 'room', created!.id, null, created as Record<string, unknown>, ctx, tx);
      return created!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AcademicError(`A room named ${data.name} already exists`, 409);
    throw err;
  }
}

export async function updateRoom(id: string, data: UpdateRoomType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      const [r] = await tx.select().from(room).where(eq(room.id, id)).for('update');
      if (!r) throw new AcademicError('Room not found', 404);
      const [updated] = await tx.update(room).set({ ...data, updatedAt: new Date() }).where(eq(room.id, id)).returning();
      await logAction(actorId, 'ROOM_UPDATED', 'room', id, r as Record<string, unknown>, data as Record<string, unknown>, ctx, tx);
      return updated!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AcademicError(`A room named ${data.name} already exists`, 409);
    throw err;
  }
}

// ─── Sections ────────────────────────────────────────────────────────────────

export async function listSections(academicYearId?: string) {
  const current = academicYearStartOf();
  const yearId = academicYearId
    ?? (await db.select({ id: academicYear.id }).from(academicYear).where(eq(academicYear.startYear, current)))[0]?.id;
  if (!yearId) return [];
  const rows = await db.query.section.findMany({
    where: (s, { eq: eqOp }) => eqOp(s.academicYearId, yearId),
    with: {
      homeroomTeacher: { columns: { id: true, name: true } },
      room: { columns: { id: true, name: true, capacity: true } },
      academicYear: { columns: { id: true, startYear: true } },
    },
    orderBy: (s, { asc: a }) => [a(s.grade), a(s.name)],
  });
  const counts = await db
    .select({ sectionId: sectionMembership.sectionId, n: sql<number>`count(*)::int` })
    .from(sectionMembership)
    .where(and(inArray(sectionMembership.sectionId, rows.map((r) => r.id).concat('__none__')), isNull(sectionMembership.endedOn)))
    .groupBy(sectionMembership.sectionId);
  const by = new Map(counts.map((c) => [c.sectionId, c.n]));
  return rows.map((r) => ({ ...r, memberCount: by.get(r.id) ?? 0 }));
}

export async function getSection(id: string) {
  const s = await db.query.section.findFirst({
    where: (x, { eq: eqOp }) => eqOp(x.id, id),
    with: {
      homeroomTeacher: { columns: { id: true, name: true } },
      room: { columns: { id: true, name: true, capacity: true } },
      academicYear: { columns: { id: true, startYear: true, startsOn: true, endsOn: true } },
      memberships: {
        with: {
          student: {
            columns: { id: true, name: true, email: true, studentId: true, cohortYear: true, leftOn: true, leftKind: true },
            extras: gradeTodayExtras,
          },
        },
        orderBy: (m, { asc: a }) => [a(m.startedOn)],
      },
    },
  });
  if (!s) throw new AcademicError('Section not found', 404);
  const members = s.memberships.filter((m) => m.endedOn === null);
  const history = s.memberships.filter((m) => m.endedOn !== null);
  const withYearGrade = (m: (typeof s.memberships)[number]) => ({
    ...m,
    gradeThatYear: gradeInAcademicYear(m.student.cohortYear, s.academicYear.startYear),
  });
  return { ...s, memberships: undefined, members: members.map(withYearGrade), history: history.map(withYearGrade) };
}

async function assertSectionLinks(tx: Tx, homeroomTeacherId?: string | null, roomId?: string | null) {
  if (homeroomTeacherId) {
    const [t] = await tx.select({ isActive: teacher.isActive }).from(teacher).where(eq(teacher.id, homeroomTeacherId));
    if (!t) throw new AcademicError('Homeroom teacher not found', 404);
    if (!t.isActive) throw new AcademicError('That teacher is inactive');
  }
  if (roomId) {
    const [r] = await tx.select({ isActive: room.isActive }).from(room).where(eq(room.id, roomId));
    if (!r) throw new AcademicError('Room not found', 404);
    if (!r.isActive) throw new AcademicError('That room is not in use');
  }
}

export async function createSection(data: CreateSectionType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      await yearOrThrow(data.academicYearId, tx);
      await assertSectionLinks(tx, data.homeroomTeacherId, data.roomId);
      const [created] = await tx.insert(section).values({
        id: randomUUID(),
        academicYearId: data.academicYearId,
        grade: data.grade,
        name: data.name,
        homeroomTeacherId: data.homeroomTeacherId ?? null,
        roomId: data.roomId ?? null,
        capacity: data.capacity ?? null,
      }).returning();
      await logAction(actorId, 'SECTION_CREATED', 'section', created!.id, null, created as Record<string, unknown>, ctx, tx);
      return created!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AcademicError(`That year already has a section named ${data.name}`, 409);
    throw err;
  }
}

export async function updateSection(id: string, data: UpdateSectionType, actorId: string, ctx?: AuditContext) {
  try {
    return await db.transaction(async (tx) => {
      const [s] = await tx.select().from(section).where(eq(section.id, id)).for('update');
      if (!s) throw new AcademicError('Section not found', 404);
      await assertSectionLinks(tx, data.homeroomTeacherId, data.roomId);
      const [updated] = await tx.update(section).set({ ...data, updatedAt: new Date() }).where(eq(section.id, id)).returning();
      await logAction(actorId, 'SECTION_UPDATED', 'section', id,
        { name: s.name, homeroomTeacherId: s.homeroomTeacherId, roomId: s.roomId, capacity: s.capacity }, data as Record<string, unknown>, ctx, tx);
      return updated!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AcademicError(`That year already has a section named ${data.name}`, 409);
    throw err;
  }
}

export async function deleteSection(id: string, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(section).where(eq(section.id, id)).for('update');
    if (!s) throw new AcademicError('Section not found', 404);
    const [m] = await tx.select({ id: sectionMembership.id }).from(sectionMembership).where(eq(sectionMembership.sectionId, id)).limit(1);
    // Its membership is history (who was in 11A in 2026/27); rename it instead.
    if (m) throw new AcademicError('This section has had students — its history stays. Rename it, or leave it empty', 409);
    await tx.update(section).set({ rolledFromSectionId: null }).where(eq(section.rolledFromSectionId, id));
    await tx.delete(section).where(eq(section.id, id));
    await logAction(actorId, 'SECTION_DELETED', 'section', id, s as Record<string, unknown>, null, ctx, tx);
    return s;
  });
}

/**
 * Put students in a section. Each must be a student still at the school
 * whose grade in the section's academic year is the section's grade. A
 * student in another section of the same year is moved: that membership
 * ends the day before this one starts (history kept). A student already in
 * this section is left as they are.
 */
export async function addSectionMembers(sectionId: string, data: AddSectionMembersType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [s] = await tx
      .select({ id: section.id, name: section.name, grade: section.grade, capacity: section.capacity, academicYearId: section.academicYearId, startYear: academicYear.startYear, startsOn: academicYear.startsOn, endsOn: academicYear.endsOn })
      .from(section)
      .innerJoin(academicYear, eq(academicYear.id, section.academicYearId))
      .where(eq(section.id, sectionId))
      .for('update', { of: section });
    if (!s) throw new AcademicError('Section not found', 404);
    const today = schoolDateString(new Date());
    const startsOn = data.startsOn ?? (today < s.startsOn ? s.startsOn : today > s.endsOn ? s.endsOn : today);
    if (startsOn < s.startsOn || startsOn > s.endsOn) {
      throw new AcademicError(`The start date falls inside the school year (${readableDate(s.startsOn)} – ${readableDate(s.endsOn)})`);
    }
    const ids = [...new Set(data.studentIds)];
    const students = await tx
      .select({ id: user.id, name: user.name, role: user.role, cohortYear: user.cohortYear, leftOn: user.leftOn })
      .from(user)
      .where(inArray(user.id, ids))
      .orderBy(user.id)
      .for('update');
    if (students.length !== ids.length) throw new AcademicError('One or more students were not found', 404);
    const problems: string[] = [];
    for (const st of students) {
      if (st.role !== 'student') problems.push(`${st.name} is not a student`);
      else if (st.leftOn) problems.push(`${st.name} has left the school`);
      else {
        const g = gradeInAcademicYear(st.cohortYear, s.startYear);
        if (g === null) problems.push(`${st.name}'s grade is not recorded`);
        else if (g !== s.grade) problems.push(`${st.name} is in grade ${g > 12 ? 'past 12 (graduated)' : g} in ${academicYearShortLabel(s.startYear)}, not ${s.grade}`);
      }
    }
    if (problems.length) throw new AcademicError(`${s.name} is a grade ${s.grade} section: ${problems.join('; ')}`);

    const open = await tx
      .select({ id: sectionMembership.id, studentId: sectionMembership.studentId, sectionId: sectionMembership.sectionId, startedOn: sectionMembership.startedOn, sectionName: section.name })
      .from(sectionMembership)
      .innerJoin(section, eq(section.id, sectionMembership.sectionId))
      .where(and(inArray(sectionMembership.studentId, ids), eq(sectionMembership.academicYearId, s.academicYearId), isNull(sectionMembership.endedOn)))
      .for('update', { of: sectionMembership });
    const openBy = new Map(open.map((o) => [o.studentId, o]));
    const toAdd = ids.filter((id) => openBy.get(id)?.sectionId !== sectionId);
    // A move starts on or after the day the student joined their current
    // section: dated before it, the new section would begin before the old one
    // did and the history would overlap (found on 30 Sep 2026 when a test's
    // date and the school's differed by a day).
    const tooEarly = toAdd
      .map((id) => ({ id, prev: openBy.get(id) }))
      .filter((m) => m.prev && startsOn < m.prev.startedOn)
      .map((m) => `${students.find((st) => st.id === m.id)!.name} joined ${m.prev!.sectionName} on ${readableDate(m.prev!.startedOn)}`);
    if (tooEarly.length) {
      throw new AcademicError(`A move must start on or after the day the student joined their current section: ${tooEarly.join('; ')}`, 409);
    }
    if (s.capacity !== null) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(sectionMembership)
        .where(and(eq(sectionMembership.sectionId, sectionId), isNull(sectionMembership.endedOn))) as [{ n: number }];
      if (n + toAdd.length > s.capacity) {
        throw new AcademicError(`${s.name} holds ${s.capacity}: it has ${n}, and ${toAdd.length} more would not fit`, 409);
      }
    }
    const moved: { studentId: string; from: string }[] = [];
    for (const id of toAdd) {
      const prev = openBy.get(id);
      if (prev) {
        const endedOn = prev.startedOn >= startsOn ? prev.startedOn : dayBefore(startsOn);
        await tx.update(sectionMembership)
          .set({ endedOn, endReason: `Moved to ${s.name}`, endedBy: actorId })
          .where(eq(sectionMembership.id, prev.id));
        moved.push({ studentId: id, from: prev.sectionName });
      }
    }
    if (toAdd.length) {
      await tx.insert(sectionMembership).values(toAdd.map((studentId) => ({
        id: randomUUID(), sectionId, studentId, academicYearId: s.academicYearId, startedOn: startsOn, addedBy: actorId,
      })));
      await logAction(actorId, 'SECTION_MEMBERS_ADDED', 'section', sectionId, null,
        { added: toAdd, moved, startsOn, alreadyIn: ids.filter((id) => !toAdd.includes(id)) }, ctx, tx);
    }
    return { added: toAdd.length, moved: moved.length, alreadyIn: ids.length - toAdd.length };
  });
}

export async function endSectionMembership(sectionId: string, membershipId: string, data: EndSectionMembershipType, actorId: string, ctx?: AuditContext) {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(sectionMembership)
      .where(and(eq(sectionMembership.id, membershipId), eq(sectionMembership.sectionId, sectionId)))
      .for('update');
    if (!m) throw new AcademicError('Membership not found', 404);
    if (m.endedOn) throw new AcademicError('That student already left this section', 409);
    const endedOn = data.endedOn ?? schoolDateString(new Date());
    if (endedOn < m.startedOn) throw new AcademicError('A membership cannot end before it started');
    const [updated] = await tx.update(sectionMembership)
      .set({ endedOn, endReason: data.reason, endedBy: actorId })
      .where(eq(sectionMembership.id, membershipId))
      .returning();
    await logAction(actorId, 'SECTION_MEMBERSHIP_ENDED', 'section', sectionId, { membershipId, studentId: m.studentId }, { endedOn, reason: data.reason }, ctx, tx);
    return updated!;
  });
}

/** The section a grade-g name becomes in grade g+1: "10A" → "11A", "11-Blue" → "12-Blue". */
function bumpedName(name: string, grade: number): string {
  const m = /^(\d{2})(.*)$/.exec(name.trim());
  if (m && Number(m[1]) === grade) return `${grade + 1}${m[2]}`;
  return `${grade + 1} ${name.trim()}`;
}

/**
 * Move sections into the next academic year (preview, then commit). Each
 * grade-10 and grade-11 section of the source year becomes a section one
 * grade up in the target year, with its homeroom teacher and room, and the
 * members who are in that grade then (a student repeating the year, or who
 * left, stays for the coordinator to place). Grade-12 sections graduate.
 * Running it again changes nothing: a target section remembers the section
 * it was made from, and a student already placed in the target year is
 * left there.
 */
export async function rollOverSections(data: RollOverSectionsType, actorId: string, ctx?: AuditContext) {
  const run = async (tx: Tx) => {
    const from = await yearOrThrow(data.fromAcademicYearId, tx);
    const to = await yearOrThrow(data.toAcademicYearId, tx);
    if (to.startYear !== from.startYear + 1) {
      throw new AcademicError(`Sections move into the year right after: ${academicYearShortLabel(from.startYear)} rolls into ${academicYearShortLabel(from.startYear + 1)}`);
    }
    // One roll-over at a time for this target year.
    await tx.select({ id: academicYear.id }).from(academicYear).where(eq(academicYear.id, to.id)).for('update');

    const sources = await tx.select().from(section).where(eq(section.academicYearId, from.id)).orderBy(asc(section.grade), asc(section.name));
    const targets = await tx.select().from(section).where(eq(section.academicYearId, to.id));
    const placed = new Set((await tx.select({ studentId: sectionMembership.studentId }).from(sectionMembership)
      .where(and(eq(sectionMembership.academicYearId, to.id), isNull(sectionMembership.endedOn)))).map((r) => r.studentId));

    const plan: {
      from: { id: string; name: string; grade: number };
      to: { id: string | null; name: string; grade: number; exists: boolean };
      moving: { id: string; name: string }[];
      staying: { id: string; name: string; why: string }[];
      alreadyPlaced: number;
    }[] = [];
    const graduating: { id: string; name: string; section: string }[] = [];
    let sectionsCreated = 0;
    let studentsMoved = 0;

    for (const src of sources) {
      const members = await tx
        .select({ id: user.id, name: user.name, cohortYear: user.cohortYear, leftOn: user.leftOn })
        .from(sectionMembership)
        .innerJoin(user, eq(user.id, sectionMembership.studentId))
        .where(and(eq(sectionMembership.sectionId, src.id), isNull(sectionMembership.endedOn)))
        .orderBy(asc(user.name));
      if (src.grade >= 12) {
        for (const m of members) if (!m.leftOn) graduating.push({ id: m.id, name: m.name, section: src.name });
        continue;
      }
      const targetGrade = src.grade + 1;
      const wantedName = data.names?.[src.id] ?? bumpedName(src.name, src.grade);
      let target = targets.find((t) => t.rolledFromSectionId === src.id)
        ?? targets.find((t) => t.rolledFromSectionId === null && t.name.toLowerCase() === wantedName.toLowerCase() && t.grade === targetGrade);
      if (!target && targets.some((t) => t.name.toLowerCase() === wantedName.toLowerCase())) {
        throw new AcademicError(`${academicYearShortLabel(to.startYear)} already has a section named ${wantedName} that did not come from ${src.name} — choose another name for it`, 409);
      }
      const moving: { id: string; name: string }[] = [];
      const staying: { id: string; name: string; why: string }[] = [];
      let alreadyPlaced = 0;
      for (const m of members) {
        if (m.leftOn) { staying.push({ id: m.id, name: m.name, why: 'left the school' }); continue; }
        const g = gradeInAcademicYear(m.cohortYear, to.startYear);
        if (g !== targetGrade) { staying.push({ id: m.id, name: m.name, why: g === null ? 'grade not recorded' : `grade ${g} in ${academicYearShortLabel(to.startYear)}` }); continue; }
        if (placed.has(m.id)) { alreadyPlaced++; continue; }
        moving.push({ id: m.id, name: m.name });
      }
      plan.push({
        from: { id: src.id, name: src.name, grade: src.grade },
        to: { id: target?.id ?? null, name: target?.name ?? wantedName, grade: targetGrade, exists: !!target },
        moving, staying, alreadyPlaced,
      });

      if (!data.commit) continue;
      if (!target) {
        [target] = await tx.insert(section).values({
          id: randomUUID(), academicYearId: to.id, grade: targetGrade, name: wantedName,
          homeroomTeacherId: src.homeroomTeacherId, roomId: src.roomId, capacity: src.capacity, rolledFromSectionId: src.id,
        }).returning();
        targets.push(target!);
        sectionsCreated++;
      } else if (target.rolledFromSectionId === null) {
        await tx.update(section).set({ rolledFromSectionId: src.id, updatedAt: new Date() }).where(eq(section.id, target.id));
        target.rolledFromSectionId = src.id;
      }
      if (moving.length) {
        await tx.insert(sectionMembership).values(moving.map((m) => ({
          id: randomUUID(), sectionId: target!.id, studentId: m.id, academicYearId: to.id, startedOn: to.startsOn, addedBy: actorId,
        })));
        for (const m of moving) placed.add(m.id);
        studentsMoved += moving.length;
      }
    }
    if (data.commit && (sectionsCreated || studentsMoved)) {
      await logAction(actorId, 'SECTIONS_ROLLED_OVER', 'academic_year', to.id, { from: academicYearLabel(from.startYear) },
        { to: academicYearLabel(to.startYear), sectionsCreated, studentsMoved, graduating: graduating.length }, ctx, tx);
    }
    return {
      from: { id: from.id, label: academicYearLabel(from.startYear) },
      to: { id: to.id, label: academicYearLabel(to.startYear) },
      committed: data.commit,
      sections: plan,
      graduating,
      sectionsCreated,
      studentsMoved,
    };
  };
  // A preview writes nothing; it runs in a transaction only to read one
  // consistent picture, under the same lock a commit takes.
  return db.transaction(run);
}

// ─── A student's section ─────────────────────────────────────────────────────

/** The student's section in an academic year (default: today's), if any. */
export async function sectionOf(studentId: string, startYear: number = academicYearStartOf()) {
  const [row] = await db
    .select({
      membershipId: sectionMembership.id, sectionId: section.id, name: section.name, grade: section.grade,
      startedOn: sectionMembership.startedOn, academicYearId: academicYear.id,
    })
    .from(sectionMembership)
    .innerJoin(section, eq(section.id, sectionMembership.sectionId))
    .innerJoin(academicYear, eq(academicYear.id, sectionMembership.academicYearId))
    .where(and(eq(sectionMembership.studentId, studentId), eq(academicYear.startYear, startYear), isNull(sectionMembership.endedOn)));
  return row ?? null;
}

/** Every section a student has been in, newest first. */
export async function sectionHistoryOf(studentId: string) {
  return db
    .select({
      membershipId: sectionMembership.id, sectionId: section.id, name: section.name, grade: section.grade,
      startYear: academicYear.startYear, startedOn: sectionMembership.startedOn, endedOn: sectionMembership.endedOn, endReason: sectionMembership.endReason,
    })
    .from(sectionMembership)
    .innerJoin(section, eq(section.id, sectionMembership.sectionId))
    .innerJoin(academicYear, eq(academicYear.id, sectionMembership.academicYearId))
    .where(eq(sectionMembership.studentId, studentId))
    .orderBy(sql`${academicYear.startYear} desc, ${sectionMembership.startedOn} desc, ${sectionMembership.createdAt} desc`);
}

/** End a student's open section memberships (they left the school), in the caller's transaction. */
export async function endOpenMemberships(tx: Tx, studentId: string, endedOn: string, reason: string, actorId: string) {
  const open = await tx.select({ id: sectionMembership.id, startedOn: sectionMembership.startedOn, sectionId: sectionMembership.sectionId })
    .from(sectionMembership)
    .where(and(eq(sectionMembership.studentId, studentId), isNull(sectionMembership.endedOn)))
    .for('update');
  for (const m of open) {
    await tx.update(sectionMembership)
      .set({ endedOn: endedOn < m.startedOn ? m.startedOn : endedOn, endReason: reason, endedBy: actorId })
      .where(eq(sectionMembership.id, m.id));
  }
  return open.length;
}
