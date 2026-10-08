import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import { admin, staff, onboard, subject, session, refused, one, sql, money, openWindow, futureWindow, academicYearOf, refuseAudit, runSessionRecovery, type Client, reservationOf, swapTo } from './helpers';

/**
 * A money movement and its audit row commit together, or neither does
 * (STATE_AUDIT.md SO-1, MONEY_AUDIT.md MO-1).
 *
 * Each scenario makes the database refuse the action's audit row, fires the
 * request the way the family, the desk or the scheduler does, and checks that
 * it failed and that nothing moved: no escrow, no payment, no status. Then the
 * row is allowed, the same request succeeds, and exactly one row is written.
 * When the audit row was written in the route after the commit, the request
 * succeeded with the row missing and the money moved.
 *
 * Session: january / as_level, the only open slot at this point of the run
 * (08 and 08b close theirs). Runs after 08b and before 09, which must stay last.
 */

const statusOf = async (table: 'payment' | 'registration' | 'receipt' | 'remark_request' | 'change_request' | 'withdrawal_request', id: string) =>
  (await one<{ status: string }>(`select status from ${table} where id = $1`, [id])).status;
const escrowOf = async (studentId: string) => {
  const rows = await sql<{ balance: string; held_balance: string }>(`select balance, held_balance from escrow where student_id = $1`, [studentId]);
  return { free: money(rows[0]?.balance ?? 0), held: money(rows[0]?.held_balance ?? 0) };
};
const auditRows = async (entityId: string, action: string) =>
  Number((await one<{ n: string }>(`select count(*) as n from audit_log where entity_id = $1 and action = $2`, [entityId, action])).n);
const receiptOf = async (registrationId: string) =>
  (await one<{ id: string }>(`select id from receipt where registration_id = $1`, [registrationId])).id;

/** Fire `request` while the database refuses `action`'s audit row; return what the caller saw. */
async function withAuditRefused(action: string, request: () => Promise<{ status: number; json(): Promise<unknown> }>) {
  const release = await refuseAudit(action);
  try {
    return await refused(request());
  } finally {
    await release();
  }
}

describe('an audit row commits with its movement, or neither does (SO-1)', () => {
  let adm: Client, officer: Client, finadmin: Client, sessionId: string, draftId: string;
  const subj: Record<string, string> = {};

  type Family = { parent: Client; student: Client; studentId: string };
  const family = (tag: string): Promise<Family> => onboard(officer, `ax-${tag}`);
  const deskCash = async (f: Family, subjectIds: string[]) =>
    apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f.studentId, sessionId, ...(await reservationOf(sessionId, subjectIds)), collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
  /** A family with free escrow: a subject paid at the desk, then dropped. */
  const withCredit = async (f: Family, subjectId: string) => {
    const reg = (await deskCash(f, [subjectId])).registrations[0]!.id;
    await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: reg }, json: { reason: 'setup for escrow' } }));
    const { free } = await escrowOf(f.studentId);
    expect(free).toBeGreaterThan(0);
    return free;
  };

  beforeAll(async () => {
    adm = await admin('ax');
    officer = await staff(adm, 'finance_officer', 'ax');
    finadmin = await staff(adm, 'finance_admin', 'ax');
    for (let i = 1; i <= 24; i++) {
      subj[`S${i}`] = await subject(adm, `AX-${i}`, `Subject ${i} (AS, audit in transaction)`, { course: 1000, registration: 500 }, { qualificationLevel: 'as_level' });
    }
    sessionId = await session(adm, 'January (AS, audit in transaction)', 'january', 'as_level', { ...openWindow(), activate: true });
    draftId = await session(adm, 'January (AS, audit in transaction, next)', 'january', 'as_level', futureWindow());
    await apiResponse(finadmin.api.v1.remarks.fees.$put({ json: { council: 'cambridge', serviceType: 'clerical_check', amountPerPaper: 400 } }));
  });

  // ─── Checkout and transfer reference ───────────────────────────────────────

  describe('a family checkout', () => {
    let f: Family, reg: string, pay: string;

    it('that applies escrow: refused audit, no payment and no debit', async () => {
      f = await family('checkout');
      const credit = await withCredit(f, subj.S1!);
      reg = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId, ...(await reservationOf(sessionId, [subj.S2!])), studentId: f.studentId } })))[0]!.id;
      const checkout = () => f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [reg], paymentMethod: 'instapay', escrowAmountToApply: 300 } });

      expect((await withAuditRefused('PAYMENT_INITIATED', checkout)).status).toBeGreaterThanOrEqual(400);
      expect(await sql(`select 1 from payment_registration where registration_id = $1`, [reg])).toEqual([]);
      expect((await escrowOf(f.studentId)).free).toBe(credit);

      pay = (await apiResponse(checkout())).id!;
      expect((await escrowOf(f.studentId)).free).toBe(money(credit - 300));
      expect(await auditRows(pay, 'PAYMENT_INITIATED')).toBe(1);
    });

    it('its transfer reference: refused audit, still waiting for one', async () => {
      const submit = () => f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: pay }, json: { reference: 'FT-AX-REF-1' } });
      expect((await withAuditRefused('PAYMENT_REFERENCE_SUBMITTED', submit)).status).toBeGreaterThanOrEqual(400);
      expect(await statusOf('payment', pay)).toBe('pending');

      await apiResponse(submit());
      expect(await statusOf('payment', pay)).toBe('pending_verification');
      expect(await auditRows(pay, 'PAYMENT_REFERENCE_SUBMITTED')).toBe(1);
      // Leave nothing open: finance does not find it; the escrow comes back.
      await apiResponse(officer.api.v1.payments[':id'].reject.$post({ param: { id: pay }, json: { reason: 'not on the statement' } }));
    });
  });

  // ─── The desk ──────────────────────────────────────────────────────────────

  it('a desk registration that takes the money: refused audit, no registration and no payment', async () => {
    const f = await family('desk');
    const register = async () => officer.api.v1.registrations.desk.$post({
      json: { studentId: f.studentId, sessionId, ...(await reservationOf(sessionId, [subj.S3!])), collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    });
    expect((await withAuditRefused('DESK_REGISTRATION', register)).status).toBeGreaterThanOrEqual(400);
    expect(await sql(`select 1 from registration where student_id = $1`, [f.studentId])).toEqual([]);
    expect(await sql(`select 1 from payment where student_id = $1`, [f.studentId])).toEqual([]);

    const done = await apiResponse(register());
    expect(await statusOf('registration', done.registrations[0]!.id)).toBe('confirmed');
    expect(await auditRows(f.studentId, 'DESK_REGISTRATION')).toBe(1);
  });

  // ─── Drops and swaps ───────────────────────────────────────────────────────

  describe('drops and swaps', () => {
    let f: Family;
    beforeAll(async () => { f = await family('drop'); });

    it('a direct drop: refused audit, still confirmed, no refund', async () => {
      const reg = (await deskCash(f, [subj.S4!])).registrations[0]!.id;
      const before = (await escrowOf(f.studentId)).free;
      const drop = () => f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: reg }, json: { reason: 'too much at once' } });

      expect((await withAuditRefused('DIRECT_DROP_EXECUTED', drop)).status).toBeGreaterThanOrEqual(400);
      expect(await statusOf('registration', reg)).toBe('confirmed');
      expect((await escrowOf(f.studentId)).free).toBe(before);

      const r = await apiResponse(drop());
      expect(await statusOf('registration', reg)).toBe('dropped');
      expect((await escrowOf(f.studentId)).free).toBe(money(before + r.creditedAmount));
      expect(await auditRows(reg, 'DIRECT_DROP_EXECUTED')).toBe(1);
    });

    it('a direct swap: refused audit, the old subject stays and no new one appears', async () => {
      const reg = (await deskCash(f, [subj.S5!])).registrations[0]!.id;
      const before = (await escrowOf(f.studentId)).free;
      const swap = async () => f.parent.api.v1.registrations[':id'].swap.$post({ param: { id: reg }, json: { line: await swapTo(reg, subj.S6!), reason: 'timetable clash' } });

      expect((await withAuditRefused('DIRECT_SWAP_EXECUTED', swap)).status).toBeGreaterThanOrEqual(400);
      expect(await statusOf('registration', reg)).toBe('confirmed');
      expect(await sql(`select 1 from registration where student_id = $1 and subject_id = $2`, [f.studentId, subj.S6!])).toEqual([]);
      expect((await escrowOf(f.studentId)).free).toBe(before);

      const r = await apiResponse(swap());
      expect(await statusOf('registration', reg)).toBe('dropped');
      expect(await statusOf('registration', r.newRegistrationId)).toBe('pending_payment');
      expect(await auditRows(reg, 'DIRECT_SWAP_EXECUTED')).toBe(1);
    });

    it("a student's drop request approved by the parent: refused audit, the request still waits", async () => {
      const reg = (await deskCash(f, [subj.S7!])).registrations[0]!.id;
      const cr = await apiResponse(f.student.api.v1.registrations[':id']['request-drop'].$post({ param: { id: reg }, json: { reason: 'changed my mind' } }));
      const before = (await escrowOf(f.studentId)).free;
      const approve = () => f.parent.api.v1['change-requests'][':id'].approve.$put({ param: { id: cr.id }, json: {} });

      expect((await withAuditRefused('CHANGE_REQUEST_APPROVED', approve)).status).toBeGreaterThanOrEqual(400);
      expect(await statusOf('change_request', cr.id)).toBe('pending_approval');
      expect(await statusOf('registration', reg)).toBe('confirmed');
      expect((await escrowOf(f.studentId)).free).toBe(before);

      await apiResponse(approve());
      expect(await statusOf('change_request', cr.id)).toBe('approved');
      expect(await statusOf('registration', reg)).toBe('dropped');
      expect(await auditRows(cr.id, 'CHANGE_REQUEST_APPROVED')).toBe(1);
    });
  });

  // ─── Paper receipts ────────────────────────────────────────────────────────

  describe('paper receipts', () => {
    let f: Family, handed: string, lost: string, voided: string;
    beforeAll(async () => {
      f = await family('receipt');
      [handed, lost, voided] = (await deskCash(f, [subj.S8!, subj.S9!, subj.S10!])).registrations.map((r) => r.id) as [string, string, string];
    });

    it('handed over: refused audit, still at the desk', async () => {
      const rc = await receiptOf(handed);
      const issue = () => officer.api.v1.receipts[':id'].issue.$post({ param: { id: rc } });
      expect((await withAuditRefused('RECEIPT_ISSUED', issue)).status).toBeGreaterThanOrEqual(400);
      expect(await statusOf('receipt', rc)).toBe('pending_issue');

      await apiResponse(issue());
      expect(await statusOf('receipt', rc)).toBe('issued');
      expect(await auditRows(rc, 'RECEIPT_ISSUED')).toBe(1);
    });

    it('brought back after a drop: refused audit, the drop stays parked and nothing is refunded', async () => {
      const rc = await receiptOf(handed);
      await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: handed }, json: { reason: 'dropping this one' } }));
      expect(await statusOf('registration', handed)).toBe('dropped_pending_receipt');
      const before = (await escrowOf(f.studentId)).free;
      const giveBack = () => officer.api.v1.receipts[':id'].return.$post({ param: { id: rc }, json: { notes: 'paper back at the desk' } });

      expect((await withAuditRefused('RECEIPT_RETURNED', giveBack)).status).toBeGreaterThanOrEqual(400);
      expect(await statusOf('receipt', rc)).toBe('return_required');
      expect(await statusOf('registration', handed)).toBe('dropped_pending_receipt');
      expect((await escrowOf(f.studentId)).free).toBe(before);

      await apiResponse(giveBack());
      expect(await statusOf('receipt', rc)).toBe('returned');
      expect(await statusOf('registration', handed)).toBe('dropped');
      expect((await escrowOf(f.studentId)).free).toBeGreaterThan(before);
      expect(await auditRows(rc, 'RECEIPT_RETURNED')).toBe(1);
    });

    it('written off as lost: refused audit, unchanged', async () => {
      const rc = await receiptOf(lost);
      const writeOff = () => finadmin.api.v1.receipts[':id'].lost.$post({ param: { id: rc }, json: { reason: 'family lost it' } });
      expect((await withAuditRefused('RECEIPT_LOST', writeOff)).status).toBeGreaterThanOrEqual(400);
      expect(await statusOf('receipt', rc)).toBe('pending_issue');

      await apiResponse(writeOff());
      expect(await statusOf('receipt', rc)).toBe('lost');
      expect(await auditRows(rc, 'RECEIPT_LOST')).toBe(1);
    });

    it("a paid subject's receipt cannot be voided: it is the family's proof of payment (ST-14, MA-20)", async () => {
      const rc = await receiptOf(voided);
      const r = await refused(finadmin.api.v1.receipts[':id'].void.$post({ param: { id: rc }, json: { reason: 'printed in error' } }));
      expect(r).toEqual({ status: 409, error: 'This subject is still paid for, so its receipt stays valid and cannot be voided — void is for the receipt of a dropped subject' });
      expect(await statusOf('receipt', rc)).toBe('pending_issue');
      expect(await statusOf('registration', voided)).toBe('confirmed');
    });

    it("voided after its subject was dropped: refused audit, the drop stays parked and nothing is refunded", async () => {
      const rc = await receiptOf(voided);
      await apiResponse(officer.api.v1.receipts[':id'].issue.$post({ param: { id: rc } }));
      await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: voided }, json: { reason: 'dropping this one too' } }));
      const before = (await escrowOf(f.studentId)).free;
      const writeOff = () => finadmin.api.v1.receipts[':id'].void.$post({ param: { id: rc }, json: { reason: 'paper destroyed' } });

      expect((await withAuditRefused('RECEIPT_VOIDED', writeOff)).status).toBeGreaterThanOrEqual(400);
      expect(await statusOf('receipt', rc)).toBe('return_required');
      expect(await statusOf('registration', voided)).toBe('dropped_pending_receipt');
      expect((await escrowOf(f.studentId)).free).toBe(before);

      await apiResponse(writeOff());
      expect(await statusOf('receipt', rc)).toBe('void');
      expect(await statusOf('registration', voided)).toBe('dropped');
      expect((await escrowOf(f.studentId)).free).toBeGreaterThan(before);
      expect(await auditRows(rc, 'RECEIPT_VOIDED')).toBe(1);
    });
  });

  // ─── Escrow ────────────────────────────────────────────────────────────────

  it('a withdrawal request: refused audit, no request and no hold on the balance', async () => {
    const f = await family('withdraw');
    const credit = await withCredit(f, subj.S11!);
    const ask = () => f.parent.api.v1.escrow.withdraw.$post({ json: { studentId: f.studentId, amount: 100 } });

    expect((await withAuditRefused('WITHDRAWAL_REQUESTED', ask)).status).toBeGreaterThanOrEqual(400);
    expect(await sql(`select 1 from withdrawal_request w join escrow e on e.id = w.escrow_id where e.student_id = $1`, [f.studentId])).toEqual([]);
    expect((await escrowOf(f.studentId)).free).toBe(credit);

    const w = await apiResponse(ask());
    expect((await escrowOf(f.studentId)).free).toBe(money(credit - 100));
    expect(await auditRows(w.id, 'WITHDRAWAL_REQUESTED')).toBe(1);
    await apiResponse(officer.api.v1.escrow.admin.withdrawals[':id'].reject.$post({ param: { id: w.id }, json: { notes: 'the family keeps it as credit' } }));
  });

  it('a transfer between two children of one parent moves both balances with one audit row, or nothing', async () => {
    const f = await family('transfer-a');
    const sibling = await family('transfer-b');
    const link = await apiResponse(f.parent.api.v1.links.$post({ json: { studentEmail: sibling.student.email } }));
    await apiResponse(sibling.student.api.v1.links[':id'].$put({ param: { id: link!.id }, json: { status: 'approved' } }));
    const credit = await withCredit(f, subj.S12!);
    const transfer = () => f.parent.api.v1.escrow.transfer.$post({ json: { fromStudentId: f.studentId, toStudentId: sibling.studentId, amount: 200 } });

    expect((await withAuditRefused('ESCROW_TRANSFER', transfer)).status).toBeGreaterThanOrEqual(400);
    expect((await escrowOf(f.studentId)).free).toBe(credit);
    expect((await escrowOf(sibling.studentId)).free).toBe(0);

    await apiResponse(transfer());
    expect((await escrowOf(f.studentId)).free).toBe(money(credit - 200));
    expect((await escrowOf(sibling.studentId)).free).toBe(200);
    expect(await sql(
      `select t.amount::float as amount, t.type, t.reason from escrow_transaction t join escrow e on e.id = t.escrow_id
       where e.student_id in ($1, $2) and t.reason in ('transfer_out', 'transfer_in') order by t.reason desc`,
      [f.studentId, sibling.studentId]
    )).toEqual([{ amount: 200, type: 'debit', reason: 'transfer_out' }, { amount: 200, type: 'credit', reason: 'transfer_in' }]);
    expect(await auditRows(f.studentId, 'ESCROW_TRANSFER')).toBe(1);
  });

  // ─── Remark fee ────────────────────────────────────────────────────────────

  it('a remark fee: its checkout, and its refund when the grade changes, each commit with their audit row', async () => {
    const f = await family('remark');
    const reg = (await deskCash(f, [subj.S13!])).registrations[0]!.id;
    await apiResponse(officer.api.v1.remarks.results.$post({ json: { results: [{ registrationId: reg, grade: 'D' }] } }));
    const remark = await apiResponse(f.parent.api.v1.remarks.$post({
      json: { registrationId: reg, serviceType: 'clerical_check', papers: [{ paperCode: '9702/12', paperName: 'Paper 1' }] },
    }));
    await apiResponse(f.parent.api.v1.remarks[':id'].consent.$post({ param: { id: remark.id }, json: { attest: true } }));
    const pay = () => f.parent.api.v1.remarks[':id'].pay.$post({ param: { id: remark.id }, json: { paymentMethod: 'in_school' } });
    const remarkPayments = `select id from payment where purpose = 'remark' and metadata->>'remarkRequestId' = $1`;

    expect((await withAuditRefused('REMARK_PAYMENT_INITIATED', pay)).status).toBeGreaterThanOrEqual(400);
    expect(await sql(remarkPayments, [remark.id])).toEqual([]);
    const payment = await apiResponse(pay());
    expect(await auditRows(remark.id, 'REMARK_PAYMENT_INITIATED')).toBe(1);

    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: payment!.id }, json: { instrumentUsed: 'cash' } }));
    await apiResponse(officer.api.v1.remarks[':id']['submit-board'].$post({ param: { id: remark.id }, json: { boardReference: 'CIE-AX-1' } }));
    const item = (await one<{ id: string }>(`select id from remark_request_item where remark_request_id = $1`, [remark.id])).id;
    const before = (await escrowOf(f.studentId)).free;
    const outcome = () => officer.api.v1.remarks[':id'].outcome.$post({
      param: { id: remark.id }, json: { items: [{ itemId: item, outcome: 'mark_up', gradeAfter: 'C' }], gradeChanged: true },
    });

    expect((await withAuditRefused('REMARK_OUTCOME_RECORDED', outcome)).status).toBeGreaterThanOrEqual(400);
    expect(await statusOf('remark_request', remark.id)).toBe('submitted');
    expect((await escrowOf(f.studentId)).free).toBe(before);

    await apiResponse(outcome());
    expect(await statusOf('remark_request', remark.id)).toBe('outcome_recorded');
    expect((await escrowOf(f.studentId)).free).toBe(money(before + 400));
    expect(await auditRows(remark.id, 'REMARK_OUTCOME_RECORDED')).toBe(1);
  });

  // ─── School fee ────────────────────────────────────────────────────────────

  it("the school fee: a family's checkout and the desk's collection each commit with their audit row", async () => {
    const f = await family('fee-app');
    const g = await family('fee-desk');
    // A schedule gates every family in the shared test database; it lives only inside this test.
    const schedule = await apiResponse(finadmin.api.v1['school-fees'].schedules.$post({
      json: { academicYear: academicYearOf(new Date()), amount: 5000, opensAt: new Date(Date.now() - 86_400_000).toISOString() },
    }));
    try {
      const feePayments = `select id from payment where student_id = $1 and purpose = 'school_fee'`;

      const checkout = () => f.parent.api.v1['school-fees'].pay.$post({ json: { studentId: f.studentId, paymentMethod: 'in_school' } });
      expect((await withAuditRefused('SCHOOL_FEE_PAYMENT_INITIATED', checkout)).status).toBeGreaterThanOrEqual(400);
      expect(await sql(feePayments, [f.studentId])).toEqual([]);
      const own = await apiResponse(checkout());
      expect(await auditRows(own!.id, 'SCHOOL_FEE_PAYMENT_INITIATED')).toBe(1);
      await apiResponse(f.parent.api.v1.payments[':id'].cancel.$post({ param: { id: own!.id } }));

      const collect = () => officer.api.v1['school-fees']['desk-pay'].$post({ json: { studentId: g.studentId, instrumentUsed: 'cash' } });
      expect((await withAuditRefused('DESK_SCHOOL_FEE_COLLECTED', collect)).status).toBeGreaterThanOrEqual(400);
      expect(await sql(feePayments, [g.studentId])).toEqual([]);
      const desk = await apiResponse(collect());
      expect(await statusOf('payment', desk.paymentId)).toBe('completed');
      expect(await auditRows(desk.paymentId, 'DESK_SCHOOL_FEE_COLLECTED')).toBe(1);
    } finally {
      await apiResponse(finadmin.api.v1['school-fees'].schedules[':id'].$delete({ param: { id: schedule.id } }));
    }
  });

  // ─── Preregistration, the close, and the opening ───────────────────────────

  describe('preregistration and the scheduler', () => {
    let f: Family, cancelled: string, captured: string, unpaid: string, request: string;
    const fund = async (reg: string) => {
      const pay = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [reg], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
      await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay.id! }, json: { instrumentUsed: 'cash' } }));
    };

    beforeAll(async () => {
      f = await family('prereg');
      [cancelled, captured] = (await apiResponse(f.parent.api.v1.registrations.preregister.$post({
        json: { sessionId: draftId, ...(await reservationOf(draftId, [subj.S14!, subj.S15!])), studentId: f.studentId },
      }))).map((r) => r.id) as [string, string];
      await fund(cancelled);
      await fund(captured);
      expect((await escrowOf(f.studentId)).held).toBe(3000);
    });

    it('a funded preregistration cancelled: refused audit, still held', async () => {
      const cancel = () => f.parent.api.v1.registrations[':id']['cancel-prereg'].$post({ param: { id: cancelled } });
      expect((await withAuditRefused('PREREG_CANCELLED', cancel)).status).toBeGreaterThanOrEqual(400);
      expect(await statusOf('registration', cancelled)).toBe('preregistered');
      expect((await escrowOf(f.studentId)).held).toBe(3000);

      await apiResponse(cancel());
      expect(await statusOf('registration', cancelled)).not.toBe('preregistered');
      expect((await escrowOf(f.studentId)).held).toBe(1500);
      expect(await auditRows(cancelled, 'PREREG_CANCELLED')).toBe(1);
    });

    it('a close that cannot write its expiry rows expires nothing; the recovery sweep finishes it, with the rows', async () => {
      unpaid = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId, ...(await reservationOf(sessionId, [subj.S16!])), studentId: f.studentId } })))[0]!.id;
      const kept = (await deskCash(f, [subj.S17!])).registrations[0]!.id;
      request = (await apiResponse(f.student.api.v1.registrations[':id']['request-drop'].$post({ param: { id: kept }, json: { reason: 'not this one' } }))).id;

      const release = await refuseAudit('REGISTRATION_EXPIRED');
      try {
        // The close itself stands; its finalisation fails and is left for the sweep (ST-06).
        await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: sessionId }, json: { reason: 'audit in transaction: close' } }));
      } finally {
        await release();
      }
      expect(await statusOf('registration', unpaid)).toBe('pending_payment');
      expect((await one<{ finalized_at: string | null }>(`select finalized_at from registration_session where id = $1`, [sessionId])).finalized_at).toBeNull();

      await runSessionRecovery();
      expect(await statusOf('registration', unpaid)).toBe('expired');
      expect(await auditRows(unpaid, 'REGISTRATION_EXPIRED')).toBe(1);
      expect(await one(`select previous_data, new_data from audit_log where entity_id = $1 and action = 'REGISTRATION_EXPIRED'`, [unpaid]))
        .toEqual({ previous_data: { status: 'pending_payment' }, new_data: { status: 'expired', reason: 'session_closed' } });
      expect(await statusOf('change_request', request)).toBe('rejected');
      expect(await auditRows(request, 'CHANGE_REQUEST_REJECTED')).toBe(1);
      expect((await one<{ finalized_at: string | null }>(`select finalized_at from registration_session where id = $1`, [sessionId])).finalized_at).not.toBeNull();
    });

    it('an opening that cannot write its capture row takes no held money; the next sweep captures it, with the row', async () => {
      const release = await refuseAudit('PREREG_CAPTURED');
      try {
        await apiResponse(adm.api.v1.sessions[':id'].activate.$post({ param: { id: draftId } }));
        await runSessionRecovery();
        expect(await statusOf('registration', captured)).toBe('preregistered');
        expect((await escrowOf(f.studentId)).held).toBe(1500);
      } finally {
        await release();
      }

      await runSessionRecovery();
      expect(await statusOf('registration', captured)).toBe('confirmed');
      expect((await escrowOf(f.studentId)).held).toBe(0);
      expect(await auditRows(captured, 'PREREG_CAPTURED')).toBe(1);
      await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: draftId }, json: { reason: 'audit in transaction: done' } }));
    });
  });
});
