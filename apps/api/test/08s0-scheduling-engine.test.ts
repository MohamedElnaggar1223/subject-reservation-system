import { describe, it, expect } from 'vitest';
import { evaluate, optionsFor, judgeMove, generate, type EngineInput } from '@repo/validations';

/**
 * F1 — the engine the grid editor runs in the browser (review flag 10): when a
 * coordinator picks up a lesson, each cell is judged from that lesson alone
 * (`optionsFor`, `judgeMove`), not by evaluating the whole timetable again.
 * This proves the shortcut is exact: for every lesson of a school-sized
 * timetable, at every cell of the week, the reasons the editor shows are the
 * sentences — the same ones, in the same order — that a full `evaluate` of
 * the timetable with the lesson moved there lists for it. The timetable holds
 * clashes on purpose, as a draft being edited can.
 *
 * And the generator's two kinds of unplaced lesson (review flag 6): one no
 * arrangement could place ("cannot be placed") and one the search did not fit
 * ("was not fitted in by the search"), each sentence counting the periods.
 * Pure: no database.
 */

function school(): EngineInput {
  const periods = [1, 2, 3, 4, 5, 6, 7].map((p) => ({ period: p, label: `P${p}`, startsAt: '08:00', endsAt: '08:45', joinsNext: [1, 3, 5, 6].includes(p) }));
  const days = [0, 1, 2, 3, 4].map((w) => ({ weekday: w, periods }));
  const teachers = Array.from({ length: 8 }, (_, i) => ({ id: `t${i + 1}`, name: `Teacher ${i + 1}`, maxPerDay: i === 2 ? 5 : 6, maxPerWeek: 25 }));
  const rooms = [
    ...['10A', '10B', '10C', '11A', '11B', '11C', '12A', '12B', '12C'].map((s) => ({ id: `r${s}`, name: `Room ${s}`, type: 'classroom' as const, capacity: 32, features: [] as string[], isActive: true })),
    { id: 'lab1', name: 'Lab 1', type: 'science_lab' as const, capacity: 32, features: ['lab_benches'], isActive: true },
    { id: 'lab2', name: 'Lab 2', type: 'science_lab' as const, capacity: 20, features: ['lab_benches'], isActive: true },
    { id: 'comp', name: 'Computer lab', type: 'computer_lab' as const, capacity: 24, features: ['computers'], isActive: true },
    { id: 'shut', name: 'Old room', type: 'classroom' as const, capacity: 30, features: [], isActive: false },
  ];
  const students: Record<string, string[]> = {};
  for (const g of [10, 11, 12]) for (const s of ['A', 'B', 'C']) students[`${g}${s}`] = Array.from({ length: 12 }, (_, i) => `s${g}${s}${i}`);
  const subjects = ['Maths', 'Physics', 'Chemistry', 'Biology', 'English'];
  const teacherOf: Record<string, string> = { Maths: 't3', Physics: 't4', Chemistry: 't5', Biology: 't6', English: 't7' };
  const groups: (EngineInput['groups'][number] & { weekly: number; doubles: number })[] = [];
  for (const gr of [10, 11, 12]) {
    const all = ['A', 'B', 'C'].flatMap((s) => students[`${gr}${s}`]!);
    subjects.forEach((sub, si) => {
      const members = all.filter((_, i) => i % 5 !== si);
      const lab = ['Physics', 'Chemistry', 'Biology'].includes(sub);
      groups.push({ id: `${sub}-${gr}`, name: `${sub} ${gr}`, teacherId: gr === 12 && sub === 'Biology' ? 't8' : teacherOf[sub]!, size: members.length, students: members,
        roomType: lab ? 'science_lab' : null, roomFeatures: lab ? ['lab_benches'] : [], roomId: null, preferredRoomId: null, weekly: 5, doubles: lab ? 1 : 0 });
    });
    ['A', 'B', 'C'].forEach((s, i) => {
      groups.push({ id: `Arabic-${gr}${s}`, name: `Arabic ${gr}${s}`, teacherId: gr === 12 ? 't2' : gr === 11 && i > 0 ? 't2' : 't1', size: 12, students: students[`${gr}${s}`]!,
        roomType: null, roomFeatures: [], roomId: s === 'A' ? `r${gr}A` : null, preferredRoomId: `r${gr}${s}`, weekly: 3, doubles: 0 });
    });
  }
  const ict = [...students['11A']!, ...students['12A']!].filter((_, i) => i % 3 === 0);
  groups.push({ id: 'ICT', name: 'ICT 11-12', teacherId: 't8', size: ict.length, students: ict, roomType: 'computer_lab', roomFeatures: ['computers'], roomId: null, preferredRoomId: null, weekly: 4, doubles: 1 });
  const lessons: EngineInput['lessons'] = [];
  for (const g of groups) {
    const cards = [...Array(g.doubles).fill(2), ...Array(g.weekly - 2 * g.doubles).fill(1)] as number[];
    cards.forEach((len, i) => lessons.push({ id: `${g.id}#${i + 1}`, groupId: g.id, seq: i + 1, length: len, weekday: null, period: null, roomId: null, locked: false }));
  }
  const overlaps: EngineInput['overlaps'] = [];
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    const a = new Set(groups[i]!.students);
    const n = groups[j]!.students.filter((s) => a.has(s)).length;
    if (n) overlaps.push({ a: groups[i]!.id, b: groups[j]!.id, students: n });
  }
  return {
    days, teachers, rooms, lessons, overlaps, roomsRequired: true,
    groups: groups.map(({ weekly: _w, doubles: _d, ...g }) => g),
    unavailable: [
      { teacherId: 't8', roomId: null, weekday: 4, period: null },
      { teacherId: 't1', roomId: null, weekday: 0, period: 1 },
      { teacherId: null, roomId: 'lab2', weekday: 2, period: null },
    ],
    dayRules: [{ a: 'Maths-10', b: 'Maths-10' }, { a: 'Chemistry-11', b: 'Physics-11' }],
  };
}

describe('F1: the editor engine and the generator’s explanations', () => {
  it("the editor's judgement of each cell equals a full evaluation of the timetable with the lesson moved there — every lesson, every cell, a timetable with clashes in it", () => {
    const base = school();
    const run = generate(base, { iterations: 200_000 });
    const at = new Map(run.placements.map((p) => [p.lessonId, p]));
    let input: EngineInput = { ...base, lessons: base.lessons.map((l) => ({ ...l, ...(at.get(l.id) ?? {}) })) };
    // Clashes a draft being edited can hold: two of one teacher's lessons in one period, a lab lesson in a classroom, one in a closed room.
    const shift = (id: string, patch: Partial<EngineInput['lessons'][number]>) => { input = { ...input, lessons: input.lessons.map((l) => (l.id === id ? { ...l, ...patch } : l)) }; };
    const m1 = input.lessons.find((l) => l.id === 'Maths-11#1')!;
    shift('Maths-12#1', { weekday: m1.weekday, period: m1.period });
    shift('Physics-10#3', { roomId: 'r10B' });
    shift('English-10#1', { roomId: 'shut' });
    expect(evaluate(input).clashes.length).toBeGreaterThan(0);

    let checked = 0;
    const mismatches: string[] = [];
    for (const l of input.lessons) {
      for (const o of optionsFor(input, l.id)) {
        const moved = { ...input, lessons: input.lessons.map((x) => (x.id === l.id ? { ...x, weekday: o.weekday, period: o.period, roomId: o.roomId } : x)) };
        const full = (evaluate(moved).byLesson[l.id] ?? []).map((c) => c.message);
        const fast = o.reasons.map((c) => c.message);
        checked++;
        if (JSON.stringify(full) !== JSON.stringify(fast)) mismatches.push(`${l.id} at ${o.weekday}/${o.period}: ${JSON.stringify(fast)} vs ${JSON.stringify(full)}`);
        expect(o.ok).toBe(fast.length === 0);
      }
    }
    expect(checked).toBe(input.lessons.length * 35);
    expect(mismatches).toEqual([]);

    // A room chosen by hand (the picked panel's room select) is judged the same way.
    for (const [id, roomId] of [['Physics-11#2', 'r11A'], ['Maths-10#2', 'lab1'], ['ICT#3', 'comp'], ['Arabic-10A#1', 'r10B']] as const) {
      for (const d of input.days) for (const p of d.periods) {
        const fast = judgeMove(input, id, d.weekday, p.period, roomId).reasons.map((c) => c.message);
        const moved = { ...input, lessons: input.lessons.map((x) => (x.id === id ? { ...x, weekday: d.weekday, period: p.period, roomId } : x)) };
        expect(fast).toEqual((evaluate(moved).byLesson[id] ?? []).map((c) => c.message));
      }
    }
  }, 120_000);

  it("a teacher who takes a group later in the term: their unavailability and limits judged for it from that day — the cell judgement equals the full evaluation, and the generator places within them", () => {
    const base = school();
    const run = generate(base, { iterations: 50_000 });
    const at = new Map(run.placements.map((p) => [p.lessonId, p]));
    // Physics 10 goes from teacher 4 to teacher 2 on 1 February 2050; teacher 2 is off on Monday at P1
    // and teaches at most four periods a day.
    const t2Groups = base.groups.filter((g) => g.teacherId === 't2').map((g) => g.id);
    const input: EngineInput = {
      ...base,
      lessons: base.lessons.map((l) => ({ ...l, ...(at.get(l.id) ?? {}) })),
      teachers: base.teachers.map((t) => (t.id === 't2' ? { ...t, maxPerDay: 4 } : t)),
      unavailable: [...base.unavailable, { teacherId: 't2', roomId: null, weekday: 1, period: 1 }],
      teacherSpans: [
        ...base.groups.filter((g) => g.teacherId && g.id !== 'Physics-10').map((g) => ({ groupId: g.id, teacherId: g.teacherId!, from: null, to: null })),
        { groupId: 'Physics-10', teacherId: 't4', from: null, to: '2050-01-31' },
        { groupId: 'Physics-10', teacherId: 't2', from: '2050-02-01', to: null },
      ],
      teacherOverlaps: t2Groups.map((g) => { const [a, b] = [g, 'Physics-10'].sort() as [string, string]; return { a, b, teacherId: 't2', from: '2050-02-01' }; }),
    };
    const single = input.lessons.find((l) => l.groupId === 'Physics-10' && l.length === 1)!;
    expect(judgeMove(input, single.id, 1, 1).reasons.map((c) => c.message)).toContain('Teacher 2 is unavailable at Monday P1 (Physics 10) from 1 February 2050');

    let checked = 0;
    const mismatches: string[] = [];
    for (const l of input.lessons.filter((x) => x.groupId === 'Physics-10' || t2Groups.includes(x.groupId))) {
      for (const o of optionsFor(input, l.id)) {
        const moved = { ...input, lessons: input.lessons.map((x) => (x.id === l.id ? { ...x, weekday: o.weekday, period: o.period, roomId: o.roomId } : x)) };
        const full = (evaluate(moved).byLesson[l.id] ?? []).map((c) => c.message);
        const fast = o.reasons.map((c) => c.message);
        checked++;
        if (JSON.stringify(full) !== JSON.stringify(fast)) mismatches.push(`${l.id} at ${o.weekday}/${o.period}: ${JSON.stringify(fast)} vs ${JSON.stringify(full)}`);
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(mismatches).toEqual([]);
    // The day limit is counted from the day the group joins teacher 2's load.
    const limit = evaluate(input).clashes.concat(...input.lessons.filter((l) => l.groupId === 'Physics-10').map((l) => optionsFor(input, l.id).flatMap((o) => o.reasons)))
      .filter((c) => c.kind === 'teacher_day_limit').map((c) => c.message);
    expect(limit.some((m) => /^Teacher 2 teaches \d+ periods on \w+ from 1 February 2050; the most is 4$/.test(m))).toBe(true);

    // The generator places nothing these rules refuse.
    const gen = generate(input, { iterations: 50_000 });
    const placedAt = new Map(gen.placements.map((p) => [p.lessonId, p]));
    const placed: EngineInput = { ...input, lessons: input.lessons.map((l) => { const p = placedAt.get(l.id); return p ? { ...l, weekday: p.weekday, period: p.period, roomId: p.roomId } : { ...l, weekday: null, period: null, roomId: null }; }) };
    expect(evaluate(placed).clashes).toEqual([]);
    expect(gen.inputHash).not.toBe(generate({ ...input, teacherSpans: undefined }, { iterations: 1 }).inputHash);
  }, 120_000);

  it('a lesson no arrangement could place says it cannot be placed; one the search did not fit says so, counting the periods', () => {
    const periods = [1, 2].map((p) => ({ period: p, label: `P${p}`, startsAt: '08:00', endsAt: '08:45', joinsNext: false }));
    const input: EngineInput = {
      days: [{ weekday: 0, periods }],
      teachers: [{ id: 'ta', name: 'Teacher A', maxPerDay: null, maxPerWeek: null }, { id: 'tb', name: 'Teacher B', maxPerDay: null, maxPerWeek: null }],
      rooms: [{ id: 'r1', name: 'Room 1', type: 'classroom', capacity: 30, features: [], isActive: true }, { id: 'r2', name: 'Room 2', type: 'classroom', capacity: 30, features: [], isActive: true }],
      groups: [
        { id: 'A', name: 'Group A', teacherId: 'ta', size: 1, students: ['x'], roomType: null, roomFeatures: [], roomId: null, preferredRoomId: null },
        { id: 'B', name: 'Group B', teacherId: 'tb', size: 1, students: ['y'], roomType: null, roomFeatures: [], roomId: null, preferredRoomId: null },
        // Taught by A's teacher to B's student: each of the two periods is taken, one by each — but it would fit if A or B moved.
        { id: 'C', name: 'Group C', teacherId: 'ta', size: 1, students: ['y'], roomType: null, roomFeatures: [], roomId: null, preferredRoomId: null },
        // A lab group, and the school has no lab.
        { id: 'L', name: 'Lab group', teacherId: 'tb', size: 1, students: ['z'], roomType: 'science_lab', roomFeatures: [], roomId: null, preferredRoomId: null },
      ],
      lessons: [
        { id: 'a1', groupId: 'A', seq: 1, length: 1, weekday: 0, period: 1, roomId: 'r1', locked: true },
        { id: 'b1', groupId: 'B', seq: 1, length: 1, weekday: 0, period: 2, roomId: 'r2', locked: true },
        { id: 'c1', groupId: 'C', seq: 1, length: 1, weekday: null, period: null, roomId: null, locked: false },
        { id: 'l1', groupId: 'L', seq: 1, length: 1, weekday: null, period: null, roomId: null, locked: false },
      ],
      overlaps: [{ a: 'B', b: 'C', students: 1 }],
      unavailable: [], dayRules: [], roomsRequired: true,
    };
    const run = generate(input, { iterations: 1000 });
    const c = run.unplaced.find((u) => u.groupId === 'C')!;
    expect(c.cause).toBe('not_fitted');
    expect(c.summary).toBe('Group C, lesson 1 was not fitted in by the search: teacher A already teaches at 1 of the 2 periods: Group A (1)');
    expect(c.reasons[0]).toMatch(/^The search did not fit it: there are periods it could take/);
    expect(c.reasons.slice(1)).toEqual(['Teacher A already teaches at 1 of the 2 periods: Group A (1)', 'Its students have another lesson at 1 of the 2 periods: Group B (1)']);
    const lab = run.unplaced.find((u) => u.groupId === 'L')!;
    expect(lab).toMatchObject({ cause: 'impossible', summary: 'Lab group, lesson 1 cannot be placed: no room in use is a science lab seating 1' });
  });

  it('a student who changed sets during the term is counted once for the load: no "impossible" from periods they never have at once (round two, flag 7)', () => {
    const periods = [1, 2].map((p) => ({ period: p, label: `P${p}`, startsAt: '08:00', endsAt: '08:45', joinsNext: false }));
    const input: EngineInput = {
      days: [{ weekday: 0, periods }],
      teachers: [{ id: 'ta', name: 'Teacher A', maxPerDay: null, maxPerWeek: null }],
      rooms: [{ id: 'r1', name: 'Room 1', type: 'classroom', capacity: 30, features: [], isActive: true }, { id: 'r2', name: 'Room 2', type: 'classroom', capacity: 30, features: [], isActive: true }],
      // Student x is in Set 1 until a day, then in Set 2: never in both at once (no overlap).
      groups: [
        { id: 'S1', name: 'Set 1', teacherId: 'ta', size: 1, students: ['x'], roomType: null, roomFeatures: [], roomId: null, preferredRoomId: null },
        { id: 'S2', name: 'Set 2', teacherId: null, size: 1, students: ['x'], roomType: null, roomFeatures: [], roomId: null, preferredRoomId: null },
      ],
      lessons: [1, 2].flatMap((n) => ['S1', 'S2'].map((g) => ({ id: `${g}-${n}`, groupId: g, seq: n, length: 1, weekday: null, period: null, roomId: null, locked: false }))),
      overlaps: [],
      // Set 2's lessons on different days, and the week has one: its second lesson cannot go in.
      dayRules: [{ a: 'S2', b: 'S2' }],
      unavailable: [], roomsRequired: true,
      studentPeriods: { x: 2 },
    };
    const counted = generate(input, { iterations: 1000 }).unplaced.find((u) => u.groupId === 'S2')!;
    expect(counted.cause).toBe('not_fitted');
    expect(counted.reasons.join(' ')).not.toMatch(/periods of lessons a week in all/);
    // Without the model's count (every group summed) the same lesson was called impossible.
    const { studentPeriods: _sp, ...summed } = input;
    const old = generate(summed, { iterations: 1000 }).unplaced.find((u) => u.groupId === 'S2')!;
    expect(old.cause).toBe('impossible');
    expect(old.reasons).toContain('Some of its students have 4 periods of lessons a week in all, and the week has 2');
  });
});
