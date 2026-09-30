import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import { admin, staff, subject, refused, one, sql, type Client } from './helpers';

/**
 * F1 — the timetable generator at the school's size (FEATURES_PLAN.md F1,
 * "Automatic generation"): 9 sections, 8 teachers, 25 teaching groups (15
 * formed from the course enrolment — each student takes four of five
 * subjects, so every pair of a grade's subjects shares students — 9 section
 * groups and one group by hand), 108 students, labs and a computer room.
 *
 * - It places every lesson with no clash, checked twice: by the engine, and
 *   by SQL over the rows it wrote (a teacher, a room or a student in two
 *   lessons at once), in under 30 seconds.
 * - Deterministic: the same draft generated twice, and a second draft of the
 *   same term, give the same timetable.
 * - It keeps locked lessons where they are.
 * - Its measured goals: no group has two lessons on a day unless doubled, and
 *   teachers' gaps and uneven days are fewer than its first construction's.
 * - It explains a lesson it cannot place: a teacher away all week, a room
 *   that does not exist.
 */

const Y = academicYearStartOf() + 21;
const GRADES = [10, 11, 12] as const;
const LETTERS = ['A', 'B', 'C'] as const;
const SUBJECTS = ['Maths', 'Physics', 'Chemistry', 'Biology', 'English'] as const;
const SCIENCE = new Set(['Physics', 'Chemistry', 'Biology']);

describe('F1: the timetable generator at the school’s size', () => {
  let adm: Client, coordinator: Client;
  let yearId: string, termId: string;
  const teacherIds: string[] = [];
  const students: Record<string, string[]> = {};
  let draftA: string;

  const load = (id: string) => apiResponse(coordinator.api.v1.timetables[':id'].$get({ param: { id } }));
  const generate = (id: string) => coordinator.api.v1.timetables[':id'].generate.$post({ param: { id }, json: {} });
  const placements = async (id: string) => sql<{ card: string; weekday: number | null; period: number | null; room_id: string | null; locked: boolean }>(
    `select g.name || '#' || l.seq as card, l.weekday, l.period, l.room_id, l.locked from timetable_lesson l join teaching_group g on g.id = l.group_id
      where l.timetable_id = $1 order by g.name, l.seq`, [id]);

  /** Clashes read straight from the rows, not through the engine. */
  async function sqlClashes(id: string) {
    const overlap = `a.timetable_id = $1 and b.timetable_id = $2 and a.id < b.id and a.weekday = b.weekday
      and a.period <= b.period + b.length - 1 and b.period <= a.period + a.length - 1`;
    const teachers = await sql(`select a.id from timetable_lesson a join timetable_lesson b on ${overlap}
      join teaching_group ga on ga.id = a.group_id join teaching_group gb on gb.id = b.group_id
      where ga.teacher_id is not null and ga.teacher_id = gb.teacher_id`, [id, id]);
    const rooms = await sql(`select a.id from timetable_lesson a join timetable_lesson b on ${overlap} where a.room_id = b.room_id`, [id, id]);
    const studentsBusy = await sql(`
      with members as (
        select m.group_id, m.student_id from teaching_group_member m where m.ended_on is null
        union
        select g.id, sm.student_id from teaching_group g join section_membership sm on sm.section_id = g.section_id and sm.ended_on is null where g.kind = 'section'
      )
      select a.id from timetable_lesson a join timetable_lesson b on ${overlap}
      join members ma on ma.group_id = a.group_id join members mb on mb.group_id = b.group_id and mb.student_id = ma.student_id`, [id, id]);
    const wrongRooms = await sql(`select l.id from timetable_lesson l join teaching_group g on g.id = l.group_id left join room r on r.id = l.room_id
      where l.timetable_id = $1 and l.weekday is not null and (r.id is null or (g.room_type is not null and r.type <> g.room_type) or not r.is_active)`, [id]);
    return { teachers: teachers.length, rooms: rooms.length, students: studentsBusy.length, wrongRooms: wrongRooms.length };
  }

  beforeAll(async () => {
    adm = await admin('gen');
    coordinator = await staff(adm, 'coordinator', 'gen');
    for (let i = 1; i <= 8; i++) {
      const t = await staff(adm, 'teacher', `gen-${i}`);
      teacherIds.push((await one<{ id: string }>(`select id from teacher where user_id = $1`, [t.id])).id);
    }
    yearId = (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }))).id;
    termId = (await apiResponse(coordinator.api.v1.academic.terms.$post({ json: { academicYearId: yearId, name: 'Term 1', startsOn: `${Y}-09-06`, endsOn: `${Y}-12-20` } }))).id;
    const bells = await apiResponse(coordinator.api.v1.academic['bell-schedules'].$post({ json: { academicYearId: yearId, name: 'Regular', isDefault: true } }));
    // Seven lessons a day: doubles fit P1–2, P3–4, P5–6 and P6–7.
    const p = (label: string, kind: 'lesson' | 'break', startsAt: string, endsAt: string) => ({ weekday: null, label, kind, startsAt, endsAt });
    await apiResponse(coordinator.api.v1.academic['bell-schedules'][':id'].periods.$put({
      param: { id: bells.id },
      json: { periods: [
        p('P1', 'lesson', '08:00', '08:45'), p('P2', 'lesson', '08:45', '09:30'), p('Break', 'break', '09:30', '09:45'),
        p('P3', 'lesson', '09:45', '10:30'), p('P4', 'lesson', '10:30', '11:15'), p('Lunch', 'break', '11:15', '11:45'),
        p('P5', 'lesson', '11:45', '12:30'), p('P6', 'lesson', '12:30', '13:15'), p('P7', 'lesson', '13:15', '14:00'),
      ] },
    }));
    const rooms: Record<string, string> = {};
    for (const g of GRADES) for (const l of LETTERS) {
      rooms[`${g}${l}`] = (await apiResponse(coordinator.api.v1.academic.rooms.$post({ json: { name: `F1G Room ${g}${l}`, capacity: 32, type: 'classroom', features: [] } }))).id;
    }
    for (const n of [1, 2]) await apiResponse(coordinator.api.v1.academic.rooms.$post({ json: { name: `F1G Lab ${n}`, capacity: 32, type: 'science_lab', features: ['lab_benches'] } }));
    await apiResponse(coordinator.api.v1.academic.rooms.$post({ json: { name: 'F1G Computer room', capacity: 24, type: 'computer_lab', features: ['computers'] } }));

    // 108 students, 12 a section, grade 10–12 in this year (inserted as fixtures: accounts are not what is under test).
    for (const g of GRADES) for (const l of LETTERS) {
      const key = `${g}${l}`;
      const rows = await sql<{ id: string }>(
        `insert into "user" (id, name, email, role, cohort_year)
          select gen_random_uuid()::text, 'F1G student ' || $1 || '-' || n, 'f1g.' || $2 || '.' || n || '@test.local', 'student', $3::int
          from generate_series(1, 12) n returning id`, [key, key.toLowerCase(), Y - (g - 10)]);
      students[key] = rows.map((r) => r.id).sort();
    }
    const sectionIds: Record<string, string> = {};
    for (const g of GRADES) for (const l of LETTERS) {
      const key = `${g}${l}`;
      sectionIds[key] = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: yearId, grade: g, name: `F1G-${key}`, roomId: rooms[key] } }))).id;
      await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: sectionIds[key]! }, json: { studentIds: students[key]!, startsOn: `${Y}-09-06` } }));
    }
    // A subject per grade and area; each student skips one of the five.
    const teacherOf = (subj: string, grade: number) =>
      ({ Maths: teacherIds[2], Physics: teacherIds[3], Chemistry: teacherIds[4], Biology: grade === 12 ? teacherIds[7] : teacherIds[5], English: teacherIds[6] } as Record<string, string>)[subj]!;
    const rows: { student: string; subject: string; teacher: string; mode: 'in_school' }[] = [];
    for (const g of GRADES) {
      const all = LETTERS.flatMap((l) => students[`${g}${l}`]!);
      for (const [si, s] of SUBJECTS.entries()) {
        await subject(adm, `F1G-${s.slice(0, 3).toUpperCase()}-${g}`, `${s} ${g}`, { course: 1000, registration: 400 });
        all.forEach((id, i) => { if (i % 5 !== si) rows.push({ student: id, subject: `F1G-${s.slice(0, 3).toUpperCase()}-${g}`, teacher: teacherOf(s, g), mode: 'in_school' }); });
      }
    }
    const batch = await apiResponse(coordinator.api.v1.enrolments.batch.$post({ json: { academicYearId: yearId, rows, commit: true } }));
    expect(batch.summary.created).toBe(rows.length);

    // Groups: 15 from the enrolment, 9 section groups, one by hand.
    const formed = await apiResponse(coordinator.api.v1.scheduling.groups.form.$post({ json: { academicYearId: yearId, commit: true, weeklyPeriods: 5 } }));
    expect(formed.created).toBe(15);
    for (const g of GRADES) {
      const secs = LETTERS.map((l) => sectionIds[`${g}${l}`]!);
      for (const [i, id] of secs.entries()) {
        const t = g === 12 || (g === 11 && i > 0) ? teacherIds[1]! : teacherIds[0]!;
        await apiResponse(coordinator.api.v1.scheduling.groups.sections.$post({ json: { academicYearId: yearId, sectionIds: [id], name: 'Arabic', teacherId: t, weeklyPeriods: 3, doublePeriods: 0 } }));
      }
    }
    const ict = [...students['11A']!, ...students['12A']!].filter((_, i) => i % 3 === 0);
    await apiResponse(coordinator.api.v1.scheduling.groups.$post({
      json: { academicYearId: yearId, name: 'ICT 11–12', teacherId: teacherIds[7], weeklyPeriods: 4, doublePeriods: 1, roomType: 'computer_lab', studentIds: ict, startsOn: `${Y}-09-06` },
    }));
    const list = await apiResponse(coordinator.api.v1.scheduling.groups.$get({ query: { academicYearId: yearId } }));
    for (const g of list.groups.filter((x) => SCIENCE.has(x.name.split(' ')[0]!))) {
      await apiResponse(coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: g.id }, json: { doublePeriods: 1, roomType: 'science_lab' } }));
    }
    // The school's rules: six periods a day at most; the eighth teacher is part-time (not on Thursdays).
    for (const t of teacherIds) {
      await apiResponse(coordinator.api.v1.scheduling.rules.teachers[':teacherId'].$put({
        param: { teacherId: t }, json: { academicYearId: yearId, maxPerDay: 6, maxPerWeek: 25, unavailable: t === teacherIds[7] ? [{ weekday: 4, period: null }] : [] },
      }));
    }
    draftA = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'Generated A' } }))).id;
  }, 300_000);

  it('a school-sized input (9 sections, 8 teachers, 25 groups) placed in under 30 seconds with no clash — by the engine and by the rows', async () => {
    const before = await load(draftA);
    expect(before.groups).toHaveLength(25);
    expect(new Set(before.groups.flatMap((g) => g.sections.map((s) => s.name))).size).toBe(9);
    expect(new Set(before.groups.map((g) => g.teacherId))).toEqual(new Set(teacherIds));
    // 9 science groups of a double and three singles, 6 of five singles, 9 Arabic of three, ICT a double and two singles.
    expect(before.engine.lessons).toHaveLength(9 * 4 + 6 * 5 + 9 * 3 + 3);
    expect(before.engine.lessons.every((l) => l.weekday === null)).toBe(true);

    const started = Date.now();
    const run = await apiResponse(generate(draftA));
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(30_000);
    expect(run.durationMs).toBeLessThan(30_000);
    expect(run.unplaced).toEqual([]);
    expect(run.stats).toMatchObject({ lessons: 96, placed: 96, unplaced: 0, locked: 0 });

    const after = await load(draftA);
    expect(after.unplaced).toEqual([]);
    expect(after.clashes).toEqual([]);
    expect(await sqlClashes(draftA)).toEqual({ teachers: 0, rooms: 0, students: 0, wrongRooms: 0 });
    // The part-time teacher is never timetabled on a Thursday.
    const thursday = await sql(`select l.id from timetable_lesson l join teaching_group g on g.id = l.group_id where l.timetable_id = $1 and g.teacher_id = $2 and l.weekday = 4`, [draftA, teacherIds[7]]);
    expect(thursday).toEqual([]);
    // Nobody teaches more than six periods a day.
    const heavy = await sql(`select g.teacher_id, l.weekday, sum(l.length) as n from timetable_lesson l join teaching_group g on g.id = l.group_id
      where l.timetable_id = $1 group by g.teacher_id, l.weekday having sum(l.length) > 6`, [draftA]);
    expect(heavy).toEqual([]);
    const [r] = await sql<{ outcome: string; placed: number; unplaced: number }>(`select outcome, placed, unplaced from timetable_generation_run where timetable_id = $1`, [draftA]);
    expect(r).toMatchObject({ outcome: 'applied', placed: 96, unplaced: 0 });
    console.info(`[08s2] generated 96 lessons in ${run.durationMs} ms (request ${elapsed} ms); measures ${JSON.stringify(run.measures)}`);
  }, 60_000);

  it('the measured goals: no group twice on a day unless doubled; fewer teacher gaps and a more even week than its first construction', async () => {
    const tt = await load(draftA);
    const m = tt.runs[0]!.measures as { construction: Record<string, number>; final: Record<string, number> };
    expect(m.final.unplaced).toBe(0);
    expect(m.final.sameDayRepeats).toBe(0);
    expect(tt.measures.sameDayRepeats).toBe(0);
    // Checked from the rows as well: every group's lessons on distinct days.
    const repeats = await sql(`select l.group_id, l.weekday from timetable_lesson l where l.timetable_id = $1 group by l.group_id, l.weekday having count(*) > 1`, [draftA]);
    expect(repeats).toEqual([]);
    expect(m.final.teacherGaps).toBeLessThan(m.construction.teacherGaps!);
    expect(m.final.teacherGaps! + m.final.teacherDaySpread!).toBeLessThan(m.construction.teacherGaps! + m.construction.teacherDaySpread!);
  });

  it('deterministic: the same draft generated again, and a second draft of the term, give the same timetable', async () => {
    const first = await placements(draftA);
    const firstRun = (await load(draftA)).runs[0]!;
    const again = await apiResponse(generate(draftA));
    expect(again.outputHash).toBe(firstRun.outputHash);
    expect(again.inputHash).toBe(firstRun.inputHash);
    expect(await placements(draftA)).toEqual(first);
    const draftB = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'Generated B' } }))).id;
    const other = await apiResponse(generate(draftB));
    expect(other.inputHash).toBe(firstRun.inputHash);
    expect(other.outputHash).toBe(firstRun.outputHash);
    expect(await placements(draftB)).toEqual(first);
  }, 60_000);

  it('locked lessons stay where they are; the rest is placed around them', async () => {
    const draftC = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'Generated with locks' } }))).id;
    const tt = await load(draftC);
    const byName = (name: string, seq: number) => {
      const g = tt.groups.find((x) => x.name === name)!;
      return tt.engine.lessons.find((l) => l.groupId === g.id && l.seq === seq)!;
    };
    // Three lessons pinned where the coordinator wants them (different teachers, different students).
    const pins = [
      { lesson: byName('Arabic F1G-10A', 1), weekday: 1, period: 7 },
      { lesson: byName('Arabic F1G-11B', 1), weekday: 1, period: 7 },
      { lesson: byName('Maths 12', 1), weekday: 1, period: 1 },
    ];
    for (const p of pins) {
      await apiResponse(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({ param: { id: draftC, lessonId: p.lesson.id }, json: { weekday: p.weekday, period: p.period, from: { weekday: null, period: null } } }));
      await apiResponse(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].lock.$post({ param: { id: draftC, lessonId: p.lesson.id }, json: { locked: true } }));
    }
    const run = await apiResponse(generate(draftC));
    expect(run.stats).toMatchObject({ locked: 3, placed: 96, unplaced: 0 });
    const rows = await sql<{ weekday: number; period: number; locked: boolean }>(`select weekday, period, locked from timetable_lesson where id in ($1, $2, $3) order by period, id`, pins.map((p) => p.lesson.id));
    expect(rows.map((r) => [r.weekday, r.period, r.locked])).toEqual([[1, 1, true], [1, 7, true], [1, 7, true]]);
    expect((await load(draftC)).clashes).toEqual([]);
    expect(await sqlClashes(draftC)).toEqual({ teachers: 0, rooms: 0, students: 0, wrongRooms: 0 });
  }, 60_000);

  it('explaining an impossible lesson: a teacher away every day, a room that does not exist — the rest still placed', async () => {
    const extra = await staff(adm, 'teacher', 'gen-away');
    const away = (await one<{ id: string }>(`select id from teacher where user_id = $1`, [extra.id])).id;
    await apiResponse(coordinator.api.v1.scheduling.rules.teachers[':teacherId'].$put({
      param: { teacherId: away }, json: { academicYearId: yearId, maxPerDay: null, maxPerWeek: null, unavailable: [0, 1, 2, 3, 4].map((weekday) => ({ weekday, period: null })) },
    }));
    const astro = await apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: yearId, name: 'Astronomy club', teacherId: away, weeklyPeriods: 2, doublePeriods: 0 } }));
    const pottery = await apiResponse(coordinator.api.v1.scheduling.groups.$post({
      json: { academicYearId: yearId, name: 'Pottery', teacherId: teacherIds[0], weeklyPeriods: 1, doublePeriods: 0, roomType: 'art_room', roomFeatures: ['fume_cupboard'] },
    }));
    const draftD = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'Generated with the impossible' } }))).id;
    const run = await apiResponse(generate(draftD));
    expect(run.stats).toMatchObject({ lessons: 99, placed: 96, unplaced: 3 });
    const astroWhy = run.unplaced.filter((u) => u.groupName === 'Astronomy club');
    expect(astroWhy).toHaveLength(2);
    expect(astroWhy[0]!.reasons).toContain('teacher gen-away is unavailable at every period');
    expect(astroWhy[0]!.reasons).toContain('Teacher gen-away is unavailable at 35 of the 35 periods');
    expect(astroWhy[0]!.summary).toBe('Astronomy club, lesson 1 cannot be placed: teacher gen-away is unavailable at every period');
    expect(astroWhy.map((u) => u.cause)).toEqual(['impossible', 'impossible']);
    const potteryWhy = run.unplaced.find((u) => u.groupName === 'Pottery')!;
    expect(potteryWhy.reasons[0]).toBe('No room in use is an art room with a fume cupboard seating 0');
    expect(potteryWhy).toMatchObject({ cause: 'impossible', summary: 'Pottery, lesson 1 cannot be placed: no room in use is an art room with a fume cupboard seating 0' });
    // The explanations are kept with the run and shown with the timetable.
    const tt = await load(draftD);
    expect(tt.runs[0]!.explanations.map((e) => e.groupName).sort()).toEqual(['Astronomy club', 'Astronomy club', 'Pottery']);
    expect(tt.clashes).toEqual([]);
    expect(await sqlClashes(draftD)).toEqual({ teachers: 0, rooms: 0, students: 0, wrongRooms: 0 });
    // Retired, they leave every draft.
    for (const g of [astro.id, pottery.id]) await apiResponse(coordinator.api.v1.scheduling.groups[':id'].archive.$post({ param: { id: g }, json: { archivedOn: `${Y}-09-06`, reason: 'not running this year' } }));
    expect((await load(draftD)).engine.lessons).toHaveLength(96);
  }, 60_000);

  it('the generator refuses a published timetable and a year with no bell schedule', async () => {
    await apiResponse(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: draftA }, json: { effectiveFrom: `${Y}-09-06` } }));
    expect((await refused(generate(draftA))).error).toBe('A published timetable does not change — make a new draft from it');
    // A year of its own with no bell schedule (the F1 suites hold +20 to +24 from this year; this one +30).
    const B = academicYearStartOf() + 30;
    const bare = (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: B, startsOn: `${B}-09-06`, endsOn: `${B + 1}-06-25` } }))).id;
    const bareTerm = (await apiResponse(coordinator.api.v1.academic.terms.$post({ json: { academicYearId: bare, name: 'Term 1', startsOn: `${B}-09-06`, endsOn: `${B}-12-20` } }))).id;
    const empty = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId: bareTerm, name: 'No bells' } }))).id;
    expect((await load(empty)).problems).toEqual(['This year has no default bell schedule — set one up on the Bell schedules screen']);
    expect((await refused(generate(empty))).error).toBe('This year has no lesson periods to place lessons in — set up the default bell schedule first');
  });
});
