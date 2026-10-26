import { describe, it, expect, beforeAll, vi } from 'vitest';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import { admin, staff, onboard, refused, one, sql, audited, money, notified, confirmed, boardDate, CONSENT, type Client, type Impact } from './helpers';

/**
 * 08p — what a line costs, on pricing v2 (COORDINATOR_REWORK.md §6, E1–E7, §9.2; rewritten for P1a from
 * the fee-grid pricing of RESERVATIONS_REWORK.md §3.4):
 *
 *   price = the row's exam fee × 100%
 *         + the course fee (the row's, else the subject's) × 100% in school, × the session's self-study
 *           share in self study (the row's own self-study fee in its place, E4) × the one-paper share
 *   then the price exceptions in today's order (custom, percent, fixed); the pricing.* percent exceptions
 *   still replace their part while the registry grants them (P1b removes the keys); no setting is read.
 *
 * - A-16 on v2: self study is the course fee × 50% plus the exam fee in full, on a taught subject's retake
 *   and on a first entry in self study; in school 100%, a first entry and a retake alike; the basis says so.
 * - Decision 1 (16 Oct 2026) on rows: self study is a second entry only on a "Retake (Self Study ONLY)" row,
 *   a unit or an A.S. in self study; the A.2. carrying the A.S. forward takes its first entry in self study;
 *   the student's exception lets one through and is used.
 * - A one-paper retake at its own course fee and its own exam fee, one choice with all papers.
 * - The session's share, not the setting; a row's own self-study fee in place of the share.
 * - The pricing.* exceptions, and the price exceptions in today's order, recorded on the line.
 * - Prices not final (E6): reserved, not payable at the checkout or the desk; switched final, the counts
 *   first, then payable, due at the switch plus the grace.
 * - A row's exam fee raised after reservations (E7): the counts first; lines with no payment history
 *   re-priced with the exceptions they recorded; a line with a payment (open, failed, paid) listed for
 *   finance and left as it is; audited and told.
 *
 * Retired with the fee grid (its routes are deprecated; P1b removes them): a provisional fee row confirmed
 * at its amount, a grid copied then pasted, the Fees tab's stuck lines — prices final (here and 08y) and
 * price lists (08za) replace them. Lines are reserved through the API, as families and the desk reserve.
 */

const RUN = Math.random().toString(36).slice(2, 6);
const Y = academicYearStartOf() + 1;
const day = 86_400_000;
const cells = (first: boolean, retakeInSchool: boolean, retakeSelfStudy: boolean, firstSelfStudy = false) => ({ firstInSchool: first, retakeInSchool, retakeSelfStudy, firstSelfStudy });
type LineIn = { offerItemId: string; attempt: 'first' | 'retake'; mode: 'in_school' | 'self_study'; teacherId?: string; priorSittingSeriesId?: string };

const priceOf = async (id: string) => {
  const r = await one<{ price: string; course: string; board: string; provisional: boolean; basis: Record<string, unknown> }>(
    `select price_at_registration as price, course_fee_at_registration as course, registration_fee_at_registration as board, price_provisional as provisional, pricing_basis as basis
     from registration where id = $1`, [id]);
  return { price: money(r.price), course: money(r.course), board: money(r.board), provisional: r.provisional, basis: r.basis };
};

describe('08p: pricing policies on pricing v2', () => {
  let adm: Client, coordinator: Client, finadmin: Client, officer: Client;
  let teacherId: string;
  let session: string, priorJune: string;
  let taughtAll: string, taughtPaper: string, untaught: string;

  type Body = Parameters<Client['api']['v1']['sessions'][':id']['offerings'][':offeringId']['$put']>[0]['json'];
  /** A subject set up as the coordinator sets it up: added (here, not on the reference list), then its form saved. */
  const subjectWith = async (name: string, body: Body) => {
    const made = await apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: session }, json: { custom: { board: 'cambridge', name: `${name} (08p ${RUN})`, level: 'igcse', group: 'O.L.' } } }));
    const saved = await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: session, offeringId: made.id }, json: body }));
    expect(saved.saved).toBe(true);
    return saved.offering;
  };
  const reserve = async (f: { parent: Client; studentId: string }, lines: LineIn[]) =>
    apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: session, studentId: f.studentId, lines, consent: CONSENT } }));
  /** The student's exception "self-study on a first entry" (finance's grant): the only way to a first entry on a self-study-only row (decision 1). */
  const firstInSelfStudy = (studentId: string) =>
    apiResponse(finadmin.api.v1.exceptions.$post({ json: { policyKey: 'gate.selfStudyFirstEntry', studentId, reason: '08p: a first entry in self-study on a self-study-only row' } }));
  const familyOptions = async (f: { parent: Client; studentId: string }, rowId: string) =>
    (await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: session, studentId: f.studentId } }))).offerings
      .flatMap((o) => o.rows).find((r) => r.id === rowId)?.options.map((o) => `${o.attempt} ${o.mode} ${o.price?.total}`) ?? [];

  beforeAll(async () => {
    adm = await admin(`p08-${RUN}`);
    coordinator = await staff(adm, 'coordinator', `p08-${RUN}`);
    finadmin = await staff(adm, 'finance_admin', `p08-${RUN}`);
    officer = await staff(adm, 'finance_officer', `p08-${RUN}`);
    teacherId = (await apiResponse(coordinator.api.v1.teachers.$post({ json: { name: `Nadia Fouad ${RUN}`, kind: 'person', confirmed: true } })))!.id;
    session = (await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'june', year: Y, label: `p08-${RUN}` } }))).id;
    await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: session }, json: { paymentDueAt: new Date(Date.now() + 2 * day), closesAt: new Date(Date.now() + 60 * day) } }));

    // Taught: all papers (course 14,000, exam 9,200) and a one-paper retake at its own course fee and exam fee.
    const taught = await subjectWith('Taught', {
      courseFee: 14000, teachers: [{ teacherId, online: false, external: false }],
      rows: [
        { kind: 'all_papers', referenceCodes: [`P08T-${RUN}`], examFee: 9200, cells: cells(true, true, true) },
        { kind: 'paper', name: 'Paper 4 only', referenceCodes: [`P08T-${RUN}/4`], courseFee: 3000, examFee: 5000, cells: cells(false, true, true) },
      ],
    });
    [taughtAll, taughtPaper] = [taught.rows[0]!.id, taught.rows[1]!.id];
    // Not taught this cycle: "Retake (Self Study ONLY)".
    untaught = (await subjectWith('Untaught', {
      courseFee: 14000, teachers: [], rows: [{ kind: 'all_papers', referenceCodes: [`P08U-${RUN}`], examFee: 9200, cells: cells(false, false, true) }],
    })).rows[0]!.id;
    // The session opens once its sitting has its board date (C6).
    const s = await apiResponse(coordinator.api.v1.sessions[':id'].$get({ param: { id: session } }));
    for (const c of s.checkList.filter((x) => x.code === 'sitting_no_board_date')) {
      await boardDate(adm, c.seriesId!, { examsStart: `${Y}-06-01`, entryDeadline: new Date(Date.now() + 50 * day) });
    }
    await apiResponse(coordinator.api.v1.sessions[':id'].open.$post({ param: { id: session } }));
    // The A.2.'s and the retakes' earlier sitting: June Y − 1, one of the board's two before (D6).
    priorJune = (await one<{ id: string }>(`select id from board_series where board_code = 'cambridge' and month = 'june' and year = $1 and label = ''`, [Y - 1])).id;
  });

  it("A-16: self study is the course fee × the session's 50% plus the exam fee in full — on a taught subject's retake and on a first entry in self study; in school 100%, a first entry and a retake alike; the basis says so", async () => {
    const [a, b, c, d] = [await onboard(officer, `p08-a-${RUN}`, 11), await onboard(officer, `p08-b-${RUN}`, 11), await onboard(officer, `p08-c-${RUN}`, 11), await onboard(officer, `p08-d-${RUN}`, 11)];
    const retake = { attempt: 'retake' as const, priorSittingSeriesId: priorJune };
    const [first] = await reserve(a, [{ offerItemId: taughtAll, attempt: 'first', mode: 'in_school', teacherId }]);
    const [inSchoolRetake] = await reserve(b, [{ offerItemId: taughtAll, mode: 'in_school', teacherId, ...retake }]);
    const [selfRetake] = await reserve(c, [{ offerItemId: taughtAll, mode: 'self_study', ...retake }]);
    await firstInSelfStudy(d.studentId);
    const [selfFirst] = await reserve(d, [{ offerItemId: untaught, attempt: 'first', mode: 'self_study' }]);
    expect(await priceOf(first!.id)).toMatchObject({ course: 14000, board: 9200, price: 23200 });
    expect(await priceOf(inSchoolRetake!.id)).toMatchObject({ course: 14000, board: 9200, price: 23200 });
    expect(await priceOf(selfRetake!.id)).toMatchObject({ course: 7000, board: 9200, price: 16200 });
    expect(await priceOf(selfFirst!.id)).toMatchObject({ course: 7000, board: 9200, price: 16200 });
    // Not "50% of the total" (11,600): the exam fee is paid in full.
    expect((await priceOf(selfFirst!.id)).basis).toMatchObject({
      v: 2, rowId: untaught, attempt: 'first', mode: 'self_study', examFee: 9200, examFeeSource: 'typed', courseFeeBase: 14000,
      selfStudyShare: 50, selfStudyFee: null, coursePercent: 50, boardPercent: 100, total: 16200,
    });
    // Prices not final yet (E6): every line provisional.
    expect((await priceOf(first!.id)).provisional).toBe(true);
  });

  it('decision 1 (16 Oct 2026): self study is a second entry only — a first entry in self study is refused on a "Retake (Self Study ONLY)" row (the family\'s reservation and the desk alike), on a unit and on an A.S. in self study, but taken on the A.2. carrying the A.S. forward; the family page offers the same; the student\'s exception lets one through and is used', async () => {
    const f = await onboard(officer, `p08-d1-${RUN}`, 11);
    const g = await onboard(officer, `p08-d1g-${RUN}`, 11);
    const first = { offerItemId: untaught, attempt: 'first' as const, mode: 'self_study' as const };
    // The family page: the retake in self study, no first entry (its cell is not ticked).
    expect(await familyOptions(f, untaught)).toEqual(['retake self_study 16200']);
    const refusal = `Untaught (08p ${RUN}) is self study on a second entry only: name the earlier sitting, or ask for the exception`;
    expect(await refused(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: session, studentId: f.studentId, lines: [first], consent: CONSENT } }))).toEqual({ status: 400, error: refusal });
    expect(await refused(officer.api.v1.registrations.desk.$post({ json: { sessionId: session, studentId: f.studentId, lines: [first], consent: CONSENT } }))).toEqual({ status: 400, error: refusal });
    expect(await sql(`select id from registration where student_id = $1`, [f.studentId])).toEqual([]);
    // A retake in self study naming its sitting: taken, at the share.
    const [retake] = await reserve(f, [{ offerItemId: untaught, mode: 'self_study', attempt: 'retake', priorSittingSeriesId: priorJune }]);
    expect(await priceOf(retake!.id)).toMatchObject({ course: 7000, board: 9200, price: 16200 });
    // The exception (finance's grant) is the only way: it lets one through and is used by it.
    const gate = await firstInSelfStudy(g.studentId);
    const [line] = await reserve(g, [first]);
    expect(await priceOf(line!.id)).toMatchObject({ course: 7000, board: 9200, price: 16200, basis: { attempt: 'first', mode: 'self_study' } });
    expect(await one(`select status, used_for as used from exception where id = $1`, [gate.id])).toEqual({ status: 'used', used: { registrationIds: [line!.id] } });

    // A taught subject's unit and A.S. in self study take no first entry in self study; the A.2. carrying the A.S.
    // forward (the Physics form's "A.2. (Self Study 50% fees …)", its own entry after the A.S.) does.
    const mixed = await subjectWith('Mixed', {
      courseFee: 6000, teachers: [{ teacherId, online: false, external: false }],
      rows: [
        { kind: 'unit', name: 'Unit 1', referenceCodes: [`P08M-${RUN}/U1`], examFee: 3000, cells: cells(false, false, true) },
        { kind: 'as', referenceCodes: [`P08M-${RUN}`], examFee: 3000, cells: cells(false, false, true) },
        { kind: 'a2', referenceCodes: [`P08M-${RUN}`], examFee: 3000, cells: cells(false, false, true, true), allowedPriorSittings: [{ month: 'june', year: Y - 1 }] },
      ],
    });
    const [unitRow, asRow, a2Row] = mixed.rows;
    const h = await onboard(officer, `p08-d1h-${RUN}`, 11);
    expect([await familyOptions(h, unitRow!.id), await familyOptions(h, asRow!.id), await familyOptions(h, a2Row!.id)])
      .toEqual([['retake self_study 6000'], ['retake self_study 6000'], ['retake self_study 6000', 'first self_study 6000']]);
    for (const r of [unitRow!, asRow!]) {
      expect(await refused(h.parent.api.v1.registrations.direct.$post({ json: { sessionId: session, studentId: h.studentId, lines: [{ offerItemId: r.id, attempt: 'first', mode: 'self_study' }], consent: CONSENT } })))
        .toEqual({ status: 400, error: expect.stringMatching(/^Mixed \(08p .+\) — .+ is self study on a second entry only: name the earlier sitting, or ask for the exception$/) });
    }
    const [carried] = await reserve(h, [{ offerItemId: a2Row!.id, attempt: 'first', mode: 'self_study', priorSittingSeriesId: priorJune }]);
    expect(await priceOf(carried!.id)).toMatchObject({ course: 3000, board: 3000, price: 6000, basis: { attempt: 'first', mode: 'self_study', coursePercent: 50, itemKind: 'a2' } });
  });

  it("decision 1's exception reaches today's reads (the Reserve page and the desk, which P3 replaces; the review of dd68598, item 2): once granted, they offer the first entry in self study, priced for the student; the desk's reservation of it is made and uses it; nobody else's read offers it", async () => {
    const f = await onboard(officer, `p08-d1x-${RUN}`, 11);
    const other = await onboard(officer, `p08-d1y-${RUN}`, 11);
    const offered = async (who: Client, studentId: string, rowId: string) =>
      (await apiResponse(who.api.v1.registrations.offers.$get({ query: { sessionId: session, studentId } }))).offers.flatMap((o) => o.items)
        .find((i) => i.id === rowId)!.prices.map((p) => `${p.attempt} ${p.mode} ${p.total}`);
    expect(await offered(f.parent, f.studentId, untaught)).toEqual(['retake self_study 16200']);
    const gate = await firstInSelfStudy(f.studentId);
    for (const who of [f.parent, officer]) expect(await offered(who, f.studentId, untaught)).toEqual(['first self_study 16200', 'retake self_study 16200']);
    expect(await offered(other.parent, other.studentId, untaught)).toEqual(['retake self_study 16200']);
    const made = await apiResponse(officer.api.v1.registrations.desk.$post({
      json: { sessionId: session, studentId: f.studentId, lines: [{ offerItemId: untaught, attempt: 'first', mode: 'self_study' }], consent: CONSENT },
    }));
    const line = made.registrations[0]!;
    expect(await priceOf(line.id)).toMatchObject({ course: 7000, board: 9200, price: 16200, basis: { v: 2, attempt: 'first', mode: 'self_study' } });
    expect(await one(`select status, used_for as used from exception where id = $1`, [gate.id])).toEqual({ status: 'used', used: { registrationIds: [line.id] } });
    // Used once: the read offers it no more.
    expect(await offered(f.parent, f.studentId, untaught)).toEqual(['retake self_study 16200']);
  });

  it("a one-paper retake costs its own course fee and its own exam fee; it is refused with all papers (one choice, D8), and as a first entry", async () => {
    const f = await onboard(officer, `p08-one-${RUN}`, 11);
    const retake = { attempt: 'retake' as const, priorSittingSeriesId: priorJune };
    expect((await refused(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: session, studentId: f.studentId, lines: [{ offerItemId: taughtPaper, attempt: 'first', mode: 'in_school', teacherId }], consent: CONSENT } }))).error)
      .toMatch(/takes retakes only|takes no first entry/);
    expect((await refused(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: session, studentId: f.studentId, consent: CONSENT, lines: [
      { offerItemId: taughtAll, mode: 'in_school', teacherId, ...retake }, { offerItemId: taughtPaper, mode: 'in_school', teacherId, ...retake },
    ] } }))).error).toMatch(/cannot be reserved together/);
    const [line] = await reserve(f, [{ offerItemId: taughtPaper, mode: 'in_school', teacherId, ...retake }]);
    expect(await priceOf(line!.id)).toMatchObject({ course: 3000, board: 5000, price: 8000 });
    expect((await priceOf(line!.id)).basis).toMatchObject({ v: 2, itemKind: 'paper', examFee: 5000, courseFeeBase: 3000, onePaperPercent: 100 });
  });

  it("the session's share prices self study, not the setting; a row's own self-study fee (E4) replaces the share", async () => {
    const [x, y] = [await onboard(officer, `p08-set-a-${RUN}`, 11), await onboard(officer, `p08-set-b-${RUN}`, 11)];
    const setPercent = (value: number) => apiResponse(finadmin.api.v1.settings[':key'].$put({ param: { key: 'pricing.selfStudyCoursePercent' }, json: { value, reason: '08p: a policy change' } }));
    await setPercent(40);
    try {
      const [l] = await reserve(x, [{ offerItemId: taughtAll, attempt: 'retake', mode: 'self_study', priorSittingSeriesId: priorJune }]);
      expect(await priceOf(l!.id)).toMatchObject({ course: 7000, board: 9200, price: 16200, basis: { selfStudyShare: 50, coursePercent: 50 } });
    } finally {
      await setPercent(50);
    }
    // A row charging its own self-study amount: 5,000 in place of 50% of 14,000; the family reads "self study", no percentage.
    const own = await subjectWith('Own self-study fee', {
      courseFee: 14000, teachers: [{ teacherId, online: false, external: false }],
      rows: [{ kind: 'all_papers', referenceCodes: [`P08S-${RUN}`], examFee: 9200, selfStudyFee: 5000, cells: cells(true, true, true) }],
    });
    const row = own.rows[0]!.id;
    const read = (await apiResponse(y.parent.api.v1.registrations.offers.$get({ query: { sessionId: session, studentId: y.studentId } }))).offerings.flatMap((o) => o.rows).find((r) => r.id === row)!;
    expect(read.options.map((o) => [o.label.en, o.price?.total])).toEqual([
      ['First entry · in school · all papers', 23200], ['Retake · in school · all papers', 23200], ['Retake · self study · all papers', 14200],
    ]);
    const [l] = await reserve(y, [{ offerItemId: row, attempt: 'retake', mode: 'self_study', priorSittingSeriesId: priorJune }]);
    expect(await priceOf(l!.id)).toMatchObject({ course: 5000, board: 9200, price: 14200, basis: { selfStudyFee: 5000, coursePercent: 100, courseFeeBase: 5000 } });
  });

  it("a pricing.* exception replaces its part's percent on the lines it applies to, and is recorded in the basis; one that does not apply is not", async () => {
    // The registry answers the adapter with the exceptions covering the line; here it is answered as the
    // registry would answer it (priceLine is what asks).
    const { lineExceptions } = await import('../src/services/line-exceptions');
    const self = await onboard(officer, `p08-pct-s-${RUN}`, 11);
    const retaker = await onboard(officer, `p08-pct-r-${RUN}`, 11);
    const none = await onboard(officer, `p08-pct-n-${RUN}`, 11);
    await firstInSelfStudy(self.studentId);
    await firstInSelfStudy(none.studentId);
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
    try {
      const [s] = await reserve(self, [{ offerItemId: untaught, attempt: 'first', mode: 'self_study' }]);
      // 30% of the course fee (14,000) and 50% of the exam fee (9,200), in place of the share and 100%.
      expect(await priceOf(s!.id)).toMatchObject({ course: 4200, board: 4600, price: 8800 });
      expect((await priceOf(s!.id)).basis).toMatchObject({
        v: 2, coursePercent: 30, boardPercent: 50, exceptionIds: [`test-pricing.selfStudyCoursePercent-${self.studentId}`, `test-pricing.selfStudyBoardPercent-${self.studentId}`],
      });
      // A retake in school at 60%; the one-paper percent does not apply to all papers: not recorded.
      const [r] = await reserve(retaker, [{ offerItemId: taughtAll, attempt: 'retake', mode: 'in_school', teacherId, priorSittingSeriesId: priorJune }]);
      expect(await priceOf(r!.id)).toMatchObject({ course: 8400, board: 9200, price: 17600 });
      expect((await priceOf(r!.id)).basis).toMatchObject({ coursePercent: 60, onePaperPercent: 100, exceptionIds: [`test-pricing.retakeTaughtCoursePercent-${retaker.studentId}`] });
      // A student who holds none pays the session's share.
      const [n] = await reserve(none, [{ offerItemId: untaught, attempt: 'first', mode: 'self_study' }]);
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
    const [line] = await reserve(f, [{ offerItemId: taughtAll, attempt: 'first', mode: 'in_school', teacherId }]);
    // 10% off each part (12,600 + 8,280), then 500 off the course part.
    expect(await priceOf(line!.id)).toMatchObject({ course: 12100, board: 8280, price: 20380 });
    expect((await priceOf(line!.id)).basis).toMatchObject({ v: 2, exceptionIds: [pct.id, fixed.id], customPrice: false });
    const custom = (await grant(g.studentId, 'custom_price', 15000))!;
    await grant(g.studentId, 'discount_percent', 10);
    const [cl] = await reserve(g, [{ offerItemId: taughtAll, attempt: 'first', mode: 'in_school', teacherId }]);
    // The custom price first (all of it the course part), then 10% off.
    expect(await priceOf(cl!.id)).toMatchObject({ course: 13500, board: 0, price: 13500 });
    expect((await priceOf(cl!.id)).basis).toMatchObject({ customPrice: true });
    expect(((await priceOf(cl!.id)).basis.exceptionIds as string[])[0]).toBe(custom.id);
  });

  it('prices not final (E6): a line is reserved but not payable at the checkout or the desk; switched final, the counts first, then it is payable, due at the switch plus the grace', async () => {
    const f = await onboard(officer, `p08-prov-${RUN}`, 11);
    const [line] = await reserve(f, [{ offerItemId: taughtAll, attempt: 'first', mode: 'in_school', teacherId }]);
    expect(await priceOf(line!.id)).toMatchObject({ price: 23200, provisional: true });
    const { PROVISIONAL_REFUSAL } = await import('../src/services/pricing.services');
    expect((await refused(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [line!.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } }))).error).toBe(PROVISIONAL_REFUSAL);
    expect((await refused(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, registrationIds: [line!.id], instrumentUsed: 'cash', escrowAmountToApply: 0 } }))).error).toBe(PROVISIONAL_REFUSAL);
    expect(await sql(`select 1 from payment_registration where registration_id = $1`, [line!.id])).toEqual([]);

    const waiting = Number((await one<{ n: string }>(`select count(*) as n from registration where session_id = $1 and status = 'pending_payment'`, [session])).n);
    const dueBefore = new Date((await one<{ d: string }>(`select due_at as d from registration where id = $1`, [line!.id])).d).getTime();
    const switchedAt = Date.now();
    const { shown, saved } = await confirmed((expected?: Impact) => apiResponse(coordinator.api.v1.sessions[':id']['prices-final'].$put({ param: { id: session }, json: { final: true, ...(expected ? { expected } : {}) } })));
    expect(shown).toMatchObject({ saved: false, impact: { repriced: 0, listedForFinance: 0, linesAffected: waiting } });
    expect(saved).toMatchObject({ saved: true, pricesFinal: true });
    expect(await priceOf(line!.id)).toMatchObject({ price: 23200, provisional: false });
    const { getSetting } = await import('../src/services/settings.services');
    const grace = await getSetting('payment.graceDays');
    const dueAfter = new Date((await one<{ d: string }>(`select due_at as d from registration where id = $1`, [line!.id])).d).getTime();
    expect(dueAfter).toBeGreaterThan(dueBefore);
    expect(Math.abs(dueAfter - (switchedAt + grace * day))).toBeLessThan(10_000);
    await audited([line!.id], ['LINE_DUE_MOVED']);
    const pay = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [line!.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
    expect(money((await one<{ amount: string }>(`select amount from payment where id = $1`, [pay!.id!])).amount)).toBe(23200);
  });

  it("a row's exam fee raised after reservations (E7): the counts first; the lines with no payment history re-priced with the exceptions they recorded; a line with a payment, open, failed or paid, listed for finance and left as it is; audited and told", async () => {
    const sub = await subjectWith('Re-priced', {
      courseFee: 1000, teachers: [{ teacherId, online: false, external: false }],
      rows: [{ kind: 'all_papers', referenceCodes: [`P08H-${RUN}`], examFee: 9000, cells: cells(true, true, true) }],
    });
    const row = sub.rows[0]!.id;
    const fam = async (tag: string) => onboard(officer, `p08-hi-${tag}-${RUN}`, 11);
    const [plain, discounted, open, failed, paid] = [await fam('plain'), await fam('disc'), await fam('open'), await fam('failed'), await fam('paid')];
    // The discounted family's 10% is recorded on its line, then revoked: the re-price applies what was recorded.
    const pct = (await apiResponse(finadmin.api.v1.exceptions.$post({ json: { type: 'discount_percent', studentId: discounted.studentId, sessionId: session, value: 10, reason: '08p: a recorded discount' } })))!;
    const lineOf = async (f: { parent: Client; studentId: string }) => (await reserve(f, [{ offerItemId: row, attempt: 'first', mode: 'in_school', teacherId }]))[0]!.id;
    const [lPlain, lDisc, lOpen, lFailed, lPaid] = [await lineOf(plain), await lineOf(discounted), await lineOf(open), await lineOf(failed), await lineOf(paid)];
    await apiResponse(finadmin.api.v1.exceptions[':id'].revoke.$post({ param: { id: pct.id } }));
    expect(await priceOf(lDisc)).toMatchObject({ course: 900, board: 8100, price: 9000 });
    // Three of them with a payment history (the prices are final: payable).
    const initiate = (f: { parent: Client }, id: string) => apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [id], paymentMethod: 'in_school', escrowAmountToApply: 0 } }));
    await initiate(open, lOpen);
    const fp = (await initiate(failed, lFailed))!.id!;
    await apiResponse(failed.parent.api.v1.payments[':id'].cancel.$post({ param: { id: fp } }));
    const pp = (await initiate(paid, lPaid))!.id!;
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pp }, json: { instrumentUsed: 'cash' } }));

    // The board publishes 9,500: the row's exam fee raised. The counts first, nothing changed until they are sent back.
    const send = (expected?: Impact) => apiResponse(coordinator.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: session, rowId: row }, json: { amount: 9500, ...(expected ? { expected } : {}) } }));
    const { shown, saved } = await confirmed(send);
    expect(shown).toMatchObject({ saved: false, impact: { repriced: 2, listedForFinance: 3 } });
    expect(saved).toMatchObject({ saved: true, examFee: 9500, examFeeSource: 'typed' });
    expect(await priceOf(lPlain)).toMatchObject({ course: 1000, board: 9500, price: 10500, provisional: false, basis: { v: 2, examFee: 9500 } });
    // The revoked discount still applies: it is what the line was priced with.
    expect(await priceOf(lDisc)).toMatchObject({ course: 900, board: 8550, price: 9450 });
    for (const l of [lOpen, lFailed, lPaid]) expect(await priceOf(l)).toMatchObject({ price: 10000, board: 9000 });
    await audited([lPlain], ['LINE_REPRICED']);
    const batch = await one<{ listed: { id: string; reason: string }[] }>(`select new_data->'listedForFinance' as listed from audit_log where action = 'ROWS_REPRICED' and entity_id = $1`, [row]);
    expect(batch.listed.map((l) => [l.id, l.reason]).sort()).toEqual([lOpen, lFailed, lPaid].map((id) => [id, 'has a payment (open, failed or paid)']).sort());
    // The family is told the old and the new price.
    const email = (await one<{ email: string }>(`select email from "user" where id = $1`, [plain.studentId])).email;
    const [told] = await notified(email, 'PRICE_CHANGED', 1);
    expect(told!.body).toMatch(/was EGP 10,000 and is now EGP 10,500/);
  });
});
