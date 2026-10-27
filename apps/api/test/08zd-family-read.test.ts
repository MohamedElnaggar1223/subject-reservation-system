import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import { admin, staff, onboard, subject, session, offer, one, sql, refusedWithCode, openWindow, CONSENT, type Client } from './helpers';

/**
 * 08zd — the family read the reservation page is built on (COORDINATOR_REWORK.md P3; Appendix A's
 * `GET /registrations/offers`).
 *
 * A retake names the exam it follows (the line rules keep "a retake names the sitting it follows",
 * RETAKE_SITTING_REQUIRED). A row that carries an earlier exam forward lists her choices (`allowedSittings`, D6); a
 * row that does not — an all-papers retake — listed none, so a family with no record of the subject could not
 * reserve its retake from the page. Each such retake option now carries `retakeFrom`: the board's exams of the two
 * years before the row's (what a family may declare), latest first, by id when on record. A Pearson A.S./A.L. subject
 * (IAL) lists the months IAL sits — October, January and June — never November (IAL_UNIT_MONTHS).
 */

const RUN = Math.random().toString(36).slice(2, 6);
const MONTH_ORDER: Record<string, number> = { january: 1, june: 6, october: 10, november: 11 };

describe('08zd: the family read', () => {
  let adm: Client, officer: Client;
  let S: string, subj: string, name: string;

  beforeAll(async () => {
    adm = await admin(`zd08-${RUN}`);
    officer = await staff(adm, 'finance_officer', `zd08-${RUN}`);
    name = `Geography (08zd ${RUN})`;
    subj = await subject(adm, `ZD08G${RUN}`, name, { course: 1000, registration: 500 });
    S = await session(adm, 'June (08zd)', 'june', 'igcse', { ...openWindow(), activate: true });
  });

  it("a retake of a row that carries nothing forward lists the board's exams of the two years before; a family with no record reserves it naming one", async () => {
    const f = await onboard(officer, `zd08-${RUN}`, 11);
    const read = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: S, studentId: f.studentId } }));
    const row = read.offerings.find((o) => o.name === name)!.rows[0]!;
    expect(row.knownSitting).toBeNull();
    // The first entry names nothing; each retake option carries the list, and no carried-from list of hers.
    expect(row.options.find((o) => o.attempt === 'first')!.retakeFrom).toEqual([]);
    const retake = row.options.find((o) => o.attempt === 'retake' && o.mode === 'in_school')!;
    expect(retake.needsCarriedFrom).toBe(false);
    expect(retake.allowedSittings).toEqual([]);
    const here = await one<{ month: string; year: number; board: string; months: string[] }>(
      `select bs.month, bs.year, bs.board_code as board, b.series_months as months from session_offer_item i
       join board_series bs on bs.id = i.board_series_id join exam_board b on b.code = bs.board_code where i.id = $1`, [row.id]);
    const at = (m: string, y: number) => y * 12 + (MONTH_ORDER[m] ?? 0);
    expect(retake.retakeFrom.length).toBeGreaterThan(0);
    for (const s of retake.retakeFrom) {
      // Before the row's exam, at most two years back, a month the board sits, never October or January for an O.L. subject.
      expect(at(s.month, s.year)).toBeLessThan(at(here.month, here.year));
      expect(at(here.month, here.year) - at(s.month, s.year)).toBeLessThanOrEqual(24);
      expect(here.months).toContain(s.month);
      expect(['october', 'january']).not.toContain(s.month);
      expect(s.label.en).toBe(`${s.month[0]!.toUpperCase()}${s.month.slice(1)} ${s.year}`);
    }
    // Latest first.
    expect(retake.retakeFrom.map((s) => at(s.month, s.year))).toEqual([...retake.retakeFrom.map((s) => at(s.month, s.year))].sort((a, b) => b - a));

    // Without one the retake is refused, as the page must not send it; naming the latest one, it is reserved, declared by the family.
    const line = { offerItemId: row.id, attempt: 'retake' as const, mode: 'in_school' as const };
    const bare = await refusedWithCode(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: S, studentId: f.studentId, consent: CONSENT, lines: [line] } }));
    expect(bare.code).toBe('RETAKE_SITTING_REQUIRED');
    const pick = retake.retakeFrom[0]!;
    const [made] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: {
      sessionId: S, studentId: f.studentId, consent: CONSENT,
      lines: [{ ...line, ...(pick.id ? { priorSittingSeriesId: pick.id } : { priorSitting: { month: pick.month, year: pick.year } }), expectedPrice: retake.price!.total }],
    } }));
    const l = await one<{ status: string; attempt: string; source: string; month: string; year: number; price: number }>(
      `select r.status, r.attempt, r.prior_sitting_source as source, ps.month, ps.year, r.price_at_registration::float as price
       from registration r join board_series ps on ps.id = r.prior_sitting_series_id where r.id = $1`, [made!.id]);
    expect(l).toEqual({ status: 'pending_payment', attempt: 'retake', source: 'declared_by_family', month: pick.month, year: pick.year, price: retake.price!.total });
    // Read again, the exam just declared is on record: listed by its id.
    const again = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: S, studentId: f.studentId } }));
    const listed = again.offerings.find((o) => o.name === name)!.rows[0]!.options.find((o) => o.attempt === 'retake' && o.mode === 'in_school')!.retakeFrom[0]!;
    expect(listed.id).not.toBeNull();
    expect([listed.month, listed.year]).toEqual([pick.month, pick.year]);
  });

  it('the oldest exam listed is one a family may still declare (two years before the row, not more)', async () => {
    const f = await onboard(officer, `zd08o-${RUN}`, 11);
    const read = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: S, studentId: f.studentId } }));
    const row = read.offerings.find((o) => o.name === name)!.rows[0]!;
    const retake = row.options.find((o) => o.attempt === 'retake' && o.mode === 'in_school')!;
    const oldest = retake.retakeFrom.at(-1)!;
    const [made] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: {
      sessionId: S, studentId: f.studentId, consent: CONSENT,
      lines: [{ offerItemId: row.id, attempt: 'retake', mode: 'in_school', expectedPrice: retake.price!.total,
        ...(oldest.id ? { priorSittingSeriesId: oldest.id } : { priorSitting: { month: oldest.month, year: oldest.year } }) }],
    } }));
    const l = await one<{ status: string; source: string; month: string; year: number }>(
      `select r.status, r.prior_sitting_source as source, ps.month, ps.year from registration r
       join board_series ps on ps.id = r.prior_sitting_series_id where r.id = $1`, [made!.id]);
    expect(l).toEqual({ status: 'pending_payment', source: 'declared_by_family', month: oldest.month, year: oldest.year });
  });

  it('a Pearson A.S./A.L. subject lists the months IAL sits: October, January and June, never November', async () => {
    const ialName = `Chemistry IAL (08zd ${RUN})`;
    const ial = await subject(adm, `ZD08I${RUN}`, ialName, { course: 1000, registration: 500 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    await offer(adm, S, ial);
    const f = await onboard(officer, `zd08i-${RUN}`, 12);
    const read = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: S, studentId: f.studentId } }));
    const o = read.offerings.find((x) => x.name === ialName)!;
    expect(o.group).toBe('A.S./A.L.');
    const months = await one<{ months: string[] }>(`select series_months as months from exam_board where code = 'pearson_edexcel'`);
    expect(months.months).toContain('november');
    const listed = o.rows.flatMap((r) => r.options.filter((x) => x.attempt === 'retake' && !x.needsCarriedFrom).flatMap((x) => x.retakeFrom));
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.map((x) => x.month).filter((m) => m === 'november')).toEqual([]);
    expect(listed.some((x) => x.month === 'october' || x.month === 'january')).toBe(true);
    // The server takes what the read offers: a retake naming an October or January exam is reserved, declared by the family.
    const row = o.rows.find((r) => r.options.some((x) => x.attempt === 'retake' && !x.needsCarriedFrom))!;
    const retake = row.options.find((x) => x.attempt === 'retake' && !x.needsCarriedFrom)!;
    const pick = retake.retakeFrom.find((x) => x.month === 'october' || x.month === 'january')!;
    const [made] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: {
      sessionId: S, studentId: f.studentId, consent: CONSENT,
      lines: [{ offerItemId: row.id, attempt: 'retake', mode: retake.mode, expectedPrice: retake.price!.total,
        ...(pick.id ? { priorSittingSeriesId: pick.id } : { priorSitting: { month: pick.month, year: pick.year } }) }],
    } }));
    const l = await one<{ status: string; source: string; month: string; year: number }>(
      `select r.status, r.prior_sitting_source as source, ps.month, ps.year from registration r
       join board_series ps on ps.id = r.prior_sitting_series_id where r.id = $1`, [made!.id]);
    expect(l).toEqual({ status: 'pending_payment', source: 'declared_by_family', month: pick.month, year: pick.year });
  });

  it('an O.L. subject of a board that sits October and January (Pearson) lists neither, and lists every exam of the two years it sits', async () => {
    const olName = `Accounting IGCSE (08zd ${RUN})`;
    const ol = await subject(adm, `ZD08P${RUN}`, olName, { course: 1000, registration: 500 }, { council: 'pearson_edexcel' });
    // The suite's open windows offer every subject the file makes at their level (helpers).
    const f = await onboard(officer, `zd08p-${RUN}`, 11);
    const read = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: S, studentId: f.studentId } }));
    const o = read.offerings.find((x) => x.name === olName)!;
    expect(o.group).toBe('O.L.');
    const row = o.rows[0]!;
    const here = await one<{ month: string; year: number; months: string[] }>(
      `select bs.month, bs.year, b.series_months as months from session_offer_item i
       join board_series bs on bs.id = i.board_series_id join exam_board b on b.code = bs.board_code where i.id = $1`, [row.id]);
    expect(here.months).toEqual(expect.arrayContaining(['october', 'january']));
    const at = (m: string, y: number) => y * 12 + (MONTH_ORDER[m] ?? 0);
    // Every month the board sits for O.L. (not October or January) in the two years before the row's exam, latest first.
    const expected: string[] = [];
    for (let y = here.year - 2; y <= here.year; y++) {
      for (const m of here.months) {
        if (m === 'october' || m === 'january') continue;
        const gap = at(here.month, here.year) - at(m, y);
        if (gap > 0 && gap <= 24) expected.push(`${m} ${y}`);
      }
    }
    const retake = row.options.find((x) => x.attempt === 'retake')!;
    expect(retake.retakeFrom.map((x) => `${x.month} ${x.year}`).sort()).toEqual(expected.sort());
    expect(retake.retakeFrom.length).toBeGreaterThanOrEqual(3);
  });

  it("a carried row whose list the coordinator emptied offers the board's earlier exams; naming one, the retake is reserved", async () => {
    const cName = `Physics carried (08zd ${RUN})`;
    const c = await subject(adm, `ZD08C${RUN}`, cName, { course: 1000, registration: 500 });
    // The suite's open windows offer every subject the file makes at their level (helpers).
    const f = await onboard(officer, `zd08c-${RUN}`, 11);
    const first = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: S, studentId: f.studentId } }));
    const rowId = first.offerings.find((x) => x.name === cName)!.rows[0]!.id;
    // A row that carries an earlier exam forward with no list of hers (the line rules then take any earlier exam of its board).
    await sql(`update session_offer_item set needs_prior_series = true, allowed_prior_series_ids = '{}' where id = $1`, [rowId]);
    const read = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: S, studentId: f.studentId } }));
    const retake = read.offerings.find((x) => x.name === cName)!.rows[0]!.options.find((x) => x.attempt === 'retake')!;
    expect(retake.needsCarriedFrom).toBe(true);
    expect(retake.allowedSittings).toEqual([]);
    expect(retake.retakeFrom.length).toBeGreaterThan(0);
    const line = { offerItemId: rowId, attempt: 'retake' as const, mode: retake.mode, expectedPrice: retake.price!.total };
    // Without one it is refused, asking for the exam it follows (a retake names it first).
    expect((await refusedWithCode(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: S, studentId: f.studentId, consent: CONSENT, lines: [line] } }))).code)
      .toBe('RETAKE_SITTING_REQUIRED');
    const pick = retake.retakeFrom[0]!;
    const [made] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: {
      sessionId: S, studentId: f.studentId, consent: CONSENT,
      lines: [{ ...line, ...(pick.id ? { priorSittingSeriesId: pick.id } : { priorSitting: { month: pick.month, year: pick.year } }) }],
    } }));
    expect((await one<{ status: string }>(`select status from registration where id = $1`, [made!.id])).status).toBe('pending_payment');
  });

  it("a row past its board deadline reads closed, so a family cannot keep picking it", async () => {
    const S2 = await session(adm, 'June (08zd past)', 'june', 'igcse', { ...openWindow(), activate: true });
    const pName = `History past (08zd ${RUN})`;
    const p = await subject(adm, `ZD08H${RUN}`, pName, { course: 1000, registration: 500 });
    // The suite's open windows offer every subject the file makes at their level (helpers).
    const f = await onboard(officer, `zd08h-${RUN}`, 11);
    const before = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: S2, studentId: f.studentId } }));
    const row = before.offerings.find((x) => x.name === pName)!.rows[0]!;
    expect(row.closed).toBe(false);
    await sql(`update board_series set entry_deadline = now() - interval '1 day', retake_deadline = null
      where id = (select board_series_id from session_offer_item where id = $1)`, [row.id]);
    const after = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: S2, studentId: f.studentId } }));
    expect(after.offerings.find((x) => x.name === pName)!.rows[0]!.closed).toBe(true);
    const first = row.options.find((x) => x.attempt === 'first')!;
    expect((await refusedWithCode(f.parent.api.v1.registrations.direct.$post({ json: {
      sessionId: S2, studentId: f.studentId, consent: CONSENT,
      lines: [{ offerItemId: row.id, attempt: 'first', mode: first.mode, expectedPrice: first.price!.total }],
    } }))).code).toBe('BOARD_DEADLINE_PASSED');
  });
});
