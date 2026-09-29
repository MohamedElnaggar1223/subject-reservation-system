import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearStartOf, seriesYearInAcademicYear } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, refused, one, sql, money, audited, notified, openWindow, futureWindow, localToday,
  type Client,
} from './helpers';

/**
 * F0a — eligibility can change after a registration exists
 * (FEATURES_PLAN.md F0a): a student is withdrawn, an admin corrects a
 * cohort, the school turns A-12 off, an admin corrects a window's series, a
 * grade-10 exception is revoked. Each runs the clean-up graduation ran
 * before F0a (STATE_AUDIT.md ST-04): the registrations the student may no
 * longer sit expire with their audit rows in the change's own transaction;
 * their open checkouts close afterwards, escrow back, audited, the family
 * told. A transfer being checked keeps its registration (08b).
 *
 * Session: october/as_level, open — no other suite uses October. Other
 * windows are drafts opened for one student by a deadline extension.
 */

const days = (n: number) => n * 86_400_000;
const statusOf = async (table: 'payment' | 'registration', id: string) =>
  (await one<{ status: string }>(`select status from ${table} where id = $1`, [id])).status;
const escrowOf = async (studentId: string) =>
  money((await sql<{ balance: string }>(`select balance from escrow where student_id = $1`, [studentId]))[0]?.balance ?? 0);
const expiryOf = async (registrationId: string) =>
  one(`select previous_data->>'status' as was, new_data->>'reason' as reason, new_data->>'detail' as detail
       from audit_log where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [registrationId]);

describe('F0a: when eligibility changes after a registration exists', () => {
  let adm: Client, officer: Client, finadmin: Client, coordinator: Client, october: string;
  const subj: Record<string, string> = {};
  type Family = { parent: Client; student: Client; studentId: string };
  const family = (tag: string, grade: 10 | 11 | 12 = 11): Promise<Family> => onboard(officer, `f0e-${tag}`, grade);
  const thisYear = academicYearStartOf();

  /** Free escrow the way it really happens: paid at the desk, dropped before the receipt left the desk. */
  const fund = async (f: Family, subjectId: string) => {
    const desk = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f.studentId, sessionId: october, subjectIds: [subjectId], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: desk.registrations[0]!.id }, json: { reason: 'set-up for escrow' } }));
    return escrowOf(f.studentId);
  };
  /** A subject registered and a checkout started with 300 of escrow applied. */
  const checkout = async (f: Family, subjectId: string) => {
    const reg = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: october, subjectIds: [subjectId], studentId: f.studentId } })))[0]!.id;
    const pay = (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [reg], paymentMethod: 'instapay', escrowAmountToApply: 300 } }))).id!;
    return { reg, pay };
  };
  const extend = (studentId: string, sessionId: string) =>
    apiResponse(finadmin.api.v1.exceptions.$post({
      json: { type: 'deadline_extension', studentId, sessionId, reason: 'open the draft for this scenario', validUntil: new Date(Date.now() + days(10)).toISOString() },
    }));

  afterAll(async () => {
    await sql(`delete from school_setting where key = 'eligibility.graduateRetakes'`);
  });

  beforeAll(async () => {
    adm = await admin('f0e');
    officer = await staff(adm, 'finance_officer', 'f0e');
    finadmin = await staff(adm, 'finance_admin', 'f0e');
    coordinator = await staff(adm, 'coordinator', 'f0e');
    for (const [i, name] of ['Biology', 'Chemistry', 'Physics', 'Maths', 'Law', 'Art', 'Music', 'Drama'].entries()) {
      subj[`S${i + 1}`] = await subject(adm, `F0E-${i + 1}`, `${name} (AS, F0a changes)`, { course: 1000, registration: 200 }, { qualificationLevel: 'as_level' });
    }
    // The October series of this academic year (IAL's autumn series): open now.
    october = await session(adm, 'October (AS, F0a changes)', 'october', 'as_level', { ...openWindow(), seriesYear: seriesYearInAcademicYear('october', thisYear), activate: true });
  });

  it('withdrawn with a checkout open: the registration expires, the checkout closes, the escrow comes back, the family is told; readmission leaves it expired', async () => {
    const f = await family('withdrawn');
    const funded = await fund(f, subj.S1!);
    const { reg, pay } = await checkout(f, subj.S2!);
    expect(await escrowOf(f.studentId)).toBe(money(funded - 300));

    const r = await apiResponse(coordinator.api.v1.students[':id'].leave.$post({ param: { id: f.studentId }, json: { kind: 'withdrawn', leftOn: localToday(), reason: 'moved abroad' } }));
    expect(r).toMatchObject({ registrationsExpired: 1, paymentsClosed: 1 });

    expect(await statusOf('registration', reg)).toBe('expired');
    expect(await expiryOf(reg)).toEqual({ was: 'pending_payment', reason: 'ineligible', detail: 'withdrawn' });
    expect(await statusOf('payment', pay)).toBe('failed');
    expect(await escrowOf(f.studentId)).toBe(funded);
    await audited([pay], ['PAYMENT_FAILED']);
    await audited([f.studentId], ['STUDENT_LEFT']);
    const notice = await notified(f.parent.email, 'PAYMENT_EXPIRED', 1);
    expect(notice[0]?.body).toContain('has been withdrawn from the school');
    // Shown as such: the desk's search and the student's record.
    const found = await apiResponse(officer.api.v1.users.search.$get({ query: { search: f.student.email } }));
    expect(found[0]).toMatchObject({ leftKind: 'withdrawn', leftOn: localToday() });
    expect((await apiResponse(officer.api.v1.users[':id'].summary.$get({ param: { id: f.studentId } }))).academic.standing).toBe('withdrawn');

    // Back at the school: may register again; what expired stays expired.
    await apiResponse(adm.api.v1.students[':id'].readmit.$post({ param: { id: f.studentId }, json: { reason: 'came back after a term' } }));
    await audited([f.studentId], ['STUDENT_READMITTED']);
    expect(await statusOf('registration', reg)).toBe('expired');
    expect((await apiResponse(adm.api.v1.registrations.eligibility.$get({ query: { studentId: f.studentId, sessionId: october } }))).allowed).toBe(true);
    // Readmission is the admin's; leaving twice is refused.
    expect((await refused(coordinator.api.v1.students[':id'].readmit.$post({ param: { id: f.studentId }, json: { reason: 'not the coordinator' } }))).status).toBe(403);
  });

  it('a cohort moved back a year: the October registration is now out of reach (grade 10: June only) and expires; its checkout closes; the June registration stays', async () => {
    const f = await family('moved-back');
    const funded = await fund(f, subj.S3!);
    const { reg, pay } = await checkout(f, subj.S4!);
    // A June registration in the same year: still theirs to sit in grade 10.
    const june = await session(adm, 'June (IGCSE, F0a changes)', 'june', 'igcse', { ...futureWindow(), seriesYear: seriesYearInAcademicYear('june', thisYear) });
    const igcse = await subject(adm, 'F0E-IG', 'Geography (F0a changes)', { course: 1000, registration: 200 });
    await extend(f.studentId, june);
    const juneReg = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, subjectIds: [igcse], studentId: f.studentId } })))[0]!.id;

    const r = await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: f.studentId }, json: { gradeNow: 10, reason: 'repeating grade 10' } }));
    expect(r).toMatchObject({ grade: 10, registrationsExpired: 1, paymentsClosed: 1 });

    expect(await statusOf('registration', reg)).toBe('expired');
    expect(await expiryOf(reg)).toEqual({ was: 'pending_payment', reason: 'ineligible', detail: 'cohort_corrected' });
    expect(await statusOf('payment', pay)).toBe('failed');
    expect(await escrowOf(f.studentId)).toBe(funded);
    await audited([pay], ['PAYMENT_FAILED']);
    expect(await statusOf('registration', juneReg)).toBe('pending_payment');
    const notice = await notified(f.parent.email, 'PAYMENT_EXPIRED', 1);
    expect(notice[0]?.body).toContain("grade was corrected");
    // The family hears the grade changed.
    await notified(f.student.email, 'GRADE_CHANGED', 1);
  });

  it('A-12 turned off with graduates\' registrations pending: they expire in the transaction that turns it off; the checkout closes; turning it on again revives nothing', async () => {
    const g = await family('graduate', 12);
    // Past grade 12 this year: finished grade 12 last year (A-12 lets them sit October).
    await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: g.studentId }, json: { cohortYear: thisYear - 3, reason: 'finished grade 12 last June' } }));
    const funded = await fund(g, subj.S5!);
    const { reg, pay } = await checkout(g, subj.S6!);
    const asked = (await apiResponse(g.student.api.v1.registrations.request.$post({ json: { sessionId: october, subjectIds: [subj.S7!] } })))[0]!.id;
    // A student in grade 12 this year is not touched.
    const twelve = await family('twelve', 12);
    const kept = (await apiResponse(twelve.parent.api.v1.registrations.direct.$post({ json: { sessionId: october, subjectIds: [subj.S7!], studentId: twelve.studentId } })))[0]!.id;

    // Only the admin may change A-12.
    expect((await refused(finadmin.api.v1.settings[':key'].$put({ param: { key: 'eligibility.graduateRetakes' }, json: { value: false, reason: 'not mine to change' } }))).status).toBe(403);
    await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'eligibility.graduateRetakes' }, json: { value: false, reason: 'the school stops graduate retakes' } }));

    for (const id of [reg, asked]) {
      expect(await statusOf('registration', id)).toBe('expired');
      expect((await expiryOf(id) as { detail: string }).detail).toBe('graduate_retakes_off');
    }
    expect(await statusOf('registration', kept)).toBe('pending_payment');
    expect(await statusOf('payment', pay)).toBe('failed');
    expect(await escrowOf(g.studentId)).toBe(funded);
    await audited([pay], ['PAYMENT_FAILED']);
    await audited(['eligibility.graduateRetakes'], ['SETTING_CHANGED']);
    // The setting and the expiries committed together: same transaction time.
    const [setAt, expAt] = await Promise.all([
      one<{ t: string }>(`select created_at::text as t from audit_log where action = 'SETTING_CHANGED' and entity_id = 'eligibility.graduateRetakes' order by created_at desc limit 1`),
      one<{ t: string }>(`select created_at::text as t from audit_log where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [asked]),
    ]);
    expect(expAt.t).toBe(setAt.t);
    await notified(g.parent.email, 'PAYMENT_EXPIRED', 1);

    await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'eligibility.graduateRetakes' }, json: { value: true, reason: 'graduate retakes back on' } }));
    expect(await statusOf('registration', asked)).toBe('expired');
  });

  it("an admin corrects a window's series: registrations students may no longer sit expire, audited with the correction", async () => {
    const f = await family('series', 12);
    const nov = await session(adm, 'November (IGCSE, F0a series)', 'november', 'igcse', { ...futureWindow(), seriesYear: seriesYearInAcademicYear('november', thisYear) });
    const igcse = await subject(adm, 'F0E-IG2', 'History (F0a series)', { course: 1000, registration: 200 });
    await extend(f.studentId, nov);
    const reg = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: nov, subjectIds: [igcse], studentId: f.studentId } })))[0]!.id;
    // The window was really for next year's June: past grade 12 by then, and June is not a retake series.
    const r = await apiResponse(adm.api.v1.sessions[':id'].series.$put({
      param: { id: nov }, json: { sessionType: 'june', seriesYear: seriesYearInAcademicYear('june', thisYear + 1), reason: 'typed the wrong series' },
    }));
    expect(r).toMatchObject({ sessionType: 'june', registrationsExpired: 1 });
    expect(await statusOf('registration', reg)).toBe('expired');
    expect((await expiryOf(reg) as { detail: string }).detail).toBe('series_corrected');
    await audited([nov], ['SESSION_SERIES_CORRECTED']);
    // The same series again is refused; only the admin corrects a series.
    expect((await refused(adm.api.v1.sessions[':id'].series.$put({ param: { id: nov }, json: { sessionType: 'june', seriesYear: seriesYearInAcademicYear('june', thisYear + 1), reason: 'no change at all' } }))).status).toBe(409);
  });

  it("a grade-10 exception revoked: the registration it allowed expires", async () => {
    const f = await family('g10x', 10);
    const grant = await apiResponse(coordinator.api.v1.exceptions.$post({
      json: { type: 'grade10_other_series', studentId: f.studentId, sessionId: october, reason: 'sitting one AS unit early' },
    }));
    const reg = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: october, subjectIds: [subj.S8!], studentId: f.studentId } })))[0]!.id;
    const r = await apiResponse(coordinator.api.v1.exceptions[':id'].revoke.$post({ param: { id: grant.id } }));
    expect(r).toMatchObject({ status: 'revoked', registrationsExpired: 1 });
    expect(await statusOf('registration', reg)).toBe('expired');
    expect((await expiryOf(reg) as { detail: string }).detail).toBe('exception_revoked');
  });
});
