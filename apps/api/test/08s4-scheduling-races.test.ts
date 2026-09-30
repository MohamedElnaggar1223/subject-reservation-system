import { describe, it, expect, beforeAll } from 'vitest';
import { apiResponse, academicYearStartOf } from '@repo/validations';
import { admin, staff, subject, refused, one, sql, holdRowLock, lockWaiters, type Client } from './helpers';

/**
 * F1 — what two people can do at once (FEATURES_PLAN.md §5: "anything two
 * people can act on at once has a race test"). Each race is put in a known
 * order: a row lock is held from outside, both requests queue behind it, and
 * the test releases it.
 *
 * - Two coordinators move two lessons into the same period for one teacher:
 *   one lands, the other is refused with the clash (edits serialize on the
 *   draft's row and each is judged against the draft as it then is).
 * - The generator runs while a coordinator moves a lesson: the move lands and
 *   the generator writes nothing (its input changed), saying so.
 * - Two coordinators publish the same draft: it is published once.
 * - Two coordinators give one lesson cover at once: one cover.
 * - Two coordinators give one teacher two lessons at the same time: one.
 * - Two coordinators form the year's groups at once: each group and member once.
 */

const Y = academicYearStartOf() + 23;
const D = (() => {
  const d = new Date(`${Y}-10-04T12:00:00Z`);
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();

/** Hold the year's group-forming lock (formGroups' advisory lock) from outside. */
async function holdGroupsLock(academicYearId: string): Promise<() => Promise<void>> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`teaching-groups:${academicYearId}`]);
  return async () => {
    await client.query('COMMIT');
    await client.end();
  };
}

describe('F1: races', () => {
  let adm: Client, c1: Client, c2: Client;
  const t: Record<string, string> = {};
  let yearId: string, termId: string, phys: string, published: string;
  const lessonIds: Record<string, string> = {};

  const load = (id: string) => apiResponse(c1.api.v1.timetables[':id'].$get({ param: { id } }));
  const lessonOf = async (id: string, name: string) => {
    const tt = await load(id);
    return tt.engine.lessons.find((l) => l.groupId === tt.groups.find((g) => g.name === name)!.id)!;
  };

  beforeAll(async () => {
    adm = await admin('race');
    c1 = await staff(adm, 'coordinator', 'race-1');
    c2 = await staff(adm, 'coordinator', 'race-2');
    for (const k of ['a', 'b', 'c']) {
      const x = await staff(adm, 'teacher', `race-${k}`);
      t[k] = (await one<{ id: string }>(`select id from teacher where user_id = $1`, [x.id])).id;
    }
    yearId = (await apiResponse(c1.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }))).id;
    termId = (await apiResponse(c1.api.v1.academic.terms.$post({ json: { academicYearId: yearId, name: 'Term 1', startsOn: `${Y}-09-06`, endsOn: `${Y}-12-20` } }))).id;
    const bells = await apiResponse(c1.api.v1.academic['bell-schedules'].$post({ json: { academicYearId: yearId, name: 'Regular', isDefault: true } }));
    await apiResponse(c1.api.v1.academic['bell-schedules'][':id'].periods.$put({
      param: { id: bells.id },
      json: { periods: [1, 2, 3, 4].map((p) => ({ weekday: null, label: `P${p}`, kind: 'lesson' as const, startsAt: `${String(7 + p).padStart(2, "0")}:00`, endsAt: `${String(7 + p).padStart(2, "0")}:45` })) },
    }));
    phys = await subject(adm, 'F1R-PHY', 'Physics race', { course: 1000, registration: 400 });
    const mk = (name: string, teacherId: string) =>
      apiResponse(c1.api.v1.scheduling.groups.$post({ json: { academicYearId: yearId, name, subjectId: phys, teacherId, weeklyPeriods: 1, doublePeriods: 0 } }));
    await mk('Race A1', t.a!);
    await mk('Race A2', t.a!);
    await mk('Race B', t.b!);
    await mk('Race C', t.c!);
    // A published timetable for the cover races: A1 and B at Sunday P1, A2 at Tuesday P2, C (the free teacher) on Monday.
    published = (await apiResponse(c1.api.v1.timetables.$post({ json: { termId, name: 'Published' } }))).id;
    for (const [name, weekday, period] of [['Race A1', 0, 1], ['Race B', 0, 1], ['Race A2', 2, 2], ['Race C', 1, 1]] as const) {
      const l = await lessonOf(published, name);
      lessonIds[name] = l.id;
      await apiResponse(c1.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({ param: { id: published, lessonId: l.id }, json: { weekday, period, from: { weekday: null, period: null } } }));
    }
    await apiResponse(c1.api.v1.timetables[':id'].publish.$post({ param: { id: published }, json: { effectiveFrom: `${Y}-09-06` } }));
    for (const k of ['a', 'b']) await apiResponse(c1.api.v1.cover.absences.$post({ json: { teacherId: t[k]!, startsOn: D, endsOn: D, reason: 'sick' } }));
  }, 120_000);

  it('two coordinators move two lessons of one teacher into the same period: one lands, the other is refused with the clash', async () => {
    const draft = (await apiResponse(c1.api.v1.timetables.$post({ json: { termId, name: 'Two editors', copyFromId: published } }))).id;
    const a1 = await lessonOf(draft, 'Race A1');
    const a2 = await lessonOf(draft, 'Race A2');
    const release = await holdRowLock('timetable', draft);
    const first = c1.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({ param: { id: draft, lessonId: a1.id }, json: { weekday: 3, period: 3, from: { weekday: a1.weekday, period: a1.period } } });
    await lockWaiters(1);
    const second = c2.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({ param: { id: draft, lessonId: a2.id }, json: { weekday: 3, period: 3, from: { weekday: a2.weekday, period: a2.period } } });
    await lockWaiters(2);
    await release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.status).toBe(200);
    expect(await refused(Promise.resolve(r2))).toEqual({ status: 409, error: 'It would clash: teacher race-a teaches Race A1 and Race A2 at Wednesday P3' });
    const after = await load(draft);
    expect(after.clashes).toEqual([]);
    expect(after.engine.lessons.filter((l) => l.weekday === 3 && l.period === 3).map((l) => l.id)).toEqual([a1.id]);
  });

  it('the generator runs while a lesson is moved: the move lands, the generator writes nothing and says why', async () => {
    const draft = (await apiResponse(c1.api.v1.timetables.$post({ json: { termId, name: 'Generate during a move', copyFromId: published } }))).id;
    const b = await lessonOf(draft, 'Race B');
    const release = await holdRowLock('timetable', draft);
    const move = c2.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({ param: { id: draft, lessonId: b.id }, json: { weekday: 4, period: 4, from: { weekday: b.weekday, period: b.period } } });
    await lockWaiters(1);
    const gen = c1.api.v1.timetables[':id'].generate.$post({ param: { id: draft }, json: { iterations: 1000 } });
    await lockWaiters(2);
    await release();
    const [m, g] = await Promise.all([move, gen]);
    expect(m.status).toBe(200);
    expect(await refused(Promise.resolve(g))).toEqual({ status: 409, error: 'The timetable changed while the generator ran, so nothing was written — run it again' });
    expect((await lessonOf(draft, 'Race B'))).toMatchObject({ weekday: 4, period: 4 });
    expect(await sql(`select outcome from timetable_generation_run where timetable_id = $1`, [draft])).toEqual([{ outcome: 'stale' }]);
    // Run again, with nothing moving: it writes.
    expect((await c1.api.v1.timetables[':id'].generate.$post({ param: { id: draft }, json: { iterations: 1000 } })).status).toBe(200);
  });

  it('two coordinators publish the same draft at once: it is published once', async () => {
    const draft = (await apiResponse(c1.api.v1.timetables.$post({ json: { termId, name: 'Published twice?', copyFromId: published } }))).id;
    const release = await holdRowLock('academic_term', termId);
    const p1 = c1.api.v1.timetables[':id'].publish.$post({ param: { id: draft }, json: { effectiveFrom: `${Y}-11-01` } });
    await lockWaiters(1);
    const p2 = c2.api.v1.timetables[':id'].publish.$post({ param: { id: draft }, json: { effectiveFrom: `${Y}-11-08` } });
    await lockWaiters(2);
    await release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.status).toBe(200);
    expect(await refused(Promise.resolve(r2))).toEqual({ status: 409, error: 'A published timetable does not change — make a new draft from it on the Versions screen' });
    expect(await one(`select status, effective_from from timetable where id = $1`, [draft])).toEqual({ status: 'published', effective_from: `${Y}-11-01` });
    expect(Number((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'TIMETABLE_PUBLISHED' and entity_id = $1`, [draft])).n)).toBe(1);
  });

  it('two coordinators give one lesson cover at once: one cover stands', async () => {
    const release = await holdRowLock('timetable_lesson', lessonIds['Race A1']!);
    const x = c1.api.v1.cover.assignments.$post({ json: { lessonId: lessonIds['Race A1']!, date: D, coverTeacherId: t.c! } });
    await lockWaiters(1);
    const y = c2.api.v1.cover.assignments.$post({ json: { lessonId: lessonIds['Race A1']!, date: D, cancel: true } });
    await lockWaiters(2);
    await release();
    const [rx, ry] = await Promise.all([x, y]);
    expect(rx.status).toBe(201);
    expect(await refused(Promise.resolve(ry))).toEqual({ status: 409, error: 'This lesson already has cover arranged — remove it first to change it' });
    expect(await sql(`select status, cover_teacher_id from cover_assignment where lesson_id = $1 and date = $2`, [lessonIds['Race A1'], D])).toEqual([{ status: 'assigned', cover_teacher_id: t.c }]);
  });

  it('two coordinators give one teacher two lessons at the same time: the second is refused', async () => {
    // A1 is covered by C above; take that back first so both Sunday P1 lessons are open.
    const [c] = await sql<{ id: string }>(`select id from cover_assignment where lesson_id = $1 and date = $2 and status = 'assigned'`, [lessonIds['Race A1'], D]);
    await apiResponse(c1.api.v1.cover.assignments[':id'].remove.$post({ param: { id: c!.id }, json: { reason: 'reset for the next race' } }));
    const release = await holdRowLock('teacher', t.c!);
    const x = c1.api.v1.cover.assignments.$post({ json: { lessonId: lessonIds['Race A1']!, date: D, coverTeacherId: t.c! } });
    await lockWaiters(1);
    const y = c2.api.v1.cover.assignments.$post({ json: { lessonId: lessonIds['Race B']!, date: D, coverTeacherId: t.c! } });
    await lockWaiters(2);
    await release();
    const [rx, ry] = await Promise.all([x, y]);
    expect(rx.status).toBe(201);
    expect(await refused(Promise.resolve(ry))).toEqual({ status: 409, error: 'teacher race-c covers Race A1 then' });
    expect(await sql(`select l.id from cover_assignment c join timetable_lesson l on l.id = c.lesson_id where c.cover_teacher_id = $1 and c.date = $2 and c.status = 'assigned'`, [t.c, D]))
      .toEqual([{ id: lessonIds['Race A1'] }]);
  });

  it('two coordinators form the year’s groups at once: each group and member is made once', async () => {
    const students = await sql<{ id: string }>(
      `insert into "user" (id, name, email, role, cohort_year) select gen_random_uuid()::text, 'Race student ' || n, 'f1r.' || n || '@test.local', 'student', $1::int from generate_series(1, 4) n returning id`, [Y - 1]);
    const rows = students.map((s) => ({ student: s.id, subject: 'F1R-PHY', teacher: t.b!, mode: 'in_school' as const }));
    await apiResponse(c1.api.v1.enrolments.batch.$post({ json: { academicYearId: yearId, rows, commit: true } }));
    const release = await holdGroupsLock(yearId);
    const x = c1.api.v1.scheduling.groups.form.$post({ json: { academicYearId: yearId, commit: true } });
    const y = c2.api.v1.scheduling.groups.form.$post({ json: { academicYearId: yearId, commit: true } });
    await lockWaiters(2);
    await release();
    const [rx, ry] = await Promise.all([x, y]);
    const results = [await apiResponse(Promise.resolve(rx)), await apiResponse(Promise.resolve(ry))].map((r) => r.added).sort();
    expect(results).toEqual([0, 4]);
    // The four students are in one group of the subject, once each (the existing group with that teacher).
    expect(await sql(`select g.name, count(*)::text as n from teaching_group_member m join teaching_group g on g.id = m.group_id where m.student_id in $1 and m.ended_on is null group by g.name`, [students.map((s) => s.id)]))
      .toEqual([{ name: 'Race B', n: '4' }]);
  });
});
