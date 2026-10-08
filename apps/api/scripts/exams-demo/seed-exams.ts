/**
 * F4's demo data for a running dev system (docs/features/EXAM_ENTRIES.md, "Running it"), on the
 * reservations rework's model: staff, the catalogue's components and option codes, a winter
 * session whose offers' items enter Cambridge IGCSE syllabi (November) and Pearson IAL units
 * (January), fee grids, families reserved and paid at the desk (lines and consent — a declared
 * self-study retake and a declared unit retake among them), a paid cash-in, course enrolment from
 * the lines, candidates, entries, forecasts, the timetable, a seated sitting, and an earlier
 * series' results (which verify a declared sitting) and certificates. Everything goes through the
 * API over HTTP, as the screens do (made-up names; never the school's sheet).
 *
 *   API_URL=http://localhost:3043 WEB_ORIGIN=http://localhost:3040 \
 *     pnpm --filter @repo/api exec tsx scripts/exams-demo/seed-exams.ts
 *
 * Run it once on a fresh copy of the template dev database migrated to the branch.
 */
import { hc } from 'hono/client';
import { apiResponse } from '@repo/validations';
import type { AppType } from '../../src/app';

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

  // ─── The catalogue: components and option codes ────────────────────────────
  let cat = await apiResponse(coord.v1.catalogue.$get());
  const qual = (code: string) => cat.qualifications.find((q) => q.code === code && q.boardCode === 'cambridge')!;
  const addComponents = async (syllabus: string, papers: [string, string, 'core' | 'extended' | null][], options: [string, string, string[]][]) => {
    const q = qual(syllabus);
    if (q.units.length) return;
    const ids: Record<string, string> = {};
    for (const [n, title, tier] of papers) {
      ids[n] = (await apiResponse(coord.v1.catalogue.units.$post({ json: { boardCode: 'cambridge', code: `${syllabus}/${n}`, shortCode: `Paper ${n}`, title, unitLevel: 'igcse', kind: 'component', tier } }))).id;
    }
    await apiResponse(coord.v1.catalogue.qualifications[':id'].units.$put({ param: { id: q.id }, json: { units: Object.values(ids).map((unitId) => ({ unitId, requirement: 'optional' as const })) } }));
    for (const [code, label, ns] of options) {
      await apiResponse(coord.v1.catalogue.qualifications[':id'].options.$post({ param: { id: q.id }, json: { code, label, unitIds: ns.map((n) => ids[n]!) } }));
    }
  };
  await addComponents('0610', [['12', 'Multiple Choice (Core)', 'core'], ['22', 'Multiple Choice (Extended)', 'extended'], ['32', 'Theory (Core)', 'core'], ['42', 'Theory (Extended)', 'extended'], ['62', 'Alternative to Practical', null]],
    [['BX', 'Extended: Papers 2, 4 and 6', ['22', '42', '62']], ['BC', 'Core: Papers 1, 3 and 6', ['12', '32', '62']]]);
  await addComponents('0620', [['22', 'Multiple Choice (Extended)', 'extended'], ['42', 'Theory (Extended)', 'extended'], ['62', 'Alternative to Practical', null]],
    [['CX', 'Extended: Papers 2, 4 and 6', ['22', '42', '62']]]);
  await addComponents('0580', [['12', 'Paper 1 (Core)', 'core'], ['22', 'Paper 2 (Extended)', 'extended'], ['32', 'Paper 3 (Core)', 'core'], ['42', 'Paper 4 (Extended)', 'extended']],
    [['MX', 'Extended: Papers 2 and 4', ['22', '42']], ['MC', 'Core: Papers 1 and 3', ['12', '32']]]);
  await apiResponse(coord.v1.catalogue.starter.$post({ json: { set: 'pearson_ial_mathematics' } }));
  cat = await apiResponse(coord.v1.catalogue.$get());
  const unit = (code: string) => cat.units.find((u) => u.code === code)!.id;
  const xma = cat.qualifications.find((q) => q.code === 'XMA01')!.id;
  const subjects = await apiResponse(admin.v1.subjects.$get({ query: {} }));
  const sid = (code: string) => subjects.find((s) => s.code === code)?.id;
  // The rework's shape (RESERVATIONS_REWORK.md §3.2): one parent subject, an item per unit.
  const ialMaths = sid('IAL-MATHS') ?? (await apiResponse(admin.v1.subjects.$post({ json: {
    name: 'Mathematics (IAL)', code: 'IAL-MATHS', council: 'pearson_edexcel', courseFee: 2400, registrationFee: 1600, qualificationLevel: 'as_level', isOfferedAtSchool: true, isCore: false,
  } }))).id;
  await apiResponse(coord.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: ialMaths }, json: { boardCode: 'pearson_edexcel', qualificationId: xma, unitIds: [] } }));

  // ─── Series and their dates ────────────────────────────────────────────────
  const series = await apiResponse(admin.v1['board-series'].$get({ query: {} }));
  const camNov = series.find((s) => s.boardCode === 'cambridge' && s.month === 'november' && s.year === 2026 && !s.label)!.id;
  const camJun = series.find((s) => s.boardCode === 'cambridge' && s.month === 'june' && s.year === 2026 && !s.label)!.id;
  const now = Date.now();
  await apiResponse(admin.v1['board-series'][':id'].$put({ param: { id: camNov }, json: {
    entryDeadline: new Date(now + 14 * DAY), reason: 'the school\'s date for the exam-entries demo', forecastGradesDue: cairoDate(new Date(now + 20 * DAY)),
    accessArrangementsDue: cairoDate(new Date(now + 10 * DAY)), examsStart: '2026-10-26', examsEnd: '2026-11-20', resultsOn: '2027-01-13', certificatesOn: '2027-03-31',
    lateFeeFrom: cairoDate(new Date(now + 15 * DAY)), lateEntriesClose: cairoDate(new Date(now + 21 * DAY)),
  } }));
  await apiResponse(admin.v1['board-series'][':id'].$put({ param: { id: camJun }, json: { resultsOn: '2026-08-11', certificatesOn: '2026-10-31', examsStart: '2026-04-27', examsEnd: '2026-06-10' } }));
  const pearsonJan = series.find((s) => s.boardCode === 'pearson_edexcel' && s.month === 'january' && s.year === 2027 && !s.label)?.id
    ?? (await apiResponse(admin.v1['board-series'].$post({ json: {
      boardCode: 'pearson_edexcel', month: 'january', year: 2027, label: '', entryDeadline: new Date(now + 9 * DAY),
      lateFeeFrom: cairoDate(new Date(now + 10 * DAY)), highLateFeeFrom: cairoDate(new Date(now + 37 * DAY)), examsStart: '2027-01-05', examsEnd: '2027-01-28', resultsOn: '2027-03-05', certificatesOn: '2027-05-20',
    } }))).id;

  // ─── The fee grids ─────────────────────────────────────────────────────────
  const igcse = ['0610', '0620', '0580', '0625', '0500'];
  await apiResponse(admin.v1['board-fees'].$put({ query: { seriesId: camNov }, json: {
    rows: igcse.map((c) => ({ keyKind: 'qualification' as const, keyId: qual(c).id, amount: 2600, provisional: false })), reason: 'Cambridge November 2026 fee list (demo)',
  } }));
  await apiResponse(admin.v1['board-fees'].$put({ query: { seriesId: pearsonJan }, json: {
    rows: ['WMA11', 'WMA12', 'WME01'].map((c) => ({ keyKind: 'unit' as const, keyId: unit(c), amount: 1600, provisional: false })), reason: 'Pearson January 2027 fee list (demo)',
  } }));
  await apiResponse(finadmin.v1['board-services'].fees.$put({ json: {
    boardSeriesId: pearsonJan, rows: [{ boardServiceId: 'svc-pearson-ci', level: 'as_a_level', amount: 700, provisional: false }], reason: 'Pearson January 2027 cash-in fee (demo)',
  } }));

  // ─── The session and its offers (the links sheet) ──────────────────────────
  const sessions = await apiResponse(admin.v1.sessions.$get({ query: {} }));
  const sessionId = sessions.find((s) => s.label === 'exams demo')?.id
    ?? (await apiResponse(admin.v1.sessions.$post({ json: {
      type: 'winter', year: 2026, label: 'exams demo', startDate: new Date(now - 3600_000).toISOString(), endDate: new Date(now + 8 * DAY).toISOString(),
      courseStartsOn: cairoDate(new Date(now)), paymentDueAt: new Date(now + 7 * DAY).toISOString(),
    } }))).id;
  const offers = await apiResponse(admin.v1.sessions[':id'].offers.$get({ param: { id: sessionId } }));
  const teach: Record<string, string> = { '0610': 'Karim Adel', '0620': 'Karim Adel', '0580': 'Dina Fathy', '0625': 'Youssef Hamed', '0500': 'Youssef Hamed', 'IAL-MATHS': 'Dina Fathy' };
  const itemOf: Record<string, string> = {};
  for (const code of igcse) {
    const subjectId = sid(code)!;
    const existing = offers.offers.find((o) => o.subjectId === subjectId);
    itemOf[code] = existing?.items[0]?.id ?? (await apiResponse(admin.v1.sessions[':id'].offers.$post({ param: { id: sessionId }, json: {
      subjectId, courseFee: 9000, teachers: [{ teacherId: tId(teach[code]!), mode: 'in_school' }],
      items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'award', qualificationId: qual(code).id }, boardSeriesId: camNov, availability: 'open', requiredInSeries: false }],
    } }))).items[0]!;
  }
  const mathsOffer = offers.offers.find((o) => o.subjectId === ialMaths);
  if (mathsOffer) for (const it of mathsOffer.items) itemOf[it.label] = it.id;
  else {
    const made = await apiResponse(admin.v1.sessions[':id'].offers.$post({ param: { id: sessionId }, json: {
      subjectId: ialMaths, courseFee: 2400, teachers: [{ teacherId: tId('Dina Fathy'), mode: 'in_school' }],
      items: (['P1', 'P2', 'M1'] as const).map((label, i) => ({
        label, kind: 'unit' as const, enters: { kind: 'units' as const, unitIds: [unit({ P1: 'WMA11', P2: 'WMA12', M1: 'WME01' }[label])] },
        boardSeriesId: pearsonJan, availability: 'open' as const, requiredInSeries: false, sortOrder: i,
      })),
    } }));
    (['P1', 'P2', 'M1'] as const).forEach((label, i) => { itemOf[label] = made.items[i]!; });
  }

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

  // A cash-in for Adam's Mathematics AS (P1 and P2 sat; the line's item says the award), paid at the desk.
  const adamP1 = lineIds['adam.sherif']?.[0];
  if (adamP1) {
    const ci = await apiResponse(officer.v1.charges.$post({ json: { studentId: students['adam.sherif']!, kind: 'cash_in', boardServiceId: 'svc-pearson-ci', registrationId: adamP1 } }));
    await apiResponse(officer.v1.registrations.desk.collect.$post({ json: { studentId: students['adam.sherif']!, chargeIds: [ci.id], instrumentUsed: 'cash' } }));
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export type { Api };
