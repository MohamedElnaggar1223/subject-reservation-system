import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearStartOf, seriesYearInAcademicYear } from '@repo/validations';
import {
  admin, staff, onboard, subject, session, one, sql, futureWindow, localToday, lockWaiters,
  type Client,
} from './helpers';

/**
 * F0a — races (FEATURES_PLAN.md §5: anything two people can act on at once
 * has a race test).
 *
 * Eligibility is a read-then-write guard: a path reads "may this student sit
 * this series?" and then inserts a registration. A withdrawal, a series
 * correction, a revoked grade-10 exception or A-12 turned off landing in
 * between would leave a registration waiting for a student who may no
 * longer sit the series — its clean-up ran before the row existed. Each
 * creating transaction therefore asks again with the rows the answer rests
 * on held FOR SHARE (assertMayRegisterForInTx), and each change takes the
 * same rows FOR UPDATE before its clean-up.
 *
 * The dangerous order is forced, not hoped for: a connection of the test's
 * own holds an uncommitted registration with the same student, window and
 * subject, so the app's insert queues on the unique index after its checks;
 * the change is fired while it waits; then the test's row is rolled back.
 * Whatever the order, the student is never left with a waiting
 * registration for a series they may not sit.
 *
 * Plus the plain two-at-once races: a student withdrawn twice, A-12 turned
 * off twice, one student placed in two sections, the roll-over run twice.
 *
 * Sessions: november/igcse drafts opened per student by a deadline extension.
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

const waitingFor = (studentId: string, sessionId: string) =>
  sql<{ id: string; status: string }>(
    `select id, status from registration where student_id = $1 and session_id = $2 and status in ('pending_approval', 'pending_payment')`,
    [studentId, sessionId],
  );
const expiryOf = (registrationId: string) =>
  one<{ reason: string; detail: string }>(
    `select new_data->>'reason' as reason, new_data->>'detail' as detail from audit_log
     where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [registrationId]);

describe('F0a: races', () => {
  let adm: Client, officer: Client, finadmin: Client, coordinator: Client, coordinator2: Client;
  type Family = { parent: Client; student: Client; studentId: string };
  const family = (tag: string, grade: 10 | 11 | 12 = 11): Promise<Family> => onboard(officer, `f0r-${tag}`, grade);
  const thisYear = academicYearStartOf();
  const subj: string[] = [];
  let nov: string;

  const extend = (studentId: string, sessionId: string) =>
    apiResponse(finadmin.api.v1.exceptions.$post({
      json: { type: 'deadline_extension', studentId, sessionId, reason: 'open the draft for this race', validUntil: new Date(Date.now() + days(10)).toISOString() },
    }));

  /**
   * The parent's direct registration of `subjectId`, queued behind the
   * test's uncommitted row after its checks; `change` fired while it waits;
   * then the row released. Returns both responses.
   */
  async function race(f: Family, sessionId: string, subjectId: string, change: () => Promise<Res>) {
    const release = await holdInsert(f.studentId, sessionId, subjectId);
    let registering: Promise<Res> | undefined;
    let changing: Promise<Res> | undefined;
    try {
      registering = f.parent.api.v1.registrations.direct.$post({ json: { sessionId, subjectIds: [subjectId], studentId: f.studentId } });
      await lockWaiters(1);
      changing = change();
      // The change either queues behind the registration (the fix) or runs
      // straight through (without it); both are the order under test.
      await Promise.race([changing, lockWaiters(2)]);
    } finally {
      await release();
    }
    const [reg, chg] = await Promise.all([registering!, changing!]);
    return { reg, chg };
  }

  afterAll(async () => {
    await sql(`delete from school_setting where key = 'eligibility.graduateRetakes'`);
  });

  beforeAll(async () => {
    adm = await admin('f0r');
    officer = await staff(adm, 'finance_officer', 'f0r');
    finadmin = await staff(adm, 'finance_admin', 'f0r');
    coordinator = await staff(adm, 'coordinator', 'f0r');
    coordinator2 = await staff(adm, 'coordinator', 'f0r2');
    for (const [i, name] of ['History', 'Geography', 'Economics', 'Sociology', 'Psychology', 'Accounting'].entries()) {
      subj.push(await subject(adm, `F0R-${i + 1}`, `${name} (F0a races)`, { course: 1000, registration: 200 }));
    }
    nov = await session(adm, 'November (IGCSE, F0a races)', 'november', 'igcse', { ...futureWindow(), seriesYear: seriesYearInAcademicYear('november', thisYear) });
  });

  // ─── A registration racing an eligibility change ───────────────────────────

  describe('a registration racing an eligibility change is never left waiting', () => {
    it('a withdrawal: the registration commits first, then the withdrawal expires it', async () => {
      const f = await family('withdraw');
      await extend(f.studentId, nov);
      const { reg, chg } = await race(f, nov, subj[0]!, () =>
        coordinator.api.v1.students[':id'].leave.$post({ param: { id: f.studentId }, json: { kind: 'withdrawn', leftOn: localToday(), reason: 'race check' } }));
      expect(reg.status).toBe(201);
      expect(chg.status).toBe(200);
      const [created] = (await reg.json() as { data: { id: string }[] }).data;
      expect(await waitingFor(f.studentId, nov)).toEqual([]);
      expect(await expiryOf(created!.id)).toEqual({ reason: 'ineligible', detail: 'withdrawn' });
      expect(await chg.json()).toMatchObject({ data: { registrationsExpired: 1 } });
    });

    it("a window's series corrected: the registration commits first, then the correction expires it", async () => {
      const f = await family('series');
      const own = await session(adm, 'November (IGCSE, F0a races, series)', 'november', 'igcse', { ...futureWindow(), seriesYear: seriesYearInAcademicYear('november', thisYear) });
      await extend(f.studentId, own);
      // Corrected to the November a year earlier: grade 10 then, and grade 10 sits June only.
      const { reg, chg } = await race(f, own, subj[1]!, () =>
        adm.api.v1.sessions[':id'].series.$put({ param: { id: own }, json: { sessionType: 'november', seriesYear: seriesYearInAcademicYear('november', thisYear - 1), reason: 'race check' } }));
      expect(reg.status).toBe(201);
      expect(chg.status).toBe(200);
      const [created] = (await reg.json() as { data: { id: string }[] }).data;
      expect(await waitingFor(f.studentId, own)).toEqual([]);
      expect(await expiryOf(created!.id)).toEqual({ reason: 'ineligible', detail: 'series_corrected' });
    });

    it('a grade-10 exception revoked: the registration it allowed commits first, then the revocation expires it', async () => {
      const f = await family('exception', 10);
      await extend(f.studentId, nov);
      const granted = await apiResponse(coordinator.api.v1.exceptions.$post({
        json: { type: 'grade10_other_series', studentId: f.studentId, sessionId: nov, reason: 'ready early for November' },
      }));
      const { reg, chg } = await race(f, nov, subj[2]!, () =>
        coordinator.api.v1.exceptions[':id'].revoke.$post({ param: { id: granted.id } }));
      expect(reg.status).toBe(201);
      expect(chg.status).toBe(200);
      const [created] = (await reg.json() as { data: { id: string }[] }).data;
      expect(await waitingFor(f.studentId, nov)).toEqual([]);
      expect(await expiryOf(created!.id)).toEqual({ reason: 'ineligible', detail: 'exception_revoked' });
    });

    it("A-12 turned off: a graduate's registration commits first, then the change expires it", async () => {
      const f = await family('graduate', 12);
      // Finished grade 12 last year: a retake in this November is A-12's.
      await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: f.studentId }, json: { cohortYear: thisYear - 3, reason: 'graduated last June' } }));
      await extend(f.studentId, nov);
      expect((await apiResponse(adm.api.v1.registrations.eligibility.$get({ query: { studentId: f.studentId, sessionId: nov } })))).toMatchObject({ allowed: true, graduateRetake: true });
      try {
        const { reg, chg } = await race(f, nov, subj[3]!, () =>
          adm.api.v1.settings[':key'].$put({ param: { key: 'eligibility.graduateRetakes' }, json: { value: false, reason: 'race check' } }));
        expect(reg.status).toBe(201);
        expect(chg.status).toBe(200);
        const [created] = (await reg.json() as { data: { id: string }[] }).data;
        expect(await waitingFor(f.studentId, nov)).toEqual([]);
        expect(await expiryOf(created!.id)).toEqual({ reason: 'ineligible', detail: 'graduate_retakes_off' });
      } finally {
        await sql(`delete from school_setting where key = 'eligibility.graduateRetakes'`);
      }
    });
  });

  // ─── Two people at once ────────────────────────────────────────────────────

  describe('two people at once', () => {
    it('two coordinators withdraw the same student at once: one leaving recorded, one refused, one audit row', async () => {
      const f = await family('twice');
      const results = await Promise.all([coordinator, coordinator2].map((c) =>
        c.api.v1.students[':id'].leave.$post({ param: { id: f.studentId }, json: { kind: 'withdrawn', leftOn: localToday(), reason: 'recorded twice' } })));
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'STUDENT_LEFT' and entity_id = $1`, [f.studentId])).n).toBe('1');
    });

    it('A-12 turned off by two admins at once: one change, one audit row; each graduate registration expires once', async () => {
      const adm2 = await admin('f0r2');
      const g = await family('graduate-twice', 12);
      await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: g.studentId }, json: { cohortYear: thisYear - 3, reason: 'graduated last June' } }));
      await extend(g.studentId, nov);
      const [reg] = await apiResponse(g.parent.api.v1.registrations.direct.$post({ json: { sessionId: nov, subjectIds: [subj[4]!], studentId: g.studentId } }));
      const before = Number((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'SETTING_CHANGED' and entity_id = 'eligibility.graduateRetakes'`)).n);
      const results = await Promise.all([adm, adm2].map((a) =>
        a.api.v1.settings[':key'].$put({ param: { key: 'eligibility.graduateRetakes' }, json: { value: false, reason: 'turned off twice' } })));
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(Number((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'SETTING_CHANGED' and entity_id = 'eligibility.graduateRetakes'`)).n)).toBe(before + 1);
      expect((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'REGISTRATION_EXPIRED' and entity_id = $1`, [reg!.id])).n).toBe('1');
      await sql(`delete from school_setting where key = 'eligibility.graduateRetakes'`);
    });

    it('two coordinators place one student in two sections at once: one open membership, the other ended', async () => {
      const year = (await apiResponse(coordinator.api.v1.academic.years.$get())).find((y) => y.startYear === thisYear)
        ?? await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: thisYear, startsOn: `${thisYear}-09-06`, endsOn: `${thisYear + 1}-06-25` } }));
      const [a, b] = await Promise.all(['11R1', '11R2'].map(async (name) =>
        (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: year.id, grade: 11, name } }))).id));
      const f = await family('placed');
      const results = await Promise.all([[coordinator, a], [coordinator2, b]].map(([c, id]) =>
        (c as Client).api.v1.academic.sections[':id'].members.$post({ param: { id: id as string }, json: { studentIds: [f.studentId] } })));
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const open = await sql(`select section_id from section_membership where student_id = $1 and ended_on is null`, [f.studentId]);
      expect(open).toHaveLength(1);
      expect(await sql(`select 1 from section_membership where student_id = $1`, [f.studentId])).toHaveLength(2);
    });

    it('the roll-over committed twice at once: each section is made once and each student moved once', async () => {
      const years = await apiResponse(coordinator.api.v1.academic.years.$get());
      const from = years.find((y) => y.startYear === thisYear)!;
      const to = years.find((y) => y.startYear === thisYear + 1)
        ?? await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: thisYear + 1, startsOn: `${thisYear + 1}-09-05`, endsOn: `${thisYear + 2}-06-24` } }));
      const src = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: from.id, grade: 11, name: '11RR' } }))).id;
      const f = await family('rolled');
      await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: src }, json: { studentIds: [f.studentId] } }));
      const auditBefore = Number((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'SECTIONS_ROLLED_OVER' and entity_id = $1`, [to.id])).n);

      const results = await Promise.all([coordinator, coordinator2].map((c) =>
        c.api.v1.academic.sections['roll-over'].$post({ json: { fromAcademicYearId: from.id, toAcademicYearId: to.id, commit: true } })));
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const made = await sql<{ id: string }>(`select id from section where rolled_from_section_id = $1`, [src]);
      expect(made).toHaveLength(1);
      expect(await sql(`select 1 from section_membership where student_id = $1 and academic_year_id = $2 and ended_on is null`, [f.studentId, to.id])).toHaveLength(1);
      expect(Number((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'SECTIONS_ROLLED_OVER' and entity_id = $1`, [to.id])).n)).toBe(auditBefore + 1);
    });
  });
});
