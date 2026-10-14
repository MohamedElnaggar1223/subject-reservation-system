// F6a dev data on igcse_words_dev (port 3151), through the API as the admin and a coordinator —
// what the Catalogue, Team and Sessions screens do. Never a migration or a seed. Re-runnable: each
// step looks for what it makes first. Documented in docs/features/SESSION_WORDS.md §7.
const API = 'http://localhost:3151';
const ORIGIN = 'http://localhost:3150';
const out = (...a) => console.log(...a);

async function signIn(email, password) {
  const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  if (r.status !== 200) throw new Error(`sign-in ${email}: ${r.status} ${await r.text()}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return async (method, path, body) => {
    const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 400)}`);
    return json?.data ?? json;
  };
}

const admin = await signIn('admin@igcse.local', 'AdminPass1');

// ── Team: a coordinator and three teachers (placeholders), one external team made through the form later ──
const users = await admin('GET', '/v1/users?role=coordinator').catch(() => []);
let coordinatorEmail = 'coordinator.words@igcse.local';
if (!(Array.isArray(users) ? users : users.users ?? []).some((u) => u.email === coordinatorEmail)) {
  await admin('POST', '/v1/users', { name: 'Coordinator W', email: coordinatorEmail, password: 'TestPass1', role: 'coordinator' }).catch((e) => out('coordinator:', e.message));
}
const coord = await signIn(coordinatorEmail, 'TestPass1');
const teachers = await admin('GET', '/v1/teachers');
const teacherId = async (name) => (teachers.find((t) => t.name === name) ?? await admin('POST', '/v1/teachers', { name })).id;
const tA = await teacherId('Teacher A');
const tB = await teacherId('Teacher B');
const tC = await teacherId('Teacher C');
out('teachers', tA, tB, tC);

const cat = await coord('GET', '/v1/catalogue');
const subjects = await admin('GET', '/v1/subjects?includeInactive=true').catch(() => admin('GET', '/v1/subjects'));
const subjectList = Array.isArray(subjects) ? subjects : subjects.subjects ?? subjects.items ?? [];
const qual = (board, code, level) => cat.qualifications.find((q) => q.boardCode === board && q.code === code && (!level || q.level === level));
const unitOf = (board, code) => cat.units.find((u) => u.boardCode === board && u.code === code);
const mkUnit = async (board, code, shortCode, title, unitLevel, kind) => unitOf(board, code)?.id ?? (await coord('POST', '/v1/catalogue/units', { boardCode: board, code, shortCode, title, unitLevel, kind })).id;
const subjectByCode = (code) => subjectList.find((s) => s.code === code);
const mkSubject = async (code, name, council, level, courseFee) => subjectByCode(code)?.id
  ?? (await admin('POST', '/v1/subjects', { name, code, council, qualificationLevel: level, courseFee, registrationFee: 0, isOfferedAtSchool: true, isCore: false })).id;

// ── Shape 1–2: Cambridge IGCSE Biology (0610) with its papers: Paper 2 and Paper 4 (41/42), required ──
const bioQ = qual('cambridge', '0610');
const p2 = await mkUnit('cambridge', '0610/21', 'Paper 2', 'Multiple Choice (Extended)', 'igcse', 'component');
const p4 = await mkUnit('cambridge', '0610/41', 'Paper 4', 'Theory (Extended)', 'igcse', 'component');
await coord('PUT', `/v1/catalogue/qualifications/${bioQ.id}/units`, { units: [{ unitId: p2, requirement: 'required' }, { unitId: p4, requirement: 'required' }] });
out('biology papers', p2, p4);

// ── Shape 4: Pearson IAL Mathematics — the starter set, and the parent row "Mathematics A.S./A.L." ──
await coord('POST', '/v1/catalogue/starter', { set: 'pearson_ial_mathematics' });
const cat2 = await coord('GET', '/v1/catalogue');
const ialUnits = ['WMA11', 'WMA12', 'WMA13', 'WMA14', 'WME01', 'WST01'].map((c) => cat2.units.find((u) => u.boardCode === 'pearson_edexcel' && u.code === c).id);
const ialMaths = await mkSubject('IAL-MATHS', 'Mathematics A.S./A.L.', 'pearson_edexcel', 'a_level', 4000);
await coord('PUT', `/v1/catalogue/registrable/${ialMaths}`, { boardCode: 'pearson_edexcel', qualificationId: null, unitIds: ialUnits, reason: 'F6a dev: the IAL parent row' });

// ── Shape 5: a Cambridge A level, Physics 9702: A.S. (S1), A.2. carry forward (BX), A.L. (AX) ──
let asQ = qual('cambridge', '9702', 'as_level')?.id;
if (!asQ) asQ = (await coord('POST', '/v1/catalogue/qualifications', { boardCode: 'cambridge', code: '9702', title: 'Physics (AS Level)', level: 'as_level', suite: 'Cambridge International AS & A Level', subjectArea: 'Physics', entryMethod: 'syllabus_option' })).id;
let alQ = qual('cambridge', '9702', 'a_level')?.id;
if (!alQ) alQ = (await coord('POST', '/v1/catalogue/qualifications', { boardCode: 'cambridge', code: '9702', title: 'Physics (A Level)', level: 'a_level', suite: 'Cambridge International AS & A Level', subjectArea: 'Physics', entryMethod: 'syllabus_option' })).id;
const cat3 = await coord('GET', '/v1/catalogue');
const hasOpt = (qid, code) => (cat3.qualifications.find((q) => q.id === qid)?.options ?? []).some((o) => o.code === code);
if (!hasOpt(asQ, 'S1')) await coord('POST', `/v1/catalogue/qualifications/${asQ}/options`, { code: 'S1', label: 'AS Level', unitIds: [], carryForward: false });
if (!hasOpt(alQ, 'BX')) await coord('POST', `/v1/catalogue/qualifications/${alQ}/options`, { code: 'BX', label: 'A2, carrying the AS forward', unitIds: [], carryForward: true });
if (!hasOpt(alQ, 'AX')) await coord('POST', `/v1/catalogue/qualifications/${alQ}/options`, { code: 'AX', label: 'A Level in one sitting', unitIds: [], carryForward: false });
const physAL = await mkSubject('9702', 'Physics A.S./A.L.', 'cambridge', 'as_level', 14000);
await coord('PUT', `/v1/catalogue/registrable/${physAL}`, { boardCode: 'cambridge', qualificationId: asQ, unitIds: [], reason: 'F6a dev: the AS award' });

// ── Shape 6: Edexcel Arabic A level, two qualifications: IAL (YAA01) and GCE (9AA0) ──
let ialAr = qual('pearson_edexcel', 'YAA01')?.id;
if (!ialAr) ialAr = (await coord('POST', '/v1/catalogue/qualifications', { boardCode: 'pearson_edexcel', code: 'YAA01', title: 'Arabic (International A Level)', level: 'a_level', suite: 'International A Level', subjectArea: 'Arabic', entryMethod: 'units_cash_in' })).id;
let gceAr = qual('pearson_edexcel', '9AA0')?.id;
if (!gceAr) gceAr = (await coord('POST', '/v1/catalogue/qualifications', { boardCode: 'pearson_edexcel', code: '9AA0', title: 'Arabic (GCE A Level)', level: 'a_level', suite: 'GCE A Level', subjectArea: 'Arabic', entryMethod: 'qualification' })).id;
const arabicAL = await mkSubject('ARABIC-AL', 'Arabic A.L.', 'pearson_edexcel', 'a_level', 9000);
await coord('PUT', `/v1/catalogue/registrable/${arabicAL}`, { boardCode: 'pearson_edexcel', qualificationId: ialAr, unitIds: [], reason: 'F6a dev: the IAL award; the GCE is a second item' });

out(JSON.stringify({ tA, tB, tC, bioQ: bioQ.id, ialMaths, physAL, arabicAL, gceAr, ialAr }));
