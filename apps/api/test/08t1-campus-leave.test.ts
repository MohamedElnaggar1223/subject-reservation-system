import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import {
  admin, staff, onboard, subject, refused, one, sql, notified, notificationsFor, audited, schoolToday, makeTodayASchoolDay, type Client,
} from './helpers';

/**
 * F2 — campus leave (FEATURES_PLAN.md F2; docs/features/CAMPUS_LEAVE.md):
 * each request path (a parent, the desk for a family, the school's own
 * decision), a recurring request, approval with what the approver needs
 * (the lessons and teachers a leave touches, the student's history, the
 * policy warnings), authorised collectors and custody restrictions, the gate
 * (today's list, a pass scanned, check-out, return), passes refused
 * (expired, forged, replaced, cancelled, another day's), cancelling before
 * check-out, history and reports, the F3 contract (getLeaveCoverage) and a
 * teacher's lessons.
 *
 * Far-future dates run in an academic year 26 years ahead with its own
 * calendar, bells and published timetable, so no other suite can move its
 * lessons. The gate's scenarios are today's (the gate works today only):
 * `beforeAll` makes today a school day whose bells run all day, so a leave
 * at any hour is inside it whatever the suite's calendar says about today.
 */

const Y = academicYearStartOf() + 26;
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
const spoken = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const png = (name: string) => new File([PNG], name, { type: 'image/png' });

type Family = { parent: Client; student: Client; studentId: string };

describe('F2: campus leave', () => {
  let adm: Client, coordinator: Client, officer: Client, gate: Client;
  let t1: Client, t2: Client;
  let A: Family, A2: Family, B: Family, G: Family, H: Family, J: Family, C: Family, F: Family;
  let yearId: string, termId: string;
  const TODAY = schoolToday();
  const D = onOrAfter(`${Y}-10-04`, 0);           // a Sunday with lessons
  const TUE = plus(D, 2);                          // the Tuesday after
  const HOL = onOrAfter(`${Y}-11-01`, 2);          // a Tuesday holiday
  const EXAM = onOrAfter(`${Y}-11-15`, 1);         // an exam-only Monday
  let aLeave: string, bLeave: string, gLeave: string;
  const put = (who: Client, key: string, value: unknown) =>
    apiResponse(who.api.v1.settings[':key'].$put({ param: { key }, json: { value, reason: 'campus leave scenario' } }));
  const leaveOf = async (id: string) => one<{ status: string; decided_by: string | null; no_show_at: Date | null }>(`select status, decided_by, no_show_at from leave_request where id = $1`, [id]);
  const request = (who: Client, json: Parameters<Client['api']['v1']['leave']['requests']['$post']>[0]['json']) => who.api.v1.leave.requests.$post({ json });

  beforeAll(async () => {
    adm = await admin('lv');
    coordinator = await staff(adm, 'coordinator', 'lv');
    officer = await staff(adm, 'finance_officer', 'lv');
    gate = await staff(adm, 'gate', 'lv');
    t1 = await staff(adm, 'teacher', 'lv-phy');
    t2 = await staff(adm, 'teacher', 'lv-che');
    const tid = async (c: Client) => (await one<{ id: string }>(`select id from teacher where user_id = $1`, [c.id])).id;
    const [t1Id, t2Id] = [await tid(t1), await tid(t2)];

    // Families: A and A2 share a parent (A's); B the desk's; G, H, J, C today's; F a father linked to H.
    A = await onboard(officer, 'lv-a', 11);
    A2 = await onboard(officer, 'lv-a2', 11);
    B = await onboard(officer, 'lv-b', 11);
    G = await onboard(officer, 'lv-g', 11);
    H = await onboard(officer, 'lv-h', 11);
    J = await onboard(officer, 'lv-j', 11);
    C = await onboard(officer, 'lv-c', 11);
    F = await onboard(officer, 'lv-hf', 11);
    for (const [p, s] of [[A.parent, A2], [F.parent, H]] as const) {
      const link = await apiResponse(p.api.v1.links.$post({ json: { studentEmail: s.student.email } }));
      await apiResponse(s.student.api.v1.links[':id'].$put({ param: { id: link!.id }, json: { status: 'approved' } }));
    }
    for (const s of [A, A2, B]) {
      await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: s.studentId }, json: { cohortYear: Y - 1, reason: 'F2 scenario year' } }));
    }

    // The far year: its term, bells (P1–P5, the day ends at 12:00), a holiday, an exam-only day, a section, a timetable.
    yearId = (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }))).id;
    termId = (await apiResponse(coordinator.api.v1.academic.terms.$post({ json: { academicYearId: yearId, name: 'Term 1', startsOn: `${Y}-09-06`, endsOn: `${Y}-12-20` } }))).id;
    const bells = await apiResponse(coordinator.api.v1.academic['bell-schedules'].$post({ json: { academicYearId: yearId, name: 'Regular', isDefault: true } }));
    await apiResponse(coordinator.api.v1.academic['bell-schedules'][':id'].periods.$put({ param: { id: bells.id }, json: { periods: [
      { weekday: null, label: 'P1', kind: 'lesson', startsAt: '08:00', endsAt: '08:45' },
      { weekday: null, label: 'P2', kind: 'lesson', startsAt: '08:45', endsAt: '09:30' },
      { weekday: null, label: 'P3', kind: 'lesson', startsAt: '09:45', endsAt: '10:30' },
      { weekday: null, label: 'P4', kind: 'lesson', startsAt: '10:30', endsAt: '11:15' },
      { weekday: null, label: 'P5', kind: 'lesson', startsAt: '11:15', endsAt: '12:00' },
    ] } }));
    await apiResponse(coordinator.api.v1.academic.calendar.$post({ json: { academicYearId: yearId, kind: 'holiday', name: 'National Day', startsOn: HOL, endsOn: HOL } }));
    await apiResponse(coordinator.api.v1.academic.calendar.$post({ json: { academicYearId: yearId, kind: 'exam_only', name: 'Mock exams', startsOn: EXAM, endsOn: EXAM } }));
    const section = await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: yearId, grade: 11, name: '11L' } }));
    await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: section.id }, json: { studentIds: [A.studentId, A2.studentId], startsOn: `${Y}-09-06` } }));
    const phys = await subject(adm, 'F2-PHY', 'Physics LV', { course: 1000, registration: 300 });
    const chem = await subject(adm, 'F2-CHE', 'Chemistry LV', { course: 1000, registration: 300 });
    const gp = await apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: yearId, name: 'LV Physics', subjectId: phys, teacherId: t1Id, weeklyPeriods: 2, doublePeriods: 0, studentIds: [A.studentId, A2.studentId], startsOn: `${Y}-09-06` } }));
    const gc = await apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: yearId, name: 'LV Chemistry', subjectId: chem, teacherId: t2Id, weeklyPeriods: 1, doublePeriods: 0, studentIds: [A.studentId], startsOn: `${Y}-09-06` } }));
    const tt = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'LV' } }))).id;
    const editor = await apiResponse(coordinator.api.v1.timetables[':id'].$get({ param: { id: tt } }));
    const lesson = (g: string, seq: number) => editor.engine.lessons.find((l) => l.groupId === g && l.seq === seq)!.id;
    for (const [lessonId, weekday, period] of [[lesson(gp.id, 1), 0, 3], [lesson(gp.id, 2), 0, 4], [lesson(gc.id, 1), 0, 1]] as const) {
      await apiResponse(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({ param: { id: tt, lessonId }, json: { weekday, period, from: { weekday: null, period: null } } }));
    }
    await apiResponse(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: tt }, json: { effectiveFrom: `${Y}-09-06` } }));

    await makeTodayASchoolDay(coordinator);
  }, 180_000);

  afterAll(async () => {
    // The policy back to the school's defaults for the suites after this one.
    await sql(`delete from school_setting where key like 'leave.%'`);
  });

  // ─── Requests ──────────────────────────────────────────────────────────────

  it('each request path: a parent for their child, the desk for a family, the school sending a student home', async () => {
    // A parent, in the app.
    const byParent = await apiResponse(request(A.parent, {
      studentId: A.studentId, date: D, leaveTime: '10:30', returning: true, returnTime: '12:00', reasonCategory: 'medical', note: 'Dentist',
      collector: { kind: 'parent', parentId: A.parent.id },
    }));
    expect(byParent.leaves).toHaveLength(1);
    expect(byParent.warnings).toEqual([]);
    expect(byParent.leaves[0]).toMatchObject({
      status: 'pending', origin: 'parent', date: D, leaveTime: '10:30', returnTime: '12:00',
      reason: { key: 'medical', label: 'Medical appointment' }, collector: { kind: 'parent', name: 'Parent lv-a' }, createdBy: 'Parent lv-a',
    });
    aLeave = byParent.leaves[0]!.id;
    expect((await notified('coordinator.lv@test.local', 'LEAVE_REQUESTED', 1))[0]!.body)
      .toBe(`Student lv-a asks to leave on ${spoken(D)} at 10:30 (back by 12:00) — Medical appointment.`);
    await audited([aLeave], ['LEAVE_REQUESTED']);

    // The desk, for a family that asked at the counter.
    const byDesk = await apiResponse(request(officer, {
      studentId: B.studentId, date: D, leaveTime: '09:00', returning: false, reasonCategory: 'family',
      collector: { kind: 'parent', parentId: B.parent.id }, onBehalfOf: B.parent.id,
    }));
    expect(byDesk.leaves[0]).toMatchObject({ status: 'pending', origin: 'desk', onBehalfOf: 'Parent lv-b', createdBy: 'finance_officer lv' });
    bLeave = byDesk.leaves[0]!.id;
    for (const email of [B.parent.email, B.student.email]) {
      expect((await notified(email, 'LEAVE_REQUESTED', 1))[0]!.body)
        .toBe(`The school recorded a request for Student lv-b to leave on ${spoken(D)} at 09:00. It waits for approval.`);
    }

    // The school's own decision: a student sent home ill, approved as it is recorded.
    const bySchool = await apiResponse(request(coordinator, {
      studentId: G.studentId, date: TODAY, leaveTime: '08:00', returning: false, reasonCategory: 'unwell', origin: 'school',
      collector: { kind: 'parent', parentId: G.parent.id }, note: 'Temperature 38.5, seen by the nurse',
    }));
    expect(bySchool.leaves[0]).toMatchObject({ status: 'approved', origin: 'school', decidedBy: 'coordinator lv' });
    gLeave = bySchool.leaves[0]!.id;
    expect((await notified(G.parent.email, 'LEAVE_APPROVED', 1))[0]!.body)
      .toBe('The school is sending Student lv-g home today at 08:00: Feeling unwell. Collect them at the gate.');
    await audited([gLeave], ['LEAVE_REQUESTED', 'LEAVE_APPROVED']);

    // Who may not, and what is refused.
    const json = { studentId: A.studentId, date: D, leaveTime: '11:00', returning: false, reasonCategory: 'medical', collector: { kind: 'parent' as const, parentId: A.parent.id } };
    for (const who of [A.student, t1, gate]) expect((await refused(request(who, json))).status).toBe(403);
    expect(await refused(request(B.parent, json))).toEqual({ status: 404, error: 'Student not found' });
    expect(await refused(request(A.parent, { ...json, date: plus(TODAY, -1) }))).toEqual({ status: 400, error: 'A leave is for today or a later day' });
    expect(await refused(request(A.parent, { ...json, date: HOL }))).toEqual({ status: 409, error: `No leave on ${spoken(HOL)}: the school is closed (National Day)` });
    expect(await refused(request(C.parent, { ...json, studentId: C.studentId, date: TODAY, leaveTime: '00:00', collector: { kind: 'parent', parentId: C.parent.id } })))
      .toEqual({ status: 400, error: '00:00 has already passed today — choose a later time' });
    expect(await refused(request(A.parent, { ...json, date: D, leaveTime: '12:00' }))).toEqual({ status: 409, error: `No leave on ${spoken(D)}: the school day ends at 12:00` });
    expect(await refused(request(A.parent, { ...json, reasonCategory: 'holiday_trip' }))).toEqual({ status: 400, error: "Choose one of the school's reasons for leave" });
    expect(await refused(request(A.parent, { ...json, collector: { kind: 'parent', parentId: B.parent.id } }))).toEqual({ status: 409, error: 'Choose a parent linked to Student lv-a' });
    expect(await refused(request(A.parent, { ...json, collector: { kind: 'alone' } }))).toEqual({ status: 409, error: 'Grade 11 students may not leave alone — choose who collects Student lv-a' });
    expect(await refused(request(A.parent, json))).toEqual({ status: 409, error: 'Student lv-a already has a leave that day from 10:30 (waiting for approval)' });
    expect(await refused(request(officer, { ...json, origin: 'school' }))).toEqual({ status: 403, error: "Only the coordinator or the admin records the school's own decision to send a student home" });
    // Nothing was written by the refusals.
    expect((await sql(`select id from leave_request where student_id = $1`, [A.studentId])).map((r) => r.id)).toEqual([aLeave]);
  });

  it('approval: the queue shows what the approver needs; approving tells the family and the teachers of the lessons it touches', async () => {
    const queue = await apiResponse(coordinator.api.v1.leave.queue.$get());
    expect(queue.canDecide).toBe(true);
    const item = queue.requests.find((r) => r.id === aLeave)!;
    expect(item).toMatchObject({ gradeLabel: 'Grade 11', section: '11L', past: false, warnings: [], exams: [], dayNote: null });
    // P3 ends at 10:30, when the leave starts; P4 is the lesson missed; Chemistry (P1) is before it.
    expect(item.lessons.map((l) => [l.label, l.subject, l.teacher, l.startsAt, l.endsAt])).toEqual([['P4', 'Physics LV', 'teacher lv-phy', '10:30', '11:15']]);
    expect(item.history).toMatchObject({ term: { name: 'Term 1' }, thisTerm: 0, recent: [] });
    expect(queue.requests.map((r) => r.id)).toEqual(expect.arrayContaining([aLeave, bLeave]));

    // Only an approver decides; the setting names who.
    for (const who of [officer, A.parent]) expect((await refused(who.api.v1.leave.requests[':id'].approve.$post({ param: { id: aLeave }, json: {} }))).status).toBe(403);
    await put(adm, 'leave.approverRoles', ['admin']);
    expect(await refused(coordinator.api.v1.leave.requests[':id'].approve.$post({ param: { id: aLeave }, json: {} }))).toEqual({ status: 403, error: 'Leave is approved by the admin' });
    expect((await apiResponse(coordinator.api.v1.leave.queue.$get())).canDecide).toBe(false);
    await put(adm, 'leave.approverRoles', ['coordinator', 'admin']);

    const approved = await apiResponse(coordinator.api.v1.leave.requests[':id'].approve.$post({ param: { id: aLeave }, json: { note: 'Bring the appointment card' } }));
    expect(approved.leaves[0]).toMatchObject({ status: 'approved', decidedBy: 'coordinator lv', decisionNote: 'Bring the appointment card', hasPass: true });
    for (const email of [A.parent.email, A.student.email]) {
      expect((await notified(email, 'LEAVE_APPROVED', 1))[0]!.body)
        .toBe(`Student lv-a may leave on ${spoken(D)} at 10:30 (back by 12:00). Show the pass at the gate. Note: Bring the appointment card`);
    }
    expect((await notified(t1.email, 'LEAVE_LESSON_MISSED', 1))[0]!.body)
      .toBe(`Student lv-a leaves on ${spoken(D)} at 10:30 and is back by 12:00: misses Physics LV (P4, 10:30–11:15).`);
    expect(await notificationsFor(t2.email, 'LEAVE_LESSON_MISSED')).toEqual([]);
    expect(await refused(coordinator.api.v1.leave.requests[':id'].approve.$post({ param: { id: aLeave }, json: {} }))).toEqual({ status: 409, error: 'This request is already approved' });

    // Refused with a reason, which the family is told.
    expect((await refused(coordinator.api.v1.leave.requests[':id'].reject.$post({ param: { id: bLeave }, json: { reason: '' } }))).status).toBe(400);
    await apiResponse(coordinator.api.v1.leave.requests[':id'].reject.$post({ param: { id: bLeave }, json: { reason: 'The mock exam is that morning' } }));
    expect((await notified(B.parent.email, 'LEAVE_REJECTED', 1))[0]!.body)
      .toBe(`The request for Student lv-b to leave on ${spoken(D)} at 09:00 was not approved: The mock exam is that morning`);
    expect(await leaveOf(bLeave)).toMatchObject({ status: 'rejected' });
    await audited([aLeave, bLeave], ['LEAVE_REQUESTED', 'LEAVE_APPROVED', 'LEAVE_REQUESTED', 'LEAVE_REJECTED']);
  });

  it('a recurring request: the same time on chosen weekdays until a date, school days only (a holiday skipped); decided and cancelled as one or date by date', async () => {
    const until = plus(TUE, 35);
    const made = await apiResponse(request(A.parent, {
      studentId: A.studentId, date: TUE, leaveTime: '11:15', returning: false, reasonCategory: 'medical', note: 'Weekly physiotherapy',
      collector: { kind: 'parent', parentId: A.parent.id }, repeat: { until, weekdays: [2] },
    }));
    const tuesdays = [0, 7, 14, 21, 28, 35].map((n) => plus(TUE, n)).filter((d) => d !== HOL);
    expect(made.leaves.map((l) => l.date)).toEqual(tuesdays);
    expect(made.skipped).toEqual([{ date: HOL, why: 'the school is closed (National Day)' }]);
    const seriesId = made.leaves[0]!.seriesId!;
    expect(new Set(made.leaves.map((l) => l.seriesId))).toEqual(new Set([seriesId]));
    // One notice for the whole series (A's first request and B's desk request came before it).
    expect((await notified('coordinator.lv@test.local', 'LEAVE_REQUESTED', 3))[2]!.body)
      .toBe(`Student lv-a asks to leave on 5 days from ${spoken(TUE)} at 11:15 — Medical appointment.`);
    // One item in the queue for the whole series.
    const item = (await apiResponse(coordinator.api.v1.leave.queue.$get())).requests.find((r) => r.seriesId === seriesId)!;
    expect(item.seriesDates.map((d) => d.date)).toEqual(tuesdays);

    const approved = await apiResponse(coordinator.api.v1.leave.requests[':id'].approve.$post({ param: { id: made.leaves[0]!.id }, json: { series: true } }));
    expect(approved.approved).toBe(5);
    expect((await notified(A.parent.email, 'LEAVE_APPROVED', 2))[1]!.body).toBe(`Student lv-a may leave on 5 days from ${spoken(TUE)} at 11:15. Show the pass at the gate.`);

    // One date cancelled by the parent; the rest stand; then the rest, as one.
    await apiResponse(A.parent.api.v1.leave.requests[':id'].cancel.$post({ param: { id: made.leaves[2]!.id }, json: { reason: 'Session moved' } }));
    expect((await sql(`select status from leave_request where series_id = $1 order by date`, [seriesId])).map((r) => r.status))
      .toEqual(['approved', 'approved', 'cancelled', 'approved', 'approved']);
    const rest = await apiResponse(A.parent.api.v1.leave.requests[':id'].cancel.$post({ param: { id: made.leaves[0]!.id }, json: { series: true } }));
    expect(rest.cancelled).toBe(4);
    expect((await sql(`select distinct status from leave_request where series_id = $1`, [seriesId])).map((r) => r.status)).toEqual(['cancelled']);
    // A series longer than the limit is refused.
    expect(await refused(request(A.parent, { studentId: A.studentId, date: TUE, leaveTime: '11:15', returning: false, reasonCategory: 'medical', collector: { kind: 'parent', parentId: A.parent.id }, repeat: { until: plus(TUE, 150), weekdays: [2] } })))
      .toEqual({ status: 400, error: 'A recurring request runs for at most 120 days' });
  });

  it('policy warnings: after the cut-off, short notice, beyond the limit per term, an exam-only day; refused instead when the school says so; approved at once when no rule is broken', async () => {
    // Same day: after the cut-off and with short notice. (A request for 23:58 today: the suite's only
    // time-of-day dependence — it cannot run in the last two minutes before midnight in Cairo.)
    await put(coordinator, 'leave.sameDayCutoff', '00:00');
    await put(coordinator, 'leave.noticeMinutes', 1440);
    const late = await apiResponse(request(C.parent, { studentId: C.studentId, date: TODAY, leaveTime: '23:58', returning: false, reasonCategory: 'family', collector: { kind: 'parent', parentId: C.parent.id } }));
    expect(late.warnings.map((w) => w.code)).toEqual(['after_cutoff', 'short_notice']);
    expect(late.warnings[0]!.message).toMatch(/^Sent at \d\d:\d\d, after the same-day cut-off \(00:00\)$/);
    expect(late.warnings[1]!.message).toMatch(/^Sent \d+ minutes before the leave \(the school asks for 1440\)$/);
    expect(late.leaves[0]!.status).toBe('pending');
    await apiResponse(C.parent.api.v1.leave.requests[':id'].cancel.$post({ param: { id: late.leaves[0]!.id }, json: {} }));
    await put(coordinator, 'leave.sameDayCutoff', null);
    await put(coordinator, 'leave.noticeMinutes', 0);

    // The limit per term: A has one family request standing in Term 1 (approved; the series was cancelled).
    await put(coordinator, 'leave.limitPerTerm', 1);
    const json = { studentId: A.studentId, leaveTime: '08:45', returning: false, reasonCategory: 'family', collector: { kind: 'parent' as const, parentId: A.parent.id } };
    const second = await apiResponse(request(A.parent, { ...json, date: plus(D, 1) }));
    expect(second.warnings).toEqual([{ code: 'over_term_limit', message: 'The 2nd family request for this student in Term 1 (the limit is 1)' }]);
    await put(coordinator, 'leave.familyRules', 'refuse');
    expect(await refused(request(A.parent, { ...json, date: plus(D, 3) })))
      .toEqual({ status: 409, error: 'The school does not accept this request: the 3rd family request for this student in Term 1 (the limit is 1). Please phone the school.' });
    // Staff are never refused for it; the approver sees the warning. The school's own leave does not count.
    const desk = await apiResponse(request(officer, { ...json, date: plus(D, 3) }));
    expect(desk.warnings.map((w) => w.code)).toEqual(['over_term_limit']);
    const school = await apiResponse(request(coordinator, { ...json, date: plus(D, 4), origin: 'school', approveNow: false }));
    expect(school.warnings).toEqual([]);
    await put(coordinator, 'leave.familyRules', 'warn');
    await put(coordinator, 'leave.limitPerTerm', null);

    // An exam-only day in the calendar.
    const exam = await apiResponse(request(A.parent, { ...json, date: EXAM }));
    expect(exam.warnings).toEqual([{ code: 'exam_only_day', message: 'The calendar marks this day exam-only' }]);

    // Approved at once when the school says so and no rule is broken.
    await put(coordinator, 'leave.autoApprove', true);
    const auto = await apiResponse(request(A.parent, { ...json, date: plus(D, 7), leaveTime: '09:45' }));
    expect(auto.leaves[0]).toMatchObject({ status: 'approved', decidedBy: 'Approved automatically', decisionNote: 'Approved automatically: no rule broken' });
    expect(await one(`select user_id from audit_log where action = 'LEAVE_APPROVED' and entity_id = $1`, [auto.leaves[0]!.id])).toEqual({ user_id: null });
    const withWarning = await apiResponse(request(A.parent, { ...json, studentId: A2.studentId, date: EXAM }));
    expect(withWarning.leaves[0]!.status).toBe('pending');
    await put(coordinator, 'leave.autoApprove', false);
    // Grades that may leave alone.
    await put(coordinator, 'leave.aloneGrades', [11]);
    const alone = await apiResponse(request(A.parent, { ...json, date: plus(D, 8), collector: { kind: 'alone' } }));
    expect(alone.leaves[0]!.collector.kind).toBe('alone');
    await put(coordinator, 'leave.aloneGrades', []);
    expect((await apiResponse(coordinator.api.v1.leave.requests[':id'].$get({ param: { id: alone.leaves[0]!.id } }))).warnings)
      .toEqual([{ code: 'alone_not_allowed', message: 'Grade 11 students may not leave alone under the current policy' }]);
    expect(await refused(coordinator.api.v1.leave.requests[':id'].approve.$post({ param: { id: alone.leaves[0]!.id }, json: {} })))
      .toEqual({ status: 409, error: 'Grade 11 students may not leave alone under the current policy — refuse it, or ask the family who collects' });
  });

  // ─── Collectors and custody ────────────────────────────────────────────────

  it('authorised collectors: a parent adds one for two children; it waits for approval and cannot be relied on until then; the family sees the ID masked, the approver whole; a parent withdraws it from their own child', async () => {
    const photo = await apiResponse(A.parent.api.v1.files.upload.$post({ form: { file: png('aisha.png'), purpose: 'collector_photo', studentId: A.studentId } }));
    const added = await apiResponse(A.parent.api.v1.leave.collectors.$post({ json: {
      name: 'Aisha Grandmother', relation: 'Grandparent', phone: '01000000999', idNumber: '2900 1011 2345 67', photoFileId: photo.id, studentIds: [A.studentId, A2.studentId],
    } }));
    expect(added).toMatchObject({ status: 'pending', idNumber: '••••4567', students: [{ id: A.studentId }, { id: A2.studentId }] });
    expect((await notified('coordinator.lv@test.local', 'LEAVE_COLLECTOR_REQUESTED', 1))[0]!.body)
      .toBe('Aisha Grandmother (Grandparent) is proposed to collect Student lv-a and Student lv-a2. Check the ID and the photo, then approve or refuse.');
    expect(await refused(A.parent.api.v1.leave.collectors.$post({ json: { name: 'Aisha G.', relation: 'Grandparent', phone: '01000000998', idNumber: '29001011234567', studentIds: [A.studentId] } })))
      .toEqual({ status: 409, error: 'Aisha Grandmother is already waiting for approval for Student lv-a' });
    expect((await refused(B.parent.api.v1.leave.collectors.$post({ json: { name: 'X Person', relation: 'Uncle', phone: '01000000997', idNumber: '1234567', studentIds: [A.studentId] } }))).status).toBe(404);
    const staffView = await apiResponse(coordinator.api.v1.leave.collectors.$get({ query: { studentId: A.studentId } }));
    expect(staffView.find((c) => c.id === added.id)!.idNumber).toBe('2900 1011 2345 67');
    expect((await apiResponse(officer.api.v1.leave.collectors.$get({ query: { studentId: A.studentId } }))).find((c) => c.id === added.id)!.idNumber).toBe('••••4567');

    // Named on a request while waiting: flagged, and the request cannot be approved until the collector is.
    const r = await apiResponse(request(A.parent, { studentId: A.studentId, date: plus(D, 14), leaveTime: '10:30', returning: false, reasonCategory: 'family', collector: { kind: 'collector', collectorId: added.id } }));
    expect(r.warnings).toEqual([{ code: 'collector_pending', message: 'The collector Aisha Grandmother is waiting for approval' }]);
    expect(await refused(coordinator.api.v1.leave.requests[':id'].approve.$post({ param: { id: r.leaves[0]!.id }, json: {} })))
      .toEqual({ status: 409, error: 'Approve the collector Aisha Grandmother first' });
    const ok = await apiResponse(coordinator.api.v1.leave.collectors[':id'].approve.$post({ param: { id: added.id } }));
    expect(ok.status).toBe('approved');
    expect((await notified(A.parent.email, 'LEAVE_COLLECTOR_DECIDED', 1))[0]!.body).toBe('The school approved Aisha Grandmother (Grandparent) to collect your child. The gate checks their ID.');
    await apiResponse(coordinator.api.v1.leave.requests[':id'].approve.$post({ param: { id: r.leaves[0]!.id }, json: {} }));

    // A2's other parent sees the collector for A2 only, and withdraws it for A2; A keeps it.
    const theirs = await apiResponse(A2.parent.api.v1.leave.collectors.$get({ query: {} }));
    expect(theirs.map((c) => [c.name, c.students.map((s) => s.id)])).toEqual([['Aisha Grandmother', [A2.studentId]]]);
    await apiResponse(A2.parent.api.v1.leave.collectors[':id'].withdraw.$post({ param: { id: added.id }, json: { reason: 'Not for this child' } }));
    expect(await apiResponse(A2.parent.api.v1.leave.collectors.$get({ query: {} }))).toEqual([]);
    expect((await apiResponse(A.parent.api.v1.leave.collectors.$get({ query: {} }))).map((c) => [c.status, c.students.map((s) => s.id)])).toEqual([['approved', [A.studentId]]]);
    expect(await refused(B.parent.api.v1.leave.collectors[':id'].withdraw.$post({ param: { id: added.id }, json: {} }))).toEqual({ status: 404, error: 'Collector not found' });

    // The desk records one for a family (it waits); the coordinator's own is approved as recorded; a refusal needs a reason.
    const byDesk = await apiResponse(officer.api.v1.leave.collectors.$post({ json: { name: 'Hany Driver', relation: 'Family driver', phone: '01220000000', idNumber: '28802021234567', studentIds: [B.studentId] } }));
    expect(byDesk.status).toBe('pending');
    const byCoordinator = await apiResponse(coordinator.api.v1.leave.collectors.$post({ json: { name: 'Mona Aunt', relation: 'Aunt', phone: '01110000000', idNumber: '28703031234567', studentIds: [B.studentId] } }));
    expect(byCoordinator.status).toBe('approved');
    expect((await refused(coordinator.api.v1.leave.collectors[':id'].reject.$post({ param: { id: byDesk.id }, json: { reason: '' } }))).status).toBe(400);
    await apiResponse(coordinator.api.v1.leave.collectors[':id'].reject.$post({ param: { id: byDesk.id }, json: { reason: 'The ID copy is unreadable' } }));
    expect((await notified(B.parent.email, 'LEAVE_COLLECTOR_DECIDED', 2)).map((n) => n.body)).toEqual([
      'The school recorded Mona Aunt (Aunt) as authorised to collect Student lv-b.',
      'The school did not approve Hany Driver to collect your child: The ID copy is unreadable',
    ]);
    await audited([added.id, byDesk.id], ['LEAVE_COLLECTOR_ADDED', 'LEAVE_COLLECTOR_APPROVED', 'LEAVE_COLLECTOR_WITHDRAWN', 'LEAVE_COLLECTOR_ADDED', 'LEAVE_COLLECTOR_REJECTED']);
  });

  it('custody: a restriction stops a collector and a linked parent — never shown to a family, flagged to the approver; a custody-restricted collector refused at the gate, the attempt recorded and the approvers alerted', async () => {
    const sami = await apiResponse(coordinator.api.v1.leave.collectors.$post({ json: { name: 'Sami Uncle', relation: 'Uncle', phone: '01000000100', idNumber: '28501011111111', studentIds: [H.studentId] } }));
    const karim = await apiResponse(officer.api.v1.leave.collectors.$post({ json: { name: 'Karim Neighbour', relation: 'Neighbour', phone: '01010000000', idNumber: '27001012222222', studentIds: [H.studentId] } }));
    // Only the coordinator and the admin record restrictions.
    for (const who of [officer, H.parent, gate]) {
      expect((await refused(who.api.v1.leave.restrictions.$post({ json: { studentId: H.studentId, personName: 'X', note: 'none' } }))).status).toBe(403);
    }
    const onSami = await apiResponse(coordinator.api.v1.leave.restrictions.$post({ json: { studentId: H.studentId, personName: 'Sami Uncle', relation: 'Uncle', idNumber: '28501011111111', note: 'Family court order 12/2026' } }));
    expect(onSami.matchingCollectors).toEqual([{ id: sami.id, name: 'Sami Uncle', relation: 'Uncle', status: 'approved' }]);
    await apiResponse(coordinator.api.v1.leave.restrictions.$post({ json: { studentId: H.studentId, personName: 'Karim Neighbour', note: "The mother's written instruction" } }));
    // The father's legal name differs from his account's: only the account ties him to it.
    await apiResponse(coordinator.api.v1.leave.restrictions.$post({ json: { studentId: H.studentId, personName: 'Hisham Fawzy', relation: 'Father', restrictedUserId: F.parent.id, note: 'Court order: the mother has sole custody' } }));
    await audited([onSami.restriction.id], ['CUSTODY_RESTRICTION_RECORDED']);

    // A pending collector the restriction names cannot be approved; the family cannot add one it names.
    expect(await refused(coordinator.api.v1.leave.collectors[':id'].approve.$post({ param: { id: karim.id } })))
      .toEqual({ status: 409, error: 'Karim Neighbour matches a custody restriction (Karim Neighbour) — refuse this collector' });
    expect(await refused(H.parent.api.v1.leave.collectors.$post({ json: { name: 'Sami  uncle', relation: 'Uncle', phone: '01000000100', idNumber: '2850-1011-1111-11', studentIds: [H.studentId] } })))
      .toEqual({ status: 409, error: 'Sami  uncle cannot be added for Student lv-h — please contact the school' });

    // The restricted father is not the child's family here: no child, no leave, no request.
    expect((await apiResponse(F.parent.api.v1.leave.family.$get())).children.map((c) => c.id)).toEqual([F.studentId]);
    expect((await refused(request(F.parent, { studentId: H.studentId, date: D, leaveTime: '09:00', returning: false, reasonCategory: 'family', collector: { kind: 'parent', parentId: F.parent.id } }))).status).toBe(404);
    // The mother cannot name him either.
    expect(await refused(request(H.parent, { studentId: H.studentId, date: D, leaveTime: '09:00', returning: false, reasonCategory: 'family', collector: { kind: 'parent', parentId: F.parent.id } })))
      .toEqual({ status: 409, error: 'Choose a parent linked to Student lv-h' });

    // The approver is told a restriction is on file; the family is not.
    const pending = await apiResponse(request(H.parent, { studentId: H.studentId, date: D, leaveTime: '09:00', returning: false, reasonCategory: 'family', collector: { kind: 'parent', parentId: H.parent.id } }));
    expect(pending.warnings).toEqual([]);
    const item = (await apiResponse(coordinator.api.v1.leave.queue.$get())).requests.find((r) => r.id === pending.leaves[0]!.id)!;
    expect(item.warnings.map((w) => w.code)).toEqual(['custody_on_file']);
    expect(item.custody.map((c) => c.personName).sort()).toEqual(['Hisham Fawzy', 'Karim Neighbour', 'Sami Uncle']);
    expect((await apiResponse(H.parent.api.v1.leave.requests[':id'].$get({ param: { id: pending.leaves[0]!.id } }))).warnings).toEqual([]);

    // Today at the gate: the list shows who may not collect; each such attempt is refused and alerted.
    const today = await apiResponse(request(coordinator, { studentId: H.studentId, date: TODAY, leaveTime: '08:00', returning: false, reasonCategory: 'family', collector: { kind: 'parent', parentId: H.parent.id }, approveNow: true }));
    const hLeave = today.leaves[0]!.id;
    const onList = (await apiResponse(gate.api.v1.leave.gate.today.$get())).leaves.find((l) => l.id === hLeave)!;
    expect(onList.custody.map((c) => [c.personName, c.idNumber]).sort()).toEqual([['Hisham Fawzy', null], ['Karim Neighbour', null], ['Sami Uncle', '28501011111111']]);
    expect(onList.authorised.parents.map((p) => p.name)).toEqual(['Parent lv-h']);
    const alertsBefore = (await notificationsFor('coordinator.lv@test.local', 'LEAVE_CUSTODY_ALERT')).length;
    const checkOut = (collectedBy: Parameters<Client['api']['v1']['leave']['gate'][':id']['check-out']['$post']>[0]['json']['collectedBy']) =>
      gate.api.v1.leave.gate[':id']['check-out'].$post({ param: { id: hLeave }, json: { collectedBy, idChecked: true, via: 'lookup' } });
    expect(await refused(checkOut({ kind: 'collector', collectorId: sami.id })))
      .toEqual({ status: 409, error: 'Custody restriction: Sami Uncle may not collect Student lv-h. Do not release the student — the coordinator has been alerted' });
    expect((await refused(checkOut({ kind: 'parent', parentId: F.parent.id }))).error).toBe('Custody restriction: Parent lv-hf may not collect Student lv-h. Do not release the student — the coordinator has been alerted');
    expect((await refused(checkOut({ kind: 'other', name: 'karim   NEIGHBOUR' }))).error).toBe('Custody restriction: karim   NEIGHBOUR may not collect Student lv-h. Do not release the student — the coordinator has been alerted');
    expect((await notified('coordinator.lv@test.local', 'LEAVE_CUSTODY_ALERT', alertsBefore + 3))[alertsBefore]!.body)
      .toMatch(/^Sami Uncle tried to collect Student lv-h at \d\d:\d\d\. The gate refused: a custody restriction names them \(Sami Uncle\)\.$/);
    // Someone nobody authorised: refused, not an alert.
    expect((await refused(checkOut({ kind: 'other', name: 'Passer By', idNumber: '12345678' }))).error)
      .toBe('Passer By is not authorised to collect Student lv-h: only a linked parent or an approved collector may. Do not release them; the coordinator can approve a collector now');
    expect(await notificationsFor('coordinator.lv@test.local', 'LEAVE_CUSTODY_ALERT')).toHaveLength(alertsBefore + 3);
    expect(await leaveOf(hLeave)).toMatchObject({ status: 'approved' });
    expect((await sql(`select new_data->>'reason' as reason from audit_log where action = 'LEAVE_CHECKOUT_REFUSED' and entity_id = $1 order by created_at`, [hLeave])).map((r) => r.reason))
      .toEqual(['custody', 'custody', 'custody', 'not_authorised']);
    // The mother collects.
    const out = await apiResponse(checkOut({ kind: 'parent', parentId: H.parent.id }));
    expect(out).toMatchObject({ status: 'checked_out', checkout: { name: 'Parent lv-h', kind: 'parent' } });

    // An ended restriction no longer stops anyone; the record keeps it.
    const ended = await apiResponse(coordinator.api.v1.leave.restrictions[':id'].end.$post({ param: { id: onSami.restriction.id }, json: { reason: 'Order lifted on appeal' } }));
    expect(ended).toMatchObject({ endReason: 'Order lifted on appeal', endedBy: 'coordinator lv' });
    expect((await apiResponse(coordinator.api.v1.leave.restrictions.$get({ query: { studentId: H.studentId } }))).map((r) => [r.personName, !!r.endedAt]))
      .toEqual([['Sami Uncle', true], ['Karim Neighbour', false], ['Hisham Fawzy', false]]);
  });

  // ─── The gate ──────────────────────────────────────────────────────────────

  it('the gate: today\'s list only, with only what check-out needs; the pass scanned; check-out records who collected; a return recorded; the family told at each step', async () => {
    const list = await apiResponse(gate.api.v1.leave.gate.today.$get());
    expect(list.date).toBe(TODAY);
    // Today's approved leaves only: not A's far-future leave, not C's pending request.
    expect(list.leaves.every((l) => l.date === TODAY)).toBe(true);
    const ids = list.leaves.map((l) => l.id);
    expect(ids).toContain(gLeave);
    expect(ids).not.toContain(aLeave);
    const g = list.leaves.find((l) => l.id === gLeave)!;
    expect(g).toMatchObject({ status: 'approved', leaveTime: '08:00', named: { kind: 'parent', name: 'Parent lv-g' }, mayLeaveAlone: false, custody: [], authorised: { parents: [{ name: 'Parent lv-g' }], collectors: [] } });
    // Never the reason, the family's note or a document.
    expect(Object.keys(g)).not.toEqual(expect.arrayContaining(['reason']));
    expect(JSON.stringify(g)).not.toContain('Temperature');

    // The family's pass, scanned.
    const pass = await apiResponse(G.parent.api.v1.leave.requests[':id'].pass.$get({ param: { id: gLeave } }));
    expect(pass.token).toMatch(/^L1\./);
    expect(new Date(pass.expiresAt!).getTime()).toBeGreaterThan(Date.now());
    expect((await apiResponse(G.student.api.v1.leave.requests[':id'].pass.$get({ param: { id: gLeave } }))).token).toBe(pass.token);
    const scanned = await apiResponse(gate.api.v1.leave.gate.scan.$post({ json: { token: pass.token! } }));
    expect(scanned).toMatchObject({ id: gLeave, passOk: true, student: { name: 'Student lv-g' } });

    // Check-out: by pass, the parent collecting, ID seen.
    const wrongPass = await refused(gate.api.v1.leave.gate[':id']['check-out'].$post({ param: { id: gLeave }, json: { collectedBy: { kind: 'parent', parentId: G.parent.id }, idChecked: true, via: 'pass', token: 'L1.bad' } }));
    expect(wrongPass).toEqual({ status: 409, error: 'The pass does not match this leave — scan it again, or look the student up on the list' });
    const out = await apiResponse(gate.api.v1.leave.gate[':id']['check-out'].$post({ param: { id: gLeave }, json: { collectedBy: { kind: 'parent', parentId: G.parent.id }, idChecked: true, via: 'pass', token: pass.token! } }));
    expect(out).toMatchObject({ status: 'checked_out', checkout: { kind: 'parent', name: 'Parent lv-g', by: 'gate lv' } });
    const row = await one<{ checked_out_via: string; id_checked: boolean; collected_by_parent_id: string; checked_out_by: string }>(`select checked_out_via, id_checked, collected_by_parent_id, checked_out_by from leave_request where id = $1`, [gLeave]);
    expect(row).toEqual({ checked_out_via: 'pass', id_checked: true, collected_by_parent_id: G.parent.id, checked_out_by: gate.id });
    expect((await notified(G.parent.email, 'LEAVE_CHECKED_OUT', 1))[0]!.body).toMatch(/^Student lv-g left school at \d\d:\d\d with Parent lv-g\.$/);
    expect((await notified(G.student.email, 'LEAVE_CHECKED_OUT', 1))).toHaveLength(1);
    const again = await refused(gate.api.v1.leave.gate[':id']['check-out'].$post({ param: { id: gLeave }, json: { collectedBy: { kind: 'parent', parentId: G.parent.id }, idChecked: true, via: 'lookup' } }));
    expect(again.error).toMatch(/^Student lv-g already left at \d\d:\d\d with Parent lv-g$/);
    expect((await refused(gate.api.v1.leave.gate.scan.$post({ json: { token: pass.token! } }))).error).toMatch(/^Student lv-g already left at \d\d:\d\d with Parent lv-g$/);
    expect((await refused(G.parent.api.v1.leave.requests[':id'].cancel.$post({ param: { id: gLeave }, json: {} }))).error)
      .toMatch(/^The student already left school at \d\d:\d\d — it can no longer be cancelled$/);
    expect(await refused(gate.api.v1.leave.gate[':id'].return.$post({ param: { id: gLeave }, json: {} }))).toEqual({ status: 409, error: 'This leave says Student lv-g does not come back today' });
    await audited([gLeave], ['LEAVE_REQUESTED', 'LEAVE_APPROVED', 'LEAVE_CHECKED_OUT']);

    // A student allowed to leave alone, back later the same day.
    await put(coordinator, 'leave.aloneGrades', [11]);
    const j = await apiResponse(request(coordinator, { studentId: J.studentId, date: TODAY, leaveTime: '08:00', returning: true, returnTime: '23:59', reasonCategory: 'official', collector: { kind: 'alone' }, approveNow: true }));
    const jLeave = j.leaves[0]!.id;
    const jOut = await apiResponse(gate.api.v1.leave.gate[':id']['check-out'].$post({ param: { id: jLeave }, json: { collectedBy: { kind: 'alone' }, idChecked: false, via: 'lookup' } }));
    expect(jOut).toMatchObject({ status: 'checked_out', checkout: { kind: 'alone', name: null } });
    expect((await notified(J.parent.email, 'LEAVE_CHECKED_OUT', 1))[0]!.body).toMatch(/^Student lv-j left school at \d\d:\d\d on their own\. Expected back by 23:59\.$/);
    await put(coordinator, 'leave.aloneGrades', []);
    const back = await apiResponse(gate.api.v1.leave.gate[':id'].return.$post({ param: { id: jLeave }, json: {} }));
    expect(back).toMatchObject({ status: 'returned' });
    expect(back.returnedTime).toMatch(/^\d\d:\d\d$/);
    expect((await notified(J.parent.email, 'LEAVE_RETURNED', 1))[0]!.body).toMatch(/^Student lv-j came back to school at \d\d:\d\d\.$/);
    expect((await refused(gate.api.v1.leave.gate[':id'].return.$post({ param: { id: jLeave }, json: {} }))).error).toMatch(/^Student lv-j is already back \(\d\d:\d\d\)$/);
    const counts = (await apiResponse(gate.api.v1.leave.gate.today.$get())).counts;
    expect(counts.back).toBeGreaterThanOrEqual(1);
  });

  it('a pass expired or forged refused, as is a replaced pass, another day\'s pass and a cancelled leave\'s; every refusal recorded', async () => {
    const { signLeavePass } = await import('../src/services/leave-pass.services');
    const k = await apiResponse(request(coordinator, { studentId: C.studentId, date: TODAY, leaveTime: '08:00', returning: false, reasonCategory: 'family', collector: { kind: 'parent', parentId: C.parent.id }, approveNow: true }));
    const kLeave = k.leaves[0]!.id;
    const pass = (await apiResponse(C.parent.api.v1.leave.requests[':id'].pass.$get({ param: { id: kLeave } }))).token!;
    const scan = (token: string) => refused(gate.api.v1.leave.gate.scan.$post({ json: { token } }));
    // Forged: a changed signature, and a genuine pass's signature over another leave.
    const parts = pass.split('.');
    const forged = [...parts.slice(0, 4), (parts[4]!.startsWith('A') ? 'B' : 'A') + parts[4]!.slice(1)].join('.');
    expect(await scan(forged)).toEqual({ status: 409, error: 'This pass is not genuine — do not release the student; call the coordinator' });
    expect(await scan([parts[0], gLeave, ...parts.slice(2)].join('.'))).toEqual({ status: 409, error: 'This pass is not genuine — do not release the student; call the coordinator' });
    // Expired: genuinely signed, but its time is over.
    expect(await scan(signLeavePass(kLeave, 1, new Date(Date.now() - 60_000)).token)).toEqual({ status: 409, error: 'This pass has expired: it was for an earlier day' });
    expect(await scan('hello world')).toEqual({ status: 409, error: 'This is not a leave pass — look the student up on the list instead' });
    // Another day's pass (A's approved leave, far ahead), and the gate cannot act on that leave at all.
    const aPass = (await apiResponse(A.parent.api.v1.leave.requests[':id'].pass.$get({ param: { id: aLeave } }))).token!;
    expect(await scan(aPass)).toEqual({ status: 409, error: `This pass is for ${spoken(D)}, not today` });
    expect(await refused(gate.api.v1.leave.gate[':id']['check-out'].$post({ param: { id: aLeave }, json: { collectedBy: { kind: 'parent', parentId: A.parent.id }, idChecked: true, via: 'lookup' } })))
      .toEqual({ status: 404, error: "Not on today's leave list" });
    // Replaced: the family makes a new pass; the old one stops working.
    const fresh = await apiResponse(C.parent.api.v1.leave.requests[':id'].pass.$post({ param: { id: kLeave } }));
    expect(fresh.token).not.toBe(pass);
    expect(await scan(pass)).toEqual({ status: 409, error: 'This pass was replaced by a newer one — ask for the pass on the family’s phone now' });
    expect((await apiResponse(gate.api.v1.leave.gate.scan.$post({ json: { token: fresh.token! } }))).passOk).toBe(true);
    // Cancelled: the pass the family still holds is refused.
    await apiResponse(C.parent.api.v1.leave.requests[':id'].cancel.$post({ param: { id: kLeave }, json: { reason: 'Plans changed' } }));
    expect((await scan(fresh.token!)).error).toMatch(/^Student lv-c's leave was cancelled at \d\d:\d\d — do not release them$/);
    expect((await refused(C.parent.api.v1.leave.requests[':id'].pass.$get({ param: { id: kLeave } }))).status).toBe(409);
    const reasons = (await sql(`select new_data->>'reason' as reason from audit_log where action = 'LEAVE_PASS_REFUSED' and user_id = $1 order by created_at`, [gate.id])).map((r) => r.reason);
    expect(reasons).toEqual(expect.arrayContaining(['forged', 'expired', 'malformed', 'not_today', 'replaced', 'status_cancelled']));
    // The cancelled leave shows on the gate's list as cancelled (do not release).
    expect((await apiResponse(gate.api.v1.leave.gate.today.$get())).leaves.find((l) => l.id === kLeave)).toMatchObject({ status: 'cancelled' });
  });

  it('cancelling: a parent before the student leaves, staff with a reason; the teachers told the student stays', async () => {
    expect((await refused(A.student.api.v1.leave.requests[':id'].cancel.$post({ param: { id: aLeave }, json: {} }))).status).toBe(403);
    expect(await refused(officer.api.v1.leave.requests[':id'].cancel.$post({ param: { id: aLeave }, json: {} }))).toEqual({ status: 400, error: 'Give a reason: the family is told it' });
    expect((await refused(B.parent.api.v1.leave.requests[':id'].cancel.$post({ param: { id: aLeave }, json: {} }))).status).toBe(404);
    const done = await apiResponse(A.parent.api.v1.leave.requests[':id'].cancel.$post({ param: { id: aLeave }, json: { reason: 'Appointment moved' } }));
    expect(done.leaves[0]).toMatchObject({ status: 'cancelled', cancelReason: 'Appointment moved', cancelledBy: 'Parent lv-a', canCancel: false });
    expect((await notified(t1.email, 'LEAVE_CANCELLED', 1))[0]!.body)
      .toBe(`The leave on ${spoken(D)} at 10:30 was cancelled: Student lv-a is expected in Physics LV (P4, 10:30–11:15).`);
    expect((await notified(A.student.email, 'LEAVE_CANCELLED', 3)).pop()!.body).toBe(`Parent lv-a cancelled the leave on ${spoken(D)} at 10:30: Appointment moved. Student lv-a stays at school.`);
    expect(await refused(A.parent.api.v1.leave.requests[':id'].cancel.$post({ param: { id: aLeave }, json: {} }))).toEqual({ status: 409, error: expect.stringMatching(/^This request was cancelled at \d\d:\d\d by Parent lv-a$/) });
  });

  // ─── History, reports, F3, teachers ────────────────────────────────────────

  it("history and reports: a student's record and their family's, reports by reason, grade, section, month; CSV", async () => {
    const rec = await apiResponse(coordinator.api.v1.leave.students[':studentId'].$get({ param: { studentId: A.studentId } }));
    expect(rec.student).toMatchObject({ name: 'Student lv-a' });
    expect(rec.siblings.map((s) => s.name)).toEqual(['Student lv-a2']);
    expect(rec.leaves.length).toBeGreaterThanOrEqual(10);
    expect(rec.collectors.map((c) => c.name)).toEqual(['Aisha Grandmother']);
    // Restrictions: the coordinator reads them; the desk sees only that one is on file.
    const hByCoordinator = await apiResponse(coordinator.api.v1.leave.students[':studentId'].$get({ param: { studentId: H.studentId } }));
    expect(hByCoordinator.restrictions).toHaveLength(3);
    const hByDesk = await apiResponse(officer.api.v1.leave.students[':studentId'].$get({ param: { studentId: H.studentId } }));
    expect(hByDesk).toMatchObject({ custodyOnFile: 2, restrictions: [], restrictedParents: [] });
    // The family's history: A and A2 share a parent.
    await apiResponse(request(A.parent, { studentId: A2.studentId, date: plus(D, 21), leaveTime: '08:45', returning: false, reasonCategory: 'religious', collector: { kind: 'parent', parentId: A.parent.id } }));
    const fam = await apiResponse(coordinator.api.v1.leave.requests.$get({ query: { studentId: A.studentId, family: 'true' } }));
    expect(new Set(fam.map((l) => l.student.name))).toEqual(new Set(['Student lv-a', 'Student lv-a2']));
    expect((await apiResponse(A.parent.api.v1.leave.requests.$get({ query: {} }))).some((l) => l.student.id === A2.studentId)).toBe(true);

    const report = await apiResponse(coordinator.api.v1.leave.reports.$get({ query: { from: `${Y}-09-01`, to: `${Y}-12-31` } }));
    const standing = await sql<{ n: string }>(`select count(*) as n from leave_request where date between $1 and $2`, [`${Y}-09-01`, `${Y}-12-31`]);
    expect(report.totals.requests).toBe(Number(standing[0]!.n));
    expect(report.totals.cancelled).toBe(Number((await one<{ n: string }>(`select count(*) as n from leave_request where status = 'cancelled' and date between $1 and $2`, [`${Y}-09-01`, `${Y}-12-31`])).n));
    expect(report.byReason.map((r) => r.key)).toEqual(expect.arrayContaining(['Family matter', 'Religious occasion']));
    expect(report.bySection.map((r) => r.key)).toContain('11L');
    expect(report.byGrade.map((r) => r.key)).toContain('Grade 11');
    expect(report.byMonth.map((r) => r.key)).toEqual(expect.arrayContaining([`${Y}-10`, `${Y}-11`]));
    expect(report.topStudents[0]).toMatchObject({ name: 'Student lv-a' });
    const csv = await officer.api.v1.leave.reports.csv.$get({ query: { from: `${Y}-09-01`, to: `${Y}-12-31` } });
    expect(csv.status).toBe(200);
    const lines = (await csv.text()).trim().split('\r\n');
    expect(lines[0]).toBe('Date,Student,Student ID,Grade,Section,Reason,Requested by,Origin,Requested at,Status,Decided by,Decision note,Leave time,Back by,Checked out,Collected by,Returned,No-show,Late back,Cancel reason');
    expect(lines.length).toBe(Number(standing[0]!.n) + 1);
    expect(lines.find((l) => l.startsWith(`${D},Student lv-a,`) && l.includes('Medical appointment'))).toContain('Cancelled');
  });

  it('getLeaveCoverage (the F3 contract): the gate\'s times for a student who left, the approved times for one still to go; the excused part ends at the approved return', async () => {
    const { getLeaveCoverage } = await import('../src/services/leave.services');
    const g = await getLeaveCoverage(G.studentId, TODAY);
    const gOut = await one<{ checked_out_at: Date }>(`select checked_out_at from leave_request where id = $1`, [gLeave]);
    const hhmm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
    expect(g.ranges).toEqual([{ leaveId: gLeave, kind: 'left', from: hhmm(gOut.checked_out_at), to: null, excusedTo: null, returned: false, lateReturn: false, reason: { key: 'unwell', label: 'Feeling unwell' }, origin: 'school' }]);
    const j = await getLeaveCoverage(J.studentId, TODAY);
    expect(j.ranges).toHaveLength(1);
    expect(j.ranges[0]).toMatchObject({ kind: 'left', excusedTo: '23:59', returned: true, lateReturn: false });
    // A's approved request for a later Sunday (the collector's), not taken yet: planned.
    const later = await getLeaveCoverage(A.studentId, plus(D, 14));
    expect(later.ranges).toEqual([expect.objectContaining({ kind: 'planned', from: '10:30', to: null, excusedTo: null })]);
    // Pending, refused and cancelled requests give nothing.
    expect((await getLeaveCoverage(A.studentId, D)).ranges).toEqual([]);
    expect((await getLeaveCoverage(B.studentId, D)).ranges).toEqual([]);
  });

  it('a teacher sees who leaves during their own lessons, and nobody else\'s', async () => {
    // A's approved leave two Sundays on (collector Aisha, from 10:30): Physics P4 is t1's.
    const mine = await apiResponse(t1.api.v1.leave.teaching.$get({ query: { date: plus(D, 14) } }));
    expect(mine.lessons.map((l) => [l.label, l.students.map((s) => [s.name, s.leaveTime, s.status])])).toEqual([['P4', [['Student lv-a', '10:30', 'approved']]]]);
    expect((await apiResponse(t2.api.v1.leave.teaching.$get({ query: { date: plus(D, 14) } }))).lessons).toEqual([]);
    expect(await refused(gate.api.v1.leave.teaching.$get({ query: {} }))).toEqual({ status: 404, error: 'Your account is not linked to a teacher record — ask the admin to link it on the Team page' });
  });
});
