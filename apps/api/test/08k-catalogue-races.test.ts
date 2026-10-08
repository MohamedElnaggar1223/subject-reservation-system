import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf, seriesYearInAcademicYear } from '@repo/validations';
import { admin, staff, onboard, subject, session, one, sql, futureWindow, lockWaiters, holdRowLock, feedSeries, audited, wholeItemSql, seriesOfSession, type Client, reservationOf } from './helpers';

/**
 * F0b — races (FEATURES_PLAN.md §5: anything two people can act on at once
 * has a race test). The dangerous order is forced, not hoped for.
 *
 * - A line racing a change to its item's series (the reservations rework: a session's series are
 *   its items'): the line holds its offer and item FOR SHARE while it is entered, and the change
 *   takes them FOR UPDATE — so the line is entered by the old routing and the change then
 *   carries it with the item, its student locked first (the change runs again when a student
 *   appeared while it waited: lib/student-locks.ts). Never a line in a series its item is not in.
 * - A reservation and its series' deadline moved at the same moment: the line's due date is
 *   capped by its deadline, whichever lands first (MO-10 per line; RESERVATIONS_REWORK.md §3.3).
 * - A registration racing its subject's board change is entered with the new board.
 * - Two coordinators set an award's units at once: the award ends with one
 *   of the two sets, never a mix.
 * (Enrolment races are in 08j; the rework's own races in 08t.)
 *
 * Sessions: winter/igcse drafts, opened per student by a deadline extension.
 */

const days = (n: number) => n * 86_400_000;
type Res = { status: number; json(): Promise<unknown> };

/** An uncommitted line from the test's own connection: the app's insert of the same key queues behind it. */
async function holdInsert(studentId: string, sessionId: string, subjectId: string): Promise<() => Promise<void>> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  await client.query(
    `insert into registration (id, student_id, session_id, subject_id, price_at_registration, status, requested_by, offer_item_id, due_at)
     values (gen_random_uuid()::text, $1, $2, $3, 0, 'pending_payment', $1, ${wholeItemSql('$4', '$5')}, now() + interval '30 days')`,
    [studentId, sessionId, subjectId, sessionId, subjectId],
  );
  return async () => {
    await client.query('ROLLBACK');
    await client.end();
  };
}

describe('F0b: races', () => {
  let adm: Client, officer: Client, finadmin: Client, coordinator: Client, coordinator2: Client;
  const Y = academicYearStartOf();
  const subj: string[] = [];

  beforeAll(async () => {
    adm = await admin('f0br');
    officer = await staff(adm, 'finance_officer', 'f0br');
    finadmin = await staff(adm, 'finance_admin', 'f0br');
    coordinator = await staff(adm, 'coordinator', 'f0br');
    coordinator2 = await staff(adm, 'coordinator', 'f0br2');
    for (const [i, name] of ['History', 'Geography'].entries()) {
      subj.push(await subject(adm, `F0BR-${i + 1}`, `${name} (F0b races)`, { course: 1000, registration: 200 }, { council: 'pearson_edexcel' }));
    }
  });

  it("a line racing a change to its item's series is entered by the old routing; the change then carries it, its student locked first", async () => {
    const w = await session(adm, 'November (IGCSE, F0b races)', 'november', 'igcse', { ...futureWindow(), seriesYear: seriesYearInAcademicYear('november', Y) });
    const year = seriesYearInAcademicYear('november', Y);
    const a = await feedSeries(adm, w, { label: 'F0b races A' });
    const b = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', month: 'november', year, label: 'F0b races B', examsStart: `${year + 1}-12-31` } }))).id;
    const item = await one<{ id: string; offer_id: string }>(
      `select i.id, i.offer_id from session_offer_item i join session_offer o on o.id = i.offer_id where i.session_id = $1 and o.subject_id = $2 and i.board_series_id = $3`, [w, subj[0]!, a]);
    const f = await onboard(officer, 'f0br-route', 11);
    await apiResponse(finadmin.api.v1.exceptions.$post({
      json: { type: 'deadline_extension', studentId: f.studentId, sessionId: w, reason: 'open the draft for this race', validUntil: new Date(Date.now() + days(10)).toISOString() },
    }));

    const release = await holdInsert(f.studentId, w, subj[0]!);
    let registering: Promise<Res> | undefined;
    let changing: Promise<Res> | undefined;
    try {
      registering = f.parent.api.v1.registrations.direct.$post({ json: { sessionId: w, ...(await reservationOf(w, [subj[0]!])), studentId: f.studentId } });
      await lockWaiters(1);
      // The admin moves the subject's item to series B (its lines go with it).
      changing = adm.api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({
        param: { id: w, offerId: item.offer_id, itemId: item.id }, json: { boardSeriesId: b, reason: 'race: the board moved the subject' },
      });
      await Promise.race([changing, lockWaiters(2)]);
    } finally {
      await release();
    }
    const [reg, chg] = await Promise.all([registering!, changing!]);
    expect(reg.status).toBe(201);
    const [created] = (await reg.json() as { data: { id: string }[] }).data;
    // The change waited for the line, saw it, and carried it with the item (run again with the
    // line's student locked first): the line is in B, where its item is, and the move is audited.
    expect(chg.status).toBe(200);
    expect((await chg.json() as { data: { linesMoved: number } }).data.linesMoved).toBe(1);
    expect(await sql(`select r.board_series_id as s, i.board_series_id as item from registration r join session_offer_item i on i.id = r.offer_item_id where r.id = $1`, [created!.id]))
      .toEqual([{ s: b, item: b }]);
    await audited([created!.id], ['LINE_SERIES_MOVED']);
    // The session's series are its items': A still holds the other subject, B this one.
    expect((await sql<{ id: string }>(`select board_series_id as id from session_board_series where session_id = $1 order by board_series_id`, [w])).map((r) => r.id))
      .toEqual([a, b].sort());
  });

  // Changed by the reservations rework (RESERVATIONS_REWORK.md §3.3; pre-authorised: 08k's
  // window-end-vs-deadline scenarios; trail row "assertion"). F0b raced a window's end against its
  // series' deadline, because a window had to close before the deadline of every series it fed.
  // The cut-off is per item now and a deadline may fall before the session's end, so that rule and
  // its three races are gone; what must hold, whichever lands first, is that a line is never due
  // after its own deadline (and is never entered past it: 08n).
  describe("a reservation and its series' deadline moved at the same moment: the line is never due after its deadline (MO-10, per line)", () => {
    const setUp = async (label: string) => {
      const w = await session(adm, `November (IGCSE, F0b races, ${label})`, 'november', 'igcse', { ...futureWindow(), seriesYear: seriesYearInAcademicYear('november', Y) });
      const end = new Date((await one<{ end: string }>(`select end_date as end from registration_session where id = $1`, [w])).end);
      const s = await feedSeries(adm, w, { label: `F0b races ${label}`, entryDeadline: new Date(end.getTime() + days(10)) });
      return { w, s, end };
    };
    const moveDeadline = (s: string, entryDeadline: Date) =>
      adm.api.v1['board-series'][':id'].$put({ param: { id: s }, json: { entryDeadline, reason: 'race: the board moved it earlier' } });
    const prereg = async (f: { parent: Client; studentId: string }, w: string) =>
      f.parent.api.v1.registrations.preregister.$post({ json: { sessionId: w, ...(await reservationOf(w, [subj[1]!])), studentId: f.studentId } });
    const dueOf = async (id: string) => new Date((await one<{ due: string }>(`select due_at as due from registration where id = $1`, [id])).due).getTime();

    it('the reservation first: it is entered, then the earlier deadline re-dates it, audited', async () => {
      const { w, s, end } = await setUp('line first');
      const f = await onboard(officer, 'f0br-line-first', 11);
      const earlier = new Date(end.getTime() - days(5));
      const release = await holdInsert(f.studentId, w, subj[1]!);
      let first: Promise<Res> | undefined;
      let second: Promise<Res> | undefined;
      try {
        first = prereg(f, w);
        await lockWaiters(1);
        // The line holds its series FOR SHARE while it waits: the deadline's writer queues behind it.
        second = moveDeadline(s, earlier);
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [reg, dl] = await Promise.all([first!, second!]);
      expect(reg.status).toBe(201);
      expect(dl.status).toBe(200);
      const [line] = (await reg.json() as { data: { id: string }[] }).data;
      // Reserved due at the session's payment date (its deadline was later); the deadline moved
      // before it, so its due date followed, audited with why.
      expect(await dueOf(line!.id)).toBe(earlier.getTime());
      expect(await one<{ reason: string }>(`select new_data->>'reason' as reason from audit_log where action = 'LINE_DUE_MOVED' and entity_id = $1`, [line!.id]))
        .toEqual({ reason: "the series' dates changed" });
    });

    it('the deadline first: the reservation waits for it and is due by the new deadline', async () => {
      const { w, s, end } = await setUp('deadline first');
      const f = await onboard(officer, 'f0br-deadline-first', 11);
      const earlier = new Date(end.getTime() - days(5));
      const release = await holdRowLock('board_series', s);
      let first: Promise<Res> | undefined;
      let second: Promise<Res> | undefined;
      try {
        first = moveDeadline(s, earlier);
        await lockWaiters(1);
        second = prereg(f, w);
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [dl, reg] = await Promise.all([first!, second!]);
      expect(dl.status).toBe(200);
      expect(reg.status).toBe(201);
      const [line] = (await reg.json() as { data: { id: string }[] }).data;
      expect(await dueOf(line!.id)).toBe(earlier.getTime());
      expect(await sql(`select 1 from audit_log where action = 'LINE_DUE_MOVED' and entity_id = $1`, [line!.id])).toEqual([]);
    });
  });

  it('a registration racing its subject\'s board change is entered with the new board (review flag 4)', async () => {
    const sub = await subject(adm, 'F0BR-BRD', 'Board race (F0b races)', { course: 1000, registration: 200 });
    const w = await session(adm, 'November (IGCSE, F0b races, board)', 'november', 'igcse', futureWindow());
    // The session's Cambridge item of the subject, and its Pearson series (the file's Pearson
    // subjects' items are in it): the board change carries the item there.
    const cam = await seriesOfSession(w, 'cambridge');
    const pea = await seriesOfSession(w, 'pearson_edexcel');
    expect(cam).not.toBe(pea);
    const prereg = async (f: { parent: Client; studentId: string }) =>
      f.parent.api.v1.registrations.preregister.$post({ json: { sessionId: w, ...(await reservationOf(w, [sub])), studentId: f.studentId } });
    const a = await onboard(officer, 'f0br-board-a', 11);
    const b = await onboard(officer, 'f0br-board-b', 11);
    const aReg = ((await apiResponse(prereg(a))) as { id: string }[])[0]!.id;

    // The board change holds the subject and queues behind A's row; B registers meanwhile.
    const release = await holdRowLock('registration', aReg);
    let change: Promise<Res> | undefined;
    let registering: Promise<Res> | undefined;
    try {
      change = adm.api.v1.subjects[':id'].$put({ param: { id: sub }, json: { council: 'pearson_edexcel' } });
      await lockWaiters(1);
      registering = prereg(b);
      await Promise.race([registering, lockWaiters(2)]);
    } finally {
      await release();
    }
    const [chg, reg] = await Promise.all([change!, registering!]);
    expect(chg.status).toBe(200);
    expect(reg.status).toBe(201);
    const bReg = ((await reg.json()) as { data: { id: string }[] }).data[0]!.id;
    // Both entered with Pearson: B waited for the change and was routed by the new board.
    expect(await sql(`select id, board_series_id from registration where id in ($1, $2) order by id`, [aReg, bReg]))
      .toEqual([aReg, bReg].sort().map((id) => ({ id, board_series_id: pea })));
    // The reservations rework: both read Pearson's grid now — the fee the change carried into
    // Pearson's series (the old board's amount, provisional until finance confirms it). A, unpaid,
    // was re-priced from it when it moved (the review of 977848d, flag 2); B was priced from it.
    expect(await sql(`select id, price_at_registration::float as price, price_provisional as provisional from registration where id in ($1, $2) order by id`, [aReg, bReg]))
      .toEqual([{ id: aReg, price: 1200, provisional: true }, { id: bReg, price: 1200, provisional: true }].sort((x, y) => x.id.localeCompare(y.id)));
  });

  it("two coordinators set an award's units at the same moment: it ends with one of the two sets, never a mix", async () => {
    const q = await apiResponse(coordinator.api.v1.catalogue.qualifications.$post({
      json: { boardCode: 'oxford', code: 'RACE1', title: 'Race (AS)', level: 'as_level', suite: 'OxfordAQA International AS', subjectArea: 'Race', entryMethod: 'qualification' },
    }));
    const unit = async (code: string) => (await apiResponse(coordinator.api.v1.catalogue.units.$post({ json: { boardCode: 'oxford', code, title: code, unitLevel: 'as', kind: 'unit' } }))).id;
    const [u1, u2, u3, u4] = [await unit('RU1'), await unit('RU2'), await unit('RU3'), await unit('RU4')];
    const setA = [u1!, u2!].map((unitId) => ({ unitId, requirement: 'required' as const }));
    const setB = [u3!, u4!].map((unitId) => ({ unitId, requirement: 'required' as const }));
    const release = await holdRowLock('qualification', q.id);
    let one1: Promise<Res> | undefined;
    let two: Promise<Res> | undefined;
    try {
      one1 = coordinator.api.v1.catalogue.qualifications[':id'].units.$put({ param: { id: q.id }, json: { units: setA } });
      await lockWaiters(1);
      two = coordinator2.api.v1.catalogue.qualifications[':id'].units.$put({ param: { id: q.id }, json: { units: setB } });
      await lockWaiters(2);
    } finally {
      await release();
    }
    const [r1, r2] = await Promise.all([one1!, two!]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const units = (await sql<{ unit_id: string }>(`select unit_id from qualification_unit where qualification_id = $1 order by unit_id`, [q.id])).map((r) => r.unit_id);
    expect([[u1, u2].sort(), [u3, u4].sort()]).toContainEqual(units);
    expect(Number((await one<{ n: string }>(`select count(*) as n from audit_log where entity_id = $1 and action = 'QUALIFICATION_UNITS_SET'`, [q.id])).n)).toBe(2);
  });
});
