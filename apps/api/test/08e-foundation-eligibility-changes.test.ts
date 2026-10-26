import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearStartOf, seriesYearInAcademicYear } from '@repo/validations';
import { admin, staff, onboard, subject, session, refused, one, sql, money, audited, notified, openWindow, futureWindow, schoolToday, type Client, reservationOf } from './helpers';

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
      json: { studentId: f.studentId, sessionId: october, ...(await reservationOf(october, [subjectId])), collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: desk.registrations[0]!.id }, json: { reason: 'set-up for escrow' } }));
    return escrowOf(f.studentId);
  };
  /** A subject registered and a checkout started with 300 of escrow applied. */
  const checkout = async (f: Family, subjectId: string) => {
    const reg = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: october, ...(await reservationOf(october, [subjectId])), studentId: f.studentId } })))[0]!.id;
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

    const r = await apiResponse(coordinator.api.v1.students[':id'].leave.$post({ param: { id: f.studentId }, json: { kind: 'withdrawn', leftOn: schoolToday(), reason: 'moved abroad' } }));
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
    expect(found[0]).toMatchObject({ leftKind: 'withdrawn', leftOn: schoolToday() });
    expect((await apiResponse(officer.api.v1.users[':id'].summary.$get({ param: { id: f.studentId } }))).academic.standing).toBe('withdrawn');

    // Back at the school: may register again; what expired stays expired.
    await apiResponse(adm.api.v1.students[':id'].readmit.$post({ param: { id: f.studentId }, json: { reason: 'came back after a term' } }));
    await audited([f.studentId], ['STUDENT_READMITTED']);
    expect(await statusOf('registration', reg)).toBe('expired');
    expect((await apiResponse(adm.api.v1.registrations.eligibility.$get({ query: { studentId: f.studentId, sessionId: october } }))).allowed).toBe(true);
    // Readmission is the admin's; leaving twice is refused.
    expect((await refused(coordinator.api.v1.students[':id'].readmit.$post({ param: { id: f.studentId }, json: { reason: 'not the coordinator' } }))).status).toBe(403);
  });

  it('withdrawn with an in-school checkout open: nothing holds it (only a transfer being checked or InstaPay\'s grace does) — the registration expires and the checkout closes', async () => {
    const f = await family('in-school');
    const reg = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: october, ...(await reservationOf(october, [subj.S3!])), studentId: f.studentId } })))[0]!.id;
    const pay = (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [reg], paymentMethod: 'in_school', escrowAmountToApply: 0 } }))).id!;
    expect(await statusOf('payment', pay)).toBe('pending');

    const r = await apiResponse(coordinator.api.v1.students[':id'].leave.$post({ param: { id: f.studentId }, json: { kind: 'withdrawn', leftOn: schoolToday(), reason: 'left mid-checkout' } }));
    expect(r).toMatchObject({ registrationsExpired: 1, paymentsClosed: 1 });
    expect(await statusOf('registration', reg)).toBe('expired');
    expect(await expiryOf(reg)).toEqual({ was: 'pending_payment', reason: 'ineligible', detail: 'withdrawn' });
    expect(await statusOf('payment', pay)).toBe('failed');
  });

  // P1b (C7): what a correction makes a student unable to sit still strands nothing unless it is a fact about the
  // student (left, not started, finished more than a year ago): the session's grade list is asked of new reservations
  // only, so a line already waiting stays payable. These three cases expired the line before P1b (trail rows).
  it('a cohort moved back a year: the October line stays payable, its checkout open; a new October reservation is refused (grade list); the June line stays', async () => {
    const f = await family('moved-back');
    const funded = await fund(f, subj.S3!);
    const { reg, pay } = await checkout(f, subj.S4!);
    // A June reservation in the same year: theirs to sit in grade 10 too.
    const june = await session(adm, 'June (IGCSE, F0a changes)', 'june', 'igcse', { ...futureWindow(), seriesYear: seriesYearInAcademicYear('june', thisYear), activate: true });
    const igcse = await subject(adm, 'F0E-IG', 'Geography (F0a changes)', { course: 1000, registration: 200 });
    const juneReg = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, ...(await reservationOf(june, [igcse])), studentId: f.studentId } })))[0]!.id;

    const r = await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: f.studentId }, json: { gradeNow: 10, reason: 'repeating grade 10' } }));
    expect(r).toMatchObject({ grade: 10, registrationsExpired: 0, paymentsClosed: 0 });

    expect(await statusOf('registration', reg)).toBe('pending_payment');
    expect(await statusOf('payment', pay)).toBe('pending');
    expect(await escrowOf(f.studentId)).toBe(money(funded - 300));
    expect(await statusOf('registration', juneReg)).toBe('pending_payment');
    const again = await refused(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: october, ...(await reservationOf(october, [subj.S5!])), studentId: f.studentId } }));
    expect(again.error).toContain('is in grade 10 in');
    // The family hears the grade changed.
    await notified(f.student.email, 'GRADE_CHANGED', 1);
    // Leave nothing open: the family cancels the checkout, the 300 comes back.
    await apiResponse(f.parent.api.v1.payments[':id'].cancel.$post({ param: { id: pay } }));
    expect(await escrowOf(f.studentId)).toBe(funded);
  });

  it("graduates taken off the session's grade list: their waiting lines stay payable and a request awaiting approval can no longer be approved (C7; A-12's switch is gone)", async () => {
    const g = await family('graduate', 12);
    // Past grade 12 this year: finished grade 12 last year.
    await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: g.studentId }, json: { cohortYear: thisYear - 3, reason: 'finished grade 12 last June' } }));
    const funded = await fund(g, subj.S5!);
    const { reg, pay } = await checkout(g, subj.S6!);
    const asked = (await apiResponse(g.student.api.v1.registrations.request.$post({ json: { sessionId: october, ...(await reservationOf(october, [subj.S7!])) } })))[0]!.id;

    await apiResponse(adm.api.v1.sessions[':id'].$put({ param: { id: october }, json: { allowedGrades: ['11', '12'] } }));
    try {
      expect(await statusOf('registration', reg)).toBe('pending_payment');
      expect(await statusOf('registration', asked)).toBe('pending_approval');
      expect(await statusOf('payment', pay)).toBe('pending');
      expect(await escrowOf(g.studentId)).toBe(money(funded - 300));
      const approve = await refused(g.parent.api.v1.registrations.approve.$put({ json: { registrationIds: [asked] } }));
      expect(approve.error).toContain('finished grade 12');
      expect(await statusOf('registration', asked)).toBe('pending_approval');
    } finally {
      await apiResponse(adm.api.v1.sessions[':id'].$put({ param: { id: october }, json: { allowedGrades: ['11', '12', 'graduates'] } }));
    }
    await apiResponse(g.parent.api.v1.registrations.reject.$put({ json: { registrationIds: [asked], comments: 'not this series' } }));
    await apiResponse(g.parent.api.v1.payments[':id'].cancel.$post({ param: { id: pay } }));
    expect(await escrowOf(g.studentId)).toBe(funded);
  });

  // Retired (§12: 08e's series correction leaves; trail row "retired 08e series"): "an admin corrects a window's
  // series: registrations students may no longer sit expire". A session's type and year come from its reference
  // sittings now; the correction route is out of the reservation path (code kept, 'a draft session with no
  // preregistrations' below still drives it). No money moved in it (a waiting line, no checkout).

  it("a grade-10 exception revoked: the line it allowed stays payable, new reservations are refused again", async () => {
    const f = await family('g10x', 10);
    const grant = await apiResponse(coordinator.api.v1.exceptions.$post({
      json: { type: 'grade10_other_series', studentId: f.studentId, sessionId: october, reason: 'sitting one AS unit early' },
    }));
    const reg = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: october, ...(await reservationOf(october, [subj.S8!])), studentId: f.studentId } })))[0]!.id;
    const r = await apiResponse(coordinator.api.v1.exceptions[':id'].revoke.$post({ param: { id: grant.id } }));
    expect(r).toMatchObject({ status: 'revoked', registrationsExpired: 0 });
    expect(await statusOf('registration', reg)).toBe('pending_payment');
    expect((await apiResponse(adm.api.v1.registrations.eligibility.$get({ query: { studentId: f.studentId, sessionId: october } }))).code).toBe('grade10_june_only');
  });

  it("a grade-10 exception that runs out: the scheduler lapses it once — its waiting line stays payable, the paid one stands", async () => {
    const f = await family('g10lapse', 10);
    const grant = await apiResponse(coordinator.api.v1.exceptions.$post({
      json: { type: 'grade10_other_series', studentId: f.studentId, sessionId: october, reason: 'one AS unit early', validUntil: new Date(Date.now() + days(2)).toISOString() },
    }));
    const paid = (await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f.studentId, sessionId: october, ...(await reservationOf(october, [subj.S1!])), collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }))).registrations[0]!.id;
    const waiting = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: october, ...(await reservationOf(october, [subj.S7!])), studentId: f.studentId } })))[0]!.id;
    const { lapseGrade10Exceptions } = await import('../src/services/exception-lapse.services');
    const exceptionStatus = async () => (await one<{ status: string }>(`select status from exception where id = $1`, [grant.id])).status;

    // Not yet due: nothing moves.
    expect((await lapseGrade10Exceptions()).lapsed).toBe(0);
    expect(await exceptionStatus()).toBe('active');
    // Its time passes (valid_until moved into the past, as the clock would).
    await sql(`update exception set valid_until = now() - interval '1 minute' where id = $1`, [grant.id]);
    // Two scheduler instances on the same tick: one claims it.
    const [a, b] = await Promise.all([lapseGrade10Exceptions(), lapseGrade10Exceptions()]);
    expect(a.lapsed + b.lapsed).toBe(1);
    expect(await exceptionStatus()).toBe('lapsed');
    expect((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'EXCEPTION_LAPSED' and entity_id = $1`, [grant.id])).n).toBe('1');
    expect(await statusOf('registration', waiting)).toBe('pending_payment');
    expect(await sql(`select 1 from audit_log where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [waiting])).toEqual([]);
    expect(await statusOf('registration', paid)).toBe('confirmed');
    expect(await apiResponse(adm.api.v1.registrations.eligibility.$get({ query: { studentId: f.studentId, sessionId: october } })))
      .toMatchObject({ allowed: false, code: 'grade10_june_only' });
    // A later tick finds nothing.
    expect((await lapseGrade10Exceptions()).lapsed).toBe(0);
  });

  // Retired with preregistration (C4; trail row "retired 08e prereg"): "withdrawn with preregistrations, then the
  // series opens: neither is captured — the paid one keeps its money held". No new held money exists; the capture's
  // PREREG_HELD_INELIGIBLE path stays for rows made before P1b. A withdrawn student's waiting line expiring, its
  // checkout closed and escrow back is stated in the first two cases above.

  // ─── A draft window's series (reviewer flag 6) ─────────────────────────────
  // Changed by the reservations rework (trail row "assertion"; not money): a session's header
  // (PUT /sessions/:id) carries its dates, course start, payment due and refund policy only — its
  // type and year change only through the audited "Correct series", which checks each student
  // again. The flag-6 outcome stands: a draft's series never changes silently under its lines.

  it("a draft session's header never changes its series: the audited series correction is the way", async () => {
    const f = await family('draft-series');
    const draft = await session(adm, 'November (IGCSE, F0a draft edit)', 'november', 'igcse', { ...futureWindow(), seriesYear: seriesYearInAcademicYear('november', thisYear) });
    const igcse = await subject(adm, 'F0E-IG3', 'Geography (F0a draft edit)', { course: 1000, registration: 200 });
    void f; void igcse; // P1b: a draft takes no preregistration (C4); the header's rule needs none.

    const r = await refused(adm.api.v1.sessions[':id'].$put({ param: { id: draft }, json: { seriesYear: thisYear + 1, reason: 'next year' } as never }));
    expect(r).toEqual({ status: 400, error: 'Nothing to change' });
    expect((await one<{ series_year: number }>(`select series_year from registration_session where id = $1`, [draft])).series_year)
      .toBe(seriesYearInAcademicYear('november', thisYear));
    // Other fields still change, audited with the reason in the same transaction.
    const end = new Date((await one<{ end: string }>(`select end_date as end from registration_session where id = $1`, [draft])).end);
    const later = await apiResponse(adm.api.v1.sessions[':id'].$put({ param: { id: draft }, json: { endDate: new Date(end.getTime() + days(1)), reason: 'clearer dates' } }));
    expect(new Date(later.endDate!).getTime()).toBe(end.getTime() + days(1));
    expect(await sql(`select new_data->>'reason' as reason from audit_log where action = 'SESSION_UPDATED' and entity_id = $1`, [draft]))
      .toEqual([{ reason: 'clearer dates' }]);
  });

  it("a draft session with no preregistrations: its series is corrected, its items carried, and the change is audited", async () => {
    const draft = await session(adm, 'January (AS, F0a draft edit)', 'january', 'as_level', { ...futureWindow(), seriesYear: seriesYearInAcademicYear('january', thisYear) });
    const year = (await one<{ y: number }>(`select series_year as y from registration_session where id = $1`, [draft])).y;
    const res = await apiResponse(adm.api.v1.sessions[':id'].series.$put({ param: { id: draft }, json: { sessionType: 'winter', seriesYear: year + 1, reason: 'the board moved it a year' } }));
    expect(res).toMatchObject({ sessionType: 'winter', seriesYear: year + 1, registrationsExpired: 0 });
    const row = await one<{ prev: { sessionType: string; seriesYear: number }; next: { seriesYear: number; reason: string } }>(
      `select previous_data as prev, new_data as next from audit_log where action = 'SESSION_SERIES_CORRECTED' and entity_id = $1`, [draft]);
    expect(row.prev).toEqual({ sessionType: 'winter', seriesYear: year });
    expect(row.next).toMatchObject({ seriesYear: year + 1, reason: 'the board moved it a year' });
    // Its items went with it: every series it is fed by is in the new academic year.
    expect(await sql(`select distinct bs.year from session_offer_item i join board_series bs on bs.id = i.board_series_id where i.session_id = $1 and bs.month <> 'january'`, [draft]))
      .toEqual(await sql(`select distinct bs.year from session_offer_item i join board_series bs on bs.id = i.board_series_id where i.session_id = $1 and bs.month <> 'january' and bs.year = $2`, [draft, year + 1]));
  });
});
