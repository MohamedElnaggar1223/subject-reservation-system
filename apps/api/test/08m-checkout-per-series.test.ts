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
    [regA] = await direct(f1, [subj.A!]);
    const [regB] = await direct(f1, [subj.B!]);
    [regC] = await direct(f1, [subj.C!]);
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
    expect(r.payments!.map((p) => p.collected)).toEqual([1500, 1500]);
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
    expect(r.payments!.map((p) => p.collected)).toEqual([1500, 1500]);
    const pays = await paymentsOf(ids);
    expect(pays).toHaveLength(2);
    for (const p of pays) {
      expect(await statusOf('payment', p.payment_id)).toBe('completed');
      await audited([p.payment_id], ['PAYMENT_INITIATED']);
    }
    expect(takingsDelta(before, await takings(officer)).byInstrument.card).toBe(3000);
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
