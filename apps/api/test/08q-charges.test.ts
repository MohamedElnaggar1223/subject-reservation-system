import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearLabel, academicYearStartOf } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, refused, one, sql, money, takings, takingsDelta, openWindow,
  runPaymentDeadlines, seriesOfSession, audited, notificationsFor, type Client,
} from './helpers';

/**
 * 08q — charges (RESERVATIONS_REWORK.md §3.6, §3.9, §3.10; docs/features/RESERVATIONS_MONEY.md).
 *
 * Each scenario drives a charge, a board service, the pushed school fee, a drop's refund or the
 * desk's drop the way the desk, finance and the families do, then reads the ledger, the payments,
 * the receipts, the audit rows and the takings back. Instalment plans are 08q's second half.
 *
 * Course fee 1,000 and board fee 500 throughout (a line of 1,500), as the design's numbers.
 */

const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(Date.now() + d * DAY);
const day = (d: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(inDays(d));
const CI = 'svc-pearson-ci';
const LCI = 'svc-pearson-lci';
const CAM2 = 'svc-cambridge-2';

const wallet = async (studentId: string) => {
  const r = await sql<{ balance: string; held: string }>(`select balance, held_balance as held from escrow where student_id = $1`, [studentId]);
  return { free: money(r[0]?.balance ?? 0), held: money(r[0]?.held ?? 0) };
};
const statusOf = async (table: 'payment' | 'registration' | 'charge' | 'receipt' | 'exception', id: string) =>
  (await one<{ status: string }>(`select status from ${table} where id = $1`, [id])).status;

describe('08q: charges', () => {
  let adm: Client, officer: Client, finadmin: Client, coordinator: Client;
  let june: string, seriesP: string, seriesC: string;
  const subj: Record<string, string> = {};
  type Family = Awaited<ReturnType<typeof onboard>>;

  const deskPaid = async (f: Family, subjectIds: string[], sessionId = june) =>
    (await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f.studentId, sessionId, subjectIds, collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }))).registrations.map((r) => r.id);
  const deskUnpaid = async (f: Family, subjectIds: string[], sessionId = june) =>
    (await apiResponse(officer.api.v1.registrations.desk.$post({ json: { studentId: f.studentId, sessionId, subjectIds } }))).registrations.map((r) => r.id);
  const paymentOfCharge = async (chargeId: string, status = 'completed') =>
    (await one<{ id: string }>(`select p.id from payment p join payment_charge pc on pc.payment_id = p.id where pc.charge_id = $1 and p.status = $2`, [chargeId, status])).id;

  beforeAll(async () => {
    adm = await admin('cq');
    officer = await staff(adm, 'finance_officer', 'cq');
    finadmin = await staff(adm, 'finance_admin', 'cq');
    coordinator = await staff(adm, 'coordinator', 'cq');
    for (const code of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) {
      subj[code] = await subject(adm, `CQ-${code}`, `Subject ${code} (AS, charges)`, { course: 1000, registration: 500 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    }
    for (const code of ['K', 'L']) {
      subj[code] = await subject(adm, `CQ-${code}`, `Subject ${code} (AS, Cambridge, charges)`, { course: 1000, registration: 500 }, { qualificationLevel: 'as_level', council: 'cambridge' });
    }
    june = await session(adm, 'June (AS, charges)', 'june', 'as_level', { ...openWindow(), activate: true });
    seriesP = await seriesOfSession(june, 'pearson_edexcel');
    seriesC = await seriesOfSession(june, 'cambridge');
    // The fee lists of the series' services (the board's figures) and their deadlines.
    await apiResponse(finadmin.api.v1['board-services'].fees.$put({
      json: {
        boardSeriesId: seriesP,
        rows: [
          { boardServiceId: CI, level: 'as_a_level', amount: 700, provisional: false },
          { boardServiceId: LCI, level: 'as_a_level', amount: 1100, provisional: false },
        ],
      },
    }));
    await apiResponse(coordinator.api.v1['board-services'].deadlines.$put({
      json: { boardSeriesId: seriesP, rows: [{ boardServiceId: CI, deadline: inDays(30) }, { boardServiceId: LCI, deadline: inDays(45) }], reason: "the board's key dates" },
    }));
  });

  // ─── Board services ────────────────────────────────────────────────────────

  it('the boards\' services, as seeded: Cambridge 1, 1S, 2, 2S; Pearson\'s review, re-check, scripts, priority, cash-in and late cash-in; refunds in full until Q-21 is answered', async () => {
    const all = await apiResponse(officer.api.v1['board-services'].$get({ query: {} }));
    const codes = (board: string) => all.filter((s) => s.boardCode === board).map((s) => s.code);
    expect(codes('cambridge')).toEqual(['1', '1S', '2', '2S', 'certificate_split']);
    expect(codes('pearson_edexcel')).toEqual(['review_of_marking', 'clerical_recheck', 'access_to_scripts', 'priority_review', 'cash_in', 'late_cash_in', 'certificate_split']);
    expect(all.filter((s) => s.kind === 'remark').every((s) => s.refundRule === 'full')).toBe(true);
    // With a series: its fees and deadline per service.
    const inSeries = await apiResponse(officer.api.v1['board-services'].$get({ query: { boardSeriesId: seriesP } }));
    expect(inSeries.find((s) => s.id === CI)).toMatchObject({ fees: [{ level: 'as_a_level', amount: 700, provisional: false }] });
    // A deadline in the past is refused when set; the fees are finance's, not the coordinator's.
    expect((await refused(coordinator.api.v1['board-services'].deadlines.$put({
      json: { boardSeriesId: seriesP, rows: [{ boardServiceId: CI, deadline: inDays(-1) }], reason: 'a past date' },
    }))).error).toContain('in the future');
    expect((await refused(coordinator.api.v1['board-services'].fees.$put({
      json: { boardSeriesId: seriesP, rows: [{ boardServiceId: CI, level: 'as_a_level', amount: 1, provisional: false }] },
    }))).status).toBe(403);
  });

  // ─── A cash-in, end to end ─────────────────────────────────────────────────

  describe('a cash-in charge, end to end', () => {
    let f: Family, lineA: string, lineB: string, cashIn: string;

    beforeAll(async () => {
      f = await onboard(officer, 'cq-ci', 12);
      lineA = (await deskPaid(f, [subj.A!]))[0]!;
      lineB = (await deskUnpaid(f, [subj.B!]))[0]!;
    });

    it('asked for by the family: requested, at the series\' fee, not payable until the school accepts it', async () => {
      const asked = await apiResponse(f.parent.api.v1.charges.$post({ json: { studentId: f.studentId, kind: 'cash_in', boardServiceId: CI, registrationId: lineA } }));
      expect(asked).toMatchObject({ status: 'requested', amount: 700, kind: 'cash_in', boardSeriesId: seriesP, level: 'as_a_level' });
      cashIn = asked.id;
      await audited([cashIn], ['CHARGE_REQUESTED']);
      expect((await refused(f.parent.api.v1.payments.initiate.$post({ json: { chargeIds: [cashIn], paymentMethod: 'in_school' } }))).error)
        .toContain("awaiting the school's acceptance");
      // A family cannot add a charge of another kind.
      expect((await refused(f.parent.api.v1.charges.$post({ json: { studentId: f.studentId, kind: 'custom', amount: 10, reason: 'try' } }))).status).toBe(403);
      const accepted = await apiResponse(officer.api.v1.charges[':id'].accept.$post({ param: { id: cashIn }, json: { reason: 'the family asked at the desk' } }));
      expect(accepted).toMatchObject({ status: 'pending_payment', amount: 700 });
      expect((await notificationsFor(f.parent.email, 'CHARGE_ADDED')).at(-1)?.title).toContain('accepted');
    });

    it('paid in its own payment beside a line\'s, in one desk action: two payments, two receipts, both in the takings', async () => {
      const before = await takings(officer);
      const col = await apiResponse(officer.api.v1.registrations.desk.collect.$post({
        json: { studentId: f.studentId, registrationIds: [lineB], chargeIds: [cashIn], instrumentUsed: 'cash' },
      }));
      expect(col.payments.map((p) => p.collected).sort()).toEqual([1500, 700].sort());
      expect(col.collected).toBe(2200);
      const purposes = await sql<{ purpose: string; amount: string }>(`select purpose, amount from payment where id in ($1, $2) order by purpose`, col.payments.map((p) => p.id));
      expect(purposes.map((p) => [p.purpose, money(p.amount)])).toEqual([['charge', 700], ['registration', 1500]]);
      expect(await statusOf('charge', cashIn)).toBe('paid');
      expect(await statusOf('registration', lineB)).toBe('confirmed');
      const receipts = await sql<{ receipt_number: string; charge_id: string | null }>(`select receipt_number, charge_id from receipt where charge_id = $1 or registration_id = $2`, [cashIn, lineB]);
      expect(receipts).toHaveLength(2);
      expect(receipts.find((r) => r.charge_id)!.receipt_number).toMatch(/^RCP-C/);
      expect(col.receipts.map((r) => r.receiptNumber).sort()).toEqual(receipts.map((r) => r.receipt_number).sort());
      const d = takingsDelta(before, await takings(officer));
      expect([d.moneyIn, d.drawer.cashIn]).toEqual([2200, 2200]);
      await audited([await paymentOfCharge(cashIn)], ['CHARGE_PAYMENT_INITIATED', 'PAYMENT_CONFIRMED']);
    });

    it('reversed as the registration payment is (MO-11): the charge payable again, its receipt void; paid again, the receipt reissued under a new number', async () => {
      const pay = await paymentOfCharge(cashIn);
      const before = await takings(officer);
      await apiResponse(finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: pay }, json: { reason: 'charged twice by mistake', moneyReturned: true } }));
      expect(await statusOf('payment', pay)).toBe('refunded');
      expect(await statusOf('charge', cashIn)).toBe('pending_payment');
      expect((await one<{ status: string }>(`select status from receipt where charge_id = $1`, [cashIn])).status).toBe('void');
      const d = takingsDelta(before, await takings(officer));
      expect([d.moneyOut, d.drawer.cashOut]).toEqual([700, 700]);
      await audited([cashIn], ['CHARGE_REOPENED']);
      // Paid again at the desk: the voided paper is never offered again (MA-20).
      const again = await apiResponse(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, chargeIds: [cashIn], instrumentUsed: 'cash' } }));
      expect(again.collected).toBe(700);
      const rc = await one<{ status: string; receipt_number: string }>(`select status, receipt_number from receipt where charge_id = $1`, [cashIn]);
      expect(rc.status).toBe('pending_issue');
      expect(rc.receipt_number).toMatch(/-R2$/);
    });

    it('refunded to escrow by finance: at most what it cost, the paper back first, audited; never voided while paid', async () => {
      const rc = await one<{ id: string }>(`select id from receipt where charge_id = $1`, [cashIn]);
      expect((await refused(finadmin.api.v1.receipts[':id'].void.$post({ param: { id: rc.id }, json: { reason: 'try' } }))).error).toContain('still paid for');
      expect((await refused(finadmin.api.v1.charges[':id'].refund.$post({ param: { id: cashIn }, json: { amount: 800, reason: 'withdrawn before the board\'s date' } }))).error)
        .toContain('At most what it cost');
      expect((await refused(officer.api.v1.charges[':id'].refund.$post({ param: { id: cashIn }, json: { amount: 700, reason: 'an officer may not' } }))).status).toBe(403);
      await apiResponse(officer.api.v1.receipts[':id'].issue.$post({ param: { id: rc.id } }));
      expect((await refused(finadmin.api.v1.charges[':id'].refund.$post({ param: { id: cashIn }, json: { amount: 700, reason: 'withdrawn' } }))).status).toBe(409);
      await apiResponse(officer.api.v1.receipts[':id'].return.$post({ param: { id: rc.id }, json: { notes: 'brought back for the refund' } }));
      const before = await wallet(f.studentId);
      const refunded = await apiResponse(finadmin.api.v1.charges[':id'].refund.$post({ param: { id: cashIn }, json: { amount: 650, reason: 'cash-in withdrawn before the board\'s date' } }));
      expect(refunded).toMatchObject({ status: 'refunded', refundAmount: 650 });
      expect(await wallet(f.studentId)).toEqual({ free: before.free + 650, held: before.held });
      const ledger = await one<{ amount: string; related_charge_id: string }>(`select amount, related_charge_id from escrow_transaction where reason = 'charge_refund' and related_charge_id = $1`, [cashIn]);
      expect(money(ledger.amount)).toBe(650);
      await audited([cashIn], ['CHARGE_REFUNDED']);
      // Refunded once: a second refund is refused.
      expect((await refused(finadmin.api.v1.charges[':id'].refund.$post({ param: { id: cashIn }, json: { amount: 50, reason: 'again' } }))).status).toBe(409);
    });

    it('two charges of different service deadlines are refused in one payment; the desk takes each in its own', async () => {
      const ci = await apiResponse(officer.api.v1.charges.$post({ json: { studentId: f.studentId, kind: 'cash_in', boardServiceId: CI, registrationId: lineB } }));
      const lci = await apiResponse(officer.api.v1.charges.$post({ json: { studentId: f.studentId, kind: 'late_cash_in', boardServiceId: LCI, registrationId: lineB } }));
      expect([ci.amount, lci.amount]).toEqual([700, 1100]);
      // Due by its own date, never after its service's deadline.
      expect(new Date(ci.dueAt).getTime()).toBeLessThanOrEqual(inDays(30).getTime());
      const mixed = await refused(f.parent.api.v1.payments.initiate.$post({ json: { chargeIds: [ci.id, lci.id], paymentMethod: 'instapay' } }));
      expect(mixed.error).toContain('different deadlines');
      // Never mixed with a line either.
      expect((await refused(f.parent.api.v1.payments.initiate.$post({ json: { chargeIds: [ci.id], registrationIds: [lineB], paymentMethod: 'instapay' } }))).error)
        .toContain('separate payments');
      const col = await apiResponse(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, chargeIds: [ci.id, lci.id], instrumentUsed: 'card' } }));
      expect(col.payments).toHaveLength(2);
      expect(col.payments.map((p) => p.collected).sort((a, b) => a - b)).toEqual([700, 1100]);
    });

    it('closed unpaid at its service deadline: its open payment failed, escrow back, the charge cancelled, the family told — once, however many sweeps run', async () => {
      const ci = await apiResponse(officer.api.v1.charges.$post({ json: { studentId: f.studentId, kind: 'cash_in', boardServiceId: CI, registrationId: lineA } }));
      const before = await wallet(f.studentId);
      const pay = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { chargeIds: [ci.id], paymentMethod: 'instapay', escrowAmountToApply: 200 } }));
      expect(await wallet(f.studentId)).toEqual({ free: before.free - 200, held: before.held });
      // The board's cash-in date passes (backdated, as the suites move every deadline).
      await sql(`update board_service_deadline set deadline = now() - interval '1 minute' where board_series_id = $1 and board_service_id = $2`, [seriesP, CI]);
      try {
        const [a, b] = await Promise.all([runPaymentDeadlines(), runPaymentDeadlines()]);
        expect(a.chargesClosedAtDeadline + b.chargesClosedAtDeadline).toBe(1);
        expect(a.chargePaymentsClosedAtDeadline + b.chargePaymentsClosedAtDeadline).toBe(1);
        expect(await statusOf('payment', pay.id!)).toBe('failed');
        expect(await statusOf('charge', ci.id)).toBe('cancelled');
        expect(await wallet(f.studentId)).toEqual(before);
        await audited([ci.id], ['CHARGE_CLOSED_AT_DEADLINE']);
        expect((await notificationsFor(f.parent.email, 'CHARGE_UPDATED')).some((n) => n.title.includes('closed'))).toBe(true);
        expect((await runPaymentDeadlines()).chargesClosedAtDeadline).toBe(0);
        // Past its deadline a service charge is neither added nor paid.
        expect((await refused(officer.api.v1.charges.$post({ json: { studentId: f.studentId, kind: 'cash_in', boardServiceId: CI, registrationId: lineA } }))).error)
          .toContain("deadline for this service");
      } finally {
        await sql(`update board_service_deadline set deadline = now() + interval '30 days' where board_series_id = $1 and board_service_id = $2`, [seriesP, CI]);
      }
    });
  });

  // ─── A remark, priced from the grid ────────────────────────────────────────

  it('a Cambridge remark is priced per component at the AS rate from the series\' grid; a changed grade refunds it by the service\'s rule (seeded full; a fixed deduction when set)', async () => {
    const f = await onboard(officer, 'cq-rm', 12);
    const [physics, chemistry] = await deskPaid(f, [subj.K!, subj.L!]);
    await apiResponse(officer.api.v1.remarks.results.$post({ json: { results: [{ registrationId: physics!, grade: 'C' }, { registrationId: chemistry!, grade: 'D' }] } }));
    await apiResponse(finadmin.api.v1['board-services'].fees.$put({
      json: { boardSeriesId: seriesC, rows: [{ boardServiceId: CAM2, level: 'igcse', amount: 600, provisional: false }, { boardServiceId: CAM2, level: 'as_a_level', amount: 900, provisional: false }] },
    }));
    const run = async (registrationId: string) => {
      const r = await apiResponse(f.parent.api.v1.remarks.$post({ json: { registrationId, serviceType: 'review_of_marking', papers: [{ paperCode: '9702/22' }, { paperCode: '9702/42' }] } }));
      await apiResponse(f.parent.api.v1.remarks[':id'].consent.$post({ param: { id: r.id }, json: { attest: true } }));
      await apiResponse(f.parent.api.v1.remarks[':id'].pay.$post({ param: { id: r.id }, json: { paymentMethod: 'in_school' } }));
      const p = await one<{ id: string }>(`select id from payment where purpose = 'remark' and metadata->>'remarkRequestId' = $1`, [r.id]);
      await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: p.id }, json: { instrumentUsed: 'cash' } }));
      await apiResponse(officer.api.v1.remarks[':id']['submit-board'].$post({ param: { id: r.id }, json: { boardReference: `CIE-${r.id.slice(0, 6)}` } }));
      const items = await sql<{ id: string }>(`select id from remark_request_item where remark_request_id = $1`, [r.id]);
      const before = await wallet(f.studentId);
      await apiResponse(officer.api.v1.remarks[':id'].outcome.$post({
        param: { id: r.id }, json: { gradeChanged: true, items: items.map((i) => ({ itemId: i.id, outcome: 'mark_up' as const, gradeAfter: 'B' })) },
      }));
      return { remark: r, refunded: money((await wallet(f.studentId)).free - before.free) };
    };
    const first = await run(physics!);
    expect(first.remark).toMatchObject({ feeCharged: 1800, boardServiceId: CAM2, serviceLevel: 'as_a_level' });
    expect(first.refunded).toBe(1800);
    // Q-21's answer is a field per service: "the fee less 100 per component" refunds 1,600 of 1,800.
    await apiResponse(coordinator.api.v1['board-services'][':id'].$put({ param: { id: CAM2 }, json: { refundRule: 'less_fixed', refundDeduction: 100, reason: 'what Cambridge refunds the school' } }));
    try {
      const second = await run(chemistry!);
      expect(second.refunded).toBe(1600);
    } finally {
      await apiResponse(coordinator.api.v1['board-services'][':id'].$put({ param: { id: CAM2 }, json: { refundRule: 'full', reason: 'back to the default until Q-21 is answered' } }));
    }
  });

  // ─── The school fee pushed to families ─────────────────────────────────────

  describe('the school fee pushed to families (point 8)', () => {
    const next = academicYearLabel(academicYearStartOf() + 1);
    let scheduleId: string;
    let paid: Family, waived: Family, graduate: Family, n1: Family, n2: Family, n3: Family;

    beforeAll(async () => {
      const s = await apiResponse(finadmin.api.v1['school-fees'].schedules.$post({ json: { academicYear: next, amount: 5000, opensAt: inDays(-1).toISOString() } }));
      scheduleId = s.id;
      [paid, waived, graduate, n1, n2, n3] = await Promise.all([
        onboard(officer, 'cq-sf-paid', 11), onboard(officer, 'cq-sf-waived', 11), onboard(officer, 'cq-sf-grad', 12),
        onboard(officer, 'cq-sf-1', 11), onboard(officer, 'cq-sf-2', 11), onboard(officer, 'cq-sf-3', 11),
      ]);
      await apiResponse(officer.api.v1['school-fees']['desk-pay'].$post({ json: { studentId: paid.studentId, instrumentUsed: 'cash', academicYear: next } }));
      await apiResponse(finadmin.api.v1.exceptions.$post({ json: { policyKey: 'gate.schoolFee', studentId: waived.studentId, scope: { academicYear: next }, reason: 'scholarship for next year' } }));
    });

    // The schedule gates every suite that registers in that year: it never outlives this block.
    afterAll(async () => {
      if (scheduleId) await sql(`delete from school_fee_schedule where id = $1`, [scheduleId]);
    });

    it('pushed to a list: a paid, a waived and an A-13 graduate skipped and listed; the others owe it by the date; a second push skips an open one', async () => {
      const r = await apiResponse(finadmin.api.v1['school-fees'].push.$post({
        json: { academicYear: next, studentIds: [paid, waived, graduate, n1, n2, n3].map((x) => x.studentId), dueAt: inDays(20) },
      }));
      expect(r.pushed.map((p) => p.studentId).sort()).toEqual([n1, n2, n3].map((x) => x.studentId).sort());
      expect(Object.fromEntries(r.skipped.map((s) => [s.studentId, s.reason]))).toEqual({
        [paid.studentId]: 'already paid',
        [waived.studentId]: 'the fee is waived',
        [graduate.studentId]: 'a graduate owes no school fee (A-13)',
      });
      expect(r.pushed.every((p) => p.amount === 5000)).toBe(true);
      const again = await apiResponse(finadmin.api.v1['school-fees'].push.$post({ json: { academicYear: next, studentIds: [n1.studentId], dueAt: inDays(20) } }));
      expect(again).toMatchObject({ pushed: [], skipped: [{ studentId: n1.studentId, reason: 'already pushed' }] });
      // The family sees it in its pending payments, with the date it is due.
      const status = await apiResponse(n1.parent.api.v1['school-fees'].status.$get({ query: { studentId: n1.studentId, academicYear: next } }));
      expect(status.pushed).toMatchObject({ amount: 5000 });
      const mine = await apiResponse(n1.parent.api.v1.charges.$get({ query: { studentId: n1.studentId } }));
      expect(mine.map((c) => [c.kind, c.status])).toEqual([['school_fee_push', 'pending_payment']]);
      // Never paid as a charge, never given a price exception.
      expect((await refused(n1.parent.api.v1.payments.initiate.$post({ json: { chargeIds: [mine[0]!.id], paymentMethod: 'in_school' } }))).error).toContain('School fee page');
      expect((await refused(finadmin.api.v1.exceptions.$post({ json: { policyKey: 'price.discountPercent', studentId: n1.studentId, scope: { chargeId: mine[0]!.id }, value: 50, reason: 'try' } }))).status).toBe(409);
    });

    it('paid through the school-fee path: settled by that payment in its transaction; the payment reversed reopens it; the desk\'s collection settles it too; a waiver after the push cancels it', async () => {
      const pushOf = async (f: Family) => one<{ id: string; status: string; settled_by_payment_id: string | null }>(
        `select id, status, settled_by_payment_id from charge where kind = 'school_fee_push' and student_id = $1 and academic_year = $2 order by created_at desc limit 1`, [f.studentId, next]);
      const pay = await apiResponse(n1.parent.api.v1['school-fees'].pay.$post({ json: { studentId: n1.studentId, paymentMethod: 'in_school', academicYear: next } }));
      expect((await pushOf(n1)).status).toBe('pending_payment');
      await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay.id }, json: { instrumentUsed: 'cash' } }));
      expect(await pushOf(n1)).toMatchObject({ status: 'paid', settled_by_payment_id: pay.id });
      await audited([(await pushOf(n1)).id], ['CHARGE_SETTLED']);
      await apiResponse(finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: pay.id }, json: { reason: 'confirmed the wrong family', moneyReturned: false } }));
      expect(await pushOf(n1)).toMatchObject({ status: 'pending_payment', settled_by_payment_id: null });
      await audited([(await pushOf(n1)).id], ['CHARGE_REOPENED']);
      // The desk's own school-fee collection settles a push like the family's payment does.
      const desk = await apiResponse(officer.api.v1['school-fees']['desk-pay'].$post({ json: { studentId: n2.studentId, instrumentUsed: 'cash', academicYear: next } }));
      expect(await pushOf(n2)).toMatchObject({ status: 'paid', settled_by_payment_id: desk.paymentId });
      // A waiver granted after the push cancels it (the exception's hook).
      await apiResponse(finadmin.api.v1.exceptions.$post({ json: { type: 'fee_waiver', studentId: n3.studentId, reason: 'hardship case after the push' } }));
      expect((await pushOf(n3)).status).toBe('cancelled');
      expect((await notificationsFor(n3.parent.email, 'CHARGE_UPDATED')).some((n) => n.title.includes('waived'))).toBe(true);
    });

    it('pushed to a grade: every student of that grade next year who owes it', async () => {
      const g = await onboard(officer, 'cq-sf-grade', 10);
      const r = await apiResponse(finadmin.api.v1['school-fees'].push.$post({ json: { academicYear: next, grade: 11, dueAt: inDays(25) } }));
      expect(r.pushed.some((p) => p.studentId === g.studentId)).toBe(true);
      expect(r.pushed.some((p) => p.studentId === n1.studentId)).toBe(false);
    });
  });

  // ─── Refunds (Q-19) and the desk's drop past a deadline ───────────────────

  describe('drops refund the course fee by the policy and the board fee until the entry is sent (§3.9, Q-19)', () => {
    let f: Family;
    const drop = async (who: Family, registrationId: string) =>
      apiResponse(who.parent.api.v1.registrations[':id'].drop.$post({ param: { id: registrationId }, json: { reason: 'refund check' } }));
    const credited = async (registrationId: string) =>
      (await sql<{ amount: string }>(`select amount from escrow_transaction where related_registration_id = $1 and reason = 'drop'`, [registrationId])).map((r) => money(r.amount));
    const setStart = async (sessionId: string, d: number) => {
      const cur = (await one<{ d: string }>(`select course_starts_on::text as d from registration_session where id = $1`, [sessionId])).d;
      if (cur !== day(d)) await apiResponse(adm.api.v1.sessions[':id'].$put({ param: { id: sessionId }, json: { courseStartsOn: day(d), reason: 'refund week check' } }));
    };
    let restore: string;

    beforeAll(async () => {
      f = await onboard(officer, 'cq-drop', 12);
      restore = (await one<{ d: string }>(`select course_starts_on::text as d from registration_session where id = $1`, [june])).d;
    });
    afterAll(async () => {
      await apiResponse(adm.api.v1.sessions[':id'].$put({ param: { id: june }, json: { courseStartsOn: restore, reason: 'restore' } })).catch(() => undefined);
    });

    it('week 3 of June: 50% of the course fee and the board fee (1,000); a later course start of the offer moves the anchor; refund.courseStart moves one student\'s', async () => {
      const [a, b, c] = await deskPaid(f, [subj.C!, subj.D!, subj.E!]);
      await setStart(june, -15);
      expect(await drop(f, a!)).toMatchObject({ refundPercentage: 50, refundAmount: 1000 });
      expect(await credited(a!)).toEqual([1000]);
      // The offer starts later (8 days ago: week 2) — its own date anchors its lines (100%).
      const offerD = (await one<{ id: string }>(`select id from session_offer where session_id = $1 and subject_id = $2`, [june, subj.D!])).id;
      await apiResponse(adm.api.v1.sessions[':id'].offers[':offerId'].$put({ param: { id: june, offerId: offerD }, json: { courseStartsOn: day(-8), reason: 'D starts a week later' } }));
      expect(await drop(f, b!)).toMatchObject({ refundPercentage: 100, refundAmount: 1500 });
      // One student who joined late: their own course start (today: week 1).
      await setStart(june, -50);
      await apiResponse(finadmin.api.v1.exceptions.$post({ json: { policyKey: 'refund.courseStart', studentId: f.studentId, scope: { registrationId: c! }, value: day(0), reason: 'joined the class today' } }));
      expect(await drop(f, c!)).toMatchObject({ refundPercentage: 100, refundAmount: 1500 });
    });

    it('week 7 of a winter session: 0% of the course fee, and the board fee (500)', async () => {
      const winter = await session(adm, 'November (AS, charges drops)', 'november', 'as_level', { ...openWindow(), activate: true });
      const [a] = await deskPaid(f, [subj.F!], winter);
      await setStart(winter, -45);
      expect(await drop(f, a!)).toMatchObject({ refundPercentage: 0, refundAmount: 500 });
      expect(await credited(a!)).toEqual([500]);
    });

    it('a custom-priced line refunds its total by the course rule, never a board fee (1,200 at 50%: 600)', async () => {
      const g = await onboard(officer, 'cq-drop-custom', 12);
      await apiResponse(finadmin.api.v1.exceptions.$post({ json: { type: 'custom_price', value: 1200, studentId: g.studentId, sessionId: june, subjectId: subj.G!, reason: 'agreed price' } }));
      const [a] = await deskPaid(g, [subj.G!]);
      expect(await one(`select price_at_registration::float as p, course_fee_at_registration::float as c, registration_fee_at_registration::float as b from registration where id = $1`, [a!]))
        .toEqual({ p: 1200, c: 1200, b: 0 });
      await setStart(june, -15);
      expect(await drop(g, a!)).toMatchObject({ refundPercentage: 50, refundAmount: 600 });
    });

    it('a converted line refunds as V3 did: its session\'s windows, on the whole price (50%: 750)', async () => {
      const h = await onboard(officer, 'cq-drop-conv', 12);
      const [a] = await deskPaid(h, [subj.H!]);
      // As the conversion leaves a line of a window (0042): no policy snapshot, legacy.converted.
      await sql(`update registration set legacy = '{"converted": true}'::jsonb, pricing_basis = null where id = $1`, [a!]);
      const w = await apiResponse(finadmin.api.v1.receipts['refund-windows'].$post({
        json: { sessionId: june, startsAt: inDays(-1).toISOString(), endsAt: inDays(1).toISOString(), percentage: 50, label: 'converted window' },
      }));
      try {
        const preview = await apiResponse(h.parent.api.v1.receipts['refund-preview'].$get({ query: { registrationId: a! } }));
        expect(preview).toMatchObject({ percentage: 50, amount: 750, basis: 'windows' });
        expect(await drop(h, a!)).toMatchObject({ refundPercentage: 50, refundAmount: 750 });
      } finally {
        await apiResponse(finadmin.api.v1.receipts['refund-windows'][':id'].$delete({ param: { id: w!.id } }));
      }
    });

    it('past its line\'s deadline: the family is sent to the desk; the desk drops it, the board fee kept (sent), the paper back first', async () => {
      // A session of its own: its series' deadline is moved into the past and stays there (09 reads it).
      const own = await session(adm, 'June (AS, charges desk-drop)', 'june', 'as_level', { ...openWindow(), activate: true });
      const k = await onboard(officer, 'cq-deskdrop', 12);
      const [a, b] = await deskPaid(k, [subj.I!, subj.J!], own);
      await setStart(own, -15);
      // Before the deadline the desk-drop is refused: the family drops it themselves.
      expect((await refused(officer.api.v1.registrations[':id']['desk-drop'].$post({ param: { id: a! }, json: { reason: 'the family asked at the desk' } }))).status).toBe(409);
      // The series' entry deadline passes (backdated, as the suites move every deadline).
      const s = (await one<{ s: string }>(`select board_series_id as s from registration where id = $1`, [a!])).s;
      await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [s]);
      expect((await refused(k.parent.api.v1.registrations[':id'].drop.$post({ param: { id: a! }, json: { reason: 'too late' } }))).error).toContain('ask the finance desk');
      const done = await apiResponse(officer.api.v1.registrations[':id']['desk-drop'].$post({ param: { id: a! }, json: { reason: 'the family asked at the desk' } }));
      expect(done).toMatchObject({ gated: false, refundPercentage: 50, refundAmount: 500, boardSent: true, refundBoardPart: 0 });
      expect(await statusOf('registration', a!)).toBe('dropped');
      await audited([a!], ['DESK_DROP_EXECUTED']);
      // The paper handed over comes back before the refund (MA-16).
      const rc = await one<{ id: string }>(`select id from receipt where registration_id = $1`, [b!]);
      await apiResponse(officer.api.v1.receipts[':id'].issue.$post({ param: { id: rc.id } }));
      const parked = await apiResponse(finadmin.api.v1.registrations[':id']['desk-drop'].$post({ param: { id: b! }, json: { reason: 'the family asked at the desk' } }));
      expect(parked).toMatchObject({ gated: true, refundAmount: 500 });
      expect(await statusOf('registration', b!)).toBe('dropped_pending_receipt');
      expect(money((await one<{ r: string }>(`select refund_amount_on_return as r from receipt where id = $1`, [rc.id])).r)).toBe(500);
    });

    it('a series with no entry deadline is cut off at its exams\' start, and its board fee counts as sent from then', async () => {
      const own = await session(adm, 'June (AS, charges exams start)', 'june', 'as_level', { ...openWindow(), activate: true });
      const m = await onboard(officer, 'cq-examsstart', 12);
      const [a] = await deskPaid(m, [subj.A!], own);
      const s = (await one<{ s: string }>(`select board_series_id as s from registration where id = $1`, [a!])).s;
      await setStart(own, -15);
      await sql(`update board_series set exams_start = (now() at time zone 'Africa/Cairo')::date - 1 where id = $1`, [s]);
      const done = await apiResponse(officer.api.v1.registrations[':id']['desk-drop'].$post({ param: { id: a! }, json: { reason: 'exams have started' } }));
      expect(done).toMatchObject({ refundAmount: 500, boardSent: true });
    });
  });

  // ─── The overdue expiry ────────────────────────────────────────────────────

  it('payment.expireOverdueAfterDays: off by default; on, a line unpaid that long after its due date expires ("overdue") once, however many ticks run', async () => {
    const { expireOverdueLines } = await import('../src/services/overdue.services');
    const o = await onboard(officer, 'cq-overdue', 12);
    const [a] = await deskUnpaid(o, [subj.B!]);
    await sql(`update registration set due_at = now() - interval '10 days' where id = $1`, [a!]);
    expect((await expireOverdueLines()).expired).toBe(0);
    await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'payment.expireOverdueAfterDays' }, json: { value: 7, reason: 'unpaid a week past due expires' } }));
    try {
      // Two scheduler instances on the same tick: the line expires once (every line overdue that
      // long is expired; the suites may leave others).
      await Promise.all([expireOverdueLines(), expireOverdueLines()]);
      expect(await statusOf('registration', a!)).toBe('expired');
      expect((await sql(`select id from audit_log where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [a!])).length).toBe(1);
      expect((await one<{ r: string }>(`select new_data->>'reason' as r from audit_log where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [a!])).r).toBe('overdue');
      expect((await notificationsFor(o.parent.email, 'PAYMENT_EXPIRED')).length).toBeGreaterThan(0);
    } finally {
      await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'payment.expireOverdueAfterDays' }, json: { value: 0, reason: 'back to the default' } }));
    }
  });
});

// ─── Instalment plans (§3.6, §3.10 item 6; Q-15's default) ───────────────────

describe('08q: instalment plans', () => {
  let adm: Client, officer: Client, finadmin: Client, coordinator: Client;
  let s1: string, s2: string, s3: string;
  const subj: Record<string, string> = {};
  type Family = Awaited<ReturnType<typeof onboard>>;

  const deskPaid = async (f: Family, subjectIds: string[], sessionId: string) =>
    (await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { studentId: f.studentId, sessionId, subjectIds, collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
    }))).registrations.map((r) => r.id);
  const unpaid = async (f: Family, subjectIds: string[], sessionId: string) =>
    (await apiResponse(officer.api.v1.registrations.desk.$post({ json: { studentId: f.studentId, sessionId, subjectIds } }))).registrations.map((r) => r.id);
  const grant = (f: Family, line: string, amounts: number[], extra: { validUntil?: Date; firstInDays?: number } = {}) =>
    finadmin.api.v1.exceptions.$post({
      json: {
        policyKey: 'plan.instalments', studentId: f.studentId, scope: { registrationId: line },
        value: amounts.map((amount, i) => ({ dueAt: inDays((extra.firstInDays ?? 1) + i * 4).toISOString(), amount })),
        ...(extra.validUntil ? { validUntil: extra.validUntil } : {}),
        reason: 'paying in instalments',
      },
    });
  const plan = async (f: Family, line: string, amounts: number[], extra: { validUntil?: Date } = {}) => {
    const p = await apiResponse(grant(f, line, amounts, extra));
    const charges = await sql<{ id: string; amount: string; status: string }>(`select id, amount, status from charge where plan_exception_id = $1 order by instalment_no`, [p.id]);
    return { id: p.id, i: charges.map((c) => c.id) };
  };
  const payAtDesk = (f: Family, chargeIds: string[]) =>
    apiResponse(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, chargeIds, instrumentUsed: 'cash' } }));
  const payByTransfer = async (f: Family, chargeId: string, reference: string) => {
    const p = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { chargeIds: [chargeId], paymentMethod: 'instapay' } }));
    await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: p.id! }, json: { reference } }));
    return p.id!;
  };
  const settledOf = async (line: string) =>
    one<{ kept: string; released: string; deposits: string; cause: string }>(
      `select new_data->>'kept' as kept, new_data->>'released' as released, new_data->>'deposits' as deposits, new_data->>'cause' as cause
       from audit_log where action = 'PLAN_SETTLED' and entity_id = $1`, [line]);
  const expiredFor = async (line: string) =>
    (await one<{ r: string }>(`select new_data->>'reason' as r from audit_log where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [line])).r;
  const ledgerOf = async (line: string) => Object.fromEntries((await sql<{ reason: string; total: string }>(
    `select reason, sum(amount) as total from escrow_transaction where related_registration_id = $1 and balance_type = 'held' group by reason`, [line]))
    .map((r) => [r.reason, money(r.total)]));
  const week3 = async (sessionId: string) =>
    apiResponse(adm.api.v1.sessions[':id'].$put({ param: { id: sessionId }, json: { courseStartsOn: day(-15), reason: 'the course started two weeks ago' } }));

  beforeAll(async () => {
    adm = await admin('cqp');
    officer = await staff(adm, 'finance_officer', 'cqp');
    finadmin = await staff(adm, 'finance_admin', 'cqp');
    coordinator = await staff(adm, 'coordinator', 'cqp');
    for (let i = 1; i <= 14; i++) {
      subj[`P${i}`] = await subject(adm, `CQP-${i}`, `Subject ${i} (AS, plans)`, { course: 1000, registration: 500 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    }
    // Winter sessions: the policy refunds 50% in weeks 3–6 (the worked example of Q-15).
    s1 = await session(adm, 'November (AS, plans)', 'november', 'as_level', { ...openWindow(), activate: true });
    s2 = await session(adm, 'November (AS, plans closed)', 'november', 'as_level', { ...openWindow(), activate: true });
    s3 = await session(adm, 'November (AS, plans deadline)', 'november', 'as_level', { ...openWindow(), activate: true });
    for (const s of [s1, s2, s3]) await week3(s);
  });

  it('refused: a provisional board fee, a checkout in progress, instalments that do not add up, a last date past the session\'s end; granted by finance only', async () => {
    const f = await onboard(officer, 'cqp-refuse', 12);
    // A subject whose board fee in the series is still provisional.
    const prov = await subject(adm, 'CQP-PROV', 'Provisional (A Level, plans)', { course: 1000, registration: 500 }, { qualificationLevel: 'a_level', council: 'pearson_edexcel' });
    const series = await seriesOfSession(s1, 'pearson_edexcel');
    const t = await apiResponse(adm.api.v1.teachers.$post({ json: { name: 'Teacher (plans)' } }));
    await apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId: series }, json: { rows: [{ keyKind: 'subject', keyId: prov, amount: 500, provisional: true }] } }));
    await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: s1 },
      json: { subjectId: prov, availability: 'open', courseFee: 1000, grade10Core: false, teachers: [{ teacherId: t!.id, mode: 'in_school' }],
        items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: series, availability: 'open', requiredInSeries: false }] },
    }));
    const [provLine] = await unpaid(f, [prov], s1);
    expect((await refused(grant(f, provLine!, [1500]))).error).toContain('provisional');
    const [line, other] = await unpaid(f, [subj.P1!, subj.P2!], s1);
    expect((await refused(grant(f, line!, [500, 500]))).error).toContain('add up to');
    expect((await refused(grant(f, line!, [500, 500, 500], { firstInDays: 400 }))).error).toContain('at the latest');
    expect((await refused(officer.api.v1.exceptions.$post({ json: { policyKey: 'plan.instalments', studentId: f.studentId, scope: { registrationId: line! }, value: [{ dueAt: inDays(2).toISOString(), amount: 1500 }], reason: 'an officer may not' } }))).status).toBe(403);
    const checkout = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [other!], paymentMethod: 'in_school' } }));
    expect((await refused(grant(f, other!, [750, 750]))).error).toContain('checkout in progress');
    await apiResponse(f.parent.api.v1.payments[':id'].cancel.$post({ param: { id: checkout.id! } }));
  });

  it('three instalments into the held wallet, earmarked for the line, each with a deposit slip and in the day\'s takings; the line captured at the last in one payment from its deposits', async () => {
    const f = await onboard(officer, 'cqp-happy', 12);
    const [line, other] = await unpaid(f, [subj.P3!, subj.P4!], s1);
    const p = await plan(f, line!, [500, 500, 500]);
    expect(p.i).toHaveLength(3);
    // The line is due on the last instalment's date.
    const due = await one<{ due: string }>(`select due_at as due from registration where id = $1`, [line!]);
    expect(Math.abs(new Date(due.due).getTime() - inDays(9).getTime())).toBeLessThan(60_000);
    // A second payment for the line is refused: only the capture pays it.
    expect((await refused(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [line!], paymentMethod: 'in_school' } }))).error).toContain('instalment plan');

    const before = await takings(officer);
    const first = await payAtDesk(f, [p.i[0]!]);
    expect(first.collected).toBe(500);
    expect(await wallet(f.studentId)).toEqual({ free: 0, held: 500 });
    expect((await one<{ slip: string }>(`select metadata->>'depositSlip' as slip from payment where id = $1`, [first.paymentId])).slip).toMatch(/^DEP-/);
    expect((await sql(`select id from receipt where charge_id = $1`, [p.i[0]!]))).toEqual([]);
    expect(takingsDelta(before, await takings(officer)).moneyIn).toBe(500);
    // Held money is not free: not withdrawn, not applied to another line.
    expect((await refused(f.parent.api.v1.escrow.withdraw.$post({ json: { studentId: f.studentId, amount: 500 } }))).status).toBeGreaterThanOrEqual(400);
    expect((await refused(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [other!], paymentMethod: 'in_school', escrowAmountToApply: 500 } }))).error).toContain('insufficient');
    // Reversed while unspent: the deposit comes back out of the held wallet; paid again.
    await apiResponse(finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: first.paymentId }, json: { reason: 'recorded on the wrong family', moneyReturned: true } }));
    expect(await wallet(f.studentId)).toEqual({ free: 0, held: 0 });
    expect(await statusOf('charge', p.i[0]!)).toBe('pending_payment');
    expect((await ledgerOf(line!)).instalment_reversed).toBe(500);
    await payAtDesk(f, [p.i[0]!]);
    // Never from escrow (its money is held for the line).
    expect((await refused(f.parent.api.v1.payments.initiate.$post({ json: { chargeIds: [p.i[1]!], paymentMethod: 'in_school', escrowAmountToApply: 100 } }))).error).toContain('never from escrow');
    const second = await payByTransfer(f, p.i[1]!, `CQP-H-${f.studentId.slice(0, 6)}`);
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: second }, json: {} }));
    expect(await wallet(f.studentId)).toEqual({ free: 0, held: 1000 });

    const beforeLast = await takings(officer);
    const last = await payAtDesk(f, [p.i[2]!]);
    expect(await statusOf('registration', line!)).toBe('confirmed');
    expect(await wallet(f.studentId)).toEqual({ free: 0, held: 0 });
    const capture = await one<{ id: string; amount: string; escrow: string; method: string; status: string; purpose: string }>(
      `select p.id, p.amount, p.escrow_amount_applied as escrow, p.payment_method as method, p.status, p.purpose
       from payment p join payment_registration pr on pr.payment_id = p.id where pr.registration_id = $1`, [line!]);
    expect([money(capture.amount), money(capture.escrow), capture.method, capture.status, capture.purpose]).toEqual([0, 1500, 'held_deposits', 'completed', 'registration']);
    await audited([capture.id], ['PLAN_CAPTURED', 'PAYMENT_CONFIRMED']);
    expect((await ledgerOf(line!)).plan_capture).toBe(1500);
    expect((await one<{ notes: string }>(`select notes from receipt where registration_id = $1`, [line!])).notes).toContain('DEP-');
    expect(await statusOf('exception', p.id)).toBe('used');
    // In the takings: the last instalment as money in; the capture in the escrow applied only.
    const d = takingsDelta(beforeLast, await takings(officer));
    expect([d.moneyIn, d.escrowApplied, d.drawer.cashIn]).toEqual([500, 1500, 500]);
    // Never reversed: neither the capture nor, after it, an instalment.
    expect((await refused(finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: capture.id }, json: { reason: 'try', moneyReturned: false } }))).error).toContain('never reversed');
    expect((await refused(finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: last.paymentId }, json: { reason: 'try', moneyReturned: true } }))).error).toContain('paid in full or has ended');
  });

  it('a plan line is not sent back for approval by the parent, even with nothing paid yet', async () => {
    const f = await onboard(officer, 'cqp-revert', 12);
    const [req] = await apiResponse(f.student.api.v1.registrations.request.$post({ json: { sessionId: s1, subjectIds: [subj.P5!] } }));
    await apiResponse(f.parent.api.v1.registrations.approve.$put({ json: { registrationIds: [req!.id] } }));
    const p = await plan(f, req!.id, [750, 750]);
    expect((await refused(f.parent.api.v1.registrations['revert-approval'].$put({ json: { registrationIds: [req!.id] } }))).error).toContain('instalment plan');
    // Revoked with nothing paid: the line expires (plan_revoked), nothing to settle.
    await apiResponse(finadmin.api.v1.exceptions[':id'].revoke.$post({ param: { id: p.id } }));
    expect(await statusOf('registration', req!.id)).toBe('expired');
    expect(await expiredFor(req!.id)).toBe('plan_revoked');
    expect(await settledOf(req!.id)).toMatchObject({ deposits: '0', kept: '0', released: '0', cause: 'revoked' });
  });

  it('stopped in week 3 (50%): the school keeps min(deposits, price − the refund) and releases the rest — 1,000 paid: 500 kept; 500 paid: 500 kept; 300 paid: 300 kept; a paid drop that day gives 1,000 back', async () => {
    const f = await onboard(officer, 'cqp-q15', 12);
    const [l1, l2, l3] = await unpaid(f, [subj.P6!, subj.P7!, subj.P8!], s1);
    const p1 = await plan(f, l1!, [500, 500, 500]);
    const p2 = await plan(f, l2!, [500, 500, 500]);
    const p3 = await plan(f, l3!, [300, 600, 600]);
    await payAtDesk(f, [p1.i[0]!, p1.i[1]!]);
    await payAtDesk(f, [p2.i[0]!]);
    await payAtDesk(f, [p3.i[0]!]);
    expect(await wallet(f.studentId)).toEqual({ free: 0, held: 1800 });
    for (const p of [p1, p2, p3]) await apiResponse(finadmin.api.v1.exceptions[':id'].revoke.$post({ param: { id: p.id } }));
    expect(await settledOf(l1!)).toMatchObject({ deposits: '1000', kept: '500', released: '500' });
    expect(await settledOf(l2!)).toMatchObject({ deposits: '500', kept: '500', released: '0' });
    expect(await settledOf(l3!)).toMatchObject({ deposits: '300', kept: '300', released: '0' });
    expect(await wallet(f.studentId)).toEqual({ free: 500, held: 0 });
    for (const l of [l1, l2, l3]) expect(await expiredFor(l!)).toBe('plan_revoked');
    expect((await sql(`select id from charge where plan_exception_id in ($1, $2, $3) and status = 'pending_payment'`, [p1.id, p2.id, p3.id]))).toEqual([]);
    expect((await notificationsFor(f.parent.email, 'PLAN_UPDATED')).some((n) => n.title.includes('ended'))).toBe(true);
    // The comparison: a paid drop the same day, before its entry is sent, gives 1,000 back (the school keeps 500).
    const [paid] = await deskPaid(f, [subj.P9!], s1);
    expect(await apiResponse(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: paid! }, json: { reason: 'compare' } }))).toMatchObject({ refundAmount: 1000 });
  });

  it('released in full by finance: every deposit back in escrow, the line still payable and paid normally', async () => {
    const f = await onboard(officer, 'cqp-release', 12);
    const [l] = await unpaid(f, [subj.P10!], s1);
    const p = await plan(f, l!, [500, 500, 500]);
    await payAtDesk(f, [p.i[0]!, p.i[1]!]);
    await apiResponse(finadmin.api.v1.exceptions[':id'].release.$post({ param: { id: p.id }, json: { note: 'the family will pay the rest now' } }));
    expect(await settledOf(l!)).toMatchObject({ deposits: '1000', kept: '0', released: '1000', cause: 'released_in_full' });
    expect(await wallet(f.studentId)).toEqual({ free: 1000, held: 0 });
    expect(await statusOf('registration', l!)).toBe('pending_payment');
    const col = await apiResponse(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, registrationIds: [l!], instrumentUsed: 'cash', escrowAmountToApply: 1000 } }));
    expect(col.collected).toBe(500);
    expect(await statusOf('registration', l!)).toBe('confirmed');
  });

  it('ended by an overdue expiry, by the student leaving, and by an instalment payment failing on a line no longer payable — each settled as a drop that day', async () => {
    const { expireOverdueLines } = await import('../src/services/overdue.services');
    const f = await onboard(officer, 'cqp-endings', 12);
    const [lo] = await unpaid(f, [subj.P11!], s1);
    const po = await plan(f, lo!, [500, 500, 500]);
    await payAtDesk(f, [po.i[0]!, po.i[1]!]);
    await sql(`update registration set due_at = now() - interval '10 days' where id = $1`, [lo!]);
    await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'payment.expireOverdueAfterDays' }, json: { value: 7, reason: 'unpaid a week past due expires' } }));
    try {
      // Every line overdue that long is expired (others the suites left may be too); this one once.
      expect((await expireOverdueLines()).expired).toBeGreaterThanOrEqual(1);
    } finally {
      await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'payment.expireOverdueAfterDays' }, json: { value: 0, reason: 'back to the default' } }));
    }
    expect(await expiredFor(lo!)).toBe('overdue');
    expect(await settledOf(lo!)).toMatchObject({ deposits: '1000', kept: '500', released: '500', cause: 'expired' });
    expect(await statusOf('exception', po.id)).toBe('lapsed');

    // The student leaves the school: the clean-up expires the plan line (ineligible) and settles it.
    const w = await onboard(officer, 'cqp-leaver', 12);
    const [lw] = await unpaid(w, [subj.P12!], s1);
    const pw = await plan(w, lw!, [500, 500, 500]);
    await payAtDesk(w, [pw.i[0]!]);
    await apiResponse(coordinator.api.v1.students[':id'].leave.$post({ param: { id: w.studentId }, json: { kind: 'withdrawn', leftOn: day(0), reason: 'moved abroad with the family' } }));
    expect(await expiredFor(lw!)).toBe('ineligible');
    expect(await settledOf(lw!)).toMatchObject({ deposits: '500', kept: '500', released: '0' });
  });

  it('the close spares a line whose last instalment is being checked; that instalment rejected after the close ends the plan (plan_ended); a line under a plan not spared is settled at the close', async () => {
    const f = await onboard(officer, 'cqp-close', 12);
    const [lc, ll] = await unpaid(f, [subj.P13!, subj.P14!], s2);
    const pc = await plan(f, lc!, [500, 500, 500]);
    const pl = await plan(f, ll!, [500, 500, 500]);
    await payAtDesk(f, [pc.i[0]!, pc.i[1]!]);
    await payAtDesk(f, [pl.i[0]!, pl.i[1]!]);
    const lastTransfer = await payByTransfer(f, pl.i[2]!, `CQP-C-${f.studentId.slice(0, 6)}`);
    await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: s2 }, json: { reason: 'the window ended for this cycle' } }));
    expect(await expiredFor(lc!)).toBe('session_closed');
    expect(await settledOf(lc!)).toMatchObject({ deposits: '1000', kept: '500', released: '500' });
    // Spared: its last instalment's transfer is being checked.
    expect(await statusOf('registration', ll!)).toBe('pending_payment');
    await apiResponse(officer.api.v1.payments[':id'].reject.$post({ param: { id: lastTransfer }, json: { reason: 'not on the bank statement' } }));
    expect(await statusOf('registration', ll!)).toBe('expired');
    expect(await expiredFor(ll!)).toBe('plan_ended');
    expect(await settledOf(ll!)).toMatchObject({ deposits: '1000', kept: '500', released: '500' });
  });

  it('at the deadline: confirming the last instalment is refused, the sweep ends the plans and fails their open instalment payments; a plan that lapses is settled and its transfer refused at confirmation', async () => {
    const { lapsePlans } = await import('../src/services/exception-lapse.services');
    const f = await onboard(officer, 'cqp-deadline', 12);
    const s3subjects = [subj.P1!, subj.P2!, subj.P3!];
    const [ld, lx, lp] = await unpaid(f, s3subjects, s3);
    const pd = await plan(f, ld!, [500, 500, 500]);
    const px = await plan(f, lx!, [500, 500, 500]);
    const pp = await plan(f, lp!, [500, 1000], { validUntil: inDays(3) });
    await payAtDesk(f, [pd.i[0]!]);
    const openInSchool = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { chargeIds: [pd.i[1]!], paymentMethod: 'in_school' } }));
    await payAtDesk(f, [px.i[0]!, px.i[1]!]);
    const lastRef = await payByTransfer(f, px.i[2]!, `CQP-D-${f.studentId.slice(0, 6)}`);
    const ppRef = await payByTransfer(f, pp.i[0]!, `CQP-P-${f.studentId.slice(0, 6)}`);
    // The plan of lp runs out: the line expires (plan_lapsed), its deposits (none confirmed) settled; its transfer then refused.
    await sql(`update exception set valid_until = now() - interval '1 minute' where id = $1`, [pp.id]);
    expect((await lapsePlans()).lapsed).toBe(1);
    expect(await expiredFor(lp!)).toBe('plan_lapsed');
    expect(await settledOf(lp!)).toMatchObject({ deposits: '0', cause: 'lapsed' });
    expect((await refused(officer.api.v1.payments[':id'].confirm.$post({ param: { id: ppRef }, json: {} }))).error).toContain('plan has ended');
    // The series' entry deadline passes (backdated).
    const series = (await one<{ s: string }>(`select board_series_id as s from registration where id = $1`, [ld!])).s;
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [series]);
    try {
      expect((await refused(officer.api.v1.payments[':id'].confirm.$post({ param: { id: lastRef }, json: {} }))).error).toContain('deadline');
      const swept = await runPaymentDeadlines();
      expect(swept.instalmentPaymentsOfEndedPlans).toBe(3);
      for (const l of [ld, lx]) expect(await expiredFor(l!)).toBe('entry_deadline');
      expect(await settledOf(ld!)).toMatchObject({ deposits: '500', kept: '500', released: '0' });
      expect(await settledOf(lx!)).toMatchObject({ deposits: '1000', kept: '500', released: '500' });
      for (const id of [openInSchool.id!, lastRef, ppRef]) {
        expect(await one(`select status, metadata->'failure'->>'reason' as reason from payment where id = $1`, [id]))
          .toEqual({ status: 'failed', reason: 'The instalment plan ended before this payment was confirmed' });
      }
      expect((await runPaymentDeadlines()).instalmentPaymentsOfEndedPlans).toBe(0);
    } finally {
      // The deadline stays where it was moved: 09 checks every expiry at it was past it.
    }
  });

  it('an instalment payment that fails on a line still payable leaves the plan standing: the instalment is paid again', async () => {
    const f = await onboard(officer, 'cqp-stands', 12);
    const [l] = await unpaid(f, [subj.P4!], s1);
    const p = await plan(f, l!, [700, 800]);
    const c = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { chargeIds: [p.i[0]!], paymentMethod: 'instapay' } }));
    await apiResponse(f.parent.api.v1.payments[':id'].cancel.$post({ param: { id: c.id! } }));
    expect(await statusOf('registration', l!)).toBe('pending_payment');
    expect(await statusOf('exception', p.id)).toBe('active');
    expect(await statusOf('charge', p.i[0]!)).toBe('pending_payment');
    await payAtDesk(f, [p.i[0]!]);
    expect(await wallet(f.studentId)).toEqual({ free: 0, held: 700 });
  });
});
