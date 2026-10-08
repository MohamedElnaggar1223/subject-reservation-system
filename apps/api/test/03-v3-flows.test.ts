import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import { admin, staff, onboard, subject, session, refused, one, sql, waitFor, notificationsFor, money, openWindow, futureWindow, type Client, reservationOf } from './helpers';

/**
 * The original approval workflow and the V3 flows that had never run before
 * the foundation audit: the school-fee gate with a waiver and the three views
 * that must agree (RF-10), the held wallet, and results → remark → outcome.
 * FOUNDATION_AUDIT.md checkpoints 13, 14, 16, 17.
 */
describe('V3 flows', () => {
  let adm: Client, officer: Client, finadmin: Client, parent: Client, student: Client, studentId: string;
  let business: string, economics: string, physicsA: string, juneA: string, januaryA: string;
  let preregId: string;
  let scheduleId: string | null = null;
  let academicYear: string;

  afterAll(async () => {
    // Safety net if the gate test failed midway: never leave a schedule
    // behind that would gate the other suites.
    if (scheduleId) await sql(`delete from school_fee_schedule where id = $1`, [scheduleId]);
  });

  const feeViews = async () => {
    const desk = await apiResponse(officer.api.v1.users[':id'].summary.$get({ param: { id: studentId } }));
    const home = await apiResponse(parent.api.v1.users.me['home-summary'].$get());
    const status = await apiResponse(parent.api.v1['school-fees'].status.$get({ query: { studentId } }));
    const pick = (o: { required: boolean; waived: boolean; paid: boolean; amount: number | null }) =>
      ({ required: o.required, waived: o.waived, paid: o.paid, amount: o.amount });
    return { desk: pick(desk.schoolFee), due: desk.schoolFeesDue, home: pick(home.children[0]!.schoolFee), status: pick(status) };
  };

  beforeAll(async () => {
    adm = await admin('v3');
    officer = await staff(adm, 'finance_officer', 'v3');
    finadmin = await staff(adm, 'finance_admin', 'v3');
    business = await subject(adm, 'T9609', 'Business (AS)', { course: 1100, registration: 300 }, { qualificationLevel: 'a_level' });
    economics = await subject(adm, 'T9708', 'Economics (AS)', { course: 1100, registration: 300 }, { qualificationLevel: 'a_level' });
    physicsA = await subject(adm, 'T9702', 'Physics (A2)', { course: 1200, registration: 300 }, { qualificationLevel: 'a_level' });
    const window = openWindow();
    academicYear = window.academicYear;
    juneA = await session(adm, 'June (A-Level)', 'june', 'a_level', { ...window, activate: true });
    ({ parent, student, studentId } = await onboard(officer, 'v3'));
  });

  it('student requests, parent sees it pending and approves (REG-001/002)', async () => {
    const created = await apiResponse(student.api.v1.registrations.request.$post({ json: { sessionId: juneA, ...(await reservationOf(juneA, [business])) } }));
    const requested = created[0]!;
    expect(requested.status).toBe('pending_approval');
    await waitFor(async () => (await notificationsFor(parent.email, 'REGISTRATION_REQUEST_RECEIVED')).length === 1 || null);

    const pending = await apiResponse(parent.api.v1.registrations.pending.$get());
    expect(pending.map((p) => p.id)).toEqual([requested.id]);

    const approved = await apiResponse(
      parent.api.v1.registrations.approve.$put({ json: { registrationIds: [requested.id], comments: 'ok' } })
    );
    expect(approved[0]).toMatchObject({ status: 'pending_payment', priceAtRegistration: 1400 });
    expect((await one<{ approved_by: string }>(`select approved_by from registration where id = $1`, [requested.id])).approved_by).toBe(parent.id);
  });

  it('school-fee gate blocks with a sentence, a waiver unblocks, and all three views agree both ways (RF-10)', async () => {
    const opensAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const schedule = await apiResponse(
      finadmin.api.v1['school-fees'].schedules.$post({ json: { academicYear, amount: 5000, opensAt } })
    );
    scheduleId = schedule.id;

    const twice = await refused(
      finadmin.api.v1['school-fees'].schedules.$post({ json: { academicYear, amount: 4000, opensAt } })
    );
    expect(twice).toEqual({ status: 409, error: 'A schedule for that academic year and grade already exists' });

    const blocked = await refused(student.api.v1.registrations.request.$post({ json: { sessionId: juneA, ...(await reservationOf(juneA, [economics])) } }));
    expect(blocked).toEqual({ status: 400, error: `The ${academicYear} school fee (5000.00 EGP) must be paid before registering subjects` });

    const due = { required: true, waived: false, paid: false, amount: 5000 };
    expect(await feeViews()).toEqual({ desk: due, due: [{ academicYear, amount: 5000 }], home: due, status: due });

    expect((await refused(officer.api.v1.exceptions.$post({ json: { type: 'fee_waiver', studentId, reason: 'officer may not' } }))).status).toBe(403);
    await apiResponse(finadmin.api.v1.exceptions.$post({ json: { type: 'fee_waiver', studentId, reason: 'scholarship' } }));

    const waived = { required: false, waived: true, paid: false, amount: 5000 };
    expect(await feeViews()).toEqual({ desk: waived, due: [], home: waived, status: waived });

    // The desk must refuse to take a waived fee, not only hide the button.
    const collect = await refused(officer.api.v1['school-fees']['desk-pay'].$post({ json: { studentId, instrumentUsed: 'cash' } }));
    expect(collect.status).toBe(400);
    expect(collect.error).toBe(`The ${academicYear} school fee is waived for this student — nothing to collect`);
    expect(await sql(`select 1 from payment where student_id = $1 and purpose = 'school_fee'`, [studentId])).toEqual([]);

    await apiResponse(student.api.v1.registrations.request.$post({ json: { sessionId: juneA, ...(await reservationOf(juneA, [economics])) } }));

    // The schedule gates every family in the shared test database for this
    // academic year; remove it so the other suites are not affected by order.
    await apiResponse(finadmin.api.v1['school-fees'].schedules[':id'].$delete({ param: { id: scheduleId } }));
    scheduleId = null;
  });

  it('held wallet: preregister for a draft session, pay at the desk into held, capture on activation', async () => {
    const draft = futureWindow();
    // The reservations rework (RESERVATIONS_REWORK.md §3.1, §3.3): a winter session is valid;
    // "IGCSE sits neither October nor January" is checked per item, so an IGCSE item entered in a
    // January series is refused (it was a January IGCSE window that was refused before).
    const igcse = await subject(adm, 'T4MA1', 'Mathematics (IGCSE, v3 flows)', { course: 1000, registration: 400 }, { council: 'pearson_edexcel' });
    const winter = await session(adm, 'Winter (IGCSE, v3 flows)', 'november', 'igcse', draft);
    const offer = (await apiResponse(adm.api.v1.sessions[':id'].offers.$get({ param: { id: winter } }))).offers.find((o) => o.subjectId === igcse)!;
    const year = (await one<{ y: number }>(`select series_year as y from registration_session where id = $1`, [winter])).y;
    const january = await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', month: 'january', year: year + 1, label: 'v3 flows' } }));
    const wrongLevel = await refused(adm.api.v1.sessions[':id'].offers[':offerId'].items.$post({
      param: { id: winter, offerId: offer.id },
      json: { label: 'Whole subject (January)', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: january.id, availability: 'open', requiredInSeries: false },
    }));
    expect(wrongLevel).toEqual({ status: 400, error: 'IGCSE sits neither October nor January: an IGCSE item is entered in a June or November series' });

    januaryA = await session(adm, 'January (A-Level)', 'january', 'a_level', draft);
    const pre = await apiResponse(parent.api.v1.registrations.preregister.$post({ json: { sessionId: januaryA, ...(await reservationOf(januaryA, [physicsA])), studentId } }));
    preregId = pre[0]!.id;
    expect(pre[0]).toMatchObject({ status: 'preregistered', priceAtRegistration: 1500 });

    const pay = await apiResponse(
      parent.api.v1.payments.initiate.$post({ json: { registrationIds: [preregId], paymentMethod: 'in_school', escrowAmountToApply: 0 } })
    );
    expect(pay).toMatchObject({ purpose: 'preregistration', amount: 1500 });
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay.id! }, json: { instrumentUsed: 'cash' } }));

    const held = await one<{ balance: string; held: string }>(`select balance, held_balance as held from escrow where student_id = $1`, [studentId]);
    expect([money(held.balance), money(held.held)]).toEqual([0, 1500]);
    expect((await one<{ status: string }>(`select status from registration where id = $1`, [preregId])).status).toBe('preregistered');
    expect((await one<{ status: string }>(`select status from receipt where registration_id = $1`, [preregId])).status).toBe('pending_issue');
    const home = await apiResponse(parent.api.v1.users.me['home-summary'].$get());
    expect(home.children[0]?.escrow).toEqual({ freeBalance: 0, heldBalance: 1500 });

    await apiResponse(adm.api.v1.sessions[':id'].activate.$post({ param: { id: januaryA } }));
    await waitFor(async () => (await one<{ status: string }>(`select status from registration where id = $1`, [preregId])).status === 'confirmed' || null);
    const after = await one<{ balance: string; held: string }>(`select balance, held_balance as held from escrow where student_id = $1`, [studentId]);
    expect([money(after.balance), money(after.held)]).toEqual([0, 0]);
    const ledger = await sql<{ amount: string; type: string; reason: string; balance_type: string }>(
      `select e.amount, e.type, e.reason, e.balance_type from escrow_transaction e join escrow x on x.id = e.escrow_id where x.student_id = $1 order by e.created_at`, [studentId]
    );
    expect(ledger.map((l) => [money(l.amount), l.type, l.reason, l.balance_type])).toEqual([
      [1500, 'credit', 'prereg_hold', 'held'],
      [1500, 'debit', 'prereg_capture', 'held'],
    ]);
    await waitFor(async () => (await notificationsFor(parent.email, 'SESSION_OPENED')).length >= 1 || null);
  });

  it('results → remark → outcome: Cambridge allows one request, consent gates payment, a grade change refunds the fee', async () => {
    await apiResponse(finadmin.api.v1.remarks.fees.$put({ json: { council: 'cambridge', serviceType: 'review_of_marking', amountPerPaper: 800 } }));
    expect(await apiResponse(officer.api.v1.remarks.results.$post({ json: { results: [{ registrationId: preregId, grade: 'B' }] } }))).toEqual({ recorded: 1, skipped: 0 });
    expect((await one<{ grade_received: string }>(`select grade_received from registration where id = $1`, [preregId])).grade_received).toBe('B');

    const remark = await apiResponse(
      parent.api.v1.remarks.$post({
        json: { registrationId: preregId, serviceType: 'review_of_marking', papers: [{ paperCode: '9702/22', paperName: 'Paper 2' }, { paperCode: '9702/42', paperName: 'Paper 4' }] },
      })
    );
    expect(remark).toMatchObject({ status: 'pending_consent', feeCharged: 1600 });

    const second = await refused(parent.api.v1.remarks.$post({ json: { registrationId: preregId, serviceType: 'review_of_marking', papers: [{ paperCode: '9702/52' }] } }));
    expect(second.status).toBe(409);
    expect(second.error).toContain('Cambridge accepts only ONE enquiry');

    const payEarly = await refused(parent.api.v1.remarks[':id'].pay.$post({ param: { id: remark.id }, json: { paymentMethod: 'in_school' } }));
    expect(payEarly.error).toBe('Request is not awaiting payment');
    expect(payEarly.status).toBeLessThan(500);

    await apiResponse(parent.api.v1.remarks[':id'].consent.$post({ param: { id: remark.id }, json: { attest: true } }));
    expect((await one<{ status: string }>(`select status from remark_request where id = $1`, [remark.id])).status).toBe('pending_payment');

    await apiResponse(parent.api.v1.remarks[':id'].pay.$post({ param: { id: remark.id }, json: { paymentMethod: 'in_school' } }));
    const remarkPayment = await one<{ id: string; amount: string; status: string }>(
      `select id, amount, status from payment where student_id = $1 and purpose = 'remark'`, [studentId]
    );
    expect([money(remarkPayment.amount), remarkPayment.status]).toEqual([1600, 'pending']);
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: remarkPayment.id }, json: { instrumentUsed: 'cash' } }));
    expect((await one<{ status: string }>(`select status from remark_request where id = $1`, [remark.id])).status).toBe('awaiting_submission');

    await apiResponse(officer.api.v1.remarks[':id']['submit-board'].$post({ param: { id: remark.id }, json: { boardReference: 'CIE-REM-TEST-1' } }));
    expect(await one(`select status, board_reference from remark_request where id = $1`, [remark.id])).toEqual({ status: 'submitted', board_reference: 'CIE-REM-TEST-1' });

    const items = await sql<{ id: string; paper_code: string }>(`select id, paper_code from remark_request_item where remark_request_id = $1 order by paper_code`, [remark.id]);
    expect(items.map((i) => i.paper_code)).toEqual(['9702/22', '9702/42']);
    const outcome = await apiResponse(
      officer.api.v1.remarks[':id'].outcome.$post({
        param: { id: remark.id },
        json: { items: [{ itemId: items[0]!.id, outcome: 'unchanged' }, { itemId: items[1]!.id, outcome: 'mark_up', gradeAfter: 'A' }], gradeChanged: true, comments: 'paper 4 up' },
      })
    );
    expect(outcome).toEqual({ refunded: true });
    expect(await one(`select status, fee_refunded from remark_request where id = $1`, [remark.id])).toEqual({ status: 'outcome_recorded', fee_refunded: true });
    expect(money((await one<{ balance: string }>(`select balance from escrow where student_id = $1`, [studentId])).balance)).toBe(1600);
  });

  it('a subject with no price cannot be registered on any path: the student\'s request, the parent\'s direct registration, the desk', async () => {
    const unpriced = await subject(adm, 'T0000', 'Unpriced (AS)', { course: 0, registration: 0 }, { qualificationLevel: 'a_level' });
    const sentence = 'Unpriced (AS) has no price yet: the admin sets the fees on Subjects before anyone can register';
    const before = await sql(`select id from registration where subject_id = $1`, [unpriced]);
    expect(await refused(student.api.v1.registrations.request.$post({ json: { sessionId: juneA, subjectIds: [unpriced] } }))).toEqual({ status: 400, error: sentence });
    expect(await refused(parent.api.v1.registrations.direct.$post({ json: { sessionId: juneA, subjectIds: [unpriced], studentId } }))).toEqual({ status: 400, error: sentence });
    expect(await refused(officer.api.v1.registrations.desk.$post({ json: { studentId, sessionId: juneA, subjectIds: [unpriced] } }))).toEqual({ status: 400, error: sentence });
    expect(await sql(`select id from registration where subject_id = $1`, [unpriced])).toEqual(before);
    // Once the admin sets its fees, the same request goes through at that price.
    await apiResponse(adm.api.v1.subjects[':id'].$put({ param: { id: unpriced }, json: { courseFee: 500, registrationFee: 100 } }));
    const made = await apiResponse(parent.api.v1.registrations.direct.$post({ json: { sessionId: juneA, subjectIds: [unpriced], studentId } }));
    expect(made.map((r) => [r.status, Number(r.priceAtRegistration)])).toEqual([['pending_payment', 600]]);
  });

  it.todo('RF-09: the registration grade of record updates after a successful remark (currently stays at the pre-remark grade)');
});
