import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiResponse, academicYearStartOf, type LineInputType } from '@repo/validations';
import {
  admin, staff, onboard, subject, refused, one, sql, notified, holdRowLock, lockWaiters, pauseAtAudits, type Client,
} from './helpers';
import { setClockForTests } from '../src/lib/clock';

/**
 * F1 on the reservations rework's model (RESERVATIONS_REWORK.md §9's F1 list, §10's F1 row;
 * docs/features/SCHEDULING.md §17) and round two's three flags, every request through the typed
 * client:
 * - teaching demand per (subject, unit, teacher) with the offer's delivery; groups per unit; an
 *   online group timetabled without a room; a provider's group with no lessons;
 * - a line's teacher (B's change), a teacher replaced on an offer (A's) and the enrolment screen
 *   reach the groups through upsertEnrolments with the unit (F1's followEnrolments), each branch of
 *   the rule: the student moves, the whole group follows, the student stays (no group of the new
 *   teacher, or a clash in the published timetable) and is listed, self-study leaves;
 * - "no preference" assigned later on Teaching groups;
 * - checkEnrolments per unit, and the subject held whole and per unit at once;
 * - flag 1: a teacher change dated inside a version's time judged across every interval (the
 *   grid, the generator, publishing); flag 2: carried cover judged again inside the publication,
 *   and after a group's teacher change; flag 3: the races, each forced in order with a held lock.
 */

// Its own year, and the one before it for the roll-over (no other suite uses either).
const Y = academicYearStartOf() + 28;
const RUN = Math.random().toString(36).slice(2, 6);
const days = (n: number) => n * 86_400_000;
const onOrAfter = (date: string, weekday: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const plus = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Put the school on a date (09:00 in Cairo is still that date in UTC). */
const clockAt = (date: string) => setClockForTests(new Date(`${date}T09:00:00Z`));
const readable = (date: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

type Fam = { parent: Client; student: Client; studentId: string };
type Line = Pick<LineInputType, 'offerItemId' | 'attempt' | 'mode'> & Partial<LineInputType>;

/** Reserve lines as every reservation path does (the student locked first, then insertLines, both consents). */
async function reserve(studentId: string, sessionId: string, lines: Line[]) {
  const { db } = await import('@repo/db');
  const { insertLines } = await import('../src/services/line.services');
  const { writeConsents } = await import('../src/services/reservation.services');
  const { assertMayRegisterForInTx } = await import('../src/services/eligibility.services');
  return db.transaction(async (tx) => {
    const eligibility = await assertMayRegisterForInTx(tx, studentId, sessionId);
    const made = await insertLines(tx, { studentId, sessionId, lines: lines as LineInputType[], status: 'pending_payment', requestedBy: studentId, eligibility });
    await writeConsents(tx, made.map((r) => r.id), { channel: 'app', confirmedBy: studentId });
    return made;
  });
}

describe('F1 on the rework: units, delivery, the group following the enrolment; round two', () => {
  let adm: Client, coordinator: Client, officer: Client, finadmin: Client;
  const t: Record<string, { c: Client; id: string }> = {};
  const s: Record<string, Fam> = {};
  let yearId: string, termId: string, sectionX: string;
  let maths: string, bio: string, arabic: string, p1: string, p2: string;
  let june: string, winter: string, junS: string, janS: string, priorS: string;
  let mathsJune: { id: string; items: string[] };
  const line: Record<string, string> = {};
  const gid: Record<string, string> = {};
  let v1: string;
  const D0 = onOrAfter(`${Y}-10-04`, 0); // a Sunday
  const D1 = plus(D0, 14);
  const name = (k: string) => `teacher rw-${k}-${RUN}`;

  const load = (id: string) => apiResponse(coordinator.api.v1.timetables[':id'].$get({ param: { id } }));
  const lessonOf = async (ttId: string, group: string, seq = 1) => {
    const tt = await load(ttId);
    const g = tt.groups.find((x) => x.name === group);
    if (!g) throw new Error(`no group ${group} in the timetable`);
    return tt.engine.lessons.find((l) => l.groupId === g.id && l.seq === seq)!;
  };
  const place = async (ttId: string, group: string, weekday: number, period: number) => {
    const l = await lessonOf(ttId, group);
    return apiResponse(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({ param: { id: ttId, lessonId: l.id }, json: { weekday, period, from: { weekday: l.weekday, period: l.period } } }));
  };
  const groups = async () => (await apiResponse(coordinator.api.v1.scheduling.groups.$get({ query: { academicYearId: yearId } }))).groups;
  const groupNamed = async (n: string) => {
    const g = (await groups()).find((x) => x.name === n && !x.archived);
    if (!g) throw new Error(`no group named ${n}: ${(await groups()).map((x) => x.name).join(', ')}`);
    return g;
  };
  /** Each open membership of a student this year: group name and first day. */
  const membershipsOf = (who: string) => sql<{ group: string; started_on: string }>(
    `select g.name as group, m.started_on from teaching_group_member m join teaching_group g on g.id = m.group_id
      where m.student_id = $1 and m.academic_year_id = $2 and m.ended_on is null order by g.name`, [s[who]!.studentId, yearId]);
  const enrolmentOf = (who: string, unitId: string | null) => one<{ teacher_id: string | null; mode: string }>(
    `select teacher_id, mode from course_enrolment where student_id = $1 and academic_year_id = $2 and ended_on is null
       and ${unitId ? 'unit_id = $3' : 'subject_id = $3 and unit_id is null'}`, [s[who]!.studentId, yearId, unitId ?? bio]);
  const putTeacher = (who: Client, registrationId: string, json: { teacherId: string | null; mode?: 'in_school' | 'self_study'; reason: string }) =>
    who.api.v1.registrations[':id'].teacher.$put({ param: { id: registrationId }, json });
  const waiting = () => apiResponse(coordinator.api.v1.scheduling.groups.waiting.$get({ query: { academicYearId: yearId } }));

  beforeAll(async () => {
    adm = await admin(`rw-${RUN}`);
    coordinator = await staff(adm, 'coordinator', `rw-${RUN}`);
    officer = await staff(adm, 'finance_officer', `rw-${RUN}`);
    finadmin = await staff(adm, 'finance_admin', `rw-${RUN}`);
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      const c = await staff(adm, 'teacher', `rw-${k}-${RUN}`);
      t[k] = { c, id: (await one<{ id: string }>(`select id from teacher where user_id = $1`, [c.id])).id };
    }
    // The school's year far ahead (no other suite's calendar moves its lessons), one term, four periods a day, a room.
    yearId = (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y, startsOn: `${Y}-09-06`, endsOn: `${Y + 1}-06-25` } }))).id;
    termId = (await apiResponse(coordinator.api.v1.academic.terms.$post({ json: { academicYearId: yearId, name: 'Term 1', startsOn: `${Y}-09-06`, endsOn: `${Y}-12-20` } }))).id;
    const bells = await apiResponse(coordinator.api.v1.academic['bell-schedules'].$post({ json: { academicYearId: yearId, name: 'Regular', isDefault: true } }));
    await apiResponse(coordinator.api.v1.academic['bell-schedules'][':id'].periods.$put({
      param: { id: bells.id },
      json: { periods: [1, 2, 3, 4].map((p) => ({ weekday: null, label: `P${p}`, kind: 'lesson' as const, startsAt: `${String(7 + p).padStart(2, '0')}:00`, endsAt: `${String(7 + p).padStart(2, '0')}:45` })) },
    }));
    for (const r of ['1', '2', '3']) await apiResponse(coordinator.api.v1.academic.rooms.$post({ json: { name: `RW room ${r} ${RUN}`, capacity: 40, type: 'classroom', features: [] } }));

    // The catalogue: an IAL subject with two units, two whole subjects; Pearson's June and January series.
    maths = await subject(adm, `F1W-MAT-${RUN}`, 'Maths W', { course: 2000, registration: 800 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    bio = await subject(adm, `F1W-BIO-${RUN}`, 'Biology W', { course: 1500, registration: 600 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    arabic = await subject(adm, `F1W-ARA-${RUN}`, 'Arabic W', { course: 1000, registration: 400 }, { qualificationLevel: 'as_level', council: 'pearson_edexcel' });
    const unit = async (code: string, short: string) => (await apiResponse(coordinator.api.v1.catalogue.units.$post({ json: { boardCode: 'pearson_edexcel', code: `${code}${RUN}`, shortCode: short, title: short, unitLevel: 'as', kind: 'unit' } }))).id;
    p1 = await unit('WMA11', 'P1');
    p2 = await unit('WMA12', 'P2');
    const series = async (month: 'june' | 'january', year: number, label: string) =>
      (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', month, year, label, entryDeadline: new Date(Date.now() + days(120)) } })))!.id;
    junS = await series('june', Y + 1, `rw-jun-${RUN}`);
    janS = await series('january', Y + 1, `rw-jan-${RUN}`);
    priorS = (await apiResponse(adm.api.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', month: 'june', year: Y, label: `rw-prior-${RUN}` } })))!.id;
    const fees = (seriesId: string, rows: { keyKind: 'unit' | 'subject'; keyId: string; amount: number }[]) =>
      apiResponse(finadmin.api.v1['board-fees'].$put({ query: { seriesId }, json: { rows: rows.map((r) => ({ ...r, provisional: false })) } }));
    await fees(junS, [{ keyKind: 'unit', keyId: p1, amount: 800 }, { keyKind: 'subject', keyId: bio, amount: 600 }, { keyKind: 'subject', keyId: arabic, amount: 400 }]);
    await fees(janS, [{ keyKind: 'unit', keyId: p2, amount: 800 }]);

    // Two sessions of the year Y: June (Y + 1) and the winter of Y, both open for reservations now.
    const mkSession = async (type: 'june' | 'winter', year: number, label: string) => (await apiResponse(adm.api.v1.sessions.$post({
      json: {
        type, year, label, startDate: new Date(Date.now() - days(1)).toISOString(), endDate: new Date(Date.now() + days(60)).toISOString(),
        courseStartsOn: `${Y}-09-06`, paymentDueAt: new Date(Date.now() + days(40)).toISOString(),
      },
    })))!.id;
    june = await mkSession('june', Y + 1, `rw-june-${RUN}`);
    winter = await mkSession('winter', Y, `rw-winter-${RUN}`);
    const offer = async (sessionId: string, subjectId: string, teachers: ({ teacherId: string } | { providerName: string })[] & unknown[], items: Record<string, unknown>[]) =>
      (await apiResponse(adm.api.v1.sessions[':id'].offers.$post({ param: { id: sessionId }, json: { subjectId, courseFee: 1000, teachers: teachers as never, items: items as never } })))!;
    const unitItem = (label: string, unitId: string, seriesId: string, teachers?: { teacherId: string; mode: 'in_school' | 'online' }[]) =>
      ({ label, kind: 'unit', enters: { kind: 'units', unitIds: [unitId] }, boardSeriesId: seriesId, availability: 'open', requiredInSeries: false, ...(teachers ? { teachers } : {}) });
    const whole = (seriesId: string) => ({ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: seriesId, availability: 'open', requiredInSeries: false });
    // Maths: P1 in June with two teachers; P2 in the winter with one. Biology: one teacher in school,
    // one online, one with no students yet. Arabic: an external team (a provider).
    mathsJune = await offer(june, maths, [{ teacherId: t.a!.id, mode: 'in_school' }, { teacherId: t.b!.id, mode: 'in_school' }],
      [unitItem('P1', p1, junS, [{ teacherId: t.a!.id, mode: 'in_school' }, { teacherId: t.b!.id, mode: 'in_school' }])]);
    const mathsWinter = await offer(winter, maths, [{ teacherId: t.a!.id, mode: 'in_school' }], [unitItem('P2', p2, janS)]);
    const bioJune = await offer(june, bio, [{ teacherId: t.a!.id, mode: 'in_school' }, { teacherId: t.c!.id, mode: 'online' }, { teacherId: t.d!.id, mode: 'in_school' }], [whole(junS)]);
    const arabicJune = await offer(june, arabic, [{ providerName: `Provider W ${RUN}` }], [whole(junS)]);
    const provider = (await one<{ id: string }>(`select t.id from teacher t join session_offer_teacher x on x.teacher_id = t.id where x.offer_id = $1`, [arabicJune.id])).id;

    // The families: grade 11 in the year Y.
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      s[k] = await onboard(officer, `rw-${k}-${RUN}`, 11);
      await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: s[k]!.studentId }, json: { cohortYear: Y - 1, reason: 'F1 rework scenario year' } }));
    }
    const first = (offerItemId: string, teacherId: string | null) => ({ offerItemId, attempt: 'first' as const, mode: 'in_school' as const, teacherId });
    const reserveOne = async (who: string, key: string, sessionId: string, l: Line) => { line[`${who}:${key}`] = (await reserve(s[who]!.studentId, sessionId, [l]))[0]!.id; };
    await reserveOne('1', 'p1', june, first(mathsJune.items[0]!, t.a!.id));
    await reserveOne('1', 'p2', winter, first(mathsWinter.items[0]!, t.a!.id));
    await reserveOne('1', 'bio', june, first(bioJune.items[0]!, t.a!.id));
    await reserveOne('2', 'p1', june, first(mathsJune.items[0]!, t.a!.id));
    await reserveOne('2', 'p2', winter, first(mathsWinter.items[0]!, t.a!.id));
    await reserveOne('3', 'p1', june, first(mathsJune.items[0]!, t.b!.id));
    await reserveOne('4', 'bio', june, first(bioJune.items[0]!, t.c!.id));
    // "No preference": P1 has two teachers, the family names neither (§3.5).
    await reserveOne('5', 'p1', june, first(mathsJune.items[0]!, null));
    await reserveOne('6', 'arabic', june, first(arabicJune.items[0]!, provider));
    await reserveOne('7', 'p1', june, first(mathsJune.items[0]!, t.a!.id));
    // A retake (declared at the desk) may go to self-study later.
    await reserveOne('8', 'bio', june, { offerItemId: bioJune.items[0]!, attempt: 'retake', mode: 'in_school', teacherId: t.a!.id, priorSittingSeriesId: priorS, priorSittingSource: 'declared_by_desk' });
    t.p = { c: adm, id: provider };

    // The school on the term's fourth Sunday from here on; the enrolments from the year's lines.
    clockAt(D0);
    await apiResponse(coordinator.api.v1.enrolments.bulk.$post({
      json: { academicYearId: yearId, source: 'registrations', studentIds: ['1', '2', '3', '4', '5', '6', '7', '8'].map((k) => s[k]!.studentId), subjectMap: [], exclude: [], commit: true },
    }));
    // Section X: student 3 alone, a homeroom-taught course at the time of Maths P1 (the clash scenario).
    sectionX = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: yearId, grade: 11, name: `RW-X` } }))).id;
    await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: sectionX }, json: { studentIds: [s['3']!.studentId], startsOn: `${Y}-09-06` } }));
    const made = await apiResponse(coordinator.api.v1.scheduling.groups.sections.$post({ json: { academicYearId: yearId, sectionIds: [sectionX], name: 'Homeroom', teacherId: t.f!.id, weeklyPeriods: 1, doublePeriods: 0 } }));
    gid.homeroom = made.created[0]!.id;
  }, 240_000);

  afterAll(() => setClockForTests(null));

  // ─── §10: the demand, the groups, delivery ─────────────────────────────────

  it('getTeachingDemand groups per subject, unit and teacher with the offer’s delivery and the teacher’s kind; "no preference" is a demand with no teacher', async () => {
    const demand = (await apiResponse(coordinator.api.v1.enrolments['teaching-demand'].$get({ query: { academicYearId: yearId } })))
      .filter((d) => [maths, bio, arabic].includes(d.subjectId));
    const row = (d: (typeof demand)[number]) => [d.subjectName, d.unitName, d.teacherName, d.delivery, d.teacherKind, d.students.map((x) => x.studentId).sort()];
    const who = (...k: string[]) => k.map((x) => s[x]!.studentId).sort();
    expect(demand.map(row).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual([
      ['Arabic W', null, `Provider W ${RUN}`, 'in_school', 'provider', who('6')],
      ['Biology W', null, name('a'), 'in_school', 'person', who('1', '8')],
      ['Biology W', null, name('c'), 'online', 'person', who('4')],
      ['Maths W', 'P1', name('a'), 'in_school', 'person', who('1', '2', '7')],
      ['Maths W', 'P1', name('b'), 'in_school', 'person', who('3')],
      ['Maths W', 'P1', null, 'in_school', null, who('5')],
      ['Maths W', 'P2', name('a'), 'in_school', 'person', who('1', '2')],
    ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    expect(demand.find((d) => d.unitName === 'P1')).toMatchObject({ unitId: p1, unitCode: `WMA11${RUN}`.toUpperCase() });
  });

  it('forming makes a group per unit and teacher; an online group is timetabled without a room; a provider’s group asks for no lessons and gets none', async () => {
    const preview = await apiResponse(coordinator.api.v1.scheduling.groups.form.$post({ json: { academicYearId: yearId, commit: false, weeklyPeriods: 1 } }));
    const mine = preview.groups.filter((g) => [maths, bio, arabic].includes(g.subject.id));
    expect(mine.map((g) => [g.name, g.unit?.code ?? null, g.delivery, g.providerTaught, g.adding.length]).sort()).toEqual([
      ['Arabic W', null, 'in_school', true, 1],
      ['Biology W — ' + name('a'), null, 'in_school', false, 2],
      ['Biology W — ' + name('c'), null, 'online', false, 1],
      ['Maths W P1 (no teacher yet)', 'P1', 'in_school', false, 1],
      ['Maths W P1 — ' + name('a'), 'P1', 'in_school', false, 3],
      ['Maths W P1 — ' + name('b'), 'P1', 'in_school', false, 1],
      ['Maths W P2', 'P2', 'in_school', false, 2],
    ]);
    await apiResponse(coordinator.api.v1.scheduling.groups.form.$post({ json: { academicYearId: yearId, commit: true, weeklyPeriods: 1 } }));
    for (const g of await groups()) gid[g.name] = g.id;
    const listed = await groups();
    expect(listed.find((g) => g.name === 'Arabic W')).toMatchObject({ providerTaught: true, cards: 0, weeklyPeriods: 0, unitId: null });
    expect(listed.find((g) => g.name === 'Maths W P1 — ' + name('a'))).toMatchObject({ unitId: p1, unit: { shortCode: 'P1' }, delivery: 'in_school' });
    expect(listed.find((g) => g.name === 'Biology W — ' + name('c'))).toMatchObject({ delivery: 'online', roomId: null, roomType: null });
    // A provider teaches outside the timetable: no weekly periods, and no group with published lessons is given to one.
    expect(await refused(coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: gid['Arabic W']! }, json: { weeklyPeriods: 2 } })))
      .toEqual({ status: 400, error: 'A provider teaches outside the timetable: its group has no lessons, so no weekly periods' });
    // An online group takes no room.
    expect(await refused(coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: gid['Biology W — ' + name('c')]! }, json: { roomType: 'science_lab' } })))
      .toEqual({ status: 400, error: 'An online group takes no room: leave its room needs empty' });

    // The first timetable: every lesson by hand at its own slot (the homeroom with Maths P1 — A).
    gid['Provider later'] = (await apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: yearId, name: 'Provider later', subjectId: arabic, teacherId: t.a!.id, weeklyPeriods: 1, doublePeriods: 0 } }))).id;
    v1 = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'RW — first' } }))).id;
    expect((await load(v1)).engine.lessons.filter((l) => l.groupId === gid['Provider later'])).toHaveLength(1);
    // Given to the provider before any version holds it: its card leaves the draft.
    await apiResponse(coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: gid['Provider later']! }, json: { teacherId: t.p!.id } }));
    const tt = await load(v1);
    expect(tt.engine.lessons.filter((l) => l.groupId === gid['Provider later'])).toEqual([]);
    expect(tt.engine.lessons.filter((l) => l.groupId === gid['Arabic W'])).toEqual([]);
    expect(tt.engine.groups.find((g) => g.id === gid['Biology W — ' + name('c')])).toMatchObject({ noRoom: true });
    await place(v1, 'Maths W P1 — ' + name('a'), 0, 1);
    await place(v1, 'Homeroom RW-X', 0, 1);
    await place(v1, 'Maths W P1 — ' + name('b'), 0, 2);
    await place(v1, 'Maths W P1 (no teacher yet)', 0, 3);
    await place(v1, 'Maths W P2', 1, 1);
    await place(v1, 'Biology W — ' + name('a'), 1, 2);
    const online = await place(v1, 'Biology W — ' + name('c'), 1, 3);
    expect(online.roomId).toBeNull();
    const after = await load(v1);
    expect(after.clashes).toEqual([]);
    expect(after.engine.lessons.find((l) => l.groupId === gid['Maths W P2'])!.roomId).not.toBeNull();
    await apiResponse(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: v1 }, json: { effectiveFrom: D0 } }));
    // The provider's group is in no timetable; the online lesson is held without a room.
    const day = await apiResponse(coordinator.api.v1.schedule.day.$get({ query: { studentId: s['4']!.studentId, date: plus(D0, 1) } }));
    expect(day.lessons.map((l) => [l.groupName, l.room, l.delivery])).toEqual([['Biology W — ' + name('c'), null, 'online']]);
    // The family's phone calendar says where it is held: online.
    const link = await apiResponse(s['4']!.student.api.v1.schedule.feed.$post());
    const ics = await (await s['4']!.student.api.v1.ical[':token'].$get({ param: { token: link.path.split('/').pop()! } })).text();
    expect(ics).toContain(`SUMMARY:Biology W — ${name('c')}`);
    expect(ics).toContain('LOCATION:Online');
    const arabicDay = await apiResponse(coordinator.api.v1.schedule.week.$get({ query: { studentId: s['6']!.studentId, date: D0 } }));
    expect(arabicDay.days.flatMap((d) => d.lessons)).toEqual([]);
    // A student in two units of one subject is a member of both groups: each counts them, and their
    // week has both (one unit's membership does not end the other's on a shared day).
    const sizes = Object.fromEntries((await groups()).map((g) => [g.name, g.size]));
    expect([sizes['Maths W P1 — ' + name('a')], sizes['Maths W P2']]).toEqual([3, 2]);
    const week1 = await apiResponse(coordinator.api.v1.schedule.week.$get({ query: { studentId: s['1']!.studentId, date: D0 } }));
    expect(week1.days.flatMap((d) => d.lessons.map((l) => l.groupName)).filter((n) => n.startsWith('Maths')).sort()).toEqual(['Maths W P1 — ' + name('a'), 'Maths W P2']);
    // A group with published lessons is not given to a provider.
    expect(await refused(coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: gid['Biology W — ' + name('a')]! }, json: { teacherId: t.p!.id, teacherFrom: D0 } })))
      .toEqual({ status: 409, error: expect.stringMatching(/^Biology W — .* has lessons in RW — first: a provider teaches outside the timetable/) });
  });

  // ─── §10: a line's teacher reaches the group, with its unit ────────────────

  it("a line's teacher changed at the desk reaches the group of its unit: the student moves to the new teacher's P1 group from today, their P2 group stays", async () => {
    clockAt(D1);
    const r = await apiResponse(putTeacher(officer, line['2:p1']!, { teacherId: t.b!.id, reason: 'the family asked at the desk' }));
    expect(r).toMatchObject({ teacherId: t.b!.id, enrolmentsUpdated: 1, enrolmentsCreated: 0 });
    expect(await enrolmentOf('2', p1)).toEqual({ teacher_id: t.b!.id, mode: 'in_school' });
    expect(await enrolmentOf('2', p2)).toEqual({ teacher_id: t.a!.id, mode: 'in_school' });
    expect(await membershipsOf('2')).toEqual([
      { group: 'Maths W P1 — ' + name('b'), started_on: D1 },
      { group: 'Maths W P2', started_on: D0 },
    ]);
    // The weeks before keep their group.
    expect(await one(`select m.ended_on from teaching_group_member m where m.student_id = $1 and m.group_id = $2`, [s['2']!.studentId, gid['Maths W P1 — ' + name('a')]]))
      .toEqual({ ended_on: plus(D1, -1) });
    // The move is audited in the change's transaction.
    expect(await one(`select new_data->>'followed' as followed, new_data->>'fromGroupId' as from_group from audit_log
      where action = 'TEACHING_GROUP_MEMBERS_ADDED' and entity_id = $1 and new_data->'studentIds' ? $2`, [gid['Maths W P1 — ' + name('b')], s['2']!.studentId]))
      .toEqual({ followed: 'enrolment', from_group: gid['Maths W P1 — ' + name('a')] });
  });

  it('a teacher replaced on an offer moves one unit’s members and not the other’s: the June P1 group, all its members now with the new teacher, takes them from today; the winter P2 group keeps its teacher', async () => {
    const r = await apiResponse(coordinator.api.v1.sessions[':id'].offers[':offerId']['replace-teacher'].$post({
      param: { id: june, offerId: mathsJune.id }, json: { fromTeacherId: t.a!.id, toTeacherId: t.c!.id, reason: 'teacher A teaches the winter only now' },
    }));
    expect(r).toMatchObject({ lines: 2, enrolments: 2 });
    expect(r.groupsFollowed).toMatchObject({ groupsGiven: [{ groupId: gid['Maths W P1 — ' + name('a')], teacherId: t.c!.id }], moved: [], waiting: [] });
    expect(await enrolmentOf('1', p1)).toMatchObject({ teacher_id: t.c!.id });
    expect(await enrolmentOf('7', p1)).toMatchObject({ teacher_id: t.c!.id });
    expect(await enrolmentOf('1', p2)).toMatchObject({ teacher_id: t.a!.id });
    // The P1 group's teacher is dated: A until yesterday, C from today; P2's is still A.
    expect(await sql(`select teacher_id, started_on, ended_on from teaching_group_teacher where group_id = $1 order by started_on`, [gid['Maths W P1 — ' + name('a')]]))
      .toEqual([{ teacher_id: t.a!.id, started_on: D0, ended_on: plus(D1, -1) }, { teacher_id: t.c!.id, started_on: D1, ended_on: null }]);
    expect(await one(`select teacher_id from teaching_group where id = $1`, [gid['Maths W P2']])).toEqual({ teacher_id: t.a!.id });
    expect(await membershipsOf('1')).toEqual([
      { group: 'Biology W — ' + name('a'), started_on: D0 },
      { group: 'Maths W P1 — ' + name('a'), started_on: D0 },
      { group: 'Maths W P2', started_on: D0 },
    ]);
    // Each enrolment moved has its own audit row.
    expect(Number((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'ENROLMENT_UPDATED' and new_data->>'sourceRef' = $1`, [`replace-teacher:${mathsJune.id}`])).n)).toBe(2);
    // The student's day: C teaches P1 now, A taught it the week before.
    const lessonsOn = async (date: string) => (await apiResponse(coordinator.api.v1.schedule.day.$get({ query: { studentId: s['7']!.studentId, date } }))).lessons.map((l) => l.teacher?.id);
    expect(await lessonsOn(D1)).toEqual([t.c!.id]);
    expect(await lessonsOn(plus(D1, -7))).toEqual([t.a!.id]);
  });

  it('"no preference" assigned later on Teaching groups: listed with the teachers its line may take; a teacher the line may not take is refused by name; then the line, the enrolment and the group take the teacher', async () => {
    const w = await waiting();
    const nt = w.noTeacher.find((x) => x.subjectId === maths && x.unitId === p1)!;
    expect(nt).toMatchObject({ subject: 'Maths W P1', students: [{ studentId: s['5']!.studentId, lines: 1 }] });
    expect(nt.teachers.map((x) => x.id).sort()).toEqual([t.b!.id, t.c!.id].sort());
    const assign = (teacherId: string) => coordinator.api.v1.scheduling.groups['assign-teacher'].$post({
      json: { academicYearId: yearId, subjectId: maths, unitId: p1, studentIds: [s['5']!.studentId], teacherId, reason: 'assigned to the morning set' },
    });
    const no = await apiResponse(assign(t.a!.id));
    expect(no).toMatchObject({ assigned: [], refused: [{ studentId: s['5']!.studentId, name: `Student rw-5-${RUN}`, registrationId: line['5:p1'], why: 'That teacher does not teach Maths W — P1 this cycle: choose one of the subject\'s teachers on the session' }] });
    expect(await enrolmentOf('5', p1)).toEqual({ teacher_id: null, mode: 'in_school' });
    const yes = await apiResponse(assign(t.b!.id));
    expect(yes).toMatchObject({ assigned: [{ studentId: s['5']!.studentId, registrationId: line['5:p1'] }], refused: [] });
    expect(await one(`select teacher_id from registration where id = $1`, [line['5:p1']])).toEqual({ teacher_id: t.b!.id });
    expect(await enrolmentOf('5', p1)).toEqual({ teacher_id: t.b!.id, mode: 'in_school' });
    // Its group had only them: it takes the teacher and their name.
    expect(yes.followed.groupsGiven).toEqual([{ groupId: gid['Maths W P1 (no teacher yet)'], groupName: 'Maths W P1 — ' + name('b') + ' (2)', teacherId: t.b!.id }]);
    expect(await one(`select name, teacher_id from teaching_group where id = $1`, [gid['Maths W P1 (no teacher yet)']])).toEqual({ name: 'Maths W P1 — ' + name('b') + ' (2)', teacher_id: t.b!.id });
    expect(await sql(`select action from audit_log where entity_id = $1 and action in ('LINE_TEACHER_CHANGED') order by created_at`, [line['5:p1']])).toEqual([{ action: 'LINE_TEACHER_CHANGED' }]);
    expect((await waiting()).noTeacher.filter((x) => x.subjectId === maths)).toEqual([]);
  });

  it('with no group of the new teacher the student stays where they are and is listed; the coordinator makes the group and Moves them (guarded)', async () => {
    const r = await apiResponse(putTeacher(coordinator, line['1:bio']!, { teacherId: t.d!.id, reason: 'moved to teacher D' }));
    expect(r.teacherId).toBe(t.d!.id);
    expect(await enrolmentOf('1', null)).toMatchObject({ teacher_id: t.d!.id });
    expect((await membershipsOf('1')).map((m) => m.group)).toContain('Biology W — ' + name('a'));
    const listed = (await waiting()).students.find((x) => x.studentId === s['1']!.studentId)!;
    expect(listed).toMatchObject({ subject: 'Biology W', group: 'Biology W — ' + name('a'), enrolledTeacherId: t.d!.id, target: null });
    const made = await apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: yearId, name: 'Biology W — ' + name('d'), subjectId: bio, teacherId: t.d!.id, weeklyPeriods: 1, doublePeriods: 0 } }));
    gid['Biology W — ' + name('d')] = made.id;
    expect((await waiting()).students.find((x) => x.studentId === s['1']!.studentId)!.target).toEqual({ id: made.id, name: 'Biology W — ' + name('d') });
    await apiResponse(coordinator.api.v1.scheduling.groups[':id'].members.$post({ param: { id: made.id }, json: { studentIds: [s['1']!.studentId] } }));
    expect((await waiting()).students.filter((x) => x.studentId === s['1']!.studentId)).toEqual([]);
  });

  it('a move that would clash in the published timetable is not made: the desk’s change stands, the student stays in their group and is listed with the clash', async () => {
    // Student 3 moves to teacher C, whose P1 group meets at the time of their homeroom.
    const r = await putTeacher(officer, line['3:p1']!, { teacherId: t.c!.id, reason: 'the family asked for C' });
    expect(r.status).toBe(200);
    const body = await apiResponse(Promise.resolve(r));
    expect(await enrolmentOf('3', p1)).toMatchObject({ teacher_id: t.c!.id });
    expect((await membershipsOf('3')).map((m) => m.group)).toEqual(['Maths W P1 — ' + name('b')]);
    expect(body.enrolmentsUpdated).toBe(1);
    // The desk is told why the group did not follow: the clash, without the confirmation the
    // coordinator's Move asks for (and without its code).
    expect(body.groupsFollowed?.waiting).toEqual([expect.objectContaining({ studentId: s['3']!.studentId, groupName: 'Maths W P1 — ' + name('b'), teacherId: t.c!.id })]);
    const why = body.groupsFollowed!.waiting[0]!.why;
    expect(why).toMatch(new RegExp(`^It would clash in the published timetable: Student rw-3-${RUN} would be in Homeroom RW-X and Maths W P1 — ${name('a')} at Sunday period 1`));
    expect(why).not.toMatch(/confirm/);
    const listed = (await waiting()).students.find((x) => x.studentId === s['3']!.studentId)!;
    expect(listed).toMatchObject({ group: 'Maths W P1 — ' + name('b'), enrolledTeacherId: t.c!.id, target: { id: gid['Maths W P1 — ' + name('a')] } });
    // The coordinator's Move shows the clash and its confirmation.
    const move = await refused(coordinator.api.v1.scheduling.groups[':id'].members.$post({ param: { id: gid['Maths W P1 — ' + name('a')]! }, json: { studentIds: [s['3']!.studentId] } }));
    expect(move.status).toBe(409);
    expect(move.error).toMatch(new RegExp(`^In the published timetable, this would add a clash: Student rw-3-${RUN} would be in Homeroom RW-X and Maths W P1 — ${name('a')} at Sunday period 1`));
  });

  it('self-study now: the student leaves the group after today (a retake taken outside school, price unchanged)', async () => {
    const before = await one<{ price: string }>(`select price_at_registration as price from registration where id = $1`, [line['8:bio']]);
    await apiResponse(putTeacher(coordinator, line['8:bio']!, { teacherId: null, mode: 'self_study', reason: 'studies alone from now' }));
    expect(await enrolmentOf('8', null)).toEqual({ teacher_id: null, mode: 'self_study' });
    expect(await membershipsOf('8')).toEqual([]);
    expect(await one(`select m.ended_on, m.end_reason from teaching_group_member m where m.student_id = $1 and m.group_id = $2`, [s['8']!.studentId, gid['Biology W — ' + name('a')]]))
      .toEqual({ ended_on: D1, end_reason: 'Now studies this subject alone' });
    expect(await one(`select price_at_registration as price from registration where id = $1`, [line['8:bio']])).toEqual(before);
  });

  it('checkEnrolments per unit: a unit line against its unit’s enrolment; a subject held whole and by its units at once is flagged with the fix', async () => {
    const check = () => apiResponse(coordinator.api.v1.enrolments.check.$get({ query: { academicYearId: yearId, studentId: s['2']!.studentId } }));
    const clean = await check();
    expect(clean.registeredNotEnrolled).toEqual([]);
    expect(clean.subjectAndUnit).toEqual([]);
    const whole = await apiResponse(coordinator.api.v1.enrolments.$post({ json: { academicYearId: yearId, studentId: s['2']!.studentId, subjectId: maths, teacherId: t.a!.id, mode: 'in_school' } }));
    const flagged = await check();
    expect(flagged.subjectAndUnit).toEqual([expect.objectContaining({
      subjectName: 'Maths W', unitId: null, enrolmentId: whole.id, units: ['P1', 'P2'],
      fix: 'End the enrolment in Maths W as a whole (the units P1, P2 replace it), or end the unit enrolments if the subject is taught whole',
    })]);
    expect(flagged.enrolledNotRegistered.map((f) => [f.subjectName, f.unitCode])).toEqual([['Maths W', null]]);
    await apiResponse(coordinator.api.v1.enrolments[':id'].end.$post({ param: { id: whole.id }, json: { reason: 'the units replace it' } }));
    expect((await check()).subjectAndUnit).toEqual([]);
  });

  // ─── Round two, flag 1: dated teacher clashes across intervals ─────────────

  it('a teacher change dated inside a draft’s time is a clash from that day: the grid shows it, publishing refuses it, the generator keeps the two apart', async () => {
    const D2 = plus(D1, 14);
    const mk = async (n: string, teacher: string) => (await apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: yearId, name: n, teacherId: t[teacher]!.id, weeklyPeriods: 1, doublePeriods: 0 } }))).id;
    gid['Dated A'] = await mk('Dated A', 'e');
    gid['Dated B'] = await mk('Dated B', 'g');
    const v2 = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'RW — dated', copyFromId: v1 } }))).id;
    gid.v2 = v2;
    await place(v2, 'Dated A', 2, 3);
    await place(v2, 'Dated B', 2, 3);
    expect((await load(v2)).clashes).toEqual([]);
    // B's teacher becomes A's teacher from D2: the two lessons meet from then.
    await apiResponse(coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: gid['Dated B']! }, json: { teacherId: t.e!.id, teacherFrom: D2 } }));
    const tt = await load(v2);
    const message = `${name('e')} teaches Dated A and Dated B at Tuesday P3 from ${readable(D2)}`;
    expect(tt.clashes.map((c) => [c.kind, c.message])).toEqual([['teacher_busy', message]]);
    const [oa, ob] = [gid['Dated A']!, gid['Dated B']!].sort();
    expect(tt.engine.teacherOverlaps).toEqual([{ a: oa, b: ob, teacherId: t.e!.id, from: D2 }]);
    expect(await refused(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: v2 }, json: { effectiveFrom: D1, acceptUnplaced: true } })))
      .toEqual({ status: 409, error: `Resolve the clashes before publishing (1): ${message}` });
    // A move is judged the same way by the server (the editor's cells from the same engine).
    const b = await lessonOf(v2, 'Dated B');
    await apiResponse(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({ param: { id: v2, lessonId: b.id }, json: { weekday: 2, period: 4, from: { weekday: 2, period: 3 } } }));
    expect((await load(v2)).clashes).toEqual([]);
    expect(await refused(coordinator.api.v1.timetables[':id'].lessons[':lessonId'].move.$post({ param: { id: v2, lessonId: b.id }, json: { weekday: 2, period: 3, from: { weekday: 2, period: 4 } } })))
      .toEqual({ status: 409, error: `It would clash: ${message}` });
    await apiResponse(coordinator.api.v1.timetables[':id'].generate.$post({ param: { id: v2 }, json: { iterations: 20_000 } }));
    const gen = await load(v2);
    expect(gen.clashes).toEqual([]);
    const [la, lb] = [await lessonOf(v2, 'Dated A'), await lessonOf(v2, 'Dated B')];
    expect(la.weekday !== lb.weekday || la.period !== lb.period).toBe(true);
  });

  // ─── Round two, flag 2: carried cover judged again ─────────────────────────

  it('publishing judges each cover it carries over inside the same transaction: a cover teacher who now teaches then loses it, is told, and the confirmation lists it', async () => {
    const D3 = plus(D1, 21);
    // Teacher B is away; teacher C (who teaches Maths, free then) covers Maths P1 — B that Sunday.
    await apiResponse(coordinator.api.v1.cover.absences.$post({ json: { teacherId: t.b!.id, startsOn: D3, endsOn: D3, reason: 'training' } }));
    const lesson = await lessonOf(v1, 'Maths W P1 — ' + name('b'));
    const cover = await apiResponse(coordinator.api.v1.cover.assignments.$post({ json: { lessonId: lesson.id, date: D3, coverTeacherId: t.c!.id } }));
    // A new version gives teacher C a lesson of their own at that time.
    gid['Cover clash'] = (await apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: yearId, name: 'Cover clash', teacherId: t.c!.id, weeklyPeriods: 1, doublePeriods: 0 } }))).id;
    const v3 = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'RW — second', copyFromId: v1 } }))).id;
    await place(v3, 'Cover clash', 0, 2);
    const published = await apiResponse(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: v3 }, json: { effectiveFrom: D1, acceptUnplaced: true } }));
    expect(published.coversMoved).toEqual([]);
    expect(published.coversRemoved).toEqual([expect.objectContaining({ id: cover.id, groupName: 'Maths W P1 — ' + name('b'), date: D3 })]);
    const row = await one<{ status: string; removal: string; reason: string }>(`select status, removal, remove_reason as reason from cover_assignment where id = $1`, [cover.id]);
    expect(row).toMatchObject({ status: 'removed', removal: 'no_longer_holds' });
    expect(row.reason).toMatch(/^RW — second takes effect from /);
    expect(row.reason).toContain(`: ${name('c')} teaches Cover clash then`);
    expect(Number((await one<{ n: string }>(`select count(*) as n from audit_log where action = 'COVER_REMOVED' and entity_id = $1`, [cover.id])).n)).toBe(1);
    await notified(t.c!.c.email, 'COVER_CHANGED', 1);
    gid.v3 = v3;
  });

  it("a group's teacher changed from a day: the cover arranged for its old teacher's absence from then is judged again and goes (its teacher that day is not away)", async () => {
    const D4 = plus(D1, 22); // a Monday
    await apiResponse(coordinator.api.v1.cover.absences.$post({ json: { teacherId: t.c!.id, startsOn: D4, endsOn: D4, reason: 'training' } }));
    const lesson = await lessonOf(gid.v3!, 'Biology W — ' + name('c'));
    const cover = await apiResponse(coordinator.api.v1.cover.assignments.$post({ json: { lessonId: lesson.id, date: D4, coverTeacherId: t.d!.id } }));
    const r = await apiResponse(coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: gid['Biology W — ' + name('c')]! }, json: { teacherId: t.j!.id, teacherFrom: D1 } }));
    expect(r.coversLost).toEqual([expect.objectContaining({ id: cover.id })]);
    expect(await one(`select status, removal from cover_assignment where id = $1`, [cover.id])).toEqual({ status: 'removed', removal: 'no_longer_holds' });
    expect((await one<{ r: string }>(`select remove_reason as r from cover_assignment where id = $1`, [cover.id])).r).toContain(`its teacher that day, ${name('j')}, is not recorded as away then`);
    await notified(t.d!.c.email, 'COVER_CHANGED', 1);
  });

  // ─── Round two, flag 3: locks and races (RESERVATIONS.md §2.1's order, F1's at its end) ──

  it('a teacher change and a publication at once, publishing first: the change sees the new version and is refused with the clash', async () => {
    const x1 = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Race X1 ${RUN}` } })))!.id;
    const x2 = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Race X2 ${RUN}` } })))!.id;
    const mk = async (n: string, teacherId: string) => (await apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: yearId, name: n, teacherId, weeklyPeriods: 1, doublePeriods: 0 } }))).id;
    gid['Race R1'] = await mk('Race R1', x1);
    gid['Race R2'] = await mk('Race R2', x2);
    const v4 = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'RW — race 1', copyFromId: gid.v3! } }))).id;
    await place(v4, 'Race R1', 3, 4);
    await place(v4, 'Race R2', 3, 4);
    const release = await holdRowLock('academic_term', termId);
    const publish = coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: v4 }, json: { effectiveFrom: D1, acceptUnplaced: true } });
    await lockWaiters(1);
    const change = coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: gid['Race R2']! }, json: { teacherId: x1, teacherFrom: D1 } });
    await lockWaiters(2);
    await release();
    const [p, c] = await Promise.all([publish, change]);
    expect(p.status).toBe(200);
    const no = await refused(Promise.resolve(c));
    expect(no.status).toBe(409);
    expect(no.error).toMatch(new RegExp(`^In the published timetable, this would add a clash: Race X1 ${RUN} would teach Race R1 and Race R2 at Wednesday period 4`));
    expect(await one(`select teacher_id from teaching_group where id = $1`, [gid['Race R2']])).toEqual({ teacher_id: x2 });
    gid.v4 = v4;
  });

  it('a teacher change and a publication at once, the change first: the publication sees the change and is refused with the clash', async () => {
    const x3 = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Race X3 ${RUN}` } })))!.id;
    const x4 = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Race X4 ${RUN}` } })))!.id;
    const mk = async (n: string, teacherId: string) => (await apiResponse(coordinator.api.v1.scheduling.groups.$post({ json: { academicYearId: yearId, name: n, teacherId, weeklyPeriods: 1, doublePeriods: 0 } }))).id;
    gid['Race R3'] = await mk('Race R3', x3);
    gid['Race R4'] = await mk('Race R4', x4);
    const v5 = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'RW — race 2', copyFromId: gid.v4! } }))).id;
    await place(v5, 'Race R3', 3, 3);
    await place(v5, 'Race R4', 3, 3);
    const release = await holdRowLock('academic_term', termId);
    const change = coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: gid['Race R4']! }, json: { teacherId: x3, teacherFrom: D1 } });
    await lockWaiters(1);
    const publish = coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: v5 }, json: { effectiveFrom: D1, acceptUnplaced: true } });
    await lockWaiters(2);
    await release();
    const [c, p] = await Promise.all([change, publish]);
    expect(c.status).toBe(200);
    expect(await refused(Promise.resolve(p))).toEqual({ status: 409, error: `Resolve the clashes before publishing (1): Race X3 ${RUN} teaches Race R3 and Race R4 at Wednesday P3` });
    expect(await one(`select status from timetable where id = $1`, [v5])).toEqual({ status: 'draft' });
  });

  it('two teacher changes giving one teacher two lessons at once in a published timetable: the second waits for the first and is refused', async () => {
    // Race R1 (X1) and Race R2 (X2) meet on Wednesday at period 4 in the version in force; a third teacher for both at once.
    const x5 = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Race X5 ${RUN}` } })))!.id;
    const release = await holdRowLock('teacher', x5);
    const first = coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: gid['Race R1']! }, json: { teacherId: x5, teacherFrom: D1 } });
    await lockWaiters(1);
    const second = coordinator.api.v1.scheduling.groups[':id'].$put({ param: { id: gid['Race R2']! }, json: { teacherId: x5, teacherFrom: D1 } });
    await lockWaiters(2);
    await release();
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(200);
    const no = await refused(Promise.resolve(b));
    expect(no.status).toBe(409);
    expect(no.error).toMatch(new RegExp(`^In the published timetable, this would add a clash: Race X5 ${RUN} would teach Race R1 and Race R2 at Wednesday period 4`));
    expect(await sql(`select id from teaching_group where teacher_id = $1 order by id`, [x5])).toEqual([{ id: gid['Race R1'] }]);
  });

  it('forming takes the students it adds first: a student added to another group while forming is held waits, then is moved — no second open group, no refusal', async () => {
    await apiResponse(coordinator.api.v1.enrolments.$post({ json: { academicYearId: yearId, studentId: s['9']!.studentId, subjectId: bio, teacherId: t.a!.id, mode: 'in_school' } }));
    const pause = await pauseAtAudits(['TEACHING_GROUPS_FORMED']);
    try {
      const form = coordinator.api.v1.scheduling.groups.form.$post({ json: { academicYearId: yearId, commit: true } });
      await pause.paused('TEACHING_GROUPS_FORMED');
      const add = coordinator.api.v1.scheduling.groups[':id'].members.$post({ param: { id: gid['Biology W — ' + name('d')]! }, json: { studentIds: [s['9']!.studentId] } });
      await lockWaiters(2);
      await pause.release('TEACHING_GROUPS_FORMED');
      const [f, a] = await Promise.all([form, add]);
      expect(f.status).toBe(200);
      expect(a.status).toBe(200);
    } finally {
      await pause.releaseAll();
    }
    expect(await membershipsOf('9')).toEqual([{ group: 'Biology W — ' + name('d'), started_on: D1 }]);
    // Forming put them in teacher A's group first; the add moved them the same day (an empty stay).
    expect(await one(`select m.started_on, m.ended_on from teaching_group_member m where m.student_id = $1 and m.group_id = $2`, [s['9']!.studentId, gid['Biology W — ' + name('a')]]))
      .toEqual({ started_on: D1, ended_on: plus(D1, -1) });
  });

  it('a cover assigned while a version is published, publishing first: the old version’s lesson is not held then and the cover is refused', async () => {
    const D5 = plus(D1, 28); // a Sunday
    await apiResponse(coordinator.api.v1.cover.absences.$post({ json: { teacherId: t.b!.id, startsOn: D5, endsOn: D5, reason: 'personal' } }));
    const current = (await apiResponse(coordinator.api.v1.timetables.$get({ query: { termId } }))).find((v) => v.inForce)!.id;
    const lesson = await lessonOf(current, 'Maths W P1 — ' + name('b'));
    const v6 = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'RW — cover race 1', copyFromId: current } }))).id;
    const release = await holdRowLock('academic_term', termId);
    const publish = coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: v6 }, json: { effectiveFrom: D1, acceptUnplaced: true } });
    await lockWaiters(1);
    const assign = coordinator.api.v1.cover.assignments.$post({ json: { lessonId: lesson.id, date: D5, coverTeacherId: t.i!.id } });
    await lockWaiters(2);
    await release();
    const [p, a] = await Promise.all([publish, assign]);
    expect(p.status).toBe(200);
    expect(await refused(Promise.resolve(a))).toEqual({ status: 404, error: 'That lesson does not take place on that date' });
    gid.v6 = v6;
  });

  it('a cover assigned while a version is published, the cover first: the publication waits for it and carries it over', async () => {
    const D5 = plus(D1, 28);
    const lesson = await lessonOf(gid.v6!, 'Maths W P1 — ' + name('b'));
    const v7 = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'RW — cover race 2', copyFromId: gid.v6! } }))).id;
    const release = await holdRowLock('academic_term', termId);
    const assign = coordinator.api.v1.cover.assignments.$post({ json: { lessonId: lesson.id, date: D5, coverTeacherId: t.a!.id } });
    await lockWaiters(1);
    const publish = coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: v7 }, json: { effectiveFrom: D1, acceptUnplaced: true } });
    await lockWaiters(2);
    await release();
    const [a, p] = await Promise.all([assign, publish]);
    expect(a.status).toBe(201);
    const published = await apiResponse(Promise.resolve(p));
    const coverId = (await apiResponse(Promise.resolve(a))).id;
    expect(published.coversMoved).toEqual([expect.objectContaining({ id: coverId })]);
    expect(await one(`select timetable_id, status from cover_assignment where id = $1`, [coverId])).toEqual({ timetable_id: v7, status: 'assigned' });
  });

  it('a line’s teacher changed (the group follows) while the coordinator adds the same student elsewhere: one after the other, no deadlock, one open P1 group', async () => {
    const release = await holdRowLock('"user"', s['7']!.studentId);
    const change = putTeacher(officer, line['7:p1']!, { teacherId: t.b!.id, reason: 'the family asked for B' });
    await lockWaiters(1);
    const add = coordinator.api.v1.scheduling.groups[':id'].members.$post({ param: { id: gid['Maths W P1 (no teacher yet)']! }, json: { studentIds: [s['7']!.studentId] } });
    await lockWaiters(2);
    await release();
    const [c, a] = await Promise.all([change, add]);
    expect(c.status).toBe(200);
    expect([200, 409]).toContain(a.status);
    expect((await membershipsOf('7')).filter((m) => m.group.startsWith('Maths W P1')).length).toBe(1);
  });

  it('forming reads its students again under their locks: a student moved into a group while forming waited stays there — no refusal, no second group', async () => {
    const f = await onboard(officer, `rw-10-${RUN}`, 11);
    s['10'] = f;
    await apiResponse(adm.api.v1.students[':id'].cohort.$put({ param: { id: f.studentId }, json: { cohortYear: Y - 1, reason: 'F1 rework scenario year' } }));
    await apiResponse(coordinator.api.v1.enrolments.$post({ json: { academicYearId: yearId, studentId: f.studentId, subjectId: bio, teacherId: t.a!.id, mode: 'in_school' } }));
    const release = await holdRowLock('"user"', f.studentId);
    const add = coordinator.api.v1.scheduling.groups[':id'].members.$post({ param: { id: gid['Biology W — ' + name('d')]! }, json: { studentIds: [f.studentId] } });
    await lockWaiters(1);
    const form = coordinator.api.v1.scheduling.groups.form.$post({ json: { academicYearId: yearId, commit: true } });
    await lockWaiters(2);
    await release();
    const [a, fm] = await Promise.all([add, form]);
    expect(a.status).toBe(200);
    expect(fm.status).toBe(200);
    expect((await apiResponse(Promise.resolve(fm))).added).toBe(0);
    expect(await membershipsOf('10')).toEqual([{ group: 'Biology W — ' + name('d'), started_on: D1 }]);
  });

  // ─── Round two, flag 4: one generation per draft; a cancelled request writes nothing ──

  it('a second generation of a draft while one runs is refused; a request cancelled while the generator runs writes nothing', async () => {
    const v2 = gid.v2!;
    const { default: pg } = await import('pg');
    const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
    try {
      await other.query('select pg_advisory_lock(hashtext($1))', [`timetable-generate:${v2}`]);
      expect(await refused(coordinator.api.v1.timetables[':id'].generate.$post({ param: { id: v2 }, json: { iterations: 1000 } })))
        .toEqual({ status: 409, error: 'The generator is already running on this draft — wait for it to finish, then look again' });
    } finally {
      await other.query('select pg_advisory_unlock(hashtext($1))', [`timetable-generate:${v2}`]);
      await other.end();
    }
    const before = await one<{ revision: number; runs: string }>(`select t.revision, (select count(*) from timetable_generation_run r where r.timetable_id = t.id)::text as runs from timetable t where t.id = $1`, [v2]);
    const lessonsBefore = await sql(`select id, weekday, period, room_id from timetable_lesson where timetable_id = $1 order by id`, [v2]);
    const cancel = new AbortController();
    const run = coordinator.api.v1.timetables[':id'].generate.$post({ param: { id: v2 }, json: { iterations: 4_000_000 } }, { init: { signal: cancel.signal } });
    setTimeout(() => cancel.abort(), 300);
    const r = await refused(run);
    expect(r).toEqual({ status: 409, error: 'The request was cancelled while the generator ran, so nothing was written' });
    expect(await one(`select t.revision, (select count(*) from timetable_generation_run r where r.timetable_id = t.id)::text as runs from timetable t where t.id = $1`, [v2])).toEqual(before);
    expect(await sql(`select id, weekday, period, room_id from timetable_lesson where timetable_id = $1 order by id`, [v2])).toEqual(lessonsBefore);
    // The lock went with the request: the next run goes ahead.
    expect((await coordinator.api.v1.timetables[':id'].generate.$post({ param: { id: v2 }, json: { iterations: 1000 } })).status).toBe(200);
  });

  // ─── Round two, flag 5: the roll-over into a year with a published timetable ──

  it("rolling sections into a year with a published timetable is checked as any move: refused with the clash and its code, then recorded when the coordinator confirms exactly those", async () => {
    const prev = (await apiResponse(coordinator.api.v1.academic.years.$post({ json: { startYear: Y - 1, startsOn: `${Y - 1}-09-06`, endsOn: `${Y}-06-25` } }))).id;
    const tenA = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: prev, grade: 10, name: '10RW' } }))).id;
    await apiResponse(coordinator.api.v1.academic.sections[':id'].members.$post({ param: { id: tenA }, json: { studentIds: [s['4']!.studentId], startsOn: `${Y - 1}-09-06` } }));
    const elevenA = (await apiResponse(coordinator.api.v1.academic.sections.$post({ json: { academicYearId: yearId, grade: 11, name: '11RW' } }))).id;
    const hallTeacher = (await apiResponse(adm.api.v1.teachers.$post({ json: { name: `Hall teacher ${RUN}` } })))!.id;
    const hall = await apiResponse(coordinator.api.v1.scheduling.groups.sections.$post({ json: { academicYearId: yearId, sectionIds: [elevenA], name: 'Hall', teacherId: hallTeacher, weeklyPeriods: 1, doublePeriods: 0 } }));
    gid.hall = hall.created[0]!.id;
    const current = (await apiResponse(coordinator.api.v1.timetables.$get({ query: { termId } }))).find((v) => v.inForce)!.id;
    const v8 = (await apiResponse(coordinator.api.v1.timetables.$post({ json: { termId, name: 'RW — hall', copyFromId: current } }))).id;
    // The hall meets when student 4 has Biology online.
    await place(v8, 'Hall 11RW', 1, 3);
    await apiResponse(coordinator.api.v1.timetables[':id'].publish.$post({ param: { id: v8 }, json: { effectiveFrom: D1, acceptUnplaced: true } }));
    const roll = (json: { anyway?: boolean; clashToken?: string }) => coordinator.api.v1.academic.sections['roll-over'].$post({ json: { fromAcademicYearId: prev, toAcademicYearId: yearId, commit: true, ...json } });
    const no = await refused(roll({}));
    expect(no.status).toBe(409);
    expect(no.error).toMatch(new RegExp(`^In the published timetable, this would add a clash: Student rw-4-${RUN} would be in Biology W — ${name('c')} and Hall 11RW at Monday period 3`));
    expect(await sql(`select id from section_membership where section_id = $1`, [elevenA])).toEqual([]);
    const code = no.error.match(/\[confirm ([0-9a-f]+)\]$/)![1]!;
    expect((await refused(roll({ anyway: true }))).status).toBe(409);
    const went = await apiResponse(roll({ anyway: true, clashToken: code }));
    expect(went).toMatchObject({ studentsMoved: 1, clashesAccepted: [expect.stringMatching(new RegExp(`^Student rw-4-${RUN} would be in Biology W`))] });
    const listed = (await apiResponse(coordinator.api.v1.timetables.clashes.$get({ query: { academicYearId: yearId } }))).find((c) => c.person === `Student rw-4-${RUN}`)!;
    expect(listed).toMatchObject({ kind: 'students_busy', cause: expect.stringMatching(/^Rolled into /), stillHappens: true });
  });
});
