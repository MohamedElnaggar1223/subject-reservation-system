/**
 * F4's demo data for a running dev system (docs/features/EXAM_ENTRIES.md, "Running it"), on the
 * coordinator's model (COORDINATOR_REWORK.md, P1c): staff, the catalogue's components and option
 * codes, a winter session whose rows enter Cambridge IGCSE syllabi (November) and Pearson IAL units
 * (January) at the boards' fees, families reserved and paid at the desk (lines and consent — a
 * declared self-study retake and a declared unit retake among them), a paid cash-in, course enrolment
 * from the lines, candidates, entries, forecasts, the timetable, a seated sitting, and an earlier
 * series' results (which verify a declared sitting) and certificates (made-up names; never the
 * school's sheet).
 *
 * Everything goes through the API over HTTP, as the screens do, but one thing: what a row enters with
 * the board (an award, an option code, units). No route sets it since P1c (the links sheet's item
 * routes left; 0066 kept it on converted rows for the parked exam entries), so the script writes it to
 * the database the API runs on — read from the API's own environment (apps/api/.env: DATABASE_URL), as
 * the June 2027 seed does. The session's rows sit in its own sittings (a session's label names them):
 * Cambridge November 2026 and Pearson January 2027 "exams demo", dated here.
 *
 *   API_URL=http://localhost:3043 WEB_ORIGIN=http://localhost:3040 \
 *     pnpm --filter @repo/api exec tsx scripts/exams-demo/seed-exams.ts
 *
 * Run it once on a fresh copy of the template dev database migrated to the branch.
 */
import { config } from 'dotenv';
import { hc } from 'hono/client';
import { apiResponse } from '@repo/validations';
import type { AppType } from '../../src/app';

config();
// After the environment: @repo/db opens its pool with DATABASE_URL when it is imported.
const { db, sql } = await import('@repo/db');

const API = process.env.API_URL ?? 'http://localhost:3043';
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3040';
const PW = 'TestPass1';
const CONSENT = { refundPolicy: true, declaration: true } as const;

async function signIn(email: string, password = PW) {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`sign-in ${email}: ${res.status} ${await res.text()}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  return hc<AppType>(API, { headers: { Cookie: cookie, Origin: ORIGIN } });
}
type Api = Awaited<ReturnType<typeof signIn>>;
type Line = { offerItemId: string; attempt: 'first' | 'retake'; mode: 'in_school' | 'self_study'; teacherId?: string; priorSitting?: { month: 'january' | 'june' | 'october' | 'november'; year: number } };

const cairoDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
const DAY = 86_400_000;

async function main() {
  const admin = await signIn('admin@igcse.local', 'AdminPass1');
  const officer = await signIn('officer.mona@igcse.local');
  const finadmin = await signIn('finadmin.rana@igcse.local');

  // ─── Staff ─────────────────────────────────────────────────────────────────
  const users = await apiResponse(admin.v1.users.$get({ query: {} }));
  const has = (email: string) => JSON.stringify(users).includes(email);
  for (const [name, email, role] of [
    ['Nadia Samir', 'coord.nadia@igcse.local', 'coordinator'],
    ['Karim Adel', 'teacher.karim@igcse.local', 'teacher'],
    ['Dina Fathy', 'teacher.dina@igcse.local', 'teacher'],
    ['Youssef Hamed', 'teacher.youssef@igcse.local', 'teacher'],
    ['Samir Gaber', 'gate.samir@igcse.local', 'gate'],
  ] as const) {
    if (has(email)) continue;
    await apiResponse(admin.v1.users.$post({ json: { name, email, password: PW, role, newTeacherRecord: role === 'teacher' ? true : undefined } }));
  }
  const coord = await signIn('coord.nadia@igcse.local');
  const teachers = await apiResponse(coord.v1.teachers.$get({ query: {} }));
  const tId = (name: string) => teachers.find((t) => t.name === name)!.id;

  // ─── The year, rooms ───────────────────────────────────────────────────────
  const years = await apiResponse(coord.v1.academic.years.$get());
  const yearId = years.find((y) => y.startYear === 2026)?.id
    ?? (await apiResponse(coord.v1.academic.years.$post({ json: { startYear: 2026, startsOn: '2026-09-06', endsOn: '2027-06-24' } }))).id;
  const rooms = await apiResponse(coord.v1.academic.rooms.$get());
  const room = async (name: string, capacity: number, type: 'hall' | 'classroom' | 'library') =>
    rooms.find((r) => r.name === name)?.id ?? (await apiResponse(coord.v1.academic.rooms.$post({ json: { name, capacity, type, features: [] } }))).id;
  const hall = await room('Main Hall', 80, 'hall');
  const r101 = await room('Room 101', 24, 'classroom');
  await room('Library', 30, 'library');

  // ─── The catalogue: components and option codes (the admin's: G1, the catalogue left the coordinator's screens) ─
  let cat = await apiResponse(admin.v1.catalogue.$get());
  const qual = (code: string) => cat.qualifications.find((q) => q.code === code && q.boardCode === 'cambridge')!;
  const addComponents = async (syllabus: string, papers: [string, string, 'core' | 'extended' | null][], options: [string, string, string[]][]) => {
    const q = qual(syllabus);
    if (q.units.length) return;
    const ids: Record<string, string> = {};
    for (const [n, title, tier] of papers) {
      ids[n] = (await apiResponse(admin.v1.catalogue.units.$post({ json: { boardCode: 'cambridge', code: `${syllabus}/${n}`, shortCode: `Paper ${n}`, title, unitLevel: 'igcse', kind: 'component', tier } }))).id;
    }
    await apiResponse(admin.v1.catalogue.qualifications[':id'].units.$put({ param: { id: q.id }, json: { units: Object.values(ids).map((unitId) => ({ unitId, requirement: 'optional' as const })) } }));
    for (const [code, label, ns] of options) {
      await apiResponse(admin.v1.catalogue.qualifications[':id'].options.$post({ param: { id: q.id }, json: { code, label, unitIds: ns.map((n) => ids[n]!) } }));
    }
  };
  await addComponents('0610', [['12', 'Multiple Choice (Core)', 'core'], ['22', 'Multiple Choice (Extended)', 'extended'], ['32', 'Theory (Core)', 'core'], ['42', 'Theory (Extended)', 'extended'], ['62', 'Alternative to Practical', null]],
    [['BX', 'Extended: Papers 2, 4 and 6', ['22', '42', '62']], ['BC', 'Core: Papers 1, 3 and 6', ['12', '32', '62']]]);
  await addComponents('0620', [['22', 'Multiple Choice (Extended)', 'extended'], ['42', 'Theory (Extended)', 'extended'], ['62', 'Alternative to Practical', null]],
    [['CX', 'Extended: Papers 2, 4 and 6', ['22', '42', '62']]]);
  await addComponents('0580', [['12', 'Paper 1 (Core)', 'core'], ['22', 'Paper 2 (Extended)', 'extended'], ['32', 'Paper 3 (Core)', 'core'], ['42', 'Paper 4 (Extended)', 'extended']],
    [['MX', 'Extended: Papers 2 and 4', ['22', '42']], ['MC', 'Core: Papers 1 and 3', ['12', '32']]]);
  await apiResponse(admin.v1.catalogue.starter.$post({ json: { set: 'pearson_ial_mathematics' } }));
  cat = await apiResponse(admin.v1.catalogue.$get());
  const unit = (code: string) => cat.units.find((u) => u.code === code)!.id;
  const xma = cat.qualifications.find((q) => q.code === 'XMA01')!.id;
  const subjects = await apiResponse(admin.v1.subjects.$get({ query: {} }));
  const sid = (code: string) => subjects.find((s) => s.code === code)?.id;
  // The rework's shape (RESERVATIONS_REWORK.md §3.2): one parent subject, an item per unit.
  const ialMaths = sid('IAL-MATHS') ?? (await apiResponse(admin.v1.subjects.$post({ json: {
    name: 'Mathematics (IAL)', code: 'IAL-MATHS', council: 'pearson_edexcel', courseFee: 2400, registrationFee: 1600, qualificationLevel: 'as_level', isOfferedAtSchool: true, isCore: false,
  } }))).id;
  await apiResponse(admin.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: ialMaths }, json: { boardCode: 'pearson_edexcel', qualificationId: xma, unitIds: [] } }));
  // Cambridge A Level Biology (9700): the A Level in one series (AX) and A2 with the AS carried forward (BY).
  let al = cat.qualifications.find((q) => q.code === '9700' && q.boardCode === 'cambridge' && q.level === 'a_level');
  if (!al) {
    const made = await apiResponse(admin.v1.catalogue.qualifications.$post({ json: { boardCode: 'cambridge', code: '9700', title: 'Biology', level: 'a_level', suite: 'Cambridge International AS & A Level', subjectArea: 'Biology', entryMethod: 'syllabus_option' } }));
    const comp = async (n: string, title: string, unitLevel: 'as' | 'a2') => (await apiResponse(admin.v1.catalogue.units.$post({ json: { boardCode: 'cambridge', code: `9700/${n}`, shortCode: `Paper ${n}`, title, unitLevel, kind: 'component' } }))).id;
    const c = [await comp('12', 'Multiple Choice', 'as'), await comp('22', 'AS Structured Questions', 'as'), await comp('42', 'A Level Structured Questions', 'a2'), await comp('52', 'Planning, Analysis and Evaluation', 'a2')];
    await apiResponse(admin.v1.catalogue.qualifications[':id'].units.$put({ param: { id: made.id }, json: { units: c.map((unitId) => ({ unitId, requirement: 'required' as const })) } }));
    await apiResponse(admin.v1.catalogue.qualifications[':id'].options.$post({ param: { id: made.id }, json: { code: 'AX', label: 'A Level in one series', unitIds: c } }));
    await apiResponse(admin.v1.catalogue.qualifications[':id'].options.$post({ param: { id: made.id }, json: { code: 'BY', label: 'A2, AS carried forward', unitIds: [c[2]!, c[3]!], carryForward: true } }));
    cat = await apiResponse(admin.v1.catalogue.$get());
    al = cat.qualifications.find((q) => q.code === '9700' && q.boardCode === 'cambridge' && q.level === 'a_level')!;
  }
  const alOption = (code: string) => al!.options.find((o) => o.code === code)!.id;
  const alBio = sid('AL-BIO') ?? (await apiResponse(admin.v1.subjects.$post({ json: {
    name: 'Biology (A Level)', code: 'AL-BIO', council: 'cambridge', courseFee: 12000, registrationFee: 3200, qualificationLevel: 'a_level', isOfferedAtSchool: true, isCore: false,
  } }))).id;
  await apiResponse(admin.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: alBio }, json: { boardCode: 'cambridge', qualificationId: al.id, unitIds: [] } }));

  const igcse = ['0610', '0620', '0580', '0625', '0500'];

  // ─── Series and their dates ────────────────────────────────────────────────
  // The session's own sittings ("exams demo": its rows sit in the sittings its label names), dated for the demo; June
  // 2026 is the reference sitting the declared retakes name.
  const LABEL = 'exams demo';
  const series = await apiResponse(admin.v1['board-series'].$get({ query: {} }));
  const own = async (boardCode: 'cambridge' | 'pearson_edexcel', month: 'november' | 'january', year: number) =>
    series.find((s) => s.boardCode === boardCode && s.month === month && s.year === year && s.label === LABEL)?.id
      ?? (await apiResponse(admin.v1['board-series'].$post({ json: { boardCode, month, year, label: LABEL } }))).id;
  const camNov = await own('cambridge', 'november', 2026);
  const camJun = series.find((s) => s.boardCode === 'cambridge' && s.month === 'june' && s.year === 2026 && !s.label)!.id;
  const pearsonJan = await own('pearson_edexcel', 'january', 2027);
  const now = Date.now();
  await apiResponse(admin.v1['board-series'][':id'].$put({ param: { id: camNov }, json: {
    entryDeadline: new Date(now + 14 * DAY), retakeDeadline: new Date(now + 18 * DAY), reason: 'the school\'s date for the exam-entries demo', forecastGradesDue: cairoDate(new Date(now + 20 * DAY)),
    accessArrangementsDue: cairoDate(new Date(now + 10 * DAY)), examsStart: '2026-10-26', examsEnd: '2026-11-20', resultsOn: '2027-01-13', certificatesOn: '2027-03-31',
    lateFeeFrom: cairoDate(new Date(now + 15 * DAY)), lateEntriesClose: cairoDate(new Date(now + 21 * DAY)),
  } }));
  await apiResponse(admin.v1['board-series'][':id'].$put({ param: { id: camJun }, json: { resultsOn: '2026-08-11', certificatesOn: '2026-10-31', examsStart: '2026-04-27', examsEnd: '2026-06-10' } }));
  await apiResponse(admin.v1['board-series'][':id'].$put({ param: { id: pearsonJan }, json: {
    entryDeadline: new Date(now + 9 * DAY), reason: 'the school\'s date for the exam-entries demo',
    lateFeeFrom: cairoDate(new Date(now + 10 * DAY)), highLateFeeFrom: cairoDate(new Date(now + 37 * DAY)), examsStart: '2027-01-05', examsEnd: '2027-01-28', resultsOn: '2027-03-05', certificatesOn: '2027-05-20',
  } }));
  await apiResponse(finadmin.v1['board-services'].fees.$put({ json: {
    boardSeriesId: pearsonJan, rows: [{ boardServiceId: 'svc-pearson-ci', level: 'as_a_level', amount: 700, provisional: false }], reason: 'Pearson January 2027 cash-in fee (demo)',
  } }));

  // ─── The session and its subjects (the coordinator's subject editor) ───────
  const sessions = await apiResponse(admin.v1.sessions.$get({ query: {} }));
  let sessionId = sessions.find((s) => s.label === LABEL)?.id;
  if (!sessionId) {
    sessionId = (await apiResponse(admin.v1.sessions.$post({ json: {
      type: 'winter', year: 2026, label: LABEL, startDate: new Date(now - 3600_000).toISOString(), endDate: new Date(now + 8 * DAY).toISOString(),
      courseStartsOn: cairoDate(new Date(now)), paymentDueAt: new Date(now + 7 * DAY).toISOString(),
    } }))).id;
    // The boards' fees below are the published ones: the session's prices are final (lines are payable).
    await apiResponse(coord.v1.sessions[':id']['prices-final'].$put({ param: { id: sessionId }, json: { final: true } }));
  }
  type Enters = { kind: 'award'; qualificationId: string } | { kind: 'option'; optionId: string } | { kind: 'units'; unitIds: string[] };
  type DemoRow = { kind: 'all_papers' | 'unit' | 'al' | 'a2'; name?: string; sitting: 'november' | 'january'; examFee: number; enters: Enters };
  const KIND_ORDER: Record<DemoRow['kind'], number> = { all_papers: 0, unit: 2, a2: 4, al: 5 };
  /**
   * A subject offered in the session through the coordinator's routes: its course fee and teacher, one row per entry at
   * the board's fee, every option but a first entry in self study ticked; then what each row enters, written as converted
   * data holds it (above). A subject the session offers already is left as it is. Returns its rows' ids by name.
   */
  const offering = async (subjectId: string, courseFee: number, teacherId: string, rows: DemoRow[]) => {
    const rowsOf = async (where: ReturnType<typeof sql>) =>
      (await db.execute(sql`select i.id, i.label from session_offer_item i join session_offer o on o.id = i.offer_id where ${where} order by i.sort_order`)).rows as { id: string; label: string }[];
    const there = await rowsOf(sql`o.session_id = ${sessionId} and o.subject_id = ${subjectId}`);
    if (there.length) return Object.fromEntries(there.map((r) => [r.label, r.id]));
    const [sub] = (await db.execute(sql`select name, code, council, qualification_level as level, qualification_id as q from subject where id = ${subjectId}`)).rows as
      { name: string; code: string; council: 'cambridge' | 'pearson_edexcel'; level: string; q: string | null }[];
    const igcse = sub!.level === 'igcse';
    const made = await apiResponse(coord.v1.sessions[':id'].offerings.$post({ param: { id: sessionId }, json: {
      custom: { board: sub!.council, name: sub!.name, level: igcse ? 'igcse' : 'as_al', group: igcse ? 'O.L.' : 'A.S./A.L.', code: sub!.code },
    } }));
    await apiResponse(coord.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: sessionId, offeringId: made.id }, json: {
      accepting: true, courseFee, teachers: [{ teacherId, online: false, external: false }],
      rows: rows.map((r) => ({
        kind: r.kind, ...(r.name ? { name: r.name } : {}), sitting: r.sitting, examFee: r.examFee,
        cells: { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false },
      })),
    } }));
    // The rows in the editor's order (by kind, then as sent), matched back to the entries they make.
    const saved = await rowsOf(sql`o.id = ${made.id}`);
    const order = rows.map((r, i) => ({ r, i })).sort((a, b) => KIND_ORDER[a.r.kind] - KIND_ORDER[b.r.kind] || a.i - b.i);
    for (const [pos, { r }] of order.entries()) {
      const id = saved[pos]!.id;
      if (r.enters.kind === 'award') {
        await db.execute(sql`update session_offer_item set enters_kind = 'award', qualification_id = ${r.enters.qualificationId} where id = ${id}`);
      } else if (r.enters.kind === 'option') {
        await db.execute(sql`update session_offer_item set enters_kind = 'option', qualification_option_id = ${r.enters.optionId},
          qualification_id = (select qualification_id from qualification_option where id = ${r.enters.optionId}) where id = ${id}`);
      } else {
        await db.execute(sql`update session_offer_item set enters_kind = 'units', qualification_id = ${sub!.q} where id = ${id}`);
        for (const unitId of r.enters.unitIds) await db.execute(sql`insert into session_offer_item_unit (item_id, unit_id) values (${id}, ${unitId}) on conflict do nothing`);
      }
    }
    return Object.fromEntries(saved.map((r) => [r.label, r.id]));
  };
  const teach: Record<string, string> = { '0610': 'Karim Adel', '0620': 'Karim Adel', '0580': 'Dina Fathy', '0625': 'Youssef Hamed', '0500': 'Youssef Hamed', 'IAL-MATHS': 'Dina Fathy' };
  const itemOf: Record<string, string> = {};
  // Cambridge November 2026's fees (the demo's): each IGCSE syllabus 2,600; A Level in one series 4,200, A2 carried forward 2,600.
  for (const code of igcse) {
    const rows = await offering(sid(code)!, 9000, tId(teach[code]!), [{ kind: 'all_papers', sitting: 'november', examFee: 2600, enters: { kind: 'award', qualificationId: qual(code).id } }]);
    itemOf[code] = Object.values(rows)[0]!;
  }
  Object.assign(itemOf, await offering(alBio, 12000, tId('Karim Adel'), [
    { kind: 'al', name: 'A Level', sitting: 'november', examFee: 4200, enters: { kind: 'option', optionId: alOption('AX') } },
    { kind: 'a2', name: 'A2, carry forward', sitting: 'november', examFee: 2600, enters: { kind: 'option', optionId: alOption('BY') } },
  ]));
  // Pearson January 2027's: each unit 1,600.
  Object.assign(itemOf, await offering(ialMaths, 2400, tId('Dina Fathy'), (['P1', 'P2', 'M1'] as const).map((name): DemoRow => ({
    kind: 'unit', name, sitting: 'january', examFee: 1600, enters: { kind: 'units', unitIds: [unit({ P1: 'WMA11', P2: 'WMA12', M1: 'WME01' }[name])] },
  }))));

  // ─── Families, reserved and paid at the desk ───────────────────────────────
  const first = (code: string): Line => ({ offerItemId: itemOf[code]!, attempt: 'first', mode: 'in_school' });
  const fams: [string, string, 11 | 12, Line[]][] = [
    ['Youssef Mahmoud', 'youssef.mahmoud', 11, [first('0610'), first('0580'), first('0620')]],
    ['Mariam Khaled', 'mariam.khaled', 11, [first('0610'), first('0580'), first('0500')]],
    ['Omar Tarek', 'omar.tarek', 11, [first('0610'), first('0620'), first('0625')]],
    // A self-study retake of June 2026's Mathematics, declared at the desk: June's results verify it.
    ['Nour Hassan', 'nour.hassan', 11, [{ offerItemId: itemOf['0580']!, attempt: 'retake', mode: 'self_study', priorSitting: { month: 'june', year: 2026 } }, first('0625'), first('0500')]],
    ['Hana Ibrahim', 'hana.ibrahim', 12, [first('0620'), first('P1'), first('M1')]],
    ['Adam Sherif', 'adam.sherif', 12, [first('P1'), first('P2')]],
    ['Laila Mostafa', 'laila.mostafa', 12, [first('0610'), first('P1')]],
    // A retake of P2 from January 2026, declared: not verified, so the entry check lists it.
    ['Ziad Fouad', 'ziad.fouad', 12, [{ offerItemId: itemOf.P2!, attempt: 'retake', mode: 'in_school', priorSitting: { month: 'january', year: 2026 } }, first('M1')]],
    // A2 with the AS carried forward from June 2026 at another centre: verified below with its centre and number.
    ['Yara Nabil', 'yara.nabil', 12, [{ offerItemId: itemOf['A2, carry forward']!, attempt: 'first', mode: 'in_school', priorSitting: { month: 'june', year: 2026 } }]],
  ];
  const students: Record<string, string> = {};
  const lineIds: Record<string, string[]> = {};
  for (const [name, slug, grade, lines] of fams) {
    const existing = await apiResponse(officer.v1.users.search.$get({ query: { search: `student.${slug}` } }));
    let studentId = existing.find((u) => u.email === `student.${slug}@igcse.local`)?.id;
    if (!studentId) {
      const r = await apiResponse(officer.v1.links['desk-onboard'].$post({ json: {
        parent: { email: `parent.${slug}@igcse.local`, name: `Parent of ${name}`, password: PW, phone: '01000000000' },
        student: { email: `student.${slug}@igcse.local`, name, password: PW, phone: '01111111111', grade },
      } }));
      studentId = r.student.id;
      const made = await apiResponse(officer.v1.registrations.desk.$post({ json: { studentId, sessionId, lines, consent: CONSENT, collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } } }));
      lineIds[slug] = made.registrations.map((x) => x.id);
    }
    students[slug] = studentId;
  }

  // A cash-in for Adam's Mathematics AS (P1 and P2 sat; the line's item says the award), paid at the desk;
  // Hana's accepted and not paid yet (listed, not entered).
  const adamP1 = lineIds['adam.sherif']?.[0];
  if (adamP1) {
    const ci = await apiResponse(officer.v1.charges.$post({ json: { studentId: students['adam.sherif']!, kind: 'cash_in', boardServiceId: 'svc-pearson-ci', registrationId: adamP1 } }));
    await apiResponse(officer.v1.registrations.desk.collect.$post({ json: { studentId: students['adam.sherif']!, chargeIds: [ci.id], instrumentUsed: 'cash' } }));
  }
  const hanaP1 = lineIds['hana.ibrahim']?.[1];
  if (hanaP1) await apiResponse(officer.v1.charges.$post({ json: { studentId: students['hana.ibrahim']!, kind: 'cash_in', boardServiceId: 'svc-pearson-ci', registrationId: hanaP1 } }));
  // Ziad's cash-in names no line (asked at the desk for units banked earlier): the coordinator adds its award by hand.
  if (lineIds['ziad.fouad']) {
    const zc = await apiResponse(officer.v1.charges.$post({ json: { studentId: students['ziad.fouad']!, kind: 'cash_in', boardServiceId: 'svc-pearson-ci', boardSeriesId: pearsonJan, level: 'as_a_level' } }));
    await apiResponse(officer.v1.registrations.desk.collect.$post({ json: { studentId: students['ziad.fouad']!, chargeIds: [zc.id], instrumentUsed: 'cash' } }));
  }
  // Yara's carried-forward sitting verified by the coordinator, with the other centre's numbers.
  const yaraLine = lineIds['yara.nabil']?.[0];
  if (yaraLine) {
    await apiResponse(coord.v1.registrations[':id']['verify-prior'].$post({ param: { id: yaraLine }, json: { outcome: 'verified', prevCentre: 'EG456', prevCandidateNumber: '0219', reason: "seen on the other centre's statement of results" } }));
  }

  // ─── Who teaches whom: enrolment from the lines (per unit for the IAL items) ─
  await apiResponse(coord.v1.enrolments.bulk.$post({ json: { academicYearId: yearId, source: 'registrations', studentIds: Object.values(students), commit: true } }));

  // ─── Candidates ────────────────────────────────────────────────────────────
  const legal: Record<string, [string, string, string, 'female' | 'male', string | null]> = {
    'youssef.mahmoud': ['Youssef Ahmed', 'Mahmoud', '2010-02-11', 'male', null],
    'mariam.khaled': ['Mariam Walid', 'Khaled', '2010-05-23', 'female', null],
    'omar.tarek': ['Omar', 'Tarek', '2010-01-30', 'male', null],
    'nour.hassan': ['Nour Eldin', 'Hassan', '2010-08-02', 'female', null],
    'hana.ibrahim': ['Hana', 'Ibrahim', '2009-03-14', 'female', '91234B250101H'],
    'adam.sherif': ['Adam Mohamed', 'Sherif', '2009-11-05', 'male', '91234B250102A'],
    'laila.mostafa': ['Laila', 'Mostafa', '2009-06-19', 'female', null],
    'ziad.fouad': ['Ziad', 'Fouad', '2009-09-27', 'male', '91234B250104Z'],
    'yara.nabil': ['Yara', 'Nabil', '2009-04-08', 'female', null],
  };
  for (const [slug, [fore, sur, dob, gender, uci]] of Object.entries(legal)) {
    await apiResponse(coord.v1.exams.candidates[':studentId'].$put({ param: { studentId: students[slug]! }, json: {
      legalForenames: fore, legalSurname: sur, dateOfBirth: dob, gender, ...(uci ? { uci } : {}),
      ...(slug === 'omar.tarek' ? { accessArrangements: ['extra_time_25', 'separate_room'], accessArrangementsRef: 'CIE-AA-5521', accessArrangementsUntil: '2027-06-30' } : {}),
    } }));
  }
  await apiResponse(coord.v1.exams.candidates[':studentId'].identity.$put({ param: { studentId: students['youssef.mahmoud']! }, json: { documentType: 'national_id', documentNumber: '31002111234567' } }));
  await apiResponse(coord.v1.exams.candidates[':studentId'].identity.$put({ param: { studentId: students['hana.ibrahim']! }, json: { documentType: 'national_id', documentNumber: '30903141234568' } }));
  await apiResponse(admin.v1.settings[':key'].$put({ param: { key: 'exams.centres' }, json: {
    value: { cambridge: { centreNumber: 'EG123', route: 'direct' }, pearson_edexcel: { centreNumber: '91234', route: 'british_council' } }, reason: 'the demo school\'s centre numbers',
  } }));

  // ─── June 2026: results (Nour's declared sitting verified by them) and certificates ─
  const june = [['0301', 'laila.mostafa', '0625', 'A'], ['0302', 'hana.ibrahim', '0625', 'B'], ['0303', 'adam.sherif', '0500', 'A*'], ['0304', 'nour.hassan', '0580', 'D']] as const;
  for (const [num, slug] of june) {
    await coord.v1.exams['candidate-numbers'].$put({ json: { studentId: students[slug]!, boardSeriesId: camJun, number: num } });
  }
  const col = (code: string) => ({ '0625': '0625 Physics', '0500': '0500 English Language', '0580': '0580 Mathematics' } as Record<string, string>)[code]!;
  const broadsheet = ['Cambridge International — June 2026 results', 'Centre EG123', `Candidate No,Candidate Name,${col('0625')},${col('0500')},${col('0580')}`,
    ...june.map(([n, slug, code, g]) => `${n},${legal[slug]![1].toUpperCase()} ${legal[slug]![0]},${code === '0625' ? g : ''},${code === '0500' ? g : ''},${code === '0580' ? g : ''}`)].join('\n');
  await apiResponse(coord.v1.exams.results.import.$post({ json: { boardSeriesId: camJun, source: { text: broadsheet, name: 'June 2026 broadsheet' }, commit: true, saveMappingAs: 'Cambridge broadsheet' } }));
  await apiResponse(coord.v1.exams.results.publish.$post({ json: { boardSeriesId: camJun } }));
  await apiResponse(coord.v1.exams.certificates.receive.$post({ json: { boardSeriesId: camJun, receivedOn: '2026-09-28', commit: true } }));
  const certs = await apiResponse(officer.v1.exams.certificates.$get({ query: { boardSeriesId: camJun } }));
  const laila = certs.certificates.find((c) => c.studentId === students['laila.mostafa']);
  if (laila && laila.status === 'received') {
    await apiResponse(officer.v1.exams.certificates[':id'].collect.$post({ param: { id: laila.id }, json: { collectorName: 'Laila Mostafa', collectorRelation: 'candidate', collectorIdChecked: 'school_id' } }));
  }

  // ─── Numbers, entries, options, forecasts ──────────────────────────────────
  for (const s of [camNov, pearsonJan]) {
    await apiResponse(coord.v1.exams['candidate-numbers'].assign.$post({ json: { boardSeriesId: s, commit: true } }));
    await apiResponse(coord.v1.exams.entries.derive.$post({ json: { boardSeriesId: s, commit: true } }));
  }
  const cam = await apiResponse(coord.v1.exams.entries.$get({ query: { boardSeriesId: camNov } }));
  for (const e of cam) {
    if (e.optionCode) continue;
    const opt = e.entryCode === '0610' ? (e.studentName === 'Omar Tarek' ? null : 'BX') : e.entryCode === '0580' ? 'MX' : null;
    if (opt) await apiResponse(coord.v1.exams.entries[':id'].$put({ param: { id: e.id }, json: { optionCode: opt } }));
  }
  const karim = await signIn('teacher.karim@igcse.local');
  for (const f of await apiResponse(karim.v1.exams.forecasts.$get({ query: { boardSeriesId: camNov } }))) {
    if (f.studentName !== 'Mariam Khaled') await apiResponse(karim.v1.exams.entries[':id'].forecast.$put({ param: { id: f.entryId }, json: { grade: 'B' } }));
  }
  const pj = await apiResponse(coord.v1.exams.entries.$get({ query: { boardSeriesId: pearsonJan } }));
  await apiResponse(coord.v1.exams.entries.submit.$post({ json: { entryIds: pj.filter((e) => e.studentName !== 'Laila Mostafa' && e.status === 'draft').map((e) => e.id) } }));

  // ─── The timetable, a seated sitting ───────────────────────────────────────
  const tt = [
    'Component\tSubject\tDate\tSession\tStart\tDuration',
    '0610/22\tBiology Multiple Choice (Extended)\t26/10/2026\tPM\t13:30\t45m',
    '0610/42\tBiology Theory (Extended)\t02/11/2026\tAM\t08:30\t1h 15m',
    '0610/62\tBiology Alternative to Practical\t09/11/2026\tAM\t08:30\t1h',
    '0620/22\tChemistry Multiple Choice (Extended)\t27/10/2026\tAM\t08:30\t45m',
    '0620/42\tChemistry Theory (Extended)\t02/11/2026\tAM\t08:30\t1h 15m',
    '0620/62\tChemistry Alternative to Practical\t10/11/2026\tPM\t13:30\t1h',
    '0580/22\tMathematics Paper 2 (Extended)\t28/10/2026\tAM\t08:30\t2h',
    '0580/42\tMathematics Paper 4 (Extended)\t04/11/2026\tAM\t08:30\t2h',
  ].join('\n');
  await apiResponse(coord.v1.exams.papers.import.$post({ json: { boardSeriesId: camNov, text: tt, commit: true } }));
  const existingPapers = await apiResponse(coord.v1.exams.papers.$get({ query: { boardSeriesId: pearsonJan } }));
  for (const [code, title, unitCode, examDate, session, startTime] of [
    ['WMA11/01', 'Pure Mathematics P1', 'WMA11', '2027-01-07', 'am', '09:00'],
    ['WMA12/01', 'Pure Mathematics P2', 'WMA12', '2027-01-13', 'am', '09:00'],
    ['WME01/01', 'Mechanics M1', 'WME01', '2027-01-15', 'pm', '13:30'],
  ] as const) {
    if (existingPapers.papers.some((p) => p.code === code)) continue;
    await apiResponse(coord.v1.exams.papers.$post({ json: { boardSeriesId: pearsonJan, code, title, unitId: unit(unitCode), examDate, session, startTime, durationMinutes: 90 } }));
  }
  const camEntries = await apiResponse(coord.v1.exams.entries.$get({ query: { boardSeriesId: camNov } }));
  await apiResponse(coord.v1.exams.entries.submit.$post({ json: { entryIds: camEntries.filter((e) => e.optionCode && e.status === 'draft').map((e) => e.id) } }));
  await apiResponse(coord.v1.exams.timetable.publish.$post({ json: { boardSeriesId: camNov } }));
  const sitting = { examDate: '2026-11-02', session: 'am' as const };
  await apiResponse(coord.v1.exams.sittings.rooms.$put({ json: { ...sitting, rooms: [{ roomId: hall, seatRows: 4, seatColumns: 6 }, { roomId: r101, seatRows: 2, seatColumns: 3 }] } }));
  await apiResponse(coord.v1.exams.sittings.seat.$post({ json: { ...sitting, commit: true } }));
  await apiResponse(coord.v1.exams.invigilation.$put({ json: { ...sitting, roomId: hall, teacherIds: [tId('Youssef Hamed')], leadTeacherId: tId('Youssef Hamed') } }));

  console.log('F4 demo data ready:', Object.keys(students).length, 'families');
  await (db as unknown as { $client: { end(): Promise<void> } }).$client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export type { Api };
