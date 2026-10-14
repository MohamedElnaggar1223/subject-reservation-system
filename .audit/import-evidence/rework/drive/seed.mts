/**
 * F7's drive on the dev system (3091/3090): a winter 2026 session with demo subjects, their teacher,
 * items and fee grids (one row missing, one provisional), IAL Mathematics by unit, and a synthetic
 * sheet with the shapes the review must show. Placeholder names only. Writes the sheet to
 * /tmp/f7/drive/demo-sheet.xlsx and the ids to /tmp/f7/drive/seed.json.
 */
import { writeFileSync } from 'node:fs';
import { hc } from 'hono/client';
import type { AppType } from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/agent-acf43230a4e06e8b4/apps/api/src/app';
import { apiResponse } from '@repo/validations';
import { workbook, type Cell } from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/agent-acf43230a4e06e8b4/apps/api/test/import-fixtures';

const API = 'http://localhost:3091';
const ORIGIN = 'http://localhost:3090';
const signIn = async (email: string, password: string) => {
  const res = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(`sign-in ${res.status}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return hc<AppType>(API, { headers: { Origin: ORIGIN, Cookie: cookie } });
};
const adm = await signIn('admin@igcse.local', process.env.DEMO_ADMIN_PASSWORD ?? '');

// The academic year the sheet's classes are in.
const years = await apiResponse(adm.v1.academic.years.$get());
if (!years.some((y) => y.startYear === 2026)) await apiResponse(adm.v1.academic.years.$post({ json: { startYear: 2026, startsOn: '2026-09-06', endsOn: '2027-06-25' } }));
// The boards' November 2026 series, with an entry deadline ahead.
const deadline = new Date(Date.now() + 40 * 86_400_000).toISOString();
const series = await apiResponse(adm.v1['board-series'].$get({ query: {} }));
const find = (board: string) => series.find((s) => s.boardCode === board && s.month === 'november' && s.year === 2026 && s.label === '');
let cam = find('cambridge');
if (cam) await apiResponse(adm.v1['board-series'][':id'].$put({ param: { id: cam.id }, json: { entryDeadline: deadline, reason: 'the board published its November 2026 deadline (demo)' } }));
else cam = await apiResponse(adm.v1['board-series'].$post({ json: { boardCode: 'cambridge', month: 'november', year: 2026, entryDeadline: deadline } }));
let pea = find('pearson_edexcel');
if (!pea) pea = await apiResponse(adm.v1['board-series'].$post({ json: { boardCode: 'pearson_edexcel', month: 'november', year: 2026, entryDeadline: deadline } }));

// The teacher, the catalogue rows and the IAL units.
const teacher = (await apiResponse(adm.v1.teachers.$post({ json: { name: 'Teacher Demo A' } })))!;
const subject = async (name: string, code: string, council: 'cambridge' | 'pearson_edexcel', level: 'igcse' | 'as_level') =>
  (await apiResponse(adm.v1.subjects.$post({ json: { name, code, council, qualificationLevel: level, courseFee: 0, registrationFee: 0, isOfferedAtSchool: true, isCore: false } }))).id;
const S = {
  bio: await subject('Demo Biology', 'DEMO-BIO', 'cambridge', 'igcse'),
  che: await subject('Demo Chemistry', 'DEMO-CHE', 'cambridge', 'igcse'),
  phy: await subject('Demo Physics', 'DEMO-PHY', 'cambridge', 'igcse'),
  his: await subject('Demo History', 'DEMO-HIS', 'cambridge', 'igcse'),
  geo: await subject('Demo Geography', 'DEMO-GEO', 'cambridge', 'igcse'),
  ma: await subject('Demo Mathematics A.S./A.L.', 'DEMO-IALMA', 'pearson_edexcel', 'as_level'),
};
await apiResponse(adm.v1.catalogue.starter.$post({ json: { set: 'pearson_ial_mathematics' } }));
const cat = await apiResponse(adm.v1.catalogue.$get());
const unit = (code: string) => cat.units.find((u) => u.code === code)!.id;
await apiResponse(adm.v1.catalogue.registrable[':subjectId'].$put({ param: { subjectId: S.ma }, json: { boardCode: 'pearson_edexcel', qualificationId: null, unitIds: ['WMA11', 'WMA12', 'WME01'].map(unit) } }));

// The winter session of 2026 and its links sheet.
const day = 86_400_000;
const session = await apiResponse(adm.v1.sessions.$post({ json: {
  type: 'winter', year: 2026, startDate: new Date(Date.now() - day).toISOString(), endDate: new Date(Date.now() + 30 * day).toISOString(),
  courseStartsOn: new Date().toISOString().slice(0, 10), paymentDueAt: new Date(Date.now() + 30 * day).toISOString(),
} }));
if (session.status === 'draft') await apiResponse(adm.v1.sessions[':id'].activate.$post({ param: { id: session.id } }));
const whole = (seriesId: string) => [{ label: 'Whole subject', kind: 'whole' as const, enters: { kind: 'subject' as const }, boardSeriesId: seriesId, availability: 'open' as const, requiredInSeries: false }];
for (const [sid, fee] of [[S.bio, 12000], [S.che, 12000], [S.phy, 12000], [S.his, 11000], [S.geo, 11000]] as const) {
  await apiResponse(adm.v1.sessions[':id'].offers.$post({ param: { id: session.id }, json: { subjectId: sid, availability: 'open', courseFee: fee, grade10Core: false, teachers: [{ teacherId: teacher.id, mode: 'in_school' }], items: whole(cam.id) } }));
}
const unitItem = (label: string, code: string) => ({ label, kind: 'unit' as const, enters: { kind: 'units' as const, unitIds: [unit(code)] }, boardSeriesId: pea!.id, availability: 'open' as const, requiredInSeries: false });
await apiResponse(adm.v1.sessions[':id'].offers.$post({ param: { id: session.id }, json: {
  subjectId: S.ma, availability: 'open', courseFee: 9000, grade10Core: false, teachers: [{ teacherId: teacher.id, mode: 'in_school' }],
  items: [unitItem('P1', 'WMA11'), unitItem('P2', 'WMA12'), unitItem('M1', 'WME01')],
} }));
// The fee grids: Geography has no row yet; History's is provisional (the board has not published).
await apiResponse(adm.v1['board-fees'].$put({ query: { seriesId: cam.id }, json: { rows: [
  { keyKind: 'subject', keyId: S.bio, amount: 10850, provisional: false },
  { keyKind: 'subject', keyId: S.che, amount: 10850, provisional: false },
  { keyKind: 'subject', keyId: S.phy, amount: 10850, provisional: false },
  { keyKind: 'subject', keyId: S.his, amount: 9850, provisional: true },
] } }));
await apiResponse(adm.v1['board-fees'].$put({ query: { seriesId: pea.id }, json: { rows: ['WMA11', 'WMA12', 'WME01'].map((c) => ({ keyKind: 'unit' as const, keyId: unit(c), amount: 5140, provisional: false })) } }));

// The synthetic sheet.
const C = 'I confirm my registration';
const header: Cell[] = ['Student Name', 'Class & Grade', 'Specification', 'Subject', 'Teacher', 'Student No.', 'Student Email', '', 'Parent Email', 'Parent No.', '', '', ''];
const who = (n: number) => [`Demo Student ${n}`, '11A'] as const;
const line = (n: number, spec: string, subj: string, t: string, self: 'Yes' | 'No', note = ''): Cell[] =>
  [who(n)[0], who(n)[1], spec, subj, t, `0101000000${n}`, `demo.student${n}@example.test`, `Demo Parent ${n}`, `demo.parent${n}@example.test`, `0102000000${n}`, C, self, note];
const sheet = workbook([
  { name: 'Nov 2026', rows: [['Nov. 2026 Session'], header,
    line(1, 'O.L.', 'Demo Biology', 'Teacher Demo A', 'No'),
    line(1, 'O.L.', 'Demo History', 'Teacher Demo A', 'No'),
    line(1, 'O.L.', 'Demo Geography', 'Teacher Demo A', 'No'),
    line(2, 'O.L.', 'Demo Biology', '', 'Yes'),
    line(2, 'O.L.', 'Demo Chemistry', '', 'Yes', 'Retake Self Study 50% fees (All Papers) From June 2026'),
    line(2, 'O.L.', 'Demo Physics', '', 'Yes'),
    line(3, 'O.L.', 'Demo Physics', 'Teacher Demo A', 'No', 'Retake in School 100% fees (All Papers)'),
    line(3, 'A.S.', 'Pure Mathematics 1 (P1)', 'Teacher Demo A', 'No'),
    line(4, 'A.S.', 'Mathematics (P1 & P2)', 'Teacher Demo A', 'No'),
  ] },
  { name: 'June 2026', rows: [['June 2026 Session'], header, [`Demo Student 2`, '10A', 'O.L.', 'Demo Biology', 'Teacher Demo A', '01010000002', 'demo.student2@example.test', 'Demo Parent 2', 'demo.parent2@example.test', '01020000002', C, 'No', '']] },
]);
writeFileSync('/tmp/f7/drive/demo-sheet.xlsx', sheet);
writeFileSync('/tmp/f7/drive/seed.json', JSON.stringify({ sessionId: session.id, sessionName: session.name, cambridge: cam.id, pearson: pea.id, subjects: S, teacher: teacher.id }, null, 1));
console.log('seeded', session.name);
