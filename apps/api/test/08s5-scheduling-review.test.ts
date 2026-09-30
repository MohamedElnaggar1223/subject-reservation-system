import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import { admin, staff, onboard, subject, refused, one, sql, notified, notificationsFor, type Client } from './helpers';
import { setClockForTests } from '../src/lib/clock';

/**
 * F1 — what the review of 9569dd9 asked to be proven (docs/features/SCHEDULING.md §10):
 * - changes after publishing (a student added, a merge, a section move, forming
 *   from the enrolment, a group's teacher changed, a split) are checked against
 *   the published timetables: refused with the clash, or recorded and listed when
 *   the coordinator goes ahead anyway (flag 3);
 * - a group's teacher is dated: earlier weeks keep their teacher (flag 7);
 * - publishing carries cover over to the new version or removes it with notices,
 *   and a teacher covers only what is in force (flag 1);
 * - a cover teacher recorded away loses their covers — the lesson needs new
 *   cover (flag 2); withdrawing an absence or removing a cover tells people (8);
 * - today inside a term, through the test clock (flag 5);
 * - readmission keeps the leaving; an extra school day says why it is empty (12).
 */

const Y = academicYearStartOf() + 25;
const onOrAfter = (date: string, weekday: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const plus = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Put the school on a date (09:00 in Cairo is still that date in UTC). */
const clockAt = (date: string) => setClockForTests(new Date(`${date}T09:00:00Z`));

type Fam = { parent: Client; student: Client; studentId: string };

describe('F1: the review round — changes after publishing, dated teachers, cover and the clock', () => {
  let adm: Client, coordinator: Client, officer: Client;
  const t: Record<string, { c: Client; id: string }> = {};
  const s: Record<string, Fam> = {};
  let yearId: string, termId: string, s11a: string, s11b: string, phys: string, chem: string;
  const gid: Record<string, string> = {};
  let v1: string;
  const D0 = onOrAfter(`${Y}-10-04`, 0); // a Sunday

  const load = (id: string) => apiResponse(coordinator.api.v1.timetables[':id'].$get({ param: { id } }));
  const lessonOf = async (ttId: string, group: string, seq = 1) => {
    const tt = await load(ttId);
    const g = tt.groups.find((x) => x.name === group)!;
    return tt.engine.lessons.find((l) => l.groupId === g.id && l.seq === seq)!;
  };
  const place = async (ttId: string, group: string, weekday: number, period: number) => {
    const l = await lessonOf(ttId, group);
    return apiResponse(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({ param: { id: ttId, lessonId: l.id }, json: { weekday, period, from: { weekday: l.weekday, period: l.period } } }));
  };
  const dayOf = (who: string, date: string) => apiResponse(coordinator.api.v1.schedule.day.$get({ query: { studentId: s[who]!.studentId, date } }));
  const teacherDay = (who: string, date: string) => apiResponse(coordinator.api.v1.schedule.day.$get({ query: { teacherId: t[who]!.id, date } }));
  const classOf = async (lessonId: string, date: string) => (await apiResponse(coordinator.api.v1.schedule.lesson.$get({ query: { lessonId, date } }))).students.map((x) => x.id);
  const clashes = () => apiResponse(coordinator.api.v1.timetables.clashes.$get({ query: { academicYearId: yearId } }));

  beforeAll(async () => {
    adm = await admin('rev');
    coordinator = await staff(adm, 'coordinator', 'rev');
    officer = await staff(adm, 'finance_officer', 'rev');
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const c = await staff(adm, 'teacher', `rev-${k}`);
      t[k] = { c, id: (await one<{ id: string }>(`select id from teacher where user_id = $1`, [c.id])).id };
    }
    yearId = (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }))).id;
    termId = (await apiResponse(coordinator.api.v1.academic.terms.$post({ json: { academicYearId: yearId, name: 'Term 1', startsOn: `${Y}-09-06`, endsOn: `${Y}-12-20` } }))).id;
    const bells = await apiResponse(coordinator.api.v1.academic['bell-schedules'].$post({ json: { academicYearId: yearId, name: 'Regular', isDefault: true } }));
    await apiResponse(coordinator.api.v1.academic['bell-schedules'][':id'].periods.$put({
      param: { id: bells.id },
      json: { periods: [1, 2, 3, 4].map((p) => ({ weekday: null, label: `P${p}`, kind: 'lesson' as const, startsAt: `${String(7 + p).padStart(2, '0')}:00`, endsAt: `${String(7 + p).padStart(2, '0')}:45` })) },
    }));
    phys = await subject(adm, 'F1R-PHYS', 'Physics R', { course: 1000, registration: 400 });
    chem = await subject(adm, 'F1R-CHEM', 'Chemistry R', { course: 1000, registration: 400 });
    for (const k of ['1', '2', '3', '4', '5', '6', '7']) {
      s[k] = await onboard(officer, `rev-${k}`, 11);
      await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: s[k]!.studentId }, json: { cohortYear: Y - 1, reason: 'F1 review scenario year' } }));
    }
    s11a = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: yearId, grade: 11, name: 'R-11A' } }))).id;
    s11b = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: yearId, grade: 11, name: 'R-11B' } }))).id;
    await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s11a }, json: { studentIds: ['1', '2', '5'].map((k) => s[k]!.studentId), startsOn: `${Y}-09-06` } }));
    await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s11b }, json: { studentIds: ['3', '4', '6', '7'].map((k) => s[k]!.studentId), startsOn: `${Y}-09-06` } }));
    const group = async (name: string, subjectId: string, teacher: string, students: string[]) => {
      gid[name] = (await apiResponse(coordinator.api.v1.scheduling.groups.$post({
        json: { academicYearId: yearId, name, subjectId, teacherId: t[teacher]!.id, weeklyPeriods: 1, doublePeriods: 0, studentIds: students.map((k) => s[k]!.studentId), startsOn: `${Y}-09-06` },
      }))).id;
    };
    await group('Physics R', phys, 'a', ['1', '2', '5']);
    await group('Physics R2', phys, 'd', ['3']);
    await group('Chemistry R', chem, 'b', ['1', '3', '6']);
    for (const [sec, teacher] of [[s11a, 'c'], [s11b, 'f']] as const) {
      const made = await apiResponse(coordinator.api.v1.scheduling.groups.sections.$post({ json: { academicYearId: yearId, sectionIds: [sec], name: 'Arabic R', teacherId: t[teacher]!.id, weeklyPeriods: 1, doublePeriods: 0 } }));
      gid[made.created[0]!.name] = made.created[0]!.id;
    }
    v1 = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'R — first' } }))).id;
    await place(v1, 'Physics R', 0, 1);
    await place(v1, 'Physics R2', 0, 2);
    await place(v1, 'Chemistry R', 1, 1);
    await place(v1, 'Arabic R R-11A', 0, 2);
    await place(v1, 'Arabic R R-11B', 0, 1);
    await apiResponse(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: v1 }, json: { effectiveFrom: `${Y}-09-06` } }));
  }, 120_000);

  afterAll(() => setClockForTests(null));

  // ─── Flag 3: changes after publishing ──────────────────────────────────────

  it('a student added to a group after publishing, into a lesson at the time of one they have: refused with the clash; going ahead anyway records it and lists it until it no longer happens', async () => {
    const add = (anyway?: boolean) => coordinator.api.v1.scheduling.groups[':id'].members.$post({ param: { id: gid['Physics R']! }, json: { studentIds: [s['4']!.studentId], startsOn: D0, anyway } });
    const r = await refused(add());
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/^In the published timetable, this would add a clash: Student rev-4 would be in Arabic R R-11B and Physics R at Sunday period 1 from Sunday,? \d+ October \d{4} \(R — first\)\. Change it, or confirm to go ahead anyway/);
    expect(await sql(`select id from teaching_group_member where group_id = $1 and student_id = $2`, [gid['Physics R'], s['4']!.studentId])).toEqual([]);

    const went = await apiResponse(add(true));
    expect(went).toMatchObject({ added: 1, clashesAccepted: [expect.stringMatching(/^Student rev-4 would be in Arabic R R-11B and Physics R at Sunday period 1/)] });
    const listed = await clashes();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ kind: 'students_busy', person: 'Student rev-4', fromDate: D0, cause: 'Added to Physics R', stillHappens: true });
    // The published timetable shows it as it is: two lessons at once that Sunday.
    expect((await dayOf('4', D0)).lessons.filter((l) => l.period === 1).map((l) => l.groupName).sort()).toEqual(['Arabic R R-11B', 'Physics R']);

    // The coordinator takes the student out again from the next day: the clash is listed as over from then.
    await apiResponse(coordinator.api.v1.scheduling.groups[':id'].members.end.$post({ param: { id: gid['Physics R']! }, json: { studentIds: [s['4']!.studentId], endedOn: plus(D0, 6), reason: 'back to one lesson at a time' } }));
    clockAt(plus(D0, 1));
    try {
      expect((await clashes())[0]).toMatchObject({ stillHappens: false });
    } finally {
      setClockForTests(null);
    }
  });

  it('a merge, a section move, forming from the enrolment and a teacher change are checked the same way; a split is checked and says the published timetable has no lessons for its groups', async () => {
    const prefix = /^In the published timetable, this would add a clash: /;
    // Merging Physics R2 into Physics R puts its student into Sunday P1, where their section has Arabic.
    const merge = await refused(coordinator.api.v1.scheduling.groups.merge.$post({ json: { intoGroupId: gid['Physics R']!, groupIds: [gid['Physics R2']!], startsOn: D0 } }));
    expect(merge).toEqual({ status: 409, error: expect.stringMatching(prefix) });
    expect(merge.error).toContain('Student rev-3 would be in Arabic R R-11B and Physics R at Sunday period 1');
    expect(await one(`select archived_on from teaching_group where id = $1`, [gid['Physics R2']])).toEqual({ archived_on: null });

    // Moving a student into the other section: its Arabic is at the time of their Physics.
    const move = await refused(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s11b }, json: { studentIds: [s['2']!.studentId], startsOn: D0 } }));
    expect(move).toEqual({ status: 409, error: expect.stringMatching(prefix) });
    expect(move.error).toContain('Student rev-2 would be in Arabic R R-11B and Physics R at Sunday period 1');
    expect(await sql(`select section_id, ended_on from section_membership where student_id = $1`, [s['2']!.studentId])).toEqual([{ section_id: s11a, ended_on: null }]);

    // Forming from the enrolment: a new Physics enrolment with Physics R's teacher would join it.
    await apiResponse(coordinator.api.v1.enrolments.$post({ json: { academicYearId: yearId, studentId: s['7']!.studentId, subjectId: phys, teacherId: t.a!.id, mode: 'in_school' } }));
    const form = await refused(coordinator.api.v1.scheduling.groups.form.$post({ json: { academicYearId: yearId, commit: true, startsOn: D0 } }));
    expect(form).toEqual({ status: 409, error: expect.stringMatching(prefix) });
    expect(form.error).toContain('Student rev-7 would be in Arabic R R-11B and Physics R at Sunday period 1');
    expect(await sql(`select id from teaching_group_member where student_id = $1`, [s['7']!.studentId])).toEqual([]);

    // A teacher change: Arabic 11A's teacher cannot take Physics R2, which is at the same time.
    const teacher = await refused(coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: gid['Physics R2']! }, json: { teacherId: t.c!.id, teacherFrom: D0 } }));
    expect(teacher).toEqual({ status: 409, error: expect.stringMatching(/^In the published timetable, this would add a clash: teacher rev-c would teach Arabic R R-11A and Physics R2 at Sunday period 2/) });
    expect(await one(`select teacher_id from teaching_group where id = $1`, [gid['Physics R2']])).toEqual({ teacher_id: t.d!.id });

    // A split: its new groups are in no published timetable, so it adds no clash — and says so.
    const split = await apiResponse(coordinator.api.v1.scheduling.groups[':id'].split.$post({ param: { id: gid['Chemistry R']! }, json: { parts: [{ name: 'Chemistry R2', teacherId: t.b!.id, studentIds: [s['6']!.studentId] }], startsOn: D0 } }));
    expect(split).toMatchObject({ clashesAccepted: [], notInPublishedTimetable: true });
    gid['Chemistry R2'] = split.groups[0]!.id;
  });

  // ─── Flag 7: a group's teacher from a date ─────────────────────────────────

  it("a group's teacher changes from a date: earlier weeks keep their teacher; the views, the class list and cover read the teacher on the lesson's date", async () => {
    const D2 = plus(D0, 14);
    await apiResponse(coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: gid['Physics R2']! }, json: { teacherId: t.e!.id, teacherFrom: D2 } }));
    expect(await sql(`select teacher_id, started_on, ended_on from teaching_group_teacher where group_id = $1 order by started_on`, [gid['Physics R2']]))
      .toEqual([{ teacher_id: t.d!.id, started_on: `${Y}-09-06`, ended_on: plus(D2, -1) }, { teacher_id: t.e!.id, started_on: D2, ended_on: null }]);
    // The student's week: the old teacher before, the new one after.
    expect((await dayOf('3', D0)).lessons.find((l) => l.groupName === 'Physics R2')!.teacher).toMatchObject({ id: t.d!.id });
    expect((await dayOf('3', D2)).lessons.find((l) => l.groupName === 'Physics R2')!.teacher).toMatchObject({ id: t.e!.id });
    // Each teacher's own week.
    expect((await teacherDay('d', D0)).lessons.map((l) => l.groupName)).toEqual(['Physics R2']);
    expect((await teacherDay('d', D2)).lessons).toEqual([]);
    expect((await teacherDay('e', D2)).lessons.map((l) => l.groupName)).toEqual(['Physics R2']);
    // The class list: each teacher reaches it on their own dates only.
    const lesson = await lessonOf(v1, 'Physics R2');
    expect((await apiResponse(t.d!.c.api.v1.schedule.lesson.$get({ query: { lessonId: lesson.id, date: D0 } }))).access).toBe('teacher');
    expect((await refused(t.d!.c.api.v1.schedule.lesson.$get({ query: { lessonId: lesson.id, date: D2 } }))).status).toBe(404);
    expect((await apiResponse(t.e!.c.api.v1.schedule.lesson.$get({ query: { lessonId: lesson.id, date: D2 } }))).access).toBe('teacher');
    // Cover on D2 rests on the absence of the teacher then (not the one before).
    await apiResponse(coordinator.api.v1.cover.absences.$post({ json: { teacherId: t.d!.id, startsOn: D2, endsOn: D2, reason: 'training' } }));
    expect(await refused(coordinator.api.v1.cover.assignments.$post({ json: { lessonId: lesson.id, date: D2, cancel: true } })))
      .toEqual({ status: 409, error: 'teacher rev-e is not recorded as away then — record the absence first' });
    // A change dated before the current teacher began would rewrite a week already theirs.
    expect((await refused(coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: gid['Physics R2']! }, json: { teacherId: t.b!.id, teacherFrom: D0 } }))).error)
      .toMatch(/^The new teacher's first day must be on or after Sunday,? \d+ October/);
  });

  // ─── Flags 1, 2, 8: cover when things change ───────────────────────────────

  it('publishing a new version carries cover over to the same lesson, or removes it and tells the cover teacher and the class; a teacher covers only what is in force', async () => {
    const D3 = plus(D0, 21);
    const D4 = plus(D0, 28);
    await apiResponse(coordinator.api.v1.cover.absences.$post({ json: { teacherId: t.a!.id, startsOn: D3, endsOn: D4, reason: 'sick' } }));
    const p1 = await lessonOf(v1, 'Physics R');
    await apiResponse(coordinator.api.v1.cover.assignments.$post({ json: { lessonId: p1.id, date: D3, coverTeacherId: t.e!.id } }));
    await apiResponse(coordinator.api.v1.cover.assignments.$post({ json: { lessonId: p1.id, date: D4, coverTeacherId: t.d!.id } }));

    // A second version, the same Physics R: both covers move to it.
    const v2 = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'R — second', copyFromId: v1 } }))).id;
    await place(v2, 'Chemistry R2', 1, 2); // the group split off after the first version
    const pub2 = await apiResponse(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: v2 }, json: { effectiveFrom: D3 } }));
    expect(pub2.coversMoved.map((c) => c.date)).toEqual([D3, D4]);
    expect(pub2.coversRemoved).toEqual([]);
    const p2 = await lessonOf(v2, 'Physics R');
    expect(await sql(`select date, lesson_id, timetable_id, status from cover_assignment where group_id = $1 and date in ($2, $3) order by date`, [gid['Physics R'], D3, D4]))
      .toEqual([{ date: D3, lesson_id: p2.id, timetable_id: v2, status: 'assigned' }, { date: D4, lesson_id: p2.id, timetable_id: v2, status: 'assigned' }]);

    // A third, from D4, with Physics R at period 3: the D4 cover has no lesson to go to — removed, and people told.
    const v3 = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'R — third', copyFromId: v2 } }))).id;
    await place(v3, 'Physics R', 0, 3);
    const pub3 = await apiResponse(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: v3 }, json: { effectiveFrom: D4 } }));
    expect(pub3.coversMoved).toEqual([]);
    expect(pub3.coversRemoved).toEqual([expect.objectContaining({ date: D4, groupName: 'Physics R', cover: 'teacher rev-d' })]);
    expect(await one(`select status, removal from cover_assignment where group_id = $1 and date = $2`, [gid['Physics R'], D4])).toEqual({ status: 'removed', removal: 'timetable_changed' });
    const told = await notified('teacher.rev-d@test.local', 'COVER_CHANGED', 1);
    expect(told[0]!.body).toMatch(/^You no longer cover Physics R on Sunday,? .*, period 1: the timetable changes from Sunday,?/);
    for (const k of ['1', '2', '5']) expect((await notified(`student.rev-${k}@test.local`, 'COVER_CHANGED', 1))[0]!.body).toMatch(/the timetable changes from .*, so the arrangement made for this lesson no longer applies/);
    // The day as it now is: Physics R at period 3, its teacher away and nothing arranged; the former cover teacher covers nothing.
    expect((await dayOf('1', D4)).lessons.find((l) => l.groupName === 'Physics R')).toMatchObject({ period: 3, status: 'uncovered' });
    expect((await teacherDay('d', D4)).lessons).toEqual([]);
    // The D3 cover still stands on the version in force that day.
    expect((await teacherDay('e', D3)).lessons.map((l) => [l.groupName, l.status])).toEqual([['Physics R', 'covering'], ['Physics R2', 'scheduled']]);
  });

  it('a teacher who covers is then recorded away: the lesson needs new cover and its class is told; removing a cover and withdrawing an absence tell the class and the cover teacher', async () => {
    const D3 = plus(D0, 21);
    const rec = await apiResponse(coordinator.api.v1.cover.absences.$post({ json: { teacherId: t.e!.id, startsOn: D3, endsOn: D3, reason: 'sick' } }));
    expect(rec.coversLost.map((c) => [c.date, c.groupName, c.cover])).toEqual([[D3, 'Physics R', 'teacher rev-e']]);
    expect(await one(`select status, removal from cover_assignment where group_id = $1 and date = $2 and cover_teacher_id = $3`, [gid['Physics R'], D3, t.e!.id]))
      .toEqual({ status: 'removed', removal: 'cover_teacher_away' });
    expect((await dayOf('1', D3)).lessons.find((l) => l.groupName === 'Physics R')).toMatchObject({ status: 'uncovered', teacher: null, needsNewCover: true });
    expect((await notified('student.rev-1@test.local', 'COVER_CHANGED', 2))[1]!.body).toMatch(/^Physics R on Sunday,? .*: teacher rev-e cannot take it after all; new cover is being arranged\.$/);

    // New cover, then removed by hand: the cover teacher and the class are told.
    const v2lesson = (await dayOf('1', D3)).lessons.find((l) => l.groupName === 'Physics R')!.lessonId;
    const again = await apiResponse(coordinator.api.v1.cover.assignments.$post({ json: { lessonId: v2lesson, date: D3, coverTeacherId: t.d!.id } }));
    await apiResponse(coordinator.api.v1.cover.assignments[':id'].remove.$post({ param: { id: again.id }, json: { reason: 'a colleague swapped' } }));
    expect((await notified('teacher.rev-d@test.local', 'COVER_CHANGED', 2))[1]!.body).toMatch(/^You no longer cover Physics R on Sunday,? .*: the arrangement was changed\.$/);
    expect((await notified('student.rev-1@test.local', 'COVER_CHANGED', 3))[2]!.body).toMatch(/^Physics R on Sunday,? .*: the arrangement made for this lesson was changed\. Look at your timetable for that day\.$/);

    // Cover once more, then the teacher is not away after all: the covers go and people are told.
    await apiResponse(coordinator.api.v1.cover.assignments.$post({ json: { lessonId: v2lesson, date: D3, coverTeacherId: t.d!.id } }));
    const [abs] = await sql<{ id: string }>(`select id from teacher_absence where teacher_id = $1 and starts_on = $2 and cancelled_at is null`, [t.a!.id, D3]);
    expect(await apiResponse(coordinator.api.v1.cover.absences[':id'].cancel.$post({ param: { id: abs!.id }, json: { reason: 'came in after all' } }))).toMatchObject({ coversRemoved: 1 });
    expect((await notified('teacher.rev-d@test.local', 'COVER_CHANGED', 3))[2]!.body).toMatch(/: teacher rev-a is not away after all\.$/);
    expect((await notified('student.rev-1@test.local', 'COVER_CHANGED', 4))[3]!.body).toMatch(/^Physics R on Sunday,? .* takes place with teacher rev-a after all\.$/);
    expect((await dayOf('1', D3)).lessons.find((l) => l.groupName === 'Physics R')).toMatchObject({ status: 'scheduled', teacher: { id: t.a!.id } });
  });

  // ─── Flag 5: today inside a term ───────────────────────────────────────────

  it('today inside a term (the test clock): a version takes effect today or later; a leaving part-way through a membership; a group retired by today leaves the drafts; the version in force today', async () => {
    const T = plus(D0, 3); // a Wednesday
    clockAt(T);
    try {
      // Publishing from yesterday is refused; from today it is taken.
      const draft = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'R — from today', copyFromId: v1 } }))).id;
      expect((await refused(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: draft }, json: { effectiveFrom: plus(T, -1) } }))).error)
        .toMatch(/^A timetable takes effect today or later \(today is Wednesday,? \d+ (?:October|November) \d{4}\): what has been taught is not rewritten$/);

      // The version in force today, then after each later version takes effect.
      const inForce = async () => (await apiResponse(coordinator.api.v1.timetables.$get({ query: { termId } }))).filter((v) => v.inForce).map((v) => v.name);
      expect(await inForce()).toEqual(['R — first']);
      clockAt(plus(D0, 22));
      expect(await inForce()).toEqual(['R — second']);
      clockAt(plus(D0, 29));
      expect(await inForce()).toEqual(['R — third']);
      clockAt(T);

      // A student leaves today, part-way through their groups: in the class that Sunday, not the next.
      const physics = await lessonOf(v1, 'Physics R');
      expect(await classOf(physics.id, D0)).toContain(s['5']!.studentId);
      await apiResponse(coordinator.api.v1.students[':id'].leave.$post({ param: { id: s['5']!.studentId }, json: { kind: 'withdrawn', leftOn: T, reason: 'moved abroad' } }));
      expect(await one(`select ended_on, end_reason from teaching_group_member where group_id = $1 and student_id = $2`, [gid['Physics R'], s['5']!.studentId]))
        .toEqual({ ended_on: T, end_reason: 'Left the school (withdrawn)' });
      expect(await classOf(physics.id, D0)).toContain(s['5']!.studentId);
      expect(await classOf(physics.id, plus(D0, 7))).not.toContain(s['5']!.studentId);
      expect(await dayOf('5', plus(D0, 7))).toMatchObject({ note: 'left', lessons: [] });

      // Retired today: out of the drafts of the term under way; retired later: still in them until then.
      const retiring = await apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: yearId, name: 'Retiring R', weeklyPeriods: 1, doublePeriods: 0 } }));
      const later = await apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: yearId, name: 'Retiring later R', weeklyPeriods: 1, doublePeriods: 0 } }));
      const cardsOf = async (groupId: string) => (await load(draft)).engine.lessons.filter((l) => l.groupId === groupId).length;
      expect([await cardsOf(retiring.id), await cardsOf(later.id)]).toEqual([1, 1]);
      await apiResponse(coordinator.api.v1.scheduling.groups[':id'].archive.$post({ param: { id: retiring.id }, json: { archivedOn: T, reason: 'not running' } }));
      await apiResponse(coordinator.api.v1.scheduling.groups[':id'].archive.$post({ param: { id: later.id }, json: { archivedOn: plus(T, 30), reason: 'ends in November' } }));
      expect([await cardsOf(retiring.id), await cardsOf(later.id)]).toEqual([0, 1]);
      await apiResponse(coordinator.api.v1.timetables[':id'].$delete({ param: { id: draft } }));
    } finally {
      setClockForTests(null);
    }
  });

  // ─── Flag 12 ───────────────────────────────────────────────────────────────

  it('readmission keeps the leaving: the days away still say so, and a section begun after the leaving never begins; an extra school day with no lessons that weekday says why', async () => {
    const T2 = plus(D0, 10); // a Wednesday
    const F = plus(D0, 35);  // a Sunday, after the leaving
    clockAt(T2);
    try {
      // A move into R-11A from F, made before the student leaves on T2.
      await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: s11a }, json: { studentIds: [s['6']!.studentId], startsOn: F } }));
      await apiResponse(coordinator.api.v1.students[':id'].leave.$post({ param: { id: s['6']!.studentId }, json: { kind: 'withdrawn', leftOn: T2, reason: 'family moved' } }));
      expect(await sql(`select s.name, m.started_on, m.ended_on from section_membership m join section s on s.id = m.section_id where m.student_id = $1 order by m.started_on`, [s['6']!.studentId]))
        .toEqual([{ name: 'R-11B', started_on: `${Y}-09-06`, ended_on: plus(F, -1) }, { name: 'R-11A', started_on: F, ended_on: F }]);
      clockAt(plus(T2, 7));
      await apiResponse(adm.api.v1.students[':id'].readmit.$post({ param: { id: s['6']!.studentId }, json: { reason: 'came back' } }));
      expect(await one(`select left_on, readmitted_on from student_leaving where student_id = $1`, [s['6']!.studentId])).toEqual({ left_on: T2, readmitted_on: plus(T2, 7) });
      // Away between: "left". Back: no class until placed again. The section F0a clamped to one day is not begun.
      expect(await dayOf('6', plus(T2, 4))).toMatchObject({ note: 'left', lessons: [] });
      const arabic = await lessonOf(v1, 'Arabic R R-11A');
      expect(await classOf((await dayOf('1', F)).lessons.find((l) => l.groupName === 'Arabic R R-11A')!.lessonId, F)).not.toContain(s['6']!.studentId);
      expect((await dayOf('6', F)).lessons).toEqual([]);
      expect(arabic).toBeTruthy();
    } finally {
      setClockForTests(null);
    }

    // A Saturday made a school day: the weekly timetable has no Saturday.
    const saturday = plus(D0, 6);
    await apiResponse(coordinator.api.v1.academic.calendar.$post({ json: { academicYearId: yearId, kind: 'school_day', name: 'Make-up day', startsOn: saturday, endsOn: saturday } }));
    expect(await dayOf('1', saturday)).toMatchObject({ kind: 'extra_school_day', isSchoolDay: true, note: 'extra_day', lessons: [] });
  });

  it('the accepted clash is the only double booking in these published timetables', async () => {
    const rows = await sql<{ student_id: string }>(`select student_id from published_clash pc join timetable t on t.id = pc.timetable_id where t.academic_year_id = $1`, [yearId]);
    expect(rows.map((r) => r.student_id)).toEqual([s['4']!.studentId]);
    expect(await notificationsFor('teacher.rev-c@test.local', 'COVER_CHANGED')).toEqual([]);
  });
});
