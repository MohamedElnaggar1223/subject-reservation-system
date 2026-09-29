import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf, seriesYearInAcademicYear } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, one, sql, futureWindow, lockWaiters, holdRowLock, feedSeries, type Client,
} from './helpers';

/**
 * F0b — races (FEATURES_PLAN.md §5: anything two people can act on at once
 * has a race test). The dangerous order is forced, not hoped for.
 *
 * - A registration racing a change to its window's series: the registration
 *   holds the window FOR SHARE and its series links FOR SHARE while it is
 *   entered, and a change to the window's series takes the window FOR
 *   UPDATE — so the registration is entered by the old routing and the change
 *   then sees it, never a registration in a series the window no longer feeds.
 * - A window's end and its series' deadline changed at the same moment: the
 *   window always closes before the deadline (MO-10), whichever lands first.
 * - Two coordinators set an award's units at once: the award ends with one
 *   of the two sets, never a mix.
 * (Enrolment races are in 08j.)
 *
 * Sessions: november/igcse drafts, opened per student by a deadline extension.
 */

const days = (n: number) => n * 86_400_000;
type Res = { status: number; json(): Promise<unknown> };

/** An uncommitted registration from the test's own connection: the app's insert of the same key queues behind it. */
async function holdInsert(studentId: string, sessionId: string, subjectId: string): Promise<() => Promise<void>> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  await client.query(
    `insert into registration (id, student_id, session_id, subject_id, price_at_registration, status, requested_by)
     values (gen_random_uuid()::text, $1, $2, $3, 0, 'pending_payment', $1)`,
    [studentId, sessionId, subjectId],
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

  it("a registration racing a change to its window's series is entered by the old routing; the change then sees it", async () => {
    const w = await session(adm, 'November (IGCSE, F0b races)', 'november', 'igcse', { ...futureWindow(), seriesYear: seriesYearInAcademicYear('november', Y) });
    const a = await feedSeries(adm, w, { label: 'F0b races A' });
    const b = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', month: 'november', year: seriesYearInAcademicYear('november', Y), label: 'F0b races B' } }))).id;
    const f = await onboard(officer, 'f0br-route', 11);
    await apiResponse(finadmin.api.v1.exceptions.$post({
      json: { type: 'deadline_extension', studentId: f.studentId, sessionId: w, reason: 'open the draft for this race', validUntil: new Date(Date.now() + days(10)).toISOString() },
    }));

    const release = await holdInsert(f.studentId, w, subj[0]!);
    let registering: Promise<Res> | undefined;
    let changing: Promise<Res> | undefined;
    try {
      registering = f.parent.api.v1.registrations.direct.$post({ json: { sessionId: w, subjectIds: [subj[0]!], studentId: f.studentId } });
      await lockWaiters(1);
      // The admin swaps the window over to series B, dropping A.
      changing = adm.api.v1.sessions[':id']['board-series'].$put({ param: { id: w }, json: { series: [{ boardSeriesId: b, isDefault: true }], routes: [] } });
      await Promise.race([changing, lockWaiters(2)]);
    } finally {
      await release();
    }
    const [reg, chg] = await Promise.all([registering!, changing!]);
    expect(reg.status).toBe(201);
    const [created] = (await reg.json() as { data: { id: string }[] }).data;
    // Entered in A, which the window still feeds: the change waited, then saw it.
    expect((await one<{ s: string }>(`select board_series_id as s from registration where id = $1`, [created!.id])).s).toBe(a);
    expect(chg.status).toBe(409);
    expect((await chg.json() as { error: string }).error).toMatch(/has 1 registration in this window — move them to another series first/);
    expect(await sql(`select board_series_id from session_board_series where session_id = $1`, [w])).toEqual([{ board_series_id: a }]);
  });

  describe("a window's end and its series' deadline changed at the same moment: the window always closes before the deadline (MO-10)", () => {
    const setUp = async (label: string) => {
      const w = await session(adm, `November (IGCSE, F0b races, ${label})`, 'november', 'igcse', { ...futureWindow(), seriesYear: seriesYearInAcademicYear('november', Y) });
      const end = new Date((await one<{ end: string }>(`select end_date as end from registration_session where id = $1`, [w])).end);
      const s = await feedSeries(adm, w, { label: `F0b races ${label}`, entryDeadline: new Date(end.getTime() + days(10)) });
      return { w, s, end };
    };
    const extendWindow = (w: string, endDate: Date) =>
      // @ts-expect-error — the route reads its body by session status, without zValidator (as the web does)
      adm.api.v1.sessions[':id'].$put({ param: { id: w }, json: { endDate, reason: 'race: extend the window' } });
    const moveDeadline = (s: string, entryDeadline: Date) =>
      adm.api.v1['board-series'][':id'].$put({ param: { id: s }, json: { entryDeadline, reason: 'race: the board moved it earlier' } });
    const holds = async (w: string, s: string) => {
      const [r] = await sql<{ ok: boolean }>(`select w.end_date < b.entry_deadline as ok from registration_session w, board_series b where w.id = $1 and b.id = $2`, [w, s]);
      return r!.ok;
    };

    it('the window first: it is extended, and the earlier deadline is refused', async () => {
      const { w, s, end } = await setUp('window first');
      const release = await holdRowLock('registration_session', w);
      let first: Promise<Res> | undefined;
      let second: Promise<Res> | undefined;
      try {
        first = extendWindow(w, new Date(end.getTime() + days(5)));
        await lockWaiters(1);
        second = moveDeadline(s, new Date(end.getTime() + days(3)));
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [ext, dl] = await Promise.all([first!, second!]);
      expect(ext.status).toBe(200);
      expect(dl.status).toBe(400);
      expect((await dl.json() as { error: string }).error).toBe("The board's entry deadline must be after the registration window closes");
      expect(await holds(w, s)).toBe(true);
    });

    it('the deadline first, a draft window: it moves, and the window that would pass it is refused under its lock', async () => {
      const { w, s, end } = await setUp('deadline first');
      const release = await holdRowLock('registration_session', w);
      let first: Promise<Res> | undefined;
      let second: Promise<Res> | undefined;
      try {
        first = moveDeadline(s, new Date(end.getTime() + days(3)));
        await lockWaiters(1);
        // The window's route checked the old deadline before queueing; the
        // draft update (F0a: under the window's row lock) reads the new one.
        second = extendWindow(w, new Date(end.getTime() + days(5)));
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [dl, ext] = await Promise.all([first!, second!]);
      expect(dl.status).toBe(200);
      expect(ext.status).toBe(400);
      expect((await ext.json() as { error: string }).error).toMatch(/^The window cannot close on or after the exam board's entry deadline \(.+\) — move the board deadline first$/);
      expect(await holds(w, s)).toBe(true);
    });

    it('the deadline first, an open window: it moves, and the extension that would pass it is refused by the database', async () => {
      // An open window's extension takes no lock of its own before its UPDATE:
      // the database's trigger is what reads the moved deadline. A (type,
      // level) pair no earlier file holds open is used, and closed after.
      const openPairs = new Set((await sql<{ t: string; l: string }>(`select session_type as t, qualification_level as l from registration_session where status = 'active'`)).map((r) => `${r.t}|${r.l}`));
      const pair = (['october|a_level', 'october|as_level', 'november|a_level', 'november|as_level', 'january|a_level', 'january|as_level'] as const).find((p) => !openPairs.has(p));
      expect(pair).toBeDefined();
      const [type, level] = pair!.split('|') as ['october' | 'november' | 'january', 'a_level' | 'as_level'];
      const now = Date.now();
      const w = await session(adm, `Open window (F0b races, deadline first)`, type, level, {
        startDate: new Date(now - days(1)).toISOString(), endDate: new Date(now + days(10)).toISOString(), seriesYear: seriesYearInAcademicYear(type, Y),
      });
      const end = new Date((await one<{ end: string }>(`select end_date as end from registration_session where id = $1`, [w])).end);
      expect((await one<{ status: string }>(`select status from registration_session where id = $1`, [w])).status).toBe('active');
      const s = await feedSeries(adm, w, { label: 'F0b races open', entryDeadline: new Date(end.getTime() + days(10)) });
      const release = await holdRowLock('registration_session', w);
      let first: Promise<Res> | undefined;
      let second: Promise<Res> | undefined;
      try {
        first = moveDeadline(s, new Date(end.getTime() + days(3)));
        await lockWaiters(1);
        second = extendWindow(w, new Date(end.getTime() + days(5)));
        await lockWaiters(2);
      } finally {
        await release();
      }
      const [dl, ext] = await Promise.all([first!, second!]);
      expect(dl.status).toBe(200);
      expect(ext.status).toBe(409);
      expect((await ext.json() as { error: string }).error).toBe("A window must close before the exam board's entry deadline of every series it feeds — the window or the deadline changed at the same moment; reload and try again");
      expect(await holds(w, s)).toBe(true);
      await apiResponse(adm.api.v1.sessions[':id'].close.$post({ param: { id: w }, json: { reason: 'race test done: free the pair' } }));
    });
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
