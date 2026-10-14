// F4's known sittings on B's dev copy (placeholder names): a Cambridge IGCSE syllabus mapped to a
// subject, offered in a winter session whose November series sets a retake deadline; two families
// with June's sitting on record in F4's tables — a result (B) and an entry sent to the board.
import { readFileSync } from 'node:fs';
import pg from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-reservations/packages/db/node_modules/pg/lib/index.js';
const API = 'http://localhost:3111';
const ORIGIN = 'http://localhost:3110';
const env = readFileSync('/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-reservations/apps/api/.env', 'utf8');
const DB = env.split('\n').find((l) => l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim();
const demo = JSON.parse(readFileSync('/tmp/rwb/demo-B.json', 'utf8'));
const days = (n) => new Date(Date.now() + n * 86_400_000);
const cairoDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
async function signIn(email, password) {
  const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`sign-in ${email}: ${r.status}`);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
function client(cookie) {
  const call = async (method, path, body) => {
    const r = await fetch(`${API}/v1${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
    return j.data ?? j;
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b) };
}
const adm = client(await signIn('admin@igcse.local', process.env.DEV_ADMIN_PASSWORD));
const officer = client(await signIn('officer.mona@igcse.local', process.env.DEV_PASSWORD));
const tag = `f4${Date.now() % 100000}`;
const Y = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;

const award = await adm.post('/catalogue/qualifications', { boardCode: 'cambridge', code: `C${tag}`.toUpperCase().slice(0, 8), title: `Chemistry ${tag}`, level: 'igcse', suite: 'Cambridge IGCSE', subjectArea: `Chemistry ${tag}`, entryMethod: 'syllabus_option' });
const chem = (await adm.post('/subjects', { name: `Chemistry O.L. (demo ${tag})`, code: `DB-CHE-${tag}`, council: 'cambridge', courseFee: 12000, registrationFee: 9000, isOfferedAtSchool: true, isCore: false })).id;
await adm.put(`/catalogue/registrable/${chem}`, { boardCode: 'cambridge', qualificationId: award.id, unitIds: [] });
const june = (await adm.post('/board-series', { boardCode: 'cambridge', month: 'june', year: Y, label: `demo-${tag}` })).id;
const nov = (await adm.post('/board-series', { boardCode: 'cambridge', month: 'november', year: Y, label: `demo-${tag}`, entryDeadline: days(20), retakeDeadline: days(25) })).id;
await adm.put(`/board-fees?seriesId=${nov}`, { rows: [{ keyKind: 'qualification', keyId: award.id, amount: 9000, provisional: false }] });
const session = await adm.post('/sessions', { type: 'winter', year: Y, label: `demo ${tag}`, startDate: days(-1).toISOString(), endDate: days(60).toISOString(), courseStartsOn: cairoDate(new Date()), paymentDueAt: days(15).toISOString() });
await adm.post(`/sessions/${session.id}/offers`, { subjectId: chem, courseFee: 12000, teachers: [{ teacherId: demo.tA, mode: 'in_school' }],
  items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'award', qualificationId: award.id }, boardSeriesId: nov, availability: 'open', requiredInSeries: false }] });
const onboard = (t) => officer.post('/links/desk-onboard', {
  parent: { email: `parent.${t}@igcse.local`, name: `Parent ${t}`, password: process.env.DEV_PASSWORD, phone: '01000000009' },
  student: { email: `student.${t}@igcse.local`, name: `Student ${t}`, password: process.env.DEV_PASSWORD, phone: '01111111119', grade: 11 },
});
const fR = await onboard(`${tag}r`);
const fE = await onboard(`${tag}e`);
const c = new pg.Client({ connectionString: DB });
await c.connect();
await c.query(`insert into exam_result (id, student_id, board_series_id, board_code, kind, code, qualification_id, grade, source, status)
  values (gen_random_uuid(), $1, $2, 'cambridge', 'award', $3, $4, 'B', 'manual', 'provisional')`, [fR.student.id, june, award.code, award.id]);
await c.query(`insert into exam_entry (id, student_id, board_series_id, board_code, kind, qualification_id, entry_code, title, status, submitted_at)
  values (gen_random_uuid(), $1, $2, 'cambridge', 'award', $3, $4, 'Chemistry', 'submitted', now())`, [fE.student.id, june, award.id, award.code]);
await c.end();
console.log(JSON.stringify({ tag, session: session.id, resultFamily: `${tag}r`, entryFamily: `${tag}e`, subject: `Chemistry O.L. (demo ${tag})` }));
