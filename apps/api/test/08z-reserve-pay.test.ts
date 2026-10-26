import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, IMPACT_CHANGED_REFUSAL } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, refused, refusedWithCode, one, sql, money, openWindow, futureWindow, reservationOf, passCutOff,
  runPaymentDeadlines, confirmed, holdRowLock, lockWaiters, boardDate, cairoDateIn, type Client, type Impact,
} from './helpers';
import { schoolDate } from '../src/services/window.services';
import { PRICES_FINAL_UNPRICED_REFUSAL } from '../src/services/setup/session-setup.services';

/**
 * 08z — reserving and paying (COORDINATOR_REWORK.md P1b; §6, §9.2, §10, §12's list).
 *
 * mayReserve (may a new line be made) and mayPay (may a waiting line be paid) are two checks: closing the session
 * or a subject stops the first and never the second; a waiting line is payable until its cut-off — its due date +
 * the session's unpaid-cancel days, never past its board deadline — and expires there (reason cut_off, or
 * entry_deadline when the board's date is the earlier). Each case drives the routes as the family page and the desk
 * do and reads the money back from the database.
 *
 * It also restates the money outcomes of the files P1b retired with the per-series machinery (trail rows "retired
 * 08i/08k/08m" and "retired 08-money-rules prereg"): a checkout spanning two cut-offs; each line at its own board
 * deadline; a line never payable after its board deadline; the time for an InstaPay reference never past it; a
 * transfer that arrives after it credited to the balance in full.
 *
 * Sessions: June and November IGCSE, each with a label of its own (its own sittings); every subject is offered in
 * every one of them (helpers). Families are grade 11 unless a case says otherwise.
 */

const RUN = Math.random().toString(36).slice(2, 6);

describe('08z: reserving and paying', () => {
  let adm: Client, coordinator: Client, officer: Client, finadmin: Client;
  // S: the main June session; W: the November before it; C: closed by the coordinator; B: its board deadline passes;
  // G: a grade list; P: prices not final; D: drops after the close.
  let S: string, W: string, C: string, B: string, G: string, P: string, D: string;
  const subj: Record<string, string> = {};
  const name: Record<string, string> = {};
  type Family = Awaited<ReturnType<typeof onboard>>;

  const family = (tag: string, grade: 11 | 12 = 11) => onboard(officer, `z08-${tag}-${RUN}`, grade);
  const reserve = async (f: Family, sessionId: string, subjectIds: string[], extra: { answers?: { questionId: string; value: string }[] } = {}) =>
    f.parent.api.v1.registrations.direct.$post({ json: { sessionId, studentId: f.studentId, ...(await reservationOf(sessionId, subjectIds)), ...extra } });
  const reserved = async (f: Family, sessionId: string, subjectIds: string[]) => (await apiResponse(reserve(f, sessionId, subjectIds))).map((r) => r.id);
  const statusOf = async (table: 'registration' | 'payment', id: string) => (await one<{ status: string }>(`select status from ${table} where id = $1`, [id])).status;
  const lineOf = (id: string) => one<{ status: string; price: number; course: number; exam: number; provisional: boolean; attempt: string; prior: string | null; teacher: string | null; due: string }>(
    `select status, price_at_registration::float as price, course_fee_at_registration::float as course, registration_fee_at_registration::float as exam,
       price_provisional as provisional, attempt, prior_sitting_series_id as prior, teacher_id as teacher, due_at as due from registration where id = $1`, [id]);
  const escrowOf = async (studentId: string) => money((await sql<{ b: string }>(`select balance as b from escrow where student_id = $1`, [studentId]))[0]?.b ?? 0);
  const expiryOf = async (id: string) => (await sql<{ reason: string }>(`select new_data->>'reason' as reason from audit_log where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [id])).map((r) => r.reason);
  const cutOffOf = async (id: string) => new Date((await one<{ c: string }>(
    `select line_cut_off(due_at, session_id, attempt, prior_sitting_series_id, board_series_id, declaration_rejected) as c from registration where id = $1`, [id])).c);
  const offeringOf = async (sessionId: string, subjectId: string) => (await one<{ id: string }>(`select id from session_offer where session_id = $1 and subject_id = $2`, [sessionId, subjectId])).id;
  const rowsOf = async (sessionId: string, subjectId: string) => (await sql<{ id: string; kind: string }>(
    `select i.id, i.kind from session_offer_item i join session_offer o on o.id = i.offer_id where o.session_id = $1 and o.subject_id = $2 order by i.sort_order, i.id`, [sessionId, subjectId]));
  const putOffering = (sessionId: string, offeringId: string, json: Parameters<Client['api']['v1']['sessions'][':id']['offerings'][':offeringId']['$put']>[0]['json']) =>
    confirmed((expected?: Impact) => apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: sessionId, offeringId }, json: { ...json, ...(expected ? { expected } : {}) } })));
  const sittingOf = async (sessionId: string) => (await one<{ s: string }>(`select distinct i.board_series_id as s from session_offer_item i where i.session_id = $1`, [sessionId])).s;
  const deskCollect = (f: Family, ids: string[], escrow = 0) =>
    officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, registrationIds: ids, instrumentUsed: 'cash', escrowAmountToApply: escrow } });
  const initiate = (f: Family, ids: string[], method: 'in_school' | 'instapay', escrow = 0) =>
    f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: ids, paymentMethod: method, escrowAmountToApply: escrow } });
  /** Free balance the way it really happens: a line paid at the desk and dropped while its receipt is at the desk (100% in week 1). */
  const fund = async (f: Family, sessionId: string, subjectId: string) => {
    const [l] = await reserved(f, sessionId, [subjectId]);
    await apiResponse(deskCollect(f, [l!]));
    await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: l! }, json: { reason: 'set-up for a balance' } }));
    return escrowOf(f.studentId);
  };

  beforeAll(async () => {
    adm = await admin(`z08-${RUN}`);
    coordinator = await staff(adm, 'coordinator', `z08-${RUN}`);
    officer = await staff(adm, 'finance_officer', `z08-${RUN}`);
    finadmin = await staff(adm, 'finance_admin', `z08-${RUN}`);
    const open = { ...openWindow(), activate: true };
    W = await session(adm, 'November (08z)', 'november', 'igcse', open);
    S = await session(adm, 'June (08z)', 'june', 'igcse', open);
    C = await session(adm, 'June (08z, closed)', 'june', 'igcse', open);
    B = await session(adm, 'June (08z, board deadline)', 'june', 'igcse', open);
    G = await session(adm, 'June (08z, grade list)', 'june', 'igcse', open);
    P = await session(adm, 'June (08z, prices)', 'june', 'igcse', open);
    D = await session(adm, 'June (08z, drops)', 'june', 'igcse', open);
    for (const [k, n] of [['s1', 'Geography'], ['s2', 'History'], ['s3', 'Economics'], ['s4', 'Physics'], ['s5', 'Chemistry'], ['s6', 'Art']] as const) {
      name[k] = `${n} (08z ${RUN})`;
      subj[k] = await subject(adm, `Z08${k.toUpperCase()}${RUN}`, name[k]!, { course: 1000, registration: 500 });
    }
  });

  // ─── The close: mayReserve stops, mayPay goes on ───────────────────────────

  it("the coordinator's close stops new reservations and leaves a waiting line payable: paid after the close in the app and at the desk (C10)", async () => {
    const f = await family('close');
    const [a, b] = await reserved(f, C, [subj.s1!, subj.s2!]);
    const closed = await apiResponse(coordinator.api.v1.sessions[':id'].close.$post({ param: { id: C }, json: { reason: '08z: the coordinator closes the session' } }));
    expect(closed.status).toBe('closed');
    // Nothing waiting for payment expired with the close.
    expect([await statusOf('registration', a!), await statusOf('registration', b!)]).toEqual(['pending_payment', 'pending_payment']);
    expect(await expiryOf(a!)).toEqual([]);
    // mayReserve: no new line.
    const again = await refusedWithCode(reserve(f, C, [subj.s3!]));
    expect(again.error).toMatch(/ is not taking reservations \(it closed on .+\)$/);
    expect(again.code).toBe('NOT_ACCEPTING');
    expect(await sql(`select 1 from registration where student_id = $1 and session_id = $2 and subject_id = $3`, [f.studentId, C, subj.s3!])).toEqual([]);
    // mayPay: the app's checkout, confirmed by the desk…
    const pay = await apiResponse(initiate(f, [a!], 'in_school'));
    expect(pay.amount).toBe((await lineOf(a!)).price);
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay.id! }, json: { instrumentUsed: 'cash' } }));
    expect(await statusOf('registration', a!)).toBe('confirmed');
    expect(await one(`select status from receipt where registration_id = $1`, [a!])).toEqual({ status: 'pending_issue' });
    // …and the desk's own collection.
    const col = await apiResponse(deskCollect(f, [b!]));
    expect(col.collected).toBe((await lineOf(b!)).price);
    expect(await statusOf('registration', b!)).toBe('confirmed');
    const paid = await one<{ s: string }>(`select coalesce(sum(p.amount), 0) as s from payment p where p.student_id = $1 and p.status = 'completed'`, [f.studentId]);
    expect(money(paid.s)).toBe(3000);
    // Reopened: reservations again.
    await apiResponse(coordinator.api.v1.sessions[':id'].reopen.$post({ param: { id: C }, json: { reason: '08z: reopened' } }));
    expect(await reserved(f, C, [subj.s3!])).toHaveLength(1);
  });

  // ─── F2, D5, D6, the grade list, D13 ───────────────────────────────────────

  it('F2: a student known to have sat a subject sees its retakes only, the sitting filled in; a first entry is refused, the retake taken at its price', async () => {
    const f = await family('f2');
    const [sat] = await reserved(f, W, [subj.s1!]);
    await apiResponse(deskCollect(f, [sat!]));
    const nov = (await one<{ s: string; y: number }>(`select r.board_series_id as s, bs.year as y from registration r join board_series bs on bs.id = r.board_series_id where r.id = $1`, [sat!]));
    const read = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: S, studentId: f.studentId } }));
    const row = read.offerings.find((o) => o.name === name.s1)!.rows[0]!;
    expect(row.knownSitting?.label.en).toBe(`November ${nov.y}`);
    expect(row.options.map((o) => o.attempt)).toEqual(['retake', 'retake']);
    const first = await refusedWithCode(reserve(f, S, [subj.s1!]));
    expect(first).toEqual({ status: 409, error: `${name.s1} was sat before (November ${nov.y}): reserve it as a retake`, code: 'RETAKE_ONLY' });
    const [item] = await rowsOf(S, subj.s1!);
    const [r] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: {
      sessionId: S, studentId: f.studentId, consent: (await reservationOf(S, [])).consent,
      lines: [{ offerItemId: item!.id, attempt: 'retake', mode: 'in_school', priorSittingSeriesId: nov.s }],
    } }));
    expect(await lineOf(r!.id)).toMatchObject({ status: 'pending_payment', attempt: 'retake', prior: nov.s, price: 1500, course: 1000, exam: 500 });
  });

  it('D5: with two teachers the family chooses one, required; where the school assigns none is asked; one teacher is preselected', async () => {
    const [t1, t2] = await Promise.all(['One', 'Two'].map(async (n) => (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher ${n} (08z ${RUN})` } }))).id));
    const offering = await offeringOf(S, subj.s3!);
    await putOffering(S, offering, { teachers: [t1!, t2!].map((teacherId) => ({ teacherId, online: false, external: false })) });
    const f = await family('d5');
    expect(await refusedWithCode(reserve(f, S, [subj.s3!]))).toEqual({ status: 400, error: `Choose the teacher of ${name.s3}`, code: 'TEACHER_REQUIRED' });
    expect(await sql(`select 1 from registration where student_id = $1`, [f.studentId])).toEqual([]);
    const [l] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: S, studentId: f.studentId, ...(await reservationOf(S, [subj.s3!], { teachers: { [subj.s3!]: t2! } })) } }));
    expect((await lineOf(l!.id)).teacher).toBe(t2);
    // The school assigns: nothing asked, no teacher yet.
    await putOffering(S, offering, { teacherChoice: 'school' });
    const g = await family('d5-school');
    const [m] = await reserved(g, S, [subj.s3!]);
    expect((await lineOf(m!)).teacher).toBeNull();
    // One teacher: preselected.
    await putOffering(S, offering, { teacherChoice: 'families', teachers: [{ teacherId: t1!, online: false, external: false }] });
    const h = await family('d5-one');
    const [n] = await reserved(h, S, [subj.s3!]);
    expect((await lineOf(n!)).teacher).toBe(t1);
  });

  it("D6: a carried row takes the earlier exams on her list — one past the board's carry-forward months is taken, marked for her (the months only warn); one not on her list is refused", async () => {
    const offering = await offeringOf(S, subj.s4!);
    const [all] = await rowsOf(S, subj.s4!);
    const year = (await one<{ y: number }>(`select bs.year as y from session_offer_item i join board_series bs on bs.id = i.board_series_id where i.id = $1`, [all!.id])).y;
    await putOffering(S, offering, { rows: [
      { id: all!.id, kind: 'all_papers', cells: { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false } },
      { kind: 'paper', referenceCodes: ['41', '42'], sitting: 'june', examFee: 400, cells: { firstInSchool: false, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false },
        allowedPriorSittings: [{ month: 'november', year: year - 1 }, { month: 'november', year: year - 2 }] },
    ] });
    const read = await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$get({ param: { id: S, offeringId: offering } }));
    const paper = read.rows.find((r) => r.kind === 'paper')!;
    // The warning: the November before last (19 months back) is outside Cambridge's 13 months.
    expect(paper.allowedPriorSittings.map((p) => [p.month, p.year, p.beyondCarryForward])).toEqual([['november', year - 1, false], ['november', year - 2, true]]);
    const line = (month: 'june' | 'november', y: number) => ({ offerItemId: paper.id, attempt: 'retake' as const, mode: 'self_study' as const, priorSitting: { month, year: y } });
    const f = await family('d6');
    const consent = (await reservationOf(S, [])).consent;
    const off = await refusedWithCode(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: S, studentId: f.studentId, consent, lines: [line('june', year - 1)] } }));
    expect(off.error).toBe(`June ${year - 1} is not one of the earlier exams ${name.s4} — ${paper.label} is carried from`);
    expect(off.code).toBe('CARRIED_FROM_NOT_ALLOWED');
    const [l] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: S, studentId: f.studentId, consent, lines: [line('november', year - 2)] } }));
    expect(await lineOf(l!.id)).toMatchObject({ status: 'pending_payment', attempt: 'retake', price: 900, exam: 400, course: 500 });
  });

  it('the grade list is asked of a new reservation only: off the list nothing is reserved, and a line already held stays payable', async () => {
    const f = await family('grade', 11);
    const [l] = await reserved(f, G, [subj.s1!]);
    await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: G }, json: { allowedGrades: ['12'] } }));
    const off = await refused(reserve(f, G, [subj.s2!]));
    expect(off.error).toMatch(/is in grade 11 in .+, and this session takes grade 12/);
    expect((await apiResponse(adm.api.v1.registrations.eligibility.$get({ query: { studentId: f.studentId, sessionId: G } })))).toMatchObject({ allowed: false, code: 'grade_not_listed' });
    // Paying asks the rest of eligibility, not the list.
    expect((await apiResponse(deskCollect(f, [l!]))).collected).toBe(1500);
    expect(await statusOf('registration', l!)).toBe('confirmed');
    const twelve = await family('grade12', 12);
    expect(await reserved(twelve, G, [subj.s2!])).toHaveLength(1);
  });

  it('D13: a required question is answered with the reservation, by one of its choices; unanswered or off its choices, nothing is reserved', async () => {
    const offering = await offeringOf(S, subj.s5!);
    await putOffering(S, offering, { questions: [{ kind: 'choice', prompt: 'Lab group', choices: ['Saturday', 'Monday'], required: true }] });
    const f = await family('d13');
    const q = (await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: S, studentId: f.studentId } })))
      .offerings.find((o) => o.name === name.s5)!.questions[0]!;
    expect(await refusedWithCode(reserve(f, S, [subj.s5!]))).toMatchObject({ error: 'Answer: Lab group', code: 'ANSWER_REQUIRED' });
    expect((await refused(reserve(f, S, [subj.s5!], { answers: [{ questionId: q.id, value: 'Sunday' }] }))).error).toBe('Lab group: choose one of Saturday, Monday');
    expect(await sql(`select 1 from registration where student_id = $1`, [f.studentId])).toEqual([]);
    const [l] = await apiResponse(reserve(f, S, [subj.s5!], { answers: [{ questionId: q.id, value: 'Monday' }] }));
    expect(await one(`select value, answered_by as by from registration_answer where question_id = $1 and student_id = $2`, [q.id, f.studentId])).toEqual({ value: 'Monday', by: f.parent.id });
    // Never its price.
    expect((await lineOf(l!.id)).price).toBe(1500);
  });

  // ─── Prices final (E6) ─────────────────────────────────────────────────────

  it('prices not final: a line is reserved, not payable at the checkout or the desk; switched final, it is paid at its price', async () => {
    await apiResponse(coordinator.api.v1.sessions[':id']['prices-final'].$put({ param: { id: P }, json: { final: false } }));
    const f = await family('prices');
    const [l] = await reserved(f, P, [subj.s1!]);
    expect(await lineOf(l!)).toMatchObject({ status: 'pending_payment', provisional: true, price: 1500 });
    const notFinal = 'The prices of this session are not final yet: the subject is reserved, and it can be paid once the school confirms its prices';
    expect(await refusedWithCode(initiate(f, [l!], 'in_school'))).toMatchObject({ error: notFinal, code: 'PRICES_NOT_FINAL' });
    expect(await refusedWithCode(deskCollect(f, [l!]))).toMatchObject({ error: notFinal, code: 'PRICES_NOT_FINAL' });
    expect(await sql(`select 1 from payment_registration where registration_id = $1`, [l!])).toEqual([]);
    await confirmed((expected?: Impact) => apiResponse(coordinator.api.v1.sessions[':id']['prices-final'].$put({ param: { id: P }, json: { final: true, ...(expected ? { expected } : {}) } })));
    expect((await lineOf(l!)).provisional).toBe(false);
    expect((await apiResponse(deskCollect(f, [l!]))).collected).toBe(1500);
  });

  // ─── The cut-off ───────────────────────────────────────────────────────────

  it('a checkout spanning two cut-offs is one payment; at the first its checkout fails (the balance comes back), that line expires (cut_off), the other stays payable', async () => {
    const f = await family('two');
    const balance = await fund(f, S, subj.s6!);
    expect(balance).toBe(1500);
    const [k, l] = await reserved(f, S, [subj.s1!, subj.s2!]);
    // The second line is due ten days later (a row's own pay-by date, as she may set one).
    await sql(`update registration set due_at = due_at + interval '10 days' where id = $1`, [l!]);
    const pay = await apiResponse(initiate(f, [k!, l!], 'in_school', 100));
    // Both lines, 3,000, 100 of it from the balance.
    expect(pay.amount).toBe(2900);
    expect(await one(`select amount::float as a, escrow_amount_applied::float as e from payment where id = $1`, [pay.id!])).toEqual({ a: 2900, e: 100 });
    expect(await escrowOf(f.studentId)).toBe(1400);
    const cut = (await passCutOff([k!])).get(k!)!;
    expect(cut.getTime()).toBeLessThan(Date.now());
    expect((await cutOffOf(l!)).getTime()).toBeGreaterThan(Date.now());
    await runPaymentDeadlines();
    expect(await statusOf('payment', pay.id!)).toBe('failed');
    expect(await escrowOf(f.studentId)).toBe(1500);
    expect(await statusOf('registration', k!)).toBe('expired');
    expect(await expiryOf(k!)).toEqual(['cut_off']);
    expect(await statusOf('registration', l!)).toBe('pending_payment');
    // Expired, it is no longer paid; the other still is.
    expect(await refusedWithCode(deskCollect(f, [k!]))).toMatchObject({ error: 'One or more subjects are not waiting for payment', code: 'NOT_WAITING' });
    expect((await apiResponse(deskCollect(f, [l!]))).collected).toBe(1500);
    expect(await statusOf('registration', l!)).toBe('confirmed');
  });

  it('an InstaPay checkout with no reference at its cut-off has 24 hours more for it; the reference sent, the transfer is confirmed', async () => {
    const f = await family('insta');
    const [n] = await reserved(f, S, [subj.s1!]);
    const pay = await apiResponse(initiate(f, [n!], 'instapay'));
    const cut = (await passCutOff([n!])).get(n!)!;
    // Past its cut-off a waiting line is not paid another way: the desk is refused, by name and date.
    expect(await refusedWithCode(deskCollect(f, [n!]))).toMatchObject({
      error: `${name.s1} was not paid by ${schoolDate(cut)}, its last day to pay: it can no longer be paid — reserve it again while it is offered`, code: 'CUT_OFF_PASSED',
    });
    const run = await runPaymentDeadlines();
    expect(run.referencesDueSet).toBeGreaterThanOrEqual(1);
    const due = new Date((await one<{ d: string }>(`select reference_due_at as d from payment where id = $1`, [pay.id!])).d).getTime();
    expect(Math.abs(due - (cut.getTime() + 24 * 3600_000))).toBeLessThan(1000);
    expect(await statusOf('registration', n!)).toBe('pending_payment');
    await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: pay.id! }, json: { reference: `FT-Z08-${RUN}-1` } }));
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay.id! }, json: { notes: 'on the statement' } }));
    expect(await statusOf('registration', n!)).toBe('confirmed');
    expect(money((await one<{ a: string }>(`select amount as a from payment where id = $1 and status = 'completed'`, [pay.id!])).a)).toBe(1500);
  });

  // ─── The board deadline ─────────────────────────────────────────────────────

  describe("the board's deadline: each line at its own; a transfer under verification until it; a late transfer to the balance", () => {
    let f: Family, inS: string, insta: string, instaPay: string, transfer: string, transferPay: string, never: string, sitting: string, deadline: Date;

    beforeAll(async () => {
      f = await family('board');
      sitting = await sittingOf(B);
      // A balance, part of it put into the InstaPay checkout: the per-series step gives it back when it fails it.
      expect(await fund(f, S, subj.s6!)).toBe(1500);
      inS = (await reserved(f, S, [subj.s2!]))[0]!;
      [insta, transfer, never] = (await reserved(f, B, [subj.s1!, subj.s2!, subj.s4!])) as [string, string, string];
      instaPay = (await apiResponse(initiate(f, [insta!], 'instapay', 300))).id!;
      expect(await one(`select amount::float as a, escrow_amount_applied::float as e from payment where id = $1`, [instaPay])).toEqual({ a: 1200, e: 300 });
      expect(await escrowOf(f.studentId)).toBe(1200);
      transferPay = (await apiResponse(initiate(f, [transfer!], 'instapay'))).id!;
      await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: transferPay }, json: { reference: `FT-Z08-${RUN}-2` } }));
      // The board's deadline is two hours away, well inside an InstaPay grace that would start now.
      deadline = new Date(Date.now() + 2 * 3600_000);
      await sql(`update board_series set entry_deadline = $1 where id = $2`, [deadline.toISOString(), sitting]);
    });

    it("a line's cut-off never passes its board deadline, and the time for an InstaPay reference stops there too", async () => {
      // `never` is due long after the deadline: its cut-off is the deadline itself.
      await sql(`update registration set due_at = now() + interval '60 days' where id = $1`, [never!]);
      expect((await cutOffOf(never!)).getTime()).toBe(deadline.getTime());
      await passCutOff([insta!, transfer!]);
      await runPaymentDeadlines();
      const due = new Date((await one<{ d: string }>(`select reference_due_at as d from payment where id = $1`, [instaPay])).d).getTime();
      expect(Math.abs(due - deadline.getTime())).toBeLessThan(1000);
      // The transfer under verification protects its line past its cut-off, until the board's deadline.
      expect(await statusOf('payment', transferPay)).toBe('pending_verification');
      expect(await statusOf('registration', transfer!)).toBe('pending_payment');
    });

    it("past the deadline nothing is paid or confirmed; the sweep fails the open payments and expires the lines (entry_deadline); the line in the other session's sitting stays", async () => {
      await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [sitting]);
      const at = new Date((await one<{ d: string }>(`select entry_deadline as d from board_series where id = $1`, [sitting])).d);
      const passed = (what: string) => `${what}: the exam board's entry deadline (${schoolDate(at)}) has passed`;
      expect(await refusedWithCode(officer.api.v1.payments[':id'].confirm.$post({ param: { id: transferPay }, json: {} }))).toMatchObject({ status: 400, error: passed(name.s2!), code: 'BOARD_DEADLINE_PASSED' });
      expect(await refusedWithCode(initiate(f, [never!], 'in_school'))).toMatchObject({ error: passed(name.s4!), code: 'BOARD_DEADLINE_PASSED' });
      expect(await refusedWithCode(deskCollect(f, [never!]))).toMatchObject({ error: passed(name.s4!), code: 'BOARD_DEADLINE_PASSED' });
      expect(await escrowOf(f.studentId)).toBe(1200);
      await runPaymentDeadlines();
      expect([await statusOf('payment', instaPay), await statusOf('payment', transferPay)]).toEqual(['failed', 'failed']);
      // The balance the failed checkout held comes back once, in full (retired 08i: escrow back on each failed payment).
      expect(money((await one<{ s: string }>(`select coalesce(sum(amount), 0) as s from escrow_transaction where related_payment_id = $1 and type = 'credit'`, [instaPay])).s)).toBe(300);
      for (const id of [insta!, transfer!, never!]) expect(await statusOf('registration', id)).toBe('expired');
      // The reason is the earlier date's: the two protected lines' own cut-off came first (they waited on their
      // payments past it), the third's cut-off was the board's deadline itself.
      expect([await expiryOf(insta!), await expiryOf(transfer!), await expiryOf(never!)]).toEqual([['cut_off'], ['cut_off'], ['entry_deadline']]);
      expect(await statusOf('registration', inS!)).toBe('pending_payment');
      expect(await escrowOf(f.studentId)).toBe(1500);
    });

    it('a transfer found on the statement after the deadline goes to the balance in full; the line is never confirmed after it', async () => {
      await apiResponse(finadmin.api.v1.payments[':id']['record-transfer'].$post({
        param: { id: transferPay }, json: { notes: 'on the statement, sent before the deadline', reference: `FT-Z08-${RUN}-2B`, amount: 1500 },
      }));
      expect(await escrowOf(f.studentId)).toBe(3000);
      expect(await statusOf('registration', transfer!)).toBe('expired');
      expect(await sql(`select 1 from registration r where r.id = $1 and exists (select 1 from receipt where registration_id = r.id)`, [transfer!])).toEqual([]);
    });
  });

  // ─── Drops after the close, until "sent" ───────────────────────────────────

  it("after the close a family drops a paid line until its entry is sent, with the board fee back; once sent the desk drops it and the board fee stays", async () => {
    const f = await family('drops');
    const [t, u] = await reserved(f, D, [subj.s1!, subj.s2!]);
    await apiResponse(deskCollect(f, [t!, u!]));
    await apiResponse(coordinator.api.v1.sessions[':id'].close.$post({ param: { id: D }, json: { reason: '08z: drops after the close' } }));
    // Before "sent", in week 1 of the course: the whole price back (its receipt is still at the desk: credited now).
    await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: t! }, json: { reason: 'not sitting it after all' } }));
    expect(await statusOf('registration', t!)).toBe('dropped');
    expect(await escrowOf(f.studentId)).toBe(1500);
    // The board's deadline passes: the entry is the board's ("sent").
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [await sittingOf(D)]);
    const refusedDrop = await refused(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: u! }, json: { reason: 'changed our mind' } }));
    expect(refusedDrop.error).toMatch(/^The entry is with the board \(its deadline, .+, has passed\): ask the finance desk to drop it$/);
    const done = await apiResponse(officer.api.v1.registrations[':id']['desk-drop'].$post({ param: { id: u! }, json: { reason: 'the family asked at the desk' } }));
    expect(done).toMatchObject({ refundAmount: 1000, boardSent: true });
    expect(await escrowOf(f.studentId)).toBe(2500);
  });

  // ─── The P1b review's fixes ────────────────────────────────────────────────

  describe("the P1b review's fixes", () => {
    const fresh = (label: string) => session(adm, `June (08z, ${label})`, 'june', 'igcse', { ...openWindow(), activate: true });

    it('D1: cutting the unpaid-cancel days answers the lines whose last day to pay comes earlier, and those already past it; counts that moved are refused (IMPACT_CHANGED); confirmed, the next tick expires those past it', async () => {
      const X = await fresh('days');
      const f = await family('days');
      const [a, b] = await reserved(f, X, [subj.s1!, subj.s2!]);
      // a: due two days ago (its cut-off, 3 days on, is tomorrow); b: due in five days.
      await sql(`update registration set due_at = now() - interval '2 days' where id = $1`, [a!]);
      await sql(`update registration set due_at = now() + interval '5 days' where id = $1`, [b!]);
      const send = (expected?: Impact) => coordinator.api.v1.sessions[':id'].$put({ param: { id: X }, json: { unpaidCancelDays: 0, ...(expected ? { expected } : {}) } });
      const shown = await apiResponse(send());
      expect(shown).toMatchObject({ saved: false, impact: { repriced: 0, listedForFinance: 0, linesAffected: 0, dueDatesMoved: 0, cutOffsEarlier: 2, cutOffsPassed: 1 } });
      const days = async () => (await one<{ d: number }>(`select unpaid_cancel_days as d from registration_session where id = $1`, [X])).d;
      expect(await days()).toBe(3);
      // The counts of a screen that knew nothing of cut-offs: refused, nothing written.
      expect(await refusedWithCode(send({ repriced: 0, listedForFinance: 0, linesAffected: 0, dueDatesMoved: 0 })))
        .toEqual({ status: 409, error: IMPACT_CHANGED_REFUSAL, code: 'IMPACT_CHANGED' });
      expect(await days()).toBe(3);
      expect((await apiResponse(send(shown.impact))).saved).toBe(true);
      expect(await days()).toBe(0);
      expect(await one(`select (new_data->>'cutOffsEarlier')::int as e, (new_data->>'cutOffsPassed')::int as p from audit_log where action = 'SESSION_UPDATED' and entity_id = $1`, [X]))
        .toEqual({ e: 2, p: 1 });
      expect((await cutOffOf(a!)).getTime()).toBeLessThan(Date.now());
      await runPaymentDeadlines();
      expect(await statusOf('registration', a!)).toBe('expired');
      expect(await expiryOf(a!)).toEqual(['cut_off']);
      expect(await statusOf('registration', b!)).toBe('pending_payment');
    });

    it("D2: a request awaiting the parent on a closed subject stays through the tick while the student holds a later reserve date, and is approved at its price; without one it expires", async () => {
      const X = await fresh('requests');
      const [f, g] = [await family('req'), await family('req-none')];
      const ask = async (h: Family) => (await apiResponse(h.student.api.v1.registrations.request.$post({ json: { sessionId: X, ...(await reservationOf(X, [subj.s1!])) } })))[0]!.id;
      const [kept, gone] = [await ask(f), await ask(g)];
      await apiResponse(finadmin.api.v1.exceptions.$post({ json: {
        policyKey: 'deadline.reserve', studentId: f.studentId, scope: { sessionId: X }, value: cairoDateIn(10), reason: '08z: may still reserve after the close',
      } }));
      await putOffering(X, await offeringOf(X, subj.s1!), { accepting: false });
      await runPaymentDeadlines();
      expect(await statusOf('registration', kept)).toBe('pending_approval');
      expect(await expiryOf(kept)).toEqual([]);
      expect(await statusOf('registration', gone)).toBe('expired');
      expect(await expiryOf(gone)).toEqual(['subject_closed']);
      await apiResponse(f.parent.api.v1.registrations.approve.$put({ json: { registrationIds: [kept] } }));
      expect(await lineOf(kept)).toMatchObject({ status: 'pending_payment', price: 1500, course: 1000, exam: 500 });
    });

    it("L-lead: prices final is refused, its rows named (PRICE_NOT_SET), while a waiting line's row has no exam fee; such a line under final prices is refused by its subject's price (PRICES_NOT_FINAL), and its exam fee set makes it payable", async () => {
      const X = await fresh('unpriced');
      await apiResponse(coordinator.api.v1.sessions[':id']['prices-final'].$put({ param: { id: X }, json: { final: false } }));
      const f = await family('unpriced');
      const [l] = await reserved(f, X, [subj.s1!]);
      const [row] = await rowsOf(X, subj.s1!);
      expect(await lineOf(l!)).toMatchObject({ status: 'pending_payment', provisional: true });
      // An older row: priced from the deprecated fee grid, with no exam fee of its own.
      await sql(`update session_offer_item set exam_fee = null, exam_fee_source = null where id = $1`, [row!.id]);
      const final = (expected?: Impact) => coordinator.api.v1.sessions[':id']['prices-final'].$put({ param: { id: X }, json: { final: true, ...(expected ? { expected } : {}) } });
      expect(await refusedWithCode(final())).toEqual({ status: 409, error: PRICES_FINAL_UNPRICED_REFUSAL([name.s1!], 1), code: 'PRICE_NOT_SET' });
      expect(await one(`select prices_final as f from registration_session where id = $1`, [X])).toEqual({ f: false });
      // The state the lead found on real data (switched final before this fix): the line's own subject's price is what waits.
      await sql(`update registration_session set prices_final = true, prices_final_at = now() where id = $1`, [X]);
      const notConfirmed = `${name.s1}'s price is not confirmed yet: the subject is reserved, and it can be paid once the school confirms its price`;
      expect(await refusedWithCode(initiate(f, [l!], 'in_school'))).toMatchObject({ error: notConfirmed, code: 'PRICES_NOT_FINAL' });
      expect(await refusedWithCode(deskCollect(f, [l!]))).toMatchObject({ error: notConfirmed, code: 'PRICES_NOT_FINAL' });
      expect(await sql(`select 1 from payment_registration where registration_id = $1`, [l!])).toEqual([]);
      // Its exam fee set: re-priced at it, payable.
      await confirmed((expected?: Impact) => apiResponse(coordinator.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: X, rowId: row!.id }, json: { amount: 500, ...(expected ? { expected } : {}) } })));
      expect(await lineOf(l!)).toMatchObject({ status: 'pending_payment', provisional: false, price: 1500, exam: 500 });
      expect((await apiResponse(deskCollect(f, [l!]))).collected).toBe(1500);
      expect(await statusOf('registration', l!)).toBe('confirmed');
    });

    it('a row with no exam month keeps it on a save of its subject: the save goes through and the row and its reservation are as they were', async () => {
      const X = await fresh('sitting');
      const [row] = await rowsOf(X, subj.s3!);
      const f = await family('sitting');
      const [l] = await reserved(f, X, [subj.s3!]);
      const sitting = await sittingOf(X);
      expect(await one(`select board_series_id as s from registration where id = $1`, [l!])).toEqual({ s: sitting });
      // An older row with no sitting on it (no exam month the editor can read), its reservation made before.
      await sql(`update session_offer_item set board_series_id = null where id = $1`, [row!.id]);
      const cells = await one<{ firstInSchool: boolean; retakeInSchool: boolean; retakeSelfStudy: boolean; firstSelfStudy: boolean }>(
        `select first_in_school as "firstInSchool", retake_in_school as "retakeInSchool", retake_self_study as "retakeSelfStudy", first_self_study as "firstSelfStudy" from session_offer_item where id = $1`, [row!.id]);
      const { saved } = await putOffering(X, await offeringOf(X, subj.s3!), { note: 'Bring a calculator', rows: [{ id: row!.id, kind: 'all_papers', cells }] });
      expect(saved.saved).toBe(true);
      expect(await one(`select board_series_id as s from session_offer_item where id = $1`, [row!.id])).toEqual({ s: null });
      expect(await one(`select board_series_id as s from registration where id = $1`, [l!])).toEqual({ s: sitting });
      expect(await one(`select notes as note from session_offer where id = $1`, [await offeringOf(X, subj.s3!)])).toEqual({ note: 'Bring a calculator' });
      expect(await lineOf(l!)).toMatchObject({ status: 'pending_payment', price: 1500 });
    });

    it('a transfer under verification shows when it really ends — the earliest board deadline among its lines — not their cut-off; its line is kept until then', async () => {
      const X = await fresh('verifying');
      const f = await family('verifying');
      const [l] = await reserved(f, X, [subj.s1!]);
      const deadline = new Date(Date.now() + 20 * 86_400_000);
      await sql(`update board_series set entry_deadline = $1 where id = $2`, [deadline.toISOString(), await sittingOf(X)]);
      // Its cut-off in two days, well before the board's deadline.
      await sql(`update registration r set due_at = now() - make_interval(days => s.unpaid_cancel_days) + interval '2 days' from registration_session s where s.id = r.session_id and r.id = $1`, [l!]);
      const cut = await cutOffOf(l!);
      const pay = (await apiResponse(initiate(f, [l!], 'instapay'))).id!;
      const read = async () => {
        const st = (await apiResponse(f.parent.api.v1.statement.$get({ query: { studentId: f.studentId } }))).students[0]!;
        return { payment: st.payments.find((p) => p.id === pay)!, line: st.sessions.find((x) => x.id === X)!.lines.find((x) => x.id === l)! };
      };
      // A checkout: its lines' earliest cut-off.
      expect(new Date((await read()).payment.deadline!).getTime()).toBe(cut.getTime());
      await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: pay }, json: { reference: `FT-Z08-${RUN}-V` } }));
      expect(await statusOf('payment', pay)).toBe('pending_verification');
      const v = await read();
      expect(new Date(v.payment.deadline!).getTime()).toBe(deadline.getTime());
      expect(new Date(v.line.deadline!).getTime()).toBe(deadline.getTime());
      const m = await apiResponse(finadmin.api.v1.sessions[':id'].money.$get({ param: { id: X }, query: { filter: 'all' } }));
      expect(new Date(m!.lines.find((x) => x.id === l)!.deadline!).getTime()).toBe(deadline.getTime());
    });

    it("L1: a line's cut-off adds the session's days in Cairo time: due at the end of 28 October, three days on is the end of 31 October across the clock change (the last Thursday of October)", async () => {
      const X = await fresh('clock');
      const f = await family('clock');
      const [l] = await reserved(f, X, [subj.s1!]);
      await sql(`update board_series set entry_deadline = '2099-12-31T21:59:59Z' where id = $1`, [await sittingOf(X)]);
      // 23:59:59 in Cairo on Wednesday 28 October 2026 (summer time, +03:00); the clocks go back an hour at the end of Thursday 29th.
      await sql(`update registration set due_at = '2026-10-28T20:59:59Z' where id = $1`, [l!]);
      // Saturday 31 October, 23:59:59 in Cairo (winter time, +02:00) — not 22:59:59, which 72 hours in UTC gave.
      const end = new Date('2026-10-31T21:59:59Z');
      expect((await cutOffOf(l!)).getTime()).toBe(end.getTime());
      const line = (await apiResponse(f.parent.api.v1.statement.$get({ query: { studentId: f.studentId } }))).students[0]!.sessions.find((x) => x.id === X)!.lines.find((x) => x.id === l)!;
      expect(new Date(line.deadline!).getTime()).toBe(end.getTime());
      expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'medium' }).format(end)).toBe('31/10/2026, 23:59:59');
    });

    it("L2: may pay is asked again under the lines' locks — a cut-off that passes while a checkout or the desk waits for its line refuses it (CUT_OFF_PASSED), nothing paid", async () => {
      const X = await fresh('relock');
      const f = await family('relock');
      const [a, b] = await reserved(f, X, [subj.s1!, subj.s2!]);
      // Due two days ago: with the session's three days, payable until tomorrow.
      await sql(`update registration set due_at = now() - interval '2 days' where id in ($1, $2)`, [a!, b!]);
      for (const [line, go] of [[a!, () => initiate(f, [a!], 'in_school')], [b!, () => deskCollect(f, [b!])]] as const) {
        const release = await holdRowLock('registration', line);
        const pending = refusedWithCode(go());
        await lockWaiters(1);
        // Meanwhile the session's days go to none (its cut-off two days ago).
        await sql(`update registration_session set unpaid_cancel_days = 0 where id = $1`, [X]);
        await release();
        const r = await pending;
        expect(r).toMatchObject({ code: 'CUT_OFF_PASSED', error: expect.stringMatching(/ was not paid by .+, its last day to pay: it can no longer be paid/) });
        await sql(`update registration_session set unpaid_cancel_days = 3 where id = $1`, [X]);
      }
      expect(await sql(`select 1 from payment_registration where registration_id in ($1, $2)`, [a!, b!])).toEqual([]);
      expect(await sql(`select 1 from payment where student_id = $1`, [f.studentId])).toEqual([]);
    });

    it("the desk takes one payment for lines of two board deadlines, the balance applied once (retired 08m's desk case)", async () => {
      const f = await family('desk-escrow');
      expect(await fund(f, S, subj.s6!)).toBe(1500);
      const [k] = await reserved(f, S, [subj.s1!]);
      const [l] = await reserved(f, W, [subj.s2!]);
      const deadlines = await sql<{ d: string }>(`select distinct line_effective_deadline(attempt, prior_sitting_series_id, board_series_id, declaration_rejected) as d from registration where id in ($1, $2)`, [k!, l!]);
      expect(deadlines).toHaveLength(2);
      const before = (await sql(`select id from payment where student_id = $1`, [f.studentId])).length;
      const col = await apiResponse(deskCollect(f, [k!, l!], 1000));
      expect(col.payments).toHaveLength(1);
      expect((await sql(`select id from payment where student_id = $1`, [f.studentId])).length).toBe(before + 1);
      const made = await sql<{ id: string; a: number; e: number; s: string }>(
        `select id, amount::float as a, escrow_amount_applied::float as e, status as s from payment where id = $1`, [col.payments[0]!.id]);
      expect(made).toHaveLength(1);
      expect(made[0]).toMatchObject({ a: 2000, e: 1000, s: 'completed' });
      expect(await sql(`select amount::float as a from escrow_transaction where related_payment_id = $1 and type = 'debit'`, [made[0]!.id])).toEqual([{ a: 1000 }]);
      expect(await escrowOf(f.studentId)).toBe(500);
      expect([await statusOf('registration', k!), await statusOf('registration', l!)]).toEqual(['confirmed', 'confirmed']);
      expect(await sql(`select registration_id from payment_registration where payment_id = $1 order by registration_id`, [made[0]!.id]))
        .toEqual([k!, l!].sort().map((registration_id) => ({ registration_id })));
    });

    it("a reservation racing the admin entering a sitting's board date waits for it and comes out due by the new deadline (retired 08k's race, v2)", async () => {
      const X = await fresh('board-date');
      const sitting = await sittingOf(X);
      // A sitting the reference data gives no entry deadline.
      await sql(`update board_series set entry_deadline = null, retake_deadline = null, dates_source = null, admin_deadlines = '{}' where id = $1`, [sitting]);
      const day = cairoDateIn(5);
      const f = await family('board-date');
      const release = await holdRowLock('board_series', sitting);
      const entering = boardDate(adm, sitting, { entryDeadline: day });
      await lockWaiters(1);
      const reserving = reserve(f, X, [subj.s1!]);
      await lockWaiters(2);
      await release();
      const entered = await entering;
      const [made] = await apiResponse(reserving);
      const deadline = new Date((await one<{ d: string }>(`select entry_deadline as d from board_series where id = $1`, [sitting])).d);
      expect(new Date(entered.entryDeadline!).getTime()).toBe(deadline.getTime());
      // Made after the date committed: due by it from the start, never re-dated afterwards.
      const line = await lineOf(made!.id);
      expect(new Date(line.due).getTime()).toBe(deadline.getTime());
      expect((await cutOffOf(made!.id)).getTime()).toBe(deadline.getTime());
      expect(await sql(`select 1 from audit_log where action = 'LINE_DUE_MOVED' and entity_id = $1`, [made!.id])).toEqual([]);
    });

    it("the refusal codes of a draft and of the cells: NOT_OPEN, PREREGISTRATION_GONE, OPTION_NOT_OFFERED", async () => {
      const draft = await session(adm, 'June (08z, draft)', 'june', 'igcse', futureWindow());
      const f = await family('codes');
      expect(await refusedWithCode(reserve(f, draft, [subj.s1!]))).toMatchObject({ code: 'NOT_OPEN', error: expect.stringMatching(/ is not open for reservations yet$/) });
      expect(await refusedWithCode(f.parent.api.v1.registrations.preregister.$post({ json: { sessionId: draft, studentId: f.studentId, ...(await reservationOf(draft, [subj.s1!])) } })))
        .toEqual({ status: 400, error: 'Reservations open when the session opens: a session that is not open yet takes none', code: 'PREREGISTRATION_GONE' });
      const X = await fresh('codes');
      const [row] = await rowsOf(X, subj.s2!);
      const consent = (await reservationOf(X, [])).consent;
      const direct = (lines: { offerItemId: string; attempt: 'first' | 'retake'; mode: 'in_school' | 'self_study' }[]) =>
        f.parent.api.v1.registrations.direct.$post({ json: { sessionId: X, studentId: f.studentId, consent, lines } });
      await sql(`update session_offer_item set first_self_study = false where id = $1`, [row!.id]);
      await sql(`update session_offer_item set first_in_school = false, retake_in_school = false, retake_self_study = false where id = $1`, [row!.id]);
      expect(await refusedWithCode(direct([{ offerItemId: row!.id, attempt: 'first', mode: 'in_school' }])))
        .toEqual({ status: 400, error: `${name.s2} is not offered in this session`, code: 'OPTION_NOT_OFFERED' });
      expect(await sql(`select 1 from registration where student_id = $1`, [f.studentId])).toEqual([]);
    });
  });
});
