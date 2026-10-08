import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf, type LineInputType } from '@repo/validations';
import { admin, staff, onboard, subject, one, sql, money, lockWaiters, holdRowLock, type Client, reservationOf, CONSENT } from './helpers';

/**
 * The reservations rework, step 1 — races (RESERVATIONS_REWORK.md §6, §8; FEATURES_PLAN.md §5:
 * anything two people can act on at once has a race test, the dangerous order forced).
 *
 * The one lock order: the student FOR NO KEY UPDATE → the session → the subject's board → the
 * session's series links → the series → the offers → the items → the fee rows. Forced here:
 * - two desks reserving one item for one student: one line;
 * - the same entry in one series from two sessions, and two items of one exclusive group: the
 *   student lock serialises them, the second sees the first (no unique index can say this);
 * - an item closed, or a teacher removed, while a line is being reserved;
 * - a fee confirmed while a line is being priced: the line is never left provisional;
 * - a re-price racing a checkout, both orders: the lines are locked first; a checkout that
 *   lands first keeps its line untouched; one that lands after is refused (the price changed);
 * - an item's series changed while a checkout is open: refused once the checkout is in;
 * - capture racing the deadline sweep on one paid preregistration: refunded once.
 *
 * Since step B every reservation path takes lines (docs/features/RESERVATIONS_LINES.md §2), so
 * the races reserve through the desk's endpoint with the typed client, as staff do. One race
 * pauses a reservation between its fee lock and its commit, which a request cannot do: it runs
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

  const mkSession = async (label: string) => (await apiResponse(adm.api.v1.sessions.$post({
    json: {
      type: 'june', year: Y + 1, label, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
      courseStartsOn: cairoDate(new Date()), paymentDueAt: new Date(Date.now() + days(40)).toISOString(),
    },
  })))!.id;
  const whole = (boardSeriesId: string, extra: Record<string, unknown> = {}) =>
    ({ label: 'Whole subject', kind: 'whole' as const, enters: { kind: 'subject' as const }, boardSeriesId, availability: 'open' as const, requiredInSeries: false, ...extra });
  const offerOf = async (sessionId: string, subjectId: string, items: ReturnType<typeof whole>[], courseFee = 1000) =>
    (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({ param: { id: sessionId }, json: { subjectId, courseFee, teachers: [{ teacherId, mode: 'in_school' }], items } })))!;
  const feeFor = (seriesId: string, subjectId: string, amount = 500, provisional = false) =>
    apiResponse(adm.api.v1['board-fees'].$put({ query: { seriesId }, json: { rows: [{ keyKind: 'subject', keyId: subjectId, amount, provisional }] } }));
  /** Reserve only, at the desk: the lines and the desk's consent tick. */
  const viaDesk = (studentId: string, sessionId: string, lines: Line[]) =>
    officer.api.v1.registrations.desk.$post({ json: { studentId, sessionId, lines, consent: CONSENT } });
  const reserveAtDesk = async (studentId: string, sessionId: string, lines: Line[]) => (await apiResponse(viaDesk(studentId, sessionId, lines))).registrations;

  beforeAll(async () => {
    adm = await admin('t08');
    finadmin = await staff(adm, 'finance_admin', 't08');
    officer = await staff(adm, 'finance_officer', 't08');
    teacherId = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher T (08t ${RUN})` } })))!.id;
    s1 = await mkSession(`t08a-${RUN}`);
    s2 = await mkSession(`t08b-${RUN}`);
    series = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `t08-${RUN}`, entryDeadline: new Date(Date.now() + days(50)) } })))!.id;
    subA = await subject(adm, `RWT-A-${RUN}`, `Race A (08t ${RUN})`, { course: 1000, registration: 500 });
    await feeFor(series, subA);
    itemA1 = (await offerOf(s1, subA, [whole(series)])).items[0]!;
    itemA2 = (await offerOf(s2, subA, [whole(series)])).items[0]!;
    const subG = await subject(adm, `RWT-G-${RUN}`, `Race group (08t ${RUN})`, { course: 1000, registration: 500 });
    await feeFor(series, subG);
    const g = await offerOf(s1, subG, [whole(series, { label: 'AS', kind: 'route', exclusiveGroup: 'award' }), whole(series, { label: 'A Level', kind: 'route', exclusiveGroup: 'award' })]);
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

  it('the same entry in one series from two sessions at once: the student lock serialises them and the second is refused', async () => {
    const f = await onboard(officer, `t08-once-${RUN}`, 11);
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

  it('two items of one exclusive group at once: one line, the other refused', async () => {
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

  it('an item closed while a line is being reserved: the close waits for the line; a close that lands first refuses it', async () => {
    const sub = await subject(adm, `RWT-C-${RUN}`, `Race close (08t ${RUN})`, { course: 1000, registration: 500 });
    await feeFor(series, sub);
    const o = await offerOf(s1, sub, [whole(series)]);
    const close = () => adm.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({ param: { id: s1, offerId: o.id, itemId: o.items[0]! }, json: { availability: 'closed', reason: 'race: closed' } });
    const reopen = () => apiResponse(adm.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({ param: { id: s1, offerId: o.id, itemId: o.items[0]! }, json: { availability: 'open', reason: 'race: reopened' } }));
    // The line first: it holds the item FOR SHARE and waits on its fee row (held here, the last
    // lock of the order); the close queues behind the item; the line commits, then the close applies.
    const f = await onboard(officer, `t08-close-a-${RUN}`, 11);
    const feeRow = (await one<{ id: string }>(`select id from board_fee where board_series_id = $1 and key_id = $2`, [series, sub])).id;
    const releaseFee = await holdRowLock('board_fee', feeRow);
    let reserving: ReturnType<typeof settleRes> | undefined;
    let closing: Promise<Res> | undefined;
    try {
      reserving = settleRes(viaDesk(f.studentId, s1, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }]));
      await lockWaiters(1);
      closing = close();
      await lockWaiters(2);
    } finally {
      await releaseFee();
    }
    expect((await reserving!).ok).toBe(true);
    expect((await closing!).status).toBe(200);
    expect(await live(f.studentId)).toHaveLength(1);
    // The close first: the line waits for it, then is refused.
    await reopen();
    const g = await onboard(officer, `t08-close-b-${RUN}`, 11);
    const release = await holdRowLock('session_offer_item', o.items[0]!);
    let closing2: Promise<Res> | undefined;
    let reserving2: ReturnType<typeof settleRes> | undefined;
    try {
      closing2 = close();
      await lockWaiters(1);
      reserving2 = settleRes(viaDesk(g.studentId, s1, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }]));
      await lockWaiters(2);
    } finally {
      await release();
    }
    expect((await closing2!).status).toBe(200);
    expect(await reserving2!).toMatchObject({ ok: false, e: expect.stringMatching(/is closed in this session/) });
    expect(await live(g.studentId)).toHaveLength(0);
  });

  it("a teacher removed from the offer while a line naming them is reserved: removed first, the line is refused", async () => {
    const sub = await subject(adm, `RWT-R-${RUN}`, `Race teacher (08t ${RUN})`, { course: 1000, registration: 500 });
    await feeFor(series, sub);
    const other = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Teacher T2 (08t ${RUN})` } })))!.id;
    const o = (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({
      param: { id: s1 }, json: { subjectId: sub, courseFee: 1000, teachers: [{ teacherId, mode: 'in_school' }, { teacherId: other, mode: 'in_school' }], items: [whole(series)] },
    })))!;
    const f = await onboard(officer, `t08-teacher-${RUN}`, 11);
    const release = await holdRowLock('session_offer', o.id);
    let removing: Promise<Res> | undefined;
    let reserving: ReturnType<typeof settleRes> | undefined;
    try {
      removing = adm.api.v1.sessions[':id'].offers[':offerId'].$put({ param: { id: s1, offerId: o.id }, json: { teachers: [{ teacherId: other, mode: 'in_school' }], reason: 'race: the teacher left' } });
      await lockWaiters(1);
      reserving = settleRes(viaDesk(f.studentId, s1, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }]));
      await lockWaiters(2);
    } finally {
      await release();
    }
    expect((await removing!).status).toBe(200);
    expect(await reserving!).toMatchObject({ ok: false, e: expect.stringMatching(/The chosen teacher is not linked to/) });
  });

  it('a fee confirmed while a line is being priced on it: the confirm waits for the line and clears it — never a line left provisional', async () => {
    const sub = await subject(adm, `RWT-F-${RUN}`, `Race fee (08t ${RUN})`, { course: 1000, registration: 700 });
    const s = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `t08-fee-${RUN}`, entryDeadline: new Date(Date.now() + days(50)) } })))!.id;
    await feeFor(s, sub, 700, true);
    const o = await offerOf(s1, sub, [whole(s)]);
    const feeId = (await one<{ id: string }>(`select id from board_fee where board_series_id = $1 and key_id = $2`, [s, sub])).id;
    const f = await onboard(officer, `t08-fee-${RUN}`, 11);
    let inserted!: () => void;
    let commit!: () => void;
    const isIn = new Promise<void>((r) => { inserted = r; });
    const until = new Promise<void>((r) => { commit = r; });
    // Paused between its fee lock and its commit: a request cannot be, so this runs the services.
    const reserving = settle(reserveHeld(f.studentId, s1, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }], { inserted, until }));
    await isIn;
    const confirming = finadmin.api.v1['board-fees'][':seriesId'].confirm.$post({ param: { seriesId: s }, json: { rows: [{ feeId }], reason: 'race: published' } });
    await lockWaiters(1);
    commit();
    const r = await reserving;
    expect(r.ok).toBe(true);
    const c = await confirming;
    expect(c.status).toBe(200);
    expect((await c.json() as { data: { linesNoLongerProvisional: number } }).data.linesNoLongerProvisional).toBe(1);
    const [line] = await live(f.studentId, `offer_item_id = '${o.items[0]}'`);
    expect(await one(`select price_provisional as p, price_at_registration::float as price from registration where id = $1`, [line!.id])).toEqual({ p: false, price: 1700 });
  });

  describe('a re-price racing a checkout (flag 46): the lines are locked first', () => {
    const setUp = async (tag: string) => {
      const sub = await subject(adm, `RWT-P${tag}-${RUN}`, `Race reprice ${tag} (08t ${RUN})`, { course: 1000, registration: 600 });
      const s = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `t08-rp${tag}-${RUN}`, entryDeadline: new Date(Date.now() + days(50)) } })))!.id;
      await feeFor(s, sub, 600, false);
      const o = await offerOf(s1, sub, [whole(s)]);
      const f = await onboard(officer, `t08-rp${tag}-${RUN}`, 11);
      const [line] = await reserveAtDesk(f.studentId, s1, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }]);
      // The board's fee changes (confirmed at the new amount): the line read 600, the row now says 650.
      const feeId = (await one<{ id: string }>(`select id from board_fee where board_series_id = $1 and key_id = $2`, [s, sub])).id;
      await apiResponse(finadmin.api.v1['board-fees'][':seriesId'].confirm.$post({ param: { seriesId: s }, json: { rows: [{ feeId, amount: 650 }], reason: 'race: the board changed its fee' } }));
      const checkout = () => f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [line!.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } });
      const reprice = () => finadmin.api.v1['board-fees'][':seriesId'].reprice.$post({ param: { seriesId: s }, json: { feeIds: [feeId], reason: 'race: the board changed its fee' } });
      return { line: line!.id, checkout, reprice };
    };

    it("the checkout lands first: it pays the price it read, and the re-price lists the line and leaves it", async () => {
      const { line, checkout, reprice } = await setUp('a');
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
      expect(r.status).toBe(200);
      const body = (await r.json() as { data: { repriced: unknown[]; listed: { id: string; reason: string }[] } }).data;
      expect(body.repriced).toEqual([]);
      expect(body.listed.map((x) => [x.id, x.reason])).toEqual([[line, 'has a payment (open, failed or paid)']]);
      expect(money((await one<{ amount: string }>(`select amount from payment where id = $1`, [paymentId])).amount)).toBe(1600);
      expect(money((await one<{ p: string }>(`select price_at_registration as p from registration where id = $1`, [line])).p)).toBe(1600);
    });

    it('the re-price lands first: the checkout that read the old price is refused, nothing is charged', async () => {
      const { line, checkout, reprice } = await setUp('b');
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
      expect((await r.json() as { data: { repriced: { id: string }[] } }).data.repriced.map((x) => x.id)).toEqual([line]);
      const { PRICE_CHANGED_REFUSAL } = await import('../src/services/pricing.services');
      expect(p.status).toBeGreaterThanOrEqual(400);
      expect((await p.json() as { error: string }).error).toBe(PRICE_CHANGED_REFUSAL);
      expect(await sql(`select 1 from payment_registration where registration_id = $1`, [line])).toEqual([]);
      expect(money((await one<{ p: string }>(`select price_at_registration as p from registration where id = $1`, [line])).p)).toBe(1650);
    });
  });

  it("an item's series changed while a checkout lands on its line: the checkout first, the change is refused", async () => {
    const sub = await subject(adm, `RWT-S-${RUN}`, `Race series (08t ${RUN})`, { course: 1000, registration: 500 });
    const later = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `t08-later-${RUN}`, entryDeadline: new Date(Date.now() + days(55)) } })))!.id;
    await feeFor(series, sub);
    await feeFor(later, sub);
    const sub2 = await subject(adm, `RWT-S2-${RUN}`, `Race series 2 (08t ${RUN})`, { course: 1000, registration: 500 });
    await feeFor(series, sub2);
    const o = await offerOf(s1, sub, [whole(series)]);
    const o2 = await offerOf(s1, sub2, [whole(series)]);
    const f = await onboard(officer, `t08-series-${RUN}`, 11);
    const made = await reserveAtDesk(f.studentId, s1, [
      { offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }, { offerItemId: o2.items[0]!, attempt: 'first', mode: 'in_school', teacherId },
    ]);
    const l1 = made.find((r) => r.offerItemId === o.items[0]);
    const l2 = made.find((r) => r.offerItemId === o2.items[0]);
    // The line the change moves is the one held: the checkout (which locks both in id order) and
    // the change both queue on it, the checkout first.
    const release = await holdRowLock('registration', l1!.id);
    let pay: Promise<Res> | undefined;
    let move: Promise<Res> | undefined;
    try {
      pay = f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [l1!.id, l2!.id], paymentMethod: 'in_school', escrowAmountToApply: 0 } });
      await lockWaiters(1);
      move = adm.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({ param: { id: s1, offerId: o.id, itemId: o.items[0]! }, json: { boardSeriesId: later, reason: 'race: sat later' } });
      await lockWaiters(2);
    } finally {
      await release();
    }
    const [p, m] = await Promise.all([pay!, move!]);
    expect(p.status).toBe(201);
    expect(m.status).toBe(409);
    expect((await m.json() as { error: string }).error).toBe('1 checkout still open would pay for two deadlines after this move — confirm or cancel it first');
    expect(await one(`select board_series_id as s from registration where id = $1`, [l1!.id])).toEqual({ s: series });
  });

  it('capture and the deadline sweep on one paid preregistration at once: refunded once', async () => {
    const sub = await subject(adm, `RWT-K-${RUN}`, `Race capture (08t ${RUN})`, { course: 1000, registration: 500 });
    const d = (await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type: 'june', year: Y + 1, label: `t08c-${RUN}`, startDate: new Date(Date.now() + days(90)).toISOString(), endDate: new Date(Date.now() + days(120)).toISOString(),
        courseStartsOn: cairoDate(new Date(Date.now() + days(90))), paymentDueAt: new Date(Date.now() + days(120)).toISOString(),
      },
    })))!.id;
    const s = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `t08-cap-${RUN}`, entryDeadline: new Date(Date.now() + days(150)) } })))!.id;
    await feeFor(s, sub);
    await offerOf(d, sub, [whole(s)]);
    const f = await onboard(officer, `t08-cap-${RUN}`, 11);
    const reg = (await apiResponse(f.parent.api.v1.registrations.preregister.$post({ json: { sessionId: d, ...(await reservationOf(d, [sub])), studentId: f.studentId } })))![0]!.id;
    const p = (await apiResponse(f.parent.api.v1.payments.initiate.$post({ json: { registrationIds: [reg], paymentMethod: 'in_school', escrowAmountToApply: 0 } })))!.id!;
    await apiResponse(officer.api.v1.payments[':id'].confirm.$post({ param: { id: p }, json: { instrumentUsed: 'cash' } }));
    await sql(`update board_series set entry_deadline = now() - interval '1 minute' where id = $1`, [s]);
    await sql(`update registration_session set status = 'active', start_date = now() - interval '1 day' where id = $1`, [d]);
    const { capturePreregistrationsForSession, refundPreregistrationsAtDeadline } = await import('../src/services/prereg.services');
    const release = await holdRowLock('registration', reg);
    let capture: Promise<unknown> | undefined;
    let sweep: Promise<unknown> | undefined;
    try {
      capture = capturePreregistrationsForSession(d);
      await lockWaiters(1);
      sweep = refundPreregistrationsAtDeadline(d, s);
      await lockWaiters(2);
    } finally {
      await release();
    }
    await Promise.all([capture!, sweep!]);
    expect((await one<{ status: string }>(`select status from registration where id = $1`, [reg])).status).toBe('dropped');
    expect(Number((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'PREREG_REFUNDED_AT_DEADLINE' and entity_id = $1`, [reg])).n)).toBe(1);
    const w = await one<{ balance: string; held: string }>(`select balance, held_balance as held from escrow where student_id = $1`, [f.studentId]);
    expect([money(w.balance), money(w.held)]).toEqual([1500, 0]);
  });

  // ─── Step B (docs/features/RESERVATIONS_LINES.md §7) ──────────────────────

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

    // The lead's lock order (8 Oct): the line, then its receipt — the pair a parent's approval of a
    // drop takes (its deadline re-check under the line's lock, then the receipt-gated drop) and the
    // pair the coordinator's answer takes. Both orders forced: one waits, nothing deadlocks.
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

    it('the hold step run by two schedulers at once drops a paid unverified line once', async () => {
      const { holdUnverifiedAtDeadline } = await import('../src/services/verification.services');
      const holdSeries = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'june', year: Y + 1, label: `t08h-${RUN}`, entryDeadline: new Date(Date.now() + days(30)), retakeDeadline: new Date(Date.now() + days(35)) } })))!.id;
      const s3 = await mkSession(`t08h-${RUN}`);
      await feeFor(holdSeries, subA);
      const item = (await offerOf(s3, subA, [whole(holdSeries)])).items[0]!;
      const f = await onboard(officer, `t08-hold-${RUN}`, 11);
      const desk = await apiResponse(officer.api.v1.registrations.desk.$post({
        json: { studentId: f.studentId, sessionId: s3, lines: [{ offerItemId: item, attempt: 'retake', mode: 'in_school', teacherId, priorSitting: { month: 'november', year: Y } }], consent: CONSENT, collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } },
      }));
      const id = desk.registrations[0]!.id;
      await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'verification.unverifiedAtDeadline' }, json: { value: 'hold', reason: 'race: two schedulers' } }));
      await sql(`update board_series set entry_deadline = now() - interval '2 minutes', retake_deadline = now() - interval '30 seconds' where id = $1`, [holdSeries]);
      await sql(`update school_setting set updated_at = now() - interval '45 seconds' where key = 'verification.unverifiedAtDeadline'`);
      const release = await holdRowLock('registration', id);
      let a: Promise<{ expired: number; dropped: number }> | undefined;
      let b: Promise<{ expired: number; dropped: number }> | undefined;
      try {
        a = holdUnverifiedAtDeadline();
        b = holdUnverifiedAtDeadline();
        await lockWaiters(2);
      } finally {
        await release();
      }
      const out = await Promise.all([a!, b!]);
      expect(out.reduce((n, o) => n + o.dropped, 0)).toBe(1);
      expect((await one<{ status: string }>(`select status from registration where id = $1`, [id])).status).toBe('dropped');
      expect(Number((await one<{ n: string }>(`select count(*) as n from escrow_transaction where related_registration_id = $1 and reason = 'drop'`, [id])).n)).toBe(1);
      expect(Number((await one<{ n: string }>(`select count(*) as n from audit_log where entity_id = $1 and action = 'LINE_DROPPED_UNVERIFIED'`, [id])).n)).toBe(1);
      // No refund window on this session: today's computation gives the whole price back.
      expect(money((await one<{ s: string }>(`select sum(amount) as s from escrow_transaction where related_registration_id = $1 and reason = 'drop'`, [id])).s)).toBe(1500);
      await apiResponse(adm.api.v1.settings[':key'].$put({ param: { key: 'verification.unverifiedAtDeadline' }, json: { value: 'enter_as_declared', reason: 'race done' } }));
    });
  });
});
