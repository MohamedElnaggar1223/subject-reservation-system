// Credentials of the local dev container and its demo accounts are read from the environment (DEV_PASSWORD, DEV_ADMIN_PASSWORD, DEV_PG_ADMIN_URL, DEV_PG_BASE_URL).
// Demo data for driving step B's screens on igcse_rwb_dev (API 3111). Placeholder names only.
const API = 'http://localhost:3111';
const ORIGIN = 'http://localhost:3110';
const days = (n) => new Date(Date.now() + n * 86_400_000);

async function signIn(email, password) {
  const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`sign-in ${email}: ${r.status} ${await r.text()}`);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
function client(cookie) {
  const call = async (method, path, body) => {
    const r = await fetch(`${API}/v1${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
    return j.data ?? j;
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b) };
}

const adm = client(await signIn('admin@igcse.local', process.env.DEV_ADMIN_PASSWORD));
const officer = client(await signIn('officer.mona@igcse.local', process.env.DEV_PASSWORD));
const Y = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const tag = process.argv[2] ?? 'B';

const tA = (await adm.post('/teachers', { name: `Teacher A (demo ${tag})` })).id;
const tB = (await adm.post('/teachers', { name: `Teacher B (demo ${tag})` })).id;
const sub = async (code, name, extra = {}) => (await adm.post('/subjects', { name, code, council: 'cambridge', courseFee: 1000, registrationFee: 500, isOfferedAtSchool: true, isCore: false, ...extra })).id;
const bio = await sub(`DB-BIO-${tag}`, `Biology O.L. (demo ${tag})`);
const mat = await sub(`DB-MAT-${tag}`, `Mathematics O.L. (demo ${tag})`, { council: 'pearson_edexcel' });
const sta = await sub(`DB-STA-${tag}`, `Statistics O.L. (demo ${tag})`, { council: 'pearson_edexcel' });
const phy = await sub(`DB-PHY-${tag}`, `Physics A.S./A.L. (demo ${tag})`, { qualificationLevel: 'a_level' });

const series = async (boardCode, label, dates) => (await adm.post('/board-series', { boardCode, month: 'june', year: Y + 1, label, ...dates })).id;
const camJ = await series('cambridge', `demo-${tag}`, { entryDeadline: days(60), retakeDeadline: days(66) });
const peaJ = await series('pearson_edexcel', `demo-${tag}`, { entryDeadline: days(50) });
const peaP = await series('pearson_edexcel', `demo-${tag}-p`, { entryDeadline: days(52) });
const fee = (seriesId, keyId, amount, provisional = false) => adm.put(`/board-fees?seriesId=${seriesId}`, { rows: [{ keyKind: 'subject', keyId, amount, provisional }] });
await fee(camJ, bio, 9200); await fee(camJ, phy, 8000); await fee(peaJ, mat, 4600); await fee(peaP, sta, 9000, true);

const session = await adm.post('/sessions', {
  type: 'june', year: Y + 1, label: `demo ${tag}`, startDate: days(-1).toISOString(), endDate: days(90).toISOString(),
  courseStartsOn: new Date().toISOString().slice(0, 10), paymentDueAt: days(30).toISOString(),
});
const offer = (subjectId, courseFee, seriesId, teachers, item = {}) => adm.post(`/sessions/${session.id}/offers`, {
  subjectId, courseFee, teachers: teachers.map((teacherId) => ({ teacherId, mode: 'in_school' })),
  items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: seriesId, availability: 'open', requiredInSeries: false, ...item }],
});
await offer(bio, 14000, camJ, [tA, tB]);
await offer(mat, 10000, peaJ, [tA]);
await offer(sta, 1000, peaP, [tB]);
await offer(phy, 16000, camJ, [tA], { label: 'A.2., carry forward', kind: 'route', needsPriorSeries: true });

const fam = await officer.post('/links/desk-onboard', {
  parent: { email: `parent.demo${tag.toLowerCase()}@igcse.local`, name: `Parent Demo ${tag}`, password: process.env.DEV_PASSWORD, phone: '01000000000' },
  student: { email: `student.demo${tag.toLowerCase()}@igcse.local`, name: `Student Demo ${tag}`, password: process.env.DEV_PASSWORD, phone: '01111111111', grade: 11 },
});
const fam2 = await officer.post('/links/desk-onboard', {
  parent: { email: `parent.demo${tag.toLowerCase()}2@igcse.local`, name: `Parent Demo ${tag}2`, password: process.env.DEV_PASSWORD, phone: '01000000002' },
  student: { email: `student.demo${tag.toLowerCase()}2@igcse.local`, name: `Student Demo ${tag}2`, password: process.env.DEV_PASSWORD, phone: '01111111112', grade: 11 },
});
console.log(JSON.stringify({ sessionId: session.id, name: session.name, student: fam.student.id, student2: fam2.student.id, camJ, peaJ, peaP, tA, tB }, null, 2));
