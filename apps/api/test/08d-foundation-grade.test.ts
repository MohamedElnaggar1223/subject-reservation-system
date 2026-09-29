import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  apiResponse, academicYearStartOf, gradeInAcademicYear, gradeToday, seriesYearInAcademicYear, academicYearLabel,
} from '@repo/validations';
import {
  admin, staff, onboard, subject, session, refused, one, sql, futureWindow, localToday, loneStudent, signUp, signIn,
  type Client,
} from './helpers';

/**
 * F0a — the grade comes from the cohort and the exam series
 * (FEATURES_PLAN.md F0a, "Grade and eligibility").
 *
 * A student's cohort is the academic year they start grade 10; their grade
 * for a series is 10 + (the series' academic year − cohort). June and January
 * of year Y belong to Y−1/Y, October and November of Y to Y/Y+1. The window's
 * own dates never decide: every window here is a draft opening months from
 * now, and the boundary rows hold whatever today's date is.
 *
 * Where a path needs the window open for the student, a finance admin grants
 * a deadline extension on the draft (the sanctioned way a closed or unopened
 * window opens for one student), so no other suite's open window is touched.
 * Sessions: november/igcse, january/as_level, june/igcse drafts.
 */

const days = (n: number) => n * 86_400_000;

describe('F0a: grade and eligibility', () => {
  let adm: Client, officer: Client, finadmin: Client, coordinator: Client;
  const S: Record<string, string> = {};
  const subj: Record<string, string> = {};
  type Family = { parent: Client; student: Client; studentId: string };
  const scheduleIds: string[] = [];

  const draft = futureWindow();
  const makeSession = (name: string, type: 'june' | 'november' | 'january' | 'october', level: 'igcse' | 'as_level' | 'a_level', seriesYear: number) =>
    session(adm, `${name} (F0a grade)`, type, level, { ...draft, seriesYear });

  const elig = (studentId: string, sessionId: string, who: Client = adm) =>
    apiResponse(who.api.v1.registrations.eligibility.$get({ query: { studentId, sessionId } }));
  const setCohort = async (studentId: string, cohortYear: number) => {
    const now = await one<{ cohort_year: number | null }>(`select cohort_year from "user" where id = $1`, [studentId]);
    if (now.cohort_year === cohortYear) return;
    await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: studentId }, json: { cohortYear, reason: 'boundary table set-up' } }));
  };
  const setSetting = (key: string, value: unknown, who: Client = adm) =>
    apiResponse(who.api.v1.settings[':key'].$put({ param: { key }, json: { value, reason: 'F0a scenario' } }));
  const extend = (studentId: string, sessionId: string) =>
    apiResponse(finadmin.api.v1.exceptions.$post({
      json: { type: 'deadline_extension', studentId, sessionId, reason: 'open the draft for this scenario', validUntil: new Date(Date.now() + days(10)).toISOString() },
    }));
  const family = async (tag: string, grade: 9 | 10 | 11 | 12 = 11): Promise<Family> => onboard(officer, `f0g-${tag}`, grade);

  afterAll(async () => {
    // Never leave a gate, a setting or a core subject behind for later suites.
    for (const id of scheduleIds) await sql(`delete from school_fee_schedule where id = $1`, [id]);
    await sql(`delete from school_setting where key in ('eligibility.graduateRetakes', 'schoolFee.graduatesExempt', 'schoolFee.newYearWithoutSchedule')`);
    if (subj.core) await sql(`update subject set is_core = false where id = $1`, [subj.core]);
  });

  beforeAll(async () => {
    adm = await admin('f0g');
    officer = await staff(adm, 'finance_officer', 'f0g');
    finadmin = await staff(adm, 'finance_admin', 'f0g');
    coordinator = await staff(adm, 'coordinator', 'f0g');
    S.nov2026 = await makeSession('November 2026', 'november', 'igcse', 2026);
    S.jan2027 = await makeSession('January 2027', 'january', 'as_level', 2027);
    S.jun2027 = await makeSession('June 2027', 'june', 'igcse', 2027);
    S.nov2027 = await makeSession('November 2027', 'november', 'igcse', 2027);
    S.jun2028 = await makeSession('June 2028', 'june', 'igcse', 2028);
    S.jan2028 = await makeSession('January 2028', 'january', 'as_level', 2028);
    S.nov2028 = await makeSession('November 2028', 'november', 'igcse', 2028);
    subj.a = await subject(adm, 'F0G-A', 'Geography (F0a grade)', { course: 1000, registration: 200 });
    subj.b = await subject(adm, 'F0G-B', 'History (F0a grade)', { course: 1000, registration: 200 });
    subj.c = await subject(adm, 'F0G-C', 'Economics (F0a grade)', { course: 1000, registration: 200 });
    subj.as = await subject(adm, 'F0G-AS', 'Psychology (AS, F0a grade)', { course: 1000, registration: 200 }, { qualificationLevel: 'as_level' });
  });

  // ─── The boundary table (FEATURES_PLAN.md F0a), one test per row ───────────

  describe('the boundary table', () => {
    let c2026: Family, c2024: Family, gone: Family;

    beforeAll(async () => {
      c2026 = await family('c2026');
      c2024 = await family('c2024');
      gone = await family('gone');
      await setCohort(c2026.studentId, 2026);
      await setCohort(c2024.studentId, 2024);
      await apiResponse(adm.api.v1.students[':id'].leave.$post({ param: { id: gone.studentId }, json: { kind: 'withdrawn', leftOn: localToday(), reason: 'boundary table row 10' } }));
    });

    it('row 1 — cohort 2026/27, November 2026: grade 10, refused (grade 10 sits June only)', async () => {
      expect(await elig(c2026.studentId, S.nov2026!)).toMatchObject({ allowed: false, grade: 10, code: 'grade10_june_only', academicYear: '2026-2027' });
    });

    it('row 2 — cohort 2026/27, January 2027: grade 10, refused', async () => {
      expect(await elig(c2026.studentId, S.jan2027!)).toMatchObject({ allowed: false, grade: 10, code: 'grade10_june_only', academicYear: '2026-2027' });
    });

    it('row 3 — cohort 2026/27, June 2027: grade 10, may register (core subjects locked: below)', async () => {
      expect(await elig(c2026.studentId, S.jun2027!)).toMatchObject({ allowed: true, grade: 10, code: 'ok', academicYear: '2026-2027' });
    });

    it('row 4 — cohort 2026/27, November 2027 (a window opening in June 2027): grade 11 in 2027/28', async () => {
      expect(await elig(c2026.studentId, S.nov2027!)).toMatchObject({ allowed: true, grade: 11, academicYear: '2027-2028', graduateRetake: false });
    });

    it('row 5 — cohort 2024/25, June 2027: grade 12, may register', async () => {
      expect(await elig(c2024.studentId, S.jun2027!)).toMatchObject({ allowed: true, grade: 12, academicYear: '2026-2027' });
    });

    it('row 6 — cohort 2024/25, November 2027: graduated; A-12 on: yes; A-12 off: no', async () => {
      expect(await elig(c2024.studentId, S.nov2027!)).toMatchObject({ allowed: true, grade: 13, graduateRetake: true });
      await setSetting('eligibility.graduateRetakes', false);
      expect(await elig(c2024.studentId, S.nov2027!)).toMatchObject({ allowed: false, grade: 13, code: 'graduate_retakes_off' });
      await setSetting('eligibility.graduateRetakes', true);
    });

    it('row 7 — cohort 2024/25, June 2028: graduated, refused (A-12 covers October, November and January only)', async () => {
      expect(await elig(c2024.studentId, S.jun2028!)).toMatchObject({ allowed: false, grade: 13, code: 'graduated' });
    });

    it('row 8 — cohort 2024/25, January 2028: graduated; A-12 on: yes; off: no', async () => {
      expect(await elig(c2024.studentId, S.jan2028!)).toMatchObject({ allowed: true, grade: 13, graduateRetake: true, academicYear: '2027-2028' });
      await setSetting('eligibility.graduateRetakes', false);
      expect(await elig(c2024.studentId, S.jan2028!)).toMatchObject({ allowed: false, code: 'graduate_retakes_off' });
      await setSetting('eligibility.graduateRetakes', true);
    });

    it('row 9 — cohort 2024/25, November 2028: graduated, refused (A-12 covers only the year right after)', async () => {
      expect(await elig(c2024.studentId, S.nov2028!)).toMatchObject({ allowed: false, grade: 14, code: 'graduated' });
    });

    it('row 10 — a withdrawn student: refused, whatever the series', async () => {
      for (const id of Object.values(S)) {
        const e = await elig(gone.studentId, id);
        expect(e).toMatchObject({ allowed: false, code: 'left' });
        expect(e.reason).toContain('was withdrawn from the school');
      }
    });

    it("a student whose grade was never recorded is refused until it is; the setup page records it once", async () => {
      const lone = await loneStudent(adm, 'f0g-unknown');
      await sql(`update "user" set cohort_year = null where id = $1`, [lone.id]);
      expect(await elig(lone.id, S.jun2027!)).toMatchObject({ allowed: false, code: 'grade_unknown', grade: null });
      // The student finishing their setup records it; a second call changes nothing.
      await apiResponse(lone.api.v1.users.me['student-setup'].$post({ json: { grade: 12 } }));
      await apiResponse(lone.api.v1.users.me['student-setup'].$post({ json: { grade: 10 } }));
      expect((await one<{ cohort_year: number }>(`select cohort_year from "user" where id = $1`, [lone.id])).cohort_year).toBe(academicYearStartOf() - 2);
    });
  });

  // ─── Today's grade changes on 1 July, in Cairo ─────────────────────────────

  describe("today's grade: 1 July in Cairo, whatever the server's zone", () => {
    it('2027-06-30T20:30:00Z is still 30 June (grade 10 for cohort 2026/27); 22:30:00Z is 1 July (grade 11) — in code', () => {
      expect(academicYearStartOf(new Date('2027-06-30T20:30:00Z'))).toBe(2026);
      expect(gradeToday(2026, new Date('2027-06-30T20:30:00Z'))).toBe(10);
      expect(academicYearStartOf(new Date('2027-06-30T22:30:00Z'))).toBe(2027);
      expect(gradeToday(2026, new Date('2027-06-30T22:30:00Z'))).toBe(11);
      // Winter (Cairo on +2): the same boundary, the other side of the year.
      expect(academicYearStartOf(new Date('2027-01-15T12:00:00Z'))).toBe(2026);
    });

    it('the same instants give the same answer in SQL (the form the reports filter with)', async () => {
      expect(await one(`select school_academic_year_start('2027-06-30T20:30:00Z'::timestamptz) as before,
                               school_academic_year_start('2027-06-30T22:30:00Z'::timestamptz) as after,
                               school_grade(2026, school_academic_year_start('2027-06-30T20:30:00Z'::timestamptz)) as grade_before,
                               school_grade(2026, school_academic_year_start('2027-06-30T22:30:00Z'::timestamptz)) as grade_after,
                               school_series_academic_year_start('june', 2027) as june_2027,
                               school_series_academic_year_start('november', 2027) as november_2027,
                               school_series_academic_year_start('january', 2028) as january_2028,
                               school_series_academic_year_start('october', 2027) as october_2027`))
        .toEqual({ before: 2026, after: 2027, grade_before: 10, grade_after: 11, june_2027: 2026, november_2027: 2027, january_2028: 2027, october_2027: 2027 });
    });

    it("the student's page shows today's grade from the cohort, as the SQL computes it now", async () => {
      const f = await family('today');
      await setCohort(f.studentId, 2025);
      const record = await apiResponse(adm.api.v1.students[':id'].$get({ param: { id: f.studentId } }));
      const sqlNow = await one<{ g: number }>(`select school_grade(2025, school_academic_year_start(now())) as g`);
      expect(record.grade).toBe(gradeToday(2025));
      expect(record.grade).toBe(sqlNow.g);
      expect(record.cohort?.label).toBe('2025/26');
    });
  });

  // ─── Every mayRegisterFor call site refuses a grade-10 November and a withdrawn student ──

  describe('every registration path asks mayRegisterFor', () => {
    let g10: Family, gone: Family;
    let seeded: Record<string, { g10: string; gone: string }> = {};
    const regCount = async (studentId: string) =>
      Number((await one<{ n: string }>(`select count(*) as n from registration where student_id = $1`, [studentId])).n);
    // One open registration per student, subject and series: a subject each.
    const seed = async (studentId: string, status: string) => {
      const id = randomUUID();
      const subjectId = { pending_approval: subj.a!, pending_payment: subj.b! }[status]!;
      await sql(`insert into registration (id, student_id, session_id, subject_id, price_at_registration, course_fee_at_registration, registration_fee_at_registration, status, requested_by)
                 values ($1, $2, $3, $4, 1200, 1000, 200, $5, $6)`, [id, studentId, S.nov2026!, subjectId, status, studentId]);
      return id;
    };
    const G10 = 'Grade 10 sits the June series only';
    const GONE = 'was withdrawn from the school';
    const bothRefused = async (label: string, call: (f: Family) => Promise<{ status: number; json(): Promise<unknown> }>) => {
      for (const [f, sentence] of [[g10, G10], [gone, GONE]] as const) {
        const r = await refused(call(f));
        expect(r.status, `${label}: ${r.error}`).toBeGreaterThanOrEqual(400);
        expect(r.status, label).toBeLessThan(500);
        expect(r.error, label).toContain(sentence);
      }
    };

    /**
     * A subject the student sits in November 2026, paid at the desk while they
     * were still eligible (grade 11 then): the change that follows (a cohort
     * moved back, a withdrawal) leaves a paid subject confirmed.
     */
    const paidWhileEligible = async (f: Family) => {
      await extend(f.studentId, S.nov2026!);
      const desk = await apiResponse(officer.api.v1.registrations.desk.$post({
        json: { studentId: f.studentId, sessionId: S.nov2026!, subjectIds: [subj.c!], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
      }));
      return desk.registrations[0]!.id;
    };

    beforeAll(async () => {
      g10 = await family('g10');
      gone = await family('gone2');
      await setCohort(g10.studentId, 2025);
      await setCohort(gone.studentId, 2025);
      const confirmed = { g10: await paidWhileEligible(g10), gone: await paidWhileEligible(gone) };
      // Now a grade-10 student in November 2026's year (a repeated year), and
      // a withdrawn one.
      await setCohort(g10.studentId, 2026);
      await apiResponse(adm.api.v1.students[':id'].leave.$post({ param: { id: gone.studentId }, json: { kind: 'withdrawn', leftOn: localToday(), reason: 'call-site scenario' } }));
      // Waiting rows are seeded after the change: the state a request made at
      // the very moment of it leaves (the clean-up would have expired any made
      // before). The guard, not the clean-up, is under test.
      seeded = {
        approval: { g10: await seed(g10.studentId, 'pending_approval'), gone: await seed(gone.studentId, 'pending_approval') },
        payment: { g10: await seed(g10.studentId, 'pending_payment'), gone: await seed(gone.studentId, 'pending_payment') },
        confirmed,
      };
    });

    it('1 a student request, 2 a parent direct registration, 3 an admin override, 4 the desk — nothing is registered', async () => {
      const before = { g10: await regCount(g10.studentId), gone: await regCount(gone.studentId) };
      await bothRefused('student request', (f) => f.student.api.v1.registrations.request.$post({ json: { sessionId: S.nov2026!, subjectIds: [subj.a!] } }));
      await bothRefused('parent direct', (f) => f.parent.api.v1.registrations.direct.$post({ json: { sessionId: S.nov2026!, subjectIds: [subj.a!], studentId: f.studentId } }));
      await bothRefused('admin override', (f) => adm.api.v1.registrations['admin-override'].$post({ json: { studentId: f.studentId, sessionId: S.nov2026!, subjectIds: [subj.a!], reason: 'override attempt' } }));
      await bothRefused('desk registration', (f) => officer.api.v1.registrations.desk.$post({ json: { studentId: f.studentId, sessionId: S.nov2026!, subjectIds: [subj.a!] } }));
      expect({ g10: await regCount(g10.studentId), gone: await regCount(gone.studentId) }).toEqual(before);
    });

    it('5 a preregistration for the draft series', async () => {
      const before = await regCount(g10.studentId);
      await bothRefused('preregistration', (f) => f.parent.api.v1.registrations.preregister.$post({ json: { sessionId: S.nov2026!, subjectIds: [subj.a!], studentId: f.studentId } }));
      expect(await regCount(g10.studentId)).toBe(before);
    });

    it('6 a parent approving a request, 7 a checkout, 8 the desk taking the money — nothing moves', async () => {
      await bothRefused('approval', (f) => f.parent.api.v1.registrations.approve.$put({ json: { registrationIds: [f === g10 ? seeded.approval!.g10 : seeded.approval!.gone] } }));
      await bothRefused('checkout', (f) => f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [f === g10 ? seeded.payment!.g10 : seeded.payment!.gone], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
      await bothRefused('desk collection', (f) => officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, registrationIds: [f === g10 ? seeded.payment!.g10 : seeded.payment!.gone], instrumentUsed: 'cash' } }));
      for (const id of [seeded.approval!.g10, seeded.approval!.gone]) expect((await one<{ status: string }>(`select status from registration where id = $1`, [id])).status).toBe('pending_approval');
      expect(await sql(`select 1 from payment_registration where registration_id in ($1, $2, $3, $4)`,
        [seeded.approval!.g10, seeded.approval!.gone, seeded.payment!.g10, seeded.payment!.gone])).toEqual([]);
    });

    it('9 a drop request, 10 a swap request, 11 a parent direct swap, 12 approving a swap — nothing changes', async () => {
      const reg = (f: Family) => (f === g10 ? seeded.confirmed!.g10 : seeded.confirmed!.gone);
      await bothRefused('drop request', (f) => f.student.api.v1.registrations[':id']['request-drop'].$post({ param: { id: reg(f) }, json: { reason: 'try a drop' } }));
      await bothRefused('swap request', (f) => f.student.api.v1.registrations[':id']['request-swap'].$post({ param: { id: reg(f) }, json: { newSubjectId: subj.a!, reason: 'try a swap' } }));
      await bothRefused('direct swap', (f) => f.parent.api.v1.registrations[':id'].swap.$post({ param: { id: reg(f) }, json: { newSubjectId: subj.a!, reason: 'try a swap' } }));
      const cr = async (f: Family) => {
        const id = randomUUID();
        await sql(`insert into change_request (id, registration_id, type, requested_by, reason, new_subject_id, price_at_request, price_difference, status)
                   values ($1, $2, 'swap', $3, 'seeded swap', $4, 1200, 0, 'pending_approval')`, [id, reg(f), f.studentId, subj.a!]);
        return id;
      };
      const crs = { g10: await cr(g10), gone: await cr(gone) };
      await bothRefused('swap approval', (f) => f.parent.api.v1['change-requests'][':id'].approve.$put({ param: { id: f === g10 ? crs.g10 : crs.gone }, json: {} }));
      expect(await sql(`select 1 from change_request where registration_id in ($1, $2) and status <> 'pending_approval'`, [reg(g10), reg(gone)])).toEqual([]);
      expect(await sql(`select status from registration where id in ($1, $2) and status <> 'confirmed'`, [reg(g10), reg(gone)])).toEqual([]);
      await sql(`update change_request set status = 'cancelled' where id in ($1, $2)`, [crs.g10, crs.gone]);
    });

    it('13 the subjects offered: none, for a series the student may not register for', async () => {
      for (const f of [g10, gone]) {
        expect(await apiResponse(f.parent.api.v1.registrations.available.$get({ query: { sessionId: S.nov2026!, studentId: f.studentId } }))).toEqual([]);
      }
      // The same grade-10 student is offered June's subjects.
      expect((await apiResponse(g10.parent.api.v1.registrations.available.$get({ query: { sessionId: S.jun2027!, studentId: g10.studentId } }))).length).toBeGreaterThan(0);
    });

    it("the grade-10 exception: a coordinator grants it (audited) and the student may sit that series; revoked, refused again", async () => {
      const granted = await apiResponse(coordinator.api.v1.exceptions.$post({
        json: { type: 'grade10_other_series', studentId: g10.studentId, sessionId: S.nov2026!, reason: 'ready early: sitting Geography in November' },
      }));
      expect((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'EXCEPTION_GRANTED' and entity_id = $1 and user_id = $2`, [granted.id, coordinator.id])).n).toBe('1');
      expect(await elig(g10.studentId, S.nov2026!)).toMatchObject({ allowed: true, grade: 10, grade10ExceptionId: granted.id });
      // Not needed for June, nor for a student who is not in grade 10.
      expect((await refused(coordinator.api.v1.exceptions.$post({ json: { type: 'grade10_other_series', studentId: g10.studentId, sessionId: S.jun2027!, reason: 'june does not need it' } }))).error)
        .toContain('no exception is needed');
      await apiResponse(coordinator.api.v1.exceptions[':id'].revoke.$post({ param: { id: granted.id } }));
      expect(await elig(g10.studentId, S.nov2026!)).toMatchObject({ allowed: false, code: 'grade10_june_only' });
    });
  });

  // ─── The core-subject rule reads the series' grade (A-05) ──────────────────

  describe("the core-subject rule reads the series' grade", () => {
    it('a grade-10 student registering for June 2027 must take the core subjects; a grade-11 student need not', async () => {
      subj.core = await subject(adm, 'F0G-CORE', 'English (core, F0a grade)', { course: 900, registration: 100 }, { isCore: true });
      const ten = await family('core10', 10);
      await setCohort(ten.studentId, 2026);
      const eleven = await family('core11');
      await setCohort(eleven.studentId, 2025);
      for (const f of [ten, eleven]) await extend(f.studentId, S.jun2027!);

      const missing = await refused(ten.parent.api.v1.registrations.direct.$post({ json: { sessionId: S.jun2027!, subjectIds: [subj.a!], studentId: ten.studentId } }));
      expect(missing.error).toBe('Grade 10 June session requires all core subjects. Missing: English (core, F0a grade)');
      const ok = await apiResponse(ten.parent.api.v1.registrations.direct.$post({ json: { sessionId: S.jun2027!, subjectIds: [subj.a!, subj.core], studentId: ten.studentId } }));
      expect(ok.map((r) => r.wasCoreAtRegistration).sort()).toEqual([false, true]);
      // Grade 11 in 2026/27: no core rule, whatever today's grade says.
      const eleventh = await apiResponse(eleven.parent.api.v1.registrations.direct.$post({ json: { sessionId: S.jun2027!, subjectIds: [subj.a!], studentId: eleven.studentId } }));
      expect(eleventh).toHaveLength(1);

      // In grade 9 today, grade 10 in next year's June: the rule follows the
      // series' grade, whatever today's grade is.
      const nine = await family('core9', 9);
      const juneNext = await makeSession('June next year', 'june', 'igcse', seriesYearInAcademicYear('june', academicYearStartOf() + 1));
      await extend(nine.studentId, juneNext);
      expect((await refused(nine.parent.api.v1.registrations.direct.$post({ json: { sessionId: juneNext, subjectIds: [subj.a!], studentId: nine.studentId } }))).error)
        .toBe('Grade 10 June session requires all core subjects. Missing: English (core, F0a grade)');
      await sql(`update subject set is_core = false where id = $1`, [subj.core]);
    });
  });

  // ─── The school-fee gate reads the series' academic year and grade ─────────

  describe("the school-fee gate by series (row 4's fee; A-13; A-14)", () => {
    it("row 4 with a 2027/28 schedule open: the gate asks for 2027/28's fee at grade 11; with none open, registration proceeds", async () => {
      const f = await family('fee4');
      await setCohort(f.studentId, 2026);
      await extend(f.studentId, S.nov2027!);
      const opensAt = new Date(Date.now() - days(1)).toISOString();
      for (const [grade, amount] of [[10, 3000], [11, 4000], [12, 5000]] as const) {
        const s = await apiResponse(finadmin.api.v1['school-fees'].schedules.$post({ json: { academicYear: '2027-2028', grade, amount, opensAt } }));
        scheduleIds.push(s.id);
      }
      const blocked = await refused(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: S.nov2027!, subjectIds: [subj.a!], studentId: f.studentId } }));
      expect(blocked).toEqual({ status: 400, error: 'The 2027-2028 school fee (4000.00 EGP) must be paid before registering subjects' });
      expect(await sql(`select 1 from registration where student_id = $1`, [f.studentId])).toEqual([]);

      // No 2027/28 schedule open yet: the gate is off, as today (A-14 default).
      for (const id of scheduleIds.splice(0)) await apiResponse(finadmin.api.v1['school-fees'].schedules[':id'].$delete({ param: { id } }));
      const made = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: S.nov2027!, subjectIds: [subj.a!], studentId: f.studentId } }));
      expect(made[0]).toMatchObject({ status: 'pending_payment', priceAtRegistration: 1200 });
    });

    it("the fee is paid for the series' year: a parent pays 2027/28's fee ahead and the gate opens", async () => {
      // Only meaningful while 2027/28 is next year or this year; the parent may
      // pay this year's fee and next year's.
      const next = academicYearLabel(academicYearStartOf() + 1);
      const f = await family('fee-ahead');
      await setCohort(f.studentId, academicYearStartOf() - 1);
      const sess = await makeSession('November next year', 'november', 'igcse', seriesYearInAcademicYear('november', academicYearStartOf() + 1));
      await extend(f.studentId, sess);
      const s = await apiResponse(finadmin.api.v1['school-fees'].schedules.$post({ json: { academicYear: next, grade: 12, amount: 4500, opensAt: new Date(Date.now() - days(1)).toISOString() } }));
      scheduleIds.push(s.id);
      const status = await apiResponse(f.parent.api.v1['school-fees'].status.$get({ query: { studentId: f.studentId } }));
      expect(status.nextYear).toMatchObject({ academicYear: next, amount: 4500 });
      const pay = await apiResponse(f.parent.api.v1['school-fees'].pay.$post({ json: { studentId: f.studentId, paymentMethod: 'in_school', academicYear: next } }));
      expect(pay).toMatchObject({ academicYear: next, amount: 4500, purpose: 'school_fee' });
      await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay.id }, json: { instrumentUsed: 'cash' } }));
      const made = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: sess, subjectIds: [subj.a!], studentId: f.studentId } }));
      expect(made).toHaveLength(1);
      // A year beyond next is refused with a sentence.
      const far = academicYearLabel(academicYearStartOf() + 2);
      expect((await refused(f.parent.api.v1['school-fees'].pay.$post({ json: { studentId: f.studentId, paymentMethod: 'in_school', academicYear: far } }))).error)
        .toContain('can be paid for');
      await apiResponse(finadmin.api.v1['school-fees'].schedules[':id'].$delete({ param: { id: s.id } }));
      scheduleIds.splice(scheduleIds.indexOf(s.id), 1);
    });

    it('A-13: a graduate retaking under A-12 owes no school fee; with A-13 off they owe the uniform fee', async () => {
      const f = await family('a13');
      await setCohort(f.studentId, 2024);
      await extend(f.studentId, S.nov2027!);
      const uniform = await apiResponse(finadmin.api.v1['school-fees'].schedules.$post({
        json: { academicYear: '2027-2028', amount: 6000, opensAt: new Date(Date.now() - days(1)).toISOString() },
      }));
      scheduleIds.push(uniform.id);
      const retake = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: S.nov2027!, subjectIds: [subj.a!], studentId: f.studentId } }));
      expect(retake).toHaveLength(1);
      await setSetting('schoolFee.graduatesExempt', false, finadmin);
      expect(await refused(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: S.nov2027!, subjectIds: [subj.b!], studentId: f.studentId } })))
        .toEqual({ status: 400, error: 'The 2027-2028 school fee (6000.00 EGP) must be paid before registering subjects' });
      await setSetting('schoolFee.graduatesExempt', true, finadmin);
      await apiResponse(finadmin.api.v1['school-fees'].schedules[':id'].$delete({ param: { id: uniform.id } }));
      scheduleIds.splice(scheduleIds.indexOf(uniform.id), 1);
    });

    it("A-14 'hold': a series in next year whose fee has not opened waits; 'proceed' lets it through", async () => {
      const f = await family('a14');
      const nextStart = academicYearStartOf() + 1;
      const sess = await makeSession('November after next July', 'november', 'igcse', seriesYearInAcademicYear('november', nextStart));
      await extend(f.studentId, sess);
      await setSetting('schoolFee.newYearWithoutSchedule', 'hold', finadmin);
      const held = await refused(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: sess, subjectIds: [subj.a!], studentId: f.studentId } }));
      expect(held.error).toBe(`The ${academicYearLabel(nextStart)} school fee is not open yet — registration for the November ${seriesYearInAcademicYear('november', nextStart)} series waits until it opens`);
      await setSetting('schoolFee.newYearWithoutSchedule', 'proceed', finadmin);
      expect(await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: sess, subjectIds: [subj.a!], studentId: f.studentId } }))).toHaveLength(1);
    });
  });

  // ─── The inputs take "grade this year" and store the cohort ────────────────

  describe('the inputs take the grade this academic year and store the cohort', () => {
    const cohortOf = async (id: string) => (await one<{ cohort_year: number | null }>(`select cohort_year from "user" where id = $1`, [id])).cohort_year;

    it('sign-up (grade 11), the desk (grade 9: starts grade 10 next year) and the admin (grade 12)', async () => {
      const email = 'f0g.signup@test.local';
      await signUp('Sign Up Student', email);
      const s = await signIn(email);
      await apiResponse(s.api.v1.users.me['student-setup'].$post({ json: { grade: 11 } }));
      expect(await cohortOf(s.id)).toBe(academicYearStartOf() - 1);

      const nine = await family('nine', 9);
      expect(await cohortOf(nine.studentId)).toBe(academicYearStartOf() + 1);
      const e = await elig(nine.studentId, S.jun2027!);
      expect(e.grade).toBe(gradeInAcademicYear(academicYearStartOf() + 1, 2026));

      const made = await apiResponse(adm.api.v1.users.$post({ json: { name: 'Admin Made', email: 'f0g.adminmade@test.local', password: 'TestPass1', role: 'student', grade: 12 } }));
      expect(await cohortOf(made.id)).toBe(academicYearStartOf() - 2);
    });

    it("the admin's cohort correction is audited with the reason and tells the family", async () => {
      const f = await family('correct');
      const r = await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: f.studentId }, json: { gradeNow: 10, reason: 'repeating grade 10' } }));
      expect(r).toMatchObject({ cohortYear: academicYearStartOf(), grade: 10 });
      expect(await one(`select previous_data, new_data from audit_log where action = 'STUDENT_COHORT_CORRECTED' and entity_id = $1`, [f.studentId]))
        .toEqual({ previous_data: { cohortYear: academicYearStartOf() - 1, grade: 11 }, new_data: { cohortYear: academicYearStartOf(), grade: 10, reason: 'repeating grade 10' } });
      // Nothing to correct twice; and only the admin may.
      expect((await refused(adm.api.v1.students[':id'].cohort.$put({ param: { id: f.studentId }, json: { gradeNow: 10, reason: 'repeating grade 10' } }))).status).toBe(409);
      expect((await refused(coordinator.api.v1.students[':id'].cohort.$put({ param: { id: f.studentId }, json: { gradeNow: 11, reason: 'not mine to do' } }))).status).toBe(403);
    });
  });
});
