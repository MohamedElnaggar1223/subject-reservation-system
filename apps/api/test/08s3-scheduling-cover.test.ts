import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import { admin, staff, onboard, subject, refused, one, sql, notified, notificationsFor, audited, type Client } from './helpers';

/**
 * F1 — cover (FEATURES_PLAN.md F1, "Cover"): a teacher away for a day, a
 * range or some periods; the lessons that leaves; free, qualified teachers
 * suggested (qualified = linked to the subject); an unqualified or busy
 * teacher refused; cover assigned (the cover teacher and the class told) or
 * the lesson cancelled; the cover teacher reaching that lesson on that date
 * only; the log and the report.
 */

const Y = academicYearStartOf() + 22;
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

describe('F1: cover', () => {
  let adm: Client, coordinator: Client, officer: Client;
  const t: Record<string, { c: Client; id: string }> = {};
  let yearId: string, termId: string, ttId: string, phys: string, chem: string;
  let a: { parent: Client; student: Client; studentId: string }, b: { parent: Client; student: Client; studentId: string };
  let L1: string, L2: string;
  const D = onOrAfter(`${Y}-10-04`, 0);        // a Sunday
  const TUE = plus(D, 2);

  const suggestions = (lessonId: string, date: string) => apiResponse(coordinator.api.v1.cover.suggestions.$get({ query: { lessonId, date } }));
  const assign = (json: { lessonId: string; date: string; coverTeacherId?: string | null; cancel?: boolean; note?: string }) => coordinator.api.v1.cover.assignments.$post({ json });

  beforeAll(async () => {
    adm = await admin('cov');
    coordinator = await staff(adm, 'coordinator', 'cov');
    officer = await staff(adm, 'finance_officer', 'cov');
    for (const k of ['away', 'free', 'busy', 'unq', 'ill', 'full']) {
      const c = await staff(adm, 'teacher', `cov-${k}`);
      t[k] = { c, id: (await one<{ id: string }>(`select id from teacher where user_id = $1`, [c.id])).id };
    }
    yearId = (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }))).id;
    termId = (await apiResponse(coordinator.api.v1.academic.terms.$post({ json: { academicYearId: yearId, name: 'Term 1', startsOn: `${Y}-09-06`, endsOn: `${Y}-12-20` } }))).id;
    const bells = await apiResponse(coordinator.api.v1.academic['bell-schedules'].$post({ json: { academicYearId: yearId, name: 'Regular', isDefault: true } }));
    await apiResponse(coordinator.api.v1.academic['bell-schedules'][':id'].periods.$put({
      param: { id: bells.id },
      json: { periods: [
        { weekday: null, label: 'P1', kind: 'lesson', startsAt: '08:00', endsAt: '08:45' },
        { weekday: null, label: 'P2', kind: 'lesson', startsAt: '08:45', endsAt: '09:30' },
        { weekday: null, label: 'P3', kind: 'lesson', startsAt: '09:45', endsAt: '10:30' },
        { weekday: null, label: 'P4', kind: 'lesson', startsAt: '10:30', endsAt: '11:15' },
      ] },
    }));
    phys = await subject(adm, 'F1C-PHY', 'Physics S3', { course: 1000, registration: 400 });
    chem = await subject(adm, 'F1C-CHE', 'Chemistry S3', { course: 1000, registration: 400 });
    a = await onboard(officer, 'cov-a', 11);
    b = await onboard(officer, 'cov-b', 11);
    for (const s of [a, b]) {
      await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: s.studentId }, json: { cohortYear: Y - 1, reason: 'F1 cover scenario year' } }));
      await apiResponse(coordinator.api.v1.enrolments.$post({ json: { academicYearId: yearId, studentId: s.studentId, subjectId: phys, teacherId: t.away!.id, mode: 'in_school' } }));
    }
    await apiResponse(coordinator.api.v1.scheduling.groups.form.$post({ json: { academicYearId: yearId, commit: true, weeklyPeriods: 2 } }));
    // Other teachers' own groups: each links its teacher to its subject (as the Subjects page would).
    const mk = (name: string, teacherId: string, subjectId: string, weeklyPeriods: number) =>
      apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: yearId, name, subjectId, teacherId, weeklyPeriods, doublePeriods: 0 } }));
    await mk('Physics S3 extra', t.busy!.id, phys, 1);
    await mk('Physics S3 lab', t.free!.id, phys, 1);
    await mk('Chemistry S3', t.unq!.id, chem, 1);
    await mk('Physics S3 club', t.ill!.id, phys, 1);
    await mk('Physics S3 revision', t.full!.id, phys, 2);
    await apiResponse(coordinator.api.v1.scheduling.rules.teachers[':teacherId'].$put({ param: { teacherId: t.full!.id }, json: { academicYearId: yearId, maxPerDay: 2, maxPerWeek: null, unavailable: [] } }));

    ttId = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'Term 1' } }))).id;
    const tt = await apiResponse(coordinator.api.v1.timetables[':id'].$get({ param: { id: ttId } }));
    const lesson = (name: string, seq: number) => tt.engine.lessons.find((l) => l.groupId === tt.groups.find((g) => g.name === name)!.id && l.seq === seq)!;
    const place = (name: string, seq: number, weekday: number, period: number) =>
      apiResponse(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({ param: { id: ttId, lessonId: lesson(name, seq).id }, json: { weekday, period, from: { weekday: null, period: null } } }));
    await place('Physics S3', 1, 0, 1);          // Sunday P1 — the lesson to cover
    await place('Physics S3', 2, 2, 3);          // Tuesday P3
    await place('Physics S3 extra', 1, 0, 1);    // busy at Sunday P1
    await place('Physics S3 lab', 1, 1, 1);      // free on Sunday
    await place('Chemistry S3', 1, 1, 2);        // free on Sunday, not a Physics teacher
    await place('Physics S3 club', 1, 3, 1);     // free on Sunday, but away that day
    await place('Physics S3 revision', 1, 0, 2); // two lessons on Sunday: a third would pass the limit
    await place('Physics S3 revision', 2, 0, 3);
    await apiResponse(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: ttId }, json: { effectiveFrom: `${Y}-09-06` } }));
    L1 = lesson('Physics S3', 1).id;
    L2 = lesson('Physics S3', 2).id;
  }, 120_000);

  it('a teacher away for a day: the lessons it leaves, then a range of days, then some periods of one day', async () => {
    const one = await apiResponse(coordinator.api.v1.cover.absences.$post({ json: { teacherId: t.away!.id, startsOn: D, endsOn: D, reason: 'sick' } }));
    expect(one.lessons.map((l) => [l.date, l.lesson.groupName, l.lesson.label, l.lesson.status])).toEqual([[D, 'Physics S3', 'P1', 'uncovered']]);
    // The same day again is refused (change that absence instead).
    expect((await refused(coordinator.api.v1.cover.absences.$post({ json: { teacherId: t.away!.id, startsOn: D, endsOn: D, reason: 'sick' } }))).status).toBe(409);
    // A range: the next week's Sunday and Tuesday.
    const range = await apiResponse(coordinator.api.v1.cover.absences.$post({ json: { teacherId: t.away!.id, startsOn: plus(D, 7), endsOn: plus(D, 9), reason: 'training' } }));
    expect(range.lessons.map((l) => [l.date, l.lesson.label])).toEqual([[plus(D, 7), 'P1'], [plus(D, 9), 'P3']]);
    // Some periods of one day: only period 1 on a Tuesday touches nothing (Physics is at period 3).
    const periods = await apiResponse(coordinator.api.v1.cover.absences.$post({ json: { teacherId: t.away!.id, startsOn: plus(TUE, 14), endsOn: plus(TUE, 14), periods: [1], reason: 'personal' } }));
    expect(periods.lessons).toEqual([]);
    const withP3 = await apiResponse(coordinator.api.v1.cover.absences.$post({ json: { teacherId: t.away!.id, startsOn: plus(TUE, 21), endsOn: plus(TUE, 21), periods: [3], reason: 'personal' } }));
    expect(withP3.lessons.map((l) => l.lesson.label)).toEqual(['P3']);
    // The fifth teacher is away on the Sunday too.
    await apiResponse(coordinator.api.v1.cover.absences.$post({ json: { teacherId: t.ill!.id, startsOn: D, endsOn: D, reason: 'sick' } }));
    await audited([one.id], ['TEACHER_ABSENCE_RECORDED']);
    // The student sees the lesson waiting for cover.
    const day = await apiResponse(a.student.api.v1.schedule.me.day.$get({ query: { date: D } }));
    expect(day.lessons.find((l) => l.lessonId === L1)).toMatchObject({ status: 'uncovered', teacher: null, scheduledTeacher: { id: t.away!.id } });
  });

  it('suggestions: free and qualified first; the busy, the away, the one at their daily limit and the unqualified each with the reason', async () => {
    const s = await suggestions(L1, D);
    expect(s.lesson).toMatchObject({ groupName: 'Physics S3', subject: 'Physics S3', label: 'P1' });
    expect(s.candidates[0]).toMatchObject({ teacherId: t.free!.id, qualified: true, available: true, reasons: [] });
    const of = (k: string) => s.candidates.find((c) => c.teacherId === t[k]!.id)!;
    expect(of('busy')).toMatchObject({ qualified: true, available: false, reasons: ['teaches Physics S3 extra then'] });
    expect(of('ill')).toMatchObject({ qualified: true, available: false, reasons: ['is away that day'] });
    expect(of('full')).toMatchObject({ qualified: true, available: false, reasons: ['would teach more than 2 periods that day'], lessonsThatDay: 2 });
    expect(of('unq')).toMatchObject({ qualified: false, available: true, reasons: ['does not teach Physics S3'] });
    expect(s.candidates.some((c) => c.teacherId === t.away!.id)).toBe(false);
    // Free and qualified come before the free but unqualified.
    const firstUnqualified = s.candidates.findIndex((c) => !c.qualified);
    expect(s.candidates.slice(0, firstUnqualified).every((c) => c.qualified)).toBe(true);
  });

  it('a cover assignment refusing an unqualified or busy teacher; then assigned, the cover teacher and the class told', async () => {
    const before = await sql(`select id from cover_assignment where lesson_id = $1`, [L1]);
    expect(await refused(assign({ lessonId: L1, date: D, coverTeacherId: t.unq!.id }))).toEqual({ status: 409, error: 'teacher cov-unq does not teach Physics S3 — choose a teacher linked to the subject' });
    expect(await refused(assign({ lessonId: L1, date: D, coverTeacherId: t.busy!.id }))).toEqual({ status: 409, error: 'teacher cov-busy teaches Physics S3 extra then' });
    expect(await refused(assign({ lessonId: L1, date: D, coverTeacherId: t.ill!.id }))).toEqual({ status: 409, error: 'teacher cov-ill is away that day' });
    expect(await refused(assign({ lessonId: L1, date: D, coverTeacherId: t.full!.id }))).toEqual({ status: 409, error: 'teacher cov-full would teach more than 2 periods that day' });
    expect(await refused(assign({ lessonId: L1, date: D, coverTeacherId: t.away!.id }))).toEqual({ status: 409, error: "teacher cov-away is the lesson's own teacher" });
    // A lesson whose teacher is not recorded as away takes no cover.
    expect(await refused(assign({ lessonId: L1, date: plus(D, 14), coverTeacherId: t.free!.id }))).toEqual({ status: 409, error: 'teacher cov-away is not recorded as away then — record the absence first' });
    // Not a date the lesson takes place.
    expect((await refused(assign({ lessonId: L1, date: plus(D, 1), coverTeacherId: t.free!.id }))).status).toBe(404);
    expect(await sql(`select id from cover_assignment where lesson_id = $1`, [L1])).toEqual(before);

    const made = await apiResponse(assign({ lessonId: L1, date: D, coverTeacherId: t.free!.id, note: 'set work in the folder' }));
    expect(made).toMatchObject({ status: 'assigned', coverTeacherId: t.free!.id });
    expect((await notified('teacher.cov-free@test.local', 'COVER_ASSIGNED', 1))[0]!.body).toMatch(/^You are covering Physics S3 on Sunday, .*, P1\.$/);
    for (const tag of ['cov-a', 'cov-b']) {
      expect((await notified(`student.${tag}@test.local`, 'LESSON_COVERED', 1))[0]!.body).toMatch(/^teacher cov-free takes Physics S3 on Sunday, .*, P1\.$/);
    }
    expect((await refused(assign({ lessonId: L1, date: D, coverTeacherId: t.free!.id }))).error).toBe('This lesson already has cover arranged — remove it first to change it');
    await audited([made.id], ['COVER_ASSIGNED']);

    // Everyone's day shows it.
    expect((await apiResponse(a.student.api.v1.schedule.me.day.$get({ query: { date: D } }))).lessons.find((l) => l.lessonId === L1))
      .toMatchObject({ status: 'covered', teacher: { id: t.free!.id }, scheduledTeacher: { id: t.away!.id } });
    expect((await apiResponse(t.free!.c.api.v1.schedule.me.day.$get({ query: { date: D } }))).lessons.find((l) => l.lessonId === L1)).toMatchObject({ status: 'covering' });
    expect((await apiResponse(t.away!.c.api.v1.schedule.me.day.$get({ query: { date: D } }))).lessons.find((l) => l.lessonId === L1)).toMatchObject({ status: 'covered_by_other', teacher: { id: t.free!.id } });
  });

  it('a cover teacher reaches the covered lesson on its date only', async () => {
    const list = await apiResponse(t.free!.c.api.v1.schedule.lesson.$get({ query: { lessonId: L1, date: D } }));
    expect(list.access).toBe('cover');
    expect(list.students.map((s) => s.id).sort()).toEqual([a.studentId, b.studentId].sort());
    expect(list.lesson).toMatchObject({ groupName: 'Physics S3', label: 'P1', status: 'covered', teacher: { id: t.free!.id } });
    // The same lesson a week later, and the group's other lesson, are not theirs.
    expect(await refused(t.free!.c.api.v1.schedule.lesson.$get({ query: { lessonId: L1, date: plus(D, 7) } }))).toEqual({ status: 404, error: 'Lesson not found on that date' });
    expect(await refused(t.free!.c.api.v1.schedule.lesson.$get({ query: { lessonId: L2, date: TUE } }))).toEqual({ status: 404, error: 'Lesson not found on that date' });
    // The lesson's own teacher, and the coordinator, read it on any date it takes place.
    expect((await apiResponse(t.away!.c.api.v1.schedule.lesson.$get({ query: { lessonId: L1, date: plus(D, 7) } }))).access).toBe('teacher');
    expect((await apiResponse(coordinator.api.v1.schedule.lesson.$get({ query: { lessonId: L2, date: TUE } }))).access).toBe('staff');
  });

  it('a lesson cancelled instead: the class told; cover removed and given again; the log and the report', async () => {
    const tuesday = plus(D, 9);
    const cancelled = await apiResponse(assign({ lessonId: L2, date: tuesday, cancel: true, note: 'no one free' }));
    expect(cancelled.status).toBe('cancelled');
    for (const tag of ['cov-a', 'cov-b']) {
      expect((await notified(`student.${tag}@test.local`, 'LESSON_CANCELLED', 1))[0]!.body).toMatch(/^Physics S3 on Tuesday, .*, P3 does not take place\.$/);
    }
    expect((await apiResponse(b.parent.api.v1.schedule.day.$get({ query: { studentId: b.studentId, date: tuesday } }))).lessons.find((l) => l.lessonId === L2))
      .toMatchObject({ status: 'cancelled', teacher: null });

    // The Sunday of that week: cover given, removed, given again.
    const sunday = plus(D, 7);
    const first = await apiResponse(assign({ lessonId: L1, date: sunday, coverTeacherId: t.free!.id }));
    await apiResponse(coordinator.api.v1.cover.assignments[':id'].remove.$post({ param: { id: first.id }, json: { reason: 'swapped with a colleague' } }));
    expect((await apiResponse(a.student.api.v1.schedule.me.day.$get({ query: { date: sunday } }))).lessons.find((l) => l.lessonId === L1)).toMatchObject({ status: 'uncovered' });
    await apiResponse(assign({ lessonId: L1, date: sunday, coverTeacherId: t.free!.id }));
    expect(await notificationsFor('teacher.cov-free@test.local', 'COVER_ASSIGNED')).toHaveLength(3);

    const log = await apiResponse(coordinator.api.v1.cover.log.$get({ query: { from: D, to: plus(D, 30) } }));
    expect(log.map((r) => [r.date, r.groupName, r.status, r.coverTeacher])).toEqual([
      [D, 'Physics S3', 'assigned', 'teacher cov-free'],
      [sunday, 'Physics S3', 'removed', 'teacher cov-free'],
      [sunday, 'Physics S3', 'assigned', 'teacher cov-free'],
      [tuesday, 'Physics S3', 'cancelled', null],
    ]);
    const report = await apiResponse(coordinator.api.v1.cover.report.$get({ query: { from: D, to: plus(D, 30) } }));
    const away = report.rows.find((r) => r.teacherId === t.away!.id)!;
    expect(away).toMatchObject({ absences: 4, daysAway: 4, lessonsMissed: 4, covered: 2, cancelled: 1, uncovered: 1, coversGiven: 0 });
    expect(report.rows.find((r) => r.teacherId === t.free!.id)).toMatchObject({ absences: 0, coversGiven: 2 });
    const csv = await (await coordinator.api.v1.cover.report.csv.$get({ query: { from: D, to: plus(D, 30) } })).text();
    expect(csv.split('\n')[0]).toBe('Teacher,Absences,Days away,Lessons missed,Covered,Cancelled,Uncovered,Covers given');
    expect(csv).toContain('teacher cov-away,4,4,4,2,1,1,0');
  });

  it('an absence withdrawn takes its covers with it (kept as history)', async () => {
    const [abs] = await sql<{ id: string }>(`select id from teacher_absence where teacher_id = $1 and starts_on = $2`, [t.away!.id, D]);
    const r = await apiResponse(coordinator.api.v1.cover.absences[':id'].cancel.$post({ param: { id: abs!.id }, json: { reason: 'came in after all' } }));
    expect(r.coversRemoved).toBe(1);
    expect(await one(`select status from cover_assignment where lesson_id = $1 and date = $2`, [L1, D])).toEqual({ status: 'removed' });
    expect((await apiResponse(a.student.api.v1.schedule.me.day.$get({ query: { date: D } }))).lessons.find((l) => l.lessonId === L1))
      .toMatchObject({ status: 'scheduled', teacher: { id: t.away!.id } });
    expect((await refused(coordinator.api.v1.cover.absences[':id'].cancel.$post({ param: { id: abs!.id }, json: { reason: 'twice' } }))).status).toBe(409);
  });
});
