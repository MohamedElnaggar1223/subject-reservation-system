import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse } from '@repo/validations';
import { one, sql, holdRowLock, lockWaiters, refuseAudit, type Client } from './helpers';
import { examWorld, dayFromNow, type ExamWorld } from './exam-helpers';

/**
 * F4 — what two people (or two scheduler instances) can do at once
 * (FEATURES_PLAN.md §5: "anything two people can act on at once has a race
 * test"). Each race is forced into an order: a lock held from outside while
 * both requests queue behind it, then released.
 */

/** Hold one transaction-scoped advisory lock (the key a service takes) from a connection of its own. */
async function holdAdvisory(key: string): Promise<() => Promise<void>> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [key]);
  return async () => {
    await client.query('COMMIT');
    await client.end();
  };
}

const settle = <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }));

describe('F4: races', () => {
  let w: ExamWorld;
  let coord: Client;
  let a: string, b: string, c: string;

  beforeAll(async () => {
    w = await examWorld('xr');
    coord = w.coordinator;
    [a, b, c] = [w.families.a.studentId, w.families.b.studentId, w.families.c.studentId];
  }, 120_000);

  afterAll(async () => {
    await w.close();
  });

  it('two coordinators derive the same series at once: each entry is made once', async () => {
    const release = await holdAdvisory(`exam:derive:${w.series.pearsonJan}`);
    const derive = () => coord.api.v1.exams.entries.derive.$post({ json: { boardSeriesId: w.series.pearsonJan, commit: true } });
    const both = [derive(), derive()];
    await lockWaiters(2);
    await release();
    const [r1, r2] = await Promise.all([apiResponse(both[0]!), apiResponse(both[1]!)]);
    expect([r1.created, r2.created].sort()).toEqual([0, 5]);
    const n = await one<{ n: number }>(`select count(*)::int as n from exam_entry where board_series_id = $1`, [w.series.pearsonJan]);
    expect(n.n).toBe(5);
  });

  it('two coordinators number the same series at once: every candidate one number, every number one candidate', async () => {
    const release = await holdAdvisory(`exam:numbers:${w.series.pearsonJan}`);
    const assign = () => coord.api.v1.exams['candidate-numbers'].assign.$post({ json: { boardSeriesId: w.series.pearsonJan, commit: true } });
    const both = [assign(), assign()];
    await lockWaiters(2);
    await release();
    const [r1, r2] = await Promise.all([apiResponse(both[0]!), apiResponse(both[1]!)]);
    expect([r1.toAssign.length, r2.toAssign.length].sort()).toEqual([0, 3]);
    const rows = await sql<{ student_id: string; number: string }>(`select student_id, number from exam_candidate_number where board_series_id = $1`, [w.series.pearsonJan]);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.number)).size).toBe(3);
    expect(new Set(rows.map((r) => r.student_id))).toEqual(new Set([a, b, c]));
  });

  it('a withdrawal and an amendment of the same entry at once run one after the other: the second finds it withdrawn', async () => {
    await apiResponse(coord.api.v1.exams.entries.derive.$post({ json: { boardSeriesId: w.series.cambridgeNov, commit: true } }));
    const e = await one<{ id: string }>(`select id from exam_entry where board_series_id = $1 and student_id = $2`, [w.series.cambridgeNov, a]);
    await apiResponse(coord.api.v1.exams.entries.submit.$post({ json: { entryIds: [e.id] } }));
    const release = await holdRowLock('exam_entry', e.id);
    const withdraw = settle(apiResponse(coord.api.v1.exams.entries[':id'].withdraw.$post({ param: { id: e.id }, json: { reason: 'dropping it (race)' } })));
    await lockWaiters(1);
    const amend = settle(apiResponse(coord.api.v1.exams.entries[':id'].$put({ param: { id: e.id }, json: { optionCode: w.catalogue.optTwo, reason: 'race' } })));
    await lockWaiters(2);
    await release();
    const [wd, am] = await Promise.all([withdraw, amend]);
    expect(wd.ok).toBe(true);
    expect(am.ok).toBe(false);
    expect(String((am as { e: Error }).e.message)).toBe('This entry was withdrawn: add a new one instead');
    expect(await one(`select status, option_code from exam_entry where id = $1`, [e.id])).toEqual({ status: 'withdrawn', option_code: null });
  });

  it('two coordinators put two candidates in the same free seat at once: one is seated, the other told whose it is', async () => {
    const d = dayFromNow(45);
    for (const [code, unitId] of [['XRWMA11/01', w.catalogue.pu1]] as const) {
      await apiResponse(coord.api.v1.exams.papers.$post({ json: { boardSeriesId: w.series.pearsonJan, code, title: 'P1', unitId, examDate: d, session: 'am', startTime: '09:00', durationMinutes: 90 } }));
    }
    const hall = (await apiResponse(coord.api.v1.academic.rooms.$post({ json: { name: 'XR Hall', capacity: 40, type: 'hall', features: [] } }))).id;
    await apiResponse(coord.api.v1.exams.sittings.rooms.$put({ json: { examDate: d, session: 'am', rooms: [{ roomId: hall, seatRows: 2, seatColumns: 2 }] } }));
    const seat = (studentId: string) => settle(apiResponse(coord.api.v1.exams.seats.$put({ json: { examDate: d, session: 'am', studentId, roomId: hall, seatLabel: 'B2' } })));
    const [r1, r2] = await Promise.all([seat(a), seat(c)]);
    expect([r1.ok, r2.ok].sort()).toEqual([false, true]);
    const winner = (await one<{ student_id: string }>(`select student_id from exam_seat where exam_date = $1 and room_id = $2 and seat_label = 'B2'`, [d, hall])).student_id;
    const loser = r1.ok ? r2 : r1;
    expect(String((loser as { e: Error }).e.message)).toBe(`Seat B2 in XR Hall is already ${winner === a ? 'Student x-xr-a' : 'Student x-xr-c'}'s`);
    expect(await sql(`select 1 from exam_seat where exam_date = $1 and session = 'am' and room_id = $2`, [d, hall])).toHaveLength(1);
  });

  it('two results imports of the same file at once record each result once', async () => {
    await apiResponse(coord.api.v1.exams.candidates[':studentId'].$put({ param: { studentId: b }, json: { uci: '91234B260201R' } }));
    const text = 'UCI,Unit Code,Grade,UMS\n91234B260201R,XRWMA11,B,80\n91234B260201R,XRWMA12,A,90';
    const release = await holdAdvisory(`exam:results:${w.series.pearsonJan}`);
    const imp = () => coord.api.v1.exams.results.import.$post({ json: { boardSeriesId: w.series.pearsonJan, source: { text, name: 'race' }, commit: true } });
    const both = [imp(), imp()];
    await lockWaiters(2);
    await release();
    const [r1, r2] = await Promise.all([apiResponse(both[0]!), apiResponse(both[1]!)]);
    expect([r1.summary.new, r2.summary.new].sort()).toEqual([0, 2]);
    expect(await sql(`select 1 from exam_result where student_id = $1 and board_series_id = $2`, [b, w.series.pearsonJan])).toHaveLength(2);
  });

  it('a certificate collected at two desks at once: collected once, the other officer told who took it', async () => {
    await apiResponse(coord.api.v1.exams.results.publish.$post({ json: { boardSeriesId: w.series.pearsonJan } }));
    await apiResponse(coord.api.v1.exams.certificates.receive.$post({ json: { boardSeriesId: w.series.pearsonJan, receivedOn: dayFromNow(0), commit: true } }));
    const cert = await one<{ id: string }>(`select id from exam_certificate where student_id = $1 and board_series_id = $2`, [b, w.series.pearsonJan]);
    const release = await holdRowLock('exam_certificate', cert.id);
    const collect = (who: Client, name: string) => settle(apiResponse(who.api.v1.exams.certificates[':id'].collect.$post({ param: { id: cert.id }, json: { collectorName: name, collectorRelation: 'parent' } })));
    const first = collect(w.officer, 'Parent One');
    await lockWaiters(1);
    const second = collect(w.finadmin, 'Parent Two');
    await lockWaiters(2);
    await release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
    expect(String((r2 as { e: Error }).e.message)).toMatch(/^This certificate was already collected by Parent One on \d{4}-\d{2}-\d{2}$/);
    expect(await one(`select status, collector_name from exam_certificate where id = $1`, [cert.id])).toEqual({ status: 'collected', collector_name: 'Parent One' });
    const audits = await sql(`select 1 from audit_log where entity_id = $1 and action = 'EXAM_CERTIFICATE_COLLECTED'`, [cert.id]);
    expect(audits).toHaveLength(1);
  });

  it('two scheduler instances on the same tick send each deadline reminder once', async () => {
    const { sendDeadlineReminders } = await import('../src/services/exam-deadline.services');
    await Promise.all([sendDeadlineReminders(), sendDeadlineReminders()]);
    const rows = await sql(`select 1 from exam_deadline_reminder where board_series_id in ($1, $2)`, [w.series.cambridgeNov, w.series.pearsonJan]);
    expect(rows).toHaveLength(2);
    const notes = await one<{ n: number }>(`select count(*)::int as n from notification where user_id = $1 and type = 'EXAM_DEADLINE_REMINDER' and data->>'boardSeriesId' in ($2, $3)`,
      [coord.id, w.series.cambridgeNov, w.series.pearsonJan]);
    expect(notes.n).toBe(2);
  });

  it('a reminder that fails leaves no claim and no notice behind; the next tick sends it', async () => {
    const { sendDeadlineReminders } = await import('../src/services/exam-deadline.services');
    await apiResponse(w.adm.api.v1['board-series'][':id'].$put({ param: { id: w.series.pearsonJan }, json: { forecastGradesDue: dayFromNow(9) } }));
    const release = await refuseAudit('EXAM_DEADLINE_REMINDED');
    let r;
    try {
      r = await sendDeadlineReminders();
    } finally {
      await release();
    }
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const forecastRows = () => sql(`select 1 from exam_deadline_reminder where board_series_id = $1 and date_field = 'forecastGradesDue'`, [w.series.pearsonJan]);
    const forecastNotes = () => sql(`select 1 from notification where user_id = $1 and type = 'EXAM_DEADLINE_REMINDER' and data->>'boardSeriesId' = $2 and data->>'field' = 'forecastGradesDue'`, [coord.id, w.series.pearsonJan]);
    expect(await forecastRows()).toHaveLength(0);
    expect(await forecastNotes()).toHaveLength(0);
    await sendDeadlineReminders();
    expect(await forecastRows()).toHaveLength(1);
    expect(await forecastNotes()).toHaveLength(1);
  });
});
