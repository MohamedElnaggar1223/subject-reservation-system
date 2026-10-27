import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearStartOf, type LineInputType } from '@repo/validations';
import { admin, staff, onboard, subject, one, sql, money, lockWaiters, holdRowLock, pauseAtAudit, pauseAtAudits, session, openWindow, runPaymentDeadlines, waitFor, type Client, reservationOf, CONSENT, refusedWithCode, confirmed, cairoDateIn, type Impact } from './helpers';
import { examWorld, type ExamWorld } from './exam-helpers';
import { STUDENTS_KEPT_CHANGING } from '../src/lib/student-locks';

/**
 * The reservations rework, step 1 — races (RESERVATIONS_REWORK.md §6, §8; FEATURES_PLAN.md §5:
 * anything two people can act on at once has a race test, the dangerous order forced). Restated on the
 * coordinator's routes by P1c (COORDINATOR_REWORK.md §9.2, §12): every subject is offered through the subject
 * editor, every line priced by its row's exam fee and course fee.
 *
 * The one lock order: the student FOR NO KEY UPDATE → the subject → the session's sitting links → the series →
 * the session → the offering → the rows (insertLines, FOR SHARE); a change to a row takes the session, the offering
 * and its rows FOR UPDATE, then the lines FOR UPDATE in id order, then their payment history (§9.2). Forced here:
 * - two desks reserving one row for one student: one line;
 * - the same entry in one sitting from two sessions (two rounds of one June; the closed one reached through the
 *   student's later reserve date), and two rows of one exclusive group: the student lock serialises them, the
 *   second sees the first (no unique index can say this);
 * - a row closed, or a teacher removed, while a line is being reserved;
 * - a row's exam fee changed while a line is being priced on it: the change waits for the line and counts it, so
 *   no line is left at the old fee unseen;
 * - a row's exam fee changed racing a checkout, both orders: the lines are locked first; a checkout that lands
 *   first keeps its line at the price it paid (the change, its counts no longer true, is refused until confirmed
 *   again, then lists the line for finance); one that lands after is refused (the price changed);
 * - a parent's approval of a drop against a reversal of the payment for the same line, both
 *   orders: the approval takes the line's receipt before the line, as the reversal does (MA-16),
 *   so nothing deadlocks;
 * - a change whose students keep changing (the session's series correction): three retries, then a 409.
 *
 * Retired with the series' fee grid and the old item routes (P1c), each naming below where its money outcome is
 * shown now: a grid row's Confirm racing a line being priced, a swap or a move; a fee list pasted out of id order;
 * a fee row created and confirmed around the admin's move; an item's series changed through the removed item route
 * (racing a checkout, or newcomers); a board change's races (a subject priced by its rows refuses a board change).
 *
 * Since step B every reservation path takes lines (docs/features/RESERVATIONS_LINES.md §2), so
 * the races reserve through the desk's endpoint with the typed client, as staff do. One race
 * pauses a reservation between its locks and its commit with nothing for the test to hold: it runs
 * the services in a transaction (`reserveHeld`), as step A wrote it.
 */

const days = (n: number) => n * 86_400_000;
const RUN = Math.random().toString(36).slice(2, 6);
const Y = academicYearStartOf();
const cairoDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
type Res = { status: number; json(): Promise<unknown> };
type Line = Pick<LineInputType, 'offerItemId' | 'attempt' | 'mode'> & Partial<LineInputType>;

async function reserveHeld(studentId: string, sessionId: string, lines: Line[], hold?: { inserted: () => void; until: Promise<void> }) {
  const { db } = await import('@repo/db');
  const { insertLines } = await import('../src/services/line.services');
  const { writeConsents } = await import('../src/services/reservation.services');
  const { assertMayRegisterForInTx } = await import('../src/services/eligibility.services');
  return db.transaction(async (tx) => {
    const eligibility = await assertMayRegisterForInTx(tx, studentId, sessionId);
    const made = await insertLines(tx, { studentId, sessionId, lines: lines as LineInputType[], status: 'pending_payment', requestedBy: studentId, eligibility });
    // The family's consent, as every reservation path writes it since step B.
    await writeConsents(tx, made.map((r) => r.id), { channel: 'app', confirmedBy: studentId });
    if (hold) {
      hold.inserted();
      await hold.until;
    }
    return made;
  });
}
const settle = async <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e: e instanceof Error ? e.message : String(e) }));
/** A request's outcome in the shape `settle` gives: ok, or the refusal's sentence. */
const settleRes = async (p: Promise<Res>) => {
  const r = await p;
  const body = await r.json() as { error?: string };
  return r.status < 300 ? { ok: true as const, v: body } : { ok: false as const, status: r.status, e: body.error ?? String(r.status) };
};
const live = async (studentId: string, where = 'true') =>
  sql<{ id: string; offer_item_id: string }>(`select id, offer_item_id from registration where student_id = $1 and status not in ('rejected', 'expired', 'dropped') and ${where} order by id`, [studentId]);

describe('08t: the rework races', () => {
  let adm: Client, finadmin: Client, officer: Client;
  let teacherId: string;
  let s1: string, s2: string, series: string;
  let subA: string, itemA1: string, itemA2: string;
  let groupOffer: string, groupAs: string, groupAl: string;

  /** A June session (the deprecated dated create: open at once), its prices final (E6): its lines payable at once. */
  const mkSession = async (label: string) => {
    const id = (await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: Y + 1, label, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
        courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + days(40)).toISOString(),
      },
    })))!.id;
    await apiResponse(adm.api.v1.sessions[':id']['prices-final'].$put({ param: { id }, json: { final: true } }));
    return id;
  };
  type RowIn = NonNullable<Parameters<Client['api']['v1']['sessions'][':id']['offerings'][':offeringId']['$put']>[0]['json']['rows']>[number];
  const OPEN = { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false };
  /**
   * A subject offered in a session through the coordinator's routes (P1c: the old offer route and the series' fee
   * grid left): the subject not on the reference list, by its code; course fee 1,000, the file's teacher (or those
   * given), and its rows — one all-papers row unless others are given — in the session's June sitting (the series
   * of the session's label), at the exam fee the series' grid row carried (500 unless given). Returns the offering
   * and its rows' ids in the order given.
   */
  const offerOf = async (sessionId: string, subjectId: string, o: { examFee?: number; teachers?: string[]; rows?: Partial<RowIn>[] } = {}) => {
    const sub = await one<{ name: string; code: string; council: 'cambridge' | 'pearson_edexcel'; level: string }>(
      `select name, code, council, qualification_level as level from subject where id = $1`, [subjectId]);
    const igcse = sub.level === 'igcse';
    const made = await apiResponse(adm.api.v1.sessions[':id'].offerings.$post({
      param: { id: sessionId }, json: { custom: { board: sub.council, name: sub.name, level: igcse ? 'igcse' : 'as_al', group: igcse ? 'O.L.' : 'A.S./A.L.', code: sub.code } },
    }));
    const rows = (o.rows ?? [{}]).map((r) => ({ kind: 'all_papers' as const, referenceCodes: [sub.code], sitting: 'june' as const, examFee: o.examFee ?? 500, cells: OPEN, ...r }));
    const saved = await apiResponse(adm.api.v1.sessions[':id'].offerings[':offeringId'].$put({
      param: { id: sessionId, offeringId: made.id },
      json: { accepting: true, courseFee: 1000, teachers: (o.teachers ?? [teacherId]).map((t) => ({ teacherId: t, online: false, external: false })), rows },
    }));
    expect(saved.saved).toBe(true);
    return { id: made.id, items: rows.map((r) => saved.offering.rows.find((x) => x.kind === r.kind)!.id) };
  };
  /** Reserve only, at the desk: the lines and the desk's consent tick. */
  const viaDesk = (studentId: string, sessionId: string, lines: Line[]) =>
    officer.api.v1.registrations.desk.$post({ json: { studentId, sessionId, lines, consent: CONSENT } });
  const reserveAtDesk = async (studentId: string, sessionId: string, lines: Line[]) => (await apiResponse(viaDesk(studentId, sessionId, lines))).registrations;

  beforeAll(async () => {
    adm = await admin('t08');
    finadmin = await staff(adm, 'finance_admin', 't08');
    officer = await staff(adm, 'finance_officer', 't08');
    teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher T (08t ${RUN})` } })))!.id;
    series = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `t08-${RUN}`, entryDeadline: new Date(Date.now() + days(50)) } })))!.id;
    subA = await subject(adm, `RWT-A-${RUN}`, `Race A (08t ${RUN})`, { course: 1000, registration: 500 });
    // Two sessions in one sitting (P1c: a row sits in its session's sitting, the series of the session's label): the
    // first round of this June, closed, and the next round, open (one open per cycle). Both offer A.
    s2 = await mkSession(`t08-${RUN}`);
    itemA2 = (await offerOf(s2, subA)).items[0]!;
    await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: s2 }, json: { reason: 'race: the first round of June is over' } }));
    s1 = await mkSession(`t08-${RUN}`);
    itemA1 = (await offerOf(s1, subA)).items[0]!;
    expect(await sql(`select distinct board_series_id as s from session_offer_item where id in ($1, $2)`, [itemA1, itemA2])).toEqual([{ s: series }]);
    // An A.S. row and an A Level row of one subject: one exclusive group (D8, by their kinds).
    const subG = await subject(adm, `RWT-G-${RUN}`, `Race group (08t ${RUN})`, { course: 1000, registration: 500 }, { qualificationLevel: 'a_level' });
    const g = await offerOf(s1, subG, { rows: [{ kind: 'as' }, { kind: 'al' }] });
    groupOffer = g.id;
    [groupAs, groupAl] = g.items as [string, string];
  });

  it('two desks reserve one subject for one student at the same moment: one line', async () => {
    const f = await onboard(officer, `t08-desks-${RUN}`, 11);
    const officer2 = await staff(adm, 'finance_officer', 't08b');
    const release = await holdRowLock('"user"', f.studentId);
    let one1: Promise<Res> | undefined;
    let two: Promise<Res> | undefined;
    try {
      one1 = officer.api.v1.registrations.desk.$post({ json: { studentId: f.studentId, sessionId: s1, ...(await reservationOf(s1, [subA])) } });
      two = officer2.api.v1.registrations.desk.$post({ json: { studentId: f.studentId, sessionId: s1, ...(await reservationOf(s1, [subA])) } });
      await lockWaiters(2);
    } finally {
      await release();
    }
    const statuses = (await Promise.all([one1!, two!])).map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    // Step B: the second desk, under the student lock, finds the item reserved.
    expect(statuses[1]).toBe(409);
    expect(await live(f.studentId)).toHaveLength(1);
    // The line has the two consent rows of the desk that made it; the other desk wrote none.
    const [l] = await live(f.studentId);
    expect(await sql(`select kind, channel from registration_consent where registration_id = $1 order by kind`, [l!.id]))
      .toEqual([{ kind: 'declaration', channel: 'desk' }, { kind: 'refund_policy', channel: 'desk' }]);
    expect(Number((await one<{ n: string }>(`select count(*) as n from registration_consent c join registration r on r.id = c.registration_id where r.student_id = $1`, [f.studentId])).n)).toBe(2);
  });

  it("the same entry in one sitting from two sessions at once — the closed first round reached through the student's later reserve date (G4): the student lock serialises them and the second is refused", async () => {
    const f = await onboard(officer, `t08-once-${RUN}`, 11);
    // P1c: two sessions share a sitting only as two rounds of one June, one open at a time; the closed round takes a
    // reservation from a student holding a later reserve date, as finance grants it (G4: never past the board's deadline).
    await apiResponse(finadmin.api.v1.exceptions.$post({
      json: { policyKey: 'deadline.reserve', studentId: f.studentId, scope: { sessionId: s2 }, value: cairoDateIn(10), reason: 'race: may still reserve in the first round' },
    }));
    const release = await holdRowLock('"user"', f.studentId);
    let a: ReturnType<typeof settleRes> | undefined;
    let b: ReturnType<typeof settleRes> | undefined;
    try {
      a = settleRes(viaDesk(f.studentId, s1, [{ offerItemId: itemA1, attempt: 'first', mode: 'in_school', teacherId }]));
      b = settleRes(viaDesk(f.studentId, s2, [{ offerItemId: itemA2, attempt: 'first', mode: 'in_school', teacherId }]));
      await lockWaiters(2);
    } finally {
      await release();
    }
    const out = await Promise.all([a!, b!]);
    expect(out.filter((o) => o.ok)).toHaveLength(1);
    expect(out.find((o) => !o.ok)).toMatchObject({ e: expect.stringMatching(/is already reserved in .+: the board takes one entry/) });
    expect(await live(f.studentId)).toHaveLength(1);
  });

  it('two rows of one exclusive group at once (an A.S. and an A Level, D8): one line, the other refused', async () => {
    const f = await onboard(officer, `t08-group-${RUN}`, 11);
    const release = await holdRowLock('"user"', f.studentId);
    let a: ReturnType<typeof settleRes> | undefined;
    let b: ReturnType<typeof settleRes> | undefined;
    try {
      a = settleRes(viaDesk(f.studentId, s1, [{ offerItemId: groupAs, attempt: 'first', mode: 'in_school', teacherId }]));
      b = settleRes(viaDesk(f.studentId, s1, [{ offerItemId: groupAl, attempt: 'first', mode: 'in_school', teacherId }]));
      await lockWaiters(2);
    } finally {
      await release();
    }
    const out = await Promise.all([a!, b!]);
    expect(out.filter((o) => o.ok)).toHaveLength(1);
    expect(out.find((o) => !o.ok)).toMatchObject({ e: expect.stringMatching(/cannot be reserved together/) });
    expect(await live(f.studentId)).toHaveLength(1);
    expect(groupOffer).toBeTruthy();
  });

  it('a row closed while a line is being reserved: the close waits for the line and counts it; a close that lands first refuses it', async () => {
    const sub = await subject(adm, `RWT-C-${RUN}`, `Race close (08t ${RUN})`, { course: 1000, registration: 500 });
    const o = await offerOf(s1, sub);
    const row = o.items[0]!;
    // P1c: the coordinator closes the row in the subject editor (its close date now, D12; it was the old item route's
    // availability 'closed'), sent with the counts her screen showed, if any (A3).
    const close = (expected?: Impact) => adm.api.v1.sessions[':id'].offerings[':offeringId'].$put({
      param: { id: s1, offeringId: o.id }, json: { rows: [{ id: row, kind: 'all_papers', cells: OPEN, closesAt: new Date() }], ...(expected ? { expected } : {}) },
    });
    const reopen = () => apiResponse(adm.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: s1, offeringId: o.id }, json: { rows: [{ id: row, kind: 'all_papers', cells: OPEN, closesAt: null }] } }));
    // The line first: the desk's reservation paused at its audit row, holding what the line rests on (the session's
    // sitting links, the session, the offering and the row FOR SHARE — there is no fee row to hold since P1c); the close,
    // sent with no counts (nobody had reserved the row), queues behind it on the sitting links; the line commits, then
    // the close counts it.
    const f = await onboard(officer, `t08-close-a-${RUN}`, 11);
    const p = await pauseAtAudits(['DESK_REGISTRATION']);
    let reserving: ReturnType<typeof settleRes> | undefined;
    let closing: ReturnType<typeof settleRes> | undefined;
    try {
      reserving = settleRes(viaDesk(f.studentId, s1, [{ offerItemId: row, attempt: 'first', mode: 'in_school', teacherId }]));
      await p.paused('DESK_REGISTRATION');
      closing = settleRes(close());
      await lockWaiters(2);
    } finally {
      await p.releaseAll();
    }
    expect((await reserving!).ok).toBe(true);
    // The close found the reservation that now stands: it answers it (A3) and closes nothing until she confirms.
    expect(await closing!).toMatchObject({ ok: true, v: { data: { saved: false, impact: { linesAffected: 1 } } } });
    expect(await one(`select closes_at from session_offer_item where id = $1`, [row])).toEqual({ closes_at: null });
    expect((await confirmed((expected?: Impact) => apiResponse(close(expected)))).saved.saved).toBe(true);
    expect(await live(f.studentId)).toHaveLength(1);
    // The close first: the line waits for it, then is refused. The close is sent with the counts her screen shows now
    // (the line above stands).
    await reopen();
    const asked = await apiResponse(close());
    expect(asked).toMatchObject({ saved: false, impact: { linesAffected: 1 } });
    const g = await onboard(officer, `t08-close-b-${RUN}`, 11);
    const release = await holdRowLock('session_offer_item', row);
    let closing2: Promise<Res> | undefined;
    let reserving2: ReturnType<typeof settleRes> | undefined;
    try {
      closing2 = close(asked.impact);
      await lockWaiters(1);
      reserving2 = settleRes(viaDesk(g.studentId, s1, [{ offerItemId: row, attempt: 'first', mode: 'in_school', teacherId }]));
      await lockWaiters(2);
    } finally {
      await release();
    }
    expect((await closing2!).status).toBe(200);
    // P1b (mayReserve): a row past its close takes no new reservation (NOT_ACCEPTING; with the old availability it read
    // "is not offered in this session").
    expect(await reserving2!).toMatchObject({ ok: false, e: expect.stringMatching(new RegExp(`^Race close \\(08t ${RUN}\\) is not taking reservations \\(it closed on .+\\)$`)) });
    expect(await live(g.studentId)).toHaveLength(0);
  });

  it("a teacher removed from the offer while a line naming them is reserved: removed first, the line is refused", async () => {
    const sub = await subject(adm, `RWT-R-${RUN}`, `Race teacher (08t ${RUN})`, { course: 1000, registration: 500 });
    const other = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher T2 (08t ${RUN})` } })))!.id;
    const o = await offerOf(s1, sub, { teachers: [teacherId, other] });
    const f = await onboard(officer, `t08-teacher-${RUN}`, 11);
    // The offering held: the removal (the subject editor's save, P1c; it was the old offer route) queues on it FOR
    // UPDATE, then the reservation behind it FOR SHARE.
    const release = await holdRowLock('session_offer', o.id);
    let removing: Promise<Res> | undefined;
    let reserving: ReturnType<typeof settleRes> | undefined;
    try {
      removing = adm.api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: s1, offeringId: o.id }, json: { teachers: [{ teacherId: other, online: false, external: false }] } });
      await lockWaiters(1);
      reserving = settleRes(viaDesk(f.studentId, s1, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }]));
      await lockWaiters(2);
    } finally {
      await release();
    }
    expect((await removing!).status).toBe(200);
    expect(await sql(`select teacher_id from session_offer_teacher where offer_id = $1`, [o.id])).toEqual([{ teacher_id: other }]);
    expect(await reserving!).toMatchObject({ ok: false, e: expect.stringMatching(/The chosen teacher is not linked to/) });
  });

  it("a row's exam fee changed while a line is being priced on it: the change waits for the line and counts it — no line left at the old fee unseen", async () => {
    // P1c: it was a provisional grid row confirmed while a line was priced on it (the Confirm waited and cleared the line,
    // never left provisional). The grid's Confirm left with the grid; prices made final while a reservation lands is
    // 08y's race ("prices made final while a reservation lands: …"). Restated on the row's own exam fee (E7): the change
    // takes the session, the offering and the rows, then the lines (§9.2).
    const sub = await subject(adm, `RWT-F-${RUN}`, `Race fee (08t ${RUN})`, { course: 1000, registration: 700 });
    const o = await offerOf(s1, sub, { examFee: 700 });
    const f = await onboard(officer, `t08-fee-${RUN}`, 11);
    let inserted!: () => void;
    let commit!: () => void;
    const isIn = new Promise<void>((r) => { inserted = r; });
    const until = new Promise<void>((r) => { commit = r; });
    // Paused between its locks and its commit, with no row the test could hold to pause it: this runs the services.
    const reserving = settle(reserveHeld(f.studentId, s1, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }], { inserted, until }));
    await isIn;
    // The board publishes 750: nobody had reserved the row when she set it, so the change is sent with no counts.
    const setFee = (expected?: Impact) => adm.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: s1, rowId: o.items[0]! }, json: { amount: 750, ...(expected ? { expected } : {}) } });
    const changing = setFee();
    await lockWaiters(1);
    commit();
    const r = await reserving;
    expect(r.ok).toBe(true);
    const c = await changing;
    expect(c.status).toBe(200);
    // It waited for the line (on the offering) and counts it: answered (A3), nothing written until she confirms.
    expect((await c.json() as { data: { saved: boolean; impact: Impact } }).data).toMatchObject({ saved: false, impact: { repriced: 1, listedForFinance: 0 } });
    const [line] = await live(f.studentId, `offer_item_id = '${o.items[0]}'`);
    expect(await one(`select exam_fee::float as fee from session_offer_item where id = $1`, [o.items[0]])).toEqual({ fee: 700 });
    expect(await one(`select price_provisional as p, price_at_registration::float as price from registration where id = $1`, [line!.id])).toEqual({ p: false, price: 1700 });
    // Confirmed with those counts: the line re-priced at the board's fee.
    expect((await confirmed((expected?: Impact) => apiResponse(setFee(expected)))).saved).toMatchObject({ saved: true, examFee: 750 });
    expect(await one(`select price_provisional as p, price_at_registration::float as price from registration where id = $1`, [line!.id])).toEqual({ p: false, price: 1750 });
  });

  describe("a row's exam fee changed racing a checkout (flag 46; the re-price by row, §9.2): the lines are locked first", () => {
    const setUp = async (tag: string) => {
      const sub = await subject(adm, `RWT-P${tag}-${RUN}`, `Race reprice ${tag} (08t ${RUN})`, { course: 1000, registration: 600 });
      const o = await offerOf(s1, sub, { examFee: 600 });
      const row = o.items[0]!;
      const f = await onboard(officer, `t08-rp${tag}-${RUN}`, 11);
      const [line] = await reserveAtDesk(f.studentId, s1, [{ offerItemId: row, attempt: 'first', mode: 'in_school', teacherId }]);
      const checkout = () => f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [line!.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } });
      // The board's fee changes (600 → 650): P1c, the coordinator sets the row's exam fee, which re-prices its lines in
      // the same change (it was the grid row's Confirm at the new amount, then finance's re-price). Her screen shows the
      // counts first — the line re-priced — and the change raced is the one sent back with them.
      const setFee = (expected?: Impact) => adm.api.v1.sessions[':id'].rows[':rowId']['exam-fee'].$put({ param: { id: s1, rowId: row }, json: { amount: 650, ...(expected ? { expected } : {}) } });
      const shown = await apiResponse(setFee());
      expect(shown).toMatchObject({ saved: false, impact: { repriced: 1, listedForFinance: 0 } });
      return { line: line!.id, row, checkout, reprice: () => setFee(shown.impact), setFee };
    };
    const batchOf = (row: string) => one<{ listed: { id: string; reason: string }[]; repriced: { id: string }[] }>(
      `select new_data->'listedForFinance' as listed, new_data->'repriced' as repriced from audit_log where action = 'ROWS_REPRICED' and entity_id = $1`, [row]);

    it("the checkout lands first: it pays the price it read; the change, its counts no longer true, is refused (IMPACT_CHANGED) — confirmed again, it lists the line and leaves it", async () => {
      const { line, row, checkout, reprice, setFee } = await setUp('a');
      const release = await holdRowLock('registration', line);
      let pay: Promise<Res> | undefined;
      let rp: Promise<Res> | undefined;
      try {
        pay = checkout();
        await lockWaiters(1);
        rp = reprice();
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [p, r] = await Promise.all([pay!, rp!]);
      expect(p.status).toBe(201);
      const paymentId = (await p.json() as { data: { id: string } }).data.id;
      // The line it would have re-priced has a payment now: the counts she confirmed moved, nothing is written.
      expect(await refusedWithCode(Promise.resolve(r))).toMatchObject({ status: 409, code: 'IMPACT_CHANGED' });
      expect(await one(`select exam_fee::float as fee from session_offer_item where id = $1`, [row])).toEqual({ fee: 600 });
      // Confirmed with what it answers now: the line, with its payment, listed for finance and left as it is.
      const { shown } = await confirmed((expected?: Impact) => apiResponse(setFee(expected)));
      expect(shown.impact).toMatchObject({ repriced: 0, listedForFinance: 1 });
      const batch = await batchOf(row);
      expect(batch.repriced).toEqual([]);
      expect(batch.listed.map((x) => [x.id, x.reason])).toEqual([[line, 'has a payment (open, failed or paid)']]);
      expect(money((await one<{ amount: string }>(`select amount from payment where id = $1`, [paymentId])).amount)).toBe(1600);
      expect(money((await one<{ p: string }>(`select price_at_registration as p from registration where id = $1`, [line])).p)).toBe(1600);
    });

    it('the change lands first: the line re-priced; the checkout that read the old price is refused, nothing is charged', async () => {
      const { line, row, checkout, reprice } = await setUp('b');
      const release = await holdRowLock('registration', line);
      let rp: Promise<Res> | undefined;
      let pay: Promise<Res> | undefined;
      try {
        rp = reprice();
        await lockWaiters(1);
        pay = checkout();
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [r, p] = await Promise.all([rp!, pay!]);
      expect(r.status).toBe(200);
      expect((await r.json() as { data: { saved: boolean; impact: Impact } }).data).toMatchObject({ saved: true, impact: { repriced: 1, listedForFinance: 0 } });
      expect((await batchOf(row)).repriced.map((x) => x.id)).toEqual([line]);
      const { PRICE_CHANGED_REFUSAL } = await import('../src/services/pricing.services');
      expect(p.status).toBeGreaterThanOrEqual(400);
      expect((await p.json() as { error: string }).error).toBe(PRICE_CHANGED_REFUSAL);
      expect(await sql(`select 1 from payment_registration where registration_id = $1`, [line])).toEqual([]);
      expect(money((await one<{ p: string }>(`select price_at_registration as p from registration where id = $1`, [line])).p)).toBe(1650);
    });
  });

  // "an item's series changed while a checkout lands on its line: the checkout first, the change is refused" retired with
  // the old item route (P1c: a row's sitting does not change while lines use it, §6 — 08u "a row's sitting does not move
  // while reservations use it (§6): …"). Its checkout's side — it pays the price it read — is "the checkout lands
  // first" above.

  // 'capture and the deadline sweep on one paid preregistration at once: refunded once' retired with preregistration
  // and refundPreregistrationsAtDeadline (C4, §4; trail row "retired 08t capture race").

  describe('a declared sitting answered while its line is being paid', () => {
    let coordinator: Client;
    const declared = () => ({ offerItemId: itemA1, attempt: 'retake' as const, mode: 'in_school' as const, teacherId, priorSitting: { month: 'june' as const, year: Y } });
    const declare = async (tag: string) => {
      const f = await onboard(officer, `t08-decl-${tag}-${RUN}`, 11);
      const [line] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: { sessionId: s1, studentId: f.studentId, lines: [declared()], consent: CONSENT } }));
      return { f, id: line!.id };
    };
    const reject = (id: string) => coordinator.api.v1.registrations[':id']['verify-prior'].$post({ param: { id }, json: { outcome: 'rejected', reason: 'no such sitting on record' } });
    const checkout = (f: { parent: Client }, id: string) => f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [id], paymentMethod: 'in_school', escrowAmountToApply: 0 } });
    const state = (id: string) => one<{ status: string; outcome: string | null; payments: string }>(
      `select r.status, r.prior_sitting_verified_outcome as outcome, (select count(*) from payment_registration pr where pr.registration_id = r.id) as payments from registration r where r.id = $1`, [id]);

    beforeAll(async () => {
      coordinator = await staff(adm, 'coordinator', 't08v');
    });

    it('the checkout first: it opens its payment, and the rejection is refused while it is open', async () => {
      const { f, id } = await declare('cf');
      const release = await holdRowLock('registration', id);
      let pay: Promise<Res> | undefined;
      let rej: Promise<Res> | undefined;
      try {
        pay = checkout(f, id);
        await lockWaiters(1);
        rej = reject(id);
        await lockWaiters(2);
      } finally {
        await release();
      }
      expect((await pay!).status).toBe(201);
      const r = await rej!;
      expect(r.status).toBe(409);
      expect(((await r.json()) as { error: string }).error).toBe('A payment for this line is in progress: confirm or reject it in the Finance Workbench first');
      expect(await state(id)).toEqual({ status: 'pending_payment', outcome: null, payments: '1' });
    });

    it('the rejection first: the line expires, and the checkout that waited is refused, no payment made', async () => {
      const { f, id } = await declare('rf');
      const release = await holdRowLock('registration', id);
      let pay: Promise<Res> | undefined;
      let rej: Promise<Res> | undefined;
      try {
        rej = reject(id);
        await lockWaiters(1);
        pay = checkout(f, id);
        await lockWaiters(2);
      } finally {
        await release();
      }
      expect((await rej!).status).toBe(200);
      expect((await pay!).status).toBeGreaterThanOrEqual(400);
      expect(await state(id)).toEqual({ status: 'expired', outcome: 'rejected', payments: '0' });
      expect(await sql(`select 1 from payment where student_id = $1`, [f.studentId])).toEqual([]);
    });

    it('verified while its payment is confirmed: both land, the line paid and verified', async () => {
      const { f, id } = await declare('vc');
      const pay = await apiResponse(checkout(f, id));
      const release = await holdRowLock('registration', id);
      let conf: Promise<Res> | undefined;
      let ver: Promise<Res> | undefined;
      try {
        conf = officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay.id! }, json: { instrumentUsed: 'cash' } });
        await lockWaiters(1);
        ver = coordinator.api.v1.registrations[':id']['verify-prior'].$post({ param: { id }, json: { outcome: 'verified', reason: 'the board statement of results' } });
        await lockWaiters(2);
      } finally {
        await release();
      }
      expect((await conf!).status).toBe(200);
      expect((await ver!).status).toBe(200);
      expect(await state(id)).toEqual({ status: 'confirmed', outcome: 'verified', payments: '1' });
    });

    // One lock order for a line and its receipt (the lead's decision of 8 Oct): the receipt first,
    // then the line — MA-16's order, taken by a payment reversal, a receipt's void (ST-14) and
    // return, the receipt-gated drop, a parent's approval of a change request and the
    // coordinator's answer. Each pair forced in both orders on the line's row lock: one waits,
    // nothing deadlocks.
    describe("a parent's approval of a drop against the coordinator's rejection of the same paid line", () => {
      const paidDeclared = async (tag: string) => {
        const f = await onboard(officer, `t08-apr-${tag}-${RUN}`, 11);
        const desk = await apiResponse(officer.api.v1.registrations.desk.$post({
          json: { studentId: f.studentId, sessionId: s1, lines: [declared()], consent: CONSENT, collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
        }));
        const id = desk.registrations[0]!.id;
        // The paid line has its receipt at the desk: both sides lock it.
        expect(await one(`select status from receipt where registration_id = $1`, [id])).toEqual({ status: 'pending_issue' });
        const cr = await apiResponse(f.student.api.v1.registrations[':id']['request-drop'].$post({ param: { id }, json: { reason: 'race: no longer sitting it' } }));
        const approve = () => f.parent.api.v1['change-requests'][':id'].approve.$put({ param: { id: cr.id }, json: {} });
        return { id, approve };
      };
      const after = (id: string) => one<{ status: string; outcome: string | null; rejected: boolean; drops: string }>(
        `select r.status, r.prior_sitting_verified_outcome as outcome, r.declaration_rejected as rejected,
          (select count(*) from escrow_transaction e where e.related_registration_id = r.id and e.reason = 'drop') as drops
         from registration r where r.id = $1`, [id]);

      it('the approval first: the line is dropped, and the rejection that waited finds nothing to answer', async () => {
        const { id, approve } = await paidDeclared('af');
        const release = await holdRowLock('registration', id);
        let apr: Promise<Res> | undefined;
        let rej: Promise<Res> | undefined;
        try {
          apr = approve();
          await lockWaiters(1);
          rej = reject(id);
          await lockWaiters(2);
        } finally {
          await release();
        }
        const [a, r] = await Promise.all([apr!, rej!]);
        expect(a.status).toBe(200);
        expect(r.status).toBe(409);
        expect(((await r.json()) as { error: string }).error).toBe('This line is no longer reserved: there is nothing to verify');
        expect(await after(id)).toEqual({ status: 'dropped', outcome: null, rejected: false, drops: '1' });
      });

      it('the rejection first: the paid line stands as a first entry, then the approval drops it', async () => {
        const { id, approve } = await paidDeclared('rf');
        const release = await holdRowLock('registration', id);
        let apr: Promise<Res> | undefined;
        let rej: Promise<Res> | undefined;
        try {
          rej = reject(id);
          await lockWaiters(1);
          apr = approve();
          await lockWaiters(2);
        } finally {
          await release();
        }
        const [r, a] = await Promise.all([rej!, apr!]);
        expect(r.status).toBe(200);
        expect(a.status).toBe(200);
        expect(await after(id)).toEqual({ status: 'dropped', outcome: 'rejected', rejected: true, drops: '1' });
      });
    });

    it("a payment confirmed while a rejection waits for the line: the rejection is refused (try again), then answered with the receipt first", async () => {
      // Between the entry deadline and the retake deadline: a declared retake of the previous sitting is still payable.
      const sw = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `t08pm-${RUN}`, entryDeadline: new Date(Date.now() + days(30)), retakeDeadline: new Date(Date.now() + days(35)) } })))!.id;
      const sp = await mkSession(`t08pm-${RUN}`);
      // P1c: offered through the subject editor, its row in the session's sitting — sw, by its label.
      const item = (await offerOf(sp, subA)).items[0]!;
      expect(await one(`select board_series_id as s from session_offer_item where id = $1`, [item])).toEqual({ s: sw });
      const f = await onboard(officer, `t08-pm-${RUN}`, 11);
      const [line] = await apiResponse(f.parent.api.v1.registrations.direct.$post({ json: {
        sessionId: sp, studentId: f.studentId, lines: [{ offerItemId: item, attempt: 'retake', mode: 'in_school', teacherId, priorSitting: { month: 'november', year: Y } }], consent: CONSENT,
      } }));
      const id = line!.id;
      const pay = await apiResponse(checkout(f, id));
      await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [sw]);
      // No receipt yet: the rejection finds none to lock, then waits for the line behind the confirmation.
      expect(await sql(`select 1 from receipt where registration_id = $1`, [id])).toEqual([]);
      const release = await holdRowLock('registration', id);
      let conf: Promise<Res> | undefined;
      let rej: Promise<Res> | undefined;
      try {
        conf = officer.api.v1.payments[':id'].confirm.$post({ param: { id: pay.id! }, json: { instrumentUsed: 'cash' } });
        await lockWaiters(1);
        rej = reject(id);
        await lockWaiters(2);
      } finally {
        await release();
      }
      expect((await conf!).status).toBe(200);
      const r = await rej!;
      const { PAID_MEANWHILE } = await import('../src/services/verification.services');
      expect([r.status, ((await r.json()) as { error?: string }).error]).toEqual([409, PAID_MEANWHILE]);
      expect(await state(id)).toEqual({ status: 'confirmed', outcome: null, payments: '1' });
      // Asked again: the receipt exists and is taken first; past the first-entry deadline the paid line is dropped.
      const again = await apiResponse(reject(id));
      expect(again).toMatchObject({ outcome: 'rejected', effect: 'dropped' });
    });

    describe("a payment reversal against the coordinator's rejection of the same paid line", () => {
      const paidAtDesk = async (tag: string) => {
        const f = await onboard(officer, `t08-rev-${tag}-${RUN}`, 11);
        const desk = await apiResponse(officer.api.v1.registrations.desk.$post({
          json: { studentId: f.studentId, sessionId: s1, lines: [declared()], consent: CONSENT, collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
        }));
        const id = desk.registrations[0]!.id;
        const reverse = () => finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: desk.payments[0]!.id }, json: { reason: 'race: confirmed by mistake', moneyReturned: true } });
        return { id, reverse };
      };
      const after = (id: string) => one<{ status: string; outcome: string | null; rejected: boolean }>(
        `select status, prior_sitting_verified_outcome as outcome, declaration_rejected as rejected from registration where id = $1`, [id]);

      it('the rejection first: it holds the receipt and the line; the reversal waits, then reverts the payment', async () => {
        const { id, reverse } = await paidAtDesk('jf');
        const release = await holdRowLock('registration', id);
        let rej: Promise<Res> | undefined;
        let rev: Promise<Res> | undefined;
        try {
          rej = reject(id);
          await lockWaiters(1);
          rev = reverse();
          await lockWaiters(2);
        } finally {
          await release();
        }
        const [r, v] = await Promise.all([rej!, rev!]);
        expect(r.status).toBe(200);
        expect(v.status).toBe(200);
        // Rejected while paid, it stood as a first entry; the reversal then undid the payment.
        expect(await after(id)).toEqual({ status: 'pending_payment', outcome: 'rejected', rejected: true });
      });

      it('the reversal first: the line waits for payment again, and the rejection that waited ends it', async () => {
        const { id, reverse } = await paidAtDesk('vf');
        const release = await holdRowLock('registration', id);
        let rej: Promise<Res> | undefined;
        let rev: Promise<Res> | undefined;
        try {
          rev = reverse();
          await lockWaiters(1);
          rej = reject(id);
          await lockWaiters(2);
        } finally {
          await release();
        }
        const [v, r] = await Promise.all([rev!, rej!]);
        expect(v.status).toBe(200);
        expect(r.status).toBe(200);
        expect(await after(id)).toEqual({ status: 'expired', outcome: 'rejected', rejected: false });
      });
    });

    // 'the hold step run by two schedulers at once drops a paid unverified line once' retired with
    // holdUnverifiedAtDeadline and its setting (§4; trail row "retired 08t hold race").
  });

  describe("a parent's approval of a drop against a reversal of the line's payment (MA-16's order: the receipt, then the line)", () => {
    const setUp = async (tag: string) => {
      const sub = await subject(adm, `RWT-DR${tag}-${RUN}`, `Race drop reversal ${tag} (08t ${RUN})`, { course: 1000, registration: 500 });
      const o = await offerOf(s1, sub);
      const f = await onboard(officer, `t08-dr${tag}-${RUN}`, 11);
      const [line] = await reserveAtDesk(f.studentId, s1, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }]);
      const p = (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [line!.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } })))!.id!;
      await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: p }, json: { instrumentUsed: 'cash' } }));
      const cr = (await apiResponse(f.student.api.v1.registrations[':id']['request-drop'].$post({ param: { id: line!.id }, json: { reason: 'race: not sitting it' } })))!;
      return {
        line: line!.id, payment: p, cr: cr.id,
        approve: () => f.parent.api.v1['change-requests'][':id'].approve.$put({ param: { id: cr.id }, json: {} }),
        reverse: () => finadmin.api.v1.payments[':id'].reverse.$post({ param: { id: p }, json: { reason: 'race: confirmed by mistake', moneyReturned: false } }),
      };
    };
    const state = async (s: { line: string; payment: string; cr: string }) => ({
      line: (await one<{ s: string }>(`select status as s from registration where id = $1`, [s.line])).s,
      payment: (await one<{ s: string }>(`select status as s from payment where id = $1`, [s.payment])).s,
      request: (await one<{ s: string }>(`select status as s from change_request where id = $1`, [s.cr])).s,
    });
    const errorOf = async (r: Res) => (r.status >= 400 ? (await r.json() as { error: string }).error : null);

    it('the approval first: it drops the line; the reversal then refuses (the subject was dropped) — no deadlock', async () => {
      const s = await setUp('a');
      // The line held: the approval (its receipt taken) queues on it, then the reversal on the receipt.
      const release = await holdRowLock('registration', s.line);
      let approving: Promise<Res> | undefined;
      let reversing: Promise<Res> | undefined;
      try {
        approving = s.approve();
        await lockWaiters(1);
        reversing = s.reverse();
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [a, r] = await Promise.all([approving!, reversing!]);
      expect([a.status, await errorOf(a)]).toEqual([200, null]);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(await errorOf(r)).toBe('A subject on this payment has already been dropped or changed — undo that first, or settle the difference as a refund');
      expect(await state(s)).toEqual({ line: 'dropped', payment: 'completed', request: 'approved' });
    });

    it('the reversal first: it reverts the line; the approval then refuses (already processed) — no deadlock', async () => {
      const s = await setUp('b');
      const release = await holdRowLock('registration', s.line);
      let reversing: Promise<Res> | undefined;
      let approving: Promise<Res> | undefined;
      try {
        reversing = s.reverse();
        await lockWaiters(1);
        approving = s.approve();
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [r, a] = await Promise.all([reversing!, approving!]);
      expect([r.status, await errorOf(r)]).toEqual([200, null]);
      expect(a.status).toBeGreaterThanOrEqual(400);
      expect(a.status).toBeLessThan(500);
      expect(await errorOf(a)).toMatch(/already processed/);
      expect(await state(s)).toEqual({ line: 'pending_payment', payment: 'refunded', request: 'pending_approval' });
    });
  });

  // "a fee list pasted out of id order against a line priced on two of its rows: the put takes them in id order, the line
  // waits for it, nothing deadlocks" retired with the series' fee grid (P1c: a line is priced by its own row; there are
  // no fee rows to take in order). A price list applied while a reservation lands — the line waits and is priced from
  // the new fee — is 08za's "races (§9.2): a reservation landing while a list applies waits for it and is priced from
  // the new fee; …".

  // "a swap while the fee row its new line and its old line read is confirmed (the review of B)" — the Confirm first,
  // the approval first, and the parent's own swap — retired with the grid row's Confirm (P1c): no two subjects read one
  // fee row any more, each line is priced by its own row. A swap's money — the new line at the price the request showed,
  // refused if it moved (SWAP_PRICE_CHANGED), today's price for a request from before step B, the old line dropped — is
  // 08o's "a swap's new line inherits the dropped line's consent and refund steps".

  // "a fee row that exists nowhere when the admin's move begins, created and confirmed by finance around it" (both
  // orders) retired with the series' fee grid, its lock and its Confirm (P1c): the admin's move reads no fee row and
  // keeps each line's price. Its money — a moved line keeps its price, waiting or paid — is 08n's "the admin's move
  // keeps each line's price (P1c): …" and 08q's "a plan line moved to another series keeps its price there — and its
  // last instalment captures it".

  describe('a change whose students keep changing (the review of F1): after three retries, a 409 with its sentence, nothing changed', () => {
    /**
     * Four reservations landing one after another while a change that locks its students first
     * runs (lib/student-locks.ts). The change's first run waits for its first student (held by the
     * test). Each round: the next newcomer's own row is held (so the change's next run, which locks
     * it, waits there), the newcomer's line is committed, then the student the change is waiting
     * for is let go: that run reads the lines, meets the newcomer, and runs again — until the
     * fourth newcomer, which is the refusal. Each wait is checked with pg_blocking_pids.
     */
    const fourNewcomers = async (o: { first: string; newcomers: string[]; line: (studentId: string) => [string, unknown[]]; fire: () => Promise<Res> }) => {
      const { default: pg } = await import('pg');
      const open: InstanceType<typeof pg.Client>[] = [];
      const holdStudent = async (id: string) => {
        const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
        await c.connect();
        open.push(c);
        await c.query('BEGIN');
        await c.query(`select id from "user" where id = $1 for no key update`, [id]);
        return c;
      };
      const blockedBy = (c: InstanceType<typeof pg.Client>) => waitFor(async () =>
        Number((await sql<{ n: string }>(`select count(*) as n from pg_stat_activity a where $1 = any(pg_blocking_pids(a.pid))`,
          [(c as unknown as { processID: number }).processID]))[0]?.n) > 0 || null);
      const made: string[] = [];
      try {
        let held = await holdStudent(o.first);
        const firing = o.fire();
        for (let k = 0; k < 4; k++) {
          // The change waits for the held student — unless it answered first (then say what it answered).
          const early = await Promise.race([blockedBy(held).then(() => null), firing.then((r) => `answered ${r.status}`)]);
          if (early) throw new Error(`the change did not wait for its student (round ${k}): ${early}`);
          const next = k < 3 ? await holdStudent(o.newcomers[k]!) : undefined;
          const [text, params] = o.line(o.newcomers[k]!);
          made.push((await one<{ id: string }>(`${text} returning id`, params)).id);
          await held.query('COMMIT');
          if (next) held = next;
        }
        return { res: await firing, made };
      } finally {
        for (const c of open) {
          await c.query('ROLLBACK').catch(() => undefined);
          await c.end().catch(() => undefined);
        }
      }
    };
    /** A waiting line of a student on an item, as a reservation that landed would leave it. */
    const lineOn = (sessionId: string, subjectId: string, itemId: string, seriesId: string) => (studentId: string): [string, unknown[]] => [
      `insert into registration (id, student_id, session_id, subject_id, price_at_registration, status, requested_by, offer_item_id, board_series_id, due_at)
       values (gen_random_uuid()::text, $1, $2, $3, 0, 'pending_payment', $4, $5, $6, now() + interval '30 days')`,
      [studentId, sessionId, subjectId, studentId, itemId, seriesId],
    ];
    const refusal = async (r: Res) => [r.status, (await r.json() as { error?: string }).error ?? null];
    const mkSeries = async (boardCode: 'cambridge' | 'pearson_edexcel', year: number, label: string, entryDeadline: Date) =>
      (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode, month: 'june', year, label, entryDeadline } })))!.id;
    let newcomers: string[];
    const made: string[] = [];

    beforeAll(async () => {
      newcomers = [];
      for (let i = 1; i <= 4; i++) newcomers.push((await onboard(officer, `t08-nc${i}-${RUN}`, 11)).studentId);
    });
    afterAll(async () => {
      // The newcomers' lines stood for reservations that landed; nothing else reads them.
      if (made.length) await sql(`delete from registration where id in $1`, [made]);
    });

    // "an item's series change" retired with the old item route (P1c: a row's sitting does not change while lines use
    // it, 08u). No money moved in it: the change was refused and nothing changed.

    it("the session's series correction", async () => {
      const sc = await mkSession(`t08-nc-${RUN}`);
      const sub = await subject(adm, `RWT-NC-${RUN}`, `Newcomers correction (08t ${RUN})`, { course: 1000, registration: 500 });
      const from = await mkSeries('cambridge', Y + 1, `t08-nc-${RUN}`, new Date(Date.now() + days(50)));
      // The corrected year's sitting, on record with its deadline.
      await mkSeries('cambridge', Y + 2, `t08-nc-${RUN}`, new Date(Date.now() + days(50)));
      // P1c: offered through the subject editor, its row in the session's sitting — from, by its label (the grid's fee
      // rows in both series left: a corrected line keeps its price).
      const o = await offerOf(sc, sub);
      expect(await one(`select board_series_id as s from session_offer_item where id = $1`, [o.items[0]])).toEqual({ s: from });
      const f = await onboard(officer, `t08-ncs-${RUN}`, 11);
      await reserveAtDesk(f.studentId, sc, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }]);
      const r = await fourNewcomers({
        first: f.studentId, newcomers, line: lineOn(sc, sub, o.items[0]!, from),
        fire: () => adm.api.v1.sessions[':id'].series.$put({ param: { id: sc }, json: { sessionType: 'june', seriesYear: Y + 2, reason: 'race: the next June' } }),
      });
      made.push(...r.made);
      expect(await refusal(r.res)).toEqual([409, STUDENTS_KEPT_CHANGING]);
      expect(await one(`select series_year as y from registration_session where id = $1`, [sc])).toEqual({ y: Y + 1 });
    });

    // "a board change from the Subjects form" and "a board change from the Catalogue" retired (P1c): every subject is
    // offered through the subject editor, priced by its rows, and such a subject refuses a board change before it takes
    // a student (08y "… a board change does not move it …"; catalogue.services BOARD_CHANGE_REFUSAL), so no newcomer can
    // meet one. No money moved in them: the change was refused and nothing changed.
  });

  // "a Confirm landing inside a move (the review of 40c1447)" — an item's series change, the admin's move, a board change
  // and the session's series correction, each with a grid row's Confirm landing inside it — retired with the grid row's
  // Confirm (P1c): a move keeps each line's price and reads no fee row. The moves' money — a moved line keeps its price —
  // is 08n's "the admin's move keeps each line's price (P1c): …" and 08q's "a plan line moved to another series keeps
  // its price there — and its last instalment captures it"; the item's series change and the board change refuse such
  // moves since P1c (08u, 08y).
});

/**
 * The reservations rework, step C — the money races (RESERVATIONS_REWORK.md §8's list:
 * "a one-shot gate used twice at once", "an exception revoked while a line relies on it",
 * "capture racing a deadline"; docs/features/RESERVATIONS_MONEY.md §2). Each forced in both
 * orders where both can happen:
 * - a revocation takes the students it covers first (RESERVATIONS.md §2.1), so a line reserved
 *   under a payment due-date exception is either committed before it (and re-dated with the
 *   others) or reserved after it (without it) — never left due on a revoked date;
 * - a family's one-shot gate wanted by two of its children at once: the gate's row is locked
 *   FOR UPDATE by the rule that reads it and marked used in that transaction; one gets it;
 * - the last instalment's confirmation and the deadline sweep on the same line: the line's lock
 *   decides; confirmed by one capture and never settled, or expired and settled once with the
 *   confirmation refused and the payment failed.
 */
describe('08t: the rework races — money (step C)', () => {
  let adm: Client, officer: Client, finadmin: Client;
  const subj: Record<string, string> = {};
  const inDays = (d: number) => new Date(Date.now() + days(d));
  const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  // Step B: the desk reserves lines with the parent's consent; `selfStudy` makes them self-study lines.
  const desk = async (studentId: string, sessionId: string, subjectIds: string[], extra: { selfStudy?: boolean } = {}) => {
    const r = await reservationOf(sessionId, subjectIds);
    const lines = extra.selfStudy ? r.lines.map((l) => ({ ...l, mode: 'self_study' as const })) : r.lines;
    return officer.api.v1.registrations.desk.$post({ json: { studentId, sessionId, lines, consent: r.consent } });
  };
  const dueOf = async (id: string) => new Date((await one<{ d: string }>(`select due_at as d from registration where id = $1`, [id])).d).getTime();
  const teacherOf = async (itemId: string) =>
    (await one<{ t: string }>(`select t.teacher_id as t from session_offer_teacher t join session_offer_item i on i.offer_id = t.offer_id where i.id = $1 limit 1`, [itemId])).t;
  const itemOf = async (sessionId: string, subjectId: string) =>
    (await one<{ id: string }>(`select i.id from session_offer_item i join session_offer o on o.id = i.offer_id where o.session_id = $1 and o.subject_id = $2`, [sessionId, subjectId])).id;

  beforeAll(async () => {
    adm = await admin('t08m');
    officer = await staff(adm, 'finance_officer', 't08m');
    finadmin = await staff(adm, 'finance_admin', 't08m');
    for (let i = 1; i <= 4; i++) {
      subj[`M${i}`] = await subject(adm, `RWT-M${i}-${RUN}`, `Race money ${i} (08t ${RUN})`, { course: 1000, registration: 500 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    }
  });

  it('an exception revoked while a line relies on it: the revocation waits for the reservation, then re-dates its line; one that lands first leaves the line without it', async () => {
    const s = await session(adm, 'June (AS, races revoke)', 'june', 'as_level', { ...openWindow(), activate: true });
    const item = await itemOf(s, subj.M1!);
    const teacherId = await teacherOf(item);
    const control = await onboard(officer, `t08m-ctl-${RUN}`, 12);
    const [ctl] = (await apiResponse(desk(control.studentId, s, [subj.M1!]))).registrations;
    const usual = await dueOf(ctl!.id);
    const grant = async (studentId: string) => apiResponse(finadmin.api.v1.exceptions.$post({
      json: { policyKey: 'deadline.payment', studentId, scope: { sessionId: s }, value: cairoDate(inDays(12)), reason: 'race: pays after the salary' },
    }));
    const revoke = (id: string) => finadmin.api.v1.exceptions[':id'].revoke.$post({ param: { id } });

    // The reservation first: it holds the student while it commits; the revocation waits for it.
    const f = await onboard(officer, `t08m-rv-a-${RUN}`, 12);
    const ex = await grant(f.studentId);
    let inserted!: () => void;
    let commit!: () => void;
    const isIn = new Promise<void>((r) => { inserted = r; });
    const until = new Promise<void>((r) => { commit = r; });
    const reserving = settle(reserveHeld(f.studentId, s, [{ offerItemId: item, attempt: 'first', mode: 'in_school', teacherId }], { inserted, until }));
    await isIn;
    const revoking = revoke(ex.id);
    // Waiting on the student (or, were it not locked first, already done — and the line left behind).
    await Promise.race([lockWaiters(1).catch(() => undefined), revoking]);
    commit();
    expect((await reserving).ok).toBe(true);
    expect((await revoking).status).toBe(200);
    const [a] = await live(f.studentId);
    expect(await dueOf(a!.id)).toBe(usual);
    expect(await sql(`select 1 from audit_log where action = 'LINE_DUE_MOVED' and entity_id = $1`, [a!.id])).toHaveLength(1);

    // The revocation first: the reservation waits on the student and reads it revoked.
    const g = await onboard(officer, `t08m-rv-b-${RUN}`, 12);
    const ex2 = await grant(g.studentId);
    const release = await holdRowLock('"user"', g.studentId);
    let revoking2: Promise<Res> | undefined;
    let reserving2: Promise<Res> | undefined;
    try {
      revoking2 = revoke(ex2.id);
      await lockWaiters(1);
      reserving2 = desk(g.studentId, s, [subj.M1!]);
      await lockWaiters(2);
    } finally {
      await release();
    }
    expect((await revoking2!).status).toBe(200);
    expect((await reserving2!).status).toBe(201);
    const [b] = await live(g.studentId);
    expect(await dueOf(b!.id)).toBe(usual);
    expect(await sql(`select 1 from audit_log where action = 'LINE_DUE_MOVED' and entity_id = $1`, [b!.id])).toEqual([]);
  });

  it("a family's one-shot gate wanted by two of its children at once: one reservation gets it, the other is refused", async () => {
    const s = await session(adm, 'June (AS, races one-shot)', 'june', 'as_level', { ...openWindow(), activate: true });
    const f = await onboard(officer, `t08m-gate-${RUN}`, 12);
    const sibling = await apiResponse(officer.api.v1.links['desk-onboard'].$post({
      json: { parent: { email: f.parent.email }, student: { email: `student.t08m-gate-sib-${RUN}@test.local`, name: `Student t08m-gate-sib ${RUN}`, password: 'TestPass1', grade: 12 } },
    }));
    const gate = await apiResponse(finadmin.api.v1.exceptions.$post({ json: { policyKey: 'gate.selfStudyFirstEntry', familyId: f.parent.id, reason: 'race: one of them studies abroad' } }));
    const selfStudy = (studentId: string) => desk(studentId, s, [subj.M2!], { selfStudy: true });
    const release = await holdRowLock('exception', gate.id);
    let one1: Promise<Res> | undefined;
    let two: Promise<Res> | undefined;
    try {
      one1 = selfStudy(f.studentId);
      two = selfStudy(sibling.student.id);
      await lockWaiters(2);
    } finally {
      await release();
    }
    const out = await Promise.all([one1!, two!]);
    expect(out.map((r) => r.status).sort()).toEqual([201, 400]);
    const loser = out.find((r) => r.status === 400)!;
    expect((await loser.json() as { error: string }).error).toContain('only be taken outside school');
    const lines = [...(await live(f.studentId)), ...(await live(sibling.student.id))];
    expect(lines).toHaveLength(1);
    expect(await one(`select status, used_for as used from exception where id = $1`, [gate.id])).toEqual({ status: 'used', used: { registrationIds: [lines[0]!.id] } });
    expect(Number((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'EXCEPTION_USED' and entity_id = $1`, [gate.id])).n)).toBe(1);
  });

  it("the desk collects a line and another line's instalment while both lines' rows are re-priced (E7, by row): every line taken in one id-ordered pass, so the two never deadlock", async () => {
    const s = await session(adm, 'June (AS, races desk lines)', 'june', 'as_level', { ...openWindow(), activate: true });
    const f = await onboard(officer, `t08m-dl-${RUN}`, 12);
    const made = (await apiResponse(desk(f.studentId, s, [subj.M1!, subj.M2!]))).registrations.map((r) => r.id).sort();
    // The plan on the line that sorts first, the other paid outright: a desk that took its own line
    // and then the plan line would take them in the reverse of the re-price's id order.
    const [planLine, payLine] = made as [string, string];
    const plan = await apiResponse(finadmin.api.v1.exceptions.$post({
      json: {
        policyKey: 'plan.instalments', studentId: f.studentId, scope: { registrationId: planLine },
        value: [{ dueAt: inDays(1).toISOString(), amount: 750 }, { dueAt: inDays(5).toISOString(), amount: 750 }], reason: 'race: paying in two',
      },
    }));
    const [i1] = (await sql<{ id: string }>(`select id from charge where plan_exception_id = $1 order by instalment_no`, [plan.id])).map((r) => r.id);
    // The coordinator rework: the board changed both fees — one price list, both rows in one batch (§9.2's order:
    // the offerings and their rows FOR UPDATE, then the lines FOR UPDATE in id order, then their payment history).
    const codes = await sql<{ code: string }>(`select code from subject where id in ($1, $2) order by code`, [subj.M1!, subj.M2!]);
    const apply = () => adm.api.v1.sessions[':id']['price-lists'].$post({
      param: { id: s },
      json: {
        board: 'pearson_edexcel', name: `race ${RUN}`, rows: codes.map((c, i) => ({ lineNo: i + 1, code: c.code, name: '', amount: 650 })),
        // What it will do once the collection has landed: both lines listed for finance, none re-priced.
        expected: { repriced: 0, listedForFinance: 2, linesAffected: 0, dueDatesMoved: 0 },
      },
    });
    // The collection paused at its first audit row, holding the lines it has taken; the re-price
    // then waits on one of them; released, the collection takes the instalment's charge.
    const release = await pauseAtAudit('PAYMENT_INITIATED');
    let collecting: Promise<Res> | undefined;
    let repricing: Promise<Res> | undefined;
    try {
      collecting = officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, registrationIds: [payLine], chargeIds: [i1!], instrumentUsed: 'cash' } });
      await lockWaiters(1);
      repricing = apply();
      await lockWaiters(2);
    } finally {
      await release();
    }
    const [c, r] = await Promise.all([collecting!, repricing!]);
    const collected = await c.json() as { data?: { collected: number }; error?: string };
    expect([c.status, collected.error]).toEqual([201, undefined]);
    expect(collected.data!.collected).toBe(2250);
    // Either side refused would name why (a deadlock is "deadlock detected").
    const repriced = await r.json() as { data?: { saved: boolean; impact: unknown }; error?: string };
    expect([r.status, repriced.error]).toEqual([200, undefined]);
    expect(repriced.data).toMatchObject({ saved: true, impact: { repriced: 0, listedForFinance: 2 } });
    const batch = await one<{ listed: { id: string; reason: string }[]; repriced: unknown[] }>(
      `select new_data->'listedForFinance' as listed, new_data->'repriced' as repriced from audit_log where action = 'ROWS_REPRICED' and new_data->>'reason' like $1`, [`%race ${RUN}%`]);
    expect(batch.repriced).toEqual([]);
    expect(batch.listed.map((x) => [x.id, x.reason]).sort()).toEqual([[planLine, 'is paid by its instalment plan'], [payLine, 'has a payment (open, failed or paid)']].sort());
    expect(await sql(`select id, price_at_registration::float as p from registration where id in ($1, $2) order by id`, [planLine, payLine]))
      .toEqual([{ id: planLine, p: 1500 }, { id: payLine, p: 1500 }]);
    expect(await one(`select status from registration where id = $1`, [payLine])).toEqual({ status: 'confirmed' });
    expect(await one(`select status from charge where id = $1`, [i1!])).toEqual({ status: 'paid' });
  });

  describe("the last instalment's confirmation racing the line's deadline", () => {
    const setUp = async (tag: string) => {
      const s = await session(adm, `June (AS, races capture ${tag})`, 'june', 'as_level', { ...openWindow(), activate: true });
      const f = await onboard(officer, `t08m-cap-${tag}-${RUN}`, 12);
      const [line] = (await apiResponse(desk(f.studentId, s, [subj.M3!]))).registrations;
      const plan = await apiResponse(finadmin.api.v1.exceptions.$post({
        json: {
          policyKey: 'plan.instalments', studentId: f.studentId, scope: { registrationId: line!.id },
          value: [{ dueAt: inDays(1).toISOString(), amount: 750 }, { dueAt: inDays(5).toISOString(), amount: 750 }], reason: 'race: paying in two',
        },
      }));
      const [i1, i2] = (await sql<{ id: string }>(`select id from charge where plan_exception_id = $1 order by instalment_no`, [plan.id])).map((r) => r.id);
      await apiResponse(officer.api.v1.registrations.desk.collect.$post({ json: { studentId: f.studentId, chargeIds: [i1!], instrumentUsed: 'cash' } }));
      const p = await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { chargeIds: [i2!], paymentMethod: 'instapay' } }));
      await apiResponse(f.parent.api.v1.payments[':id']['instapay-reference'].$post({ param: { id: p.id! }, json: { reference: `T08M-${tag}-${RUN}` } }));
      // The series' entry deadline (the line's) a moment away.
      const series = (await one<{ s: string }>(`select board_series_id as s from registration where id = $1`, [line!.id])).s;
      await sql(`update board_series set entry_deadline = now() + interval '2 seconds' where id = $1`, [series]);
      const wallet = async () => {
        const w = await one<{ balance: string; held: string }>(`select balance, held_balance as held from escrow where student_id = $1`, [f.studentId]);
        return { free: money(w.balance), held: money(w.held) };
      };
      return {
        f, line: line!.id, plan: plan.id, payment: p.id!, wallet,
        confirm: () => officer.api.v1.payments[':id'].confirm.$post({ param: { id: p.id! }, json: {} }),
      };
    };
    const count = async (action: string, entityId: string) =>
      Number((await one<{ n: string }>(`select count(*) as n from audit_log where action = $1 and entity_id = $2`, [action, entityId])).n);

    it('the confirmation first (begun before the deadline): the line is captured; the sweep after the deadline finds it confirmed and settles nothing', async () => {
      const t = await setUp('a');
      const release = await holdRowLock('registration', t.line);
      let confirming: Promise<Res> | undefined;
      let sweeping: ReturnType<typeof settle<unknown>> | undefined;
      try {
        confirming = t.confirm();
        await lockWaiters(1);
        await pause(2500);
        sweeping = settle(runPaymentDeadlines());
        await lockWaiters(2);
      } finally {
        await release();
      }
      expect((await confirming!).status).toBe(200);
      expect((await sweeping!).ok).toBe(true);
      expect((await one<{ status: string }>(`select status from registration where id = $1`, [t.line])).status).toBe('confirmed');
      expect((await one<{ status: string }>(`select status from exception where id = $1`, [t.plan])).status).toBe('used');
      const capture = await one<{ id: string }>(`select p.id from payment p join payment_registration pr on pr.payment_id = p.id where pr.registration_id = $1`, [t.line]);
      expect(await count('PLAN_CAPTURED', capture.id)).toBe(1);
      expect([await count('PLAN_SETTLED', t.line), await count('REGISTRATION_EXPIRED', t.line)]).toEqual([0, 0]);
      expect(await t.wallet()).toEqual({ free: 0, held: 0 });
    });

    it('the sweep first (after the deadline): the line expires and its deposits are settled once; the confirmation is refused and the payment failed', async () => {
      const t = await setUp('b');
      await pause(2500);
      const release = await holdRowLock('registration', t.line);
      let sweeping: ReturnType<typeof settle<unknown>> | undefined;
      let confirming: Promise<Res> | undefined;
      try {
        sweeping = settle(runPaymentDeadlines());
        await lockWaiters(1);
        confirming = t.confirm();
        await lockWaiters(2);
      } finally {
        await release();
      }
      const refusedConfirm = await confirming!;
      expect(refusedConfirm.status).toBeGreaterThanOrEqual(400);
      expect((await refusedConfirm.json() as { error: string }).error).toContain('instalment plan has ended');
      expect((await sweeping!).ok).toBe(true);
      expect((await one<{ status: string }>(`select status from registration where id = $1`, [t.line])).status).toBe('expired');
      expect((await one<{ r: string }>(`select new_data->>'reason' as r from audit_log where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [t.line])).r).toBe('entry_deadline');
      expect(await count('PLAN_SETTLED', t.line)).toBe(1);
      // The open instalment payment is failed by the same sweep, after the expiry committed.
      expect((await one<{ status: string }>(`select status from payment where id = $1`, [t.payment])).status).toBe('failed');
      const settled = await one<{ kept: string; released: string }>(`select new_data->>'kept' as kept, new_data->>'released' as released from audit_log where action = 'PLAN_SETTLED' and entity_id = $1`, [t.line]);
      expect(money(settled.kept) + money(settled.released)).toBe(750);
      expect(await t.wallet()).toEqual({ free: money(settled.released), held: 0 });
      expect(await sql(`select 1 from payment_registration where registration_id = $1`, [t.line])).toEqual([]);
    });
  });
});

/**
 * Step D (RESERVATIONS_REWORK.md §3.8, docs/features/RESERVATIONS_MESSAGES.md): the reminder step
 * reads a line as unpaid and claims its reminder; a payment can be confirmed at the same moment. The
 * step locks the line FOR SHARE and reads it again (a statement of its own) before it claims, and the
 * desk's payment locks it FOR UPDATE, so one waits for the other, both orders: a payment taken first
 * means no reminder (the line has a payment open, then is paid);
 * a reminder claimed first goes out and the payment confirms after it (09: no reminder claimed after
 * its line was paid). (Two schedulers claiming one reminder at once: 08s.)
 */
describe('08t: the rework races — reminders (step D)', () => {
  // (afterAll for this block is imported with the others.)
  let adm: Client, officer: Client, teacherId: string, itemId: string, sessionId: string, dueDay: string;
  const RUN_D = Math.random().toString(36).slice(2, 6);
  const DAY = 86_400_000;
  const cairoDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
  // 09:30 Cairo on a Cairo day (UTC+2 or +3: the one that reads back right).
  const cairoNineThirty = (day: string) => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    for (const off of [2, 3]) {
      const t = new Date(Date.UTC(y, m - 1, d, 9 - off, 30));
      if (new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t) === '09:30') return t;
    }
    throw new Error('no Cairo 09:30');
  };
  const minusDays = (day: string, n: number) => { const [y, m, d] = day.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10); };
  const step = async (now: Date) => (await import('../src/services/messages-step.services')).runMessagesStep(now);
  const claims = (lineId: string) => sql<{ offset_days: number; sent_at: string }>(`select offset_days, sent_at from reminder_sent where target_id = $1 and kind = 'payment_due'`, [lineId]);
  const reminders = (email: string) => sql(`select 1 from notification n join "user" u on u.id = n.user_id where u.email = $1 and n.type = 'PAYMENT_REMINDER'`, [email]);

  beforeAll(async () => {
    adm = await admin(`t08d-${RUN_D}`);
    officer = await staff(adm, 'finance_officer', `t08d-${RUN_D}`);
    teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher (08t D ${RUN_D})` } })))!.id;
    dueDay = cairoDay(new Date(Date.now() + 20 * DAY));
    sessionId = (await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: academicYearStartOf() + 1, label: `t08d-${RUN_D}`, startDate: new Date(Date.now() - DAY).toISOString(), endDate: new Date(Date.now() + 60 * DAY).toISOString(),
        courseStartsOn: cairoDay(new Date()), paymentDueAt: new Date(`${dueDay}T10:00:00Z`).toISOString(),
      },
    })))!.id;
    // Its prices final (E6): its lines payable, so reminded (P1c: a line's price is provisional while they are not).
    await apiResponse(adm.api.v1.sessions[':id']['prices-final'].$put({ param: { id: sessionId }, json: { final: true } }));
    // The session's sitting (the series of its label), with an entry deadline well after the payment date.
    const series = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: academicYearStartOf() + 1, label: `t08d-${RUN_D}`, entryDeadline: new Date(Date.now() + 50 * DAY) } })))!.id;
    const code = `T08D-${RUN_D}`;
    await apiResponse(adm.api.v1.subjects.$post({ json: { name: `Physics (08t D ${RUN_D})`, code, council: 'cambridge', courseFee: 1000, registrationFee: 500, isOfferedAtSchool: true, isCore: false } }));
    // Offered through the coordinator's routes (P1c: the old offer route and the fee grid left): the subject by its code,
    // one all-papers row in the session's sitting at the exam fee 500 the grid row carried.
    const made = await apiResponse(adm.api.v1.sessions[':id'].offerings.$post({
      param: { id: sessionId }, json: { custom: { board: 'cambridge', name: `Physics (08t D ${RUN_D})`, level: 'igcse', group: 'O.L.', code } },
    }));
    const saved = await apiResponse(adm.api.v1.sessions[':id'].offerings[':offeringId'].$put({
      param: { id: sessionId, offeringId: made.id },
      json: {
        accepting: true, courseFee: 1000, teachers: [{ teacherId, online: false, external: false }],
        rows: [{ kind: 'all_papers', referenceCodes: [code], sitting: 'june', examFee: 500, cells: { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false } }],
      },
    }));
    itemId = saved.offering.rows[0]!.id;
    expect(saved.offering.rows[0]!.series?.id).toBe(series);
    // Reminders are off when the system is installed: on for these races, off again after.
    await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'reminders.enabled' }, json: { value: true, reason: 'the races need the step' } }));
  });

  afterAll(async () => {
    await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'reminders.enabled' }, json: { value: false, reason: 'back to as installed' } }));
  });

  const familyWithALine = async (tag: string) => {
    const f = await onboard(officer, `t08d-${tag}-${RUN_D}`, 11);
    const line = (await apiResponse(officer.api.v1.registrations.desk.$post({ json: { studentId: f.studentId, sessionId, lines: [{ offerItemId: itemId, attempt: 'first', mode: 'in_school', teacherId }], consent: CONSENT } }))).registrations[0]!.id;
    return { f, line };
  };
  const collect = (studentId: string, lineId: string) => apiResponse(officer.api.v1.registrations.desk.collect.$post({ json: { studentId, registrationIds: [lineId], instrumentUsed: 'cash', escrowAmountToApply: 0 } }));

  it('a payment taken while the reminder step reads the line: the step waits for the line, reads it being paid, and reminds nothing', async () => {
    const { f, line } = await familyWithALine('pay-first');
    // The desk holds the line (FOR UPDATE) while it writes the payment, paused at its creation row.
    const p = await pauseAtAudits(['PAYMENT_INITIATED']);
    try {
      const paying = collect(f.studentId, line);
      await p.paused('PAYMENT_INITIATED');
      const reminding = step(cairoNineThirty(minusDays(dueDay, 7)));
      // The step queues behind the desk on the line (or, were the line not locked, would run to its end).
      await Promise.race([lockWaiters(2), reminding]);
      await p.releaseAll();
      await Promise.all([paying, reminding]);
    } finally {
      await p.releaseAll();
    }
    expect((await one<{ status: string }>(`select status from registration where id = $1`, [line])).status).toBe('confirmed');
    expect(await claims(line)).toEqual([]);
    expect(await reminders(f.parent.email)).toEqual([]);
  });

  it('a reminder claimed while the payment is taken: the payment waits for the line, the reminder goes out once, before the payment confirms', async () => {
    const { f, line } = await familyWithALine('remind-first');
    const p = await pauseAtAudits(['REMINDERS_SENT']);
    try {
      const reminding = step(cairoNineThirty(minusDays(dueDay, 7)));
      await p.paused('REMINDERS_SENT');
      const paying = collect(f.studentId, line);
      await lockWaiters(2);
      await p.releaseAll();
      await Promise.all([reminding, paying]);
    } finally {
      await p.releaseAll();
    }
    expect((await one<{ status: string }>(`select status from registration where id = $1`, [line])).status).toBe('confirmed');
    const c = await claims(line);
    expect(c.map((x) => Number(x.offset_days))).toEqual([-7]);
    expect(await reminders(f.parent.email)).toHaveLength(1);
    const paidAt = (await one<{ at: string }>(`select p.confirmed_at as at from payment p join payment_registration pr on pr.payment_id = p.id where pr.registration_id = $1 and p.status = 'completed'`, [line])).at;
    expect(new Date(c[0]!.sent_at).getTime()).toBeLessThan(new Date(paidAt).getTime());
  });
  it('two senders of the same queued email: each claims it before sending (queued → sending), so it is sent once', async () => {
    const f = await onboard(officer, `t08d-mail-${RUN_D}`, 11);
    const when = new Date(Date.now() + 6 * 3_600_000);
    const s = await apiResponse(adm.api.v1.messages.$post({ json: {
      audience: { definition: { kind: 'direct', userIds: [f.parent.id] } }, title: 'Two senders, one email', body: 'Two senders pick up this email at once.', language: 'en', channels: ['in_app', 'email'], scheduledAt: when,
    } }));
    const svc = await import('../src/services/message.services');
    await svc.dispatchScheduledMessages(new Date(when.getTime() + 1000));
    const email = (await one<{ id: string }>(`select id from message_delivery where message_id = $1 and channel = 'email'`, [s.id])).id;
    const release = await holdRowLock('message_delivery', email);
    let sends: { sent: number; failed: number }[] = [];
    try {
      const a = svc.dispatchQueuedEmails({ messageId: s.id });
      const b = svc.dispatchQueuedEmails({ messageId: s.id });
      await lockWaiters(2);
      await release();
      sends = await Promise.all([a, b]);
    } finally {
      await release().catch(() => {});
    }
    expect(sends.reduce((n, x) => n + x.sent, 0)).toBe(1);
    expect(await one(`select status, attempts from message_delivery where id = $1`, [email])).toEqual({ status: 'sent', attempts: 1 });
  });
  it("the reminder step and the admin's change of the session's payment date at once: the step takes the session before its lines (A's order), so neither waits on the other in a cycle (the review of 5c2f2bf, item 3)", async () => {
    const { line } = await familyWithALine('session-change');
    // The session's own rule, so the step's group for this line is its own; its row held, so the step
    // stops there, inside its transaction, after it has taken what it takes before the message.
    const rule = await apiResponse(adm.api.v1.reminders.rules.$put({ json: { kind: 'payment_due', sessionId, offsetsDays: [-7], repeatEveryDays: null, channels: ['in_app'], templateId: 'tpl-payment-due', active: true, reason: 'this session, seven days ahead' } }));
    const release = await holdRowLock('reminder_rule', rule.id);
    const moved = new Date(new Date(`${dueDay}T10:00:00Z`).getTime() + 5 * DAY);
    // The coordinator rework (P1a): a payment date change answers the due dates it moves first; the change raced
    // here is the one sent back with them.
    const shown = await apiResponse(adm.api.v1.sessions[':id'].$put({ param: { id: sessionId }, json: { paymentDueAt: moved, reason: 'the payment date moves five days' } }));
    expect(shown).toMatchObject({ saved: false });
    let put: { status: number; body: string } | null = null;
    try {
      const reminding = step(cairoNineThirty(minusDays(dueDay, 7)));
      await lockWaiters(1);
      const changing = adm.api.v1.sessions[':id'].$put({ param: { id: sessionId }, json: { paymentDueAt: moved, reason: 'the payment date moves five days', expected: shown.impact } })
        .then(async (r) => ({ status: r.status, body: await r.text() }));
      // The change queues behind the step (on the session), or — the order before the fix — takes the
      // session and queues on the line the step holds.
      await lockWaiters(2);
      await release();
      [, put] = await Promise.all([reminding, changing]);
    } finally {
      await release().catch(() => {});
    }
    expect(put, put?.body).toMatchObject({ status: 200 });
    // The reminder went out on the date it was claimed for; then the line's date moved.
    expect((await claims(line)).map((c) => Number(c.offset_days))).toEqual([-7]);
    expect(new Date((await one<{ d: string }>(`select due_at as d from registration where id = $1`, [line])).d).getTime()).toBe(moved.getTime());
  });
});

/**
 * F4's derivation against "mark as sent" on the same entries (the review of 426d565, item 5). A
 * derivation that brings drafts up to date (or links a paid cash-in to its award) locks them all in
 * one statement in id order, as "mark as sent" and every withdrawal lock entries (RESERVATIONS.md
 * §2.1), so the two never wait on each other in a circle. Forced: the derivation held at its first
 * audit row with its entries locked, the send queued behind it; before the fix the derivation took
 * them one by one in its rows' order (by student name), and the send, holding the lower id, deadlocked
 * with it. The world is F4's own (exam-helpers.ts, tag 'xt').
 */
describe('08t: F4 — a derivation bringing drafts up to date while they are marked as sent', () => {
  let w: ExamWorld;
  beforeAll(async () => { w = await examWorld('xt'); }, 180_000);
  afterAll(async () => { await w.close(); });

  it('two drafts brought up to date as both are sent: the send waits for the derivation, nothing deadlocks', async () => {
    const coord = w.coordinator;
    const derive = () => apiResponse(coord.api.v1.exams.entries.derive.$post({ json: { boardSeriesId: w.series.cambridgeNov, commit: true } }));
    const lines: string[] = [];
    for (const k of ['r1', 'r2']) {
      const f = await onboard(w.officer, `x-xt-${k}`, 12);
      const [l] = await w.reserve(f, [{ offerItemId: w.items.sc, attempt: 'retake', mode: 'in_school', teacherId: w.teacherId, priorSitting: { month: 'june', year: Y } }]);
      lines.push(l!.id);
    }
    await derive();
    // Both declarations rejected: each retake draft is to be brought up to date as a first entry.
    for (const id of lines) {
      await apiResponse(coord.api.v1.registrations[':id']['verify-prior'].$post({ param: { id }, json: { outcome: 'rejected', reason: 'race: no such sitting on the statement' } }));
    }
    const [low, high] = await sql<{ id: string; student_id: string }>(
      `select id, student_id from exam_entry where registration_id in ($1, $2) and status = 'draft' order by id`, [lines[0], lines[1]]);
    // The derivation's rows go by student name: the student of the higher id first, so its order
    // and the send's (by id) cross.
    await sql(`update "user" set name = 'Aaa race x-xt' where id = $1`, [high!.student_id]);
    await sql(`update "user" set name = 'Zzz race x-xt' where id = $1`, [low!.student_id]);
    const p = await pauseAtAudits(['EXAM_ENTRY_UPDATED']);
    let results: [Awaited<ReturnType<typeof derive>>, unknown] | null = null;
    try {
      const deriving = derive();
      await p.paused('EXAM_ENTRY_UPDATED');
      const sending = apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [low!.id, high!.id] } }));
      await lockWaiters(2);
      await p.release('EXAM_ENTRY_UPDATED');
      results = await Promise.all([deriving, sending]);
    } finally {
      await p.releaseAll();
    }
    expect(results![0]).toMatchObject({ updated: 2 });
    expect(results![1]).toEqual({ submitted: 2, skipped: 0 });
    expect(await sql(`select is_retake, status from exam_entry where id in ($1, $2)`, [low!.id, high!.id]))
      .toEqual([{ is_retake: false, status: 'submitted' }, { is_retake: false, status: 'submitted' }]);
  });
});
