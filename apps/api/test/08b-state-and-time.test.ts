import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, refused, one, sql, money, audited, openWindow, futureWindow, academicYearOf, loneStudent,
  runSessionRecovery, holdRowLock, lockWaiters, notified, expireByHand, type Client,
} from './helpers';

/**
 * State and time (state-and-time audit, STATE_AUDIT.md, finding ids ST-nn).
 *
 * Each scenario drives a state machine through the API the way families,
 * the desk and the scheduler do, and reads the rows back: transitions that
 * must not interleave are fired at once on separate connections, and the
 * outcome is checked against the rule, not against one lucky ordering.
 *
 * Session: january / as_level — no other suite has one open at this point
 * of the run (08 closes its own). Runs after 08 and before 09, which must
 * stay last.
 */

const statusOf = async (table: 'payment' | 'registration' | 'remark_request' | 'change_request' | 'parent_student_link', id: string) =>
  (await one<{ status: string }>(`select status from ${table} where id = $1`, [id])).status;
const escrowOf = async (studentId: string) => {
  const rows = await sql<{ balance: string }>(`select balance from escrow where student_id = $1`, [studentId]);
  return money(rows[0]?.balance ?? 0);
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('state and time', () => {
  let adm: Client, officer: Client, officer2: Client, finadmin: Client, sessionId: string;
  const subj: Record<string, string> = {};

  type Family = { parent: Client; student: Client; studentId: string };
  const family = (tag: string, grade: 10 | 11 | 12 = 11): Promise<Family> => onboard(officer, `st-${tag}`, grade);
  const deskCash = async (f: Family, subjectIds: string[]) =>
    apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f.studentId, sessionId, subjectIds, collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));

  beforeAll(async () => {
    adm = await admin('st');
    officer = await staff(adm, 'finance_officer', 'st');
    officer2 = await staff(adm, 'finance_officer', 'st2');
    finadmin = await staff(adm, 'finance_admin', 'st');
    const names = ['Physics', 'Chemistry', 'Biology', 'Geography', 'History', 'Economics', 'Art', 'Music', 'French', 'German',
      'Sociology', 'Psychology', 'Accounting', 'Business', 'Law', 'Media', 'Drama', 'Latin', 'Spanish', 'Italian', 'Thinking', 'Marine'];
    for (const [i, name] of names.entries()) {
      subj[`S${i + 1}`] = await subject(adm, `ST-${i + 1}`, `${name} (AS, state)`, { course: 1000, registration: 500 }, { qualificationLevel: 'as_level' });
    }
    sessionId = await session(adm, 'January (AS, state and time)', 'january', 'as_level', { ...openWindow(), activate: true });
  });

  // ─── Remark requests and their fee ─────────────────────────────────────────

  describe('a remark request and its fee (ST-01)', () => {
    let f: Family, physics: string, chemistry: string, biology: string, geography: string;
    const newRemark = async (registrationId: string) => {
      const r = await apiResponse(f.parent.api.v1.remarks.$post({
        json: { registrationId, serviceType: 'clerical_check', papers: [{ paperCode: '9702/12', paperName: 'Paper 1' }] },
      }));
      await apiResponse(f.parent.api.v1.remarks[':id'].consent.$post({ param: { id: r.id }, json: { attest: true } }));
      return r.id;
    };
    const payByTransfer = async (remarkId: string, reference: string) => {
      const pay = await apiResponse(f.parent.api.v1.remarks[':id'].pay.$post({ param: { id: remarkId }, json: { paymentMethod: 'instapay' } }));
      await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: pay.id! }, json: { reference } }));
      return pay.id!;
    };

    beforeAll(async () => {
      f = await family('rm');
      const desk = await deskCash(f, [subj.S1!, subj.S2!, subj.S3!, subj.S4!]);
      [physics, chemistry, biology, geography] = desk.registrations.map((r) => r.id) as [string, string, string, string];
      await apiResponse(finadmin.api.v1.remarks.fees.$put({ json: { council: 'cambridge', serviceType: 'clerical_check', amountPerPaper: 400 } }));
      await apiResponse(officer.api.v1.remarks.results.$post({
        json: { results: [{ registrationId: physics, grade: 'D' }, { registrationId: chemistry, grade: 'E' }, { registrationId: biology, grade: 'C' }, { registrationId: geography, grade: 'D' }] },
      }));
    });

    it('cannot be cancelled while its fee transfer is being checked; the confirmation moves it on', async () => {
      const id = await newRemark(physics);
      const pay = await payByTransfer(id, 'FT-ST-RM-1');
      const cancel = await refused(f.parent.api.v1.remarks[':id'].cancel.$post({ param: { id } }));
      expect(cancel).toEqual({
        status: 409,
        error: 'A payment for this remark request is in progress — cancel that checkout first, or wait for the finance office to confirm or reject the transfer',
      });
      await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay }, json: {} }));
      expect(await statusOf('remark_request', id)).toBe('awaiting_submission');
    });

    it('a fee whose request no longer awaits payment is refused at confirmation, not taken', async () => {
      const id = await newRemark(chemistry);
      const pay = await payByTransfer(id, 'FT-ST-RM-2');
      // A cancellation that got past the guard (or any other change of state).
      await sql(`update remark_request set status = 'cancelled' where id = $1`, [id]);
      const confirm = await refused(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay }, json: {} }));
      expect(confirm).toEqual({ status: 400, error: 'This remark request is no longer awaiting payment — reject the transfer instead' });
      expect(await statusOf('payment', pay)).toBe('pending_verification');
      await apiResponse(officer.api.v1.payments[':id'].reject.$post({ param: { id: pay }, json: { reason: 'The remark request was cancelled' } }));
    });

    it('a cancellation and a payment arriving together never leave a payment on a cancelled request', async () => {
      const id = await newRemark(biology);
      // The cancellation reaches the request's lock first, the payment right
      // behind it (having read "awaiting payment" before either commits).
      const release = await holdRowLock('remark_request', id);
      let cancel, pay;
      try {
        cancel = f.parent.api.v1.remarks[':id'].cancel.$post({ param: { id } });
        await lockWaiters(1);
        pay = f.parent.api.v1.remarks[':id'].pay.$post({ param: { id }, json: { paymentMethod: 'instapay' } });
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [c, p] = await Promise.all([cancel, pay]);
      expect([c.ok, p.ok]).toEqual([true, false]);
      expect(await statusOf('remark_request', id)).toBe('cancelled');
      expect(await sql(`select 1 from payment where purpose = 'remark' and metadata ->> 'remarkRequestId' = $1`, [id])).toEqual([]);
    });

    it('a payment and a cancellation arriving together, payment first: the cancellation sees the payment, and is refused', async () => {
      const id = await newRemark(geography);
      // The payment reaches the request's lock first; the cancellation queues
      // behind it on the same lock and then finds the payment it committed.
      const release = await holdRowLock('remark_request', id);
      let pay, cancel;
      try {
        pay = f.parent.api.v1.remarks[':id'].pay.$post({ param: { id }, json: { paymentMethod: 'instapay' } });
        await lockWaiters(1);
        cancel = f.parent.api.v1.remarks[':id'].cancel.$post({ param: { id } });
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [p, c] = await Promise.all([pay, cancel]);
      expect([p.ok, c.ok]).toEqual([true, false]);
      expect(await statusOf('remark_request', id)).toBe('pending_payment');
    });
  });

  // ─── The school fee ────────────────────────────────────────────────────────

  describe('the school fee (ST-02)', () => {
    let scheduleId: string;
    const academicYear = academicYearOf(new Date());

    beforeAll(async () => {
      // Grade 10 only, so no other family in the shared database is gated by it.
      scheduleId = (await apiResponse(finadmin.api.v1['school-fees'].schedules.$post({
        json: { academicYear, grade: 10, amount: 3000, opensAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() },
      }))).id;
    });
    afterAll(async () => {
      await apiResponse(finadmin.api.v1['school-fees'].schedules[':id'].$delete({ param: { id: scheduleId } }));
    });

    it('two officers collecting it at the same moment take it once', async () => {
      const f = await family('fee1', 10);
      const tries = await Promise.all([officer, officer2].map((o) =>
        o.api.v1['school-fees']['desk-pay'].$post({ json: { studentId: f.studentId, instrumentUsed: 'cash' } })
      ));
      expect(tries.filter((r) => r.ok)).toHaveLength(1);
      const rows = await sql<{ status: string }>(`select status from payment where student_id = $1 and purpose = 'school_fee'`, [f.studentId]);
      expect(rows.map((r) => r.status)).toEqual(['completed']);
      // The database holds the rule, whatever the interleaving: a second school fee for the year is refused.
      await expect(sql(
        `insert into payment (id, student_id, parent_id, amount, escrow_amount_applied, payment_method, purpose, academic_year, status)
         select gen_random_uuid(), student_id, parent_id, amount, 0, 'in_school', 'school_fee', academic_year, 'pending' from payment
         where student_id = $1 and purpose = 'school_fee'`, [f.studentId],
      )).rejects.toMatchObject({ cause: expect.objectContaining({ code: '23505' }) });
    });

    it('the desk does not take it again while the family\'s transfer for it is being checked', async () => {
      const f = await family('fee2', 10);
      const pay = await apiResponse(f.parent.api.v1['school-fees'].pay.$post({ json: { studentId: f.studentId, paymentMethod: 'instapay' } }));
      await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: pay.id! }, json: { reference: 'FT-ST-FEE-1' } }));
      const desk = await refused(officer.api.v1['school-fees']['desk-pay'].$post({ json: { studentId: f.studentId, instrumentUsed: 'cash' } }));
      expect(desk).toEqual({ status: 409, error: 'A school-fee payment is already in progress for this student — confirm or reject it instead' });
      expect((await sql(`select 1 from payment where student_id = $1 and purpose = 'school_fee'`, [f.studentId])).length).toBe(1);
    });
  });

  // ─── Approval, revert and checkout ─────────────────────────────────────────

  describe('a parent reverting an approval while checking out (ST-03)', () => {
    it('a revert arriving while the checkout holds the lock sees the checkout, and is refused', async () => {
      const f = await family('rv0');
      const [id] = (await apiResponse(f.student.api.v1.registrations.request.$post({ json: { sessionId, subjectIds: [subj.S14!] } }))).map((r) => r.id) as [string];
      await apiResponse(f.parent.api.v1.registrations.approve.$put({ json: { registrationIds: [id] } }));
      // The checkout queues on the registration's lock; the revert arrives while it waits.
      const release = await holdRowLock('registration', id);
      let checkout, revert;
      try {
        checkout = f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [id], paymentMethod: 'instapay', escrowAmountToApply: 0 } });
        await lockWaiters(1);
        revert = f.parent.api.v1.registrations['revert-approval'].$put({ json: { registrationIds: [id] } });
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [c, r] = await Promise.all([checkout, revert]);
      expect([c.ok, r.ok]).toEqual([true, false]);
      expect(await statusOf('registration', id)).toBe('pending_payment');
    });

    it('never leaves an open payment on a request back in "awaiting approval", across a sweep of timings', async () => {
      const f = await family('rv');
      // Sixteen races: the interleaving that breaks it is narrow, and one clean run proves little.
      const subjects = [3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 17, 18, 19, 20, 21, 22].map((n) => subj[`S${n}`]!);
      const requested = await apiResponse(f.student.api.v1.registrations.request.$post({ json: { sessionId, subjectIds: subjects } }));
      const ids = requested.map((r) => r.id);
      await apiResponse(f.parent.api.v1.registrations.approve.$put({ json: { registrationIds: ids } }));
      // Each registration races a checkout against a revert, the revert
      // arriving a little later each time, across the checkout's transaction.
      await Promise.all(ids.map(async (id, i) => {
        await Promise.all([
          f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [id], paymentMethod: 'instapay', escrowAmountToApply: 0 } }),
          pause(i * 2).then(() => f.parent.api.v1.registrations['revert-approval'].$put({ json: { registrationIds: [id] } })),
        ]);
      }));
      const broken = await sql(`
        select r.id from registration r
        join payment_registration pr on pr.registration_id = r.id join payment p on p.id = pr.payment_id
        where r.student_id = $1 and r.status = 'pending_approval' and p.status in ('pending', 'pending_verification')`, [f.studentId]);
      expect(broken).toEqual([]);
    });
  });

  // ─── Graduation ────────────────────────────────────────────────────────────

  describe('a student who graduates with a checkout open (ST-04)', () => {
    it('gets the escrow back and the checkout closed, not stranded on an expired registration', async () => {
      const f = await family('gr', 12);
      // Free escrow the way it really happens: paid at the desk, dropped before the receipt left the desk.
      const desk = await deskCash(f, [subj.S11!]);
      await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: desk.registrations[0]!.id }, json: { reason: 'setup for escrow' } }));
      expect(await escrowOf(f.studentId)).toBe(1500);
      const reg = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId, subjectIds: [subj.S12!], studentId: f.studentId } })))[0]!.id;
      const pay = (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [reg], paymentMethod: 'instapay', escrowAmountToApply: 300 } }))).id!;
      expect(await escrowOf(f.studentId)).toBe(1200);

      await apiResponse(adm.api.v1.grade[':id'].$put({ param: { id: f.studentId }, json: { newGrade: null, reason: 'left the school early' } }));

      expect(await statusOf('registration', reg)).toBe('expired');
      expect(await statusOf('payment', pay)).toBe('failed');
      expect(await escrowOf(f.studentId)).toBe(1500);
      await audited([pay], ['PAYMENT_FAILED']);
      const notice = await notified(f.parent.email, 'PAYMENT_EXPIRED', 1);
      expect(notice[0]?.title).toBe('Payment closed: student graduated');
    });

    it('a checkout whose transfer is being checked keeps its registration through graduation, as at a close', async () => {
      const f = await family('gr2', 12);
      const reg = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId, subjectIds: [subj.S13!], studentId: f.studentId } })))[0]!.id;
      const pay = (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [reg], paymentMethod: 'instapay', escrowAmountToApply: 0 } }))).id!;
      await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: pay }, json: { reference: 'FT-ST-GR-2' } }));
      await apiResponse(adm.api.v1.grade[':id'].$put({ param: { id: f.studentId }, json: { newGrade: null, reason: 'left after the November entries' } }));
      expect(await statusOf('registration', reg)).toBe('pending_payment');
      expect(await statusOf('payment', pay)).toBe('pending_verification');
    });
  });

  // ─── Cambridge's one enquiry ───────────────────────────────────────────────

  describe('two remark requests for one Cambridge result at once (ST-08)', () => {
    it('accepts one', async () => {
      const f = await family('one');
      const reg = (await deskCash(f, [subj.S13!])).registrations[0]!.id;
      await apiResponse(officer.api.v1.remarks.results.$post({ json: { results: [{ registrationId: reg, grade: 'C' }] } }));
      const tries = await Promise.all([1, 2, 3].map(() => f.parent.api.v1.remarks.$post({
        json: { registrationId: reg, serviceType: 'clerical_check', papers: [{ paperCode: '9700/22', paperName: 'Paper 2' }] },
      })));
      expect(tries.filter((r) => r.ok)).toHaveLength(1);
      expect((await sql(`select 1 from remark_request where registration_id = $1`, [reg])).length).toBe(1);
    });
  });

  // ─── Parent–student links ──────────────────────────────────────────────────

  describe('parent–student links (ST-09, ST-10)', () => {
    it('a student answering one link request twice at once: one answer stands', async () => {
      const f = await family('lk1');
      const st = await loneStudent(adm, 'st-lk1');
      const link = await apiResponse(f.parent.api.v1.links.$post({ json: { studentEmail: st.email } }));
      const answers = await Promise.all((['approved', 'rejected'] as const).map((status) =>
        st.api.v1.links[':id'].$put({ param: { id: link.id }, json: { status } })
      ));
      expect(answers.filter((r) => r.ok)).toHaveLength(1);
    });

    it('the desk enrolls a family whose first link request was rejected and a second is pending', async () => {
      const f = await family('lk2');
      const st = await loneStudent(adm, 'st-lk2');
      const first = await apiResponse(f.parent.api.v1.links.$post({ json: { studentEmail: st.email } }));
      await apiResponse(st.api.v1.links[':id'].$put({ param: { id: first.id }, json: { status: 'rejected' } }));
      await apiResponse(f.parent.api.v1.links.$post({ json: { studentEmail: st.email } }));
      const r = await apiResponse(officer.api.v1.links['desk-onboard'].$post({ json: { parent: { email: f.parent.email }, student: { email: st.email } } }));
      expect(r.linkStatus).toBe('approved');
      const links = await sql<{ status: string }>(`select status from parent_student_link where parent_id = $1 and student_id = $2 order by created_at`, [f.parent.id, st.id]);
      expect(links.map((l) => l.status)).toEqual(['rejected', 'approved']);
    });
  });

  // ─── Change requests ───────────────────────────────────────────────────────

  describe('a change request cancelled twice at once (ST-11)', () => {
    it('is cancelled once; the other click is told', async () => {
      const f = await family('cr');
      const reg = (await deskCash(f, [subj.S14!])).registrations[0]!.id;
      const cr = await apiResponse(f.student.api.v1.registrations[':id']['request-drop'].$post({ param: { id: reg }, json: { reason: 'changed my mind' } }));
      const tries = await Promise.all([1, 2].map(() => f.student.api.v1['change-requests'][':id'].cancel.$put({ param: { id: cr.id } })));
      expect(tries.filter((r) => r.ok)).toHaveLength(1);
      expect(await statusOf('change_request', cr.id)).toBe('cancelled');
    });
  });

  // ─── After the close (runs last: it closes the session) ────────────────────

  describe('after the close, a student with a deadline extension (ST-07)', () => {
    let f: Family;
    beforeAll(async () => {
      f = await family('ext');
      await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: sessionId }, json: { reason: 'state and time: window closes' } }));
      await apiResponse(finadmin.api.v1.exceptions.$post({
        json: { type: 'deadline_extension', studentId: f.studentId, sessionId, validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), reason: 'late family, approved by the head' },
      }));
    });

    it('can have a request approved, and another rejected, by the parent', async () => {
      const requested = await apiResponse(f.student.api.v1.registrations.request.$post({ json: { sessionId, subjectIds: [subj.S1!, subj.S2!] } }));
      const [keep, drop] = requested.map((r) => r.id) as [string, string];
      const approved = await apiResponse(f.parent.api.v1.registrations.approve.$put({ json: { registrationIds: [keep] } }));
      expect(approved.map((r) => r.status)).toEqual(['pending_payment']);
      await apiResponse(f.parent.api.v1.registrations.reject.$put({ json: { registrationIds: [drop], comments: 'not this series' } }));
      expect(await statusOf('registration', drop)).toBe('rejected');
    });

    it('a request left behind when the extension runs out can still be rejected, though no longer approved', async () => {
      const [left] = (await apiResponse(f.student.api.v1.registrations.request.$post({ json: { sessionId, subjectIds: [subj.S5!] } }))).map((r) => r.id) as [string];
      await sql(`update exception set valid_until = now() - interval '1 minute' where student_id = $1 and type = 'deadline_extension'`, [f.studentId]);
      const approve = await refused(f.parent.api.v1.registrations.approve.$put({ json: { registrationIds: [left] } }));
      expect(approve.status).toBe(400);
      await apiResponse(f.parent.api.v1.registrations.reject.$put({ json: { registrationIds: [left], comments: 'the extension ran out' } }));
      expect(await statusOf('registration', left)).toBe('rejected');
    });
  });

  // ─── What the scheduler finishes (the session above is closed by now) ──────

  describe('the scheduler finishes what a close or an opening left undone (ST-06)', () => {
    const extend = (studentId: string, id: string) => apiResponse(finadmin.api.v1.exceptions.$post({
      json: { type: 'deadline_extension', studentId, sessionId: id, validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), reason: 'late family, approved by the head' },
    }));

    it('nothing is stranded before the first sweep (so the sweep cannot hide an earlier suite\'s fault from 09)', async () => {
      const stranded = await sql(`
        select p.id from payment p
        where p.status in ('pending', 'pending_verification')
          and exists (select 1 from payment_registration pr where pr.payment_id = p.id)
          and not exists (
            select 1 from payment_registration pr join registration r on r.id = pr.registration_id
            where pr.payment_id = p.id and r.status <> 'expired')`);
      expect(stranded).toEqual([]);
    });

    it('a close interrupted before its finalisation is finished on the next tick, and only once', async () => {
      const s = await session(adm, 'January (AS, state and time, recovery)', 'january', 'as_level', { ...openWindow(), activate: true });
      const f = await family('rc1');
      const waiting = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: s, subjectIds: [subj.S3!], studentId: f.studentId } })))[0]!.id;
      // The window closes, but the process stops before it is finalised.
      await sql(`update registration_session set status = 'closed', closed_at = now() where id = $1`, [s]);
      expect(await statusOf('registration', waiting)).toBe('pending_payment');

      // Before the late finalisation, a student with a deadline extension registers and checks out.
      const late = await family('rc2');
      await extend(late.studentId, s);
      const lateReg = (await apiResponse(late.parent.api.v1.registrations.direct.$post({ json: { sessionId: s, subjectIds: [subj.S4!], studentId: late.studentId } })))[0]!.id;
      const latePay = (await apiResponse(late.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [lateReg], paymentMethod: 'in_school', escrowAmountToApply: 0 } }))).id!;

      expect((await runSessionRecovery()).finalized).toBeGreaterThanOrEqual(1);
      expect(await statusOf('registration', waiting)).toBe('expired');
      // Only what existed at the close is finalised: the extension student's rows stand.
      expect(await statusOf('registration', lateReg)).toBe('pending_payment');
      expect(await statusOf('payment', latePay)).toBe('pending');
      await runSessionRecovery();
      expect(await statusOf('registration', lateReg)).toBe('pending_payment');
    });

    it('preregistrations an opening did not capture are captured on the next tick', async () => {
      const s = await session(adm, 'January (AS, state and time, capture)', 'january', 'as_level', futureWindow());
      const f = await family('rc3');
      const pre = (await apiResponse(f.parent.api.v1.registrations.preregister.$post({ json: { sessionId: s, subjectIds: [subj.S5!], studentId: f.studentId } })))[0]!.id;
      const pay = (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [pre], paymentMethod: 'in_school', escrowAmountToApply: 0 } }))).id!;
      await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay }, json: { instrumentUsed: 'cash' } }));
      const held = async () => money((await one<{ held: string }>(`select held_balance as held from escrow where student_id = $1`, [f.studentId])).held);
      expect(await held()).toBe(1500);
      // The series opens, but its capture never runs.
      await sql(`update registration_session set status = 'active', start_date = now() - interval '1 hour' where id = $1`, [s]);
      expect(await statusOf('registration', pre)).toBe('preregistered');

      expect((await runSessionRecovery()).captured).toBeGreaterThanOrEqual(1);
      expect(await statusOf('registration', pre)).toBe('confirmed');
      expect(await held()).toBe(0);
      await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: s }, json: { reason: 'state and time: capture done' } }));
    });

    it('a payment left open on registrations that have all expired is closed on the next tick, escrow back', async () => {
      const s = await session(adm, 'January (AS, state and time, stranded)', 'january', 'as_level', { ...openWindow(), activate: true });
      const f = await family('rc4');
      const funded = await apiResponse(officer.api.v1.registrations.desk.$post({
        json: { studentId: f.studentId, sessionId: s, subjectIds: [subj.S6!], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
      }));
      await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: funded.registrations[0]!.id }, json: { reason: 'setup for escrow' } }));
      const reg = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: s, subjectIds: [subj.S7!], studentId: f.studentId } })))[0]!.id;
      const pay = (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [reg], paymentMethod: 'instapay', escrowAmountToApply: 300 } }))).id!;
      expect(await escrowOf(f.studentId)).toBe(1200);
      // Its registration expired, but closing the payment failed.
      await expireByHand(reg);

      expect((await runSessionRecovery()).strandedClosed).toBeGreaterThanOrEqual(1);
      expect(await statusOf('payment', pay)).toBe('failed');
      expect(await escrowOf(f.studentId)).toBe(1500);
      await audited([pay], ['PAYMENT_FAILED']);
      await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: s }, json: { reason: 'state and time: stranded done' } }));
    });
  });
});
