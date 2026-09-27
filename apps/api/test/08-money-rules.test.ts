import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, refused, one, sql, notified, money, audited,
  takings, takingsOn, takingsDelta, openWindow, futureWindow, localYesterday, waitFor, type Client,
} from './helpers';

/**
 * Money rules (money-correctness audit, MONEY_AUDIT.md, finding ids MA-nn).
 *
 * Each scenario drives one money rule through the API the way the desk and the
 * families do, then reads the ledger, the payment rows and the day's takings
 * back. Concurrency scenarios fire the same request several times at once
 * through the in-process app, each on its own database connection.
 *
 * Session pair: january / as_level (05 creates it as a draft only; no January IGCSE
 * series exists).
 * Students are grade 12: 03 gates grade 11 behind a school fee.
 */

const escrowOf = async (studentId: string) => {
  const rows = await sql<{ balance: string }>(`select balance from escrow where student_id = $1`, [studentId]);
  return money(rows[0]?.balance ?? 0);
};
const statusOf = async (table: 'payment' | 'registration', id: string) =>
  (await one<{ status: string }>(`select status from ${table} where id = $1`, [id])).status;
const disbursedFor = async (withdrawalId: string) =>
  money((await one<{ total: string }>(
    `select coalesce(sum(amount), 0) as total from withdrawal_disbursement where withdrawal_request_id = $1`, [withdrawalId]
  )).total);

describe('money rules', () => {
  let adm: Client, officer: Client, officer2: Client, finadmin: Client, sessionId: string;
  const subj: Record<string, string> = {};

  type Family = { parent: Client; student: Client; studentId: string };
  const family = async (tag: string): Promise<Family> => onboard(officer, `mr-${tag}`, 12);

  /** Free escrow the way it really happens: paid at the desk, dropped before the receipt left the desk. */
  const fund = async (f: Family, subjectId: string) => {
    const desk = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f.studentId, sessionId, subjectIds: [subjectId], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: desk.registrations[0]!.id }, json: { reason: 'setup for escrow' } }));
  };
  const direct = async (f: Family, subjectId: string) =>
    (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId, subjectIds: [subjectId], studentId: f.studentId } })))[0]!.id;
  const deskCash = async (f: Family, subjectIds: string[]) =>
    apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f.studentId, sessionId, subjectIds, collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));

  beforeAll(async () => {
    adm = await admin('mr');
    officer = await staff(adm, 'finance_officer', 'mr');
    officer2 = await staff(adm, 'finance_officer', 'mr2');
    finadmin = await staff(adm, 'finance_admin', 'mr');
    for (const [code, name] of [
      ['PHY', 'Physics'], ['CHE', 'Chemistry'], ['BIO', 'Biology'], ['GEO', 'Geography'], ['HIS', 'History'],
      ['ECO', 'Economics'], ['ART', 'Art'], ['MUS', 'Music'], ['FRE', 'French'], ['GER', 'German'],
    ] as const) {
      subj[code] = await subject(adm, `MR-${code}`, `${name} (AS, money rules)`, { course: 1000, registration: 500 }, { qualificationLevel: 'as_level' });
    }
    sessionId = await session(adm, 'January (AS, money rules)', 'january', 'as_level', { ...openWindow(), activate: true });
  });

  // ─── Checkout concurrency ──────────────────────────────────────────────────

  describe('checkout under concurrency', () => {
    let f: Family, chemReg: string, chemPayment: string;

    beforeAll(async () => {
      f = await family('cc');
      await fund(f, subj.PHY!);
      expect(await escrowOf(f.studentId)).toBe(1500);
    });

    it('four checkouts of one registration at once: one payment, escrow taken once (MA-06)', async () => {
      chemReg = await direct(f, subj.CHE!);
      const attempts = await Promise.all([1, 2, 3, 4].map(() =>
        f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [chemReg], paymentMethod: 'instapay', escrowAmountToApply: 200 } })
      ));
      expect(attempts.filter((r) => r.ok)).toHaveLength(1);
      const links = await sql<{ id: string }>(
        `select p.id from payment p join payment_registration pr on pr.payment_id = p.id where pr.registration_id = $1`, [chemReg]
      );
      expect(links).toHaveLength(1);
      chemPayment = links[0]!.id;
      expect(await escrowOf(f.studentId)).toBe(1300);
    });

    it('two checkouts that each want most of the escrow: one is refused, the balance never goes below zero', async () => {
      const bio = await direct(f, subj.BIO!);
      const geo = await direct(f, subj.GEO!);
      const [a, b] = await Promise.all([bio, geo].map((id) =>
        f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [id], paymentMethod: 'in_school', escrowAmountToApply: 1000 } })
      ));
      expect([a!.ok, b!.ok].filter(Boolean)).toHaveLength(1);
      expect(await escrowOf(f.studentId)).toBe(300);
    });

    it('three officers confirm the same transfer at once: confirmed once, one receipt, one audit row (MA-07)', async () => {
      await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: chemPayment }, json: { reference: 'FT-MR-CC-1' } }));
      const clicks = await Promise.all([officer, officer2, finadmin].map((o) =>
        o.api.v1.payments[':id'].confirm.$post({ param: { id: chemPayment }, json: { notes: 'matched on statement' } })
      ));
      // One confirmation; every other click is told it lost, whether it lost
      // the race or arrived after the winner committed.
      expect(clicks.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(await statusOf('payment', chemPayment)).toBe('completed');
      expect(await statusOf('registration', chemReg)).toBe('confirmed');
      expect(await sql(`select id from receipt where registration_id = $1`, [chemReg])).toHaveLength(1);
      expect(await sql(`select id from audit_log where entity_id = $1 and action = 'PAYMENT_CONFIRMED'`, [chemPayment])).toHaveLength(1);
      expect(await sql(`select id from audit_log where entity_id = $1 and action = 'REGISTRATION_CONFIRMED'`, [chemReg])).toHaveLength(1);
      expect(await escrowOf(f.studentId)).toBe(300);
    });

    it('a confirmation and a rejection of the same transfer at once: one wins, and escrow matches the winner', async () => {
      const reg = await direct(f, subj.HIS!);
      const pay = (await apiResponse(f.parent.api.v1.payments.initiate.$post({
        json: { registrationIds: [reg], paymentMethod: 'instapay', escrowAmountToApply: 300 },
      }))).id!;
      await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: pay }, json: { reference: 'FT-MR-CC-RACE' } }));
      expect(await escrowOf(f.studentId)).toBe(0);
      const [conf, rej] = await Promise.all([
        officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay }, json: {} }),
        officer2.api.v1.payments[':id'].reject.$post({ param: { id: pay }, json: { reason: 'not on the statement' } }),
      ]);
      expect([conf!.ok, rej!.ok].filter(Boolean)).toHaveLength(1);
      if (conf!.ok) {
        expect([await statusOf('payment', pay), await statusOf('registration', reg), await escrowOf(f.studentId)]).toEqual(['completed', 'confirmed', 0]);
      } else {
        expect([await statusOf('payment', pay), await statusOf('registration', reg), await escrowOf(f.studentId)]).toEqual(['failed', 'pending_payment', 300]);
      }
    });

    it('a parent cancelling while the desk confirms: one wins, and escrow matches the winner', async () => {
      const f2 = await family('cc2');
      await fund(f2, subj.PHY!);
      const reg = await direct(f2, subj.CHE!);
      const pay = (await apiResponse(f2.parent.api.v1.payments.initiate.$post({
        json: { registrationIds: [reg], paymentMethod: 'in_school', escrowAmountToApply: 400 },
      }))).id!;
      const [can, conf] = await Promise.all([
        f2.parent.api.v1.payments[':id'].cancel.$post({ param: { id: pay } }),
        officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay }, json: { instrumentUsed: 'cash' } }),
      ]);
      expect([can!.ok, conf!.ok].filter(Boolean)).toHaveLength(1);
      expect(await escrowOf(f2.studentId)).toBe(can!.ok ? 1500 : 1100);
      expect(await statusOf('registration', reg)).toBe(can!.ok ? 'pending_payment' : 'confirmed');
    });
  });

  // ─── Abandoned and rejected payments ───────────────────────────────────────

  describe('a payment the family abandons or the bank never received', () => {
    let f: Family, physReg: string, firstPayment: string, secondPayment: string;

    beforeAll(async () => {
      f = await family('cancel');
      await fund(f, subj.GEO!);
      physReg = await direct(f, subj.PHY!);
    });

    it('the parent cancels an InstaPay checkout they never paid: escrow back, subject payable again (MA-02)', async () => {
      firstPayment = (await apiResponse(f.parent.api.v1.payments.initiate.$post({
        json: { registrationIds: [physReg], paymentMethod: 'instapay', escrowAmountToApply: 300 },
      }))).id!;
      expect(await escrowOf(f.studentId)).toBe(1200);

      // Coming back to checkout shows the started payment and what it covers.
      const summary = () => apiResponse(f.parent.api.v1.payments['checkout-summary'].$get({ query: { registrationIds: physReg } }));
      const open = (await summary())!.openPayment;
      expect(open).toMatchObject({ id: firstPayment, status: 'pending', paymentMethod: 'instapay', escrowAmountApplied: 300 });
      expect(open!.paymentRegistrations.map((pr) => pr.registration.subject.code)).toEqual(['MR-PHY']);

      const r = await apiResponse(f.parent.api.v1.payments[':id'].cancel.$post({ param: { id: firstPayment } }));
      expect((await summary())!.openPayment).toBeNull();
      expect(r).toMatchObject({ status: 'failed' });
      expect(await statusOf('payment', firstPayment)).toBe('failed');
      expect(await statusOf('registration', physReg)).toBe('pending_payment');
      expect(await escrowOf(f.studentId)).toBe(1500);
      const refund = await sql<{ amount: string }>(
        `select amount from escrow_transaction where related_payment_id = $1 and reason = 'payment_refund'`, [firstPayment]
      );
      expect(refund.map((x) => money(x.amount))).toEqual([300]);
      await audited([firstPayment], ['PAYMENT_CANCELLED']);

      // A second cancel is refused; the refund is not paid twice.
      expect((await refused(f.parent.api.v1.payments[':id'].cancel.$post({ param: { id: firstPayment } }))).status).toBe(409);
      expect(await escrowOf(f.studentId)).toBe(1500);
    });

    it('once a transfer reference is in, the parent can no longer cancel: finance decides', async () => {
      secondPayment = (await apiResponse(f.parent.api.v1.payments.initiate.$post({
        json: { registrationIds: [physReg], paymentMethod: 'instapay', escrowAmountToApply: 500 },
      }))).id!;
      await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: secondPayment }, json: { reference: 'FT-MR-NOMATCH' } }));
      const r = await refused(f.parent.api.v1.payments[':id'].cancel.$post({ param: { id: secondPayment } }));
      expect(r).toEqual({ status: 409, error: 'The transfer reference has been submitted; the finance office will verify or reject it.' });
      // The screens show the sentence, not the response body (apiResponse used to throw the raw JSON).
      await expect(apiResponse(f.parent.api.v1.payments[':id'].cancel.$post({ param: { id: secondPayment } })))
        .rejects.toThrow(/^The transfer reference has been submitted; the finance office will verify or reject it\.$/);
    });

    it('finance rejects a reference that is not on the bank statement: escrow back, family told why (MA-03)', async () => {
      expect((await refused(officer.api.v1.payments[':id'].reject.$post({ param: { id: secondPayment }, json: { reason: 'x' } }))).status).toBe(400);
      const r = await apiResponse(officer.api.v1.payments[':id'].reject.$post({
        param: { id: secondPayment }, json: { reason: 'No matching transfer on the bank statement' },
      }));
      expect(r).toMatchObject({ status: 'failed', registrationsExpired: 0 });
      expect(await one(`select status, metadata->'rejection'->>'reason' as reason from payment where id = $1`, [secondPayment])).toEqual({
        status: 'failed', reason: 'No matching transfer on the bank statement',
      });
      expect(await statusOf('registration', physReg)).toBe('pending_payment');
      expect(await escrowOf(f.studentId)).toBe(1500);
      await audited([secondPayment], ['PAYMENT_REJECTED']);

      const toParent = await notified(f.parent.email, 'PAYMENT_REJECTED', 1);
      expect(toParent[0]?.body).toContain('No matching transfer on the bank statement');
      expect(toParent[0]?.body).toContain('EGP 500.00 applied from escrow has been returned');
      await notified(f.student.email, 'PAYMENT_REJECTED', 1);

      // Nothing left to reject; a completed payment is reversed, not rejected.
      expect((await refused(officer.api.v1.payments[':id'].reject.$post({ param: { id: secondPayment }, json: { reason: 'second time' } }))).status).toBe(409);
    });

    it('the desk takes the money for a subject already registered and unpaid (MA-18)', async () => {
      // With a checkout in progress, the desk is told to settle that first.
      const pending = (await apiResponse(f.parent.api.v1.payments.initiate.$post({
        json: { registrationIds: [physReg], paymentMethod: 'in_school', escrowAmountToApply: 0 },
      }))).id!;
      const blocked = await refused(officer.api.v1.registrations.desk.collect.$post({
        json: { studentId: f.studentId, registrationIds: [physReg], instrumentUsed: 'cash' },
      }));
      expect(blocked).toEqual({
        status: 409,
        error: 'These subjects already have a checkout in progress — confirm it or reject it in the Finance Workbench first',
      });
      await apiResponse(officer.api.v1.payments[':id'].reject.$post({ param: { id: pending }, json: { reason: 'family is paying cash at the desk' } }));

      const before = await takings(officer);
      const r = await apiResponse(officer.api.v1.registrations.desk.collect.$post({
        json: { studentId: f.studentId, registrationIds: [physReg], instrumentUsed: 'cash', escrowAmountToApply: 500 },
      }));
      expect(r).toMatchObject({ collected: 1000, escrowApplied: 500 });
      expect(r.receipts.map((x) => x.status)).toEqual(['pending_issue']);
      expect(await statusOf('registration', physReg)).toBe('confirmed');
      expect(await escrowOf(f.studentId)).toBe(1000);
      expect(takingsDelta(before, await takings(officer))).toMatchObject({ moneyIn: 1000, escrowApplied: 500, drawer: { cashIn: 1000 } });
      await audited([r.paymentId], ['PAYMENT_CONFIRMED']);

      // Another family's subject, or one not waiting for payment, is refused.
      const again = await refused(officer.api.v1.registrations.desk.collect.$post({
        json: { studentId: f.studentId, registrationIds: [physReg], instrumentUsed: 'cash' },
      }));
      expect(again).toEqual({ status: 400, error: 'One or more subjects are not waiting for payment' });
    });

    it('a checkout whose subject expired cannot take a transfer reference', async () => {
      // The state a checkout started during a close is left in; built directly.
      const reg = await direct(f, subj.CHE!);
      const pay = (await apiResponse(f.parent.api.v1.payments.initiate.$post({
        json: { registrationIds: [reg], paymentMethod: 'instapay', escrowAmountToApply: 0 },
      }))).id!;
      await sql(`update registration set status = 'expired' where id = $1`, [reg]);
      const r = await refused(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: pay }, json: { reference: 'FT-MR-TOO-LATE' } }));
      expect(r).toEqual({ status: 400, error: 'The registration window has closed for this payment; it can no longer take a transfer reference.' });
      // Leave nothing open for the invariants: the family cancels it.
      await apiResponse(f.parent.api.v1.payments[':id'].cancel.$post({ param: { id: pay } }));
    });

    it('money amounts with more than two decimals are refused', async () => {
      const r = await refused(f.parent.api.v1.escrow.withdraw.$post({ json: { studentId: f.studentId, amount: 10.005 } }));
      expect(r.status).toBe(400);
      expect(r.error).toContain('at most two decimals');
      await expect(apiResponse(f.parent.api.v1.escrow.withdraw.$post({ json: { studentId: f.studentId, amount: 10.005 } })))
        .rejects.toThrow(/^Amounts can have at most two decimals$/);
    });
  });

  // ─── Takings ───────────────────────────────────────────────────────────────

  describe('daily takings', () => {
    let f: Family;

    beforeAll(async () => {
      f = await family('tk');
    });

    it('a same-day reversal nets to zero; it is not subtracted twice (MA-04)', async () => {
      const before = await takings(officer);
      const desk = await deskCash(f, [subj.HIS!]);
      await apiResponse(finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: desk.payment!.id }, json: { reason: 'wrong family at the desk' } }));
      expect(takingsDelta(before, await takings(officer))).toMatchObject({
        moneyIn: 1500, byInstrument: { cash: 1500 }, reversedTotal: 1500, cashRefunded: 0, moneyOut: 1500, net: 0,
        drawer: { cashIn: 1500, cashOut: 1500, net: 0 },
      });
    });

    it('an InstaPay transfer is money in but never cash in the drawer (MA-04)', async () => {
      const before = await takings(officer);
      const reg = await direct(f, subj.ECO!);
      const pay = (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [reg], paymentMethod: 'instapay', escrowAmountToApply: 0 } }))).id!;
      await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: pay }, json: { reference: 'FT-MR-TK-1' } }));
      await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay }, json: {} }));
      expect(takingsDelta(before, await takings(officer))).toMatchObject({
        moneyIn: 1500, byInstrument: { instapay: 1500 }, net: 1500, drawer: { cashIn: 0, cashOut: 0, net: 0 },
      });
    });

    it('reversing yesterday\'s payment leaves yesterday\'s printed report as it was and counts today (MA-05)', async () => {
      const desk = await deskCash(f, [subj.ART!]);
      const pay = desk.payment!.id;
      await sql(`update payment set confirmed_at = confirmed_at - interval '1 day' where id = $1`, [pay]);
      const yesterdayBefore = await takingsOn(officer, localYesterday());
      const todayBefore = await takings(officer);

      await apiResponse(finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: pay }, json: { reason: 'confirmed against the wrong family' } }));

      expect(await takingsOn(officer, localYesterday())).toEqual(yesterdayBefore);
      expect(takingsDelta(todayBefore, await takings(officer))).toMatchObject({
        moneyIn: 0, reversedTotal: 1500, moneyOut: 1500, net: -1500, drawer: { cashIn: 0, cashOut: 1500, net: -1500 },
      });
    });
  });

  // ─── Cash refunds (withdrawals) ────────────────────────────────────────────

  describe('cash refunds', () => {
    let f: Family;

    beforeAll(async () => {
      f = await family('wd');
      await fund(f, subj.PHY!);
      await fund(f, subj.CHE!);
      expect(await escrowOf(f.studentId)).toBe(3000);
    });

    it('two officers hand over part of the same refund at once: only one is recorded, never more than was asked (MA-08)', async () => {
      const w = await apiResponse(f.parent.api.v1.escrow.withdraw.$post({ json: { studentId: f.studentId, amount: 1000 } }));
      const results = await Promise.all([officer, officer2].map((o) =>
        o.api.v1.escrow.admin.withdrawals[':id'].fulfill.$post({ param: { id: w.id }, json: { releasedAmount: 600, notes: 'cash at desk' } })
      ));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const row = await one<{ released: string; status: string }>(`select released_amount as released, status from withdrawal_request where id = $1`, [w.id]);
      expect({ released: money(row.released), status: row.status }).toEqual({ released: 600, status: 'partially_fulfilled' });
      expect(await disbursedFor(w.id)).toBe(600);

      // The rest is declined: 400 goes back to escrow, and the 600 already handed over stays in today's takings.
      const before = await takings(officer);
      await apiResponse(officer.api.v1.escrow.admin.withdrawals[':id'].reject.$post({ param: { id: w.id }, json: { notes: 'parent asked for the rest as credit' } }));
      expect(await escrowOf(f.studentId)).toBe(2400);
      expect(takingsDelta(before, await takings(officer))).toMatchObject({ cashRefunded: 0, moneyOut: 0 });
      const today = await takings(officer);
      expect(today.cashRefunded).toBeGreaterThanOrEqual(600);
    });

    it('a partial hand-over and a rejection race: no money is created (MA-08)', async () => {
      // A partial hand-over leaves the request open, so a rejection that read
      // the request before the hand-over committed would still pass its status
      // guard and return the whole 500 on top of the 200 paid out.
      const w = await apiResponse(f.parent.api.v1.escrow.withdraw.$post({ json: { studentId: f.studentId, amount: 500 } }));
      expect(await escrowOf(f.studentId)).toBe(1900);
      const [ful, rej] = await Promise.all([
        officer.api.v1.escrow.admin.withdrawals[':id'].fulfill.$post({ param: { id: w.id }, json: { releasedAmount: 200 } }),
        officer2.api.v1.escrow.admin.withdrawals[':id'].reject.$post({ param: { id: w.id }, json: { notes: 'declined at the desk' } }),
      ]);
      expect(rej!.ok).toBe(true);
      // Either order is legitimate (hand-over then reject the rest, or reject
      // first and the hand-over is refused), but escrow plus cash handed over
      // must equal what the family had before the request.
      expect(money((await escrowOf(f.studentId)) + (await disbursedFor(w.id)))).toBe(2400);
      expect(await disbursedFor(w.id)).toBe(ful!.ok ? 200 : 0);
    });

    it('a refund paid in two parts on two days: each day keeps its own part (MA-09)', async () => {
      const w = await apiResponse(f.parent.api.v1.escrow.withdraw.$post({ json: { studentId: f.studentId, amount: 1000 } }));
      await apiResponse(officer.api.v1.escrow.admin.withdrawals[':id'].fulfill.$post({ param: { id: w.id }, json: { releasedAmount: 400 } }));
      await sql(`update withdrawal_disbursement set disbursed_at = disbursed_at - interval '1 day' where withdrawal_request_id = $1`, [w.id]);
      const yesterdayBefore = await takingsOn(officer, localYesterday());
      const todayBefore = await takings(officer);

      await apiResponse(officer.api.v1.escrow.admin.withdrawals[':id'].fulfill.$post({ param: { id: w.id }, json: { releasedAmount: 600 } }));

      expect(await takingsOn(officer, localYesterday())).toEqual(yesterdayBefore);
      expect(takingsDelta(todayBefore, await takings(officer))).toMatchObject({
        cashRefunded: 600, moneyOut: 600, drawer: { cashOut: 600 },
      });
      expect(await one(`select status from withdrawal_request where id = $1`, [w.id])).toEqual({ status: 'fulfilled' });
    });

    it('every hand-over needs the second signature, including one made after an earlier approval (MA-17)', async () => {
      const queue = async () => (await apiResponse(finadmin.api.v1.escrow.admin.withdrawals.$get())).map((x) => x.id);
      const approvedBy = async (id: string) =>
        (await one<{ approved_by: string | null }>(`select approved_by from withdrawal_request where id = $1`, [id])).approved_by;

      const w = await apiResponse(f.parent.api.v1.escrow.withdraw.$post({ json: { studentId: f.studentId, amount: 500 } }));
      await apiResponse(officer.api.v1.escrow.admin.withdrawals[':id'].fulfill.$post({ param: { id: w.id }, json: { releasedAmount: 200 } }));
      await apiResponse(finadmin.api.v1.escrow.admin.withdrawals[':id'].approve.$post({ param: { id: w.id } }));
      expect(await approvedBy(w.id)).toBe(finadmin.id);

      // The rest is handed over later: the approval no longer covers it.
      await apiResponse(officer.api.v1.escrow.admin.withdrawals[':id'].fulfill.$post({ param: { id: w.id }, json: { releasedAmount: 300 } }));
      expect(await approvedBy(w.id)).toBeNull();
      expect(await queue()).toContain(w.id);
      await apiResponse(finadmin.api.v1.escrow.admin.withdrawals[':id'].approve.$post({ param: { id: w.id } }));
      expect(await approvedBy(w.id)).toBe(finadmin.id);
      expect(await queue()).not.toContain(w.id);

      // A request whose rest was declined after cash went out still waits for approval of that cash.
      const declined = await one<{ id: string }>(
        `select w.id from withdrawal_request w join escrow e on e.id = w.escrow_id
         where e.student_id = $1 and w.status = 'rejected' and w.released_amount > 0 limit 1`, [f.studentId]
      );
      expect(await queue()).toContain(declined.id);
      await apiResponse(finadmin.api.v1.escrow.admin.withdrawals[':id'].approve.$post({ param: { id: declined.id } }));
      expect(await queue()).not.toContain(declined.id);
    });
  });

  // ─── Pricing exceptions and swaps ──────────────────────────────────────────

  describe('pricing exceptions', () => {
    let f: Family;
    const reg = async (subjectId: string) =>
      one<{ price: string; course: string; fee: string }>(
        `select price_at_registration as price, course_fee_at_registration as course, registration_fee_at_registration as fee
           from registration where student_id = $1 and subject_id = $2 and status not in ('dropped', 'rejected', 'expired')`,
        [f.studentId, subjectId]
      ).then((r) => ({ price: money(r.price), course: money(r.course), fee: money(r.fee) }));

    beforeAll(async () => {
      f = await family('ex');
      const grant = (json: { type: 'discount_percent' | 'discount_fixed'; value: number; subjectId?: string }) =>
        apiResponse(finadmin.api.v1.exceptions.$post({ json: { ...json, studentId: f.studentId, reason: 'sibling and hardship discounts' } }));
      await grant({ type: 'discount_percent', value: 20 });
      await grant({ type: 'discount_percent', value: 10 });
      await grant({ type: 'discount_fixed', value: 100, subjectId: subj.MUS! });
    });

    it('stacks: percentages multiply, then the fixed amount comes off the course fee', async () => {
      await apiResponse(officer.api.v1.registrations.desk.$post({ json: { studentId: f.studentId, sessionId, subjectIds: [subj.MUS!, subj.FRE!] } }));
      // 1500 → ×0.8 → ×0.9 = 1080 (720 + 360); Music also loses 100 from its course fee.
      expect(await reg(subj.MUS!)).toEqual({ price: 980, course: 620, fee: 360 });
      expect(await reg(subj.FRE!)).toEqual({ price: 1080, course: 720, fee: 360 });
    });

    it('a fixed discount larger than the price makes it free, never negative', async () => {
      await apiResponse(finadmin.api.v1.exceptions.$post({
        json: { type: 'discount_fixed', value: 5000, subjectId: subj.GEO!, studentId: f.studentId, reason: 'full scholarship for this subject' },
      }));
      await apiResponse(officer.api.v1.registrations.desk.$post({ json: { studentId: f.studentId, sessionId, subjectIds: [subj.GEO!] } }));
      expect(await reg(subj.GEO!)).toEqual({ price: 0, course: 0, fee: 0 });
    });

    it('a subject swapped in is priced like a fresh registration: exceptions apply, the fee split is kept (MA-10)', async () => {
      const desk = await deskCash(f, [subj.GER!, subj.HIS!]);
      const ger = desk.registrations.find((r) => r.subjectId === subj.GER)!.id;
      const his = desk.registrations.find((r) => r.subjectId === subj.HIS)!.id;

      // Parent swaps German for Economics directly.
      await apiResponse(f.parent.api.v1.registrations[':id'].swap.$post({ param: { id: ger }, json: { newSubjectId: subj.ECO!, reason: 'timetable clash' } }));
      expect(await reg(subj.ECO!)).toEqual({ price: 1080, course: 720, fee: 360 });

      // Student asks to swap History for Art; the parent approves.
      const cr = await apiResponse(f.student.api.v1.registrations[':id']['request-swap'].$post({
        param: { id: his }, json: { newSubjectId: subj.ART!, reason: 'prefers art coursework' },
      }));
      expect(money(cr.priceDifference)).toBe(0);
      await apiResponse(f.parent.api.v1['change-requests'][':id'].approve.$put({ param: { id: cr.id }, json: {} }));
      expect(await reg(subj.ART!)).toEqual({ price: 1080, course: 720, fee: 360 });
    });
  });

  // ─── Refund windows ────────────────────────────────────────────────────────

  describe('refund windows', () => {
    let f: Family, regs: Record<string, string>;
    const hour = 60 * 60 * 1000;
    const at = (offset: number) => new Date(Date.now() + offset);
    const dropCredit = async (regId: string) => {
      const r = await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: regId }, json: { reason: 'refund window check' } }));
      const rows = await sql<{ amount: string }>(`select amount from escrow_transaction where related_registration_id = $1 and reason = 'drop'`, [regId]);
      return { pct: r.refundPercentage, credited: rows.map((x) => money(x.amount)) };
    };

    beforeAll(async () => {
      f = await family('rw');
      const desk = await deskCash(f, [subj.PHY!, subj.CHE!, subj.BIO!, subj.GEO!]);
      regs = Object.fromEntries(desk.registrations.map((r) => [r.subjectId, r.id]));
    });

    // Windows scope the whole session, so none may outlive this block, pass or fail.
    afterAll(async () => {
      const left = (await apiResponse(finadmin.api.v1.receipts['refund-windows'].$get())).filter((w) => w.sessionId === sessionId);
      for (const w of left) await apiResponse(finadmin.api.v1.receipts['refund-windows'][':id'].$delete({ param: { id: w.id } }));
    });

    it('drops refund the window\'s percentage, an exception overrides it, and a gap refunds nothing', async () => {
      const now50 = await apiResponse(finadmin.api.v1.receipts['refund-windows'].$post({
        json: { sessionId, startsAt: at(-hour), endsAt: at(hour), percentage: 50, label: 'first week' },
      }));
      const later20 = await apiResponse(finadmin.api.v1.receipts['refund-windows'].$post({
        json: { sessionId, startsAt: at(2 * hour), endsAt: at(3 * hour), percentage: 20, label: 'second week' },
      }));
      expect(await dropCredit(regs[subj.PHY!]!)).toEqual({ pct: 50, credited: [750] });

      const ex = await apiResponse(finadmin.api.v1.exceptions.$post({
        json: { type: 'custom_refund_percent', value: 90, studentId: f.studentId, sessionId, reason: 'medical withdrawal' },
      }));
      expect(await dropCredit(regs[subj.CHE!]!)).toEqual({ pct: 90, credited: [1350] });
      await apiResponse(finadmin.api.v1.exceptions[':id'].revoke.$post({ param: { id: ex.id } }));

      // Only the later window remains: today falls in a gap, which refunds 0%.
      await apiResponse(finadmin.api.v1.receipts['refund-windows'][':id'].$delete({ param: { id: now50!.id } }));
      expect(await dropCredit(regs[subj.BIO!]!)).toEqual({ pct: 0, credited: [] });

      await apiResponse(finadmin.api.v1.receipts['refund-windows'][':id'].$delete({ param: { id: later20!.id } }));
      expect(await dropCredit(regs[subj.GEO!]!)).toEqual({ pct: 100, credited: [1500] });
    });

    it('refuses a window that overlaps another in the same scope, so a date has one percentage (MA-11)', async () => {
      const a = await apiResponse(finadmin.api.v1.receipts['refund-windows'].$post({
        json: { sessionId, startsAt: at(10 * hour), endsAt: at(20 * hour), percentage: 50 },
      }));
      const clash = await refused(finadmin.api.v1.receipts['refund-windows'].$post({
        json: { sessionId, startsAt: at(15 * hour), endsAt: at(30 * hour), percentage: 80 },
      }));
      expect(clash.status).toBe(409);
      expect(clash.error).toContain('overlaps');
      // Touching end to start is not an overlap.
      const next = await apiResponse(finadmin.api.v1.receipts['refund-windows'].$post({
        json: { sessionId, startsAt: at(20 * hour + 1), endsAt: at(30 * hour), percentage: 25 },
      }));
      await apiResponse(finadmin.api.v1.receipts['refund-windows'][':id'].$delete({ param: { id: a!.id } }));
      await apiResponse(finadmin.api.v1.receipts['refund-windows'][':id'].$delete({ param: { id: next!.id } }));
    });
  });

  // ─── Reversal ──────────────────────────────────────────────────────────────

  describe('reversing a confirmation', () => {
    it('is refused once a subject on it was dropped and refunded, so the refund is not paid twice (MA-14)', async () => {
      const f = await family('rv');
      const desk = await deskCash(f, [subj.PHY!]);
      await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: desk.registrations[0]!.id }, json: { reason: 'changed their mind' } }));
      expect(await escrowOf(f.studentId)).toBe(1500);

      const r = await refused(finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: desk.payment!.id }, json: { reason: 'wrong family' } }));
      expect(r).toEqual({ status: 409, error: 'A subject on this payment has already been dropped or changed — undo that first, or settle the difference as a refund' });
      expect(await statusOf('payment', desk.payment!.id)).toBe('completed');
      expect(await escrowOf(f.studentId)).toBe(1500);
    });

    it('a drop and a reversal of the same payment at once: one wins cleanly, never a deadlock (MA-16)', async () => {
      // A deadlock also leaves one winner, so the loser must be refused with
      // one of the sentences a clean refusal gives, not a failed query.
      const cleanRefusals = [
        'A subject on this payment has already been dropped or changed — undo that first, or settle the difference as a refund',
        'Only confirmed registrations can be changed. Current status: pending_payment',
        'Registration already processed.',
      ];
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const f = await family('rv2');
      for (const [i, code] of (['CHE', 'BIO', 'GEO', 'HIS', 'ECO', 'ART', 'MUS', 'FRE', 'GER'] as const).entries()) {
        const desk = await deskCash(f, [subj[code]!]);
        const reg = desk.registrations[0]!.id;
        const [rev, drop] = await Promise.all([
          delay(i * 2).then(() => finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: desk.payment!.id }, json: { reason: 'race check' } })),
          f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: reg }, json: { reason: 'race check' } }),
        ]);
        expect([rev!.ok, drop!.ok].filter(Boolean)).toHaveLength(1);
        const loser = await refused(Promise.resolve(rev!.ok ? drop! : rev!));
        expect(cleanRefusals, `${code}: ${loser.status} ${loser.error}`).toContain(loser.error);
        const credited = (await sql(`select 1 from escrow_transaction where related_registration_id = $1 and reason = 'drop'`, [reg])).length;
        expect([await statusOf('payment', desk.payment!.id), await statusOf('registration', reg), credited]).toEqual(
          rev!.ok ? ['refunded', 'pending_payment', 0] : ['completed', 'dropped', 1]
        );
        // Leave nothing half-done for the invariants.
        if (rev!.ok) await apiResponse(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, registrationIds: [reg], instrumentUsed: 'cash' } }));
      }
    });
  });

  // ─── Receipts ──────────────────────────────────────────────────────────────

  describe('the paper receipt and a drop at the same moment', () => {
    it('a drop racing the hand-over of its receipt never refunds at once for paper the family holds (MA-16)', async () => {
      // The drop does several reads before its transaction, so a hand-over
      // fired at the same instant usually lands first. Firing it after a
      // growing delay sweeps the hand-over across the drop's transaction.
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const regs: { id: string; parent: Client }[] = [];
      for (const tag of ['rc1', 'rc2']) {
        const f = await family(tag);
        const desk = await deskCash(f, Object.values(subj));
        regs.push(...desk.registrations.map((r) => ({ id: r.id, parent: f.parent })));
      }
      for (const [i, reg] of regs.entries()) {
        const rc = await one<{ id: string }>(`select id from receipt where registration_id = $1`, [reg.id]);
        const [drop, issue] = await Promise.all([
          reg.parent.api.v1.registrations[':id'].drop.$post({ param: { id: reg.id }, json: { reason: 'race check' } }),
          delay(i * 2).then(() => officer.api.v1.receipts[':id'].issue.$post({ param: { id: rc.id } })),
        ]);
        expect(drop!.ok).toBe(true);
        const receiptStatus = (await one<{ status: string }>(`select status from receipt where id = $1`, [rc.id])).status;
        const credited = (await sql(`select 1 from escrow_transaction where related_registration_id = $1 and reason = 'drop'`, [reg.id])).length;
        // Hand-over first: the drop parks until the paper comes back. Drop first: the hand-over is refused.
        expect({ issued: issue!.ok, receiptStatus, credited, reg: await statusOf('registration', reg.id) }).toEqual(
          issue!.ok
            ? { issued: true, receiptStatus: 'return_required', credited: 0, reg: 'dropped_pending_receipt' }
            : { issued: false, receiptStatus: 'void', credited: 1, reg: 'dropped' }
        );
      }
    });
  });

  // ─── Closing the window with money in flight ───────────────────────────────

  describe('the registration window closes with money in flight', () => {
    let f: Family, okReg: string, badReg: string, deskReg: string, okPay: string, badPay: string, deskPay: string;

    beforeAll(async () => {
      f = await family('close');
      await fund(f, subj.MUS!);
      okReg = await direct(f, subj.PHY!);
      badReg = await direct(f, subj.CHE!);
      deskReg = await direct(f, subj.BIO!);
      const init = async (id: string, method: 'instapay' | 'in_school', escrow: number) =>
        (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [id], paymentMethod: method, escrowAmountToApply: escrow } }))).id!;
      okPay = await init(okReg, 'instapay', 200);
      badPay = await init(badReg, 'instapay', 100);
      deskPay = await init(deskReg, 'in_school', 150);
      await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: okPay }, json: { reference: 'FT-MR-LASTDAY-1' } }));
      await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: badPay }, json: { reference: 'FT-MR-LASTDAY-2' } }));
      expect(await escrowOf(f.studentId)).toBe(1050);

      await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: sessionId }, json: { reason: 'money rules: window closes' } }));
    });

    it('an unpaid desk checkout fails at close and its escrow comes back', async () => {
      expect(await statusOf('payment', deskPay)).toBe('failed');
      expect(await statusOf('registration', deskReg)).toBe('expired');
      expect(await escrowOf(f.studentId)).toBe(1200);
    });

    it('a transfer the family already sent survives the close, waiting for finance (MA-01)', async () => {
      expect(await statusOf('payment', okPay)).toBe('pending_verification');
      expect(await statusOf('registration', okReg)).toBe('pending_payment');
      const queue = await apiResponse(officer.api.v1.payments['pending-manual'].$get());
      expect(queue.map((p) => p.id)).toEqual(expect.arrayContaining([okPay, badPay]));
    });

    it('finance confirms it after the close: the subject is confirmed and its receipt is born (MA-01)', async () => {
      await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: okPay }, json: { notes: 'on the statement, sent on the last day' } }));
      expect(await statusOf('payment', okPay)).toBe('completed');
      expect(await statusOf('registration', okReg)).toBe('confirmed');
      expect(await one(`select status from receipt where registration_id = $1`, [okReg])).toEqual({ status: 'pending_issue' });
      expect(await escrowOf(f.studentId)).toBe(1200);
    });

    it('finance rejects the other after the close: escrow back, the subject expires with the window (MA-01, MA-03)', async () => {
      const r = await apiResponse(officer.api.v1.payments[':id'].reject.$post({ param: { id: badPay }, json: { reason: 'Reference not found on the statement' } }));
      expect(r).toMatchObject({ status: 'failed', registrationsExpired: 1 });
      expect(await statusOf('registration', badReg)).toBe('expired');
      expect(await escrowOf(f.studentId)).toBe(1300);
    });

    it('a subject that expired with the window cannot be paid again', async () => {
      const r = await refused(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [badReg], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
      expect(r.status).toBe(400);
    });

    it('a student with a deadline extension can still be registered and paid for, at the desk and in the app (MA-13)', async () => {
      const other = await family('close-other');
      const refusedDesk = await refused(officer.api.v1.registrations.desk.$post({
        json: { studentId: other.studentId, sessionId, subjectIds: [subj.GEO!], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
      }));
      expect(refusedDesk).toEqual({
        status: 422,
        error: 'Registration window is not open — a finance admin can grant this student a deadline extension',
      });

      await apiResponse(finadmin.api.v1.exceptions.$post({
        json: { type: 'deadline_extension', studentId: f.studentId, sessionId, validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), reason: 'late family, approved by the head' },
      }));

      // Desk: registered and paid in one action, as before the close.
      const desk = await deskCash(f, [subj.GEO!]);
      expect(desk.registrations.map((r) => r.status)).toEqual(['pending_payment']);
      expect(await statusOf('registration', desk.registrations[0]!.id)).toBe('confirmed');
      expect(await statusOf('payment', desk.payment!.id)).toBe('completed');

      // App: the parent registers and checks out; finance confirms at the desk.
      const ger = await direct(f, subj.GER!);
      const pay = (await apiResponse(f.parent.api.v1.payments.initiate.$post({
        json: { registrationIds: [ger], paymentMethod: 'in_school', escrowAmountToApply: 0 },
      }))).id!;
      await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay }, json: { instrumentUsed: 'cash' } }));
      expect(await statusOf('registration', ger)).toBe('confirmed');
    });
  });

  // ─── Preregistration paid late ─────────────────────────────────────────────
  // Runs after the close above, which frees the january / as_level slot.

  describe('a preregistration paid after its session opened', () => {
    it('confirms the subject and leaves nothing stranded in the held wallet (MA-15)', async () => {
      const f = await family('pre');
      const draft = await session(adm, 'January (AS, money rules, prereg)', 'january', 'as_level', futureWindow());
      const reg = (await apiResponse(f.parent.api.v1.registrations.preregister.$post({
        json: { sessionId: draft, subjectIds: [subj.PHY!], studentId: f.studentId },
      })))[0]!.id;
      const pay = (await apiResponse(f.parent.api.v1.payments.initiate.$post({
        json: { registrationIds: [reg], paymentMethod: 'instapay', escrowAmountToApply: 0 },
      }))).id!;
      await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: pay }, json: { reference: 'FT-MR-PRE-1' } }));

      // The session opens before finance gets to the transfer: capture finds
      // no confirmed money and moves the subject to pending payment.
      await apiResponse(adm.api.v1.sessions[':id'].activate.$post({ param: { id: draft } }));
      await waitFor(async () => (await statusOf('registration', reg)) === 'pending_payment' || null);

      await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay }, json: {} }));
      expect(await statusOf('registration', reg)).toBe('confirmed');
      const wallet = await sql<{ balance: string; held: string }>(`select balance, held_balance as held from escrow where student_id = $1`, [f.studentId]);
      expect(wallet.map((w) => [money(w.balance), money(w.held)])).toEqual(wallet.length ? [[0, 0]] : []);
    });
  });
});
