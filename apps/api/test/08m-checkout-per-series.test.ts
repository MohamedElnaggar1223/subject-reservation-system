import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearStartOf, seriesYearInAcademicYear } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, refused, one, sql, audited, money, takings, takingsDelta,
  futureWindow, runPaymentDeadlines, type Client,
} from './helpers';

/**
 * F0b — money is taken per entry deadline (the review of 682907a, flags 3 and
 * 7; the lead's decision of 30 Sep).
 *
 * The deadline sweep closes a payment at its series' deadline, so a checkout
 * spanning two series with different deadlines would lose the later series'
 * subjects at the earlier deadline. A family's own checkout is refused and
 * names each series to pay separately; the desk splits one action into one
 * payment per deadline, each confirmed with its receipts; series with the
 * same deadline share a checkout. A deadline change that would split an open
 * checkout is refused. And MO-21 per series: in a draft window feeding
 * October and January, October's deadline refunds only October's
 * preregistrations, and a January one cancelled after it is judged by
 * January's own deadline.
 *
 * The open window takes a (type, level) pair no earlier file holds open, and
 * is closed at the end.
 */

const days = (n: number) => n * 24 * 60 * 60 * 1000;
const statusOf = async (table: 'payment' | 'registration', id: string) =>
  (await one<{ status: string }>(`select status from ${table} where id = $1`, [id])).status;
const paymentsOf = async (registrationIds: string[]) =>
  sql<{ payment_id: string }>(
    `select distinct payment_id from payment_registration where registration_id in (${registrationIds.map((_, i) => `$${i + 1}`).join(', ')}) order by payment_id`,
    registrationIds,
  );

describe('F0b: one checkout per entry deadline', () => {
  let adm: Client, officer: Client, finadmin: Client;
  const Y = academicYearStartOf();
  const subj: Record<string, string> = {};
  let windowId: string, x: string, z: string, later: string, windowEnd: Date;
  let type: 'october' | 'november' | 'january', level: 'as_level' | 'a_level', otherMonth: 'october' | 'january';

  type Family = { parent: Client; student: Client; studentId: string };
  const direct = async (f: Family, subjectIds: string[]) =>
    (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: windowId, subjectIds, studentId: f.studentId } }))).map((r) => r.id);
  const checkout = (f: Family, ids: string[]) =>
    f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: ids, paymentMethod: 'instapay', escrowAmountToApply: 0 } });
  const mkSeries = async (month: 'january' | 'october' | 'november', label: string) =>
    (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', month, year: seriesYearInAcademicYear(month, Y), label } }))).id;
  const setDeadline = (id: string, entryDeadline: Date) =>
    adm.api.v1['board-series'][':id'].$put({ param: { id }, json: { entryDeadline, reason: 'board key dates published' } });

  beforeAll(async () => {
    adm = await admin('ckd');
    officer = await staff(adm, 'finance_officer', 'ckd');
    finadmin = await staff(adm, 'finance_admin', 'ckd');
    const open = new Set((await sql<{ t: string; l: string }>(`select session_type as t, qualification_level as l from registration_session where status = 'active'`)).map((r) => `${r.t}|${r.l}`));
    const pair = (['october|as_level', 'october|a_level', 'november|as_level', 'november|a_level', 'january|as_level', 'january|a_level'] as const).find((p) => !open.has(p));
    expect(pair).toBeDefined();
    [type, level] = pair!.split('|') as [typeof type, typeof level];
    otherMonth = type === 'january' ? 'october' : 'january';
    for (const tag of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'PO', 'PJ']) {
      subj[tag] = await subject(adm, `CKD-${tag}`, `Deadlines ${tag}`, { course: 1000, registration: 500 }, { qualificationLevel: level, council: 'pearson_edexcel' });
    }
    const now = Date.now();
    windowId = await session(adm, `Open window (deadlines)`, type, level, {
      startDate: new Date(now - days(1)).toISOString(), endDate: new Date(now + days(2)).toISOString(), seriesYear: seriesYearInAcademicYear(type, Y),
    });
    windowEnd = new Date((await one<{ end: string }>(`select end_date as "end" from registration_session where id = $1`, [windowId])).end);
    x = await mkSeries(type, 'deadlines X');
    z = await mkSeries(type, 'deadlines Z');
    later = await mkSeries(otherMonth, 'deadlines later');
    // B, E and G go to the later series; C to Z, whose deadline is X's.
    await apiResponse(adm.api.v1.sessions[':id']['board-series'].$put({
      param: { id: windowId },
      json: {
        series: [{ boardSeriesId: x, isDefault: true }, { boardSeriesId: z, isDefault: false }, { boardSeriesId: later, isDefault: false }],
        routes: [{ subjectId: subj.B!, boardSeriesId: later }, { subjectId: subj.E!, boardSeriesId: later }, { subjectId: subj.G!, boardSeriesId: later }, { subjectId: subj.C!, boardSeriesId: z }],
      },
    }));
    await apiResponse(setDeadline(x, new Date(windowEnd.getTime() + days(5))));
    await apiResponse(setDeadline(z, new Date(windowEnd.getTime() + days(5))));
    await apiResponse(setDeadline(later, new Date(windowEnd.getTime() + days(10))));
  });

  afterAll(async () => {
    await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: windowId }, json: { reason: 'deadlines suite done: free the pair' } }));
  });

  let f1: Family, combined: string, regA: string, regC: string;

  it("a family's checkout spanning two deadlines is refused, naming each series to pay separately; the summary groups them", async () => {
    f1 = await onboard(officer, 'ckd-1', 12);
    regA = (await direct(f1, [subj.A!]))[0]!;
    const regB = (await direct(f1, [subj.B!]))[0]!;
    regC = (await direct(f1, [subj.C!]))[0]!;
    const r = await refused(checkout(f1, [regA!, regB!]));
    expect(r.status).toBe(422);
    expect(r.error).toMatch(/^These subjects are entered in exam board series with different entry deadlines, so each series is paid for on its own: Pearson Edexcel \w+ \d{4} \(deadlines X\) \(entry deadline .+\): Deadlines A; Pearson Edexcel \w+ \d{4} \(deadlines later\) \(entry deadline .+\): Deadlines B$/);
    expect(await paymentsOf([regA!, regB!])).toEqual([]);
    const summary = await apiResponse(f1.parent.api.v1.payments['checkout-summary'].$get({ query: { registrationIds: [regA, regB, regC].join(',') } }));
    expect(summary!.deadlineGroups.map((g) => [g.registrationIds.slice().sort(), g.total])).toEqual([
      [[regA!, regC!].sort(), 3000], [[regB!], 1500],
    ]);
  });

  it('series with the same deadline share a checkout', async () => {
    combined = (await apiResponse(checkout(f1, [regA, regC]))).id!;
    expect((await paymentsOf([regA, regC])).map((p) => p.payment_id)).toEqual([combined]);
    expect(money((await one<{ amount: string }>(`select amount from payment where id = $1`, [combined])).amount)).toBe(3000);
  });

  it('a deadline change that would split an open checkout is refused until it is settled', async () => {
    const moved = await refused(setDeadline(z, new Date(windowEnd.getTime() + days(7))));
    expect(moved).toEqual({
      status: 409,
      error: '1 checkout still open pays for this series together with another whose entry deadline would then differ — confirm or cancel it first, or give the other series the same deadline',
    });
    await apiResponse(f1.parent.api.v1.payments[':id'].cancel.$post({ param: { id: combined } }));
    await apiResponse(setDeadline(z, new Date(windowEnd.getTime() + days(7))));
    await apiResponse(setDeadline(z, new Date(windowEnd.getTime() + days(5))));
  });

  it('the desk registers subjects of two deadlines and takes the money in one action: one confirmed payment per deadline, with receipts and takings', async () => {
    const f2 = await onboard(officer, 'ckd-2', 12);
    const before = await takings(officer);
    const r = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f2.studentId, sessionId: windowId, subjectIds: [subj.D!, subj.E!], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    expect(r.collected).toBe(3000);
    expect(r.notCollected).toEqual([]);
    expect(r.payments.map((p) => p.collected)).toEqual([1500, 1500]);
    const ids = r.registrations.map((x) => x.id);
    const pays = await paymentsOf(ids);
    expect(pays).toHaveLength(2);
    for (const p of pays) expect(await statusOf('payment', p.payment_id)).toBe('completed');
    for (const id of ids) expect(await statusOf('registration', id)).toBe('confirmed');
    // Each payment covers one series: what it covers is what it took.
    for (const p of pays) {
      const covered = await one<{ n: string; price: string; amount: string }>(`
        select count(distinct r.board_series_id) as n, sum(r.price_at_registration) as price, min(pay.amount) as amount
        from payment pay join payment_registration pr on pr.payment_id = pay.id join registration r on r.id = pr.registration_id
        where pay.id = $1`, [p.payment_id]);
      expect([Number(covered.n), money(covered.price), money(covered.amount)]).toEqual([1, 1500, 1500]);
    }
    expect(r.receipts).toHaveLength(2);
    const delta = takingsDelta(before, await takings(officer));
    expect(delta.moneyIn).toBe(3000);
    expect(delta.byInstrument.cash).toBe(3000);
    // One creation row per payment: the desk's row names the first, the second has its own.
    await audited([f2.studentId], ['DESK_REGISTRATION']);
    await audited([pays.find((p) => p.payment_id !== r.payment!.id)!.payment_id], ['PAYMENT_INITIATED']);
  });

  it('the desk collects waiting subjects of two deadlines: one confirmed payment per deadline', async () => {
    const f3 = await onboard(officer, 'ckd-3', 12);
    const ids = await direct(f3, [subj.F!, subj.G!]);
    const before = await takings(officer);
    const r = await apiResponse(officer.api.v1.registrations.desk.collect.$post({
      json: { studentId: f3.studentId, registrationIds: ids, instrumentUsed: 'card', escrowAmountToApply: 0 },
    }));
    expect(r.collected).toBe(3000);
    expect(r.payments.map((p) => p.collected)).toEqual([1500, 1500]);
    const pays = await paymentsOf(ids);
    expect(pays).toHaveLength(2);
    for (const p of pays) {
      expect(await statusOf('payment', p.payment_id)).toBe('completed');
      await audited([p.payment_id], ['PAYMENT_INITIATED']);
    }
    expect(takingsDelta(before, await takings(officer)).byInstrument.card).toBe(3000);
  });

  it('escrow shared across the desk\'s split payments goes to the earliest deadline first; the ledger has a debit per payment', async () => {
    const f5 = await onboard(officer, 'ckd-5', 12);
    // 3000 in the wallet: two subjects paid at the desk, then dropped (no refund window: all back).
    const funded = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f5.studentId, sessionId: windowId, subjectIds: [subj.PO!, subj.PJ!], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }));
    for (const reg of funded.registrations) {
      await apiResponse(f5.parent.api.v1.registrations[':id'].drop.$post({ param: { id: reg.id }, json: { reason: 'fund the wallet for the split' } }));
    }
    const balance = async () => money((await one<{ balance: string }>(`select balance from escrow where student_id = $1`, [f5.studentId])).balance);
    expect(await balance()).toBe(3000);
    const before = await takings(officer);
    // A (earlier deadline) and B (later): 2000 from the wallet covers A in full and 500 of B.
    const r = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f5.studentId, sessionId: windowId, subjectIds: [subj.A!, subj.B!], collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 2000 } },
    }));
    expect(r.collected).toBe(1000);
    const byFirst = r.payments.map((p) => [p.escrowApplied, p.collected]);
    expect(byFirst).toEqual([[1500, 0], [500, 1000]]);
    for (const p of r.payments) {
      const row = await one<{ amount: string; escrow: string; status: string }>(`select amount, escrow_amount_applied as escrow, status from payment where id = $1`, [p.id]);
      expect([money(row.amount), money(row.escrow), row.status]).toEqual([p.collected, p.escrowApplied, 'completed']);
      const ledger = await sql<{ type: string; reason: string; amount: string }>(`select type, reason, amount from escrow_transaction where related_payment_id = $1 order by created_at`, [p.id]);
      expect(ledger.map((d) => [d.type, d.reason, money(d.amount)])).toEqual([['debit', 'payment', p.escrowApplied]]);
    }
    expect(await balance()).toBe(1000);
    const delta = takingsDelta(before, await takings(officer));
    expect([delta.moneyIn, delta.escrowApplied, delta.byInstrument.cash]).toEqual([1000, 2000, 1000]);
  });

  it('one payment confirmed while the other was closed first: the desk says which it took and which to hand back', async () => {
    const f6 = await onboard(officer, 'ckd-6', 12);
    const [regEarly, regLate] = await direct(f6, [subj.C!, subj.E!]);
    // The close reaching the later series' payment first, as the scheduler's
    // close would (payment failed, its audit row written): a test trigger fires
    // when that payment is linked to its subject, inside the desk's own
    // transaction (the one reach past the API here).
    await sql(`
      create or replace function f0b_test_close_first() returns trigger language plpgsql as $$
      begin
        update payment set status = 'failed', updated_at = now() where id = new.payment_id;
        insert into audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data, created_at)
        values (gen_random_uuid()::text, null, 'PAYMENT_FAILED', 'payment', new.payment_id, '{"status":"pending"}', '{"status":"failed","reason":"Registration window closed before payment"}', now());
        return new;
      end $$`);
    await sql(`create trigger f0b_test_close_first after insert on payment_registration for each row when (new.registration_id = '${regLate}') execute function f0b_test_close_first()`);
    const before = await takings(officer);
    let r;
    try {
      r = await apiResponse(officer.api.v1.registrations.desk.collect.$post({
        json: { studentId: f6.studentId, registrationIds: [regEarly!, regLate!], instrumentUsed: 'cash', escrowAmountToApply: 0 },
      }));
    } finally {
      await sql(`drop trigger f0b_test_close_first on payment_registration`);
      await sql(`drop function f0b_test_close_first()`);
    }
    expect(r.collected).toBe(1500);
    expect(r.payments.map((p) => p.registrationIds)).toEqual([[regEarly]]);
    expect(r.notCollected).toEqual([{
      paymentId: expect.any(String), series: [expect.stringMatching(/^Pearson Edexcel \w+ \d{4} \(deadlines later\)$/)], amount: 1500,
      reason: 'It was closed before it could be confirmed — nothing was collected for it',
    }]);
    expect([await statusOf('registration', regEarly!), await statusOf('registration', regLate!)]).toEqual(['confirmed', 'pending_payment']);
    expect([await statusOf('payment', r.payments[0]!.id), await statusOf('payment', r.notCollected[0]!.paymentId)]).toEqual(['completed', 'failed']);
    // Only what was confirmed is in the takings; no escrow moved for either.
    expect(takingsDelta(before, await takings(officer)).moneyIn).toBe(1500);
    expect(await sql(`select id from escrow_transaction where related_payment_id in ($1, $2)`, [r.payments[0]!.id, r.notCollected[0]!.paymentId])).toEqual([]);
  });

  it("the admin's move may not split an open checkout across deadlines", async () => {
    const f4 = await onboard(officer, 'ckd-4', 12);
    const [a, c] = await direct(f4, [subj.A!, subj.C!]);
    const pay = (await apiResponse(checkout(f4, [a!, c!]))).id!;
    const moved = await refused(adm.api.v1.sessions[':id']['board-series'].move.$post({
      param: { id: windowId }, json: { registrationIds: [c!], boardSeriesId: later, reason: 'C is sat in the later series' },
    }));
    expect(moved).toEqual({
      status: 409,
      error: '1 checkout still open pays for these registrations together with others whose entry deadline would then differ — confirm or cancel it first, or move them together',
    });
    expect((await one<{ s: string }>(`select board_series_id as s from registration where id = $1`, [c!])).s).toBe(z);
    // Moving both together keeps one deadline.
    await apiResponse(adm.api.v1.sessions[':id']['board-series'].move.$post({
      param: { id: windowId }, json: { registrationIds: [a!, c!], boardSeriesId: later, reason: 'both are sat in the later series' },
    }));
    expect(await statusOf('payment', pay)).toBe('pending');
  });
});

describe("F0b: a window's first series may not split an open checkout across deadlines", () => {
  it('refused, nothing entered, until the checkout is settled', async () => {
    const adm = await admin('ckw');
    const officer = await staff(adm, 'finance_officer', 'ckw');
    const Y = academicYearStartOf();
    const one1 = await subject(adm, 'CKW-1', 'Window guard 1', { course: 1000, registration: 500 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    const two = await subject(adm, 'CKW-2', 'Window guard 2', { course: 1000, registration: 500 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    const w = await session(adm, 'October (AS, window guard)', 'october', 'as_level', { ...futureWindow(), seriesYear: seriesYearInAcademicYear('october', Y) });
    const end = new Date((await one<{ end: string }>(`select end_date as "end" from registration_session where id = $1`, [w])).end);
    const f = await onboard(officer, 'ckw-1', 12);
    // The window feeds no series yet: both preregistrations carry none, and share one checkout.
    const ids = (await apiResponse(f.parent.api.v1.registrations.preregister.$post({ json: { sessionId: w, subjectIds: [one1, two], studentId: f.studentId } }))).map((r) => r.id);
    const pay = (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: ids, paymentMethod: 'instapay', escrowAmountToApply: 0 } }))).id!;
    const mk = async (month: 'october' | 'january', days: number) => {
      const id = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', month, year: seriesYearInAcademicYear(month, Y), label: 'window guard' } }))).id;
      await apiResponse(adm.api.v1['board-series'][':id'].$put({ param: { id }, json: { entryDeadline: new Date(end.getTime() + days * 24 * 60 * 60 * 1000), reason: 'board key dates published' } }));
      return id;
    };
    const oct = await mk('october', 5);
    const jan = await mk('january', 10);
    const feed = () => adm.api.v1.sessions[':id']['board-series'].$put({
      param: { id: w }, json: { series: [{ boardSeriesId: oct, isDefault: true }, { boardSeriesId: jan, isDefault: false }], routes: [{ subjectId: two, boardSeriesId: jan }] },
    });
    expect(await refused(feed())).toEqual({
      status: 409,
      error: "1 checkout still open pays for this window's registrations, which these series would enter with different deadlines — confirm or cancel it first, or route the subjects to series with the same deadline",
    });
    expect(await sql(`select board_series_id from registration where id in ($1, $2)`, ids)).toEqual([{ board_series_id: null }, { board_series_id: null }]);
    expect(await sql(`select id from session_board_series where session_id = $1`, [w])).toEqual([]);
    // Settled, the same change goes through.
    await apiResponse(f.parent.api.v1.payments[':id'].cancel.$post({ param: { id: pay } }));
    await apiResponse(feed());
    expect((await sql<{ s: string }>(`select board_series_id as s from registration where id in ($1, $2) order by board_series_id`, ids)).map((x) => x.s).sort()).toEqual([oct, jan].sort());
  });
});

describe('F0b: MO-21 per series — a draft window feeding October and January', () => {
  let adm: Client, officer: Client, finadmin: Client;
  const Y = academicYearStartOf();

  it("October's deadline refunds only October's preregistrations; a January one cancelled after it gets the refund window's rate", async () => {
    adm = await admin('ckp');
    officer = await staff(adm, 'finance_officer', 'ckp');
    finadmin = await staff(adm, 'finance_admin', 'ckp');
    const po = await subject(adm, 'CKP-PO', 'Prereg October', { course: 1000, registration: 500 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    const pj = await subject(adm, 'CKP-PJ', 'Prereg January', { course: 1000, registration: 500 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    const w = await session(adm, 'October (AS, prereg per series)', 'october', 'as_level', { ...futureWindow(), seriesYear: seriesYearInAcademicYear('october', Y) });
    const mk = async (month: 'october' | 'january') =>
      (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', month, year: seriesYearInAcademicYear(month, Y), label: 'prereg per series' } }))).id;
    const oct = await mk('october');
    const jan = await mk('january');
    await apiResponse(adm.api.v1.sessions[':id']['board-series'].$put({
      param: { id: w }, json: { series: [{ boardSeriesId: oct, isDefault: true }, { boardSeriesId: jan, isDefault: false }], routes: [{ subjectId: pj, boardSeriesId: jan }] },
    }));
    const f = await onboard(officer, 'ckp-1', 12);
    const prereg = async (subjectId: string) =>
      (await apiResponse(f.parent.api.v1.registrations.preregister.$post({ json: { sessionId: w, subjectIds: [subjectId], studentId: f.studentId } })))[0]!.id;
    const pay = async (id: string) => {
      const p = (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [id], paymentMethod: 'in_school', escrowAmountToApply: 0 } }))).id!;
      await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: p }, json: { instrumentUsed: 'cash' } }));
    };
    const o = await prereg(po);
    const j = await prereg(pj);
    expect((await one<{ s: string }>(`select board_series_id as s from registration where id = $1`, [j])).s).toBe(jan);
    await pay(o);
    await pay(j);
    const hour = 60 * 60 * 1000;
    await apiResponse(finadmin.api.v1.receipts['refund-windows'].$post({
      json: { sessionId: w, startsAt: new Date(Date.now() - hour).toISOString(), endsAt: new Date(Date.now() + 24 * hour).toISOString(), percentage: 50, label: 'October window: half back' },
    }));
    const wallet = async () => {
      const x = await one<{ balance: string; held: string }>(`select balance, held_balance as held from escrow where student_id = $1`, [f.studentId]);
      return { free: money(x.balance), held: money(x.held) };
    };
    expect(await wallet()).toEqual({ free: 0, held: 3000 });

    // The window never opened; October's deadline passes, January's is days away.
    await sql(`update registration_session set start_date = now() - interval '3 days', end_date = now() - interval '2 days' where id = $1`, [w]);
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [oct]);
    await sql(`update board_series set entry_deadline = now() + interval '3 days' where id = $1`, [jan]);
    const swept = await runPaymentDeadlines();
    expect(swept.preregistrationsRefundedAtDeadline).toBe(1);
    expect(await statusOf('registration', o)).toBe('dropped');
    expect(await statusOf('registration', j)).toBe('preregistered');
    await audited([o], ['PREREG_REFUNDED_AT_DEADLINE']);
    expect(await wallet()).toEqual({ free: 1500, held: 1500 });

    // January's own deadline has not passed: cancelling is the family's own drop, at the window's rate.
    const cancelled = await apiResponse(f.parent.api.v1.registrations[':id']['cancel-prereg'].$post({ param: { id: j } }));
    expect(cancelled).toMatchObject({ funded: true, refundPercentage: 50 });
    expect(await wallet()).toEqual({ free: 2250, held: 0 });
  });
});
