import { describe, it, expect, beforeAll, vi } from 'vitest';
import { apiResponse, academicYearStartOf, type LineInputType } from '@repo/validations';
import {
  admin, staff, onboard, subject, refused, one, sql, audited, money, futureWindow, runPaymentDeadlines, runSessionRecovery,
  runSessionScheduler, schoolToday, notified, notificationsFor, waitFor, type Client, reservationOf, pauseAtAudits, lockWaiters, cairoDateIn, confirmed, type Impact,
} from './helpers';

/**
 * The reservations rework, step 1 (RESERVATIONS_REWORK.md §3.1–§3.3, §4.1, §8): sessions, their
 * offerings and rows, the sitting of each row, and the per-line cut-off — every scenario set up through
 * the coordinator's routes since P1c removed the links sheet's offers, items and form routes and the fee grid.
 *
 * - A June session set up from scratch and the next June copied from it — rewritten for P1a on the
 *   coordinator's routes (COORDINATOR_REWORK.md C1–C6, D1–D3, E6): the derived name, the refund
 *   policy frozen, offerings with their teacher, course fee and rows in the session's sittings, a
 *   sitting made with no board date blocking the opening, the copy a year on with last year's prices.
 *   Its third set-up scenario (an IGCSE award's one-paper retake items from the Catalogue, keyed to
 *   their board's fee) is retired: rows come from the reference list (08y) and a one-paper retake's
 *   exam fee follows its board's rule (08za).
 * - The scenarios below were restated for P1c (offerIn): each subject an offering with its rows, each row
 *   in the session's own sitting of its board (the session's label names its sittings, so a test that dates
 *   a sitting makes it first and the row lands in it) and priced by its exam fee — the grid's old fee at the
 *   same amount; the session's prices made final. What a row enters (units, an award) and the grade-10 core
 *   flag are written by SQL as converted data holds them: no route sets them since P1c.
 * - A winter session open across several deadlines: each row cut off at its own; a Cambridge retake of
 *   the previous June reservable until the retake deadline; the sweep closing only the sitting whose
 *   deadline passed; IGCSE never in January; a winter row's November per board; the admin's move at a
 *   deadline, and a move keeping each line's price.
 * - The line rules (§3.5, v2): exclusive groups, the same entry once in a sitting across sessions, a
 *   carried row's earlier exam, self-study on a first entry, a retake's sitting.
 * - Grade 10 in bulk (A-15); due dates (§3.1); the Money tab; the known sitting on the family's read.
 * - Retired with their machinery (P1c): the fee grid's Confirm and re-pricing from a target series' grid
 *   (a move, the series correction, a board change); replace teacher's route; the item route's series change.
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

/**
 * Reserve lines as every reservation path does (the student locked first, then insertLines), with
 * the family's two consent rows the paths write since step B (a line without them is never confirmed).
 */
async function reserve(studentId: string, sessionId: string, lines: Line[], status: 'pending_payment' | 'preregistered' | 'pending_approval' = 'pending_payment') {
  const { db } = await import('@repo/db');
  const { insertLines } = await import('../src/services/line.services');
  const { writeConsents } = await import('../src/services/reservation.services');
  const { assertMayRegisterForInTx } = await import('../src/services/eligibility.services');
  return db.transaction(async (tx) => {
    const eligibility = await assertMayRegisterForInTx(tx, studentId, sessionId);
    const made = await insertLines(tx, { studentId, sessionId, lines: lines as LineInputType[], status, requestedBy: studentId, eligibility });
    await writeConsents(tx, made.map((r) => r.id), { channel: 'app', confirmedBy: studentId });
    return made;
  });
}
const lineOf = async (id: string) => one<{
  status: string; board_series_id: string; price: string; course: string; board: string; due_at: string; attempt: string; mode: string; provisional: boolean;
}>(`select status, board_series_id, price_at_registration as price, course_fee_at_registration as course, registration_fee_at_registration as board,
    due_at, attempt, mode, price_provisional as provisional from registration where id = $1`, [id]);

type OfferingBody = Parameters<Client['api']['v1']['sessions'][':id']['offerings'][':offeringId']['$put']>[0]['json'];
type RowBody = NonNullable<OfferingBody['rows']>[number];
/** The usual cells (D4): first entry in school, retake in school and in self study. */
const OPEN = { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false };

/**
 * Offer a subject this file made in a session the way the coordinator does (P1c: the offers, items and form routes
 * and the fee grid left): the subject "not on the list" by its code, switched on (added to an open session it starts
 * off), its course fee, its teachers and its rows. A row lands in the session's own sitting of its board — the one a
 * test dated beforehand with `board-series`, else one made with no dates. Returns the offering, its rows as saved,
 * a row's id by its label, and the first row's id.
 */
async function offerIn(who: Client, sessionId: string, subjectId: string, o: { courseFee: number; teachers?: string[]; rows: RowBody[] }) {
  const s = await one<{ council: 'cambridge' | 'pearson_edexcel' | 'oxford'; name: string; code: string; level: string }>(
    `select council, name, code, qualification_level as level from subject where id = $1`, [subjectId]);
  const igcse = s.level === 'igcse';
  const made = await apiResponse(who.api.v1.sessions[':id'].offerings.$post({
    param: { id: sessionId }, json: { custom: { board: s.council, name: s.name, level: igcse ? 'igcse' : 'as_al', group: igcse ? 'O.L.' : 'A.S./A.L.', code: s.code } },
  }));
  const saved = await apiResponse(who.api.v1.sessions[':id'].offerings[':offeringId'].$put({
    param: { id: sessionId, offeringId: made.id },
    json: { accepting: true, courseFee: o.courseFee, teachers: (o.teachers ?? []).map((teacherId) => ({ teacherId, online: false, external: false })), rows: o.rows },
  }));
  expect(saved.saved).toBe(true);
  const rows = saved.offering.rows;
  return { id: made.id, rows, first: rows[0]!.id, row: (label: string) => rows.find((r) => r.label === label)!.id };
}

/** The session's prices made final (E6), its counts sent back when it answers them first: its lines are payable. */
const pricesFinal = (who: Client, sessionId: string) =>
  confirmed((expected?: Impact) => apiResponse(who.api.v1.sessions[':id']['prices-final'].$put({ param: { id: sessionId }, json: { final: true, ...(expected ? { expected } : {}) } })));

describe('08n: sessions and offerings, set up as the coordinator sets them up', () => {
  let adm: Client, coordinator: Client;
  let teacherId: string;
  let june1: string;
  const offering: Record<string, string> = {};
  const label = `n08a-${RUN}`;
  const day = days(1);
  const cells = { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false };

  type Body = Parameters<Client['api']['v1']['sessions'][':id']['offerings'][':offeringId']['$put']>[0]['json'];
  const put = (sessionId: string, offeringId: string, json: Body) =>
    apiResponse(coordinator.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: sessionId, offeringId }, json }));
  const sessionOf = (id: string) => apiResponse(coordinator.api.v1.sessions[':id'].$get({ param: { id } }));

  beforeAll(async () => {
    adm = await admin('n08s');
    coordinator = await staff(adm, 'coordinator', 'n08s');
    teacherId = (await apiResponse(coordinator.api.v1.teachers.$post({ json: { name: `Samir Adel ${RUN}`, kind: 'person', confirmed: true } })))!.id;
  });

  it("a June session from scratch: its derived name and the June refund policy frozen on it; a subject added with its teacher and course fee, its row in the session's June sitting; not offered until its exam fee is set; a sitting with no board date blocks opening until the admin gives it", async () => {
    const s = await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'june', year: Y + 1, label } }));
    june1 = s.id;
    expect(s.name).toBe(`June ${Y + 1} — ${label}`);
    expect(s).toMatchObject({ sessionType: 'june', seriesYear: Y + 1, status: 'draft' });
    // The refund policy is the June default, frozen on the session (§3.9).
    const { getSetting } = await import('../src/services/settings.services');
    expect(s.refundPolicy).toEqual(await getSetting('refund.defaultPolicy.june'));
    expect((await sessionOf(june1)).offerings).toEqual([]);

    // English, not on the reference list here: its teacher, its course fee, all papers ticked — the exam fee not yet.
    const en = await apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: june1 }, json: { custom: { board: 'cambridge', name: `English (08n ${RUN})`, level: 'igcse', group: 'O.L.' } } }));
    offering.english = en.id;
    await audited([en.id], ['SESSION_OFFER_CREATED']);
    let saved = await put(june1, en.id, {
      courseFee: 1000, teachers: [{ teacherId, online: false, external: false }],
      rows: [{ kind: 'all_papers', referenceCodes: [`RWN-EN-${RUN}`], cells }],
    });
    const row = saved.offering.rows[0]!;
    expect([row.kind, row.sitting, row.series?.month, row.series?.year, row.series?.label]).toEqual(['all_papers', 'june', 'june', Y + 1, label]);
    expect(saved.offering.teachers.map((t) => t.teacherId)).toEqual([teacherId]);
    // Its sitting is attached to the session by the row.
    expect(await sql(`select 1 as one from session_board_series where session_id = $1 and board_series_id = $2`, [june1, row.series!.id])).toEqual([{ one: 1 }]);
    // E6: a ticked row with no exam fee keeps the subject from families, and the check list says so.
    expect(saved.offering).toMatchObject({ offeredToFamilies: false, priceNotSet: [row.id] });
    expect((await sessionOf(june1)).checkList.filter((c) => c.offeringId === en.id).map((c) => c.code)).toEqual(expect.arrayContaining(['price_not_set', 'not_on_the_list']));
    saved = await put(june1, en.id, { rows: [{ id: row.id, kind: 'all_papers', examFee: 300, cells }] });
    expect(saved.offering).toMatchObject({ offeredToFamilies: true, priceNotSet: [] });

    // An OxfordAQA subject: its June sitting is made when its row lands in it, with no dates — the check list
    // blocks opening on it until the admin gives its board date (C6).
    const ox = await apiResponse(coordinator.api.v1.sessions[':id'].offerings.$post({ param: { id: june1 }, json: { custom: { board: 'oxford', name: `Oxford subject (08n ${RUN})`, level: 'igcse', group: 'O.L.' } } }));
    offering.oxford = ox.id;
    const oxRow = (await put(june1, ox.id, {
      courseFee: 900, teachers: [{ teacherId, online: false, external: false }],
      rows: [{ kind: 'all_papers', referenceCodes: [`RWN-OX-${RUN}`], examFee: 250, cells }],
    })).offering.rows[0]!;
    expect(oxRow.series).toMatchObject({ month: 'june', year: Y + 1, label, entryDeadline: null, hasBoardDate: false });
    const s1 = await sessionOf(june1);
    expect(s1.blocked).toBe(true);
    expect(s1.checkList.filter((c) => c.code === 'sitting_no_board_date').map((c) => c.seriesId)).toContain(oxRow.series!.id);
    expect((await refused(coordinator.api.v1.sessions[':id'].open.$post({ param: { id: june1 } }))).status).toBe(409);
    for (const c of s1.checkList.filter((x) => x.code === 'sitting_no_board_date')) {
      await apiResponse(adm.api.v1.reference.sittings[':id']['board-date'].$put({ param: { id: c.seriesId! }, json: { entryDeadline: cairoDateIn(120) } }));
    }
    // The default dates block too until she sets them or keeps them (C5).
    expect((await sessionOf(june1)).checkList.filter((c) => c.severity === 'blocks').map((c) => c.code)).toEqual(['dates_to_check']);
    await apiResponse(coordinator.api.v1.sessions[':id'].$put({ param: { id: june1 }, json: { datesConfirmed: true } }));
    expect((await sessionOf(june1)).blocked).toBe(false);
  });

  it("the next June copied from it (C3): its subjects, teachers and rows in the next year's sitting, last year's prices not final; a subject whose teacher left comes with none, on the check list; audited; a copy is of the same type", async () => {
    // The Oxford subject's teacher is gone before the copy: "who teaches it?".
    await put(june1, offering.oxford!, { teachers: [] });
    const s = await apiResponse(coordinator.api.v1.sessions.$post({ json: { type: 'june', year: Y + 2, label, copyFromSessionId: june1 } }));
    expect(s.name).toBe(`June ${Y + 2} — ${label}`);
    expect(s).toMatchObject({ status: 'draft', pricesFinal: false, copiedFromSessionId: june1 });
    expect(s.copy).toMatchObject({ offerings: 2, yearsMoved: 1, skipped: [] });
    const next = await sessionOf(s.id);
    const en = next.offerings.find((o) => o.subject.name === `English (08n ${RUN})`)!;
    expect(en).toMatchObject({ courseFee: 1000, offeredToFamilies: true });
    expect(en.teachers.map((t) => t.teacherId)).toEqual([teacherId]);
    expect(en.rows.map((r) => [r.kind, r.examFee, r.series?.month, r.series?.year, r.series?.label])).toEqual([['all_papers', 300, 'june', Y + 2, label]]);
    const ox = next.offerings.find((o) => o.subject.name === `Oxford subject (08n ${RUN})`)!;
    expect(ox.teachers).toEqual([]);
    expect(next.checkList.filter((c) => c.offeringId === ox.id).map((c) => c.code)).toContain('no_teacher');
    expect(next.checkList.map((c) => c.code)).toContain('last_years_prices');
    expect(await one(`select new_data->>'fromSessionId' as "from", (new_data->>'offerings')::int as offerings from audit_log where action = 'SESSION_COPIED' and entity_id = $1`, [s.id]))
      .toEqual({ from: june1, offerings: 2 });
    // A session copies from one of its own kind only.
    expect((await refused(coordinator.api.v1.sessions.$post({ json: { type: 'winter', year: Y + 1, label, copyFromSessionId: june1 } }))).status).toBe(400);
  });
});
describe('08n: a winter session, each row cut off at its own deadline (§3.3)', () => {
  let adm: Client, officer: Client;
  let teacherId: string;
  let w: string;
  let ial: string, phys: string, igEn: string, igPea: string;
  let peaNov: string, camNov: string, jan: string, camJune: string, camNovBefore: string, peaOct: string;
  let ialOffering: string, physOffering: string;
  let ialNov: string, ialJan: string, physNov: string, enNov: string;
  let retakeLine: string;

  /** A sitting of this session's label (its own sittings), dated: a row of the session placed in that sitting lands in it. */
  const series = async (boardCode: 'cambridge' | 'pearson_edexcel', month: 'june' | 'october' | 'november' | 'january', year: number, dates: { entryDeadline?: Date; retakeDeadline?: Date; examsStart?: string } = {}) =>
    (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode, month, year, label: `n08w-${RUN}`, ...dates } })))!.id;
  const seriesOfRow = async (itemId: string) => (await one<{ s: string }>(`select board_series_id as s from session_offer_item where id = $1`, [itemId])).s;
  const view = (offeringId: string) => apiResponse(adm.api.v1.sessions[':id'].offerings[':offeringId'].$get({ param: { id: w, offeringId } }));

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
    peaNov = await series('pearson_edexcel', 'november', Y, { entryDeadline: new Date(now + days(5)) });
    camNov = await series('cambridge', 'november', Y, { entryDeadline: new Date(now + days(6)), retakeDeadline: new Date(now + days(20)) });
    jan = await series('pearson_edexcel', 'january', Y + 1, { entryDeadline: new Date(now + days(30)) });
    // Two Cambridge sittings on record before November: June (the previous sitting) and the November before; and
    // Pearson's October, the sitting before its November.
    camJune = await series('cambridge', 'june', Y);
    camNovBefore = await series('cambridge', 'november', Y - 1);
    peaOct = await series('pearson_edexcel', 'october', Y);
    // IAL Maths as the coordinator sets it up: a row in November and one in January, each at the grid's old fee as its
    // exam fee. (Its "November" is Pearson's October where the reference data says the board sits A.S./A.L. in October —
    // 08u "decision 2 in her words"; this file loads no reference sitting for the year, so the row sits Pearson's
    // November: the two sittings and their deadlines are what this scenario needs, as October and January were.)
    const ialO = await offerIn(adm, w, ial, { courseFee: 2000, teachers: [teacherId], rows: [
      { kind: 'custom', name: 'IAL November', sitting: 'november', examFee: 800, cells: OPEN },
      { kind: 'custom', name: 'IAL January', sitting: 'january', examFee: 800, cells: OPEN },
    ] });
    [ialOffering, ialNov, ialJan] = [ialO.id, ialO.row('IAL November'), ialO.row('IAL January')];
    const physO = await offerIn(adm, w, phys, { courseFee: 1500, teachers: [teacherId], rows: [{ kind: 'all_papers', sitting: 'november', examFee: 600, cells: OPEN }] });
    [physOffering, physNov] = [physO.id, physO.first];
    enNov = (await offerIn(adm, w, igEn, { courseFee: 1000, teachers: [teacherId], rows: [{ kind: 'all_papers', sitting: 'november', examFee: 300, cells: OPEN }] })).first;
    // Each row sits in the session's sitting dated above.
    expect([await seriesOfRow(ialNov), await seriesOfRow(ialJan), await seriesOfRow(physNov), await seriesOfRow(enNov)]).toEqual([peaNov, jan, camNov, camNov]);
    await pricesFinal(adm, w);
  });

  it("an O.L. row is refused January (IGCSE sits neither October nor January); each winter row sits in the session's November or January sitting of its board; the defaults per board", async () => {
    const o = await offerIn(adm, w, igPea, { courseFee: 1000, teachers: [teacherId], rows: [{ kind: 'all_papers', cells: OPEN }] });
    // Its default: Pearson's November (an O.L. subject sits June and November).
    const row = o.rows[0]!;
    expect([row.sitting, row.series?.month]).toEqual(['november', 'november']);
    const r = await refused(adm.api.v1.sessions[':id'].offerings[':offeringId'].$put({
      param: { id: w, offeringId: o.id }, json: { rows: [{ id: row.id, kind: 'all_papers', sitting: 'january', cells: OPEN }] },
    }));
    expect(r).toEqual({ status: 409, error: expect.stringMatching(/IGCSE/) });
    expect(await one(`select bs.month from session_offer_item i join board_series bs on bs.id = i.board_series_id where i.id = $1`, [row.id])).toEqual({ month: 'november' });
    // The coordinator's November and January, each the session's sitting of the row's board (dated in beforeAll).
    expect((await view(ialOffering)).rows.map((x) => [x.label, x.sitting, x.series?.month, x.series?.id])).toEqual([
      ['IAL November', 'november', 'november', peaNov], ['IAL January', 'january', 'january', jan],
    ]);
    expect((await view(physOffering)).rows.map((x) => [x.sitting, x.series?.month, x.series?.id])).toEqual([['november', 'november', camNov]]);
    // The per-board defaults of an AS item in a winter session (§3.3; the series correction still places by them).
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

  it("November's deadline passes inside the open session: November's row takes no new line, January's does; the family's read shows November's row closed and January's open at its price; the sweep closes November's waiting lines only", async () => {
    const a = await onboard(officer, `n08w-oct-a-${RUN}`, 12);
    const b = await onboard(officer, `n08w-oct-b-${RUN}`, 12);
    const [aNov] = await reserve(a.studentId, w, [{ offerItemId: ialNov, attempt: 'first', mode: 'in_school', teacherId }]);
    const [bJan] = await reserve(b.studentId, w, [{ offerItemId: ialJan, attempt: 'first', mode: 'in_school', teacherId }]);
    // A deadline before the session's end is accepted (the rule that refused it is gone).
    const end = new Date((await one<{ end: string }>(`select end_date as "end" from registration_session where id = $1`, [w])).end);
    await apiResponse(adm.api.v1['board-series'][':id'].$put({ param: { id: peaNov }, json: { entryDeadline: new Date(Date.now() + days(4)), reason: 'board key dates' } }));
    expect(new Date((await one<{ d: string }>(`select entry_deadline as d from board_series where id = $1`, [peaNov])).d).getTime()).toBeLessThan(end.getTime());
    // November's deadline passes (moved with SQL: the API takes only future deadlines).
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [peaNov]);
    const c = await onboard(officer, `n08w-oct-c-${RUN}`, 12);
    await expect(reserve(c.studentId, w, [{ offerItemId: ialNov, attempt: 'first', mode: 'in_school', teacherId }]))
      .rejects.toThrow(/deadline/);
    const [cJan] = await reserve(c.studentId, w, [{ offerItemId: ialJan, attempt: 'first', mode: 'in_school', teacherId }]);
    expect((await lineOf(cJan!.id)).board_series_id).toBe(jan);
    // The family's read (offerings → rows, P1c): November's row closed, January's open, each in its sitting, with its price.
    const read = await apiResponse(c.parent.api.v1.registrations.offers.$get({ query: { sessionId: w, studentId: c.studentId } }));
    expect(read.session.pricesFinal).toBe(true);
    const byLabel = new Map(read.offerings.find((o) => o.id === ialOffering)!.rows.map((r) => [r.label.en, r]));
    expect(byLabel.get('IAL November')).toMatchObject({ id: ialNov, sitting: 'november', closed: true });
    expect(byLabel.get('IAL January')).toMatchObject({ id: ialJan, sitting: 'january', closed: false });
    expect(byLabel.get('IAL January')!.options.find((p) => p.attempt === 'first' && p.mode === 'in_school')!.price).toEqual({ total: 2800, examFee: 800, courseFee: 2000 });
    // The sweep: November's waiting line expires at its deadline; January's stay.
    await runPaymentDeadlines();
    expect((await lineOf(aNov!.id)).status).toBe('expired');
    expect(await one(`select new_data->>'reason' as reason from audit_log where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [aNov!.id])).toEqual({ reason: 'entry_deadline' });
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
    retakeLine = line!.id;
    // The family's read (offerings → rows, P1c) closes an option at its board deadline: the first entry at the entry
    // deadline, a retake at the latest deadline an earlier sitting it may follow gives — the retake deadline, as a retake
    // of the previous June is still taken until then (above). The row reads open (the review of P1c, (a)).
    const listed = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: w, studentId: f.studentId } }));
    const row = listed.offerings.find((o) => o.id === physOffering)!.rows.find((r) => r.id === physNov)!;
    expect(row).toMatchObject({ sitting: 'november', closed: false });
    expect(row.options.map((o) => [o.attempt, o.mode, o.closed])).toEqual([['first', 'in_school', true], ['retake', 'in_school', false], ['retake', 'self_study', false]]);
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

  it("a retake whose declared sitting the school rejected is a first entry for the board: its deadline is the entry deadline, not the retake deadline (§3.5)", async () => {
    const { db } = await import('@repo/db');
    const { effectiveDeadlineFor } = await import('../src/services/deadline.services');
    const raw = await one<{ entry: string; retake: string }>(`select entry_deadline as entry, retake_deadline as retake from board_series where id = $1`, [camNov]);
    const s = { entry: new Date(raw.entry), retake: new Date(raw.retake) };
    expect(s.retake.getTime()).toBeGreaterThan(s.entry.getTime());
    const line = { boardSeriesId: camNov, attempt: 'retake', priorSittingSeriesId: camJune, declarationRejected: false };
    expect(await effectiveDeadlineFor(db, line)).toEqual({ at: s.retake, kind: 'retake' });
    expect(await effectiveDeadlineFor(db, { ...line, declarationRejected: true })).toEqual({ at: s.entry, kind: 'entry' });
    // The rule in SQL: the fourth argument (step B passes the line's declaration_rejected); three arguments read as not rejected.
    const inSql = async (rejected: string) => {
      const r = await one<{ at: string; kind: string }>(`select line_effective_deadline('retake', $1, $2${rejected}) as at, line_effective_deadline_kind('retake', $3, $4${rejected}) as kind`, [camJune, camNov, camJune, camNov]);
      return { at: new Date(r.at), kind: r.kind };
    };
    expect(await inSql(', true')).toEqual({ at: s.entry, kind: 'entry' });
    expect(await inSql(', false')).toEqual({ at: s.retake, kind: 'retake' });
    expect(await inSql('')).toEqual({ at: s.retake, kind: 'retake' });
  });

  // P1b (§9.2 insertLines: the "no deadline" refusal replaced by mayReserve): with no board date there is none to pass,
  // so the line is taken; its cut-off is its due date + the session's unpaid-cancel days (it was refused).
  it("a sitting with neither an entry deadline nor an exam start takes a line, cut off at its due date + the session's days", async () => {
    // A winter session of its own label: its January sitting is made with no dates when its row lands in it.
    const bare = (await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'winter', year: Y, label: `n08w-bare-${RUN}`, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + days(40)).toISOString(),
      },
    })))!.id;
    const o = await offerIn(adm, bare, ial, { courseFee: 2000, teachers: [teacherId], rows: [{ kind: 'custom', name: 'IAL January (no dates)', sitting: 'january', examFee: 800, cells: OPEN }] });
    expect(o.rows[0]!.series).toMatchObject({ month: 'january', year: Y + 1, label: `n08w-bare-${RUN}`, entryDeadline: null, examsStart: null });
    await pricesFinal(adm, bare);
    const f = await onboard(officer, `n08w-bare-${RUN}`, 12);
    const [line] = await reserve(f.studentId, bare, [{ offerItemId: o.first, attempt: 'first', mode: 'in_school', teacherId }]);
    const cut = await one<{ cut: string; due: string; days: number }>(`select line_cut_off(r.due_at, r.session_id, r.attempt, r.prior_sitting_series_id, r.board_series_id, r.declaration_rejected) as cut,
      r.due_at as due, s.unpaid_cancel_days as days from registration r join registration_session s on s.id = r.session_id where r.id = $1`, [line!.id]);
    expect(new Date(cut.cut).getTime()).toBe(new Date(cut.due).getTime() + cut.days * days(1));
  });

  // Restated on Pearson's sittings (P1c): a row's sitting is the session's own, so one subject has rows in two sittings
  // only where its board sits twice in the session (IAL: November and January), and the move goes between them.
  it("the admin's move takes a retake into a sitting past its entry deadline while the retake deadline is ahead; a first entry not; the moved line keeps its price", async () => {
    // November's entry deadline passed above; a retake of Pearson's previous sitting (October) goes in until a later date.
    await apiResponse(adm.api.v1['board-series'][':id'].$put({ param: { id: peaNov }, json: { retakeDeadline: new Date(Date.now() + days(15)), reason: 'retakes of October go in later' } }));
    const h = await onboard(officer, `n08w-mv-${RUN}`, 12);
    const k = await onboard(officer, `n08w-mv2-${RUN}`, 12);
    const [retake] = await reserve(h.studentId, w, [{ offerItemId: ialJan, attempt: 'retake', mode: 'in_school', teacherId, priorSittingSeriesId: peaOct, priorSittingSource: 'declared_by_desk' }]);
    const [first] = await reserve(k.studentId, w, [{ offerItemId: ialJan, attempt: 'first', mode: 'in_school', teacherId }]);
    const move = (id: string) => adm.api.v1.sessions[':id']['board-series'].move.$post({ param: { id: w }, json: { registrationIds: [id], boardSeriesId: peaNov, reason: 'sat with the others in November' } });
    expect(await apiResponse(move(retake!.id))).toMatchObject({ moved: 1 });
    expect(await one(`select board_series_id as s, offer_item_id as item, price_at_registration::float as price from registration where id = $1`, [retake!.id]))
      .toEqual({ s: peaNov, item: ialNov, price: 2800 });
    const r = await refused(move(first!.id));
    expect(r).toEqual({ status: 400, error: expect.stringMatching(/^The registration window is not open: the exam board's entry deadline for this series \(.+\) has passed$/) });
    expect((await lineOf(first!.id)).board_series_id).toBe(jan);
  });

  // P1b (C7): A-12's switch is gone; the winter session's grade list takes graduates.
  it("a graduate may reserve the winter session: its grade list takes graduates", async () => {
    const g = await onboard(officer, `n08w-grad-${RUN}`, 12);
    // Graduated: the cohort that finished grade 12 last academic year.
    await sql(`update "user" set cohort_year = cohort_year - 1 where id = $1`, [g.studentId]);
    const [line] = await reserve(g.studentId, w, [{ offerItemId: enNov, attempt: 'retake', mode: 'in_school', teacherId, priorSittingSeriesId: camJune, priorSittingSource: 'declared_by_desk' }]);
    expect((await lineOf(line!.id)).status).toBe('pending_payment');
  });

  it('the sweep at the retake deadline closes the waiting retakes of the previous sitting (MO-10 per line)', async () => {
    await runPaymentDeadlines();
    expect((await lineOf(retakeLine)).status).toBe('pending_payment');
    await sql(`update board_series set retake_deadline = now() - interval '1 minute' where id = $1`, [camNov]);
    await runPaymentDeadlines();
    expect((await lineOf(retakeLine)).status).toBe('expired');
    // Past the retake deadline too, every option of the row is past: it reads closed.
    const h = await onboard(officer, `n08w-closed-${RUN}`, 12);
    const listed = await apiResponse(h.parent.api.v1.registrations.offers.$get({ query: { sessionId: w, studentId: h.studentId } }));
    const row = listed.offerings.find((o) => o.id === physOffering)!.rows.find((r) => r.id === physNov)!;
    expect([row.closed, row.options.map((o) => o.closed)]).toEqual([true, [true, true, true]]);
    expect(await one(`select new_data->>'reason' as reason from audit_log where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [retakeLine])).toEqual({ reason: 'entry_deadline' });
  });
});

// Retired with preregistration (C4; trail row "retired 08n capture"): "capture asks each preregistration its deadline
// first (MO-21)". No new held money exists; the board-deadline rule for money (a transfer confirmed past it goes to
// the balance in full) is stated in 08z-reserve-pay.

describe('08n: the line rules (§3.5)', () => {
  let adm: Client, officer: Client;
  let teacherId: string;
  let june: string;
  let phys: string;
  let camJune: string, camNovEarly: string, camNovRecent: string;
  let physAs: string, physAl: string, physA2: string;
  let selfOnly: string, taught: string;

  const mkSession = async (label: string) => (await apiResponse(adm.api.v1.sessions.$post({
    json: {
      type: 'june', year: Y + 1, label, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
      courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + days(40)).toISOString(),
    },
  })))!.id;
  const physCodes = { as: [`RWN-RPH-${RUN}-AS`], al: [`RWN-RPH-${RUN}-AL`], a2: [`RWN-RPH-${RUN}-A2`] };

  beforeAll(async () => {
    adm = await admin('n08r');
    officer = await staff(adm, 'finance_officer', 'n08r');
    teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher R (08n ${RUN})` } })))!.id;
    june = await mkSession(`n08r-${RUN}`);
    camJune = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `n08r-${RUN}`, entryDeadline: new Date(Date.now() + days(50)) } })))!.id;
    camNovRecent = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'november', year: Y, label: `n08r-${RUN}` } })))!.id;

    // Cambridge Physics (as the forms have it): A.S. in school; A.L.; the A.2. carried forward in self study, naming the
    // exam it carries — her list for it (D6) reaching back to November Y − 1, past the board's 13 months. A.S., A.2. and A.L.
    // are one exclusive group (D8). Each row at the grid's old fee as its exam fee.
    phys = await subject(adm, `RWN-RPH-${RUN}`, `Physics (08n rules ${RUN})`, { course: 1500, registration: 600 }, { qualificationLevel: 'a_level' });
    const o = await offerIn(adm, june, phys, { courseFee: 1500, teachers: [teacherId], rows: [
      { kind: 'as', referenceCodes: physCodes.as, examFee: 600, cells: OPEN },
      { kind: 'al', referenceCodes: physCodes.al, examFee: 600, cells: OPEN },
      { kind: 'a2', referenceCodes: physCodes.a2, examFee: 600, cells: { firstInSchool: false, retakeInSchool: false, retakeSelfStudy: true, firstSelfStudy: true },
        allowedPriorSittings: [{ month: 'november', year: Y }, { month: 'june', year: Y }, { month: 'november', year: Y - 1 }] },
    ] });
    const byKind = (k: string) => o.rows.find((r) => r.kind === k)!;
    [physAs, physAl, physA2] = [byKind('as').id, byKind('al').id, byKind('a2').id];
    expect(byKind('as').series!.id).toBe(camJune);
    // Her list's sittings are the board's own: November Y − 1 is the earliest, beyond the carry-forward months (a warning).
    const early = byKind('a2').allowedPriorSittings.find((p) => p.month === 'november' && p.year === Y - 1)!;
    expect(early.beyondCarryForward).toBe(true);
    camNovEarly = early.id;

    // Self-study: one subject the school does not teach this cycle ("Retake (Self Study ONLY)"), one it teaches.
    const notTaught = await subject(adm, `RWN-NT-${RUN}`, `Not taught (08n rules ${RUN})`, { course: 800, registration: 300 });
    const isTaught = await subject(adm, `RWN-TA-${RUN}`, `Taught (08n rules ${RUN})`, { course: 800, registration: 300 });
    selfOnly = (await offerIn(adm, june, notTaught, { courseFee: 800, rows: [{ kind: 'all_papers', examFee: 600, cells: { firstInSchool: false, retakeInSchool: false, retakeSelfStudy: true, firstSelfStudy: false } }] })).first;
    taught = (await offerIn(adm, june, isTaught, { courseFee: 800, teachers: [teacherId], rows: [{ kind: 'all_papers', examFee: 600, cells: OPEN }] })).first;
    await pricesFinal(adm, june);
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

  // 'a first entry without its required item is refused' retired: required items left with line rules v2 (trail row
  // "retired 08n required item"). No money.

  // P1b (D6, §9.2 line rules v2): a carried row names the exam it carries; the board's carry-forward months only warn
  // (the family page), so a sitting outside them is taken (it was refused).
  it("a carried row needs the exam it carries; a sitting outside the board's carry-forward period is taken (the months only warn)", async () => {
    const f = await onboard(officer, `n08r-carry-${RUN}`, 12);
    await expect(reserve(f.studentId, june, [{ offerItemId: physA2, attempt: 'first', mode: 'self_study' }]))
      .rejects.toThrow(/carries an earlier exam forward: name the one it is carried from/);
    const [line] = await reserve(f.studentId, june, [{ offerItemId: physA2, attempt: 'first', mode: 'self_study', priorSittingSeriesId: camNovEarly, priorSittingSource: 'declared_by_desk' }]);
    expect(await one(`select mode, prior_sitting_series_id as prior from registration where id = $1`, [line!.id])).toEqual({ mode: 'self_study', prior: camNovEarly });
  });

  it('self-study on a first entry is refused where the school teaches the subject, and where it is "Retake (Self Study ONLY)" (the lead\'s decision of 16 Oct 2026); a retake in self-study is taken there; a retake names its sitting', async () => {
    const f = await onboard(officer, `n08r-self-${RUN}`, 12);
    await expect(reserve(f.studentId, june, [{ offerItemId: taught, attempt: 'first', mode: 'self_study' }]))
      .rejects.toThrow('Subjects can only be taken outside school when retaking or when the school does not offer them');
    await expect(reserve(f.studentId, june, [{ offerItemId: selfOnly, attempt: 'first', mode: 'in_school', teacherId }]))
      .rejects.toThrow(/is not offered as a first entry in school/);
    // Decision 1 (FEATURES_PLAN.md §6): the untaught subject's first entry in self-study is the student's exception alone (08p).
    await expect(reserve(f.studentId, june, [{ offerItemId: selfOnly, attempt: 'first', mode: 'self_study' }]))
      .rejects.toThrow(`Not taught (08n rules ${RUN}) is self study on a second entry only: name the earlier sitting, or ask for the exception`);
    const [line] = await reserve(f.studentId, june, [{ offerItemId: selfOnly, attempt: 'retake', mode: 'self_study', priorSittingSeriesId: camNovRecent, priorSittingSource: 'declared_by_desk' }]);
    expect((await lineOf(line!.id)).mode).toBe('self_study');
    await expect(reserve(f.studentId, june, [{ offerItemId: taught, attempt: 'retake', mode: 'self_study' }]))
      .rejects.toThrow(/names the sitting it follows/);
    const [retake] = await reserve(f.studentId, june, [{ offerItemId: taught, attempt: 'retake', mode: 'self_study', priorSittingSeriesId: camNovRecent, priorSittingSource: 'declared_by_desk' }]);
    expect((await lineOf(retake!.id)).attempt).toBe('retake');
  });

  // Last: it closes this describe's session. Two sessions meet in one sitting only when they share it — the next session
  // of the same June (its label) opened after the first closed (one open per cycle); the first's lines stand.
  it('the same entry twice in one sitting across two sessions is refused: the board takes one entry', async () => {
    const f = await onboard(officer, `n08r-once-${RUN}`, 12);
    await reserve(f.studentId, june, [{ offerItemId: physAs, attempt: 'first', mode: 'in_school', teacherId }]);
    await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: june }, json: { reason: 'the first round of June reservations is over' } }));
    const juneOther = await mkSession(`n08r-${RUN}`);
    const other = await offerIn(adm, juneOther, phys, { courseFee: 1500, teachers: [teacherId], rows: [{ kind: 'as', referenceCodes: physCodes.as, examFee: 600, cells: OPEN }] });
    expect(other.rows[0]!.series!.id).toBe(camJune);
    await pricesFinal(adm, juneOther);
    await expect(reserve(f.studentId, juneOther, [{ offerItemId: other.first, attempt: 'first', mode: 'in_school', teacherId }]))
      .rejects.toThrow(/is already reserved in .+: the board takes one entry/);
  });
});

describe("08n: past a line's own deadline (flags 59, 60)", () => {
  it("a family's drop of a paid line whose deadline passed is refused and sent to the desk; a sitting with no entry deadline is cut off at the start of its exams' day", async () => {
    const adm = await admin('n08x');
    const officer = await staff(adm, 'finance_officer', 'n08x');
    const teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher X (08n ${RUN})` } })))!.id;
    const label = `n08x-${RUN}`;
    const june = (await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: Y + 1, label, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + days(40)).toISOString(),
      },
    })))!.id;
    // The session's June sitting of each board, dated three ways: Cambridge's with an entry deadline, Pearson's with only
    // its exams' start, OxfordAQA's exams starting today.
    const mk = async (boardCode: 'cambridge' | 'pearson_edexcel' | 'oxford', dates: { entryDeadline?: Date; examsStart?: string }) =>
      (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode, month: 'june', year: Y + 1, label, ...dates } })))!.id;
    const dated = await mk('cambridge', { entryDeadline: new Date(Date.now() + days(20)) });
    const examsLater = await mk('pearson_edexcel', { examsStart: cairoDate(new Date(Date.now() + days(10))) });
    const examsToday = await mk('oxford', { examsStart: cairoDate(new Date()) });
    const offerOn = async (code: string, council: 'cambridge' | 'pearson_edexcel' | 'oxford', seriesId: string) => {
      const sub = await subject(adm, `RWN-X${code}-${RUN}`, `Cut-off ${code} (08n ${RUN})`, { course: 1000, registration: 300 }, { council });
      const o = await offerIn(adm, june, sub, { courseFee: 1000, teachers: [teacherId], rows: [{ kind: 'all_papers', examFee: 300, cells: OPEN }] });
      expect(o.rows[0]!.series!.id).toBe(seriesId);
      return { sub, item: o.first };
    };
    const a = await offerOn('A', 'cambridge', dated);
    const b = await offerOn('B', 'pearson_edexcel', examsLater);
    const c = await offerOn('C', 'oxford', examsToday);
    await pricesFinal(adm, june);

    // A family reserves and pays A; the board's deadline then passes: the entry is the board's.
    const f = await onboard(officer, `n08x-${RUN}`, 11);
    const [line] = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, ...(await reservationOf(june, [a.sub])), studentId: f.studentId } })))!;
    const pay = (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [line!.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } })))!.id!;
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay }, json: { instrumentUsed: 'cash' } }));
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [dated]);
    const drop = await refused(f.parent.api.v1.registrations[':id'].drop.$post({ param: { id: line!.id }, json: { reason: 'changed our mind' } }));
    expect(drop.error).toMatch(/^The entry is with the board \(its deadline, .+, has passed\): ask the finance desk to drop it$/);
    expect((await one<{ status: string }>(`select status from registration where id = $1`, [line!.id])).status).toBe('confirmed');

    // B's sitting has no entry deadline: its exams' start (Cairo) is the cut-off, and the due date is capped by it.
    const g = await onboard(officer, `n08x-b-${RUN}`, 11);
    const [lb] = await reserve(g.studentId, june, [{ offerItemId: b.item, attempt: 'first', mode: 'in_school', teacherId }]);
    const startOfExams = (await one<{ at: string }>(`select line_effective_deadline('first', null, $1) as at`, [examsLater])).at;
    expect(new Date((await one<{ d: string }>(`select due_at as d from registration where id = $1`, [lb!.id])).d).getTime()).toBe(new Date(startOfExams).getTime());
    expect(await one(`select line_effective_deadline_kind('first', null, $1) as kind`, [examsLater])).toEqual({ kind: 'exams_start' });
    // C's exams start today: past the start of the day, no line.
    await expect(reserve(g.studentId, june, [{ offerItemId: c.item, attempt: 'first', mode: 'in_school', teacherId }]))
      .rejects.toThrow(/: its exams start on .+ and its board takes no more entries$/);
  });
});

describe('08n: the enrolment per unit (§3.2, §10: F1 reads it)', () => {
  it("a line of a row entering units is enrolled per unit with its row's teacher; the teaching demand groups per unit", async () => {
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
    await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `n08u-${RUN}`, entryDeadline: new Date(Date.now() + days(50)) } }));
    const sub = await subject(adm, `RWN-UNI-${RUN}`, `Units subject (08n ${RUN})`, { course: 1000, registration: 300 });
    const unit = async (code: string) => (await apiResponse(adm.api.v1.catalogue.units.$post({ json: { boardCode: 'cambridge', code: `${code}-${RUN}`, title: code, unitLevel: 'igcse', kind: 'component' } })))!.id;
    const [u1, u2] = [await unit('UNI1'), await unit('UNI2')];
    // Two papers, each with its own teacher (D4: a row's teachers), at the grid's old fee per unit as its exam fee.
    const teacher = (teacherId: string) => [{ teacherId, online: false, external: false }];
    const o = await offerIn(adm, june, sub, { courseFee: 1000, teachers: [t1, t2], rows: [
      { kind: 'unit', name: 'P1', examFee: 150, cells: OPEN, teachers: teacher(t1) },
      { kind: 'unit', name: 'P2', examFee: 150, cells: OPEN, teachers: teacher(t2) },
    ] });
    const [p1, p2] = [o.row('P1'), o.row('P2')];
    // What each paper enters, written as converted data holds it (no route sets it since P1c).
    for (const [itemId, unitId] of [[p1, u1], [p2, u2]] as const) {
      await sql(`update session_offer_item set enters_kind = 'units' where id = $1`, [itemId]);
      await sql(`insert into session_offer_item_unit (item_id, unit_id) values ($1, $2)`, [itemId, unitId]);
    }
    await pricesFinal(adm, june);
    const f = await onboard(officer, `n08u-${RUN}`, 11);
    // Each paper names its own teacher; a paper's line may not name the other's.
    await expect(reserve(f.studentId, june, [{ offerItemId: p1, attempt: 'first', mode: 'in_school', teacherId: t2 }])).rejects.toThrow(/The chosen teacher is not linked to/);
    await reserve(f.studentId, june, [
      { offerItemId: p1, attempt: 'first', mode: 'in_school', teacherId: t1 },
      { offerItemId: p2, attempt: 'first', mode: 'in_school', teacherId: t2 },
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
    await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `n08g-${RUN}`, entryDeadline: new Date(Date.now() + days(50)) } }));
    const core: string[] = [];
    for (const n of ['Maths', 'English']) {
      const sub = await subject(adm, `RWN-G${n}-${RUN}`, `${n} core (08n ${RUN})`, { course: 1000, registration: 300 }, { isCore: true });
      const o = await offerIn(coordinator, s.id, sub, { courseFee: 1000, teachers: [teacherId], rows: [{ kind: 'all_papers', examFee: 300, cells: OPEN }] });
      // The grade-10 core flag the bulk registration reads: a parked feature no route sets since P1c, written as converted data holds it.
      await sql(`update session_offer set grade10_core = true where id = $1`, [o.id]);
      core.push(sub);
    }
    await pricesFinal(coordinator, s.id);
    const a = await onboard(officer, `n08g-a-${RUN}`, 10);
    const b = await onboard(officer, `n08g-b-${RUN}`, 10);
    const lone = await onboard(officer, `n08g-lone-${RUN}`, 10);
    // P1b (line rules v2): the grade-10 core rule left; a family alone reserves what it chooses.
    const alone = await apiResponse(lone.parent.api.v1.registrations.direct.$post({ json: { sessionId: s.id, ...(await reservationOf(s.id, [core[0]!])), studentId: lone.studentId } }));
    expect(alone).toHaveLength(1);

    const ids = [a.studentId, b.studentId];
    const preview = await apiResponse(coordinator.api.v1.sessions[':id'].grade10.preview.$post({ param: { id: s.id }, json: { studentIds: ids } }));
    expect(preview.totals).toMatchObject({ students: 2, toRegister: 2, lines: 4 });
    expect(Number((await one<{ n: string }>(`select count(*) as n from registration where session_id = $1 and student_id <> $2`, [s.id, lone.studentId])).n)).toBe(0);
    const commit = await apiResponse(coordinator.api.v1.sessions[':id'].grade10.commit.$post({ param: { id: s.id }, json: { studentIds: ids } }));
    expect(commit).toMatchObject({ students: 2, lines: 4, failed: [] });
    const lines = await sql<{ id: string; status: string; student_id: string }>(`select id, status, student_id from registration where session_id = $1 and student_id <> $2 order by student_id, subject_id`, [s.id, lone.studentId]);
    expect(lines.map((l) => l.status)).toEqual(['pending_payment', 'pending_payment', 'pending_payment', 'pending_payment']);
    // Each line carries the school's two consent rows (the family's come at checkout: step B), and
    // the refund steps they consent to, frozen from the session's policy (§2.6): refunded like any line.
    expect(Number((await one<{ n: string }>(`select count(*) as n from registration_consent c join registration r on r.id = c.registration_id where r.session_id = $1 and c.channel = 'school'`, [s.id])).n)).toBe(8);
    const policy = (await one<{ p: { steps: unknown[] } }>(`select refund_policy as p from registration_session where id = $1`, [s.id])).p;
    expect(policy.steps.length).toBeGreaterThan(0);
    expect(await sql(`select distinct refund_policy_snapshot as snap from registration where session_id = $1`, [s.id])).toEqual([{ snap: { kind: 'weeks', steps: policy.steps } }]);
    await audited(ids, ['GRADE10_BULK_COMMITTED', 'GRADE10_BULK_COMMITTED']);
    // Again: nothing to do.
    const again = await apiResponse(coordinator.api.v1.sessions[':id'].grade10.commit.$post({ param: { id: s.id }, json: { studentIds: ids } }));
    expect(again).toMatchObject({ students: 0, lines: 0 });
    expect(Number((await one<{ n: string }>(`select count(*) as n from registration where session_id = $1 and student_id <> $2`, [s.id, lone.studentId])).n)).toBe(4);
  });

  it("a line is due at the session's payment date, capped by its sitting's deadline; one reserved after the payment date gets the grace", async () => {
    const adm = await admin('n08d');
    const officer = await staff(adm, 'finance_officer', 'n08d');
    const teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher D (08n ${RUN})` } })))!.id;
    const payDue = new Date(Date.now() + days(20));
    const label = `n08d-${RUN}`;
    const s = await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: Y + 1, label, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: payDue.toISOString(),
      },
    }));
    // Two sittings of the session (its June per board): Cambridge's deadline after the payment date, Pearson's before it.
    const mk = async (boardCode: 'cambridge' | 'pearson_edexcel', entryDeadline: Date) => (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode, month: 'june', year: Y + 1, label, entryDeadline } })))!.id;
    const late = await mk('cambridge', new Date(Date.now() + days(50)));
    const early = await mk('pearson_edexcel', new Date(Date.now() + days(10)));
    const items: string[] = [];
    for (const [i, [council, seriesId]] of ([['cambridge', late], ['pearson_edexcel', early]] as const).entries()) {
      const sub = await subject(adm, `RWN-D${i}-${RUN}`, `Due ${i} (08n ${RUN})`, { course: 1000, registration: 300 }, { council });
      const o = await offerIn(adm, s.id, sub, { courseFee: 1000, teachers: [teacherId], rows: [{ kind: 'all_papers', examFee: 300, cells: OPEN }] });
      expect(o.rows[0]!.series!.id).toBe(seriesId);
      items.push(o.first);
    }
    await pricesFinal(adm, s.id);
    const f = await onboard(officer, `n08d-${RUN}`, 11);
    const [onTime, capped] = await reserve(f.studentId, s.id, [
      { offerItemId: items[0]!, attempt: 'first', mode: 'in_school', teacherId },
      { offerItemId: items[1]!, attempt: 'first', mode: 'in_school', teacherId },
    ]);
    expect(new Date((await lineOf(onTime!.id)).due_at).getTime()).toBe(payDue.getTime());
    const earlyDeadline = new Date((await one<{ d: string }>(`select entry_deadline as d from board_series where id = $1`, [early])).d);
    expect(new Date((await lineOf(capped!.id)).due_at).getTime()).toBe(earlyDeadline.getTime());

    // The payment date moves into the past: a line reserved now is due a grace after it is made.
    // (A payment date change answers the due dates it moves first: sent again with them.)
    const moving = new Date(Date.now() + 60_000);
    const { shown } = await confirmed((expected?: Impact) => apiResponse(adm.api.v1.sessions[':id'].$put({ param: { id: s.id }, json: { paymentDueAt: moving, reason: 'payment date moved', ...(expected ? { expected } : {}) } })));
    // Answered first, nothing written; then saved with the same counts.
    expect(shown).toMatchObject({ saved: false, impact: { dueDatesMoved: 2 } });
    expect(new Date((await lineOf(onTime!.id)).due_at).getTime()).toBe(moving.getTime());
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

describe('08n: the reviews of 977848d and 40c1447', () => {
  let adm: Client, officer: Client, finadmin: Client;
  let teacherId: string;
  let june: string, series: string;

  /** A June session of its own label (its own sittings), prices final. */
  const mkJune = async (label: string) => {
    const id = (await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: Y + 1, label, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + days(40)).toISOString(),
      },
    })))!.id;
    await pricesFinal(adm, id);
    return id;
  };
  /** The winter session of this academic year, of its own label, prices final. */
  const mkWinter = async (label: string) => {
    const id = (await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'winter', year: Y, label, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + days(40)).toISOString(),
      },
    })))!.id;
    await pricesFinal(adm, id);
    return id;
  };
  const mkSeries = async (boardCode: 'cambridge' | 'pearson_edexcel', month: 'june' | 'october' | 'november' | 'january', year: number, label: string, dates: { entryDeadline?: Date; examsStart?: string } = {}) =>
    (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode, month, year, label, ...dates } })))!.id;
  /** A subject offered in a session: its all-papers row in the session's own sitting, at the grid's old fee as its exam fee. */
  const offerSub = (sessionId: string, subjectId: string) =>
    offerIn(adm, sessionId, subjectId, { courseFee: 1000, teachers: [teacherId], rows: [{ kind: 'all_papers', examFee: 300, cells: OPEN }] });
  const pay = async (f: { parent: Client }, ids: string[]) => {
    const p = (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: ids, paymentMethod: 'in_school', escrowAmountToApply: 0 } })))!.id!;
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: p }, json: { instrumentUsed: 'cash' } }));
  };
  const statusOf = async (id: string) => (await one<{ status: string }>(`select status from registration where id = $1`, [id])).status;
  const studentEmail = (tag: string) => `student.${tag}@test.local`;

  beforeAll(async () => {
    adm = await admin('n08v');
    officer = await staff(adm, 'finance_officer', 'n08v');
    finadmin = await staff(adm, 'finance_admin', 'n08v');
    teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher V1 (08n ${RUN})` } })))!.id;
    series = await mkSeries('cambridge', 'june', Y + 1, `n08v-${RUN}`, { entryDeadline: new Date(Date.now() + days(30)) });
    june = await mkJune(`n08v-${RUN}`);
  });

  it("flag 1: a drop the student asked before the line's deadline cannot be approved after it; the entry is the board's", async () => {
    const sub = await subject(adm, `RWN-V1-${RUN}`, `Approve after deadline (08n ${RUN})`, { course: 1000, registration: 300 });
    expect((await offerSub(june, sub)).rows[0]!.series!.id).toBe(series);
    const f = await onboard(officer, `n08v-drop-${RUN}`, 11);
    const [line] = (await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: june, ...(await reservationOf(june, [sub])), studentId: f.studentId } })))!;
    await pay(f, [line!.id]);
    const cr = (await apiResponse(f.student.api.v1.registrations[':id']['request-drop'].$post({ param: { id: line!.id }, json: { reason: 'asked before the deadline' } })))!;
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [series]);
    try {
      const r = await refused(f.parent.api.v1['change-requests'][':id'].approve.$put({ param: { id: cr.id }, json: {} }));
      expect(r.error).toMatch(/^The entry is with the board \(its deadline, .+, has passed\): ask the finance desk to drop it$/);
      expect(await statusOf(line!.id)).toBe('confirmed');
      expect((await one<{ status: string }>(`select status from change_request where id = $1`, [cr.id])).status).toBe('pending_approval');
    } finally {
      await sql(`update board_series set entry_deadline = now() + interval '30 days' where id = $1`, [series]);
    }
  });

  // 'flag 2: IAL Biology units moved from October to January while the fees are provisional are priced from January's
  // grid, so January's Confirm makes them payable' retired with the fee grid (P1c: board_fee, its Confirm and re-pricing
  // a moved line from the target series' grid are gone). Its money outcomes now: a moved line keeps its price (this
  // file's "the admin's move keeps each line's price …"); lines made payable when the prices are final (08y "prices
  // final (E6): a line reserved before is not payable; switched on, …").

  it('a sitting with no entry deadline: the sweep closes its waiting lines at the start of its exams day (MO-10 per line)', async () => {
    const label = `n08v-ex-${RUN}`;
    const s = await mkSeries('cambridge', 'june', Y + 1, label, { examsStart: cairoDate(new Date(Date.now() + days(10))) });
    const ex = await mkJune(label);
    const sub = await subject(adm, `RWN-VEX-${RUN}`, `Exams start sweep (08n ${RUN})`, { course: 1000, registration: 300 });
    const o = await offerSub(ex, sub);
    expect(o.rows[0]!.series!.id).toBe(s);
    const f = await onboard(officer, `n08v-ex-${RUN}`, 11);
    const [line] = await reserve(f.studentId, ex, [{ offerItemId: o.first, attempt: 'first', mode: 'in_school', teacherId }]);
    await runPaymentDeadlines();
    expect(await statusOf(line!.id)).toBe('pending_payment');
    await sql(`update board_series set exams_start = (now() at time zone 'Africa/Cairo')::date - 1 where id = $1`, [s]);
    await runPaymentDeadlines();
    expect(await statusOf(line!.id)).toBe('expired');
    expect(await one(`select new_data->>'reason' as reason from audit_log where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [line!.id])).toEqual({ reason: 'entry_deadline' });
    expect(await one(`select line_effective_deadline_kind('first', null, $1) as kind`, [s])).toEqual({ kind: 'exams_start' });
  });

  // "replace teacher: every line, item and this year's class of the teacher who leaves moves to the other, audited"
  // retired with its route (P1c: POST /sessions/:id/offers/:offerId/replace-teacher left with the links sheet). No money.

  // 'the scheduler opens a session after one of its series has passed its deadline: capture refunds …' retired (P1b:
  // no automatic opening, C4; no preregistration; trail row "retired 08n scheduler opens"). Its money outcome — what
  // was paid for an entry the board no longer takes comes back in full — is 08z-reserve-pay's confirmation after the
  // board deadline (to the balance).

  // Restated (P1c): two sessions meet in one sitting only when they share it — the next session of the same June (its
  // label) opened after the converted window closed. A row the coordinator makes enters by its codes; the award a
  // converted row enters is written by SQL on both rows, as converted data and the exam fixture hold it.
  it('the same award in a converted session and a new session of one sitting: the board takes one entry', async () => {
    const q = (await apiResponse(adm.api.v1.catalogue.qualifications.$post({
      json: { boardCode: 'cambridge', code: `V08Q-${RUN}`, title: `Converted award (08n ${RUN})`, level: 'igcse', suite: 'Cambridge IGCSE', subjectArea: 'Test', entryMethod: 'qualification' },
    })))!.id;
    const sub = await subject(adm, `RWN-VCA-${RUN}`, `Converted award subject (08n ${RUN})`, { course: 1000, registration: 300 });
    await apiResponse(adm.api.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: sub }, json: { boardCode: 'cambridge', qualificationId: q, unitIds: [], reason: '08n: mapped' } }));
    const label = `n08v-conv-${RUN}`;
    const entersAward = (itemId: string) => sql(`update session_offer_item set enters_kind = 'award', qualification_id = $1 where id = $2`, [q, itemId]);
    // A window converted by 0042 (its offer, row and line marked as the conversion marks them).
    const converted = await mkJune(label);
    const oc = await offerSub(converted, sub);
    await entersAward(oc.first);
    const f = await onboard(officer, `n08v-conv-${RUN}`, 11);
    const [old] = await reserve(f.studentId, converted, [{ offerItemId: oc.first, attempt: 'first', mode: 'in_school', teacherId }]);
    await sql(`update session_offer set legacy = '{"converted": true}'::jsonb where id = $1`, [oc.id]);
    await sql(`update session_offer_item set legacy = '{"converted": true}'::jsonb where id = $1`, [oc.first]);
    await sql(`update registration set legacy = '{"converted": true}'::jsonb, pricing_basis = null where id = $1`, [old!.id]);
    await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: converted }, json: { reason: 'the converted window is over' } }));
    const fresh = await mkJune(label);
    const on = await offerSub(fresh, sub);
    await entersAward(on.first);
    expect(on.rows[0]!.series!.id).toBe(oc.rows[0]!.series!.id);
    await expect(reserve(f.studentId, fresh, [{ offerItemId: on.first, attempt: 'first', mode: 'in_school', teacherId }]))
      .rejects.toThrow(/is already reserved in .+: the board takes one entry/);
  });

  // "flag 5: moving an item into a series where the student already has the same entry from another session is
  // refused — an unmapped subject row too" retired with the item route (P1c: PUT /sessions/:id/offers/:offerId/items/:itemId
  // left; a row's sitting does not change while reservations use it — 08u "a row's sitting does not move while
  // reservations use it (§6) …"). No money.

  // P1b (C4): no preregistration; two lines waiting for payment take the two unpaid preregistrations' places.
  it("the Money tab: unpaid counts what is owed (waiting for payment), not what waits for the parent's approval", async () => {
    const d = await mkJune(`n08v-mon-${RUN}`);
    const sub = await subject(adm, `RWN-VMO-${RUN}`, `Money tab (08n ${RUN})`, { course: 1000, registration: 300 });
    const item = (await offerSub(d, sub)).first;
    const [p1, p2, p3, p4] = [await onboard(officer, `n08v-m1-${RUN}`, 11), await onboard(officer, `n08v-m2-${RUN}`, 11), await onboard(officer, `n08v-m3-${RUN}`, 11), await onboard(officer, `n08v-m4-${RUN}`, 11)];
    const line = { offerItemId: item, attempt: 'first' as const, mode: 'in_school' as const, teacherId };
    await reserve(p1.studentId, d, [line], 'pending_payment');
    const [funded] = await reserve(p2.studentId, d, [line], 'pending_payment');
    await pay(p2, [funded!.id]);
    await reserve(p3.studentId, d, [line], 'pending_payment');
    await reserve(p4.studentId, d, [line], 'pending_approval');
    const m = await apiResponse(finadmin.api.v1.sessions[':id'].money.$get({ param: { id: d }, query: { filter: 'all' } }));
    expect(m!.totals).toMatchObject({ lines: 4, unpaid: 2, outstanding: 2600, paid: 1, paidAmount: 1300, awaitingApproval: 1 });
    expect((await apiResponse(finadmin.api.v1.sessions[':id'].money.$get({ param: { id: d }, query: { filter: 'unpaid' } })))!.lines.map((l) => l.student.id).sort())
      .toEqual([p1.studentId, p3.studentId].sort());
  });

  // ─── The review of 40c1447: the follow-ups ─────────────────────────────────

  // 'capture holds a paid preregistration that breaks a line rule where it is (code line_rule)' retired (C4: no
  // preregistration; required items left with line rules v2; trail row "retired 08n capture holds"). No new held money.

  it('a prior sitting given without saying where it is known from is refused, and nothing is made; with its source, the line keeps both', async () => {
    const sub = await subject(adm, `RWN-VPS-${RUN}`, `Prior sitting source (08n ${RUN})`, { course: 1000, registration: 300 });
    const item = (await offerSub(june, sub)).first;
    const prior = await mkSeries('cambridge', 'june', Y, `n08v-ps-${RUN}`);
    const f = await onboard(officer, `n08v-ps-${RUN}`, 12);
    const retake = { offerItemId: item, attempt: 'retake' as const, mode: 'in_school' as const, teacherId, priorSittingSeriesId: prior };
    await expect(reserve(f.studentId, june, [retake])).rejects.toThrow('Say where the earlier sitting is known from: the record, the desk or the family');
    expect(await sql(`select 1 from registration where student_id = $1`, [f.studentId])).toEqual([]);
    const [line] = await reserve(f.studentId, june, [{ ...retake, priorSittingSource: 'declared_by_family' }]);
    expect(await one(`select attempt, prior_sitting_series_id as prior, prior_sitting_source as source from registration where id = $1`, [line!.id]))
      .toEqual({ attempt: 'retake', prior, source: 'declared_by_family' });
  });

  // Restated with P1c's money rule: "the admin's move re-prices a waiting line from the target series' fee and tells the
  // family; a paid line keeps its price" — the target series' fee grid is gone; a line is priced by its row, and a move
  // keeps it. The same two lines (one waiting, one paid) at the same fees (300 where they are, 450 where they go).
  it("the admin's move keeps each line's price (P1c): a waiting line and a paid one moved to a sitting whose row has another exam fee keep theirs, re-priced and told nothing", async () => {
    const label = `n08v-am-${RUN}`;
    await mkSeries('pearson_edexcel', 'november', Y, label, { entryDeadline: new Date(Date.now() + days(30)) });
    const janS = await mkSeries('pearson_edexcel', 'january', Y + 1, label, { entryDeadline: new Date(Date.now() + days(45)) });
    const winter = await mkWinter(label);
    const sub = await subject(adm, `RWN-VAM-${RUN}`, `Admin move price (08n ${RUN})`, { course: 1000, registration: 300 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    // An IAL subject sat in November or January (the session's two Pearson sittings), each row at its own exam fee.
    const o = await offerIn(adm, winter, sub, { courseFee: 1000, teachers: [teacherId], rows: [
      { kind: 'custom', name: 'November', sitting: 'november', examFee: 300, cells: OPEN },
      { kind: 'custom', name: 'January', sitting: 'january', examFee: 450, cells: OPEN },
    ] });
    const wf = await onboard(officer, `n08v-am-w-${RUN}`, 11);
    const pf = await onboard(officer, `n08v-am-p-${RUN}`, 11);
    const line = { offerItemId: o.row('November'), attempt: 'first' as const, mode: 'in_school' as const, teacherId };
    const [lw] = await reserve(wf.studentId, winter, [line]);
    const [lp] = await reserve(pf.studentId, winter, [line]);
    await pay(pf, [lp!.id]);
    const r = await apiResponse(adm.api.v1.sessions[':id']['board-series'].move.$post({
      param: { id: winter }, json: { registrationIds: [lw!.id, lp!.id], boardSeriesId: janS, reason: 'sat in the other series' },
    }));
    expect(r).toMatchObject({ moved: 2 });
    const priced = (id: string) => one(`select status, board_series_id as series, offer_item_id as item, price_at_registration::float as price,
      course_fee_at_registration::float as course, registration_fee_at_registration::float as exam from registration where id = $1`, [id]);
    expect(await priced(lw!.id)).toEqual({ status: 'pending_payment', series: janS, item: o.row('January'), price: 1300, course: 1000, exam: 300 });
    expect(await priced(lp!.id)).toEqual({ status: 'confirmed', series: janS, item: o.row('January'), price: 1300, course: 1000, exam: 300 });
    expect(await sql(`select 1 from audit_log where action = 'LINE_REPRICED' and entity_id in ($1, $2)`, [lw!.id, lp!.id])).toEqual([]);
    await audited([lw!.id], ['REGISTRATION_SERIES_MOVED']);
    expect(await notificationsFor(studentEmail(`n08v-am-w-${RUN}`), 'PRICE_CHANGED')).toEqual([]);
    expect(await notificationsFor(studentEmail(`n08v-am-p-${RUN}`), 'PRICE_CHANGED')).toEqual([]);
  });

  // "the series correction re-prices each waiting line from the corrected series' fees: a new fee is told as a new price;
  // where finance has none, the old fee comes provisional and the family is told it is to be confirmed" retired with the
  // fee grid (P1c: the correction keeps each line's price — no corrected series' fee to read, nothing provisional). A
  // price changed on reservations, unpaid lines re-priced and families told, is now the coordinator's: 08y "the course fee
  // raised: the counts first; … unpaid lines re-priced, the paid line listed for finance, the families told".

  // "a board change whose fee comes across at the same amount, provisional, tells the family the price is to be confirmed;
  // the new board's Confirm makes it payable" retired with the fee grid (P1c): a subject set up with its board's rows does
  // not change board (08y "reservations are protected: …; its board does not change under it"). No money moved.

  // "replace teacher moves the enrolment of the units its lines enter, not the student's other units of the subject
  // taught through another session (§2.11: per unit)" and "replace teacher on a converted session: an enrolment from
  // before the rework (no unit) under the converted item entering all the subject's units moves with its line" retired
  // with the route (P1c: replace-teacher left with the links sheet). No money.

  // Restated on the family read's offerings → rows (P1c: the v1 part, per item `knownSittings`, left): the row names the
  // one known sitting (F2) — the latest confirmed line of the subject before the row's sitting. The dropped line is in a
  // later sitting than the one sat, so counting it would name it.
  it("the family's read names as the known earlier sitting a confirmed line only: a dropped line was never sat", async () => {
    const sub = await subject(adm, `RWN-VKS-${RUN}`, `Known sittings (08n ${RUN})`, { course: 1000, registration: 300 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    const [a, b] = [await mkWinter(`n08v-ks-a-${RUN}`), await mkWinter(`n08v-ks-b-${RUN}`)];
    const row = (sitting: 'november' | 'january') => ({ kind: 'all_papers' as const, sitting, examFee: 300, cells: OPEN });
    const oa = await offerIn(adm, a, sub, { courseFee: 1000, teachers: [teacherId], rows: [row('november')] });
    const ob = await offerIn(adm, b, sub, { courseFee: 1000, teachers: [teacherId], rows: [row('january')] });
    const here = await offerSub(june, sub);
    const [s1, s2] = [oa.rows[0]!.series!, ob.rows[0]!.series!];
    expect([s1.month, s1.year, s2.month, s2.year]).toEqual(['november', Y, 'january', Y + 1]);
    const f = await onboard(officer, `n08v-ks-${RUN}`, 11);
    const [sat] = await reserve(f.studentId, a, [{ offerItemId: oa.first, attempt: 'first', mode: 'in_school', teacherId }]);
    const [left] = await reserve(f.studentId, b, [{ offerItemId: ob.first, attempt: 'first', mode: 'in_school', teacherId }]);
    await pay(f, [sat!.id]);
    await pay(f, [left!.id]);
    const cr = (await apiResponse(f.student.api.v1.registrations[':id']['request-drop'].$post({ param: { id: left!.id }, json: { reason: 'not sitting it after all' } })))!;
    await apiResponse(f.parent.api.v1['change-requests'][':id'].approve.$put({ param: { id: cr.id }, json: {} }));
    expect(await statusOf(left!.id)).toBe('dropped');
    expect(await statusOf(sat!.id)).toBe('confirmed');
    const listed = await apiResponse(f.parent.api.v1.registrations.offers.$get({ query: { sessionId: june, studentId: f.studentId } }));
    const known = listed.offerings.find((o) => o.id === here.id)!.rows[0]!;
    const { sittingLabel } = await import('../src/services/setup/labels');
    expect(known.knownSitting).toEqual({ id: s1.id, label: sittingLabel(s1.month, s1.year) });
    // Known to have sat it (F2): the retakes only.
    expect(known.options.map((o) => o.attempt)).toEqual(['retake', 'retake']);
  });

  // 'Q-20: a late board entry (deadline.boardEntry) …' retired with late entries (§9.1: exceptions.boardEntryDeadline
  // and the deadline.boardEntry exception removed; trail row "retired 08n Q-20"). Its money outcome — past the board's
  // deadline the sweep closes the checkout and the line — is stated in 08-money-rules and 08z-reserve-pay.
});

describe('08n: a draft session nobody reserved in is deleted from its Session screen (F8-01)', () => {
  let adm: Client, coordinator: Client, officer: Client, finadmin: Client;
  let teacherId: string;
  const mk = async (label: string, draft: boolean) => (await apiResponse(adm.api.v1.sessions.$post({
    json: {
      type: 'june', year: Y + 1, label,
      startDate: new Date(Date.now() + (draft ? days(90) : -days(1))).toISOString(), endDate: new Date(Date.now() + (draft ? days(150) : days(60))).toISOString(),
      courseStartsOn: cairoDate(new Date(Date.now() + days(90))), paymentDueAt: new Date(Date.now() + days(140)).toISOString(),
    },
  })))!;
  const del = (who: Client, id: string, reason: string) => who.api.v1.sessions[':id'].$delete({ param: { id }, json: { reason } });
  const exists = async (id: string) => Number((await one<{ n: string }>(`select count(*) as n from registration_session where id = $1`, [id])).n) === 1;

  beforeAll(async () => {
    adm = await admin('n08del');
    coordinator = await staff(adm, 'coordinator', 'n08del');
    officer = await staff(adm, 'finance_officer', 'n08del');
    finadmin = await staff(adm, 'finance_admin', 'n08del');
    teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher D (08n ${RUN})` } })))!.id;
  });

  // P1c: its subject set up through the coordinator's routes (the links sheet's offers route left).
  it('a draft with its subjects is deleted with a reason, audited in the same change; its subjects and the boards\' series stay', async () => {
    const d = await mk(`n08-del-${RUN}`, true);
    expect(d.status).toBe('draft');
    const sub = await subject(adm, `RWN-DEL-${RUN}`, `Deleted with its draft (08n ${RUN})`, { course: 1000, registration: 0 });
    const made = await offerIn(adm, d.id, sub, { courseFee: 1000, teachers: [teacherId], rows: [{ kind: 'all_papers', cells: OPEN }] });
    const linked = await sql<{ id: string }>(`select board_series_id as id from session_board_series where session_id = $1`, [d.id]);
    expect(linked.length).toBeGreaterThan(0);
    // A reason of a word is refused: the reason is what the audit keeps.
    expect((await refused(del(adm, d.id, 'old'))).status).toBe(400);
    expect(await exists(d.id)).toBe(true);
    expect(await apiResponse(del(adm, d.id, 'the seed\'s sample draft: not this school\'s'))).toEqual({ deleted: d.id, name: d.name, subjects: 1 });
    expect(await exists(d.id)).toBe(false);
    expect(await sql(`select id from session_offer where id = $1`, [made.id])).toEqual([]);
    expect(await sql(`select id from session_offer_item where offer_id = $1`, [made.id])).toEqual([]);
    expect(await sql(`select id from session_board_series where session_id = $1`, [d.id])).toEqual([]);
    expect(await one(`select count(*)::int as n from board_series where id in $1`, [linked.map((l) => l.id)])).toEqual({ n: linked.length });
    expect(await one(`select is_active from subject where id = $1`, [sub])).toEqual({ is_active: true });
    expect(await one(`select user_id, previous_data->>'name' as name, previous_data->'subjects' as subjects, new_data->>'reason' as reason from audit_log where action = 'SESSION_DELETED' and entity_id = $1`, [d.id]))
      .toEqual({ user_id: expect.any(String), name: d.name, subjects: [sub], reason: 'the seed\'s sample draft: not this school\'s' });
    expect((await refused(adm.api.v1.sessions[':id'].$get({ param: { id: d.id } }))).status).toBe(404);
  });

  it('refused, nothing deleted, for an open session and anyone but the admin', async () => {
    const open = await mk(`n08-del-open-${RUN}`, false);
    expect(open.status).toBe('active');
    expect(await refused(del(adm, open.id, 'not wanted any more'))).toEqual({ status: 409, error: `${open.name} is open: only a draft session can be deleted (close it instead)` });
    expect(await exists(open.id)).toBe(true);

    // P1b (C4): a draft takes no reservation, so "a draft with a reservation" (a preregistration) cannot be made any
    // more; the refusal stays in the code for drafts preregistered before P1b (trail row "08n F8-01 draft reserved").
    const d = await mk(`n08-del-res-${RUN}`, true);
    expect((await refused(del(coordinator, d.id, 'the coordinator tries'))).status).toBe(403);
    expect(await one(`select count(*)::int as n from audit_log where action = 'SESSION_DELETED' and entity_id in $1`, [[open.id, d.id]])).toEqual({ n: 0 });
  });

  it('refused, nothing deleted, for a draft whose exception was revoked and for one a reminder went out for: both are kept as history (the review of 744e553, item 2)', async () => {
    // An exception granted on one of the draft's items, then revoked: revoking keeps the row, so the draft stays,
    // and the refusal says it is kept rather than sending the admin to revoke it.
    const d = await mk(`n08-del-exc-${RUN}`, true);
    const sub = await subject(adm, `RWN-DELX-${RUN}`, `An exception in a draft (08n ${RUN})`, { course: 1000, registration: 0 });
    const o = await offerIn(adm, d.id, sub, { courseFee: 1000, teachers: [teacherId], rows: [{ kind: 'all_papers', cells: OPEN }] });
    const f = await onboard(officer, `n08-delx-${RUN}`, 11);
    const ex = await apiResponse(coordinator.api.v1.exceptions.$post({ json: { policyKey: 'gate.priorSeries', studentId: f.studentId, scope: { offerItemId: o.first }, reason: '08n: a first entry the item is not open to' } }));
    const refusedWith = `An exception was granted for ${d.name}: it is kept as history and cannot be deleted`;
    expect(await refused(del(adm, d.id, 'a draft with an exception'))).toEqual({ status: 409, error: refusedWith });
    await apiResponse(coordinator.api.v1.exceptions[':id'].revoke.$post({ param: { id: ex.id } }));
    expect(await one(`select status from exception where id = $1`, [ex.id])).toEqual({ status: 'revoked' });
    expect(await refused(del(adm, d.id, 'the exception was revoked'))).toEqual({ status: 409, error: refusedWith });
    expect(await exists(d.id)).toBe(true);
    expect(await one(`select count(*)::int as n from session_offer_item where offer_id = $1`, [o.id])).toEqual({ n: o.rows.length });
    expect(await one(`select status, offer_item_id from exception where id = $1`, [ex.id])).toEqual({ status: 'revoked', offer_item_id: o.first });

    // A reminder rule of the draft's own, and a reminder sent under it. No path sends one for a draft today (the
    // step reminds lines and open sessions); the history the rule's foreign keys keep is written as the step writes it.
    const r = await mk(`n08-del-rem-${RUN}`, true);
    const rule = await apiResponse(finadmin.api.v1.reminders.rules.$put({ json: { kind: 'payment_due', sessionId: r.id, offsetsDays: [-10], repeatEveryDays: null, channels: ['in_app'], templateId: 'tpl-payment-due', active: true, reason: '08n: this draft reminds ten days ahead' } }));
    const [aud, msg] = [`n08-del-aud-${RUN}`, `n08-del-msg-${RUN}`];
    await sql(`insert into message_audience (id, kind, definition) values ($1, 'batch', '{"kind":"batch","list":"reminder"}'::jsonb)`, [aud]);
    await sql(`insert into message (id, audience_id, template_id, channels, notification_type, source, reminder_rule_id, status, sent_at, recipient_count) values ($1, $2, 'tpl-payment-due', '{in_app}', 'PAYMENT_REMINDER', 'reminder', $3, 'sent', now(), 0)`, [msg, aud, rule.id]);
    await sql(`insert into reminder_sent (id, rule_id, kind, target_kind, target_id, anchor_on, offset_days, session_id, message_id, sent_on) values ($1, $2, 'payment_due', 'line', $3, current_date + 10, -10, $4, $5, current_date)`, [`n08-del-sent-${RUN}`, rule.id, `n08-del-line-${RUN}`, r.id, msg]);
    // Its audit row, as the step writes one with every send (09's rule: every message sent has one).
    await sql(`insert into audit_log (id, user_id, action, entity_type, entity_id, previous_data, new_data) values ($1, null, 'REMINDERS_SENT', 'message', $2, null, $3::jsonb)`,
      [`n08-del-audit-${RUN}`, msg, JSON.stringify({ kind: 'payment_due', ruleId: rule.id, sessionId: r.id, offsets: [-10], claimed: 1, people: 0, deliveries: 0 })]);
    expect(await refused(del(adm, r.id, 'a draft a reminder went out for'))).toEqual({ status: 409, error: `Reminders were sent for ${r.name}: it is kept as history and cannot be deleted` });
    expect(await exists(r.id)).toBe(true);
    expect(await one(`select count(*)::int as n from reminder_rule where id = $1`, [rule.id])).toEqual({ n: 1 });
    expect(await one(`select count(*)::int as n from audit_log where action = 'SESSION_DELETED' and entity_id in $1`, [[d.id, r.id]])).toEqual({ n: 0 });
  });

  it("finding 8: an exception granted on a draft's item while the deletion counts is seen and the deletion refused — never deleted unseen by the cascade", async () => {
    const d = await mk(`n08-del-race-${RUN}`, true);
    const sub = await subject(adm, `RWN-DELK-${RUN}`, `A grant during a deletion (08n ${RUN})`, { course: 1000, registration: 0 });
    const o = await offerIn(adm, d.id, sub, { courseFee: 1000, teachers: [teacherId], rows: [{ kind: 'all_papers', cells: OPEN }] });
    const f = await onboard(officer, `n08-delk-${RUN}`, 11);
    // The grant paused at its audit row: its exception is written, its transaction still open.
    const p = await pauseAtAudits(['EXCEPTION_GRANTED']);
    try {
      const granting = apiResponse(coordinator.api.v1.exceptions.$post({ json: { policyKey: 'gate.priorSeries', studentId: f.studentId, scope: { offerItemId: o.first }, reason: '08n: granted while the draft is deleted' } }));
      await p.paused('EXCEPTION_GRANTED');
      // The deletion waits on the item the grant names (its lock before the count), then counts the grant.
      const deleting = refused(del(adm, d.id, 'deleted while a grant is under way'));
      await lockWaiters(2);
      await p.release('EXCEPTION_GRANTED');
      const ex = await granting;
      expect(await deleting).toEqual({ status: 409, error: `An exception was granted for ${d.name}: it is kept as history and cannot be deleted` });
      expect(await one(`select status, offer_item_id from exception where id = $1`, [ex.id])).toEqual({ status: 'active', offer_item_id: o.first });
      expect(await exists(d.id)).toBe(true);
    } finally {
      await p.releaseAll();
    }
  });
});
