import { describe, it, expect, beforeAll, vi } from 'vitest';
import { apiResponse, academicYearStartOf, type LineInputType } from '@repo/validations';
import { admin, staff, onboard, subject, refused, one, sql, audited, money, notified, type Client } from './helpers';

/**
 * The reservations rework, step 1 (RESERVATIONS_REWORK.md §3.4, §8): what a line costs.
 *
 * - `priceLine`: course × (self-study or retake percent) × (one-paper percent) plus board ×
 *   (self-study board percent); A-16's self-study price (course 50%, board 100%) on a taught
 *   subject's retake and on an untaught subject's first entry — the "50% of the total" rule had
 *   no test; a retake in school at 100%; a one-paper retake at its own course fee and the
 *   qualification's board fee, refused together with the whole subject.
 * - The pricing settings change new lines only: the basis is frozen on the line.
 * - Price exceptions apply in today's order (custom, percent, fixed) and are recorded.
 * - Board fees provisional until confirmed: reserved, not payable at the checkout or the desk;
 *   confirmed at the same amount clears it and moves the due date; confirmed higher, the lines
 *   with no payment history are re-priced on the board part with the exceptions they recorded,
 *   every line with a payment (open, failed or paid) is listed and left as it is.
 *
 * Lines are made as the reservation paths make them (insertLines after the student lock); the
 * checkout and the desk are driven through the API.
 */

const days = (n: number) => n * 86_400_000;
const RUN = Math.random().toString(36).slice(2, 6);
const Y = academicYearStartOf();
const cairoDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
type Line = Pick<LineInputType, 'offerItemId' | 'attempt' | 'mode'> & Partial<LineInputType>;

async function reserve(studentId: string, sessionId: string, lines: Line[]) {
  const { db } = await import('@repo/db');
  const { insertLines } = await import('../src/services/line.services');
  const { assertMayRegisterForInTx } = await import('../src/services/eligibility.services');
  return db.transaction(async (tx) => {
    const eligibility = await assertMayRegisterForInTx(tx, studentId, sessionId);
    return insertLines(tx, { studentId, sessionId, lines: lines as LineInputType[], status: 'pending_payment', requestedBy: studentId, eligibility });
  });
}
const priceOf = async (id: string) => {
  const r = await one<{ price: string; course: string; board: string; provisional: boolean; basis: Record<string, unknown> }>(
    `select price_at_registration as price, course_fee_at_registration as course, registration_fee_at_registration as board, price_provisional as provisional, pricing_basis as basis
     from registration where id = $1`, [id]);
  return { price: money(r.price), course: money(r.course), board: money(r.board), provisional: r.provisional, basis: r.basis };
};

describe('08p: pricing policies', () => {
  let adm: Client, finadmin: Client, officer: Client;
  let teacherId: string;
  let session: string, series: string, seriesProv: string, priorJune: string;
  let taughtWhole: string, onePaper: string, untaught: string;
  let provItem: string, provSubject: string;

  const fee = (seriesId: string, rows: { keyKind: 'subject' | 'qualification'; keyId: string; amount: number; provisional?: boolean }[]) =>
    apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId }, json: { rows: rows.map((r) => ({ ...r, provisional: r.provisional ?? false })) } }));

  beforeAll(async () => {
    adm = await admin('p08');
    finadmin = await staff(adm, 'finance_admin', 'p08');
    officer = await staff(adm, 'finance_officer', 'p08');
    teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher P (08p ${RUN})` } })))!.id;
    session = (await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: Y + 1, label: `p08-${RUN}`, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + days(2)).toISOString(),
      },
    })))!.id;
    const mk = async (label: string) => (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label, entryDeadline: new Date(Date.now() + days(50)) } })))!.id;
    series = await mk(`p08-${RUN}`);
    seriesProv = await mk(`p08-prov-${RUN}`);
    priorJune = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y, label: `p08-${RUN}` } })))!.id;

    // Taught: the whole subject (course 14,000, board 9,200) and a one-paper retake at its own
    // course fee, read for the qualification's board fee — one exclusive group with the whole.
    const taught = await subject(adm, `RWP-T-${RUN}`, `Taught (08p ${RUN})`, { course: 14000, registration: 9200 });
    const q = (await apiResponse(adm.api.v1.catalogue.qualifications.$post({
      json: { boardCode: 'cambridge', code: `P08Q-${RUN}`, title: `Taught award (08p ${RUN})`, level: 'igcse', suite: 'Cambridge IGCSE', subjectArea: 'Test', entryMethod: 'qualification' },
    })))!;
    await fee(series, [{ keyKind: 'subject', keyId: taught, amount: 9200 }, { keyKind: 'qualification', keyId: q.id, amount: 5000 }]);
    const t = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: session }, json: {
        subjectId: taught, courseFee: 14000, teachers: [{ teacherId, mode: 'in_school' }],
        items: [
          { label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: series, availability: 'open', requiredInSeries: false, exclusiveGroup: 'entry' },
          { label: 'Paper 4 only (retake)', kind: 'one_paper', enters: { kind: 'subject' }, boardSeriesId: series, availability: 'retake_only', courseFee: 3000, feeKeys: [{ kind: 'qualification', id: q.id }], requiredInSeries: false, exclusiveGroup: 'entry' },
        ],
      },
    })))!;
    [taughtWhole, onePaper] = t.items as [string, string];

    // Not taught this cycle: self-study only.
    const notTaught = await subject(adm, `RWP-U-${RUN}`, `Untaught (08p ${RUN})`, { course: 14000, registration: 9200 });
    await fee(series, [{ keyKind: 'subject', keyId: notTaught, amount: 9200 }]);
    untaught = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: session }, json: { subjectId: notTaught, courseFee: 14000, availability: 'self_study_only', teachers: [], items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: series, availability: 'open', requiredInSeries: false }] },
    })))!.items[0]!;

    // A subject whose board fee is not published yet: provisional.
    provSubject = await subject(adm, `RWP-V-${RUN}`, `Provisional (08p ${RUN})`, { course: 1000, registration: 9000 });
    await fee(seriesProv, [{ keyKind: 'subject', keyId: provSubject, amount: 9000, provisional: true }]);
    provItem = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: session }, json: { subjectId: provSubject, courseFee: 1000, teachers: [{ teacherId, mode: 'in_school' }], items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: seriesProv, availability: 'open', requiredInSeries: false }] },
    })))!.items[0]!;
  });

  it("A-16: self-study is course 50%, board 100% — on a taught subject's retake and on an untaught subject's first entry; a retake in school is 100%", async () => {
    const a = await onboard(officer, `p08-a-${RUN}`, 11);
    const b = await onboard(officer, `p08-b-${RUN}`, 11);
    const c = await onboard(officer, `p08-c-${RUN}`, 11);
    const d = await onboard(officer, `p08-d-${RUN}`, 11);
    const retake = { attempt: 'retake' as const, priorSittingSeriesId: priorJune, priorSittingSource: 'declared_by_desk' as const };
    const [first] = await reserve(a.studentId, session, [{ offerItemId: taughtWhole, attempt: 'first', mode: 'in_school', teacherId }]);
    const [inSchoolRetake] = await reserve(b.studentId, session, [{ offerItemId: taughtWhole, mode: 'in_school', teacherId, ...retake }]);
    const [selfRetake] = await reserve(c.studentId, session, [{ offerItemId: taughtWhole, mode: 'self_study', ...retake }]);
    const [selfFirst] = await reserve(d.studentId, session, [{ offerItemId: untaught, attempt: 'first', mode: 'self_study' }]);
    expect(await priceOf(first!.id)).toMatchObject({ course: 14000, board: 9200, price: 23200 });
    expect(await priceOf(inSchoolRetake!.id)).toMatchObject({ course: 14000, board: 9200, price: 23200 });
    expect(await priceOf(selfRetake!.id)).toMatchObject({ course: 7000, board: 9200, price: 16200 });
    expect(await priceOf(selfFirst!.id)).toMatchObject({ course: 7000, board: 9200, price: 16200 });
    // Not "50% of the total" (11,600): the board's fee is paid in full.
    expect((await priceOf(selfFirst!.id)).basis).toMatchObject({ v: 1, attempt: 'first', mode: 'self_study', courseFeeBase: 14000, coursePercent: 50, boardFeeBase: 9200, boardPercent: 100, total: 16200 });
  });

  it("a one-paper retake costs its own course fee and the qualification's board fee; it is refused with the whole subject, and as a first entry", async () => {
    const f = await onboard(officer, `p08-one-${RUN}`, 11);
    const retake = { attempt: 'retake' as const, priorSittingSeriesId: priorJune, priorSittingSource: 'declared_by_desk' as const };
    await expect(reserve(f.studentId, session, [{ offerItemId: onePaper, attempt: 'first', mode: 'in_school', teacherId }])).rejects.toThrow(/takes retakes only/);
    await expect(reserve(f.studentId, session, [
      { offerItemId: taughtWhole, mode: 'in_school', teacherId, ...retake }, { offerItemId: onePaper, mode: 'in_school', teacherId, ...retake },
    ])).rejects.toThrow(/cannot be reserved together/);
    const [line] = await reserve(f.studentId, session, [{ offerItemId: onePaper, mode: 'in_school', teacherId, ...retake }]);
    expect(await priceOf(line!.id)).toMatchObject({ course: 3000, board: 5000, price: 8000 });
    expect((await priceOf(line!.id)).basis).toMatchObject({ itemKind: 'one_paper', courseFeeBase: 3000, onePaperPercent: 100 });
  });

  it('the pricing settings change new lines only: a line keeps the price and the basis it was given', async () => {
    const before = await onboard(officer, `p08-set-a-${RUN}`, 11);
    const after = await onboard(officer, `p08-set-b-${RUN}`, 11);
    const [old] = await reserve(before.studentId, session, [{ offerItemId: untaught, attempt: 'first', mode: 'self_study' }]);
    const setPercent = (value: number) => apiResponse(finadmin.api.v1.settings[':key'].$put({ param: { key: 'pricing.selfStudyCoursePercent' }, json: { value, reason: '08p: a policy change' } }));
    await setPercent(40);
    try {
      const [fresh] = await reserve(after.studentId, session, [{ offerItemId: untaught, attempt: 'first', mode: 'self_study' }]);
      expect(await priceOf(fresh!.id)).toMatchObject({ course: 5600, board: 9200, price: 14800 });
      expect(await priceOf(old!.id)).toMatchObject({ course: 7000, board: 9200, price: 16200 });
      expect((await priceOf(old!.id)).basis).toMatchObject({ coursePercent: 50 });
    } finally {
      await setPercent(50);
    }
  });

  it("a pricing.* exception replaces its setting's percent on the lines it applies to, and is recorded in the basis; one that does not apply is not", async () => {
    // Step C's registry holds these per student or per family and answers the adapter with the
    // ones covering the line (who holds it is the registry's; RESERVATIONS.md §2.12). On this
    // branch the adapter is answered as the registry would answer it: priceLine is what asks.
    const { lineExceptions } = await import('../src/services/line-exceptions');
    const self = await onboard(officer, `p08-pct-s-${RUN}`, 11);
    const retaker = await onboard(officer, `p08-pct-r-${RUN}`, 11);
    const none = await onboard(officer, `p08-pct-n-${RUN}`, 11);
    const grant = (studentId: string, key: 'pricing.selfStudyCoursePercent' | 'pricing.selfStudyBoardPercent' | 'pricing.retakeTaughtCoursePercent' | 'pricing.onePaperCoursePercent', value: number) =>
      ({ id: `test-${key}-${studentId}`, policyKey: key, value, valueDate: null, oneShot: false, scope: { sessionId: session } });
    const held: Record<string, ReturnType<typeof grant>[]> = {
      [self.studentId]: [grant(self.studentId, 'pricing.selfStudyCoursePercent', 30), grant(self.studentId, 'pricing.selfStudyBoardPercent', 50)],
      [retaker.studentId]: [grant(retaker.studentId, 'pricing.retakeTaughtCoursePercent', 60), grant(retaker.studentId, 'pricing.onePaperCoursePercent', 80)],
    };
    const original = lineExceptions.active;
    const spy = vi.spyOn(lineExceptions, 'active').mockImplementation(async (executor, studentId, keys, scope, opts) => {
      const own = await original.call(lineExceptions, executor, studentId, keys, scope, opts);
      return [...(held[studentId] ?? []).filter((e) => keys.includes(e.policyKey) && scope.sessionId === session), ...own];
    });
    const retake = { attempt: 'retake' as const, priorSittingSeriesId: priorJune, priorSittingSource: 'declared_by_desk' as const };
    try {
      const [s] = await reserve(self.studentId, session, [{ offerItemId: untaught, attempt: 'first', mode: 'self_study' }]);
      // 30% of the course fee (14,000) and 50% of the board's (9,200), in place of 50% and 100%.
      expect(await priceOf(s!.id)).toMatchObject({ course: 4200, board: 4600, price: 8800 });
      expect((await priceOf(s!.id)).basis).toMatchObject({
        coursePercent: 30, boardPercent: 50, exceptionIds: [`test-pricing.selfStudyCoursePercent-${self.studentId}`, `test-pricing.selfStudyBoardPercent-${self.studentId}`],
      });
      // A retake in school at 60%; the one-paper percent does not apply to a whole subject: not recorded.
      const [r] = await reserve(retaker.studentId, session, [{ offerItemId: taughtWhole, mode: 'in_school', teacherId, ...retake }]);
      expect(await priceOf(r!.id)).toMatchObject({ course: 8400, board: 9200, price: 17600 });
      expect((await priceOf(r!.id)).basis).toMatchObject({ coursePercent: 60, onePaperPercent: 100, exceptionIds: [`test-pricing.retakeTaughtCoursePercent-${retaker.studentId}`] });
      // A student who holds none pays the settings' percents.
      const [n] = await reserve(none.studentId, session, [{ offerItemId: untaught, attempt: 'first', mode: 'self_study' }]);
      expect(await priceOf(n!.id)).toMatchObject({ course: 7000, board: 9200, price: 16200 });
      expect((await priceOf(n!.id)).basis).toMatchObject({ coursePercent: 50, boardPercent: 100, exceptionIds: [] });
    } finally {
      spy.mockRestore();
    }
  });

  it("price exceptions apply in today's order — a custom price, then a percent, then a fixed discount — and are recorded on the line", async () => {
    const f = await onboard(officer, `p08-exc-${RUN}`, 11);
    const g = await onboard(officer, `p08-exc2-${RUN}`, 11);
    const grant = (studentId: string, type: 'custom_price' | 'discount_percent' | 'discount_fixed', value: number) =>
      apiResponse(finadmin.api.v1.exceptions.$post({ json: { type, studentId, sessionId: session, value, reason: `08p: ${type}` } }));
    const pct = (await grant(f.studentId, 'discount_percent', 10))!;
    const fixed = (await grant(f.studentId, 'discount_fixed', 500))!;
    const [line] = await reserve(f.studentId, session, [{ offerItemId: taughtWhole, attempt: 'first', mode: 'in_school', teacherId }]);
    // 10% off each part (12,600 + 8,280), then 500 off the course part.
    expect(await priceOf(line!.id)).toMatchObject({ course: 12100, board: 8280, price: 20380 });
    expect((await priceOf(line!.id)).basis).toMatchObject({ exceptionIds: [pct.id, fixed.id], customPrice: false });
    const custom = (await grant(g.studentId, 'custom_price', 15000))!;
    await grant(g.studentId, 'discount_percent', 10);
    const [cl] = await reserve(g.studentId, session, [{ offerItemId: taughtWhole, attempt: 'first', mode: 'in_school', teacherId }]);
    // The custom price first (all of it the course part), then 10% off.
    expect(await priceOf(cl!.id)).toMatchObject({ course: 13500, board: 0, price: 13500 });
    expect((await priceOf(cl!.id)).basis).toMatchObject({ customPrice: true });
    expect(((await priceOf(cl!.id)).basis.exceptionIds as string[])[0]).toBe(custom.id);
  });

  it('a provisional board fee: the line is reserved but not payable at the checkout or the desk; confirmed at the same amount it is payable, and its due date moves to the confirmation plus the grace', async () => {
    const f = await onboard(officer, `p08-prov-${RUN}`, 11);
    const [line] = await reserve(f.studentId, session, [{ offerItemId: provItem, attempt: 'first', mode: 'in_school', teacherId }]);
    expect(await priceOf(line!.id)).toMatchObject({ price: 10000, provisional: true });
    const { PROVISIONAL_REFUSAL } = await import('../src/services/pricing.services');
    const checkout = await refused(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [line!.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
    expect(checkout.error).toBe(PROVISIONAL_REFUSAL);
    const desk = await refused(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, registrationIds: [line!.id], instrumentUsed: 'cash', escrowAmountToApply: 0 } }));
    expect(desk.error).toBe(PROVISIONAL_REFUSAL);
    expect(await sql(`select 1 from payment_registration where registration_id = $1`, [line!.id])).toEqual([]);

    const feeId = (await one<{ id: string }>(`select id from board_fee where board_series_id = $1 and key_id = $2`, [seriesProv, provSubject])).id;
    const dueBefore = new Date((await one<{ d: string }>(`select due_at as d from registration where id = $1`, [line!.id])).d).getTime();
    const confirmedAt = Date.now();
    const r = await apiResponse(finadmin.api.v1['board-fees'][':seriesId'].confirm.$post({ param: { seriesId: seriesProv }, json: { rows: [{ feeId }], reason: 'the board published its fees' } }));
    expect(r).toMatchObject({ confirmed: 1, differing: 0, linesNoLongerProvisional: 1, dueDatesMoved: 1 });
    expect(await priceOf(line!.id)).toMatchObject({ price: 10000, provisional: false });
    const { getSetting } = await import('../src/services/settings.services');
    const grace = await getSetting('payment.graceDays');
    const dueAfter = new Date((await one<{ d: string }>(`select due_at as d from registration where id = $1`, [line!.id])).d).getTime();
    expect(dueAfter).toBeGreaterThan(dueBefore);
    expect(Math.abs(dueAfter - (confirmedAt + days(grace)))).toBeLessThan(10_000);
    await audited([line!.id], ['LINE_DUE_MOVED']);
    // Now payable.
    const pay = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [line!.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
    expect(money((await one<{ amount: string }>(`select amount from payment where id = $1`, [pay!.id!])).amount)).toBe(10000);
  });

  it('confirmed higher: the lines with no payment history are re-priced on the board part with the exceptions they recorded; a line with a payment, open, failed or paid, is listed and untouched; audited and told', async () => {
    const sub = await subject(adm, `RWP-H-${RUN}`, `Re-priced (08p ${RUN})`, { course: 1000, registration: 9000 });
    const s = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `p08-hi-${RUN}`, entryDeadline: new Date(Date.now() + days(50)) } })))!.id;
    await fee(s, [{ keyKind: 'subject', keyId: sub, amount: 9000, provisional: true }]);
    const item = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: session }, json: { subjectId: sub, courseFee: 1000, teachers: [{ teacherId, mode: 'in_school' }], items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: s, availability: 'open', requiredInSeries: false }] },
    })))!.items[0]!;
    const fam = async (tag: string) => onboard(officer, `p08-hi-${tag}-${RUN}`, 11);
    const [plain, discounted, open, failed, paid] = [await fam('plain'), await fam('disc'), await fam('open'), await fam('failed'), await fam('paid')];
    // The discounted family's 10% is recorded on its line, then revoked: the re-price applies what was recorded.
    const pct = (await apiResponse(finadmin.api.v1.exceptions.$post({ json: { type: 'discount_percent', studentId: discounted.studentId, sessionId: session, value: 10, reason: '08p: a recorded discount' } })))!;
    const lineOf = async (f: { studentId: string }) => (await reserve(f.studentId, session, [{ offerItemId: item, attempt: 'first', mode: 'in_school', teacherId }]))[0]!.id;
    const lPlain = await lineOf(plain);
    const lDisc = await lineOf(discounted);
    const [lOpen, lFailed, lPaid] = [await lineOf(open), await lineOf(failed), await lineOf(paid)];
    await apiResponse(finadmin.api.v1.exceptions[':id'].revoke.$post({ param: { id: pct.id } }));
    // Three of them paid on the provisional fee while the setting allowed it.
    const allow = (value: boolean) => apiResponse(finadmin.api.v1.settings[':key'].$put({ param: { key: 'pricing.payOnProvisionalFee' }, json: { value, reason: '08p: lines with a payment history' } }));
    await allow(true);
    try {
      const initiate = (f: { parent: Client }, id: string) => apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [id], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
      await initiate(open, lOpen);
      const fp = (await initiate(failed, lFailed))!.id!;
      await apiResponse(failed.parent.api.v1.payments[':id'].cancel.$post({ param: { id: fp } }));
      const pp = (await initiate(paid, lPaid))!.id!;
      await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pp }, json: { instrumentUsed: 'cash' } }));
    } finally {
      await allow(false);
    }
    expect(await priceOf(lDisc)).toMatchObject({ course: 900, board: 8100, price: 9000 });

    // The board publishes 9,500: confirmed higher. The lines stay provisional until re-priced.
    const feeId = (await one<{ id: string }>(`select id from board_fee where board_series_id = $1 and key_id = $2`, [s, sub])).id;
    const c = await apiResponse(finadmin.api.v1['board-fees'][':seriesId'].confirm.$post({ param: { seriesId: s }, json: { rows: [{ feeId, amount: 9500 }], reason: 'published higher' } }));
    expect(c).toMatchObject({ confirmed: 1, differing: 1, linesNoLongerProvisional: 0 });
    expect((await priceOf(lPlain)).provisional).toBe(true);
    const r = await apiResponse(finadmin.api.v1['board-fees'][':seriesId'].reprice.$post({ param: { seriesId: s }, json: { feeIds: [feeId], reason: 'the board confirmed 9,500' } }));
    expect(r!.repriced.map((x) => x.id).sort()).toEqual([lPlain, lDisc].sort());
    expect(r!.listed.map((x) => [x.id, x.reason]).sort()).toEqual([
      [lOpen, 'has a payment (open, failed or paid)'], [lFailed, 'has a payment (open, failed or paid)'], [lPaid, 'has a payment (open, failed or paid)'],
    ].sort());
    expect(r!.totalDifference).toBe(950);
    expect(await priceOf(lPlain)).toMatchObject({ course: 1000, board: 9500, price: 10500, provisional: false });
    // The revoked discount still applies: it is what the line was priced with.
    expect(await priceOf(lDisc)).toMatchObject({ course: 900, board: 8550, price: 9450, provisional: false });
    for (const l of [lOpen, lFailed, lPaid]) expect(await priceOf(l)).toMatchObject({ price: 10000, board: 9000 });
    await audited([lPlain], ['LINE_REPRICED']);
    // A listed line kept its price and lost its provisional mark, recorded per line.
    for (const l of [lOpen, lFailed, lPaid]) await audited([l], ['LINE_PRICE_KEPT']);
    await audited([s], ['BOARD_FEES_CONFIRMED', 'BOARD_FEES_REPRICED']);
    // The family is told the old and the new price.
    const email = (await one<{ email: string }>(`select email from "user" where id = $1`, [plain.studentId])).email;
    const [told] = await notified(email, 'PRICE_CHANGED', 1);
    expect(told!.body).toMatch(/was 10000\.00 EGP and is now 10500\.00 EGP/);
  });
});
