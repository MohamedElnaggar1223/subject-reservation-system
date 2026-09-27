import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import {
  admin, staff, onboard, loneStudent, subject, session, refused, one, sql, notified, audited, notificationsFor, money,
  takings, takingsDelta, openWindow, type Client, type Takings,
} from './helpers';

/**
 * The desk is the primary channel (UX_AUDIT §1): a family walks up, staff
 * do everything. This file is the desk day proven in FOUNDATION_AUDIT.md
 * checkpoints 3, 4, 7, 8, 9 and 19, plus the RF-03 fix.
 */
describe('the desk', () => {
  let adm: Client, officer: Client, parent: Client, student: Client, studentId: string;
  let physics: string, chemistry: string, sessionId: string;
  let paymentId: string, physicsReg: string, chemistryReg: string;
  let physicsReceipt: { id: string; receipt_number: string };
  let takingsBefore: Takings;

  beforeAll(async () => {
    adm = await admin('desk');
    officer = await staff(adm, 'finance_officer', 'desk');
    takingsBefore = await takings(officer);
    physics = await subject(adm, 'T0625', 'Physics', { course: 1200, registration: 300 });
    chemistry = await subject(adm, 'T0620', 'Chemistry', { course: 1200, registration: 300 });
    sessionId = await session(adm, 'November (desk)', 'november', 'igcse', { ...openWindow(), activate: true });
  });

  it('onboards a walk-in family: parent, grade-11 student, link approved on the spot', async () => {
    ({ parent, student, studentId } = await onboard(officer, 'desk'));
    const s = await one<{ role: string; grade: number; student_id: string; phone: string }>(
      `select role, grade, student_id, phone from "user" where id = $1`, [studentId]
    );
    expect(s).toMatchObject({ role: 'student', grade: 11, phone: '01111111111' });
    expect(s.student_id).toMatch(/^STU-\d{8}-[0-9A-Z]{5}$/);
    const link = await one<{ status: string }>(`select status from parent_student_link where student_id = $1`, [studentId]);
    expect(link.status).toBe('approved');
  });

  it('registers two subjects and takes 3000 EGP cash in one action', async () => {
    const r = await apiResponse(
      officer.api.v1.registrations.desk.$post({
        json: { studentId, sessionId, subjectIds: [physics, chemistry], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
      })
    );
    expect(r.totalCost).toBe(3000);
    expect(r.collected).toBe(3000);
    expect(r.payment).not.toBeNull();
    paymentId = r.payment!.id;
    physicsReg = r.registrations.find((x) => x.subjectId === physics)!.id;
    chemistryReg = r.registrations.find((x) => x.subjectId === chemistry)!.id;

    const regs = await sql<{ status: string; price: string; course: string; reg: string }>(
      `select status, price_at_registration as price, course_fee_at_registration as course, registration_fee_at_registration as reg
       from registration where student_id = $1 order by created_at`, [studentId]
    );
    expect(regs.map((x) => [x.status, money(x.price), money(x.course), money(x.reg)])).toEqual([
      ['confirmed', 1500, 1200, 300],
      ['confirmed', 1500, 1200, 300],
    ]);

    const pay = await one<{ amount: string; method: string; status: string; instrument: string; purpose: string }>(
      `select amount, payment_method as method, status, instrument_used as instrument, purpose from payment where id = $1`, [paymentId]
    );
    expect({ ...pay, amount: money(pay.amount) }).toEqual({ amount: 3000, method: 'in_school', status: 'completed', instrument: 'cash', purpose: 'registration' });

    const links = await one<{ n: string }>(`select count(*)::text as n from payment_registration where payment_id = $1`, [paymentId]);
    expect(Number(links.n)).toBe(2);

    const receipts = await sql<{ status: string; receipt_number: string }>(
      `select status, receipt_number from receipt where registration_id in ($1, $2)`, [physicsReg, chemistryReg]
    );
    expect(receipts.map((x) => x.status)).toEqual(['pending_issue', 'pending_issue']);
    for (const x of receipts) expect(x.receipt_number).toMatch(/^RCP-[0-9A-F]{10}$/);

    // DESK_REGISTRATION is logged after the response; wait for it rather
    // than read the table the instant the request returns.
    const actions = await audited(
      [physicsReg, chemistryReg, studentId],
      ['DESK_FAMILY_ONBOARDED', 'REGISTRATION_CONFIRMED', 'REGISTRATION_CONFIRMED', 'DESK_REGISTRATION']
    );
    expect(actions).toEqual(
      expect.arrayContaining(['DESK_FAMILY_ONBOARDED', 'REGISTRATION_CONFIRMED', 'REGISTRATION_CONFIRMED', 'DESK_REGISTRATION'])
    );
  });

  it('records the family as payer of record and tells the parent and student, not the officer (RF-03)', async () => {
    const payer = await one<{ email: string; role: string; confirmed_by: string }>(
      `select u.email, u.role, p.confirmed_by from payment p join "user" u on u.id = p.parent_id where p.id = $1`, [paymentId]
    );
    expect(payer).toMatchObject({ email: parent.email, role: 'parent', confirmed_by: officer.id });

    const toParent = await notified(parent.email, 'PAYMENT_CONFIRMED', 1);
    expect(toParent[0]?.title).toBe('Payment confirmed — November (desk)');
    await notified(student.email, 'PAYMENT_CONFIRMED', 1);
    expect((await notificationsFor(officer.email)).length).toBe(0);

    // The payer of record decides whose payment history carries the desk
    // payment: the parent's own history lists it. (Finance roles see every
    // payment through the same endpoint, so the officer's list is not a
    // personal history and proves nothing here.)
    const parentHistory = await apiResponse(parent.api.v1.payments.$get({ query: {} }));
    expect(parentHistory.map((p) => p.id)).toContain(paymentId);
  });

  it('refuses to take money for a student with no linked parent, but still registers them', async () => {
    const lone = await loneStudent(adm, 'desk');
    const withMoney = await refused(
      officer.api.v1.registrations.desk.$post({
        json: { studentId: lone.id, sessionId, subjectIds: [physics], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
      })
    );
    expect(withMoney.status).toBe(400);
    expect(withMoney.error).toBe('This student has no linked parent — use New Family (Onboard) to add the parent before taking money');
    expect(await sql(`select 1 from registration where student_id = $1`, [lone.id])).toEqual([]);

    const registerOnly = await apiResponse(
      officer.api.v1.registrations.desk.$post({ json: { studentId: lone.id, sessionId, subjectIds: [physics] } })
    );
    expect(registerOnly.registrations.map((x) => x.status)).toEqual(['pending_payment']);
    expect(registerOnly.collected).toBe(0);
  });

  it('shows the whole student on one screen for the desk', async () => {
    const s = await apiResponse(officer.api.v1.users[':id'].summary.$get({ param: { id: studentId } }));
    expect(s.owing).toBe(0);
    expect(s.escrow).toEqual({ freeBalance: 0, heldBalance: 0 });
    expect(s.registrations.length).toBe(2);
    expect(s.payments.length).toBe(1);
    expect(s.parents.map((p) => p.email)).toEqual([parent.email]);
  });

  it('lets the family read their own receipt with the tracked number', async () => {
    physicsReceipt = await one(`select id, receipt_number from receipt where registration_id = $1`, [physicsReg]);
    const r = await apiResponse(parent.api.v1.receipts[':id'].$get({ param: { id: physicsReceipt.id } }));
    expect(r).toMatchObject({ receiptNumber: physicsReceipt.receipt_number, status: 'pending_issue' });
  });

  it('gates the refund on the paper receipt: drop parks 100%, money moves only when the receipt is back', async () => {
    await apiResponse(officer.api.v1.receipts[':id'].issue.$post({ param: { id: physicsReceipt.id } }));
    expect((await one<{ status: string }>(`select status from receipt where id = $1`, [physicsReceipt.id])).status).toBe('issued');

    const drop = await apiResponse(
      parent.api.v1.registrations[':id'].drop.$post({ param: { id: physicsReg }, json: { reason: 'changed plans this term' } })
    );
    expect(drop).toEqual({ success: true, gated: true, creditedAmount: 0, refundAmount: 1500, refundPercentage: 100 });
    expect((await one<{ status: string }>(`select status from registration where id = $1`, [physicsReg])).status).toBe('dropped_pending_receipt');
    const parked = await one<{ status: string; refund: string; reason: string }>(
      `select status, refund_amount_on_return as refund, refund_reason as reason from receipt where id = $1`, [physicsReceipt.id]
    );
    expect({ ...parked, refund: money(parked.refund) }).toEqual({ status: 'return_required', refund: 1500, reason: 'drop' });
    expect(await sql(`select 1 from escrow where student_id = $1 and balance > 0`, [studentId])).toEqual([]);

    await apiResponse(officer.api.v1.receipts[':id'].return.$post({ param: { id: physicsReceipt.id }, json: { notes: 'paper back at desk' } }));
    expect((await one<{ status: string }>(`select status from registration where id = $1`, [physicsReg])).status).toBe('dropped');
    expect((await one<{ status: string }>(`select status from receipt where id = $1`, [physicsReceipt.id])).status).toBe('returned');
    expect(money((await one<{ balance: string }>(`select balance from escrow where student_id = $1`, [studentId])).balance)).toBe(1500);
    const ledger = await sql<{ amount: string; type: string; reason: string; balance_type: string }>(
      `select e.amount, e.type, e.reason, e.balance_type from escrow_transaction e join escrow x on x.id = e.escrow_id where x.student_id = $1`, [studentId]
    );
    expect(ledger.map((l) => [money(l.amount), l.type, l.reason, l.balance_type])).toEqual([[1500, 'credit', 'drop', 'free']]);

    await notified(parent.email, 'ESCROW_BALANCE_CHANGED', 1);
    await notified(student.email, 'DROP_SWAP_PROCESSED', 1);
  });

  it('reconciles the day: this family added 3000 cash in and nothing out', async () => {
    const delta = takingsDelta(takingsBefore, await takings(officer));
    expect(delta).toMatchObject({
      moneyIn: 3000, escrowApplied: 0, byInstrument: { cash: 3000 }, reversedTotal: 0, cashRefunded: 0, moneyOut: 0, net: 3000,
      drawer: { cashIn: 3000, cashOut: 0, net: 3000 },
    });
  });
});
