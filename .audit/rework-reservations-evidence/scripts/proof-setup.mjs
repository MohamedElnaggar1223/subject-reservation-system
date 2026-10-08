// Set-up for the four proof screenshots (the review of 887fad4), on B's dev database through the
// API (placeholder names): a converted session (no refund policy, its own refund window as dates)
// with a family; a grade-10 core offer committed in bulk for a grade-10 family; a declared retake
// reserved at the desk. Prints the ids for proof-drive.mjs.
import { readFileSync } from 'node:fs';
import pg from '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-reservations/packages/db/node_modules/pg/lib/index.js';
const API = 'http://localhost:3111';
const ORIGIN = 'http://localhost:3110';
const demo = JSON.parse(readFileSync('/tmp/rwb/demo-B.json', 'utf8'));
const env = readFileSync('/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-reservations/apps/api/.env', 'utf8');
const DB = env.split('\n').find((l) => l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim();
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
const tag = `pf${Date.now() % 100000}`;
const Y = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const onboard = (t, grade) => officer.post('/links/desk-onboard', {
  parent: { email: `parent.${t}@igcse.local`, name: `Parent ${t}`, password: process.env.DEV_PASSWORD, phone: '01000000009' },
  student: { email: `student.${t}@igcse.local`, name: `Student ${t}`, password: process.env.DEV_PASSWORD, phone: '01111111119', grade },
});
const offer = (sessionId, subjectId, courseFee, seriesId, extra = {}) => adm.post(`/sessions/${sessionId}/offers`, {
  subjectId, courseFee, grade10Core: extra.grade10Core ?? false, teachers: [{ teacherId: demo.tA, mode: 'in_school' }],
  items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: seriesId, availability: 'open', requiredInSeries: false }],
});
const subjects = await adm.get('/subjects');
const bio = (subjects.subjects ?? subjects).find((s) => s.code === 'DB-BIO-B').id;

// 1. A converted session: no refund policy, its own refund window (as dates).
const conv = await adm.post('/sessions', { type: 'june', year: Y + 1, label: `converted ${tag}`, startDate: days(-1).toISOString(), endDate: days(60).toISOString(), courseStartsOn: cairoDate(new Date()), paymentDueAt: days(30).toISOString() });
const c = new pg.Client({ connectionString: DB });
await c.connect();
await c.query('update registration_session set refund_policy = null where id = $1', [conv.id]);
await c.end();
const finadmin = client(await signIn('admin@igcse.local', process.env.DEV_ADMIN_PASSWORD));
await finadmin.post('/receipts/refund-windows', { sessionId: conv.id, startsAt: days(-1).toISOString(), endsAt: days(20).toISOString(), percentage: 70, label: 'proof: a converted session' });
await offer(conv.id, bio, 14000, demo.camJ);
const famC = await onboard(`${tag}c`, 11);

// 2. A grade-10 core offer committed in bulk (the school's consent), for the family's checkout.
const g10 = await adm.post('/sessions', { type: 'june', year: Y + 1, label: `grade 10 ${tag}`, startDate: days(-1).toISOString(), endDate: days(60).toISOString(), courseStartsOn: cairoDate(new Date()), paymentDueAt: days(30).toISOString() });
await offer(g10.id, bio, 14000, demo.camJ, { grade10Core: true });
const famG = await onboard(`${tag}g`, 10);
await adm.post(`/sessions/${g10.id}/grade10/commit`, { studentIds: [famG.student.id] });

// 3. A declared retake reserved at the desk (for the slip's mark).
const famD = await onboard(`${tag}d`, 11);
const offers = await officer.get(`/registrations/offers?sessionId=${demo.sessionId}&studentId=${famD.student.id}`);
const bioItem = offers.offers.find((o) => o.subject.code === 'DB-BIO-B').items[0].id;
const desk = await officer.post('/registrations/desk', { studentId: famD.student.id, sessionId: demo.sessionId, lines: [{ offerItemId: bioItem, attempt: 'retake', mode: 'self_study', priorSitting: { month: 'november', year: Y } }], consent: { refundPolicy: true, declaration: true } });
console.log(JSON.stringify({ tag, conv: conv.id, convFamily: `${tag}c`, g10: g10.id, g10Family: `${tag}g`, g10Student: famG.student.id, deskStudent: famD.student.id, deskLines: desk.registrations.map((r) => r.id) }));
