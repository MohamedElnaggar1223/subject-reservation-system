import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import {
  admin, staff, onboard, refused, one, sql, confirmed, boardDate, lockWaiters, pauseAtAudit, CONSENT, type Client, type Impact,
} from './helpers';
import { referenceFixture } from './reference-fixture';

/**
 * 08za — prices as the coordinator sets them (COORDINATOR_REWORK.md E1–E7; Appendix A price lists,
 * prices, a row's exam fee): a board's fee list pasted as printed — each line read for its printed
 * code with P0's matcher (option pairs, an old code through the board's alias), matched to the
 * reference row and the session's row — applied, the fees that follow others filled (the board rule
 * for a one-paper retake, the sum of units), the missing-prices list and its fills, a list that
 * re-prices reservations (the counts first, unpaid re-priced, paid listed), and its races with a
 * reservation in both orders (§9.2's locks: the session, the offering and the row; IMPACT_CHANGED).
 * Money is read back from the database.
 */

const RUN = Math.random().toString(36).slice(2, 6);
const Y = academicYearStartOf() + 1;
const day = 86_400_000;

const CAMBRIDGE = `Cambridge Registration Fees - June ${Y - 1} (Year 11 & 12)
0970 CX   IGCSE BIOLOGY   10,850
9618 S1 / S2   AS Level COMPUTER SCIENCE   11,400
9608 SY   AS Level COMPUTER SCIENCE   11,400
9618 BY / CT   A2 Level COMPUTER SCIENCE   12,450
9618 AY   A Level COMPUTER SCIENCE   16,950
9999 ZZ   SOMETHING ELSE   5,000`;

const EDEXCEL = `Edexcel June ${Y - 1} (Registration Fees)
WAA01   IAL Arabic AL   8,950
WAA02   IAL Arabic AL   9,350
4MA1H   IGCSE MATHEMATICS   4,600
4MA2H   IGCSE MATHEMATICS   4,600`;

describe('08za: price lists', () => {
  let adm: Client, coordinator: Client, officer: Client;
  let june: string;
  const offering: Record<string, string> = {};
  const row: Record<string, string> = {};
  const label = `za08-${RUN}`;

  const parse = (board: 'cambridge' | 'pearson_edexcel', text: string) =>
    apiResponse(coordinator.api.v1.sessions[':id']['price-lists'].parse.$post({ param: { id: june }, json: { board, text } }));
  const apply = (board: 'cambridge' | 'pearson_edexcel', name: string, rows: { lineNo?: number; code: string; name: string; amount: number }[], expected?: Impact) =>
    coordinator.api.v1.sessions[':id']['price-lists'].$post({ param: { id: june }, json: { board, name, rows, ...(expected ? { expected } : {}) } });
  const fees = async () => Object.fromEntries((await sql<{ id: string; fee: number | null; source: string | null }>(
    `select id, exam_fee::float as fee, exam_fee_source as source from session_offer_item where session_id = $1`, [june])).map((r) => [r.id, [r.fee, r.source]]));
  const priceOf = async (id: string) => (await one<{ p: number }>(`select price_at_registration::float as p from registration where id = $1`, [id])).p;
  const addRef = async (code: string, board?: 'cambridge' | 'pearson_edexcel') =>
    apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: june }, json: { referenceCode: code, ...(board ? { board } : {}) } }));
  const tick = (first: boolean) => ({ firstInSchool: first, retakeInSchool: first, retakeSelfStudy: true, firstSelfStudy: false });

  beforeAll(async () => {
    adm = await admin(`za08-${RUN}`);
    coordinator = await staff(adm, 'coordinator', `za08-${RUN}`);
    officer = await staff(adm, 'finance_officer', `za08-${RUN}`);
    const { db, loadReference } = await import('@repo/db');
    await loadReference(db, referenceFixture());
    june = (await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'june', year: Y, label } }))).id;
    await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: june }, json: { paymentDueAt: new Date(Date.now() + 40 * day), courseStartsOn: `${Y - 1}-10-04` } }));
    const teacher = (await apiResponse(coordinator.api.v1.teachers.$post({ json: { name: `Teacher Z ${RUN}`, kind: 'person', confirmed: true } })))!.id;
    const bio = await addRef('0970');
    const cs = await addRef('9618', 'cambridge');
    const maths = await addRef('4MA1');
    const arabic = await addRef('YAA01');
    Object.assign(offering, { bio: bio.id, cs: cs.id, maths: maths.id, arabic: arabic.id });
    const ids = (o: typeof bio) => Object.fromEntries(o.rows.map((r) => [r.referenceKey!, r.id]));
    const [b, c, m, a] = [ids(bio), ids(cs), ids(maths), ids(arabic)];
    Object.assign(row, {
      bioAll: b['all-papers'], bioPaper: b['paper-41-42'], csAs: c.as, csA2: c.a2, csAl: c.al,
      mathsAll: m['all-papers'], maths1h: m['paper-1h'], maths2h: m['paper-2h'], yaa01: a.yaa01, waa01: a.waa01, waa02: a.waa02,
    });
    const teachers = [{ teacherId: teacher, online: false, external: false }];
    await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: june, offeringId: bio.id }, json: { courseFee: 3000, teachers, rows: [
      { id: row.bioAll, kind: 'all_papers', cells: tick(true) }, { id: row.bioPaper, kind: 'paper', cells: tick(false) },
    ] } }));
    await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: june, offeringId: cs.id }, json: { courseFee: 5000, teachers, rows: [
      { id: row.csAs, kind: 'as', cells: tick(true) }, { id: row.csA2, kind: 'a2', cells: tick(true) }, { id: row.csAl, kind: 'al', cells: tick(true) },
    ] } }));
    await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: june, offeringId: maths.id }, json: { courseFee: 2500, teachers, rows: [
      { id: row.mathsAll, kind: 'all_papers', cells: tick(true) }, { id: row.maths1h, kind: 'paper', cells: tick(false) }, { id: row.maths2h, kind: 'paper', cells: tick(false) },
    ] } }));
    // Arabic A.L.'s qualification offered; its units are not offered on their own (they price it).
    await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: june, offeringId: arabic.id }, json: { courseFee: 6000, teachers, rows: [
      { id: row.yaa01, kind: 'qualification', cells: tick(true) },
      { id: row.waa01, kind: 'unit', cells: { firstInSchool: false, retakeInSchool: false, retakeSelfStudy: false, firstSelfStudy: false } },
      { id: row.waa02, kind: 'unit', cells: { firstInSchool: false, retakeInSchool: false, retakeSelfStudy: false, firstSelfStudy: false } },
    ] } }));
  });

  it('a list pasted as printed: each line read for its printed code — an option pair, an old code through the alias — matched to the reference row and the session\'s row; a heading skipped; an unknown code listed; nothing written', async () => {
    const before = await fees();
    const p = await parse('cambridge', CAMBRIDGE);
    expect(p.skipped).toEqual([{ lineNo: 1, text: `Cambridge Registration Fees - June ${Y - 1} (Year 11 & 12)` }]);
    expect(p.rows.map((r) => [r.lineNo, r.code, r.name, r.amount, r.matches.map((m) => [m.matchedKey, m.rowIds])])).toEqual([
      [2, '0970 CX', 'IGCSE BIOLOGY', 10850, [['0970:all-papers', [row.bioAll]]]],
      [3, '9618 S1 / S2', 'AS Level COMPUTER SCIENCE', 11400, [['9618:as', [row.csAs]]]],
      [4, '9608 SY', 'AS Level COMPUTER SCIENCE', 11400, [['9618:as', [row.csAs]]]],
      [5, '9618 BY / CT', 'A2 Level COMPUTER SCIENCE', 12450, [['9618:a2', [row.csA2]]]],
      [6, '9618 AY', 'A Level COMPUTER SCIENCE', 16950, [['9618:al', [row.csAl]]]],
      [7, '9999 ZZ', 'SOMETHING ELSE', 5000, []],
    ]);
    expect(p.unmatched.map((r) => r.code)).toEqual(['9999 ZZ']);
    expect(await fees()).toEqual(before);
    expect(await sql(`select id from price_list where session_id = $1`, [june])).toEqual([]);
  });

  it("applied: the matched rows take its amounts (from the list), the one-paper retake follows its syllabus's fee (the board rule), the list is kept as printed; the same list again changes nothing", async () => {
    const p = await parse('cambridge', CAMBRIDGE);
    const rows = p.rows.map(({ lineNo, code, name, amount }) => ({ lineNo, code, name, amount }));
    const out = await apiResponse(apply('cambridge', `Cambridge June ${Y - 1}`, rows));
    expect(out).toMatchObject({ saved: true, impact: { repriced: 0, listedForFinance: 0 }, matched: 5, unmatched: [{ code: '9999 ZZ', name: 'SOMETHING ELSE', amount: 5000 }] });
    const f = await fees();
    expect([f[row.bioAll!], f[row.bioPaper!], f[row.csAs!], f[row.csA2!], f[row.csAl!]]).toEqual([
      [10850, 'list'], [10850, 'board_rule'], [11400, 'list'], [12450, 'list'], [16950, 'list'],
    ]);
    const list = await one<{ id: string; lines: number }>(`select l.id, (select count(distinct line_no)::int from price_list_row r where r.price_list_id = l.id) as lines from price_list l where session_id = $1 and board_code = 'cambridge'`, [june]);
    expect(list.lines).toBe(6);
    expect(await one(`select r.code, r.amount::float as amount from session_offer_item i join price_list_row r on r.id = i.price_list_row_id where i.id = $1`, [row.bioAll!])).toEqual({ code: '0970 CX', amount: 10850 });
    await apiResponse(apply('cambridge', `Cambridge June ${Y - 1}`, rows));
    expect(await fees()).toEqual(f);
    expect(await sql(`select id from price_list where session_id = $1 and board_code = 'cambridge'`, [june])).toEqual([{ id: list.id }]);
    expect(await sql(`select new_data->>'rowsPriced' as n from audit_log where action = 'PRICE_LIST_APPLIED' and entity_id = $1 order by created_at`, [list.id])).toEqual([{ n: '5' }, { n: '0' }]);
  });

  it("Pearson Edexcel's list: each paper at its own row's fee (the board prices papers), all papers the sum of its papers, the IAL qualification the sum of its units", async () => {
    const p = await parse('pearson_edexcel', EDEXCEL);
    expect(p.unmatched).toEqual([]);
    await apiResponse(apply('pearson_edexcel', `Edexcel June ${Y - 1}`, p.rows.map(({ lineNo, code, name, amount }) => ({ lineNo, code, name, amount }))));
    const f = await fees();
    expect([f[row.maths1h!], f[row.maths2h!], f[row.mathsAll!]]).toEqual([[4600, 'list'], [4600, 'list'], [9200, 'units_sum']]);
    expect([f[row.waa01!], f[row.waa02!], f[row.yaa01!]]).toEqual([[8950, 'list'], [9350, 'list'], [18300, 'units_sum']]);
  });

  it('the missing prices: every ticked row with no fee, with what could fill it; typed, or filled by the board rule or the units\' sum; and what the rules refuse', async () => {
    const gc = await apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: june }, json: { custom: { board: 'cambridge', name: `Global Citizenship ${RUN}`, level: 'igcse', group: 'O.L.' } } }));
    const saved = await apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: june, offeringId: gc.id }, json: {
      courseFee: 2000, teacherTbc: true, rows: [{ kind: 'custom', name: 'Global Citizenship course', cells: tick(true) }],
    } }));
    const custom = saved.offering.rows[0]!.id;
    const prices = await apiResponse(coordinator.api.v1.sessions[':id'].prices.$get({ param: { id: june } }));
    expect(prices.missing.map((m) => [m.rowId, m.subject, m.label, m.fill])).toEqual([[custom, `Global Citizenship ${RUN}`, 'Global Citizenship course', { unitsSum: null, boardRule: null, fromLists: [] }]]);
    expect(prices.courseFeeMissing).toEqual([]);
    expect(prices.lists.map((l) => [l.name, l.lines, l.unmatched.map((u) => u.code)])).toEqual([[`Cambridge June ${Y - 1}`, 6, ['9999 ZZ']], [`Edexcel June ${Y - 1}`, 4, []]]);
    const bio = prices.rows.find((r) => r.rowId === row.bioPaper)!;
    expect(bio).toMatchObject({ examFee: 10850, examFeeSource: 'board_rule', fill: { boardRule: 10850 } });
    expect(prices.rows.find((r) => r.rowId === row.mathsAll)!.fill.unitsSum).toBe(9200);
    // Typed.
    expect(await apiResponse(coordinator.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: june, rowId: custom }, json: { amount: 7500 } })))
      .toMatchObject({ saved: true, examFee: 7500, examFeeSource: 'typed' });
    expect((await apiResponse(coordinator.api.v1.sessions[':id'].prices.$get({ param: { id: june } }))).missing).toEqual([]);
    // A typed fee replaces a summed one; asking for the sum again fills it back.
    await apiResponse(coordinator.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: june, rowId: row.yaa01! }, json: { amount: 18000 } }));
    expect((await fees())[row.yaa01!]).toEqual([18000, 'typed']);
    expect(await apiResponse(coordinator.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: june, rowId: row.yaa01! }, json: { source: 'units_sum' } })))
      .toMatchObject({ saved: true, examFee: 18300, examFeeSource: 'units_sum' });
    // What the rules refuse: a sum on a row made of no units; the board rule where the board prices each paper.
    expect(await refused(coordinator.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: june, rowId: row.csAs! }, json: { source: 'units_sum' } })))
      .toEqual({ status: 400, error: 'A.S. is not made of units on the reference list' });
    expect(await refused(coordinator.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: june, rowId: row.maths1h! }, json: { source: 'board_rule' } })))
      .toEqual({ status: 400, error: "Mathematics's board prices each paper on its own: set the paper's fee from its list" });
  });

  describe('a list that re-prices reservations (E7)', () => {
    let unpaid: string, paid: string, paperLine: string;
    let fam: Awaited<ReturnType<typeof onboard>>;
    const reserve = (f: Awaited<ReturnType<typeof onboard>>, offerItemId: string) =>
      f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: f.studentId, lines: [{ offerItemId, attempt: 'first', mode: 'in_school' }], consent: CONSENT } });

    beforeAll(async () => {
      // C6: the admin gives the scenario's sittings their board dates; prices final; open.
      const s = await apiResponse(coordinator.api.v1.sessions[':id'].$get({ param: { id: june } }));
      for (const c of s.checkList.filter((x) => x.code === 'sitting_no_board_date')) await boardDate(adm, c.seriesId!, { examsStart: `${Y}-06-01`, entryDeadline: new Date(Date.now() + 120 * day) });
      await apiResponse(coordinator.api.v1.sessions[':id']['prices-final'].$put({ param: { id: june }, json: { final: true } }));
      await apiResponse(coordinator.api.v1.sessions[':id'].open.$post({ param: { id: june } }));
      fam = await onboard(officer, `za08-a-${RUN}`, 11);
      unpaid = (await apiResponse(reserve(fam, row.bioAll!)))[0]!.id;
      const g = await onboard(officer, `za08-b-${RUN}`, 11);
      paid = (await apiResponse(reserve(g, row.bioAll!)))[0]!.id;
      await apiResponse(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: g.studentId, registrationIds: [paid], instrumentUsed: 'cash' } }));
      const h = await onboard(officer, `za08-c-${RUN}`, 11);
      const nov = (await one<{ id: string }>(`select id from board_series where board_code = 'cambridge' and month = 'november' and year = $1 and label = ''`, [Y - 1])).id;
      paperLine = (await apiResponse(h.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, studentId: h.studentId, consent: CONSENT,
        lines: [{ offerItemId: row.bioPaper!, attempt: 'retake', mode: 'self_study', priorSittingSeriesId: nov }] } })))[0]!.id;
      expect([await priceOf(unpaid), await priceOf(paid), await priceOf(paperLine)]).toEqual([13850, 13850, 12350]);
    });

    it('the revised list: its counts first; then the unpaid lines re-priced — the one-paper retake through the board rule too — and the paid one listed for finance', async () => {
      const rows = [{ lineNo: 1, code: '0970 CX', name: 'IGCSE BIOLOGY', amount: 11500 }];
      const { shown, saved } = await confirmed(async (expected?: Impact) => apiResponse(apply('cambridge', `Cambridge June ${Y - 1} (revised)`, rows, expected)));
      expect(shown).toMatchObject({ saved: false, impact: { repriced: 2, listedForFinance: 1, linesAffected: 0, dueDatesMoved: 0 } });
      expect(saved).toMatchObject({ saved: true, rowsPriced: 2 });
      expect([await priceOf(unpaid), await priceOf(paid), await priceOf(paperLine)]).toEqual([14500, 13850, 13000]);
      expect((await fees())[row.bioPaper!]).toEqual([11500, 'board_rule']);
      const batch = await one<{ listed: { id: string }[] }>(`select new_data->'listedForFinance' as listed from audit_log where action = 'ROWS_REPRICED' and entity_id = $1`, [saved.listId!]);
      expect(batch.listed.map((l) => l.id)).toEqual([paid]);
    });

    it('races (§9.2): a reservation landing while a list applies waits for it and is priced from the new fee; a list confirmed with counts a reservation then changes is refused (IMPACT_CHANGED), nothing written', async () => {
      // The list first: paused at its own audit row, holding the rows; the reservation waits for them.
      const release = await pauseAtAudit('PRICE_LIST_APPLIED');
      let applying: ReturnType<typeof apply> | undefined;
      let reserving: ReturnType<typeof reserve> | undefined;
      const f = await onboard(officer, `za08-race-a-${RUN}`, 11);
      try {
        applying = apply('cambridge', `Cambridge June ${Y - 1} (race)`, [{ lineNo: 1, code: '0970 CX', name: 'IGCSE BIOLOGY', amount: 12000 }],
          { repriced: 2, listedForFinance: 1, linesAffected: 0, dueDatesMoved: 0 });
        await lockWaiters(1);
        reserving = reserve(f, row.bioAll!);
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [a, r] = await Promise.all([applying!, reserving!]);
      expect(a.status).toBe(200);
      expect(r.status).toBe(201);
      const raced = ((await r.json()) as { data: { id: string }[] }).data[0]!.id;
      expect(await priceOf(raced)).toBe(15000);
      expect([await priceOf(unpaid), await priceOf(paid)]).toEqual([15000, 13850]);

      // The reservation first: held after it has taken its rows FOR SHARE (at the fee-grid lock it takes next);
      // the list, sent with the counts it had before, waits for the rows, then finds a line it did not count.
      const { default: pg } = await import('pg');
      const holder = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await holder.connect();
      const series = (await one<{ s: string }>(`select board_series_id as s from session_offer_item where id = $1`, [row.bioAll!])).s;
      await holder.query(`select pg_advisory_lock(4041, hashtext($1))`, [series]);
      const g = await onboard(officer, `za08-race-b-${RUN}`, 11);
      let second: ReturnType<typeof reserve> | undefined;
      let late: ReturnType<typeof apply> | undefined;
      const before = { unpaid: await priceOf(unpaid), fee: (await fees())[row.bioAll!] };
      try {
        second = reserve(g, row.bioAll!);
        await lockWaiters(1);
        late = apply('cambridge', `Cambridge June ${Y - 1} (late)`, [{ lineNo: 1, code: '0970 CX', name: 'IGCSE BIOLOGY', amount: 12500 }],
          { repriced: 3, listedForFinance: 1, linesAffected: 0, dueDatesMoved: 0 });
        await lockWaiters(2);
      } finally {
        await holder.query(`select pg_advisory_unlock(4041, hashtext($1))`, [series]);
        await holder.end();
      }
      const [r2, l2] = await Promise.all([second!, late!]);
      expect(r2.status).toBe(201);
      expect(await refused(Promise.resolve(l2))).toEqual({ status: 409, error: 'What this change does to families changed while you were looking: look at the new counts and save again' });
      expect({ unpaid: await priceOf(unpaid), fee: (await fees())[row.bioAll!] }).toEqual(before);
      expect(await sql(`select id from price_list where session_id = $1 and name = $2`, [june, `Cambridge June ${Y - 1} (late)`])).toEqual([]);
    });
  });
});
