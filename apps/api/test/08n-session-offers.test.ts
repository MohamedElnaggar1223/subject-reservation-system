import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf, type LineInputType } from '@repo/validations';
import {
  admin, staff, onboard, subject, refused, one, sql, audited, money, futureWindow, runPaymentDeadlines, runSessionRecovery,
  schoolToday, type Client,
} from './helpers';

/**
 * The reservations rework, step 1 (RESERVATIONS_REWORK.md §3.1–§3.3, §4.1, §8): sessions, their
 * offers and items, the series attached by item, and the per-line cut-off.
 *
 * - A June session set up from scratch and the next June copied from it (offers, teachers,
 *   items in the next year's series, board fees provisional), the derived name, a series made
 *   for an item that lands in one not on record (with its warning).
 * - A winter session open across several deadlines: each item cut off at its own; a Cambridge
 *   retake of the previous June reservable until the retake deadline; the sweep closing only the
 *   series whose deadline passed; IGCSE never in October or January; the defaults per board.
 * - Capture asks each preregistration its deadline first (MO-21, flags 42, 48, 58).
 * - The line rules (§3.5): exclusive groups, the same entry once across sessions, required
 *   items, the carry-forward period, self-study on a first entry, a retake's sitting.
 * - Grade 10 in bulk (A-15); due dates (§3.1).
 *
 * Lines are made the way the reservation paths make them: `insertLines` inside a transaction
 * after `assertMayRegisterForInTx` (docs/features/RESERVATIONS.md §2.2) — step B's `lines` input
 * reaches the same call; the paths that still name subjects are exercised through the API.
 * Every session carries a label of this run, so it never meets another file's.
 */

const days = (n: number) => n * 86_400_000;
const RUN = Math.random().toString(36).slice(2, 6);
const Y = academicYearStartOf();
const cairoDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
type Line = Pick<LineInputType, 'offerItemId' | 'attempt' | 'mode'> & Partial<LineInputType>;

/** Reserve lines as every reservation path does (the student locked first, then insertLines). */
async function reserve(studentId: string, sessionId: string, lines: Line[], status: 'pending_payment' | 'preregistered' = 'pending_payment') {
  const { db } = await import('@repo/db');
  const { insertLines } = await import('../src/services/line.services');
  const { assertMayRegisterForInTx } = await import('../src/services/eligibility.services');
  return db.transaction(async (tx) => {
    const eligibility = await assertMayRegisterForInTx(tx, studentId, sessionId);
    return insertLines(tx, { studentId, sessionId, lines: lines as LineInputType[], status, requestedBy: studentId, eligibility });
  });
}
const lineOf = async (id: string) => one<{
  status: string; board_series_id: string; price: string; course: string; board: string; due_at: string; attempt: string; mode: string; provisional: boolean;
}>(`select status, board_series_id, price_at_registration as price, course_fee_at_registration as course, registration_fee_at_registration as board,
    due_at, attempt, mode, price_provisional as provisional from registration where id = $1`, [id]);

describe('08n: sessions and offers', () => {
  let adm: Client, coordinator: Client;
  let teacherId: string;
  let english: string, oxfordSubject: string;
  let june1: string, june2: string;

  beforeAll(async () => {
    adm = await admin('n08s');
    coordinator = await staff(adm, 'coordinator', 'n08s');
    teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher A (08n ${RUN})` } })))!.id;
    english = await subject(adm, `RWN-EN-${RUN}`, `English (08n ${RUN})`, { course: 1000, registration: 300 });
    oxfordSubject = await subject(adm, `RWN-OX-${RUN}`, `Oxford subject (08n ${RUN})`, { course: 900, registration: 250 }, { council: 'oxford' });
  });

  it("a June session from scratch: its derived name, a subject added with its teacher and course fee, its item in the board's June series; an item landing in a series not on record makes it, with a warning", async () => {
    const s = await apiResponse(adm.api.v1.sessions.$post({
      json: { type: 'june', year: Y + 1, label: `n08a-${RUN}`, ...futureWindow(), courseStartsOn: `${Y + 1}-02-01`, paymentDueAt: new Date(Date.now() + days(170)).toISOString() },
    }));
    june1 = s.id;
    expect(s.name).toBe(`June ${Y + 1} — n08a-${RUN}`);
    expect(s).toMatchObject({ sessionType: 'june', seriesYear: Y + 1, status: 'draft' });
    // The refund policy is the June default, frozen on the session (§3.9).
    const { getSetting } = await import('../src/services/settings.services');
    expect(s.refundPolicy).toEqual(await getSetting('refund.defaultPolicy.june'));
    expect((await apiResponse(coordinator.api.v1.sessions[':id'].offers.$get({ param: { id: june1 } }))).offers).toEqual([]);

    // The coordinator adds English: three inputs (the subject, its teacher, the course fee).
    const made = await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({
      param: { id: june1 }, json: { subjectId: english, courseFee: 1000, teachers: [{ teacherId, mode: 'in_school' }] },
    }));
    expect(made.items).toHaveLength(1);
    await audited([made.id], ['SESSION_OFFER_CREATED']);
    let list = await apiResponse(coordinator.api.v1.sessions[':id'].offers.$get({ param: { id: june1 } }));
    const en = list.offers.find((o) => o.subjectId === english)!;
    expect(en.items.map((i) => [i.kind, i.series?.boardCode, i.series?.month, i.series?.year, i.series?.label])).toEqual([['whole', 'cambridge', 'june', Y + 1, '']]);
    expect(en.teachers.map((t) => t.teacherId)).toEqual([teacherId]);
    // No board fee yet: flagged, and the series is attached to the session by the item.
    expect(en.warnings).toContain('no_fee');
    expect(list.series.map((x) => x.id)).toContain(en.items[0]!.boardSeriesId);

    // An Oxford subject: its June series is made when its item lands in it — with no dates, so
    // the screen warns that it takes no line until they are set.
    await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({
      param: { id: june1 }, json: { subjectId: oxfordSubject, courseFee: 900, teachers: [{ teacherId, mode: 'in_school' }] },
    }));
    list = await apiResponse(coordinator.api.v1.sessions[':id'].offers.$get({ param: { id: june1 } }));
    const ox = list.offers.find((o) => o.subjectId === oxfordSubject)!;
    expect(ox.items[0]!.series).toMatchObject({ boardCode: 'oxford', month: 'june', year: Y + 1 });
    const oxDates = await one<{ e: string | null; x: string | null }>(`select entry_deadline as e, exams_start as x from board_series where id = $1`, [ox.items[0]!.boardSeriesId]);
    // Made with no dates (unless another suite gave that June dates already): the item cannot be
    // reserved until they are set, and the screen says so.
    const dated = !!(oxDates.e || oxDates.x);
    expect(ox.items[0]!.series!.reservable).toBe(dated);
    expect(ox.warnings.includes('series_without_dates')).toBe(!dated);

    // Finance types English's board fee for that series (confirmed: the board has published).
    await apiResponse(adm.api.v1['board-fees'].$put({
      query: { seriesId: en.items[0]!.boardSeriesId! }, json: { rows: [{ keyKind: 'subject', keyId: english, amount: 300, provisional: false }] },
    }));
    list = await apiResponse(coordinator.api.v1.sessions[':id'].offers.$get({ param: { id: june1 } }));
    expect(list.offers.find((o) => o.subjectId === english)!.items[0]!.boardFee).toEqual({ amount: 300, provisional: false, missing: 0 });
  });

  it("the next June copied from it: offers, teachers and items in the next year's series; board fees provisional; audited", async () => {
    const s = await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: Y + 2, label: `n08a-${RUN}`, ...futureWindow(), courseStartsOn: `${Y + 2}-02-01`,
        paymentDueAt: new Date(Date.now() + days(170)).toISOString(), copyFromSessionId: june1,
      },
    }));
    june2 = s.id;
    expect(s.name).toBe(`June ${Y + 2} — n08a-${RUN}`);
    const list = await apiResponse(coordinator.api.v1.sessions[':id'].offers.$get({ param: { id: june2 } }));
    expect(list.offers.map((o) => o.subjectId).sort()).toEqual([english, oxfordSubject].sort());
    const en = list.offers.find((o) => o.subjectId === english)!;
    expect(en.courseFee).toBe(1000);
    expect(en.teachers.map((t) => t.teacherId)).toEqual([teacherId]);
    expect(en.items.map((i) => [i.series?.boardCode, i.series?.month, i.series?.year])).toEqual([['cambridge', 'june', Y + 2]]);
    // The fee came across provisional: reservable, not payable until finance confirms it (§3.4).
    expect(en.items[0]!.boardFee).toEqual({ amount: 300, provisional: true, missing: 0 });
    const fee = await one<{ provisional: boolean; copied: string | null }>(
      `select provisional, copied_from_fee_id as copied from board_fee where board_series_id = $1 and key_kind = 'subject' and key_id = $2`, [en.items[0]!.boardSeriesId, english]);
    expect(fee.provisional).toBe(true);
    expect(fee.copied).not.toBeNull();
    expect(await one(`select new_data->>'fromSessionId' as "from", (new_data->>'offers')::int as offers from audit_log where action = 'SESSION_COPIED' and entity_id = $1`, [june2]))
      .toEqual({ from: june1, offers: 2 });
    // A session converted while closed (migration 0042 closed its offers and items with it) copies
    // as its subjects allow: the closing was the conversion's, not the school's. One the school
    // closed itself in a session it ran stays behind.
    await apiResponse(adm.api.v1.sessions[':id'].activate.$post({ param: { id: june1 } }));
    await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: june1 }, json: { reason: '08n: a June that has ended' } }));
    await sql(`update session_offer set availability = 'closed', legacy = '{"converted": true}'::jsonb where session_id = $1`, [june1]);
    await sql(`update session_offer_item set availability = 'closed', legacy = '{"converted": true}'::jsonb where session_id = $1`, [june1]);
    const fromConverted = await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: Y + 2, label: `n08a2-${RUN}`, ...futureWindow(), courseStartsOn: `${Y + 2}-02-01`,
        paymentDueAt: new Date(Date.now() + days(170)).toISOString(), copyFromSessionId: june1,
      },
    }));
    const copied = await apiResponse(coordinator.api.v1.sessions[':id'].offers.$get({ param: { id: fromConverted.id } }));
    expect(copied.offers.map((o) => [o.subjectId, o.availability, o.items.map((i) => i.availability)]).sort())
      .toEqual([[english, 'open', ['open']], [oxfordSubject, 'open', ['open']]].sort());
    // A session the school ran and closed: an offer it had closed is not brought back.
    await sql(`update session_offer set legacy = null where session_id = $1 and subject_id = $2`, [june1, oxfordSubject]);
    const fromRun = await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: Y + 2, label: `n08a3-${RUN}`, ...futureWindow(), courseStartsOn: `${Y + 2}-02-01`,
        paymentDueAt: new Date(Date.now() + days(170)).toISOString(), copyFromSessionId: june1,
      },
    }));
    expect((await apiResponse(coordinator.api.v1.sessions[':id'].offers.$get({ param: { id: fromRun.id } }))).offers.map((o) => o.subjectId)).toEqual([english]);

    // A session copies from one of its own kind only.
    const winter = await apiResponse(adm.api.v1.sessions.$post({
      json: { type: 'winter', year: Y + 1, label: `n08a-${RUN}`, ...futureWindow(), courseStartsOn: `${Y + 1}-09-01`, paymentDueAt: new Date(Date.now() + days(170)).toISOString() },
    }));
    expect(await refused(adm.api.v1.sessions[':id']['copy-from'].$post({ param: { id: winter.id }, json: { fromSessionId: june1 } })))
      .toEqual({ status: 400, error: 'Copy from a session of the same kind (June from June, winter from winter)' });
  });
});

describe('08n: a winter session, each item cut off at its own deadline (§3.3)', () => {
  let adm: Client, officer: Client;
  let teacherId: string;
  let w: string;
  let ial: string, phys: string, igEn: string, igPea: string;
  let oct: string, camNov: string, jan: string, camJune: string, camNovBefore: string;
  let ialOct: string, ialJan: string, physNov: string, enNov: string;

  const series = async (boardCode: 'cambridge' | 'pearson_edexcel', month: 'june' | 'october' | 'november' | 'january', year: number, dates: { entryDeadline?: Date; retakeDeadline?: Date; examsStart?: string } = {}) =>
    (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode, month, year, label: `n08w-${RUN}`, ...dates } })))!.id;
  const item = async (offerId: string, label: string, boardSeriesId: string, fee: { subjectId: string; amount: number }) => {
    await apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId: boardSeriesId }, json: { rows: [{ keyKind: 'subject', keyId: fee.subjectId, amount: fee.amount, provisional: false }] } }));
    const r = await apiResponse(adm.api.v1.sessions[':id'].offers[':offerId'].items.$post({
      param: { id: w, offerId }, json: { label, kind: 'whole', enters: { kind: 'subject' }, boardSeriesId, availability: 'open', requiredInSeries: false },
    }));
    return r!.id;
  };

  beforeAll(async () => {
    adm = await admin('n08w');
    officer = await staff(adm, 'finance_officer', 'n08w');
    teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher W (08n ${RUN})` } })))!.id;
    ial = await subject(adm, `RWN-IAL-${RUN}`, `IAL Maths (08n ${RUN})`, { course: 2000, registration: 800 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    phys = await subject(adm, `RWN-PHY-${RUN}`, `Physics AS (08n ${RUN})`, { course: 1500, registration: 600 }, { qualificationLevel: 'as_level', council: 'cambridge' });
    igEn = await subject(adm, `RWN-IGE-${RUN}`, `IGCSE English (08n ${RUN})`, { course: 1000, registration: 300 });
    igPea = await subject(adm, `RWN-IGP-${RUN}`, `IGCSE Pearson (08n ${RUN})`, { course: 1000, registration: 300 }, { council: 'pearson_edexcel' });
    // The winter session of this academic year, open now until well after its deadlines.
    const s = await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'winter', year: Y, label: `n08w-${RUN}`, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + days(40)).toISOString(),
      },
    }));
    w = s.id;
    expect(s.status).toBe('active');
    expect(s.name).toBe(`November ${Y} – January ${Y + 1} — n08w-${RUN}`);
    const now = Date.now();
    oct = await series('pearson_edexcel', 'october', Y, { entryDeadline: new Date(now + days(5)) });
    camNov = await series('cambridge', 'november', Y, { entryDeadline: new Date(now + days(6)), retakeDeadline: new Date(now + days(20)) });
    jan = await series('pearson_edexcel', 'january', Y + 1, { entryDeadline: new Date(now + days(30)) });
    // Two Cambridge sittings on record before November: June (the previous sitting) and the November before.
    camJune = await series('cambridge', 'june', Y);
    camNovBefore = await series('cambridge', 'november', Y - 1);
    const offer = async (subjectId: string, courseFee: number) => (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: w }, json: { subjectId, courseFee, teachers: [{ teacherId, mode: 'in_school' }], items: [{ label: 'placeholder', kind: 'whole', enters: { kind: 'subject' }, availability: 'closed', requiredInSeries: false }] },
    })))!.id;
    const ialOffer = await offer(ial, 2000);
    ialOct = await item(ialOffer, 'IAL October', oct, { subjectId: ial, amount: 800 });
    ialJan = await item(ialOffer, 'IAL January', jan, { subjectId: ial, amount: 800 });
    physNov = await item(await offer(phys, 1500), 'Physics AS', camNov, { subjectId: phys, amount: 600 });
    enNov = await item(await offer(igEn, 1000), 'English', camNov, { subjectId: igEn, amount: 300 });
  });

  it('an IGCSE item is refused in October and January; Cambridge AS defaults to November, Pearson AS to October', async () => {
    const o = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: w }, json: { subjectId: igPea, courseFee: 1000, teachers: [{ teacherId, mode: 'in_school' }] },
    })))!;
    // Its default: Pearson's November (IGCSE sits June and November).
    expect(await one(`select bs.month from session_offer_item i join board_series bs on bs.id = i.board_series_id where i.id = $1`, [o.items[0]]))
      .toEqual({ month: 'november' });
    for (const s of [oct, jan]) {
      const r = await refused(adm.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({
        param: { id: w, offerId: o.id, itemId: o.items[0]! }, json: { boardSeriesId: s, reason: 'try another series' },
      }));
      expect(r).toEqual({ status: 400, error: expect.stringMatching(/IGCSE/) });
    }
    // The per-board defaults of an AS item in a winter session (§3.3).
    const { db } = await import('@repo/db');
    const { defaultSeriesFor } = await import('../src/services/offer.services');
    const monthOf = async (board: string) => {
      const id = await db.transaction((tx) => defaultSeriesFor(tx, { sessionType: 'winter', seriesYear: Y }, board, 'as', null));
      return (await one<{ month: string }>(`select month from board_series where id = $1`, [id])).month;
    };
    expect(await monthOf('cambridge')).toBe('november');
    expect(await monthOf('pearson_edexcel')).toBe('october');
    expect(await monthOf('oxford')).toBe('november');
  });

  it("October's deadline passes inside the open session: October's item takes no new line, January's does; the sweep closes October's waiting lines only", async () => {
    const a = await onboard(officer, `n08w-oct-a-${RUN}`, 12);
    const b = await onboard(officer, `n08w-oct-b-${RUN}`, 12);
    const [aOct] = await reserve(a.studentId, w, [{ offerItemId: ialOct, attempt: 'first', mode: 'in_school', teacherId }]);
    const [bJan] = await reserve(b.studentId, w, [{ offerItemId: ialJan, attempt: 'first', mode: 'in_school', teacherId }]);
    // A deadline before the session's end is accepted (the rule that refused it is gone).
    const end = new Date((await one<{ end: string }>(`select end_date as "end" from registration_session where id = $1`, [w])).end);
    await apiResponse(adm.api.v1['board-series'][':id'].$put({ param: { id: oct }, json: { entryDeadline: new Date(Date.now() + days(4)), reason: 'board key dates' } }));
    expect(new Date((await one<{ d: string }>(`select entry_deadline as d from board_series where id = $1`, [oct])).d).getTime()).toBeLessThan(end.getTime());
    // October's deadline passes (moved with SQL: the API takes only future deadlines).
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [oct]);
    const c = await onboard(officer, `n08w-oct-c-${RUN}`, 12);
    await expect(reserve(c.studentId, w, [{ offerItemId: ialOct, attempt: 'first', mode: 'in_school', teacherId }]))
      .rejects.toThrow(/deadline/);
    const [cJan] = await reserve(c.studentId, w, [{ offerItemId: ialJan, attempt: 'first', mode: 'in_school', teacherId }]);
    expect((await lineOf(cJan!.id)).board_series_id).toBe(jan);
    // The family's subject list (the offers read, §5) shows October closed and January open, each
    // with its own cut-off and its price.
    const offers = await apiResponse(c.parent.api.v1.registrations.offers.$get({ query: { sessionId: w, studentId: c.studentId } }));
    const ialItems = offers!.offers.find((o) => o.subject.id === ial)!.items;
    const byLabel = new Map(ialItems.map((i) => [i.label, i]));
    expect(byLabel.get('IAL October')).toMatchObject({ open: false, series: { id: oct } });
    expect(byLabel.get('IAL January')).toMatchObject({ open: true, series: { id: jan } });
    expect(byLabel.get('IAL January')!.prices.find((p) => p.attempt === 'first' && p.mode === 'in_school')).toMatchObject({ total: 2800, provisional: false });
    // The sweep: October's waiting line expires at its deadline; January's stay.
    await runPaymentDeadlines();
    expect((await lineOf(aOct!.id)).status).toBe('expired');
    expect(await one(`select new_data->>'reason' as reason from audit_log where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [aOct!.id])).toEqual({ reason: 'entry_deadline' });
    expect((await lineOf(bJan!.id)).status).toBe('pending_payment');
    expect((await lineOf(cJan!.id)).status).toBe('pending_payment');
  });

  it('a Cambridge retake of the previous June is reservable until the retake deadline after the entry deadline passed; a first entry is not; a retake of an older sitting is cut off at the entry deadline; the retake is due by the retake deadline', async () => {
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [camNov]);
    const f = await onboard(officer, `n08w-retake-${RUN}`, 12);
    await expect(reserve(f.studentId, w, [{ offerItemId: physNov, attempt: 'first', mode: 'in_school', teacherId }])).rejects.toThrow(/deadline/);
    await expect(reserve(f.studentId, w, [{ offerItemId: physNov, attempt: 'retake', mode: 'in_school', teacherId, priorSittingSeriesId: camNovBefore, priorSittingSource: 'declared_by_desk' }]))
      .rejects.toThrow(/deadline/);
    const [line] = await reserve(f.studentId, w, [{ offerItemId: physNov, attempt: 'retake', mode: 'in_school', teacherId, priorSittingSeriesId: camJune, priorSittingSource: 'declared_by_desk' }]);
    const l = await lineOf(line!.id);
    expect([l.status, l.attempt, l.board_series_id]).toEqual(['pending_payment', 'retake', camNov]);
    const retake = new Date((await one<{ d: string }>(`select retake_deadline as d from board_series where id = $1`, [camNov])).d);
    // The session's payment date is later than the retake deadline: the line is due by its own deadline.
    expect(new Date(l.due_at).getTime()).toBe(retake.getTime());
    expect(await one(`select line_effective_deadline_kind(attempt, prior_sitting_series_id, board_series_id) as kind from registration where id = $1`, [line!.id]))
      .toEqual({ kind: 'retake' });
    // The sweep at the entry deadline leaves the retake waiting (its own deadline is later).
    await runPaymentDeadlines();
    expect((await lineOf(line!.id)).status).toBe('pending_payment');
  });

  it('a series with neither an entry deadline nor an exam start takes no line', async () => {
    const bare = await series('pearson_edexcel', 'january', Y + 1).catch(() => null);
    // Another bare January series of this label cannot exist twice; reuse the one above if so.
    const id = bare ?? (await one<{ id: string }>(`select id from board_series where board_code = 'pearson_edexcel' and month = 'january' and year = $1 and label = $2`, [Y + 1, `n08w-${RUN}`])).id;
    await sql(`update board_series set entry_deadline = null, exams_start = null where id = $1 and id <> $2`, [id, jan]);
    const offerId = (await one<{ id: string }>(`select id from session_offer where session_id = $1 and subject_id = $2`, [w, ial])).id;
    const bareSeries = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', month: 'january', year: Y + 1, label: `n08w-bare-${RUN}` } })))!.id;
    const bareItem = await item(offerId, 'IAL January (no dates)', bareSeries, { subjectId: ial, amount: 800 });
    const f = await onboard(officer, `n08w-bare-${RUN}`, 12);
    await expect(reserve(f.studentId, w, [{ offerItemId: bareItem, attempt: 'first', mode: 'in_school', teacherId }]))
      .rejects.toThrow('IAL Maths (08n ' + RUN + ') is entered in a board series with no entry deadline and no exam dates yet: it opens for reservations once they are set');
  });

  it('A-12: a graduate may reserve the winter session when graduate retakes are allowed', async () => {
    const g = await onboard(officer, `n08w-grad-${RUN}`, 12);
    // Graduated: the cohort that finished grade 12 last academic year.
    await sql(`update "user" set cohort_year = cohort_year - 1 where id = $1`, [g.studentId]);
    const stored = await sql<{ value: unknown }>(`select value from school_setting where key = 'eligibility.graduateRetakes'`);
    const { getSetting } = await import('../src/services/settings.services');
    if (!(await getSetting('eligibility.graduateRetakes'))) {
      await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'eligibility.graduateRetakes' }, json: { value: true, reason: '08n: A-12 scenario' } }));
    }
    try {
      const [line] = await reserve(g.studentId, w, [{ offerItemId: enNov, attempt: 'retake', mode: 'in_school', teacherId, priorSittingSeriesId: camJune, priorSittingSource: 'declared_by_desk' }]);
      expect((await lineOf(line!.id)).status).toBe('pending_payment');
    } finally {
      if (stored.length) await sql(`update school_setting set value = $1::jsonb where key = 'eligibility.graduateRetakes'`, [JSON.stringify(stored[0]!.value)]);
      else await sql(`delete from school_setting where key = 'eligibility.graduateRetakes'`);
    }
  });
});

describe('08n: capture asks each preregistration its deadline first (MO-21; flags 42, 48, 58)', () => {
  it('a paid one refunded in full, an unfunded one expired, one with an open payment left to its sweep, a SO-4 held one untouched; the rest captured', async () => {
    const adm = await admin('n08c');
    const officer = await staff(adm, 'finance_officer', 'n08c');
    const coordinator = await staff(adm, 'coordinator', 'n08c');
    const teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher C (08n ${RUN})` } })))!.id;
    const sub = await subject(adm, `RWN-CAP-${RUN}`, `Capture subject (08n ${RUN})`, { course: 1000, registration: 200 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    const subJ = await subject(adm, `RWN-CAJ-${RUN}`, `Capture January (08n ${RUN})`, { course: 1000, registration: 200 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    const d = await apiResponse(adm.api.v1.sessions.$post({
      json: { type: 'winter', year: Y, label: `n08c-${RUN}`, ...futureWindow(), courseStartsOn: cairoDate(new Date(Date.now() + days(90))), paymentDueAt: new Date(Date.now() + days(170)).toISOString() },
    }));
    const mk = async (month: 'october' | 'january', year: number) =>
      (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', month, year, label: `n08c-${RUN}`, entryDeadline: new Date(Date.now() + days(200)) } })))!.id;
    const s1 = await mk('october', Y);
    const s2 = await mk('january', Y + 1);
    const place = async (subjectId: string, seriesId: string) => {
      await apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId }, json: { rows: [{ keyKind: 'subject', keyId: subjectId, amount: 200, provisional: false }] } }));
      await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
        param: { id: d.id }, json: { subjectId, courseFee: 1000, teachers: [{ teacherId, mode: 'in_school' }], items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: seriesId, availability: 'open', requiredInSeries: false }] },
      }));
    };
    await place(sub, s1);
    await place(subJ, s2);
    const prereg = async (f: { parent: Client; studentId: string }, subjectId: string) =>
      (await apiResponse(f.parent.api.v1.registrations.preregister.$post({ json: { sessionId: d.id, subjectIds: [subjectId], studentId: f.studentId } })))![0]!.id;
    const payInSchool = async (f: { parent: Client }, id: string, confirm: boolean) => {
      const p = (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [id], paymentMethod: 'in_school', escrowAmountToApply: 0 } })))!.id!;
      if (confirm) await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: p }, json: { instrumentUsed: 'cash' } }));
      return p;
    };
    const wallet = async (studentId: string) => {
      const x = await one<{ balance: string; held: string }>(`select balance, held_balance as held from escrow where student_id = $1`, [studentId]);
      return { free: money(x.balance), held: money(x.held) };
    };
    const paid = await onboard(officer, `n08c-paid-${RUN}`, 12);
    const unfunded = await onboard(officer, `n08c-unfunded-${RUN}`, 12);
    const open = await onboard(officer, `n08c-open-${RUN}`, 12);
    const heldF = await onboard(officer, `n08c-held-${RUN}`, 12);
    const later = await onboard(officer, `n08c-later-${RUN}`, 12);
    const rPaid = await prereg(paid, sub);
    await payInSchool(paid, rPaid, true);
    const rUnfunded = await prereg(unfunded, sub);
    const rOpen = await prereg(open, sub);
    const openPay = await payInSchool(open, rOpen, false);
    const rHeld = await prereg(heldF, sub);
    await payInSchool(heldF, rHeld, true);
    const rLater = await prereg(later, subJ);
    await payInSchool(later, rLater, true);
    expect(await wallet(paid.studentId)).toEqual({ free: 0, held: 1200 });

    // The SO-4 row first: its student leaves, the session opens while October's deadline is still
    // ahead, and capture holds it (PREREG_HELD_INELIGIBLE). Then the session goes back to draft
    // for the others' scenario (the reach past the API: a session never returns to draft).
    await apiResponse(coordinator.api.v1.students[':id'].leave.$post({ param: { id: heldF.studentId }, json: { kind: 'withdrawn', leftOn: schoolToday(), reason: 'left before the series opened' } }));
    const { capturePreregistrationsForSession } = await import('../src/services/prereg.services');
    await sql(`update registration_session set status = 'active', start_date = now() - interval '1 day' where id = $1`, [d.id]);
    // Only the held row is judged here: the others are moved out of reach for this one pass.
    await sql(`update registration set status = 'rejected' where id in ($1, $2, $3, $4)`, [rPaid, rUnfunded, rOpen, rLater]);
    expect((await capturePreregistrationsForSession(d.id)).heldIneligible).toBe(1);
    await sql(`update registration set status = 'preregistered' where id in ($1, $2, $3, $4)`, [rPaid, rUnfunded, rOpen, rLater]);
    await audited([rHeld], ['PREREG_HELD_INELIGIBLE']);

    // October's deadline passes; January's is ahead. Capture runs (the recovery tick).
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [s1]);
    const out = await capturePreregistrationsForSession(d.id);
    expect(out).toMatchObject({ refundedAtDeadline: 2, captured: 1, heldIneligible: 1 });
    // Paid: refunded in full to free escrow (MO-21), dropped, audited.
    expect((await lineOf(rPaid)).status).toBe('dropped');
    expect(await wallet(paid.studentId)).toEqual({ free: 1200, held: 0 });
    expect(await one(`select (new_data->>'refundPercentage')::int as pct from audit_log where action = 'PREREG_REFUNDED_AT_DEADLINE' and entity_id = $1`, [rPaid])).toEqual({ pct: 100 });
    // Unfunded: expired with the deadline's reason.
    expect((await lineOf(rUnfunded)).status).toBe('expired');
    expect(await one(`select new_data->>'reason' as reason from audit_log where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [rUnfunded]))
      .toEqual({ reason: 'preregistration_unfunded_at_deadline' });
    // An open payment: left for that payment's own sweep.
    expect((await lineOf(rOpen)).status).toBe('preregistered');
    expect((await one<{ status: string }>(`select status from payment where id = $1`, [openPay])).status).toBe('pending');
    // SO-4: the held row stays as the owner left it, its money held.
    expect((await lineOf(rHeld)).status).toBe('preregistered');
    expect(await wallet(heldF.studentId)).toEqual({ free: 0, held: 1200 });
    // January's deadline is ahead: captured, its held money confirmed.
    expect((await lineOf(rLater)).status).toBe('confirmed');
    expect(await wallet(later.studentId)).toEqual({ free: 0, held: 0 });
    // Run again: nothing more moves.
    expect(await capturePreregistrationsForSession(d.id)).toMatchObject({ refundedAtDeadline: 0, captured: 0 });
    await runSessionRecovery();
  });
});

describe('08n: the line rules (§3.5)', () => {
  let adm: Client, officer: Client;
  let teacherId: string;
  let june: string, juneOther: string;
  let camJune: string, camNovEarly: string, camNovRecent: string;
  let physOffer: string, physAs: string, physAl: string, physA2: string, physAsOther: string;
  let artsOffer: string, artsCore: string, artsOption: string;
  let selfOnly: string, taught: string;

  beforeAll(async () => {
    adm = await admin('n08r');
    officer = await staff(adm, 'finance_officer', 'n08r');
    teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher R (08n ${RUN})` } })))!.id;
    const mkSession = async (label: string) => (await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: Y + 1, label, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + days(40)).toISOString(),
      },
    })))!.id;
    june = await mkSession(`n08r-${RUN}`);
    juneOther = await mkSession(`n08r2-${RUN}`);
    camJune = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `n08r-${RUN}`, entryDeadline: new Date(Date.now() + days(50)) } })))!.id;
    camNovEarly = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'november', year: Y - 1, label: `n08r-${RUN}` } })))!.id;
    camNovRecent = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'november', year: Y, label: `n08r-${RUN}` } })))!.id;

    // Cambridge Physics (as the forms have it): AS in school; A Level; A2 carried forward,
    // self-study only, needing the AS sitting; AS and A Level one exclusive group.
    const phys = await subject(adm, `RWN-RPH-${RUN}`, `Physics (08n rules ${RUN})`, { course: 1500, registration: 600 }, { qualificationLevel: 'a_level' });
    const fee = async (seriesId: string, subjectId: string) =>
      apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId }, json: { rows: [{ keyKind: 'subject', keyId: subjectId, amount: 600, provisional: false }] } }));
    await fee(camJune, phys);
    const it = (label: string, extra: Record<string, unknown> = {}) => ({ label, kind: 'route' as const, enters: { kind: 'subject' as const }, boardSeriesId: camJune, availability: 'open' as const, requiredInSeries: false, ...extra });
    const o = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: june }, json: {
        subjectId: phys, courseFee: 1500, teachers: [{ teacherId, mode: 'in_school' }],
        items: [it('AS', { exclusiveGroup: 'award' }), it('A Level', { exclusiveGroup: 'award' }), it('A2 carry forward', { availability: 'self_study_only', needsPriorSeries: true })],
      },
    })))!;
    physOffer = o.id;
    [physAs, physAl, physA2] = o.items as [string, string, string];
    // The same subject in another session of the same June, entering the same in the same series.
    physAsOther = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: juneOther }, json: { subjectId: phys, courseFee: 1500, teachers: [{ teacherId, mode: 'in_school' }], items: [it('AS')] },
    })))!.items[0]!;

    // A subject with a required paper (a first entry includes it) and an optional one, each its own unit.
    const arts = await subject(adm, `RWN-ART-${RUN}`, `Arts (08n rules ${RUN})`, { course: 1000, registration: 300 });
    const unit = async (code: string) => (await apiResponse(adm.api.v1.catalogue.units.$post({ json: { boardCode: 'cambridge', code: `${code}-${RUN}`, title: code, unitLevel: 'igcse', kind: 'component' } })))!.id;
    const [u1, u2] = [await unit('ART1'), await unit('ART2')];
    await apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId: camJune }, json: { rows: [u1, u2].map((keyId) => ({ keyKind: 'unit' as const, keyId, amount: 150, provisional: false })) } }));
    const paper = (label: string, unitId: string, required: boolean) => ({ ...it(label, { requiredInSeries: required }), kind: 'unit' as const, enters: { kind: 'units' as const, unitIds: [unitId] } });
    const a = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: june }, json: { subjectId: arts, courseFee: 1000, teachers: [{ teacherId, mode: 'in_school' }], items: [paper('Core paper', u1, true), paper('Option paper', u2, false)] },
    })))!;
    artsOffer = a.id;
    [artsCore, artsOption] = a.items as [string, string];

    // Self-study: one subject the school does not teach this cycle, one it teaches.
    const notTaught = await subject(adm, `RWN-NT-${RUN}`, `Not taught (08n rules ${RUN})`, { course: 800, registration: 300 });
    const isTaught = await subject(adm, `RWN-TA-${RUN}`, `Taught (08n rules ${RUN})`, { course: 800, registration: 300 });
    await fee(camJune, notTaught);
    await fee(camJune, isTaught);
    selfOnly = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: june }, json: { subjectId: notTaught, courseFee: 800, availability: 'self_study_only', teachers: [], items: [{ ...it('Whole subject'), kind: 'whole' }] },
    })))!.items[0]!;
    taught = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: june }, json: { subjectId: isTaught, courseFee: 800, teachers: [{ teacherId, mode: 'in_school' }], items: [{ ...it('Whole subject'), kind: 'whole' }] },
    })))!.items[0]!;
  });

  it('AS and A Level of one subject cannot be reserved together (one exclusive group); one of them can', async () => {
    const f = await onboard(officer, `n08r-excl-${RUN}`, 12);
    await expect(reserve(f.studentId, june, [
      { offerItemId: physAs, attempt: 'first', mode: 'in_school', teacherId },
      { offerItemId: physAl, attempt: 'first', mode: 'in_school', teacherId },
    ])).rejects.toThrow(/cannot be reserved together/);
    const [as] = await reserve(f.studentId, june, [{ offerItemId: physAs, attempt: 'first', mode: 'in_school', teacherId }]);
    expect(as).toBeTruthy();
    await expect(reserve(f.studentId, june, [{ offerItemId: physAl, attempt: 'first', mode: 'in_school', teacherId }])).rejects.toThrow(/cannot be reserved together/);
  });

  it('the same entry twice in one series across two sessions is refused: the board takes one entry', async () => {
    const f = await onboard(officer, `n08r-once-${RUN}`, 12);
    await reserve(f.studentId, june, [{ offerItemId: physAs, attempt: 'first', mode: 'in_school', teacherId }]);
    await expect(reserve(f.studentId, juneOther, [{ offerItemId: physAsOther, attempt: 'first', mode: 'in_school', teacherId }]))
      .rejects.toThrow(/is already reserved in .+: the board takes one entry/);
  });

  it('a first entry without its required item is refused; with it, accepted', async () => {
    const f = await onboard(officer, `n08r-req-${RUN}`, 12);
    await expect(reserve(f.studentId, june, [{ offerItemId: artsOption, attempt: 'first', mode: 'in_school', teacherId }]))
      .rejects.toThrow(/includes Core paper/);
    const made = await reserve(f.studentId, june, [
      { offerItemId: artsCore, attempt: 'first', mode: 'in_school', teacherId },
      { offerItemId: artsOption, attempt: 'first', mode: 'in_school', teacherId },
    ]);
    expect(made).toHaveLength(2);
    expect(artsOffer).toBeTruthy();
  });

  it("a carried sitting outside the board's carry-forward period is refused (Cambridge: 13 months); inside it, accepted", async () => {
    const f = await onboard(officer, `n08r-carry-${RUN}`, 12);
    await expect(reserve(f.studentId, june, [{ offerItemId: physA2, attempt: 'first', mode: 'self_study' }]))
      .rejects.toThrow(/name the series it is carried from/);
    await expect(reserve(f.studentId, june, [{ offerItemId: physA2, attempt: 'first', mode: 'self_study', priorSittingSeriesId: camNovEarly, priorSittingSource: 'declared_by_desk' }]))
      .rejects.toThrow(new RegExp(`November ${Y - 1} is outside Cambridge International's carry-forward period \\(13 months\\)`));
    const [line] = await reserve(f.studentId, june, [{ offerItemId: physA2, attempt: 'first', mode: 'self_study', priorSittingSeriesId: camNovRecent, priorSittingSource: 'declared_by_desk' }]);
    expect((await lineOf(line!.id)).mode).toBe('self_study');
    expect(physOffer).toBeTruthy();
  });

  it('self-study on a first entry is refused where the school teaches the subject; allowed where it does not; a retake names its sitting', async () => {
    const f = await onboard(officer, `n08r-self-${RUN}`, 12);
    await expect(reserve(f.studentId, june, [{ offerItemId: taught, attempt: 'first', mode: 'self_study' }]))
      .rejects.toThrow('Subjects can only be taken outside school when retaking or when the school does not offer them');
    await expect(reserve(f.studentId, june, [{ offerItemId: selfOnly, attempt: 'first', mode: 'in_school', teacherId }]))
      .rejects.toThrow(/self-study only/);
    const [line] = await reserve(f.studentId, june, [{ offerItemId: selfOnly, attempt: 'first', mode: 'self_study' }]);
    expect((await lineOf(line!.id)).mode).toBe('self_study');
    await expect(reserve(f.studentId, june, [{ offerItemId: taught, attempt: 'retake', mode: 'self_study' }]))
      .rejects.toThrow(/names the sitting it follows/);
    const [retake] = await reserve(f.studentId, june, [{ offerItemId: taught, attempt: 'retake', mode: 'self_study', priorSittingSeriesId: camNovRecent, priorSittingSource: 'declared_by_desk' }]);
    expect((await lineOf(retake!.id)).attempt).toBe('retake');
  });
});

describe('08n: the enrolment per unit (§3.2, §10: F1 reads it)', () => {
  it("a line of an item entering units is enrolled per unit with its item's teacher; the teaching demand groups per unit", async () => {
    const adm = await admin('n08u');
    const officer = await staff(adm, 'finance_officer', 'n08u');
    const t1 = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher U1 (08n ${RUN})` } })))!.id;
    const t2 = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher U2 (08n ${RUN})` } })))!.id;
    const june = (await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: Y + 1, label: `n08u-${RUN}`, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + days(40)).toISOString(),
      },
    })))!.id;
    const series = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `n08u-${RUN}`, entryDeadline: new Date(Date.now() + days(50)) } })))!.id;
    const sub = await subject(adm, `RWN-UNI-${RUN}`, `Units subject (08n ${RUN})`, { course: 1000, registration: 300 });
    const unit = async (code: string) => (await apiResponse(adm.api.v1.catalogue.units.$post({ json: { boardCode: 'cambridge', code: `${code}-${RUN}`, title: code, unitLevel: 'igcse', kind: 'component' } })))!.id;
    const [u1, u2] = [await unit('UNI1'), await unit('UNI2')];
    await apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId: series }, json: { rows: [u1, u2].map((keyId) => ({ keyKind: 'unit' as const, keyId, amount: 150, provisional: false })) } }));
    const paper = (label: string, unitId: string, teacherId: string) => ({
      label, kind: 'unit' as const, enters: { kind: 'units' as const, unitIds: [unitId] }, boardSeriesId: series, availability: 'open' as const, requiredInSeries: false,
      teachers: [{ teacherId, mode: 'in_school' as const }],
    });
    const o = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: june }, json: { subjectId: sub, courseFee: 1000, teachers: [{ teacherId: t1, mode: 'in_school' }, { teacherId: t2, mode: 'in_school' }], items: [paper('P1', u1, t1), paper('P2', u2, t2)] },
    })))!;
    const f = await onboard(officer, `n08u-${RUN}`, 11);
    // Each paper names its own teacher; a paper's line may not name the other's.
    await expect(reserve(f.studentId, june, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId: t2 }])).rejects.toThrow(/The chosen teacher is not linked to/);
    await reserve(f.studentId, june, [
      { offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId: t1 },
      { offerItemId: o.items[1]!, attempt: 'first', mode: 'in_school', teacherId: t2 },
    ]);
    const years = await apiResponse(adm.api.v1.academic.years.$get());
    const yearId = years.find((y) => y.startYear === Y)?.id
      ?? (await apiResponse(adm.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } })))!.id;
    const r = await apiResponse(adm.api.v1.enrolments.bulk.$post({ json: { academicYearId: yearId, source: 'registrations', studentIds: [f.studentId], subjectMap: [], exclude: [], commit: true } }));
    expect(r.summary).toMatchObject({ created: 2 });
    expect(await sql(`select unit_id, teacher_id, mode from course_enrolment where student_id = $1 and subject_id = $2 and ended_on is null order by unit_id`, [f.studentId, sub]))
      .toEqual([{ unit_id: u1, teacher_id: t1, mode: 'in_school' }, { unit_id: u2, teacher_id: t2, mode: 'in_school' }].sort((a, b) => a.unit_id.localeCompare(b.unit_id)));
    // Again: nothing new (one open enrolment per student, unit and year).
    expect((await apiResponse(adm.api.v1.enrolments.bulk.$post({ json: { academicYearId: yearId, source: 'registrations', studentIds: [f.studentId], subjectMap: [], exclude: [], commit: true } }))).summary)
      .toMatchObject({ created: 0 });
    // F1's contract: a group per (subject, unit, teacher).
    const demand = await apiResponse(adm.api.v1.enrolments['teaching-demand'].$get({ query: { academicYearId: yearId } }));
    expect(demand.filter((g) => g.subjectId === sub).map((g) => [g.unitId, g.teacherId, g.students.map((x) => x.studentId)]).sort())
      .toEqual([[u1, t1, [f.studentId]], [u2, t2, [f.studentId]]].sort());
  });
});

describe('08n: grade 10 in bulk (A-15) and due dates (§3.1)', () => {
  it('the preview lists, the commit registers the core offers with the school consent once, a second commit changes nothing; a family reserving alone must include the core', async () => {
    const adm = await admin('n08g');
    const coordinator = await staff(adm, 'coordinator', 'n08g');
    const officer = await staff(adm, 'finance_officer', 'n08g');
    const teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher G (08n ${RUN})` } })))!.id;
    // A June session of this academic year: grade 10 sits it.
    const s = await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: Y + 1, label: `n08g-${RUN}`, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + days(40)).toISOString(),
      },
    }));
    const series = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `n08g-${RUN}`, entryDeadline: new Date(Date.now() + days(50)) } })))!.id;
    const core: string[] = [];
    for (const n of ['Maths', 'English']) {
      const sub = await subject(adm, `RWN-G${n}-${RUN}`, `${n} core (08n ${RUN})`, { course: 1000, registration: 300 }, { isCore: true });
      await apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId: series }, json: { rows: [{ keyKind: 'subject', keyId: sub, amount: 300, provisional: false }] } }));
      await apiResponse(coordinator.api.v1.sessions[':id'].offers.$post({
        param: { id: s.id }, json: { subjectId: sub, courseFee: 1000, grade10Core: true, teachers: [{ teacherId, mode: 'in_school' }], items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: series, availability: 'open', requiredInSeries: false }] },
      }));
      core.push(sub);
    }
    const a = await onboard(officer, `n08g-a-${RUN}`, 10);
    const b = await onboard(officer, `n08g-b-${RUN}`, 10);
    const lone = await onboard(officer, `n08g-lone-${RUN}`, 10);
    // A family alone must reserve every core offer (the grade-10 rule, A-05).
    const alone = await refused(lone.parent.api.v1.registrations.direct.$post({ json: { sessionId: s.id, subjectIds: [core[0]!], studentId: lone.studentId } }));
    expect(alone.error).toMatch(/^Grade 10 June session requires all core subjects\. Missing: /);

    const ids = [a.studentId, b.studentId];
    const preview = await apiResponse(coordinator.api.v1.sessions[':id'].grade10.preview.$post({ param: { id: s.id }, json: { studentIds: ids } }));
    expect(preview.totals).toMatchObject({ students: 2, toRegister: 2, lines: 4 });
    expect(Number((await one<{ n: string }>(`select count(*) as n from registration where session_id = $1`, [s.id])).n)).toBe(0);
    const commit = await apiResponse(coordinator.api.v1.sessions[':id'].grade10.commit.$post({ param: { id: s.id }, json: { studentIds: ids } }));
    expect(commit).toMatchObject({ students: 2, lines: 4, failed: [] });
    const lines = await sql<{ id: string; status: string; student_id: string }>(`select id, status, student_id from registration where session_id = $1 order by student_id, subject_id`, [s.id]);
    expect(lines.map((l) => l.status)).toEqual(['pending_payment', 'pending_payment', 'pending_payment', 'pending_payment']);
    // Each line carries the school's two consent rows (the family's come at checkout: step B).
    expect(Number((await one<{ n: string }>(`select count(*) as n from registration_consent c join registration r on r.id = c.registration_id where r.session_id = $1 and c.channel = 'school'`, [s.id])).n)).toBe(8);
    await audited(ids, ['GRADE10_BULK_COMMITTED', 'GRADE10_BULK_COMMITTED']);
    // Again: nothing to do.
    const again = await apiResponse(coordinator.api.v1.sessions[':id'].grade10.commit.$post({ param: { id: s.id }, json: { studentIds: ids } }));
    expect(again).toMatchObject({ students: 0, lines: 0 });
    expect(Number((await one<{ n: string }>(`select count(*) as n from registration where session_id = $1`, [s.id])).n)).toBe(4);
  });

  it("a line is due at the session's payment date, capped by its series' deadline; one reserved after the payment date gets the grace", async () => {
    const adm = await admin('n08d');
    const officer = await staff(adm, 'finance_officer', 'n08d');
    const teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher D (08n ${RUN})` } })))!.id;
    const payDue = new Date(Date.now() + days(20));
    const s = await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: Y + 1, label: `n08d-${RUN}`, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: payDue.toISOString(),
      },
    }));
    const mk = async (label: string, entryDeadline: Date) => (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label, entryDeadline } })))!.id;
    const late = await mk(`n08d-late-${RUN}`, new Date(Date.now() + days(50)));
    const early = await mk(`n08d-early-${RUN}`, new Date(Date.now() + days(10)));
    const items: string[] = [];
    for (const [i, seriesId] of [late, early].entries()) {
      const sub = await subject(adm, `RWN-D${i}-${RUN}`, `Due ${i} (08n ${RUN})`, { course: 1000, registration: 300 });
      await apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId }, json: { rows: [{ keyKind: 'subject', keyId: sub, amount: 300, provisional: false }] } }));
      items.push((await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
        param: { id: s.id }, json: { subjectId: sub, courseFee: 1000, teachers: [{ teacherId, mode: 'in_school' }], items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: seriesId, availability: 'open', requiredInSeries: false }] },
      })))!.items[0]!);
    }
    const f = await onboard(officer, `n08d-${RUN}`, 11);
    const [onTime, capped] = await reserve(f.studentId, s.id, [
      { offerItemId: items[0]!, attempt: 'first', mode: 'in_school', teacherId },
      { offerItemId: items[1]!, attempt: 'first', mode: 'in_school', teacherId },
    ]);
    expect(new Date((await lineOf(onTime!.id)).due_at).getTime()).toBe(payDue.getTime());
    const earlyDeadline = new Date((await one<{ d: string }>(`select entry_deadline as d from board_series where id = $1`, [early])).d);
    expect(new Date((await lineOf(capped!.id)).due_at).getTime()).toBe(earlyDeadline.getTime());

    // The payment date moves into the past: a line reserved now is due a grace after it is made.
    await apiResponse(adm.api.v1.sessions[':id'].$put({ param: { id: s.id }, json: { paymentDueAt: new Date(Date.now() + 60_000), reason: 'payment date moved' } }));
    await sql(`update registration_session set payment_due_at = now() - interval '1 day' where id = $1`, [s.id]);
    const g = await onboard(officer, `n08d-grace-${RUN}`, 11);
    const before = Date.now();
    const [graced] = await reserve(g.studentId, s.id, [{ offerItemId: items[0]!, attempt: 'first', mode: 'in_school', teacherId }]);
    const { getSetting } = await import('../src/services/settings.services');
    const grace = await getSetting('payment.graceDays');
    const due = new Date((await lineOf(graced!.id)).due_at).getTime();
    expect(due).toBeGreaterThanOrEqual(before + days(grace) - 5_000);
    expect(due).toBeLessThanOrEqual(Date.now() + days(grace) + 5_000);
  });
});
