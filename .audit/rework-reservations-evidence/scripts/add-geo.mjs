// Credentials of the local dev container and its demo accounts are read from the environment (DEV_PASSWORD, DEV_ADMIN_PASSWORD, DEV_PG_ADMIN_URL, DEV_PG_BASE_URL).
// A third O.L. subject with two teachers in the demo session, for §11's desk count. Placeholder names.
import { readFileSync } from 'node:fs';
const API = 'http://localhost:3111';
const ORIGIN = 'http://localhost:3110';
const demo = JSON.parse(readFileSync('/tmp/rwb/demo-B.json', 'utf8'));
const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email: 'admin@igcse.local', password: process.env.DEV_ADMIN_PASSWORD }) });
const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const call = async (method, path, body) => {
  const res = await fetch(`${API}/v1${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j.data ?? j;
};
const series = (await call('POST', '/board-series', { boardCode: 'cambridge', month: 'june', year: 2027, label: 'demo-B-g', entryDeadline: new Date(Date.now() + 90_000), retakeDeadline: new Date(Date.now() + 30 * 86_400_000) })).id;
const chem = (await call('POST', '/subjects', { name: 'Geography O.L. (demo B)', code: 'DB-GEO-B', council: 'cambridge', courseFee: 1000, registrationFee: 500, isOfferedAtSchool: true, isCore: false })).id;
await call('PUT', `/board-fees?seriesId=${series}`, { rows: [{ keyKind: 'subject', keyId: chem, amount: 9200, provisional: false }] });
await call('POST', `/sessions/${demo.sessionId}/offers`, {
  subjectId: chem, courseFee: 13000, teachers: [demo.tA, demo.tB].map((teacherId) => ({ teacherId, mode: 'in_school' })),
  items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: series, availability: 'open', requiredInSeries: false }],
});
console.log('geography offered', chem);
