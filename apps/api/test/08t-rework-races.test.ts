import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf, type LineInputType } from '@repo/validations';
import { admin, staff, onboard, subject, one, sql, money, lockWaiters, holdRowLock, session, openWindow, runPaymentDeadlines, type Client } from './helpers';

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
 */

const days = (n: number) => n * 86_400_000;
const RUN = Math.random().toString(36).slice(2, 6);
const Y = academicYearStartOf();
const cairoDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
type Res = { status: number; json(): Promise<unknown> };
type Line = Pick<LineInputType, 'offerItemId' | 'attempt' | 'mode'> & Partial<LineInputType>;

async function reserve(studentId: string, sessionId: string, lines: Line[], hold?: { inserted: () => void; until: Promise<void> }) {
  const { db } = await import('@repo/db');
  const { insertLines } = await import('../src/services/line.services');
  const { assertMayRegisterForInTx } = await import('../src/services/eligibility.services');
  return db.transaction(async (tx) => {
    const eligibility = await assertMayRegisterForInTx(tx, studentId, sessionId);
    const made = await insertLines(tx, { studentId, sessionId, lines: lines as LineInputType[], status: 'pending_payment', requestedBy: studentId, eligibility });
    if (hold) {
      hold.inserted();
      await hold.until;
    }
    return made;
  });
}
const settle = async <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e: e instanceof Error ? e.message : String(e) }));
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
      one1 = officer.api.v1.registrations.desk.$post({ json: { studentId: f.studentId, sessionId: s1, subjectIds: [subA] } });
      two = officer2.api.v1.registrations.desk.$post({ json: { studentId: f.studentId, sessionId: s1, subjectIds: [subA] } });
      await lockWaiters(2);
    } finally {
      await release();
    }
    const statuses = (await Promise.all([one1!, two!])).map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);
    expect(await live(f.studentId)).toHaveLength(1);
  });

  it('the same entry in one series from two sessions at once: the student lock serialises them and the second is refused', async () => {
    const f = await onboard(officer, `t08-once-${RUN}`, 11);
    const release = await holdRowLock('"user"', f.studentId);
    let a: ReturnType<typeof settle<unknown>> | undefined;
    let b: ReturnType<typeof settle<unknown>> | undefined;
    try {
      a = settle(reserve(f.studentId, s1, [{ offerItemId: itemA1, attempt: 'first', mode: 'in_school', teacherId }]));
      b = settle(reserve(f.studentId, s2, [{ offerItemId: itemA2, attempt: 'first', mode: 'in_school', teacherId }]));
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
    let a: ReturnType<typeof settle<unknown>> | undefined;
    let b: ReturnType<typeof settle<unknown>> | undefined;
    try {
      a = settle(reserve(f.studentId, s1, [{ offerItemId: groupAs, attempt: 'first', mode: 'in_school', teacherId }]));
      b = settle(reserve(f.studentId, s1, [{ offerItemId: groupAl, attempt: 'first', mode: 'in_school', teacherId }]));
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
    // The line first: it holds the item FOR SHARE while it commits; the close then applies, the line stands.
    const f = await onboard(officer, `t08-close-a-${RUN}`, 11);
    let inserted!: () => void;
    let commit!: () => void;
    const isIn = new Promise<void>((r) => { inserted = r; });
    const until = new Promise<void>((r) => { commit = r; });
    const reserving = settle(reserve(f.studentId, s1, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }], { inserted, until }));
    await isIn;
    const closing = close();
    await lockWaiters(1);
    commit();
    expect((await reserving).ok).toBe(true);
    expect((await closing).status).toBe(200);
    expect(await live(f.studentId)).toHaveLength(1);
    // The close first: the line waits for it, then is refused.
    await reopen();
    const g = await onboard(officer, `t08-close-b-${RUN}`, 11);
    const release = await holdRowLock('session_offer_item', o.items[0]!);
    let closing2: Promise<Res> | undefined;
    let reserving2: ReturnType<typeof settle<unknown>> | undefined;
    try {
      closing2 = close();
      await lockWaiters(1);
      reserving2 = settle(reserve(g.studentId, s1, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }]));
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
    let reserving: ReturnType<typeof settle<unknown>> | undefined;
    try {
      removing = adm.api.v1.sessions[':id'].offers[':offerId'].$put({ param: { id: s1, offerId: o.id }, json: { teachers: [{ teacherId: other, mode: 'in_school' }], reason: 'race: the teacher left' } });
      await lockWaiters(1);
      reserving = settle(reserve(f.studentId, s1, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }]));
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
    const reserving = settle(reserve(f.studentId, s1, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }], { inserted, until }));
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
      const [line] = await reserve(f.studentId, s1, [{ offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }]);
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
    const [l1, l2] = await reserve(f.studentId, s1, [
      { offerItemId: o.items[0]!, attempt: 'first', mode: 'in_school', teacherId }, { offerItemId: o2.items[0]!, attempt: 'first', mode: 'in_school', teacherId },
    ]);
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
    const reg = (await apiResponse(f.parent.api.v1.registrations.preregister.$post({ json: { sessionId: d, subjectIds: [sub], studentId: f.studentId } })))![0]!.id;
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
  const desk = (studentId: string, sessionId: string, subjectIds: string[], extra: Record<string, unknown> = {}) =>
    officer.api.v1.registrations.desk.$post({ json: { studentId, sessionId, subjectIds, ...extra } });
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
    const reserving = settle(reserve(f.studentId, s, [{ offerItemId: item, attempt: 'first', mode: 'in_school', teacherId }], { inserted, until }));
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
    const selfStudy = (studentId: string) => desk(studentId, s, [subj.M2!], { subjectOptions: { [subj.M2!]: { takeOutsideSchool: true } } });
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
