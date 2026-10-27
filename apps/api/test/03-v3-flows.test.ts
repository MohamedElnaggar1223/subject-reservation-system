import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import { admin, staff, onboard, subject, session, refused, one, sql, waitFor, notificationsFor, money, openWindow, futureWindow, type Client, reservationOf, sessionName, confirmed, type Impact } from './helpers';

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
    expect(blocked).toEqual({ status: 400, error: `The ${academicYear} school fee (EGP 5,000) must be paid before registering subjects` });

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

  it('a draft takes no reservation (C4); opened, the line is reserved and paid at the desk, confirmed with its receipt', async () => {
    const draft = futureWindow();
    // The reservations rework (RESERVATIONS_REWORK.md §3.1, §3.3): a winter session is valid;
    // "IGCSE sits neither October nor January" is checked per row, so an IGCSE row placed in a
    // January sitting is refused (it was a January IGCSE window that was refused before). P1c: the old item
    // route that asked it is gone; the coordinator's subject editor asks it when she moves a row's sitting.
    const igcse = await subject(adm, 'T4MA1', 'Mathematics (IGCSE, v3 flows)', { course: 1000, registration: 400 }, { council: 'pearson_edexcel' });
    const winter = await session(adm, 'Winter (IGCSE, v3 flows)', 'november', 'igcse', draft);
    const offering = await one<{ id: string }>(`select id from session_offer where session_id = $1 and subject_id = $2`, [winter, igcse]);
    const row = await one<{ id: string }>(`select id from session_offer_item where offer_id = $1`, [offering.id]);
    const wrongLevel = await refused(adm.api.v1.sessions[':id'].offerings[':offeringId'].$put({
      param: { id: winter, offeringId: offering.id },
      json: { rows: [{ id: row.id, kind: 'all_papers', sitting: 'january', cells: { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false } }] },
    }));
    expect(wrongLevel).toEqual({ status: 409, error: 'IGCSE sits neither October nor January: an IGCSE item is entered in a June or November series' });
    expect((await one<{ month: string }>(`select bs.month from session_offer_item i join board_series bs on bs.id = i.board_series_id where i.id = $1`, [row.id])).month).toBe('november');

    // The coordinator rework (C4): a draft is invisible to families, so it takes no reservation (the preregistration
    // route that asked it left with P1c) and the held wallet (prereg_hold, prereg_capture) retires with it. Its money
    // outcome — what a family pays for a line it reserved is that line's price, confirmed with its receipt — is stated
    // here on the session once opened.
    januaryA = await session(adm, 'January (A-Level)', 'january', 'a_level', draft);
    const pre = await refused(parent.api.v1.registrations.direct.$post({ json: { sessionId: januaryA, studentId, ...(await reservationOf(januaryA, [physicsA])) } }));
    expect(pre).toEqual({ status: 400, error: `${await sessionName(januaryA)} is not open for reservations yet` });
    expect(await sql(`select 1 from registration where session_id = $1`, [januaryA])).toEqual([]);

    await apiResponse(adm.api.v1.sessions[':id'].activate.$post({ param: { id: januaryA } }));
    const line = await apiResponse(parent.api.v1.registrations.direct.$post({ json: { sessionId: januaryA, ...(await reservationOf(januaryA, [physicsA])), studentId } }));
    preregId = line[0]!.id;
    expect(line[0]).toMatchObject({ status: 'pending_payment', priceAtRegistration: 1500 });

    const pay = await apiResponse(
      parent.api.v1.payments.initiate.$post({ json: { registrationIds: [preregId], paymentMethod: 'in_school', escrowAmountToApply: 0 } })
    );
    expect(pay).toMatchObject({ purpose: 'registration', amount: 1500 });
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay.id! }, json: { instrumentUsed: 'cash' } }));

    expect((await one<{ status: string }>(`select status from registration where id = $1`, [preregId])).status).toBe('confirmed');
    expect((await one<{ status: string }>(`select status from receipt where registration_id = $1`, [preregId])).status).toBe('pending_issue');
    // Nothing went through the wallet: paid at the desk, the money is the line's (no escrow row moved).
    expect(await sql(`select 1 from escrow_transaction e join escrow x on x.id = e.escrow_id where x.student_id = $1`, [studentId])).toEqual([]);
    expect(money((await one<{ amount: string }>(`select amount from payment where id = $1 and status = 'completed'`, [pay.id!])).amount)).toBe(1500);
    const home = await apiResponse(parent.api.v1.users.me['home-summary'].$get());
    expect(home.children[0]?.escrow).toEqual({ freeBalance: 0, heldBalance: 0 });
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

  it('a row with no exam fee set cannot be reserved on any path — the student\'s request, the parent\'s direct reservation, the desk — and the refusal says it is not set yet (F7 review flag 1)', async () => {
    // A subject not on the reference list the school adds with a course fee and no exam fee yet (the board has not
    // published it). P1c: the grid row finance set on the Fees tab is the row's exam fee, which the coordinator sets
    // (PUT /sessions/:id/rows/:rowId/exam-fee) — the same 100 the grid row carried.
    const teacher = await apiResponse(adm.api.v1.teachers.$post({ json: { name: 'Teacher of the unpriced subject (v3)' } }));
    const made = await apiResponse(adm.api.v1.sessions[':id'].offerings.$post({
      param: { id: juneA }, json: { custom: { board: 'cambridge', name: 'Unpriced (AS)', level: 'as_al', group: 'A.S./A.L.', code: 'T0000' } },
    }));
    const saved = await apiResponse(adm.api.v1.sessions[':id'].offerings[':offeringId'].$put({
      param: { id: juneA, offeringId: made.id },
      json: {
        accepting: true, courseFee: 500, teachers: [{ teacherId: teacher!.id, online: false, external: false }],
        rows: [{ kind: 'all_papers', referenceCodes: ['T0000'], sitting: 'june', cells: { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false } }],
      },
    }));
    const rowId = saved.offering.rows[0]!.id;
    expect(saved.offering.rows[0]!.examFee).toBeNull();
    const unpriced = made.subject.id;
    const sentence = 'Unpriced (AS) has no exam fee set yet: it is not offered to families until the school sets it';
    const lines = await reservationOf(juneA, [unpriced]);
    const before = await sql(`select id from registration where subject_id = $1`, [unpriced]);
    expect(await refused(student.api.v1.registrations.request.$post({ json: { sessionId: juneA, ...lines } }))).toEqual({ status: 400, error: sentence });
    expect(await refused(parent.api.v1.registrations.direct.$post({ json: { sessionId: juneA, studentId, ...lines } }))).toEqual({ status: 400, error: sentence });
    expect(await refused(officer.api.v1.registrations.desk.$post({ json: { studentId, sessionId: juneA, ...lines } }))).toEqual({ status: 400, error: sentence });
    expect(await sql(`select id from registration where subject_id = $1`, [unpriced])).toEqual(before);
    // Once the coordinator sets the row's exam fee, the same reservation goes through at that price.
    await confirmed((expected?: Impact) => apiResponse(adm.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: juneA, rowId }, json: { amount: 100, ...(expected ? { expected } : {}) } })));
    const done = await apiResponse(parent.api.v1.registrations.direct.$post({ json: { sessionId: juneA, studentId, ...lines } }));
    expect(done.map((r) => [r.status, Number(r.priceAtRegistration)])).toEqual([['pending_payment', 600]]);
    expect(await one(`select course_fee_at_registration::float as course, registration_fee_at_registration::float as exam from registration where id = $1`, [done[0]!.id])).toEqual({ course: 500, exam: 100 });
  });

  it.todo('RF-09: the registration grade of record updates after a successful remark (currently stays at the pre-remark grade)');
});
