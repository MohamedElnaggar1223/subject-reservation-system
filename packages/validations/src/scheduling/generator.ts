/**
 * The timetable generator (FEATURES_PLAN.md F1, "Automatic generation").
 *
 * Places every unlocked lesson of a timetable so that no hard rule of
 * `engine.ts` is broken, keeps locked lessons where they are, and improves
 * three measured goals: a group's lessons spread over the week (no two on one
 * day unless doubled), few free periods between a teacher's lessons, and days
 * of even length for teachers and students. A lesson it cannot place is left
 * unplaced with the reasons, slot by slot, summed into sentences.
 *
 * Deterministic: the same input gives the same timetable. There is no clock
 * and no Math.random in the search — a seeded generator (mulberry32) drives it,
 * the seed is a hash of the input, every list is visited in a sorted order, and
 * the search runs a fixed number of steps rather than for a time.
 *
 * Method: (1) construction — lessons in order of difficulty (doubles first,
 * then the fewest places they may go, the most groups they clash with, the
 * largest), each at the feasible slot that costs least; a lesson with no
 * feasible slot may displace up to two unlocked lessons that are re-placed
 * elsewhere; (2) improvement — simulated annealing over moves (a lesson to
 * another feasible slot, two lessons of the same length swapped, an unplaced
 * lesson tried again with displacement), keeping the best timetable seen.
 * Every candidate is feasible before it is costed, so the hard rules are never
 * traded against the soft ones.
 */

import {
  type EngineInput, type EngineLesson, type EngineGroup, type EngineRoom, type TimetableMeasures,
  WEEKDAY_NAMES, measure, roomTypeWords, featureWords, compareRoomsFor,
} from './engine';

export type GenerateOptions = {
  /** Improvement steps (default: 40 000 per lesson, at least 400 000, at most 4 000 000). */
  iterations?: number;
  /** The search's seed (default: a hash of the input). */
  seed?: number;
};

export type Placement = { lessonId: string; weekday: number; period: number; roomId: string | null };

export type UnplacedLesson = {
  lessonId: string;
  groupId: string;
  groupName: string;
  seq: number;
  length: number;
  /** What stopped it, most common first: one sentence each. */
  reasons: string[];
  /** One sentence for the whole lesson. */
  summary: string;
};

export type GenerateResult = {
  /** Where every lesson ends up (locked ones included, as they were). */
  placements: Placement[];
  unplaced: UnplacedLesson[];
  measures: { construction: TimetableMeasures; final: TimetableMeasures };
  stats: { lessons: number; locked: number; placed: number; unplaced: number; iterations: number; seed: number; accepted: number };
  /** A hash of the input and of the result, for "same input, same result". */
  inputHash: string;
  outputHash: string;
};

// ─── Hashing and the seeded generator ────────────────────────────────────────

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The input with every list in a fixed order, so equal inputs hash equally.
 * Lessons are named by their group and number, not their row id: two drafts
 * of one term with the same groups and rules are the same input.
 */
export function canonicalInput(input: EngineInput): string {
  const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({
    days: [...input.days].sort((a, b) => a.weekday - b.weekday),
    groups: byId(input.groups).map((g) => ({ ...g, students: [...g.students].sort(), roomFeatures: [...g.roomFeatures].sort() })),
    lessons: [...input.lessons].sort(byCard).map(({ id: _id, ...l }) => l),
    rooms: byId(input.rooms).map((r) => ({ ...r, features: [...r.features].sort() })),
    teachers: byId(input.teachers),
    unavailable: [...input.unavailable].map((u) => `${u.teacherId}|${u.roomId}|${u.weekday}|${u.period}`).sort(),
    overlaps: [...input.overlaps].map((o) => [o.a, o.b].sort().join('|') + `|${o.students}`).sort(),
    dayRules: [...input.dayRules].map((r) => [r.a, r.b].sort().join('|')).sort(),
    roomsRequired: input.roomsRequired,
  });
}

/** Lessons in a fixed order that does not depend on their row ids: group, then number. */
const byCard = (a: EngineLesson, b: EngineLesson) => a.groupId.localeCompare(b.groupId) || a.seq - b.seq || a.length - b.length || a.id.localeCompare(b.id);

// ─── The search state ────────────────────────────────────────────────────────

const W_UNPLACED = 1_000_000;
const W_SAME_DAY = 40;
const W_GAP = 6;
const W_TEACHER_SPREAD = 3;
const W_STUDENT_SPREAD = 0.5;

type Why =
  | { k: 'teacher_off' }
  | { k: 'room_off' }
  | { k: 'teacher_busy'; other: number }
  | { k: 'students_busy'; other: number }
  | { k: 'no_room' }
  | { k: 'no_suitable' }
  | { k: 'day_limit' }
  | { k: 'week_limit' }
  | { k: 'same_day'; other: number }
  | { k: 'shape' };

export function generate(input: EngineInput, opts: GenerateOptions = {}): GenerateResult {
  const canonical = canonicalInput(input);
  const inputHash = fnv1a(canonical).toString(16).padStart(8, '0');
  const seed = opts.seed ?? fnv1a(canonical + '#seed');
  const rand = mulberry32(seed);

  // Days and periods as cells: cell = day * P + (period - 1).
  const days = [...input.days].sort((a, b) => a.weekday - b.weekday);
  const D = days.length;
  const P = Math.max(1, ...days.map((d) => d.periods.length));
  const C = D * P;
  const dayOfWeekday = new Map(days.map((d, i) => [d.weekday, i]));
  const validCell = new Uint8Array(C);
  const joinsNext = new Uint8Array(C);
  days.forEach((d, di) => d.periods.forEach((p) => {
    if (p.period >= 1 && p.period <= P) {
      validCell[di * P + p.period - 1] = 1;
      joinsNext[di * P + p.period - 1] = p.joinsNext ? 1 : 0;
    }
  }));

  // Entities in a fixed order.
  const groups = [...input.groups].sort((a, b) => a.id.localeCompare(b.id));
  const G = groups.length;
  const gi = new Map(groups.map((g, i) => [g.id, i]));
  const teachers = [...input.teachers].sort((a, b) => a.id.localeCompare(b.id));
  const T = teachers.length;
  const ti = new Map(teachers.map((t, i) => [t.id, i]));
  const rooms = [...input.rooms].sort((a, b) => a.id.localeCompare(b.id));
  const R = rooms.length;
  const ri = new Map(rooms.map((r, i) => [r.id, i]));
  const lessons = [...input.lessons].filter((l) => gi.has(l.groupId)).sort(byCard);
  const L = lessons.length;

  const groupTeacher = new Int32Array(G).fill(-1);
  groups.forEach((g, i) => { if (g.teacherId && ti.has(g.teacherId)) groupTeacher[i] = ti.get(g.teacherId)!; });

  // Students, for the balance measure.
  const studentIds = [...new Set(groups.flatMap((g) => g.students))].sort();
  const si = new Map(studentIds.map((s, i) => [s, i]));
  const S = studentIds.length;
  const groupStudents: Int32Array[] = groups.map((g) => Int32Array.from([...new Set(g.students)].map((s) => si.get(s)!).sort((a, b) => a - b)));

  // Clashing groups: shared students (and the group itself).
  const overlapCount = new Map<number, Map<number, number>>();
  for (const o of input.overlaps) {
    const a = gi.get(o.a);
    const b = gi.get(o.b);
    if (a === undefined || b === undefined || a === b) continue;
    if (!overlapCount.has(a)) overlapCount.set(a, new Map());
    if (!overlapCount.has(b)) overlapCount.set(b, new Map());
    overlapCount.get(a)!.set(b, o.students);
    overlapCount.get(b)!.set(a, o.students);
  }
  const conflictsOf: Int32Array[] = groups.map((_, i) => Int32Array.from([...(overlapCount.get(i)?.keys() ?? [])].sort((a, b) => a - b)));
  const sameDayOf: Int32Array[] = groups.map(() => new Int32Array(0));
  const selfSameDay = new Uint8Array(G);
  {
    const lists: number[][] = groups.map(() => []);
    for (const r of input.dayRules) {
      const a = gi.get(r.a);
      const b = gi.get(r.b);
      if (a === undefined || b === undefined) continue;
      if (a === b) { selfSameDay[a] = 1; continue; }
      lists[a]!.push(b);
      lists[b]!.push(a);
    }
    lists.forEach((l, i) => { sameDayOf[i] = Int32Array.from([...new Set(l)].sort((x, y) => x - y)); });
  }

  // Unavailability.
  const teacherOff = new Uint8Array(Math.max(1, T * C));
  const roomOff = new Uint8Array(Math.max(1, R * C));
  for (const u of input.unavailable) {
    const di = dayOfWeekday.get(u.weekday);
    if (di === undefined) continue;
    const cells = u.period === null ? Array.from({ length: P }, (_, k) => di * P + k) : u.period >= 1 && u.period <= P ? [di * P + u.period - 1] : [];
    if (u.teacherId && ti.has(u.teacherId)) for (const c of cells) teacherOff[ti.get(u.teacherId)! * C + c] = 1;
    if (u.roomId && ri.has(u.roomId)) for (const c of cells) roomOff[ri.get(u.roomId)! * C + c] = 1;
  }
  const maxDay = teachers.map((t) => t.maxPerDay ?? Infinity);
  const maxWeek = teachers.map((t) => t.maxPerWeek ?? Infinity);

  // Rooms that suit each group, best first.
  const fits = (g: EngineGroup, r: EngineRoom) =>
    r.isActive
    && (!g.roomId || g.roomId === r.id)
    && (!g.roomType || r.type === g.roomType)
    && g.roomFeatures.every((f) => r.features.includes(f))
    && (r.capacity === null || g.size <= r.capacity);
  const roomsOf: number[][] = groups.map((g) => {
    const order = compareRoomsFor(g);
    return rooms
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => fits(g, r))
      .sort((a, b) => order(a.r, b.r))
      .map(({ i }) => i);
  });
  const needsRoom = input.roomsRequired;

  // Lesson facts.
  const lGroup = new Int32Array(L);
  const lLen = new Int32Array(L);
  const lLocked = new Uint8Array(L);
  lessons.forEach((l, i) => {
    lGroup[i] = gi.get(l.groupId)!;
    lLen[i] = l.length >= 2 ? 2 : 1;
    lLocked[i] = l.locked && l.weekday !== null && l.period !== null ? 1 : 0;
  });

  // Occupancy.
  const lCell = new Int32Array(L).fill(-1); // start cell, -1 = unplaced
  const lRoom = new Int32Array(L).fill(-1);
  const teacherAt = new Int32Array(Math.max(1, T * C));
  const roomAt = new Int32Array(Math.max(1, R * C));
  const groupAt = new Int32Array(Math.max(1, G * C));
  const cellLessons: number[][] = Array.from({ length: C }, () => []);
  const groupDayCards = new Int32Array(Math.max(1, G * D));
  const teacherDayLoad = new Int32Array(Math.max(1, T * D));
  const teacherWeekLoad = new Int32Array(Math.max(1, T));
  const studentDayLoad = new Int32Array(Math.max(1, S * D));

  // Cost, kept current as lessons move.
  let unplacedCount = L;
  let sameDay = 0;
  let gaps = 0;
  let tSpread = 0;
  let sSpread = 0;
  const teacherGapOf = new Int32Array(Math.max(1, T * D));
  const teacherSpreadOf = new Int32Array(Math.max(1, T));
  const studentSpreadOf = new Int32Array(Math.max(1, S));
  const cost = () => unplacedCount * W_UNPLACED + sameDay * W_SAME_DAY + gaps * W_GAP + tSpread * W_TEACHER_SPREAD + sSpread * W_STUDENT_SPREAD;

  const recomputeTeacherDay = (t: number, d: number) => {
    let first = -1, last = -1, n = 0;
    for (let k = 0; k < P; k++) if (teacherAt[t * C + d * P + k]! > 0) { if (first < 0) first = k; last = k; n++; }
    const g2 = first < 0 ? 0 : last - first + 1 - n;
    gaps += g2 - teacherGapOf[t * D + d]!;
    teacherGapOf[t * D + d] = g2;
  };
  const recomputeTeacherSpread = (t: number) => {
    let mx = -Infinity, mn = Infinity;
    for (let d = 0; d < D; d++) { const v = teacherDayLoad[t * D + d]!; if (v > mx) mx = v; if (v < mn) mn = v; }
    const v = D ? mx - mn : 0;
    tSpread += v - teacherSpreadOf[t]!;
    teacherSpreadOf[t] = v;
  };
  const recomputeStudentSpread = (s: number) => {
    let mx = -Infinity, mn = Infinity;
    for (let d = 0; d < D; d++) { const v = studentDayLoad[s * D + d]!; if (v > mx) mx = v; if (v < mn) mn = v; }
    const v = D ? mx - mn : 0;
    sSpread += v - studentSpreadOf[s]!;
    studentSpreadOf[s] = v;
  };

  const cellsOf = (len: number, start: number) => (len === 2 ? [start, start + 1] : [start]);
  const shapeOk = (len: number, start: number) => {
    if (start < 0 || start >= C || !validCell[start]) return false;
    if (len === 1) return true;
    const k = start % P;
    return k + 1 < P && validCell[start + 1] === 1 && joinsNext[start] === 1;
  };

  const put = (l: number, start: number, room: number) => {
    const g = lGroup[l]!;
    const t = groupTeacher[g]!;
    const d = Math.floor(start / P);
    const len = lLen[l]!;
    lCell[l] = start;
    lRoom[l] = room;
    unplacedCount--;
    for (const c of cellsOf(len, start)) {
      if (t >= 0) teacherAt[t * C + c]!++;
      if (room >= 0) roomAt[room * C + c]!++;
      groupAt[g * C + c]!++;
      cellLessons[c]!.push(l);
    }
    const before = groupDayCards[g * D + d]!;
    groupDayCards[g * D + d] = before + 1;
    sameDay += Math.max(0, before) - Math.max(0, before - 1);
    if (t >= 0) {
      teacherDayLoad[t * D + d]! += len;
      teacherWeekLoad[t]! += len;
      recomputeTeacherDay(t, d);
      recomputeTeacherSpread(t);
    }
    for (const s of groupStudents[g]!) { studentDayLoad[s * D + d]! += len; recomputeStudentSpread(s); }
  };

  const take = (l: number) => {
    const start = lCell[l]!;
    if (start < 0) return;
    const g = lGroup[l]!;
    const t = groupTeacher[g]!;
    const room = lRoom[l]!;
    const d = Math.floor(start / P);
    const len = lLen[l]!;
    for (const c of cellsOf(len, start)) {
      if (t >= 0) teacherAt[t * C + c]!--;
      if (room >= 0) roomAt[room * C + c]!--;
      groupAt[g * C + c]!--;
      const list = cellLessons[c]!;
      const at = list.indexOf(l);
      if (at >= 0) list.splice(at, 1);
    }
    const before = groupDayCards[g * D + d]!;
    groupDayCards[g * D + d] = before - 1;
    sameDay -= Math.max(0, before - 1) - Math.max(0, before - 2);
    if (t >= 0) {
      teacherDayLoad[t * D + d]! -= len;
      teacherWeekLoad[t]! -= len;
      recomputeTeacherDay(t, d);
      recomputeTeacherSpread(t);
    }
    for (const s of groupStudents[g]!) { studentDayLoad[s * D + d]! -= len; recomputeStudentSpread(s); }
    lCell[l] = -1;
    lRoom[l] = -1;
    unplacedCount++;
  };

  /** A free suitable room at a start, or -1 (-2 = no room needed). */
  const freeRoom = (l: number, start: number): number => {
    const g = lGroup[l]!;
    const cs = cellsOf(lLen[l]!, start);
    for (const r of roomsOf[g]!) {
      if (cs.every((c) => roomAt[r * C + c] === 0 && roomOff[r * C + c] === 0)) return r;
    }
    return needsRoom ? -1 : -2;
  };

  /** Why a lesson (not placed) cannot start at a cell, or null with the room it would take. */
  const blockAt = (l: number, start: number): { why: Why | null; room: number } => {
    const len = lLen[l]!;
    if (!shapeOk(len, start)) return { why: { k: 'shape' }, room: -1 };
    const g = lGroup[l]!;
    const t = groupTeacher[g]!;
    const d = Math.floor(start / P);
    const cs = cellsOf(len, start);
    if (t >= 0) {
      for (const c of cs) if (teacherOff[t * C + c]) return { why: { k: 'teacher_off' }, room: -1 };
      for (const c of cs) if (teacherAt[t * C + c]! > 0) {
        const other = cellLessons[c]!.find((o) => groupTeacher[lGroup[o]!] === t)!;
        return { why: { k: 'teacher_busy', other }, room: -1 };
      }
      if (teacherDayLoad[t * D + d]! + len > maxDay[t]!) return { why: { k: 'day_limit' }, room: -1 };
      if (teacherWeekLoad[t]! + len > maxWeek[t]!) return { why: { k: 'week_limit' }, room: -1 };
    }
    for (const c of cs) {
      if (groupAt[g * C + c]! > 0) return { why: { k: 'students_busy', other: cellLessons[c]!.find((o) => lGroup[o] === g)! }, room: -1 };
      for (const h of conflictsOf[g]!) if (groupAt[h * C + c]! > 0) {
        return { why: { k: 'students_busy', other: cellLessons[c]!.find((o) => lGroup[o] === h)! }, room: -1 };
      }
    }
    if (selfSameDay[g] && groupDayCards[g * D + d]! > 0) {
      const other = lessonsOfGroupOnDay(g, d)[0] ?? -1;
      return { why: { k: 'same_day', other }, room: -1 };
    }
    for (const h of sameDayOf[g]!) if (groupDayCards[h * D + d]! > 0) {
      return { why: { k: 'same_day', other: lessonsOfGroupOnDay(h, d)[0] ?? -1 }, room: -1 };
    }
    const room = freeRoom(l, start);
    if (room === -1) {
      if (!roomsOf[g]!.length) return { why: { k: 'no_suitable' }, room: -1 };
      return { why: cs.every((c) => roomsOf[g]!.some((r) => roomOff[r * C + c] === 0)) ? { k: 'no_room' } : { k: 'room_off' }, room: -1 };
    }
    return { why: null, room: room === -2 ? -1 : room };
  };

  const lessonsOfGroupOnDay = (g: number, d: number) => {
    const out: number[] = [];
    for (let k = 0; k < P; k++) for (const o of cellLessons[d * P + k]!) if (lGroup[o] === g && lCell[o] === d * P + k) out.push(o);
    return out;
  };

  const starts: number[] = [];
  for (let c = 0; c < C; c++) if (validCell[c]) starts.push(c);

  // Locked lessons first, where they are (a locked lesson on a missing period stays unplaced and is reported).
  lessons.forEach((l, i) => {
    if (!lLocked[i]) return;
    const di = dayOfWeekday.get(l.weekday!);
    if (di === undefined || l.period! < 1 || l.period! > P) return;
    const start = di * P + l.period! - 1;
    if (!shapeOk(lLen[i]!, start)) return;
    put(i, start, l.roomId && ri.has(l.roomId) ? ri.get(l.roomId)! : -1);
  });

  // ── Construction ──
  const staticOptions = new Int32Array(L);
  const degree = new Int32Array(G);
  for (let g = 0; g < G; g++) {
    let n = conflictsOf[g]!.length;
    if (groupTeacher[g]! >= 0) n += groups.filter((_, h) => h !== g && groupTeacher[h] === groupTeacher[g]).length;
    degree[g] = n;
  }
  for (let l = 0; l < L; l++) {
    const g = lGroup[l]!;
    const t = groupTeacher[g]!;
    let n = 0;
    for (const s of starts) {
      if (!shapeOk(lLen[l]!, s)) continue;
      const cs = cellsOf(lLen[l]!, s);
      if (t >= 0 && cs.some((c) => teacherOff[t * C + c])) continue;
      if (needsRoom && !roomsOf[g]!.some((r) => cs.every((c) => roomOff[r * C + c] === 0))) continue;
      n++;
    }
    staticOptions[l] = n;
  }
  const order = [...Array(L).keys()]
    .filter((l) => !lLocked[l])
    .sort((a, b) =>
      lLen[b]! - lLen[a]!
      || staticOptions[a]! - staticOptions[b]!
      || degree[lGroup[b]!]! - degree[lGroup[a]!]!
      || groups[lGroup[b]!]!.size - groups[lGroup[a]!]!.size
      || groups[lGroup[a]!]!.name.localeCompare(groups[lGroup[b]!]!.name, 'en', { numeric: true })
      || lessons[a]!.seq - lessons[b]!.seq
      || byCard(lessons[a]!, lessons[b]!));

  const placeBest = (l: number, candidates: number[]): boolean => {
    let best = -1, bestRoom = -1, bestCost = Infinity;
    for (const s of candidates) {
      const { why, room } = blockAt(l, s);
      if (why) continue;
      const before = cost();
      put(l, s, room);
      const c = cost() - before;
      take(l);
      if (c < bestCost - 1e-9) { bestCost = c; best = s; bestRoom = room; }
    }
    if (best < 0) return false;
    put(l, best, bestRoom);
    return true;
  };

  /** Place a lesson by displacing at most `depth` unlocked lessons, each re-placed elsewhere; undone if any cannot be. */
  const placeByDisplacing = (l: number, cellOrderFor: number[], limit: number, maxDisplaced: number): boolean => {
    let tried = 0;
    for (const s of cellOrderFor) {
      if (tried >= limit) break;
      if (!shapeOk(lLen[l]!, s)) continue;
      const g = lGroup[l]!;
      const t = groupTeacher[g]!;
      const cs = cellsOf(lLen[l]!, s);
      if (t >= 0 && cs.some((c) => teacherOff[t * C + c])) continue;
      // Who is in the way at these cells: the same teacher, clashing students, the same-day partners.
      const blockers = new Set<number>();
      for (const c of cs) for (const o of cellLessons[c]!) {
        const og = lGroup[o]!;
        if ((t >= 0 && groupTeacher[og] === t) || og === g || (overlapCount.get(g)?.has(og) ?? false)) blockers.add(o);
      }
      const d = Math.floor(s / P);
      if (selfSameDay[g]) for (const o of lessonsOfGroupOnDay(g, d)) blockers.add(o);
      for (const h of sameDayOf[g]!) for (const o of lessonsOfGroupOnDay(h, d)) blockers.add(o);
      if (blockers.size > maxDisplaced || [...blockers].some((o) => lLocked[o])) continue;
      tried++;
      const moved = [...blockers].sort((a, b) => a - b).map((o) => ({ o, cell: lCell[o]!, room: lRoom[o]! }));
      for (const m of moved) take(m.o);
      let { why, room } = blockAt(l, s);
      if (why && why.k === 'no_room') {
        // A room may be the only thing in the way: free the one whose occupant can move.
        const r = roomsOf[g]!.find((ri2) => cs.every((c) => roomOff[ri2 * C + c] === 0) && cs.every((c) => cellLessons[c]!.filter((o) => lRoom[o] === ri2).every((o) => !lLocked[o])));
        if (r !== undefined && moved.length < maxDisplaced) {
          const occupants = [...new Set(cs.flatMap((c) => cellLessons[c]!.filter((o) => lRoom[o] === r)))];
          if (moved.length + occupants.length <= maxDisplaced) {
            for (const o of occupants) { moved.push({ o, cell: lCell[o]!, room: lRoom[o]! }); take(o); }
            ({ why, room } = blockAt(l, s));
          }
        }
      }
      if (why) { for (const m of moved) put(m.o, m.cell, m.room); continue; }
      put(l, s, room);
      const ok = moved.every((m) => placeBest(m.o, starts.filter((c) => c !== m.cell).concat([m.cell]).filter((c) => c !== s)));
      if (ok) return true;
      for (const m of moved) if (lCell[m.o]! >= 0) take(m.o);
      take(l);
      for (const m of moved) put(m.o, m.cell, m.room);
    }
    return false;
  };

  for (const l of order) {
    if (placeBest(l, starts)) continue;
    placeByDisplacing(l, starts, starts.length, 2);
  }
  const snapshot = () => ({ cell: Int32Array.from(lCell), room: Int32Array.from(lRoom) });
  const toInput = (cells: Int32Array, roomsArr: Int32Array): EngineInput => ({
    ...input,
    lessons: input.lessons.map((x) => {
      const i = lessons.findIndex((y) => y.id === x.id);
      if (i < 0) return x;
      const c = cells[i]!;
      if (c < 0) return { ...x, weekday: null, period: null, roomId: null };
      return { ...x, weekday: days[Math.floor(c / P)]!.weekday, period: (c % P) + 1, roomId: roomsArr[i]! >= 0 ? rooms[roomsArr[i]!]!.id : null };
    }),
  });
  const construction = measure(toInput(lCell, lRoom));

  // ── Improvement ──
  const iterations = opts.iterations ?? Math.min(4_000_000, Math.max(400_000, L * 40_000));
  const movable = [...Array(L).keys()].filter((l) => !lLocked[l]);
  let best = snapshot();
  let bestCost = cost();
  let accepted = 0;
  // Measured on a school-sized input over eight seeds (docs/features/SCHEDULING.md §3): starting
  // at 10 with 40 000 steps a lesson cut the soft cost by about 38% against 30 and 10 000 (teacher
  // gaps 7.4 to 2.4 on average), for about four times the time (0.8 s to 3.3 s).
  const T0 = 10;
  if (movable.length) {
    for (let it = 0; it < iterations; it++) {
      const temp = T0 * (1 - it / iterations) + 0.01;
      const r = rand();
      if (r < 0.08 && unplacedCount > 0 && movable.some((l) => lCell[l]! < 0)) {
        const unplacedNow = movable.filter((l) => lCell[l]! < 0);
        const l = unplacedNow[Math.floor(rand() * unplacedNow.length)]!;
        const shuffled = [...starts];
        for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]; }
        if (placeByDisplacing(l, shuffled, 12, 3)) accepted++;
      } else if (r < 0.75) {
        const l = movable[Math.floor(rand() * movable.length)]!;
        if (lCell[l]! < 0) continue;
        const s = starts[Math.floor(rand() * starts.length)]!;
        if (s === lCell[l]) continue;
        const was = { cell: lCell[l]!, room: lRoom[l]! };
        const before = cost();
        take(l);
        const { why, room } = blockAt(l, s);
        if (why) { put(l, was.cell, was.room); continue; }
        put(l, s, room);
        const delta = cost() - before;
        if (delta <= 0 || rand() < Math.exp(-delta / temp)) accepted++;
        else { take(l); put(l, was.cell, was.room); }
      } else {
        const a = movable[Math.floor(rand() * movable.length)]!;
        const b = movable[Math.floor(rand() * movable.length)]!;
        if (a === b || lCell[a]! < 0 || lCell[b]! < 0 || lLen[a] !== lLen[b] || lCell[a] === lCell[b]) continue;
        const wa = { cell: lCell[a]!, room: lRoom[a]! };
        const wb = { cell: lCell[b]!, room: lRoom[b]! };
        const before = cost();
        take(a);
        take(b);
        const ja = blockAt(a, wb.cell);
        if (ja.why) { put(a, wa.cell, wa.room); put(b, wb.cell, wb.room); continue; }
        put(a, wb.cell, ja.room);
        const jb = blockAt(b, wa.cell);
        if (jb.why) { take(a); put(a, wa.cell, wa.room); put(b, wb.cell, wb.room); continue; }
        put(b, wa.cell, jb.room);
        const delta = cost() - before;
        if (delta <= 0 || rand() < Math.exp(-delta / temp)) accepted++;
        else { take(a); take(b); put(a, wa.cell, wa.room); put(b, wb.cell, wb.room); }
      }
      const c = cost();
      if (c < bestCost - 1e-9) { bestCost = c; best = snapshot(); }
    }
  }

  // Restore the best timetable seen.
  for (let l = 0; l < L; l++) if (lCell[l]! >= 0) take(l);
  for (let l = 0; l < L; l++) if (best.cell[l]! >= 0) put(l, best.cell[l]!, best.room[l]!);
  const finalInput = toInput(lCell, lRoom);
  const final = measure(finalInput);

  // ── Explanations for what is left ──
  const unplaced: UnplacedLesson[] = [];
  const teacherNeeds = new Map<number, number>();
  for (let l = 0; l < L; l++) { const t = groupTeacher[lGroup[l]!]!; if (t >= 0) teacherNeeds.set(t, (teacherNeeds.get(t) ?? 0) + lLen[l]!); }
  for (let l = 0; l < L; l++) {
    if (lCell[l]! >= 0) continue;
    const g = lGroup[l]!;
    const grp = groups[g]!;
    const t = groupTeacher[g]!;
    const tName = t >= 0 ? teachers[t]!.name : null;
    const reasons: string[] = [];
    const lesson0 = lessons[l]!;
    if (lLocked[l]) {
      unplaced.push({
        lessonId: lesson0.id, groupId: grp.id, groupName: grp.name, seq: lesson0.seq, length: lLen[l]!,
        reasons: ['It is locked at a period the bell schedule does not have: unlock it or move it'],
        summary: `${grp.name}, lesson ${lesson0.seq} is locked at a period the bell schedule does not have`,
      });
      continue;
    }
    // What no slot could fix.
    if (!starts.length) reasons.push('The bell schedule has no lesson periods on the school days');
    if (lLen[l] === 2 && !starts.some((s) => shapeOk(2, s))) reasons.push('A double needs two lesson periods in a row with no break between them, and the bell schedule has none');
    if (needsRoom && roomsOf[g]!.length === 0) {
      const need = [grp.roomType ? roomTypeWords(grp.roomType) : 'a room', ...grp.roomFeatures.map(featureWords)].join(' with ');
      reasons.push(grp.roomId
        ? `${grp.name} is always in ${input.rooms.find((r) => r.id === grp.roomId)?.name ?? 'its room'}, which does not suit it (out of use, too small or missing what it needs)`
        : `No room in use is ${need} seating ${grp.size}`);
    }
    if (t >= 0) {
      const open = starts.filter((s) => !teacherOff[t * C + s]).length;
      if (open === 0) reasons.push(`${tName} is unavailable at every period`);
      else if ((teacherNeeds.get(t) ?? 0) > Math.min(open, maxWeek[t]!)) {
        reasons.push(`${tName} has ${teacherNeeds.get(t)} periods to teach but ${maxWeek[t]! < open ? `a limit of ${maxWeek[t]} a week` : `is available for ${open}`}`);
      }
    }
    // Slot by slot.
    const count = new Map<string, number>();
    const others = new Map<string, Map<number, number>>();
    for (const s of starts) {
      const { why } = blockAt(l, s);
      if (!why) continue;
      count.set(why.k, (count.get(why.k) ?? 0) + 1);
      if ('other' in why && why.other >= 0) {
        if (!others.has(why.k)) others.set(why.k, new Map());
        const og = lGroup[why.other]!;
        others.get(why.k)!.set(og, (others.get(why.k)!.get(og) ?? 0) + 1);
      }
    }
    const top = (k: string) => [...(others.get(k)?.entries() ?? [])]
      .sort((a, b) => b[1] - a[1] || groups[a[0]]!.name.localeCompare(groups[b[0]]!.name))
      .slice(0, 3)
      .map(([og, n]) => `${groups[og]!.name} (${n})`)
      .join(', ');
    const n = (k: string) => count.get(k) ?? 0;
    const sentences: [string, number][] = [];
    if (n('teacher_off')) sentences.push([`${tName} is unavailable at ${n('teacher_off')} of the ${starts.length} periods`, n('teacher_off')]);
    if (n('teacher_busy')) sentences.push([`${tName} already teaches at ${n('teacher_busy')}: ${top('teacher_busy')}`, n('teacher_busy')]);
    if (n('students_busy')) sentences.push([`its students have another lesson at ${n('students_busy')}: ${top('students_busy')}`, n('students_busy')]);
    if (n('same_day')) sentences.push([`a rule keeps it off the day at ${n('same_day')}: ${top('same_day')}`, n('same_day')]);
    if (n('day_limit')) sentences.push([`${tName} would pass their periods per day at ${n('day_limit')}`, n('day_limit')]);
    if (n('week_limit')) sentences.push([`${tName} would pass their periods per week at ${n('week_limit')}`, n('week_limit')]);
    if (n('no_room')) sentences.push([`no suitable room is free at ${n('no_room')}`, n('no_room')]);
    if (n('room_off')) sentences.push([`the only suitable rooms are unavailable at ${n('room_off')}`, n('room_off')]);
    if (n('shape') && lLen[l] === 2) sentences.push([`a double cannot start at ${n('shape')} (the next period is missing or after a break)`, n('shape')]);
    sentences.sort((a, b) => b[1] - a[1]);
    for (const [text] of sentences) reasons.push(text.charAt(0).toUpperCase() + text.slice(1));
    const lesson = lessons[l]!;
    const what = `${grp.name}${lLen[l] === 2 ? ' (double)' : ''}, lesson ${lesson.seq}`;
    unplaced.push({
      lessonId: lesson.id,
      groupId: grp.id,
      groupName: grp.name,
      seq: lesson.seq,
      length: lLen[l]!,
      reasons,
      summary: reasons.length ? `${what} could not be placed: ${reasons[0]!.charAt(0).toLowerCase()}${reasons[0]!.slice(1)}` : `${what} could not be placed`,
    });
  }
  unplaced.sort((a, b) => a.groupName.localeCompare(b.groupName, 'en', { numeric: true }) || a.seq - b.seq);

  const placements: Placement[] = [];
  for (let l = 0; l < L; l++) {
    const c = lCell[l]!;
    if (c < 0) continue;
    placements.push({ lessonId: lessons[l]!.id, weekday: days[Math.floor(c / P)]!.weekday, period: (c % P) + 1, roomId: lRoom[l]! >= 0 ? rooms[lRoom[l]!]!.id : null });
  }
  placements.sort((a, b) => a.lessonId.localeCompare(b.lessonId));
  // The result named by group and number, so two drafts given the same input hash the same.
  const cardOf = new Map(lessons.map((l) => [l.id, `${l.groupId}#${l.seq}`]));
  const outputHash = fnv1a(JSON.stringify({
    placements: placements.map((p) => [cardOf.get(p.lessonId), p.weekday, p.period, p.roomId]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    unplaced: unplaced.map((u) => cardOf.get(u.lessonId)).sort(),
  })).toString(16).padStart(8, '0');

  return {
    placements,
    unplaced,
    measures: { construction, final },
    stats: { lessons: L, locked: lLocked.reduce((a, b) => a + b, 0), placed: placements.length, unplaced: unplaced.length, iterations: movable.length ? iterations : 0, seed, accepted },
    inputHash,
    outputHash,
  };
}

/** "Sunday" for a weekday number, for sentences built outside the engine. */
export const weekdayName = (w: number) => WEEKDAY_NAMES[w] ?? `day ${w}`;
export type { EngineLesson };
