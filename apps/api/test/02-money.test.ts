import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, refused, one, sql, notified, money,
  takings, takingsDelta, openWindow, type Client, type Takings,
} from './helpers';

/**
 * Money in and money out through the self-serve channel: InstaPay with
 * escrow applied, the reference dedup (RF-07), the cash-refund maker-checker,
 * and the finance-admin reversal (RF-08). FOUNDATION_AUDIT.md checkpoints
 * 10, 11, 12, 15.
 */
describe('money paths', () => {
  let adm: Client, officer: Client, finadmin: Client, parent: Client, student: Client, studentId: string;
  let history: string, biology: string, ict: string, sessionId: string;
  let biologyReg: string, biologyPayment: string, biologyReceiptNumber: string, ictPayment: string;
  let takingsBefore: Takings;

  beforeAll(async () => {
    adm = await admin('money');
    officer = await staff(adm, 'finance_officer', 'money');
    finadmin = await staff(adm, 'finance_admin', 'money');
    takingsBefore = await takings(officer);
    history = await subject(adm, 'T0470', 'History', { course: 1100, registration: 400 });
    biology = await subject(adm, 'T0610', 'Biology', { course: 1200, registration: 300 });
    ict = await subject(adm, 'T0417', 'ICT', { course: 1200, registration: 300 });
    sessionId = await session(adm, 'June (money)', 'june', 'igcse', { ...openWindow(), activate: true });
    ({ parent, student, studentId } = await onboard(officer, 'money'));

    // Give the family 1500 EGP of free escrow the way it really happens:
    // a desk-paid subject, receipt handed over, dropped, receipt returned.
    const desk = await apiResponse(
      officer.api.v1.registrations.desk.$post({
        json: { studentId, sessionId, subjectIds: [history], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
      })
    );
    const historyReg = desk.registrations[0]!.id;
    const rc = await one<{ id: string }>(`select id from receipt where registration_id = $1`, [historyReg]);
    await apiResponse(officer.api.v1.receipts[':id'].issue.$post({ param: { id: rc.id } }));
    await apiResponse(parent.api.v1.registrations[':id'].drop.$post({ param: { id: historyReg }, json: { reason: 'setup for escrow' } }));
    await apiResponse(officer.api.v1.receipts[':id'].return.$post({ param: { id: rc.id }, json: {} }));
    expect(money((await one<{ balance: string }>(`select balance from escrow where student_id = $1`, [studentId])).balance)).toBe(1500);
  });

  it('InstaPay: 500 EGP escrow applied at checkout, reference submitted, officer verifies', async () => {
    const created = await apiResponse(
      parent.api.v1.registrations.direct.$post({ json: { sessionId, subjectIds: [biology], studentId } })
    );
    biologyReg = created[0]!.id;
    expect(created[0]?.status).toBe('pending_payment');

    const pay = await apiResponse(
      parent.api.v1.payments.initiate.$post({ json: { registrationIds: [biologyReg], paymentMethod: 'instapay', escrowAmountToApply: 500 } })
    );
    expect(pay).toMatchObject({ amount: 1000, escrowAmountApplied: 500, status: 'pending' });
    biologyPayment = pay.id!;
    expect((pay.metadata as { instapay: { account: { bankName: string }; amountDue: number } }).instapay)
      .toMatchObject({ account: { bankName: 'Test Bank' }, amountDue: 1000 });
    expect(money((await one<{ balance: string }>(`select balance from escrow where student_id = $1`, [studentId])).balance)).toBe(1000);

    await apiResponse(parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: biologyPayment }, json: { reference: 'FT-TEST-0001' } }));
    expect(await one(`select status, verification_reference from payment where id = $1`, [biologyPayment])).toEqual({
      status: 'pending_verification', verification_reference: 'FT-TEST-0001',
    });

    const queue = await apiResponse(officer.api.v1.payments['pending-manual'].$get());
    expect(queue.map((p) => p.id)).toContain(biologyPayment);

    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: biologyPayment }, json: { notes: 'matched on bank statement' } }));
    expect(await one(`select status, instrument_used from payment where id = $1`, [biologyPayment])).toEqual({ status: 'completed', instrument_used: 'instapay' });
    expect((await one<{ status: string }>(`select status from registration where id = $1`, [biologyReg])).status).toBe('confirmed');
    biologyReceiptNumber = (await one<{ receipt_number: string }>(`select receipt_number from receipt where registration_id = $1`, [biologyReg])).receipt_number;
    expect(biologyReceiptNumber).toMatch(/^RCP-/);
    expect(money((await one<{ balance: string }>(`select balance from escrow where student_id = $1`, [studentId])).balance)).toBe(1000);

    // Second PAYMENT_CONFIRMED for this family (the first was the History desk payment in setup).
    const toParent = await notified(parent.email, 'PAYMENT_CONFIRMED', 2);
    // The confirmation names the full 1500 the payment settled (1000 transferred + 500 escrow), not the transfer alone.
    expect(toParent[1]?.body).toContain('Payment of EGP 1500.00 via instapay has been confirmed');
    await notified(student.email, 'PAYMENT_CONFIRMED', 2);
  });

  it('refuses a reference already used by another payment with a sentence, not SQL (RF-07)', async () => {
    const created = await apiResponse(parent.api.v1.registrations.direct.$post({ json: { sessionId, subjectIds: [ict], studentId } }));
    ictPayment = (await apiResponse(
      parent.api.v1.payments.initiate.$post({ json: { registrationIds: [created[0]!.id], paymentMethod: 'instapay', escrowAmountToApply: 0 } })
    )).id!;

    const dup = await refused(parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: ictPayment }, json: { reference: 'FT-TEST-0001' } }));
    expect(dup.status).toBe(409);
    expect(dup.error).toBe('This transaction reference has already been submitted for another payment. Double-check your InstaPay receipt.');
    expect(await one(`select status, verification_reference from payment where id = $1`, [ictPayment])).toEqual({ status: 'pending', verification_reference: null });
  });

  it('cash refund is maker-checker: officer disburses, only the finance admin completes', async () => {
    const w = await apiResponse(parent.api.v1.escrow.withdraw.$post({ json: { studentId, amount: 1000 } }));
    expect(money((await one<{ balance: string }>(`select balance from escrow where student_id = $1`, [studentId])).balance)).toBe(0);

    await apiResponse(officer.api.v1.escrow.admin.withdrawals[':id'].fulfill.$post({ param: { id: w.id }, json: { releasedAmount: 1000, notes: 'cash handed at desk' } }));
    const afterFulfil = await one<{ status: string; released: string; approved_by: string | null }>(
      `select status, released_amount as released, approved_by from withdrawal_request where id = $1`, [w.id]
    );
    expect({ ...afterFulfil, released: money(afterFulfil.released) }).toEqual({ status: 'fulfilled', released: 1000, approved_by: null });

    expect((await refused(officer.api.v1.escrow.admin.withdrawals[':id'].approve.$post({ param: { id: w.id } }))).status).toBe(403);
    await apiResponse(finadmin.api.v1.escrow.admin.withdrawals[':id'].approve.$post({ param: { id: w.id } }));
    expect((await one<{ approved_by: string }>(`select approved_by from withdrawal_request where id = $1`, [w.id])).approved_by).toBe(finadmin.id);

    // Since the snapshot: 1500 cash (History) + 1000 InstaPay in, 1000 cash refunded out.
    // The drawer holds only the cash: 1500 in, 1000 out (MA-04).
    expect(takingsDelta(takingsBefore, await takings(officer))).toMatchObject({
      moneyIn: 2500, escrowApplied: 500, byInstrument: { cash: 1500, instapay: 1000 }, cashRefunded: 1000, moneyOut: 1000, net: 1500,
      drawer: { cashIn: 1500, cashOut: 1000, net: 500 },
    });
  });

  it('finance-admin reversal restores every row and tells the family which receipt is void (RF-08)', async () => {
    expect((await refused(officer.api.v1.payments[':id'].reverse.$post({ param: { id: biologyPayment }, json: { reason: 'should be refused', moneyReturned: false } }))).status).toBe(403);

    // The transfer never reached the bank: nothing is returned, the confirmation was a mistake (MO-11).
    const r = await apiResponse(
      finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: biologyPayment }, json: { reason: 'bank statement did not match after all', moneyReturned: false } })
    );
    expect(r).toEqual({ reversed: true, registrationsReverted: 1 });
    expect((await one<{ status: string }>(`select status from payment where id = $1`, [biologyPayment])).status).toBe('refunded');
    expect((await one<{ status: string }>(`select status from registration where id = $1`, [biologyReg])).status).toBe('pending_payment');
    expect((await one<{ status: string }>(`select status from receipt where registration_id = $1`, [biologyReg])).status).toBe('void');
    expect(money((await one<{ balance: string }>(`select balance from escrow where student_id = $1`, [studentId])).balance)).toBe(500);
    const refund = await sql<{ amount: string; reason: string }>(
      `select e.amount, e.reason from escrow_transaction e join escrow x on x.id = e.escrow_id where x.student_id = $1 and e.reason = 'payment_refund'`, [studentId]
    );
    expect(refund.map((x) => [money(x.amount), x.reason])).toEqual([[500, 'payment_refund']]);

    const toParent = await notified(parent.email, 'PAYMENT_REVERSED', 1);
    expect(toParent[0]?.body).toContain(`Receipt ${biologyReceiptNumber} is no longer valid`);
    expect(toParent[0]?.body).toContain('EGP 1500.00');
    expect(toParent[0]?.body).toContain('1 registration is back to pending payment');
    expect(toParent[0]?.body).toContain('no money was received for it');
    await notified(student.email, 'PAYMENT_REVERSED', 1);

    // No money had come in, so this is a correction, not money out (MO-11):
    // the InstaPay payment leaves today's money in and is listed as corrected,
    // and nothing is subtracted. (Before the money audit it left money in AND
    // was subtracted again, and this test never read the net, which came to -500.)
    expect(takingsDelta(takingsBefore, await takings(officer))).toMatchObject({
      moneyIn: 1500, escrowApplied: 0, byInstrument: { cash: 1500 },
      reversedTotal: 0, cashRefunded: 1000, moneyOut: 1000, net: 500, correctedTotal: 1000,
      drawer: { cashIn: 1500, cashOut: 1000, net: 500, corrected: 0 },
    });
  });
});
