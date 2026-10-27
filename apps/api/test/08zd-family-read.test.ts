import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import { admin, staff, onboard, subject, session, one, refusedWithCode, openWindow, CONSENT, type Client } from './helpers';

/**
 * 08zd — the family read the reservation page is built on (COORDINATOR_REWORK.md P3; Appendix A's
 * `GET /registrations/offers`).
 *
 * A retake names the exam it follows (the line rules keep "a retake names the sitting it follows",
 * RETAKE_SITTING_REQUIRED). A row that carries an earlier exam forward lists her choices (`allowedSittings`, D6); a
 * row that does not — an all-papers retake — listed none, so a family with no record of the subject could not
 * reserve its retake from the page. Each such retake option now carries `retakeFrom`: the board's exams of the two
 * years before the row's (what a family may declare), latest first, by id when on record.
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
});
