/**
 * F4's demo data for a running dev system (docs/features/EXAM_ENTRIES.md,
 * "Running it"): staff, the catalogue's components and option codes, two
 * windows feeding Cambridge November and Pearson IAL January, families
 * registered and paid at the desk, course enrolment, candidates, entries,
 * forecasts, the timetable, a seated sitting, and an earlier series' results
 * and certificates. Everything goes through the API over HTTP, as the
 * screens do (made-up names; never the school's sheet).
 *
 *   API_URL=http://localhost:3043 WEB_ORIGIN=http://localhost:3040 \
 *     pnpm --filter @repo/api exec tsx scripts/exams-demo/seed-exams.ts
 *
 * Run it once on a fresh copy of the template dev database.
 */
import { hc } from 'hono/client';
import { apiResponse } from '@repo/validations';
import type { AppType } from '../../src/app';

const API = process.env.API_URL ?? 'http://localhost:3043';
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3040';
const PW = 'TestPass1';

async function signIn(email: string, password = PW) {
  const res = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`sign-in ${email}: ${res.status} ${await res.text()}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  cookies.set(email, cookie);
  return hc<AppType>(API, { headers: { Cookie: cookie, Origin: ORIGIN } });
}
const cookies = new Map<string, string>();
type Api = Awaited<ReturnType<typeof signIn>>;

const iso = (s: string) => new Date(s).toISOString();

async function main() {
  const admin = await signIn('admin@igcse.local', 'AdminPass1');
  const officer = await signIn('officer.mona@igcse.local');

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
  const ial = async (code: string, name: string, unitCode: string) => {
    const id = sid(code) ?? (await apiResponse(admin.v1.subjects.$post({ json: {
      name, code, council: 'pearson_edexcel', courseFee: 2400, registrationFee: 1600, qualificationLevel: 'as_level', isOfferedAtSchool: true, isCore: false,
    } }))).id;
    await apiResponse(coord.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: id }, json: { boardCode: 'pearson_edexcel', qualificationId: xma, unitIds: [unit(unitCode)] } }));
    return id;
  };
  const p1 = await ial('IAL-P1', 'Pure Mathematics 1', 'WMA11');
  const p2 = await ial('IAL-P2', 'Pure Mathematics 2', 'WMA12');
  const m1 = await ial('IAL-M1', 'Mechanics 1', 'WME01');

  // ─── Windows and series ────────────────────────────────────────────────────
  const series = await apiResponse(admin.v1['board-series'].$get({ query: {} }));
  const camNov = series.find((s) => s.boardCode === 'cambridge' && s.month === 'november' && s.year === 2026)!.id;
  const camJun = series.find((s) => s.boardCode === 'cambridge' && s.month === 'june' && s.year === 2026)!.id;
  // The window's PUT reads its body by the window's state, so it is sent as the screen sends it.
  const ext = await fetch(`${API}/v1/sessions/sess_november-2026`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookies.get('admin@igcse.local')!, Origin: ORIGIN },
    body: JSON.stringify({ endDate: '2026-10-04T20:59:00.000Z', reason: 'extended for the exam-entries demo' }),
  });
  if (ext.status !== 200) console.warn('window extension:', ext.status, await ext.text());
  await apiResponse(admin.v1['board-series'][':id'].$put({ param: { id: camNov }, json: {
    entryDeadline: new Date('2026-10-08T15:00:00Z'), reason: 'the school\'s date for the demo', forecastGradesDue: '2026-10-20', accessArrangementsDue: '2026-10-10',
    examsStart: '2026-10-26', examsEnd: '2026-11-20', resultsOn: '2027-01-13', certificatesOn: '2027-03-31', lateFeeFrom: '2026-10-09', lateEntriesClose: '2026-10-21',
  } }));
  await apiResponse(admin.v1['board-series'][':id'].$put({ param: { id: camJun }, json: { resultsOn: '2026-08-11', certificatesOn: '2026-10-31', examsStart: '2026-04-27', examsEnd: '2026-06-10' } }));
  const pearsonJan = series.find((s) => s.boardCode === 'pearson_edexcel' && s.month === 'january' && s.year === 2027)?.id
    ?? (await apiResponse(admin.v1['board-series'].$post({ json: {
      boardCode: 'pearson_edexcel', month: 'january', year: 2027, label: '', entryDeadline: new Date('2026-10-16T15:00:00Z'),
      lateFeeFrom: '2026-10-17', highLateFeeFrom: '2026-11-14', examsStart: '2027-01-05', examsEnd: '2027-01-28', resultsOn: '2027-03-05', certificatesOn: '2027-05-20',
    } }))).id;
  const sessions = await apiResponse(admin.v1.sessions.$get({ query: {} }));
  const janWindow = sessions.find((s) => s.name === 'January 2027 (AS)')?.id
    ?? (await apiResponse(admin.v1.sessions.$post({ json: {
      name: 'January 2027 (AS)', sessionType: 'january', seriesYear: 2027, qualificationLevel: 'as_level',
      startDate: iso(new Date(Date.now() - 3600_000).toISOString()), endDate: iso('2026-10-04T20:59:00Z'),
    } }))).id;
  await apiResponse(admin.v1.sessions[':id']['board-series'].$put({ param: { id: janWindow }, json: { series: [{ boardSeriesId: pearsonJan, isDefault: true }], routes: [] } }));

  // ─── Families, registered and paid at the desk ─────────────────────────────
  const fams: [string, string, 11 | 12, string[], string[]][] = [
    ['Youssef Mahmoud', 'youssef.mahmoud', 11, ['0610', '0580', '0620'], []],
    ['Mariam Khaled', 'mariam.khaled', 11, ['0610', '0580', '0500'], []],
    ['Omar Tarek', 'omar.tarek', 11, ['0610', '0620', '0625'], []],
    ['Nour Hassan', 'nour.hassan', 11, ['0580', '0625', '0500'], []],
    ['Hana Ibrahim', 'hana.ibrahim', 12, ['0620'], ['IAL-P1', 'IAL-M1']],
    ['Adam Sherif', 'adam.sherif', 12, [], ['IAL-P1', 'IAL-P2']],
    ['Laila Mostafa', 'laila.mostafa', 12, ['0610'], ['IAL-P1']],
    ['Ziad Fouad', 'ziad.fouad', 12, [], ['IAL-P2', 'IAL-M1']],
  ];
  const students: Record<string, string> = {};
  for (const [name, slug, grade, igcse, ial] of fams) {
    const existing = await apiResponse(officer.v1.users.search.$get({ query: { search: `student.${slug}` } }));
    let studentId = existing.find((u) => u.email === `student.${slug}@igcse.local`)?.id;
    if (!studentId) {
      const r = await apiResponse(officer.v1.links['desk-onboard'].$post({ json: {
        parent: { email: `parent.${slug}@igcse.local`, name: `Parent of ${name}`, password: PW, phone: '01000000000' },
        student: { email: `student.${slug}@igcse.local`, name, password: PW, phone: '01111111111', grade },
      } }));
      studentId = r.student.id;
      if (igcse.length) {
        await apiResponse(officer.v1.registrations.desk.$post({ json: { studentId, sessionId: 'sess_november-2026', subjectIds: igcse.map((c) => sid(c)!), collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } } }));
      }
      if (ial.length) {
        await apiResponse(officer.v1.registrations.desk.$post({ json: { studentId, sessionId: janWindow, subjectIds: ial.map((c) => ({ 'IAL-P1': p1, 'IAL-P2': p2, 'IAL-M1': m1 } as Record<string, string>)[c]!), collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } } }));
      }
    }
    students[slug] = studentId;
  }

  // ─── Who teaches whom ──────────────────────────────────────────────────────
  const teach: Record<string, string> = { '0610': 'Karim Adel', '0620': 'Karim Adel', '0580': 'Dina Fathy', 'IAL-P1': 'Dina Fathy', 'IAL-P2': 'Dina Fathy', 'IAL-M1': 'Dina Fathy', '0625': 'Youssef Hamed', '0500': 'Youssef Hamed' };
  for (const [, slug, , igcse, ialCodes] of fams) {
    for (const code of [...igcse, ...ialCodes]) {
      const subjectId = code.startsWith('IAL') ? ({ 'IAL-P1': p1, 'IAL-P2': p2, 'IAL-M1': m1 } as Record<string, string>)[code]! : sid(code)!;
      await coord.v1.enrolments.$post({ json: { academicYearId: yearId, studentId: students[slug]!, subjectId, teacherId: tId(teach[code]!) } });
    }
  }

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
  await apiResponse(coord.v1.exams.entries.submit.$post({ json: { entryIds: pj.filter((e) => e.studentName !== 'Laila Mostafa').map((e) => e.id) } }));

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

  // ─── June 2026: results and certificates ───────────────────────────────────
  const june = [['0301', 'laila.mostafa', '0625', 'A'], ['0302', 'hana.ibrahim', '0625', 'B'], ['0303', 'adam.sherif', '0500', 'A*']] as const;
  for (const [num, slug] of june) {
    await coord.v1.exams['candidate-numbers'].$put({ json: { studentId: students[slug]!, boardSeriesId: camJun, number: num } });
  }
  const broadsheet = ['Cambridge International — June 2026 results', 'Centre EG123', 'Candidate No,Candidate Name,0625 Physics,0500 English Language', ...june.map(([n, slug, code, g]) => `${n},${legal[slug]![1].toUpperCase()} ${legal[slug]![0]},${code === '0625' ? g : ''},${code === '0500' ? g : ''}`)].join('\n');
  await apiResponse(coord.v1.exams.results.import.$post({ json: { boardSeriesId: camJun, source: { text: broadsheet, name: 'June 2026 broadsheet' }, commit: true, saveMappingAs: 'Cambridge broadsheet' } }));
  await apiResponse(coord.v1.exams.results.publish.$post({ json: { boardSeriesId: camJun } }));
  await apiResponse(coord.v1.exams.certificates.receive.$post({ json: { boardSeriesId: camJun, receivedOn: '2026-09-28', commit: true } }));
  const certs = await apiResponse(officer.v1.exams.certificates.$get({ query: { boardSeriesId: camJun } }));
  const laila = certs.certificates.find((c) => c.studentId === students['laila.mostafa']);
  if (laila && laila.status === 'received') {
    await apiResponse(officer.v1.exams.certificates[':id'].collect.$post({ param: { id: laila.id }, json: { collectorName: 'Laila Mostafa', collectorRelation: 'candidate', collectorIdChecked: 'school ID card' } }));
  }
  console.log('F4 demo data ready:', Object.keys(students).length, 'families');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export type { Api };
