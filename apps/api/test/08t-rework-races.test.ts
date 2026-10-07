import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf, type LineInputType } from '@repo/validations';
import { admin, staff, onboard, subject, one, sql, money, lockWaiters, holdRowLock, type Client, reservationOf } from './helpers';

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
      one1 = officer.api.v1.registrations.desk.$post({ json: { studentId: f.studentId, sessionId: s1, ...(await reservationOf(s1, [subA])) } });
      two = officer2.api.v1.registrations.desk.$post({ json: { studentId: f.studentId, sessionId: s1, ...(await reservationOf(s1, [subA])) } });
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
});
