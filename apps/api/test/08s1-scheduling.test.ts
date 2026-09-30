import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf, schoolDateString, optionsFor } from '@repo/validations';
import {
  admin, staff, onboard, subject, refused, one, sql, notified, notificationsFor, audited, type Client,
} from './helpers';

/**
 * F1 — scheduling (FEATURES_PLAN.md §1 F1): teaching groups from the course
 * enrolment (self-study excluded) and from sections; every clash type found
 * before a move (the refusal names it) and after (the timetable lists it);
 * publishing (clashes refused, the people concerned told, published versions
 * frozen and kept); the version in force by date; a student's, parent's,
 * teacher's, room's and section's view; the calendar (holiday, weekend, short
 * day, exam-only day, between terms); a section on a date (ST-16, SO-9); the
 * calendar feed; exports (FET, aSc XML, CSV).
 *
 * Its academic year is twenty years ahead so every date is its own: nothing
 * another suite does to this year's calendar can move a lesson here.
 */

const Y = academicYearStartOf() + 20;

function onOrAfter(date: string, weekday: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const plus = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Fam = { parent: Client; student: Client; studentId: string };

describe('F1: scheduling', () => {
  let adm: Client, coordinator: Client, officer: Client;
  let tPhysC: Client, tChemC: Client, tArabC: Client, tSpareC: Client;
  let tPhys: string, tChem: string, tArab: string, tSpare: string;
  let yearId: string, term1: string, term2: string, short: string;
  let s11a: string, s11b: string;
  let roomA: string, roomB: string, lab: string, hall: string, booth: string;
  let phys: string, chem: string, maths: string;
  const f: Record<string, Fam> = {};
  let ttId: string;

  const load = (id: string) => apiResponse(coordinator.api.v1.timetables[':id'].$get({ param: { id } }));
  type Tt = Awaited<ReturnType<typeof load>>;
  const groupOf = (tt: Tt, name: string) => {
    const g = tt.groups.find((x) => x.name === name);
    if (!g) throw new Error(`no group ${name} in ${tt.groups.map((x) => x.name).join(', ')}`);
    return g;
  };
  const lessonOf = (tt: Tt, name: string, seq: number) => {
    const g = groupOf(tt, name);
    const l = tt.engine.lessons.find((x) => x.groupId === g.id && x.seq === seq);
    if (!l) throw new Error(`no lesson ${seq} of ${name}`);
    return l;
  };
  async function move(id: string, name: string, seq: number, weekday: number, period: number, extra: { roomId?: string | null; allowClash?: boolean } = {}) {
    const tt = await load(id);
    const l = lessonOf(tt, name, seq);
    return coordinator.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({
      param: { id, lessonId: l.id }, json: { weekday, period, from: { weekday: l.weekday, period: l.period }, ...extra },
    });
  }
  async function unplace(id: string, name: string, seq: number) {
    const tt = await load(id);
    const l = lessonOf(tt, name, seq);
    if (l.weekday === null) return;
    await apiResponse(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].unplace.$post({ param: { id, lessonId: l.id }, json: { from: { weekday: l.weekday, period: l.period } } }));
  }
  const day = (who: Client, studentId: string, date: string) => apiResponse(who.api.v1.schedule.day.$get({ query: { studentId, date } }));

  beforeAll(async () => {
    adm = await admin('sch');
    coordinator = await staff(adm, 'coordinator', 'sch');
    officer = await staff(adm, 'finance_officer', 'sch');
    [tPhysC, tChemC, tArabC, tSpareC] = [await staff(adm, 'teacher', 'sch-phys'), await staff(adm, 'teacher', 'sch-chem'), await staff(adm, 'teacher', 'sch-arab'), await staff(adm, 'teacher', 'sch-spare')];
    const tid = async (c: Client) => (await one<{ id: string }>(`select id from teacher where user_id = $1`, [c.id])).id;
    [tPhys, tChem, tArab, tSpare] = [await tid(tPhysC), await tid(tChemC), await tid(tArabC), await tid(tSpareC)];

    const year = await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }));
    yearId = year.id;
    term1 = (await apiResponse(coordinator.api.v1.academic.terms.$post({ json: { academicYearId: yearId, name: 'Term 1', startsOn: `${Y}-09-06`, endsOn: `${Y}-12-20` } }))).id;
    term2 = (await apiResponse(coordinator.api.v1.academic.terms.$post({ json: { academicYearId: yearId, name: 'Term 2', startsOn: `${Y + 1}-01-10`, endsOn: `${Y + 1}-06-25` } }))).id;
    const regular = await apiResponse(coordinator.api.v1.academic['bell-schedules'].$post({ json: { academicYearId: yearId, name: 'Regular', isDefault: true } }));
    await apiResponse(coordinator.api.v1.academic['bell-schedules'][':id'].periods.$put({
      param: { id: regular.id },
      json: { periods: [
        { weekday: null, label: 'Registration', kind: 'registration', startsAt: '07:45', endsAt: '08:00' },
        { weekday: null, label: 'P1', kind: 'lesson', startsAt: '08:00', endsAt: '08:45' },
        { weekday: null, label: 'P2', kind: 'lesson', startsAt: '08:45', endsAt: '09:30' },
        { weekday: null, label: 'Break', kind: 'break', startsAt: '09:30', endsAt: '09:50' },
        { weekday: null, label: 'P3', kind: 'lesson', startsAt: '09:50', endsAt: '10:35' },
        { weekday: null, label: 'P4', kind: 'lesson', startsAt: '10:35', endsAt: '11:20' },
        { weekday: null, label: 'Lunch', kind: 'break', startsAt: '11:20', endsAt: '11:50' },
        { weekday: null, label: 'P5', kind: 'lesson', startsAt: '11:50', endsAt: '12:35' },
        { weekday: null, label: 'P6', kind: 'lesson', startsAt: '12:35', endsAt: '13:20' },
      ] },
    }));
    short = (await apiResponse(coordinator.api.v1.academic['bell-schedules'].$post({ json: { academicYearId: yearId, name: 'Short day', isDefault: false } }))).id;
    await apiResponse(coordinator.api.v1.academic['bell-schedules'][':id'].periods.$put({
      param: { id: short },
      json: { periods: [1, 2, 3, 4].map((p) => ({ weekday: null, label: `P${p}`, kind: 'lesson' as const, startsAt: `0${7 + p}:00`.slice(-5), endsAt: `0${7 + p}:30`.slice(-5) })) },
    }));

    const room = async (name: string, extra: { capacity?: number; type?: 'classroom' | 'science_lab' | 'hall'; features?: ('lab_benches' | 'projector')[] } = {}) =>
      (await apiResponse(coordinator.api.v1.academic.rooms.$post({ json: { name, capacity: extra.capacity ?? 30, type: extra.type ?? 'classroom', features: extra.features ?? [] } }))).id;
    roomA = await room('F1S1 Room 11A');
    roomB = await room('F1S1 Room 11B');
    lab = await room('F1S1 Lab', { type: 'science_lab', capacity: 20, features: ['lab_benches'] });
    hall = await room('F1S1 Hall', { type: 'hall', capacity: 200 });
    booth = await room('F1S1 Booth', { capacity: 1 });

    phys = await subject(adm, 'F1S1-PHY', 'Physics S1', { course: 1000, registration: 400 });
    chem = await subject(adm, 'F1S1-CHE', 'Chemistry S1', { course: 1000, registration: 400 });
    maths = await subject(adm, 'F1S1-MAT', 'Maths S1', { course: 1000, registration: 400 });

    // Four families, grade 11 in the scheduling year (the admin's audited correction).
    for (const tag of ['a', 'b', 'c', 'd']) {
      f[tag] = await onboard(officer, `sch-${tag}`, 11);
      await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: f[tag]!.studentId }, json: { cohortYear: Y - 1, reason: 'F1 scenario year' } }));
    }
    s11a = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: yearId, grade: 11, name: 'F1S1-11A', roomId: roomA } }))).id;
    s11b = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: yearId, grade: 11, name: 'F1S1-11B', roomId: roomB } }))).id;
    await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s11a }, json: { studentIds: [f.a!.studentId, f.b!.studentId], startsOn: `${Y}-09-06` } }));
    await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s11b }, json: { studentIds: [f.c!.studentId, f.d!.studentId], startsOn: `${Y}-09-06` } }));

    const enrol = (studentId: string, subjectId: string, teacherId: string | null, mode: 'in_school' | 'self_study' = 'in_school') =>
      apiResponse(coordinator.api.v1.enrolments.$post({ json: { academicYearId: yearId, studentId, subjectId, teacherId, mode } }));
    await enrol(f.a!.studentId, phys, tPhys);
    await enrol(f.a!.studentId, chem, tChem);
    await enrol(f.a!.studentId, maths, null);
    await enrol(f.b!.studentId, phys, tPhys);
    await enrol(f.b!.studentId, chem, null, 'self_study');
    await enrol(f.c!.studentId, phys, null, 'self_study');
    await enrol(f.c!.studentId, chem, tChem);
    await enrol(f.d!.studentId, phys, tPhys);
    await enrol(f.d!.studentId, maths, null);
  });

  // ─── Teaching groups ───────────────────────────────────────────────────────

  it('groups from enrolment excluding self-study: a preview, a commit, and a second run that changes nothing', async () => {
    const preview = await apiResponse(coordinator.api.v1.scheduling.groups.form.$post({ json: { academicYearId: yearId, commit: false } }));
    const byName = Object.fromEntries(preview.groups.map((g) => [g.name, g.adding.map((a) => a.studentId).sort()]));
    expect(Object.keys(byName).sort()).toEqual(['Chemistry S1', 'Maths S1 (no teacher yet)', 'Physics S1']);
    expect(byName['Physics S1']).toEqual([f.a!.studentId, f.b!.studentId, f.d!.studentId].sort());
    expect(byName['Chemistry S1']).toEqual([f.a!.studentId, f.c!.studentId].sort());
    expect(byName['Maths S1 (no teacher yet)']).toEqual([f.a!.studentId, f.d!.studentId].sort());
    // Self-study forms no group: C does not study Physics in school, B not Chemistry.
    expect(byName['Physics S1']).not.toContain(f.c!.studentId);
    expect(byName['Chemistry S1']).not.toContain(f.b!.studentId);
    expect(await sql(`select 1 from teaching_group where academic_year_id = $1`, [yearId])).toEqual([]);

    const done = await apiResponse(coordinator.api.v1.scheduling.groups.form.$post({ json: { academicYearId: yearId, commit: true, weeklyPeriods: 2 } }));
    expect({ created: done.created, added: done.added, removed: done.removed }).toEqual({ created: 3, added: 7, removed: 0 });
    const rows = await sql<{ name: string; teacher_id: string | null; students: string }>(
      `select g.name, g.teacher_id, count(m.id)::text as students from teaching_group g left join teaching_group_member m on m.group_id = g.id and m.ended_on is null
        where g.academic_year_id = $1 group by g.name, g.teacher_id order by g.name`, [yearId]);
    expect(rows).toEqual([
      { name: 'Chemistry S1', teacher_id: tChem, students: '2' },
      { name: 'Maths S1 (no teacher yet)', teacher_id: null, students: '2' },
      { name: 'Physics S1', teacher_id: tPhys, students: '3' },
    ]);
    const again = await apiResponse(coordinator.api.v1.scheduling.groups.form.$post({ json: { academicYearId: yearId, commit: true } }));
    expect({ created: again.created, added: again.added, removed: again.removed }).toEqual({ created: 0, added: 0, removed: 0 });
    await audited([yearId], ['TEACHING_GROUPS_FORMED']);
  });

  it('a student no longer taught a subject in school leaves its group with the enrolment; forming again takes nobody back', async () => {
    const [e] = await sql<{ id: string }>(`select id from course_enrolment where student_id = $1 and subject_id = $2 and ended_on is null`, [f.d!.studentId, maths]);
    await apiResponse(coordinator.api.v1.enrolments[':id'].$put({ param: { id: e!.id }, json: { mode: 'self_study', teacherId: null } }));
    const [m] = await sql<{ ended_on: string | null; end_reason: string }>(
      `select ended_on, end_reason from teaching_group_member where student_id = $1 and subject_id = $2`, [f.d!.studentId, maths]);
    // The year has not begun: the membership is withdrawn before its first day (it ends the day before, an empty stay).
    expect(m).toEqual({ ended_on: `${Y}-09-05`, end_reason: 'Now studies this subject alone' });
    expect((await day(coordinator, f.d!.studentId, onOrAfter(`${Y}-09-06`, 0))).lessons).toEqual([]);
    const again = await apiResponse(coordinator.api.v1.scheduling.groups.form.$post({ json: { academicYearId: yearId, commit: false } }));
    expect(again.groups.flatMap((g) => g.adding)).toEqual([]);
  });

  it('section groups, a group by hand; weekly periods, doubles and room needs; a split and a merge keep history', async () => {
    const made = await apiResponse(coordinator.api.v1.scheduling.groups.sections.$post({
      json: { academicYearId: yearId, sectionIds: [s11a, s11b], name: 'Arabic', teacherId: tArab, weeklyPeriods: 2, doublePeriods: 0 },
    }));
    expect(made.created.map((g) => g.name).sort()).toEqual(['Arabic F1S1-11A', 'Arabic F1S1-11B']);
    // Running it again makes nothing (the names exist).
    expect((await apiResponse(coordinator.api.v1.scheduling.groups.sections.$post({
      json: { academicYearId: yearId, sectionIds: [s11a], name: 'Arabic', teacherId: tArab, weeklyPeriods: 2, doublePeriods: 0 },
    }))).skipped).toEqual(['Arabic F1S1-11A']);
    await apiResponse(coordinator.api.v1.scheduling.groups.$post({
      json: { academicYearId: yearId, name: 'Study skills S1', teacherId: tSpare, weeklyPeriods: 2, doublePeriods: 0, roomId: hall },
    }));
    const list = await apiResponse(coordinator.api.v1.scheduling.groups.$get({ query: { academicYearId: yearId } }));
    const g = (name: string) => list.groups.find((x) => x.name === name)!;
    // A section group's students are the section's.
    expect(g('Arabic F1S1-11A').size).toBe(2);
    expect((await refused(coordinator.api.v1.scheduling.groups[':id'].members.$post({ param: { id: g('Arabic F1S1-11A').id }, json: { studentIds: [f.c!.studentId] } }))).status).toBe(409);
    await apiResponse(coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: g('Physics S1').id }, json: { weeklyPeriods: 3, doublePeriods: 1, roomType: 'science_lab' } }));
    expect((await refused(coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: g('Chemistry S1').id }, json: { weeklyPeriods: 2, doublePeriods: 2 } }))).error)
      .toBe('Doubles take two periods each: they cannot exceed the weekly periods');

    // Split Physics: D into a group of their own, then merge back. The membership keeps both.
    const split = await apiResponse(coordinator.api.v1.scheduling.groups[':id'].split.$post({
      param: { id: g('Physics S1').id }, json: { parts: [{ name: 'Physics S1 (set 2)', studentIds: [f.d!.studentId] }], startsOn: `${Y}-09-06` },
    }));
    const set2 = split.groups[0]!.id;
    expect(await sql(`select student_id from teaching_group_member where group_id = $1 and ended_on is null`, [set2])).toEqual([{ student_id: f.d!.studentId }]);
    const merged = await apiResponse(coordinator.api.v1.scheduling.groups.merge.$post({ json: { intoGroupId: g('Physics S1').id, groupIds: [set2], startsOn: `${Y}-09-06` } }));
    expect(merged).toMatchObject({ merged: 1, movedStudents: 1 });
    const history = await sql<{ group_id: string; started_on: string; ended_on: string | null }>(
      `select group_id, started_on, ended_on from teaching_group_member where student_id = $1 and subject_id = $2 order by created_at`, [f.d!.studentId, phys]);
    expect(history.map((h) => h.group_id)).toEqual([g('Physics S1').id, set2, g('Physics S1').id]);
    // Each same-day move replaced the one before it: two empty stays, one open membership.
    expect(history.map((h) => h.ended_on)).toEqual([`${Y}-09-05`, `${Y}-09-05`, null]);
    expect((await one<{ archived_on: string; archived_reason: string }>(`select archived_on, archived_reason from teaching_group where id = $1`, [set2])))
      .toEqual({ archived_on: `${Y}-09-06`, archived_reason: 'Merged into Physics S1' });
    // A move cannot be dated before the student joined their current group (ST-16's rule, here from the start).
    const ext = await apiResponse(coordinator.api.v1.scheduling.groups.$post({
      json: { academicYearId: yearId, name: 'Chemistry S1 (extension)', subjectId: chem, teacherId: tChem, weeklyPeriods: 1, doublePeriods: 0, studentIds: [f.a!.studentId], startsOn: `${Y}-10-01` },
    }));
    expect(await refused(coordinator.api.v1.scheduling.groups[':id'].members.$post({ param: { id: g('Chemistry S1').id }, json: { studentIds: [f.a!.studentId], startsOn: `${Y}-09-20` } })))
      .toEqual({ status: 409, error: expect.stringMatching(/^A move must start on or after the day the student joined their current group: Student sch-a joined Chemistry S1 \(extension\) on .*1 October/) });
    // Back on the same day: that membership is replaced (withdrawn before its first day), never doubled.
    expect(await apiResponse(coordinator.api.v1.scheduling.groups[':id'].members.$post({ param: { id: g('Chemistry S1').id }, json: { studentIds: [f.a!.studentId], startsOn: `${Y}-10-01` } })))
      .toEqual({ added: 1, moved: 1, alreadyIn: 0 });
    expect(await sql(`select g.name, m.started_on, m.ended_on from teaching_group_member m join teaching_group g on g.id = m.group_id where m.student_id = $1 and m.subject_id = $2 order by m.created_at`, [f.a!.studentId, chem]))
      .toEqual([
        { name: 'Chemistry S1', started_on: `${Y}-09-06`, ended_on: `${Y}-09-30` },
        { name: 'Chemistry S1 (extension)', started_on: `${Y}-10-01`, ended_on: `${Y}-09-30` },
        { name: 'Chemistry S1', started_on: `${Y}-10-01`, ended_on: null },
      ]);
    await apiResponse(coordinator.api.v1.scheduling.groups[':id'].archive.$post({ param: { id: ext.id }, json: { archivedOn: `${Y}-09-06`, reason: 'not needed after all' } }));
  });

  // ─── The grid: every clash type, before and after a move ───────────────────

  it('each clash type detected: refused before the move with its reason, listed after it when placed anyway', async () => {
    ttId = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId: term1, name: 'Term 1 — first' } }))).id;
    let tt = await load(ttId);
    // Cards follow the groups: Physics a double and a single, the others two singles each.
    expect(tt.groups.map((g) => `${g.name}:${tt.engine.lessons.filter((l) => l.groupId === g.id).map((l) => l.length).join('+')}`).sort())
      .toEqual(['Arabic F1S1-11A:1+1', 'Arabic F1S1-11B:1+1', 'Chemistry S1:1+1', 'Maths S1 (no teacher yet):1+1', 'Physics S1:2+1', 'Study skills S1:1+1']);
    expect(tt.problems).toContain('1 group has no teacher yet: Maths S1 (no teacher yet)');

    const MON = 1, TUE = 2, WED = 3, THU = 4, SUN = 0;
    const clashOf = async (kind: string) => (await load(ttId)).clashes.filter((c) => c.kind === kind).map((c) => c.message);
    async function expectClash(kind: string, attempt: () => Promise<Response>, sentence: string | RegExp) {
      const before = await refused(attempt());
      expect(before.status, before.error).toBe(409);
      if (typeof sentence === 'string') expect(before.error).toContain(sentence);
      else expect(before.error).toMatch(sentence);
      return before;
    }

    // teacher_busy
    expect((await move(ttId, 'Arabic F1S1-11A', 1, SUN, 1)).status).toBe(200);
    await expectClash('teacher_busy', () => move(ttId, 'Arabic F1S1-11B', 1, SUN, 1), 'teacher sch-arab teaches Arabic F1S1-11A and Arabic F1S1-11B at Sunday P1');
    expect((await move(ttId, 'Arabic F1S1-11B', 1, SUN, 1, { allowClash: true })).status).toBe(200);
    expect(await clashOf('teacher_busy')).toEqual(['teacher sch-arab teaches Arabic F1S1-11A and Arabic F1S1-11B at Sunday P1']);
    await unplace(ttId, 'Arabic F1S1-11B', 1);
    expect(await clashOf('teacher_busy')).toEqual([]);

    // students_busy (groups overlap by student: A takes Physics and Chemistry)
    expect((await move(ttId, 'Physics S1', 2, MON, 3)).status).toBe(200);
    await expectClash('students_busy', () => move(ttId, 'Chemistry S1', 1, MON, 3), '1 student is in both Chemistry S1 and Physics S1 at Monday P3');
    await move(ttId, 'Chemistry S1', 1, MON, 3, { allowClash: true });
    expect(await clashOf('students_busy')).toEqual(['1 student is in both Chemistry S1 and Physics S1 at Monday P3']);
    await unplace(ttId, 'Chemistry S1', 1);

    // room_busy (Study skills has no students: only the room is shared)
    expect((await move(ttId, 'Study skills S1', 1, WED, 1)).status).toBe(200);
    await expectClash('room_busy', () => move(ttId, 'Arabic F1S1-11A', 2, WED, 1, { roomId: hall }), 'F1S1 Hall holds');
    await move(ttId, 'Arabic F1S1-11A', 2, WED, 1, { roomId: hall, allowClash: true });
    expect((await clashOf('room_busy'))[0]).toMatch(/^F1S1 Hall holds (Arabic F1S1-11A and Study skills S1|Study skills S1 and Arabic F1S1-11A) at Wednesday P1$/);
    await unplace(ttId, 'Arabic F1S1-11A', 2);

    // teacher_unavailable and room_unavailable (the year's rules)
    await apiResponse(coordinator.api.v1.scheduling.rules.teachers[':teacherId'].$put({
      param: { teacherId: tSpare }, json: { academicYearId: yearId, maxPerDay: null, maxPerWeek: null, unavailable: [{ weekday: THU, period: null, note: 'part-time' }] },
    }));
    await expectClash('teacher_unavailable', () => move(ttId, 'Study skills S1', 2, THU, 2), 'teacher sch-spare is unavailable at Thursday P2 (Study skills S1)');
    await move(ttId, 'Study skills S1', 2, THU, 2, { allowClash: true });
    expect(await clashOf('teacher_unavailable')).toEqual(['teacher sch-spare is unavailable at Thursday P2 (Study skills S1)']);
    await unplace(ttId, 'Study skills S1', 2);
    await apiResponse(coordinator.api.v1.scheduling.rules.rooms[':roomId'].$put({
      param: { roomId: hall }, json: { academicYearId: yearId, unavailable: [{ weekday: SUN, period: 6, note: 'assembly' }] },
    }));
    await expectClash('room_unavailable', () => move(ttId, 'Study skills S1', 2, SUN, 6), 'F1S1 Hall is unavailable at Sunday P6 (Study skills S1)');
    await move(ttId, 'Study skills S1', 2, SUN, 6, { allowClash: true });
    expect(await clashOf('room_unavailable')).toEqual(['F1S1 Hall is unavailable at Sunday P6 (Study skills S1)']);
    await unplace(ttId, 'Study skills S1', 2);

    // teacher_day_limit and teacher_week_limit
    await apiResponse(coordinator.api.v1.scheduling.rules.teachers[':teacherId'].$put({
      param: { teacherId: tArab }, json: { academicYearId: yearId, maxPerDay: 1, maxPerWeek: null, unavailable: [] },
    }));
    await expectClash('teacher_day_limit', () => move(ttId, 'Arabic F1S1-11A', 2, SUN, 4), 'teacher sch-arab teaches 2 periods on Sunday; the most is 1');
    await move(ttId, 'Arabic F1S1-11A', 2, SUN, 4, { allowClash: true });
    expect(await clashOf('teacher_day_limit')).toEqual(['teacher sch-arab teaches 2 periods on Sunday; the most is 1']);
    await unplace(ttId, 'Arabic F1S1-11A', 2);
    await apiResponse(coordinator.api.v1.scheduling.rules.teachers[':teacherId'].$put({
      param: { teacherId: tChem }, json: { academicYearId: yearId, maxPerDay: null, maxPerWeek: 1, unavailable: [] },
    }));
    expect((await move(ttId, 'Chemistry S1', 1, TUE, 1)).status).toBe(200);
    await expectClash('teacher_week_limit', () => move(ttId, 'Chemistry S1', 2, WED, 3), 'teacher sch-chem teaches 2 periods a week; the most is 1');
    await move(ttId, 'Chemistry S1', 2, WED, 3, { allowClash: true });
    expect(await clashOf('teacher_week_limit')).toEqual(['teacher sch-chem teaches 2 periods a week; the most is 1']);
    await unplace(ttId, 'Chemistry S1', 2);

    // Rooms: type, features, capacity, out of use, fixed, none
    await expectClash('room_type', () => move(ttId, 'Physics S1', 2, MON, 3, { roomId: roomA }), 'Physics S1 needs a science lab; F1S1 Room 11A is not one');
    await apiResponse(coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: groupOf(tt, 'Chemistry S1').id }, json: { roomFeatures: ['fume_cupboard'] } }));
    await expectClash('room_features', () => move(ttId, 'Chemistry S1', 1, TUE, 1, { roomId: lab }), 'Chemistry S1 needs a fume cupboard; F1S1 Lab has none');
    await apiResponse(coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: groupOf(tt, 'Chemistry S1').id }, json: { roomFeatures: [] } }));
    await expectClash('room_capacity', () => move(ttId, 'Arabic F1S1-11A', 2, TUE, 5, { roomId: booth }), 'Arabic F1S1-11A has 2 students; F1S1 Booth seats 1');
    await apiResponse(coordinator.api.v1.academic.rooms[':id'].$put({ param: { id: booth }, json: { isActive: false } }));
    await expectClash('room_closed', () => move(ttId, 'Arabic F1S1-11A', 2, TUE, 5, { roomId: booth }), 'F1S1 Booth is out of use');
    await expectClash('room_fixed', () => move(ttId, 'Study skills S1', 1, WED, 1, { roomId: roomB }), 'Study skills S1 is always in F1S1 Hall, not F1S1 Room 11B');
    await expectClash('no_room', () => move(ttId, 'Arabic F1S1-11A', 2, TUE, 5, { roomId: null }), 'Arabic F1S1-11A at Tuesday P5 has no room');
    await move(ttId, 'Arabic F1S1-11A', 2, TUE, 5, { roomId: null, allowClash: true });
    expect(await clashOf('no_room')).toEqual(['Arabic F1S1-11A at Tuesday P5 has no room']);
    await unplace(ttId, 'Arabic F1S1-11A', 2);

    // same_day (a rule keeps Physics and Chemistry on different days)
    tt = await load(ttId);
    await apiResponse(coordinator.api.v1.scheduling.rules['day-rules'].$post({ json: { academicYearId: yearId, groupAId: groupOf(tt, 'Physics S1').id, groupBId: groupOf(tt, 'Chemistry S1').id, note: 'practicals' } }));
    await expectClash('same_day', () => move(ttId, 'Physics S1', 2, TUE, 5), /^It would clash: (Chemistry S1 and Physics S1|Physics S1 and Chemistry S1) are both on Tuesday; they are kept on different days$/);
    await move(ttId, 'Physics S1', 2, TUE, 5, { allowClash: true });
    expect((await clashOf('same_day'))[0]).toMatch(/are both on Tuesday; they are kept on different days$/);
    await move(ttId, 'Physics S1', 2, MON, 3);

    // no_period and double_split (the bell schedule's shape)
    await expectClash('no_period', () => move(ttId, 'Maths S1 (no teacher yet)', 1, WED, 9), 'Maths S1 (no teacher yet) is at Wednesday period 9, which the bell schedule does not have');
    await move(ttId, 'Maths S1 (no teacher yet)', 1, WED, 9, { allowClash: true });
    expect(await clashOf('no_period')).toEqual(['Maths S1 (no teacher yet) is at Wednesday period 9, which the bell schedule does not have']);
    await unplace(ttId, 'Maths S1 (no teacher yet)', 1);
    await expectClash('double_split', () => move(ttId, 'Physics S1', 1, WED, 2), "Physics S1's double at Wednesday P2 is split by a break");
    await move(ttId, 'Physics S1', 1, WED, 2, { allowClash: true });
    expect(await clashOf('double_split')).toEqual(["Physics S1's double at Wednesday P2 is split by a break"]);
    await move(ttId, 'Physics S1', 1, WED, 1);

    // Every kind the engine knows was seen above, before and after.
    expect((await load(ttId)).clashes).toEqual([]);
    const moved = await sql<{ n: string }>(`select count(*)::text as n from audit_log where action = 'TIMETABLE_LESSON_MOVED' and entity_id = $1`, [ttId]);
    expect(Number(moved[0]!.n)).toBeGreaterThan(20);
  });

  it('a lesson moved by someone else since the editor looked is refused; a locked lesson stays put', async () => {
    const tt = await load(ttId);
    const l = lessonOf(tt, 'Physics S1', 2);
    const stale = await refused(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({
      param: { id: ttId, lessonId: l.id }, json: { weekday: 4, period: 4, from: { weekday: null, period: null } },
    }));
    expect(stale).toEqual({ status: 409, error: 'Someone else moved this lesson a moment ago — the grid shows where it is now' });
    await apiResponse(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].lock.$post({ param: { id: ttId, lessonId: l.id }, json: { locked: true } }));
    expect((await refused(move(ttId, 'Physics S1', 2, 4, 4))).error).toBe('This lesson is locked — unlock it to move it');
    await apiResponse(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].lock.$post({ param: { id: ttId, lessonId: l.id }, json: { locked: false } }));
  });

  // ─── Publishing ────────────────────────────────────────────────────────────

  it('publish refuses clashes, dates outside the term and unplaced lessons; then notifies students, parents and teachers; a published version never changes', async () => {
    // The rules that made clashes above are lifted.
    await apiResponse(coordinator.api.v1.scheduling.rules.teachers[':teacherId'].$put({ param: { teacherId: tChem }, json: { academicYearId: yearId, maxPerDay: null, maxPerWeek: null, unavailable: [] } }));
    await apiResponse(coordinator.api.v1.scheduling.rules.teachers[':teacherId'].$put({ param: { teacherId: tArab }, json: { academicYearId: yearId, maxPerDay: null, maxPerWeek: null, unavailable: [] } }));
    // Arabic's first lessons are fixed where the sections' scenario needs them, and locked.
    await move(ttId, 'Arabic F1S1-11A', 1, 0, 1);
    await move(ttId, 'Arabic F1S1-11B', 1, 0, 2);
    let tt = await load(ttId);
    for (const [n, s] of [['Arabic F1S1-11A', 1], ['Arabic F1S1-11B', 1]] as const) {
      await apiResponse(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].lock.$post({ param: { id: ttId, lessonId: lessonOf(tt, n, s).id }, json: { locked: true } }));
    }
    // A clash placed anyway blocks publishing.
    await move(ttId, 'Arabic F1S1-11B', 2, 0, 1, { allowClash: true });
    const withClash = await refused(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: ttId }, json: { effectiveFrom: `${Y}-09-06` } }));
    expect(withClash.status).toBe(409);
    expect(withClash.error).toMatch(/^Resolve the clashes before publishing \(1\): teacher sch-arab teaches Arabic F1S1-11A and Arabic F1S1-11B at Sunday P1$/);
    await unplace(ttId, 'Arabic F1S1-11B', 2);
    expect((await refused(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: ttId }, json: { effectiveFrom: `${Y}-12-21` } }))).error)
      .toMatch(/^Term 1 runs from .* to .*: the timetable takes effect inside it$/);
    const unplacedFirst = await refused(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: ttId }, json: { effectiveFrom: `${Y}-09-06` } }));
    expect(unplacedFirst.error).toMatch(/^\d+ lessons are not on the grid — place them, or publish without them$/);

    // The generator places the rest around the locks.
    const run = await apiResponse(coordinator.api.v1.timetables[':id'].generate.$post({ param: { id: ttId }, json: {} }));
    expect(run.unplaced).toEqual([]);
    tt = await load(ttId);
    expect(tt.clashes).toEqual([]);
    expect(tt.unplaced).toEqual([]);
    expect([lessonOf(tt, 'Arabic F1S1-11A', 1), lessonOf(tt, 'Arabic F1S1-11B', 1)].map((l) => [l.weekday, l.period, l.locked])).toEqual([[0, 1, true], [0, 2, true]]);

    const published = await apiResponse(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: ttId }, json: { effectiveFrom: `${Y}-09-06`, note: 'first' } }));
    expect(published).toMatchObject({ effectiveFrom: `${Y}-09-06`, replaces: null, notified: { students: 4, parents: 4, teachers: 4 } });
    for (const tag of ['a', 'b', 'c', 'd']) {
      expect((await notified(`student.sch-${tag}@test.local`, 'TIMETABLE_PUBLISHED', 1))[0]!.body).toMatch(/^Your timetable from .* is ready\. Open Timetable to see it\.$/);
      expect((await notified(`parent.sch-${tag}@test.local`, 'TIMETABLE_PUBLISHED', 1))[0]!.body).toMatch(new RegExp(`^Student sch-${tag}'s timetable from .* is ready`));
    }
    for (const tag of ['sch-phys', 'sch-chem', 'sch-arab', 'sch-spare']) await notified(`teacher.${tag}@test.local`, 'TIMETABLE_PUBLISHED', 1);
    await audited([ttId], ['TIMETABLE_CREATED', 'TIMETABLE_GENERATED', 'TIMETABLE_PUBLISHED']);

    // Frozen and kept.
    expect((await refused(move(ttId, 'Maths S1 (no teacher yet)', 1, 4, 6))).error).toBe('A published timetable does not change — make a new draft from it on the Versions screen');
    expect((await refused(coordinator.api.v1.timetables[':id'].$delete({ param: { id: ttId } }))).error).toBe('A published timetable is kept for good — make a new draft instead');
    expect((await refused(coordinator.api.v1.timetables[':id'].generate.$post({ param: { id: ttId }, json: {} }))).status).toBe(409);
  });

  it('a second version from a later date: only the people whose lessons changed are told; each date reads the version in force', async () => {
    const v2 = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId: term1, name: 'Term 1 — from November', copyFromId: ttId } }))).id;
    const before = await load(ttId);
    const p2 = lessonOf(before, 'Physics S1', 2);
    // Move Physics' single somewhere free in the copy.
    const copy = await load(v2);
    const free = optionsFor(copy.engine, lessonOf(copy, 'Physics S1', 2).id).find((o) => o.ok && !(o.weekday === p2.weekday && o.period === p2.period))!;
    await apiResponse(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({
      param: { id: v2, lessonId: lessonOf(copy, 'Physics S1', 2).id }, json: { weekday: free.weekday, period: free.period, from: { weekday: p2.weekday, period: p2.period } },
    }));
    const from = onOrAfter(`${Y}-11-01`, 0);
    const res = await apiResponse(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: v2 }, json: { effectiveFrom: from } }));
    expect(res).toMatchObject({ replaces: ttId, changedGroups: 1, notified: { students: 3, parents: 3, teachers: 1 } });
    for (const tag of ['a', 'b', 'd']) {
      const n = await notified(`student.sch-${tag}@test.local`, 'TIMETABLE_PUBLISHED', 2);
      expect(n[1]!.body).toMatch(/^Your timetable changes from .*\. Open Timetable to see it\.$/);
    }
    await notified('teacher.sch-phys@test.local', 'TIMETABLE_PUBLISHED', 2);
    // C (no Physics) and the Chemistry teacher were not told again.
    expect(await notificationsFor('student.sch-c@test.local', 'TIMETABLE_PUBLISHED')).toHaveLength(1);
    expect(await notificationsFor('teacher.sch-chem@test.local', 'TIMETABLE_PUBLISHED')).toHaveLength(1);

    // The version in force: before November the first, from it the second.
    const early = onOrAfter(`${Y}-10-11`, p2.weekday!);
    const late = onOrAfter(from, free.weekday);
    const a1 = await day(f.a!.parent, f.a!.studentId, early);
    expect(a1.timetable?.id).toBe(ttId);
    expect(a1.lessons.find((l) => l.groupName === 'Physics S1' && l.period === p2.period)).toBeTruthy();
    const a2 = await day(f.a!.parent, f.a!.studentId, late);
    expect(a2.timetable?.id).toBe(v2);
    expect(a2.lessons.find((l) => l.groupName === 'Physics S1' && l.period === free.period && l.length === 1)).toBeTruthy();
    const list = await apiResponse(coordinator.api.v1.timetables.$get({ query: { termId: term1 } }));
    expect(list.map((t) => [t.name, t.status, t.effectiveFrom])).toEqual(expect.arrayContaining([
      ['Term 1 — first', 'published', `${Y}-09-06`], ['Term 1 — from November', 'published', from],
    ]));
  });

  // ─── What a day is, and who sees what ──────────────────────────────────────

  it("the calendar decides: a holiday, the weekend, a short day's missing periods, an exam-only day, between terms", async () => {
    const tt = await load(ttId);
    // A Sunday in October holds A's Arabic at P1 (locked there).
    const sunday = onOrAfter(`${Y}-10-04`, 0);
    const normal = await day(f.a!.student, f.a!.studentId, sunday);
    expect(normal).toMatchObject({ kind: 'school_day', note: null, timetable: { id: ttId } });
    const arabic = normal.lessons.find((l) => l.groupName === 'Arabic F1S1-11A')!;
    expect(arabic).toMatchObject({ period: 1, label: 'P1', startsAt: '08:00', endsAt: '08:45', status: 'scheduled', teacher: { id: tArab } });

    const holiday = onOrAfter(`${Y}-10-11`, 0);
    await apiResponse(coordinator.api.v1.academic.calendar.$post({ json: { academicYearId: yearId, kind: 'holiday', name: 'Armed Forces Day', startsOn: holiday, endsOn: holiday } }));
    expect(await day(f.a!.student, f.a!.studentId, holiday)).toMatchObject({ kind: 'holiday', note: 'holiday', lessons: [] });
    expect(await day(f.a!.student, f.a!.studentId, onOrAfter(`${Y}-10-04`, 5))).toMatchObject({ kind: 'weekend', note: 'weekend', lessons: [] });
    expect(await day(f.a!.student, f.a!.studentId, `${Y}-12-28`)).toMatchObject({ kind: 'out_of_term', note: 'out_of_term', lessons: [] });

    // A short day: its bells have four lesson periods, so lessons at P5 and P6 are not held.
    const shortDay = onOrAfter(`${Y}-10-18`, 0);
    await apiResponse(coordinator.api.v1.academic.calendar.$post({ json: { academicYearId: yearId, kind: 'early_dismissal', name: 'Parents evening', startsOn: shortDay, endsOn: shortDay, bellScheduleId: short } }));
    const allSunday = tt.engine.lessons.filter((l) => l.weekday === 0);
    const sd = await apiResponse(coordinator.api.v1.schedule.week.$get({ query: { sectionId: s11a, date: shortDay } }));
    const theDay = sd.days.find((d) => d.date === shortDay)!;
    expect(theDay.kind).toBe('early_dismissal');
    for (const l of theDay.lessons) expect(l.period).toBeLessThanOrEqual(4);
    const a = await day(f.a!.student, f.a!.studentId, shortDay);
    expect(a.lessons.find((l) => l.groupName === 'Arabic F1S1-11A')).toMatchObject({ startsAt: '08:00', endsAt: '08:30' });
    const lateOnSunday = allSunday.filter((l) => l.period! >= 5).map((l) => l.id);
    const notHeldIds = [...theDay.notHeld.map((n) => n.lessonId)];
    for (const n of theDay.notHeld) expect(n.reason).toBe('short_day');
    expect(lateOnSunday.every((id) => !theDay.lessons.some((l) => l.lessonId === id))).toBe(true);
    expect(notHeldIds.every((id) => lateOnSunday.includes(id))).toBe(true);

    // An exam-only day holds no lessons.
    const exams = onOrAfter(`${Y}-10-25`, 0);
    await apiResponse(coordinator.api.v1.academic.calendar.$post({ json: { academicYearId: yearId, kind: 'exam_only', name: 'Mock exams', startsOn: exams, endsOn: exams } }));
    const e = await day(f.a!.student, f.a!.studentId, exams);
    expect(e).toMatchObject({ kind: 'exam_only', note: 'exam_only', lessons: [] });
    expect(e.notHeld.map((n) => n.reason)).toContain('exam_only');
  });

  it("a parent sees only their child's timetable; a teacher sees only their own; rooms and sections are the coordinator's", async () => {
    const date = onOrAfter(`${Y}-10-04`, 0);
    // A parent: their child, not another family's.
    expect((await apiResponse(f.a!.parent.api.v1.schedule.week.$get({ query: { studentId: f.a!.studentId, date } }))).target).toMatchObject({ kind: 'student', id: f.a!.studentId });
    expect(await refused(f.a!.parent.api.v1.schedule.week.$get({ query: { studentId: f.c!.studentId, date } }))).toEqual({ status: 404, error: 'Student not found' });
    expect(await refused(f.a!.parent.api.v1.schedule.day.$get({ query: { studentId: f.c!.studentId, date } }))).toEqual({ status: 404, error: 'Student not found' });
    // A student: their own week, and not a classmate's.
    const mine = await apiResponse(f.b!.student.api.v1.schedule.me.week.$get({ query: { date } }));
    expect(mine.target).toMatchObject({ kind: 'student', id: f.b!.studentId });
    expect(mine.days.flatMap((d) => d.lessons.map((l) => l.groupName)).filter((n, i, xs) => xs.indexOf(n) === i).sort()).toEqual(['Arabic F1S1-11A', 'Physics S1']);
    expect((await refused(f.b!.student.api.v1.schedule.week.$get({ query: { studentId: f.a!.studentId, date } }))).status).toBe(404);
    // A teacher: their own teaching only.
    const phys = await apiResponse(tPhysC.api.v1.schedule.me.week.$get({ query: { date } }));
    expect(phys.target).toMatchObject({ kind: 'teacher', id: tPhys });
    expect(new Set(phys.days.flatMap((d) => d.lessons.map((l) => l.groupName)))).toEqual(new Set(['Physics S1']));
    expect(await refused(tPhysC.api.v1.schedule.week.$get({ query: { teacherId: tChem, date } }))).toEqual({ status: 404, error: 'Teacher not found' });
    expect((await refused(tPhysC.api.v1.schedule.week.$get({ query: { studentId: f.a!.studentId, date } }))).status).toBe(404);
    expect((await refused(tPhysC.api.v1.schedule.week.$get({ query: { roomId: lab, date } }))).status).toBe(403);
    // The coordinator: any teacher, room or section.
    const room = await apiResponse(coordinator.api.v1.schedule.week.$get({ query: { roomId: hall, date } }));
    const inHall = room.days.flatMap((d) => d.lessons);
    expect(inHall.map((l) => l.groupName)).toContain('Study skills S1');
    expect(inHall.every((l) => l.room?.id === hall)).toBe(true);
    const sec = await apiResponse(coordinator.api.v1.schedule.week.$get({ query: { sectionId: s11b, date } }));
    const names = new Set(sec.days.flatMap((d) => d.lessons.map((l) => l.groupName)));
    expect(names).toEqual(new Set(['Arabic F1S1-11B', 'Chemistry S1', 'Physics S1']));
    const chemistryIn11b = sec.days.flatMap((d) => d.lessons).find((l) => l.groupName === 'Chemistry S1')!;
    expect(chemistryIn11b.sectionStudents).toBe(1);
    // The desk reads a student's timetable (the Student 360), not a teacher's.
    expect((await apiResponse(officer.api.v1.schedule.day.$get({ query: { studentId: f.a!.studentId, date } }))).lessons.length).toBeGreaterThan(0);
    expect((await refused(officer.api.v1.schedule.day.$get({ query: { teacherId: tPhys, date } }))).status).toBe(404);
  });

  it('a section on a date: a move on the day the student joined leaves them in the new section only that day (ST-16); a leaving before the section began leaves no lessons (SO-9)', async () => {
    const e = await onboard(officer, 'sch-e', 11);
    const g = await onboard(officer, 'sch-g', 11);
    for (const x of [e, g]) await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: x.studentId }, json: { cohortYear: Y - 1, reason: 'F1 scenario year' } }));
    const joined = onOrAfter(`${Y}-10-04`, 0);
    await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s11a }, json: { studentIds: [e.studentId], startsOn: joined } }));
    await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s11b }, json: { studentIds: [e.studentId], startsOn: joined } }));
    // F0a leaves both memberships covering that day.
    expect(await sql(`select s.name, m.started_on, m.ended_on from section_membership m join section s on s.id = m.section_id where m.student_id = $1 order by m.created_at`, [e.studentId]))
      .toEqual([{ name: 'F1S1-11A', started_on: joined, ended_on: joined }, { name: 'F1S1-11B', started_on: joined, ended_on: null }]);
    // Arabic 11A is at Sunday P1 and Arabic 11B at P2 (both locked): that day the student is in 11B only.
    const that = await day(coordinator, e.studentId, joined);
    expect(that.lessons.find((l) => l.period === 2)?.groupName).toBe('Arabic F1S1-11B');
    expect(new Set(that.lessons.map((l) => l.groupName))).toEqual(new Set(['Arabic F1S1-11B']));
    expect(new Set((await day(coordinator, e.studentId, plus(joined, 28))).lessons.map((l) => l.groupName))).toEqual(new Set(['Arabic F1S1-11B']));
    expect((await day(coordinator, e.studentId, plus(joined, -7))).lessons).toEqual([]);

    // SO-9: a leaving dated before the section began (the section's end is clamped to its start).
    const starts = onOrAfter(`${Y}-11-15`, 0);
    await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s11b }, json: { studentIds: [g.studentId], startsOn: starts } }));
    await apiResponse(coordinator.api.v1.students[':id'].leave.$post({ param: { id: g.studentId }, json: { kind: 'withdrawn', leftOn: schoolDateString(new Date()), reason: 'moved abroad' } }));
    expect(await one(`select started_on, ended_on from section_membership where student_id = $1`, [g.studentId])).toEqual({ started_on: starts, ended_on: starts });
    expect(await day(coordinator, g.studentId, starts)).toMatchObject({ note: 'left', lessons: [] });
    // Nor is the student on the class list of 11B's Arabic that day, though the clamped row covers it.
    const arabic11b = (await day(coordinator, f.c!.studentId, starts)).lessons.find((l) => l.groupName === 'Arabic F1S1-11B')!;
    const cls = await apiResponse(coordinator.api.v1.schedule.lesson.$get({ query: { lessonId: arabic11b.lessonId, date: starts } }));
    expect(cls.students.map((s) => s.id)).toContain(f.c!.studentId);
    expect(cls.students.map((s) => s.id)).not.toContain(g.studentId);
  });

  it('a student who leaves the school leaves their teaching groups with it: the rows end, the class lists drop them, the audit row counts them', async () => {
    const h = await onboard(officer, 'sch-h', 11);
    await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: h.studentId }, json: { cohortYear: Y - 1, reason: 'F1 scenario year' } }));
    await apiResponse(coordinator.api.v1.enrolments.$post({ json: { academicYearId: yearId, studentId: h.studentId, subjectId: phys, teacherId: tPhys, mode: 'in_school' } }));
    const physics = groupOf(await load(ttId), 'Physics S1');
    await apiResponse(coordinator.api.v1.scheduling.groups[':id'].members.$post({ param: { id: physics.id }, json: { studentIds: [h.studentId], startsOn: `${Y}-09-06` } }));
    // Physics S1's lesson on a school day in November: H is on its class list.
    const date = onOrAfter(`${Y}-11-22`, 0);
    const lessonDay = (await apiResponse(coordinator.api.v1.schedule.week.$get({ query: { studentId: f.a!.studentId, date } }))).days
      .find((d) => d.lessons.some((l) => l.groupName === 'Physics S1'))!;
    const lesson = lessonDay.lessons.find((l) => l.groupName === 'Physics S1')!;
    const classOf = async () => (await apiResponse(coordinator.api.v1.schedule.lesson.$get({ query: { lessonId: lesson.lessonId, date: lessonDay.date } }))).students.map((s) => s.id);
    expect(await classOf()).toContain(h.studentId);

    // H leaves today: the school year of this suite has not begun, so the stay in the group is empty.
    const today = schoolDateString(new Date());
    await apiResponse(coordinator.api.v1.students[':id'].leave.$post({ param: { id: h.studentId }, json: { kind: 'withdrawn', leftOn: today, reason: 'moved abroad' } }));
    expect(await sql(`select started_on, ended_on, end_reason from teaching_group_member where student_id = $1`, [h.studentId]))
      .toEqual([{ started_on: `${Y}-09-06`, ended_on: `${Y}-09-05`, end_reason: 'Left the school (withdrawn)' }]);
    expect(await classOf()).not.toContain(h.studentId);
    expect(await day(coordinator, h.studentId, lessonDay.date)).toMatchObject({ note: 'left', lessons: [] });
    expect(await one(`select new_data->'groupsEnded' as n from audit_log where action = 'STUDENT_LEFT' and entity_id = $1`, [h.studentId])).toEqual({ n: 1 });
  });

  // ─── Output ────────────────────────────────────────────────────────────────

  it('the calendar feed: a student’s link lists their lessons at Cairo times; a new link ends the old one; a revoked link gets nothing', async () => {
    expect(await apiResponse(f.a!.student.api.v1.schedule.feed.$get())).toMatchObject({ available: true, active: false });
    const link = await apiResponse(f.a!.student.api.v1.schedule.feed.$post());
    expect(link.path).toMatch(/^\/v1\/ical\/[A-Za-z0-9_-]{30,}\.ics$/);
    const token = link.path.split('/').pop()!;
    const res = await f.a!.student.api.v1.ical[':token'].$get({ param: { token } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    const ics = await res.text();
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    // Sunday's Arabic at 08:00 in Cairo is 05:00 or 06:00 UTC by the season; the feed writes the instant.
    const sunday = onOrAfter(`${Y}-10-04`, 0);
    const { cairoInstant } = await import('../src/services/scheduling-shared.services');
    const start = cairoInstant(sunday, '08:00').toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    expect(ics).toContain(`DTSTART:${start}`);
    expect(ics).toContain('SUMMARY:Arabic F1S1-11A');
    expect(ics).toContain('LOCATION:F1S1 Room 11A');
    expect(ics).not.toContain('SUMMARY:Arabic F1S1-11B');
    const events = ics.split('BEGIN:VEVENT').length - 1;
    expect(events).toBeGreaterThan(20);
    // A new link: the old one is dead at once.
    const again = await apiResponse(f.a!.student.api.v1.schedule.feed.$post());
    expect((await f.a!.student.api.v1.ical[':token'].$get({ param: { token } })).status).toBe(404);
    expect((await f.a!.student.api.v1.ical[':token'].$get({ param: { token: again.path.split('/').pop()! } })).status).toBe(200);
    await apiResponse(f.a!.student.api.v1.schedule.feed.$delete());
    const dead = await f.a!.student.api.v1.ical[':token'].$get({ param: { token: again.path.split('/').pop()! } });
    expect(dead.status).toBe(404);
    expect(await dead.text()).not.toContain('VEVENT');
    expect(await apiResponse(f.a!.student.api.v1.schedule.feed.$get())).toMatchObject({ active: false });
    expect((await sql(`select action from audit_log where action like 'CALENDAR_FEED_%' and user_id = $1 order by created_at`, [f.a!.studentId])).map((r) => r.action))
      .toEqual(['CALENDAR_FEED_CREATED', 'CALENDAR_FEED_CREATED', 'CALENDAR_FEED_REVOKED']);
  });

  it('exports: FET with every lesson as an activity and the shared students kept apart; aSc XML with a card per placed lesson; CSV one row per lesson', async () => {
    const tt = await load(ttId);
    const fet = await (await coordinator.api.v1.timetables[':id'].export.fet.$get({ param: { id: ttId } })).text();
    expect(fet.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<fet version=')).toBe(true);
    expect(fet.split('<Activity>').length - 1).toBe(tt.engine.lessons.length);
    expect(fet).toContain('<Number_of_Days>5</Number_of_Days>');
    expect(fet).toContain('<Number_of_Hours>6</Number_of_Hours>');
    expect(fet).toContain('ConstraintActivitiesNotOverlapping');
    expect(fet).toMatch(/<Comments>(Chemistry S1 and Physics S1|Physics S1 and Chemistry S1) share 1 students<\/Comments>/);
    expect(fet).toContain('<Permanently_Locked>true</Permanently_Locked>');
    expect(fet.trim().endsWith('</fet>')).toBe(true);
    const asc = await (await coordinator.api.v1.timetables[':id'].export.asc.$get({ param: { id: ttId } })).text();
    expect(asc).toContain('<timetable importtype="database"');
    expect(asc.split('<card ').length - 1).toBe(tt.engine.lessons.filter((l) => l.weekday !== null).length);
    expect(asc).toContain('periodspercard="2"');
    expect(asc.trim().endsWith('</timetable>')).toBe(true);
    const csvRes = await coordinator.api.v1.timetables[':id'].export.csv.$get({ param: { id: ttId }, query: {} });
    expect(csvRes.headers.get('content-disposition')).toMatch(/^attachment; filename="Term-1-first\.csv"$/);
    const csv = (await csvRes.text()).trim().split('\n');
    expect(csv[0]).toBe('Day,Period,Starts,Ends,Length,Group,Subject,Teacher,Room,Students,Sections,Locked');
    expect(csv).toHaveLength(tt.engine.lessons.length + 1);
    const teacherOnly = (await (await coordinator.api.v1.timetables[':id'].export.csv.$get({ param: { id: ttId }, query: { view: 'teacher', id: tPhys } })).text()).trim().split('\n');
    expect(teacherOnly.slice(1).every((r) => r.includes('Physics S1'))).toBe(true);
    expect(teacherOnly).toHaveLength(3);
  });
});
