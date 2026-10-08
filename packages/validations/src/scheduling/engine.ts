/**
 * The timetable's rules, as one pure module (FEATURES_PLAN.md F1).
 *
 * The API judges every move and every publication with it, the generator
 * places lessons with it, and the grid editor previews a move with it before
 * the coordinator lets go — so "why can't this go here?" has one answer
 * everywhere. Nothing here touches the database: the API builds an
 * `EngineInput` from the school's data, and the editor receives the same
 * object with the timetable.
 *
 * The grid. A slot is (weekday, period): `period` is the ordinal of a lesson
 * period in the day of the year's default bell schedule (1 = the day's first
 * lesson period; breaks, registration and assembly are not counted). A double
 * lesson takes a period and the next one, which must follow it with nothing
 * between (`joinsNext`). On a day that runs on another bell schedule (a short
 * day) the nth lesson period of that schedule stands for period n.
 *
 * Hard rules (a clash): a teacher in two places — the teacher of the
 * version's first day, or one a dated change of teacher gives two groups on a
 * later day (`teacherOverlaps`); students in two lessons at
 * once — groups overlap by student, not by section; a room holding two
 * lessons; a teacher or room unavailable; a teacher over their periods per day
 * or per week; a room of the wrong type, missing a feature, too small, out of
 * use or not the group's fixed room; no room when the school has rooms (an
 * online group takes none, and no room rule applies to it); two
 * lessons a rule keeps off the same day; a period that does not exist or a
 * double split by a break.
 */

// ─── Input ───────────────────────────────────────────────────────────────────

/** A lesson period of one school day, as the default bell schedule rings it. */
export type GridPeriod = {
  period: number;
  label: string;
  startsAt: string;
  endsAt: string;
  /** The next lesson period follows with nothing between, so a double may span them. */
  joinsNext: boolean;
};

export type GridDay = { weekday: number; periods: GridPeriod[] };

export type EngineGroup = {
  id: string;
  name: string;
  teacherId: string | null;
  /** The most students it holds on any day of the term. */
  size: number;
  /** Every student in it on some day of the term (for the balance measure). */
  students: string[];
  roomType: string | null;
  roomFeatures: string[];
  /** Always in this room. */
  roomId: string | null;
  /** Tried first when choosing a room (a section's homeroom). */
  preferredRoomId: string | null;
  /**
   * Taught online (the offer teacher's mode, RESERVATIONS_REWORK.md §3.2): its
   * lessons are timetabled — its students and teacher are busy then — but take
   * no room, so no room rule applies to it. Absent: it needs a room as any.
   */
  noRoom?: boolean;
};

export type EngineLesson = {
  id: string;
  groupId: string;
  seq: number;
  /** 1 = a single period, 2 = a double. */
  length: number;
  weekday: number | null;
  period: number | null;
  roomId: string | null;
  locked: boolean;
};

export type EngineRoom = { id: string; name: string; type: string; capacity: number | null; features: string[]; isActive: boolean };

export type EngineTeacher = { id: string; name: string; maxPerDay: number | null; maxPerWeek: number | null };

/** A teacher or a room that cannot be used: a whole day (period null) or one period. */
export type EngineUnavailable = { teacherId: string | null; roomId: string | null; weekday: number; period: number | null };

/** Two groups that share students on some day of the term: never at the same time. */
export type EngineOverlap = { a: string; b: string; students: number };

/**
 * Two groups one teacher teaches on a common day of the version's time though
 * not both from its first day (a group's teacher is dated: a change of teacher
 * later in the term). From `from`, the first such day, their lessons are never
 * at the same time — the teacher's side of what `overlaps` is for students.
 */
export type EngineTeacherOverlap = { a: string; b: string; teacherId: string; from: string };

/**
 * Who teaches a group over the version's time, when a dated change of teacher falls inside it:
 * one row per (group, teacher) interval, the first day's teacher included. `from` null: from the
 * version's first day; `to` null: to its end. Absent: each group's teacher, throughout. Each
 * teacher's unavailability applies to the group's lessons, and their limits count them, while they
 * teach it (a teacher's periods counted afresh from each day one of their groups starts).
 */
export type EngineTeacherSpan = { groupId: string; teacherId: string; from: string | null; to: string | null };

/** Lessons of these groups never fall on the same day (a = b: the group's own lessons). */
export type EngineDayRule = { a: string; b: string };

export type EngineInput = {
  days: GridDay[];
  groups: EngineGroup[];
  lessons: EngineLesson[];
  rooms: EngineRoom[];
  teachers: EngineTeacher[];
  unavailable: EngineUnavailable[];
  overlaps: EngineOverlap[];
  /** Pairs of groups a dated change of teacher gives one teacher (see the type). */
  teacherOverlaps?: EngineTeacherOverlap[];
  /** Who teaches each group when, if a dated change falls inside the version's time (see the type). */
  teacherSpans?: EngineTeacherSpan[];
  dayRules: EngineDayRule[];
  /** The school has rooms in use, so every placed lesson needs one. */
  roomsRequired: boolean;
  /**
   * Each student's most periods of lessons in a week at any one time, over
   * the groups they are in together (a student who changed sets mid-term is
   * not in both at once). When absent, a student's groups are all counted.
   */
  studentPeriods?: Record<string, number>;
};

// ─── Output ──────────────────────────────────────────────────────────────────

export const CLASH_KINDS = [
  'teacher_busy',
  'students_busy',
  'room_busy',
  'teacher_unavailable',
  'room_unavailable',
  'teacher_day_limit',
  'teacher_week_limit',
  'room_type',
  'room_features',
  'room_capacity',
  'room_closed',
  'room_fixed',
  'no_room',
  'same_day',
  'no_period',
  'double_split',
] as const;
export type ClashKind = (typeof CLASH_KINDS)[number];

export type Clash = {
  kind: ClashKind;
  /** The lessons involved: the first is the one the clash is reported on. */
  lessonIds: string[];
  weekday: number | null;
  period: number | null;
  /** A sentence naming who and what, in the school's words. */
  message: string;
};

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "Sunday P3" — the slot as staff say it. */
export function slotName(days: GridDay[], weekday: number, period: number): string {
  const p = days.find((d) => d.weekday === weekday)?.periods.find((x) => x.period === period);
  return `${WEEKDAY_NAMES[weekday] ?? `day ${weekday}`} ${p ? p.label : `period ${period}`}`;
}

// ─── The grid ────────────────────────────────────────────────────────────────

export type BellPeriodRow = { weekday: number | null; position: number; label: string; kind: string; startsAt: string; endsAt: string };

/** A day's periods of a bell schedule: its own weekday's rows if it has any, else the every-day rows. */
export function periodsOfWeekday<T extends { weekday: number | null; position: number }>(rows: T[], weekday: number): T[] {
  const own = rows.filter((r) => r.weekday === weekday);
  return (own.length ? own : rows.filter((r) => r.weekday === null)).sort((a, b) => a.position - b.position);
}

/** The lesson periods of one day, numbered 1…n, each knowing whether the next lesson follows it directly. */
export function lessonPeriodsOfDay(rows: BellPeriodRow[], weekday: number): GridPeriod[] {
  const day = periodsOfWeekday(rows, weekday);
  const out: GridPeriod[] = [];
  day.forEach((row, i) => {
    if (row.kind !== 'lesson') return;
    const next = day[i + 1];
    out.push({
      period: out.length + 1,
      label: row.label,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      joinsNext: !!next && next.kind === 'lesson',
    });
  });
  return out;
}

/** The timetable's week: the school's weekdays, each with the default schedule's lesson periods. */
export function gridFromBells(rows: BellPeriodRow[], schoolWeekdays: number[]): GridDay[] {
  return [...schoolWeekdays]
    .sort((a, b) => a - b)
    .map((weekday) => ({ weekday, periods: lessonPeriodsOfDay(rows, weekday) }))
    .filter((d) => d.periods.length > 0);
}

// ─── Indexes ─────────────────────────────────────────────────────────────────

type Index = {
  input: EngineInput;
  group: Map<string, EngineGroup>;
  teacher: Map<string, EngineTeacher>;
  room: Map<string, EngineRoom>;
  lesson: Map<string, EngineLesson>;
  day: Map<number, GridDay>;
  overlap: Map<string, Map<string, number>>;
  teacherOverlap: Map<string, Map<string, EngineTeacherOverlap>>;
  dayRulesOf: Map<string, Set<string>>;
  teacherOff: Set<string>;
  roomOff: Set<string>;
  /** Each group's teachers over the version's time: the first day's first (`from` null), then by day. */
  teachersOf: Map<string, { teacherId: string; from: string | null }[]>;
  /** The loads a teacher's limits are judged on: from each day one of their groups starts, those they teach then. */
  loads: TeacherLoad[];
  loadsOf: Map<string, TeacherLoad[]>;
};

/** A teacher's groups from a day (null: the version's first day) — what their limits count then. */
export type TeacherLoad = { teacherId: string; from: string | null; groups: Set<string> };

/**
 * Each group's teachers and each teacher's loads, from the spans (or, without them, each group's
 * teacher throughout). The generator reads the same, so the grid, the server and the generator
 * judge a dated teacher alike.
 */
export function teachingOf(input: EngineInput): { teachersOf: Map<string, { teacherId: string; from: string | null }[]>; loads: TeacherLoad[] } {
  const spans: EngineTeacherSpan[] = input.teacherSpans
    ?? input.groups.filter((g) => g.teacherId).map((g) => ({ groupId: g.id, teacherId: g.teacherId!, from: null, to: null }));
  const known = new Set(input.groups.map((g) => g.id));
  const teachersOf = new Map<string, { teacherId: string; from: string | null }[]>();
  for (const sp of spans) {
    if (!known.has(sp.groupId)) continue;
    const list = teachersOf.get(sp.groupId) ?? [];
    const had = list.find((x) => x.teacherId === sp.teacherId);
    if (!had) list.push({ teacherId: sp.teacherId, from: sp.from });
    else if (had.from !== null && (sp.from === null || sp.from < had.from)) had.from = sp.from;
    teachersOf.set(sp.groupId, list);
  }
  const byFrom = (a: { from: string | null }, b: { from: string | null }) => (a.from === b.from ? 0 : a.from === null ? -1 : b.from === null ? 1 : a.from < b.from ? -1 : 1);
  for (const list of teachersOf.values()) list.sort((a, b) => byFrom(a, b) || a.teacherId.localeCompare(b.teacherId));
  const loads: TeacherLoad[] = [];
  const byTeacher = new Map<string, EngineTeacherSpan[]>();
  for (const sp of spans) if (known.has(sp.groupId)) byTeacher.set(sp.teacherId, [...(byTeacher.get(sp.teacherId) ?? []), sp]);
  for (const [teacherId, mine] of [...byTeacher.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const starts = [...new Set(mine.map((x) => x.from))].sort((a, b) => byFrom({ from: a }, { from: b }));
    let last = '';
    for (const day of starts) {
      const groups = new Set(mine.filter((x) => (day === null ? x.from === null : (x.from === null || x.from <= day) && (x.to === null || x.to >= day))).map((x) => x.groupId));
      const key = [...groups].sort().join('|');
      if (!groups.size || key === last) continue;
      last = key;
      loads.push({ teacherId, from: day, groups });
    }
  }
  return { teachersOf, loads };
}

const cellKey = (weekday: number, period: number | null) => `${weekday}:${period ?? '*'}`;

function indexOf(input: EngineInput): Index {
  const overlap = new Map<string, Map<string, number>>();
  const link = (a: string, b: string, n: number) => {
    if (!overlap.has(a)) overlap.set(a, new Map());
    overlap.get(a)!.set(b, n);
  };
  for (const o of input.overlaps) {
    if (o.a === o.b) continue;
    link(o.a, o.b, o.students);
    link(o.b, o.a, o.students);
  }
  // The earliest shared day wins when one pair shares two teachers.
  const teacherOverlap = new Map<string, Map<string, EngineTeacherOverlap>>();
  const tlink = (a: string, b: string, o: EngineTeacherOverlap) => {
    if (!teacherOverlap.has(a)) teacherOverlap.set(a, new Map());
    const prev = teacherOverlap.get(a)!.get(b);
    if (!prev || o.from < prev.from || (o.from === prev.from && o.teacherId < prev.teacherId)) teacherOverlap.get(a)!.set(b, o);
  };
  for (const o of input.teacherOverlaps ?? []) {
    if (o.a === o.b) continue;
    tlink(o.a, o.b, o);
    tlink(o.b, o.a, o);
  }
  const dayRulesOf = new Map<string, Set<string>>();
  for (const r of input.dayRules) {
    if (!dayRulesOf.has(r.a)) dayRulesOf.set(r.a, new Set());
    if (!dayRulesOf.has(r.b)) dayRulesOf.set(r.b, new Set());
    dayRulesOf.get(r.a)!.add(r.b);
    dayRulesOf.get(r.b)!.add(r.a);
  }
  const teacherOff = new Set<string>();
  const roomOff = new Set<string>();
  for (const u of input.unavailable) {
    if (u.teacherId) teacherOff.add(`${u.teacherId}@${cellKey(u.weekday, u.period)}`);
    if (u.roomId) roomOff.add(`${u.roomId}@${cellKey(u.weekday, u.period)}`);
  }
  const { teachersOf, loads } = teachingOf(input);
  const loadsOf = new Map<string, TeacherLoad[]>();
  for (const ld of loads) for (const gid of ld.groups) loadsOf.set(gid, [...(loadsOf.get(gid) ?? []), ld]);
  return {
    teachersOf,
    loads,
    loadsOf,
    input,
    group: new Map(input.groups.map((g) => [g.id, g])),
    teacher: new Map(input.teachers.map((t) => [t.id, t])),
    room: new Map(input.rooms.map((r) => [r.id, r])),
    lesson: new Map(input.lessons.map((l) => [l.id, l])),
    day: new Map(input.days.map((d) => [d.weekday, d])),
    overlap,
    teacherOverlap,
    dayRulesOf,
    teacherOff,
    roomOff,
  };
}

const isOff = (set: Set<string>, id: string, weekday: number, period: number) =>
  set.has(`${id}@${cellKey(weekday, null)}`) || set.has(`${id}@${cellKey(weekday, period)}`);

/** The periods a lesson would take at a start, or why it cannot start there. */
function periodsAt(ix: Index, length: number, weekday: number, period: number): { periods: number[] } | { problem: 'no_period' | 'double_split' } {
  const day = ix.day.get(weekday);
  const first = day?.periods.find((p) => p.period === period);
  if (!day || !first) return { problem: 'no_period' };
  if (length <= 1) return { periods: [period] };
  const second = day.periods.find((p) => p.period === period + 1);
  if (!second) return { problem: 'no_period' };
  if (!first.joinsNext) return { problem: 'double_split' };
  return { periods: [period, period + 1] };
}

const teacherName = (ix: Index, id: string | null) => (id ? ix.teacher.get(id)?.name ?? 'The teacher' : 'The teacher');
/** " from 12 November 2051" for a dated teacher or load, "" from the version's first day. */
const sinceWords = (from: string | null) => (from ? ` from ${dayMonthYear(from)}` : '');

/** A group's teachers unavailable at a lesson's periods, each in the sentence evaluate() and the grid share. */
function unavailableTeachers(ix: Index, g: EngineGroup, l: EngineLesson, weekday: number, periods: number[], where: string): Clash[] {
  const out: Clash[] = [];
  for (const t of ix.teachersOf.get(g.id) ?? []) {
    if (periods.some((q) => isOff(ix.teacherOff, t.teacherId, weekday, q))) {
      out.push({ kind: 'teacher_unavailable', lessonIds: [l.id], weekday, period: periods[0]!, message: `${teacherName(ix, t.teacherId)} is unavailable at ${where} (${g.name})${sinceWords(t.from)}` });
    }
  }
  return out;
}
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
/** "12 November 2051" for a YYYY-MM-DD date (the engine knows no clock or locale). */
export const dayMonthYear = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTH_NAMES[m - 1] ?? m} ${y}`;
};

/**
 * The teacher two groups' lessons at one time would put in two places: the
 * one both have from the version's first day, else one a dated change of
 * teacher gives both (with the day it starts).
 */
function sharedTeacher(ix: Index, a: EngineGroup, b: EngineGroup): { teacherId: string; from: string | null } | null {
  if (a.teacherId && a.teacherId === b.teacherId) return { teacherId: a.teacherId, from: null };
  const dated = ix.teacherOverlap.get(a.id)?.get(b.id);
  return dated ? { teacherId: dated.teacherId, from: dated.from } : null;
}

function teacherBusyMessage(ix: Index, shared: { teacherId: string; from: string | null }, a: EngineGroup, b: EngineGroup, where: string) {
  return `${teacherName(ix, shared.teacherId)} teaches ${a.name} and ${b.name} at ${where}${shared.from ? ` from ${dayMonthYear(shared.from)}` : ''}`;
}
const groupName = (ix: Index, id: string) => ix.group.get(id)?.name ?? 'another group';
const roomName = (ix: Index, id: string | null) => (id ? ix.room.get(id)?.name ?? 'the room' : 'the room');
const ROOM_TYPE_WORDS: Record<string, string> = {
  classroom: 'a classroom',
  science_lab: 'a science lab',
  computer_lab: 'a computer lab',
  hall: 'a hall',
  library: 'the library',
  art_room: 'an art room',
  sports: 'a sports space',
  other: 'a room of type other',
};
const FEATURE_WORDS: Record<string, string> = {
  projector: 'a projector',
  smartboard: 'a smartboard',
  computers: 'computers',
  lab_benches: 'lab benches',
  fume_cupboard: 'a fume cupboard',
  air_conditioning: 'air conditioning',
  wheelchair_access: 'wheelchair access',
};
export const roomTypeWords = (t: string) => ROOM_TYPE_WORDS[t] ?? `a room of type ${t}`;
export const featureWords = (f: string) => FEATURE_WORDS[f] ?? f;

/** Why a room does not suit a group, or null when it does. */
function roomMisfit(ix: Index, g: EngineGroup, r: EngineRoom): { kind: ClashKind; message: string } | null {
  if (!r.isActive) return { kind: 'room_closed', message: `${r.name} is out of use` };
  if (g.roomId && g.roomId !== r.id) return { kind: 'room_fixed', message: `${g.name} is always in ${roomName(ix, g.roomId)}, not ${r.name}` };
  if (g.roomType && r.type !== g.roomType) return { kind: 'room_type', message: `${g.name} needs ${roomTypeWords(g.roomType)}; ${r.name} is not one` };
  const missing = g.roomFeatures.filter((f) => !r.features.includes(f));
  if (missing.length) return { kind: 'room_features', message: `${g.name} needs ${missing.map(featureWords).join(' and ')}; ${r.name} has none` };
  if (r.capacity !== null && g.size > r.capacity) return { kind: 'room_capacity', message: `${g.name} has ${g.size} students; ${r.name} seats ${r.capacity}` };
  return null;
}

/**
 * The rooms that suit a group, best first: its fixed room; its preferred room
 * (a section's homeroom, or the homeroom most of its students come from); a
 * group that needs no particular type takes a classroom before a lab or a
 * hall (so the special rooms stay free for the groups that need them); then
 * the smallest that fits; then by name.
 */
export function suitableRooms(input: EngineInput, groupId: string): EngineRoom[] {
  const ix = indexOf(input);
  const g = ix.group.get(groupId);
  if (!g) return [];
  return suitableRoomsIx(ix, g);
}

export function compareRoomsFor(g: EngineGroup) {
  return (a: EngineRoom, b: EngineRoom) =>
    Number(b.id === g.roomId) - Number(a.id === g.roomId)
    || Number(b.id === g.preferredRoomId) - Number(a.id === g.preferredRoomId)
    || (g.roomType ? 0 : Number(b.type === 'classroom') - Number(a.type === 'classroom'))
    || (a.capacity ?? 1e9) - (b.capacity ?? 1e9)
    || a.name.localeCompare(b.name, 'en', { numeric: true })
    || a.id.localeCompare(b.id);
}

function suitableRoomsIx(ix: Index, g: EngineGroup): EngineRoom[] {
  if (g.noRoom) return [];
  return ix.input.rooms.filter((r) => roomMisfit(ix, g, r) === null).sort(compareRoomsFor(g));
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

const dayLimitMessage = (t: EngineTeacher, n: number, weekday: number, from: string | null) =>
  `${t.name} teaches ${n} periods on ${WEEKDAY_NAMES[weekday]}${sinceWords(from)}; the most is ${t.maxPerDay}`;
const weekLimitMessage = (t: EngineTeacher, n: number, from: string | null) =>
  `${t.name} teaches ${n} periods a week${sinceWords(from)}; the most is ${t.maxPerWeek}`;

type Placed = { lesson: EngineLesson; group: EngineGroup; weekday: number; periods: number[] };

/**
 * Every clash in a timetable, each reported once per pair of lessons (or once
 * per lesson for a lesson's own problem), in a stable order.
 */
export function evaluate(input: EngineInput): { clashes: Clash[]; unplaced: string[]; byLesson: Record<string, Clash[]> } {
  const ix = indexOf(input);
  const clashes: Clash[] = [];
  const unplaced: string[] = [];
  const placed: Placed[] = [];
  const sorted = [...input.lessons].sort(lessonOrder(ix));

  for (const l of sorted) {
    const g = ix.group.get(l.groupId);
    if (!g) continue;
    if (l.weekday === null || l.period === null) {
      unplaced.push(l.id);
      continue;
    }
    const at = periodsAt(ix, l.length, l.weekday, l.period);
    if ('problem' in at) {
      clashes.push({
        kind: at.problem,
        lessonIds: [l.id],
        weekday: l.weekday,
        period: l.period,
        message: at.problem === 'double_split'
          ? `${g.name}'s double at ${slotName(input.days, l.weekday, l.period)} is split by a break`
          : `${g.name} is at ${WEEKDAY_NAMES[l.weekday] ?? 'a day'} period ${l.period}${l.length > 1 ? '–' + (l.period + 1) : ''}, which the bell schedule does not have`,
      });
      continue;
    }
    placed.push({ lesson: l, group: g, weekday: l.weekday, periods: at.periods });
  }

  // Own problems: availability, rooms.
  for (const p of placed) {
    const { lesson: l, group: g } = p;
    const where = slotName(input.days, p.weekday, p.periods[0]!);
    clashes.push(...unavailableTeachers(ix, g, l, p.weekday, p.periods, where));
    if (g.noRoom) {
      // Online: no room rule applies (a room left on its lesson is not used).
    } else if (l.roomId) {
      const r = ix.room.get(l.roomId);
      if (r) {
        const misfit = roomMisfit(ix, g, r);
        if (misfit) clashes.push({ kind: misfit.kind, lessonIds: [l.id], weekday: p.weekday, period: p.periods[0]!, message: misfit.message });
        if (p.periods.some((q) => isOff(ix.roomOff, r.id, p.weekday, q))) {
          clashes.push({ kind: 'room_unavailable', lessonIds: [l.id], weekday: p.weekday, period: p.periods[0]!, message: `${r.name} is unavailable at ${where} (${g.name})` });
        }
      }
    } else if (input.roomsRequired) {
      clashes.push({ kind: 'no_room', lessonIds: [l.id], weekday: p.weekday, period: p.periods[0]!, message: `${g.name} at ${where} has no room` });
    }
  }

  // Pairs meeting in a period.
  const seen = new Set<string>();
  const byCell = new Map<string, Placed[]>();
  for (const p of placed) for (const q of p.periods) {
    const k = `${p.weekday}:${q}`;
    if (!byCell.has(k)) byCell.set(k, []);
    byCell.get(k)!.push(p);
  }
  const cells = [...byCell.keys()].sort(cellOrder);
  for (const k of cells) {
    const here = byCell.get(k)!;
    const [wd, per] = k.split(':').map(Number) as [number, number];
    for (let i = 0; i < here.length; i++) for (let j = i + 1; j < here.length; j++) {
      const a = here[i]!;
      const b = here[j]!;
      const pairKey = (kind: string) => `${kind}|${[a.lesson.id, b.lesson.id].sort().join('|')}`;
      const where = slotName(input.days, wd, per);
      const teacherShared = sharedTeacher(ix, a.group, b.group);
      if (teacherShared && !seen.has(pairKey('t'))) {
        seen.add(pairKey('t'));
        clashes.push({ kind: 'teacher_busy', lessonIds: [a.lesson.id, b.lesson.id], weekday: wd, period: per, message: teacherBusyMessage(ix, teacherShared, a.group, b.group, where) });
      }
      const shared = a.group.id === b.group.id ? a.group.size : ix.overlap.get(a.group.id)?.get(b.group.id);
      if (shared && !seen.has(pairKey('s'))) {
        seen.add(pairKey('s'));
        clashes.push({
          kind: 'students_busy', lessonIds: [a.lesson.id, b.lesson.id], weekday: wd, period: per,
          message: a.group.id === b.group.id
            ? `${a.group.name} has two lessons at ${where}`
            : `${shared} ${shared === 1 ? 'student is' : 'students are'} in both ${a.group.name} and ${b.group.name} at ${where}`,
        });
      }
      if (a.lesson.roomId && a.lesson.roomId === b.lesson.roomId && !a.group.noRoom && !b.group.noRoom && !seen.has(pairKey('r'))) {
        seen.add(pairKey('r'));
        clashes.push({ kind: 'room_busy', lessonIds: [a.lesson.id, b.lesson.id], weekday: wd, period: per, message: `${roomName(ix, a.lesson.roomId)} holds ${a.group.name} and ${b.group.name} at ${where}` });
      }
    }
  }

  // Teacher limits: per load (a teacher's groups from a day one of them starts).
  for (const ld of ix.loads) {
    const t = ix.teacher.get(ld.teacherId);
    if (!t) continue;
    const list = placed.filter((p) => ld.groups.has(p.group.id));
    if (!list.length) continue;
    if (t.maxPerDay !== null) {
      for (const d of input.days) {
        const that = list.filter((p) => p.weekday === d.weekday);
        const n = that.reduce((s, p) => s + p.periods.length, 0);
        if (n > t.maxPerDay) {
          clashes.push({ kind: 'teacher_day_limit', lessonIds: that.map((p) => p.lesson.id), weekday: d.weekday, period: null, message: dayLimitMessage(t, n, d.weekday, ld.from) });
        }
      }
    }
    if (t.maxPerWeek !== null) {
      const n = list.reduce((s, p) => s + p.periods.length, 0);
      if (n > t.maxPerWeek) {
        clashes.push({ kind: 'teacher_week_limit', lessonIds: list.map((p) => p.lesson.id), weekday: null, period: null, message: weekLimitMessage(t, n, ld.from) });
      }
    }
  }

  // Lessons kept off the same day.
  for (const r of [...input.dayRules].sort((x, y) => (x.a + x.b).localeCompare(y.a + y.b))) {
    for (const d of input.days) {
      const as = placed.filter((p) => p.weekday === d.weekday && p.group.id === r.a);
      if (r.a === r.b) {
        if (as.length > 1) {
          clashes.push({ kind: 'same_day', lessonIds: as.map((p) => p.lesson.id), weekday: d.weekday, period: null, message: `${groupName(ix, r.a)} has ${as.length} lessons on ${WEEKDAY_NAMES[d.weekday]}; its lessons are kept on different days` });
        }
      } else {
        const bs = placed.filter((p) => p.weekday === d.weekday && p.group.id === r.b);
        if (as.length && bs.length) {
          clashes.push({ kind: 'same_day', lessonIds: [...as, ...bs].map((p) => p.lesson.id), weekday: d.weekday, period: null, message: `${groupName(ix, r.a)} and ${groupName(ix, r.b)} are both on ${WEEKDAY_NAMES[d.weekday]}; they are kept on different days` });
        }
      }
    }
  }

  const byLesson: Record<string, Clash[]> = {};
  for (const c of clashes) for (const id of c.lessonIds) (byLesson[id] ??= []).push(c);
  return { clashes, unplaced, byLesson };
}

function cellOrder(a: string, b: string) {
  const [aw, ap] = a.split(':').map(Number) as [number, number];
  const [bw, bp] = b.split(':').map(Number) as [number, number];
  return aw - bw || ap - bp;
}

function lessonOrder(ix: Index) {
  return (a: EngineLesson, b: EngineLesson) =>
    groupName(ix, a.groupId).localeCompare(groupName(ix, b.groupId), 'en', { numeric: true }) || a.groupId.localeCompare(b.groupId) || a.seq - b.seq || a.id.localeCompare(b.id);
}

// ─── A move, judged before it is made ────────────────────────────────────────

export type SlotOption = {
  weekday: number;
  period: number;
  ok: boolean;
  /** The room the lesson would take there (its own if it still suits and is free). */
  roomId: string | null;
  /** What it would clash with there. */
  reasons: Clash[];
};

/**
 * Where a lesson may go: every start in the grid, with the clashes it would
 * cause there (other lessons as they stand). The editor colours the grid with
 * it while a lesson is dragged; the API refuses a move whose target is not ok.
 */
export function optionsFor(input: EngineInput, lessonId: string, opts: { roomId?: string | null } = {}): SlotOption[] {
  const ix = indexOf(input);
  const l = ix.lesson.get(lessonId);
  if (!l) return [];
  const others = placedOthers(ix, lessonId);
  const out: SlotOption[] = [];
  for (const d of input.days) for (const p of d.periods) {
    out.push(judgeAt(ix, l, d.weekday, p.period, opts.roomId, others));
  }
  return out;
}

/** The clashes a lesson would have at one start (with a given room, or the best free one). */
export function judgeMove(input: EngineInput, lessonId: string, weekday: number, period: number, roomId?: string | null): SlotOption {
  const ix = indexOf(input);
  const l = ix.lesson.get(lessonId);
  if (!l) return { weekday, period, ok: false, roomId: null, reasons: [] };
  return judgeAt(ix, l, weekday, period, roomId, placedOthers(ix, lessonId));
}

/** Every other lesson that has a place, with the periods it takes (in the order evaluate() reads them). */
function placedOthers(ix: Index, lessonId: string): Placed[] {
  const out: Placed[] = [];
  for (const o of [...ix.input.lessons].sort(lessonOrder(ix))) {
    if (o.id === lessonId || o.weekday === null || o.period === null) continue;
    const g = ix.group.get(o.groupId);
    if (!g) continue;
    const at = periodsAt(ix, o.length, o.weekday, o.period);
    if ('problem' in at) continue;
    out.push({ lesson: o, group: g, weekday: o.weekday, periods: at.periods });
  }
  return out;
}

/**
 * What evaluate() would report for this one lesson if it stood at a start —
 * only the clashes it is part of, worked out from it alone (a pick-up in the
 * grid asks this for every cell, so it must not re-read the whole timetable),
 * with the same sentences in the same order.
 */
function judgeAt(ix: Index, base: EngineLesson, weekday: number, period: number, roomId: string | null | undefined, others: Placed[]): SlotOption {
  const g = ix.group.get(base.groupId);
  if (!g) return { weekday, period, ok: false, roomId: null, reasons: [] };
  const chosen = roomId !== undefined ? roomId : bestFreeRoom(ix, base, g, weekday, period);
  const l: EngineLesson = { ...base, weekday, period, roomId: chosen };
  const days = ix.input.days;
  const reasons: Clash[] = [];
  const at = periodsAt(ix, l.length, weekday, period);
  if ('problem' in at) {
    reasons.push({
      kind: at.problem, lessonIds: [l.id], weekday, period,
      message: at.problem === 'double_split'
        ? `${g.name}'s double at ${slotName(days, weekday, period)} is split by a break`
        : `${g.name} is at ${WEEKDAY_NAMES[weekday] ?? 'a day'} period ${period}${l.length > 1 ? '–' + (period + 1) : ''}, which the bell schedule does not have`,
    });
    return { weekday, period, ok: false, roomId: chosen, reasons };
  }
  const where = slotName(days, weekday, at.periods[0]!);
  reasons.push(...unavailableTeachers(ix, g, l, weekday, at.periods, where));
  if (g.noRoom) {
    // Online: no room rule applies.
  } else if (l.roomId) {
    const r = ix.room.get(l.roomId);
    if (r) {
      const misfit = roomMisfit(ix, g, r);
      if (misfit) reasons.push({ kind: misfit.kind, lessonIds: [l.id], weekday, period: at.periods[0]!, message: misfit.message });
      if (at.periods.some((q) => isOff(ix.roomOff, r.id, weekday, q))) {
        reasons.push({ kind: 'room_unavailable', lessonIds: [l.id], weekday, period: at.periods[0]!, message: `${r.name} is unavailable at ${where} (${g.name})` });
      }
    }
  } else if (ix.input.roomsRequired) {
    reasons.push({ kind: 'no_room', lessonIds: [l.id], weekday, period: at.periods[0]!, message: `${g.name} at ${where} has no room` });
  }
  // Pairs, at the first period both take, named in the order evaluate() lists a period's lessons.
  const me: Placed = { lesson: l, group: g, weekday, periods: at.periods };
  const order = lessonOrder(ix);
  const pairs: { cell: number; at: number; kindRank: number; clash: Clash }[] = [];
  for (const [oi, o] of others.entries()) {
    if (o.weekday !== weekday) continue;
    const common = o.periods.filter((q) => at.periods.includes(q));
    if (!common.length) continue;
    const cell = Math.min(...common);
    const [a, b] = order(me.lesson, o.lesson) <= 0 ? [me, o] : [o, me];
    const w = slotName(days, weekday, cell);
    const teacherShared = sharedTeacher(ix, a.group, b.group);
    if (teacherShared) {
      pairs.push({ cell, at: oi, kindRank: 0, clash: { kind: 'teacher_busy', lessonIds: [a.lesson.id, b.lesson.id], weekday, period: cell, message: teacherBusyMessage(ix, teacherShared, a.group, b.group, w) } });
    }
    const shared = g.id === o.group.id ? g.size : ix.overlap.get(g.id)?.get(o.group.id);
    if (shared) {
      pairs.push({
        cell, at: oi, kindRank: 1, clash: {
          kind: 'students_busy', lessonIds: [a.lesson.id, b.lesson.id], weekday, period: cell,
          message: g.id === o.group.id ? `${a.group.name} has two lessons at ${w}` : `${shared} ${shared === 1 ? 'student is' : 'students are'} in both ${a.group.name} and ${b.group.name} at ${w}`,
        },
      });
    }
    if (l.roomId && l.roomId === o.lesson.roomId && !g.noRoom && !o.group.noRoom) {
      pairs.push({ cell, at: oi, kindRank: 2, clash: { kind: 'room_busy', lessonIds: [a.lesson.id, b.lesson.id], weekday, period: cell, message: `${roomName(ix, l.roomId)} holds ${a.group.name} and ${b.group.name} at ${w}` } });
    }
  }
  pairs.sort((x, y) => x.cell - y.cell || x.at - y.at || x.kindRank - y.kindRank);
  reasons.push(...pairs.map((p) => p.clash));
  // The day and week of each teacher the group has, per load it is in (as evaluate() reads them).
  for (const ld of ix.loadsOf.get(g.id) ?? []) {
    const t = ix.teacher.get(ld.teacherId);
    if (!t) continue;
    const mine = others.filter((o) => ld.groups.has(o.group.id));
    if (t.maxPerDay !== null) {
      const n = mine.filter((o) => o.weekday === weekday).reduce((s, o) => s + o.periods.length, 0) + at.periods.length;
      if (n > t.maxPerDay) reasons.push({ kind: 'teacher_day_limit', lessonIds: [l.id], weekday, period: null, message: dayLimitMessage(t, n, weekday, ld.from) });
    }
    if (t.maxPerWeek !== null) {
      const n = mine.reduce((s, o) => s + o.periods.length, 0) + at.periods.length;
      if (n > t.maxPerWeek) reasons.push({ kind: 'teacher_week_limit', lessonIds: [l.id], weekday: null, period: null, message: weekLimitMessage(t, n, ld.from) });
    }
  }
  // Lessons kept off the same day.
  for (const r of [...ix.input.dayRules].sort((x, y) => (x.a + x.b).localeCompare(y.a + y.b))) {
    if (r.a !== g.id && r.b !== g.id) continue;
    const that = others.filter((o) => o.weekday === weekday);
    if (r.a === r.b) {
      const n = that.filter((o) => o.group.id === g.id).length + 1;
      if (n > 1) reasons.push({ kind: 'same_day', lessonIds: [l.id], weekday, period: null, message: `${groupName(ix, r.a)} has ${n} lessons on ${WEEKDAY_NAMES[weekday]}; its lessons are kept on different days` });
    } else {
      const partner = r.a === g.id ? r.b : r.a;
      if (that.some((o) => o.group.id === partner)) {
        reasons.push({ kind: 'same_day', lessonIds: [l.id], weekday, period: null, message: `${groupName(ix, r.a)} and ${groupName(ix, r.b)} are both on ${WEEKDAY_NAMES[weekday]}; they are kept on different days` });
      }
    }
  }
  return { weekday, period, ok: reasons.length === 0, roomId: chosen, reasons };
}

function bestFreeRoom(ix: Index, l: EngineLesson, g: EngineGroup, weekday: number, period: number): string | null {
  if (g.noRoom) return null;
  const at = periodsAt(ix, l.length, weekday, period);
  if ('problem' in at) return l.roomId;
  const busy = new Set<string>();
  for (const o of ix.input.lessons) {
    if (o.id === l.id || o.weekday !== weekday || o.period === null || !o.roomId) continue;
    const op = periodsAt(ix, o.length, o.weekday, o.period);
    if ('problem' in op) continue;
    if (op.periods.some((q) => at.periods.includes(q))) busy.add(o.roomId);
  }
  const free = (r: EngineRoom) => !busy.has(r.id) && !at.periods.some((q) => isOff(ix.roomOff, r.id, weekday, q));
  const own = l.roomId ? ix.room.get(l.roomId) : undefined;
  if (own && roomMisfit(ix, g, own) === null && free(own)) return own.id;
  const suitable = suitableRoomsIx(ix, g);
  const pick = suitable.find(free);
  if (pick) return pick.id;
  // No suitable room is free: keep the one that best suits, so the clash names
  // the real cause (it is taken, or unavailable) rather than "no room".
  if (own && roomMisfit(ix, g, own) === null) return own.id;
  if (suitable[0]) return suitable[0].id;
  return ix.input.roomsRequired ? (own?.id ?? null) : null;
}

// ─── Measures of a good timetable (the generator's soft goals) ──────────────

export type TimetableMeasures = {
  /** Lessons not placed. */
  unplaced: number;
  /** A group's extra lessons on a day it already has one (a double counts once). */
  sameDayRepeats: number;
  /** Free periods between a teacher's first and last lesson of a day, summed. */
  teacherGaps: number;
  /** Over teachers: the busiest day's periods minus the quietest day's, summed. */
  teacherDaySpread: number;
  /** Over students: the same, averaged per student (two decimals). */
  studentDaySpread: number;
};

export function measure(input: EngineInput): TimetableMeasures {
  const ix = indexOf(input);
  const days = input.days.map((d) => d.weekday);
  const groupDay = new Map<string, number>();
  const teacherCells = new Map<string, Set<number>>();
  const teacherDayLoad = new Map<string, number>();
  const studentDayLoad = new Map<string, number>();
  let unplaced = 0;
  for (const l of input.lessons) {
    const g = ix.group.get(l.groupId);
    if (!g) continue;
    if (l.weekday === null || l.period === null) { unplaced++; continue; }
    const at = periodsAt(ix, l.length, l.weekday, l.period);
    if ('problem' in at) continue;
    groupDay.set(`${g.id}@${l.weekday}`, (groupDay.get(`${g.id}@${l.weekday}`) ?? 0) + 1);
    if (g.teacherId) {
      const key = `${g.teacherId}@${l.weekday}`;
      if (!teacherCells.has(key)) teacherCells.set(key, new Set());
      for (const q of at.periods) teacherCells.get(key)!.add(q);
      teacherDayLoad.set(key, (teacherDayLoad.get(key) ?? 0) + at.periods.length);
    }
    for (const s of g.students) studentDayLoad.set(`${s}@${l.weekday}`, (studentDayLoad.get(`${s}@${l.weekday}`) ?? 0) + at.periods.length);
  }
  let sameDayRepeats = 0;
  for (const n of groupDay.values()) sameDayRepeats += Math.max(0, n - 1);
  let teacherGaps = 0;
  for (const cellsOfDay of teacherCells.values()) {
    const list = [...cellsOfDay].sort((a, b) => a - b);
    if (list.length) teacherGaps += list[list.length - 1]! - list[0]! + 1 - list.length;
  }
  const spreadOf = (ids: string[], load: Map<string, number>) => ids.map((id) => {
    const loads = days.map((d) => load.get(`${id}@${d}`) ?? 0);
    return loads.length ? Math.max(...loads) - Math.min(...loads) : 0;
  });
  const teacherIds = [...new Set(input.groups.map((g) => g.teacherId).filter((t): t is string => !!t))];
  const teacherDaySpread = spreadOf(teacherIds, teacherDayLoad).reduce((a, b) => a + b, 0);
  const studentIds = [...new Set(input.groups.flatMap((g) => g.students))];
  const studentSpreads = spreadOf(studentIds, studentDayLoad);
  const studentDaySpread = studentSpreads.length ? Math.round((studentSpreads.reduce((a, b) => a + b, 0) / studentSpreads.length) * 100) / 100 : 0;
  return { unplaced, sameDayRepeats, teacherGaps, teacherDaySpread, studentDaySpread };
}

/** The lesson cards a group needs: its doubles, then its single periods. */
export function cardsFor(weeklyPeriods: number, doublePeriods: number): number[] {
  const doubles = Math.max(0, Math.min(doublePeriods, Math.floor(weeklyPeriods / 2)));
  return [...Array.from({ length: doubles }, () => 2), ...Array.from({ length: weeklyPeriods - doubles * 2 }, () => 1)];
}
