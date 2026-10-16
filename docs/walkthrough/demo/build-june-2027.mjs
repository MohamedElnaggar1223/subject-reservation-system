#!/usr/bin/env node
/**
 * Rebuilds the walkthrough's June 2027 cycle through the API, from a database set up as Part 1 of
 * docs/walkthrough/index.html leaves it (migrated, the first admin signed up and promoted by the seed).
 * It makes what Part 2's set-up makes on the screens — the school's name, the team, the catalogue the 25
 * forms need, the June 2027 session and its sheet in the forms' words, the fees from the boards' lists,
 * the boards' dates, the session opened and the reminders turned on — so that the walkthrough's later
 * steps (the desk, the families of Parts 3 and 4) can be followed on it exactly as written.
 *
 * Placeholders only: Teacher 1 … Teacher 33, "External Team", demo accounts @igcse.local, placeholder
 * course fees. Nothing of the school's own sheet.
 *
 * Usage (Node 22, no dependency; the API running):
 *   node docs/walkthrough/demo/build-june-2027.mjs
 * Environment (defaults in brackets):
 *   API      the API's address        [http://localhost:3001]
 *   ORIGIN   the web app's address    [http://localhost:3000]  (the API trusts only its CORS_ORIGINS)
 *   ADMIN_EMAIL, ADMIN_PASSWORD       [admin@igcse.local, AdminPass1]
 * Every step looks for what it makes first, so a second run changes nothing.
 */
import {
  ADMIN, SCHOOL_NAME, STAFF, PASSWORD, TEACHER_COUNT, T, teacherEmail, EXTERNAL, SUBJECTS_CSV, SEED_SAMPLES_RETIRED,
  UNITS, AWARDS, MAPS, SHEET, FEES_PASTE, FEES_TYPED, DEADLINES, SESSION,
} from './cycle-data.mjs';

const API = process.env.API ?? 'http://localhost:3001';
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:3000';
const say = (...a) => console.log(...a);

async function signIn(email, password) {
  const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  if (r.status !== 200) throw new Error(`sign-in ${email}: ${r.status} ${await r.text()}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return async (method, path, body) => {
    const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 400)}`);
    return json?.data ?? json;
  };
}

const admin = await signIn(process.env.ADMIN_EMAIL ?? ADMIN.email, process.env.ADMIN_PASSWORD ?? ADMIN.password);
const list = (x, ...keys) => (Array.isArray(x) ? x : keys.map((k) => x?.[k]).find(Array.isArray) ?? []);
const settingsList = async () => list(await admin('GET', '/v1/settings'), 'settings');

// ── Part 1's last step: the school's name on sign-in ──────────────────────────────────────────────────
if (!(await settingsList()).find((s) => s.key === 'school.name')?.value) {
  await admin('PUT', '/v1/settings/school.name', { value: SCHOOL_NAME, reason: "The school's name on the sign-in page" });
}
say('school name set');

// ── The team: a coordinator, a finance officer, the teachers ──────────────────────────────────────────
const users = list(await admin('GET', '/v1/users'), 'users');
const has = (email) => users.some((u) => u.email === email);
for (const s of STAFF) if (!has(s.email)) await admin('POST', '/v1/users', { name: s.name, email: s.email, password: PASSWORD, role: s.role });
for (let n = 1; n <= TEACHER_COUNT; n++) {
  if (!has(teacherEmail(n))) await admin('POST', '/v1/users', { name: T(n), email: teacherEmail(n), password: PASSWORD, role: 'teacher', newTeacherRecord: true });
}
say(`team: ${STAFF.length} staff, ${TEACHER_COUNT} teachers`);

// ── The catalogue: the forms' subjects, the seed's samples retired, the starter sets, papers, awards ──
const COUNCIL = { Cambridge: 'cambridge', 'Pearson Edexcel': 'pearson_edexcel', Oxford: 'oxford' };
const LEVEL = { IGCSE: 'igcse', 'AS Level': 'as_level', 'A Level': 'a_level' };
const subjectsList = async () => list(await admin('GET', '/v1/subjects'), 'subjects');
let subjects = await subjectsList();
for (const [name, code, council, level, fee] of SUBJECTS_CSV) {
  if (!subjects.some((s) => s.code === code)) {
    await admin('POST', '/v1/subjects', { name, code, council: COUNCIL[council], qualificationLevel: LEVEL[level], courseFee: fee, registrationFee: 0, isOfferedAtSchool: true, isCore: false });
  }
}
subjects = await subjectsList();
for (const code of SEED_SAMPLES_RETIRED) {
  const s = subjects.find((x) => x.code === code);
  if (!s || s.isActive === false) continue;
  if (s.isCore) await admin('PUT', `/v1/subjects/${s.id}/core`, { isCore: false });
  await admin('DELETE', `/v1/subjects/${s.id}`);
}
say(`subjects: ${SUBJECTS_CSV.length} of the forms; the seed's samples not on the forms deactivated`);

for (const set of ['pearson_ial_mathematics', 'pearson_ial_biology']) await admin('POST', '/v1/catalogue/starter', { set });
let cat = await admin('GET', '/v1/catalogue');
for (const u of UNITS) {
  if (!cat.units.some((x) => x.boardCode === u.board && x.code === u.code)) {
    await admin('POST', '/v1/catalogue/units', { boardCode: u.board, code: u.code, shortCode: u.short, title: u.title, unitLevel: u.level, kind: u.kind });
  }
}
cat = await admin('GET', '/v1/catalogue');
const qualOf = (a) => cat.qualifications.find((q) => q.boardCode === a.board && q.code === a.code && q.level === a.level);
for (const a of AWARDS) {
  if (!qualOf(a)) {
    await admin('POST', '/v1/catalogue/qualifications', { boardCode: a.board, code: a.code, title: a.title, level: a.level, suite: a.suite, subjectArea: a.area, entryMethod: a.method, tier: null });
  }
}
cat = await admin('GET', '/v1/catalogue');
const unitId = (board, code) => cat.units.find((x) => x.boardCode === board && x.code === code).id;
for (const a of AWARDS) {
  const q = qualOf(a);
  if (a.units?.length && !(q.units ?? []).length) {
    await admin('PUT', `/v1/catalogue/qualifications/${q.id}/units`, { units: a.units.map((c) => ({ unitId: unitId(a.board, c), requirement: 'required', choiceGroup: null })) });
  }
  for (const o of a.options ?? []) {
    if (!(q.options ?? []).some((x) => x.code === o.code)) {
      await admin('POST', `/v1/catalogue/qualifications/${q.id}/options`, { code: o.code, label: o.label, unitIds: [], carryForward: o.cf });
    }
  }
}
cat = await admin('GET', '/v1/catalogue');
for (const [code, m] of MAPS) {
  const r = cat.registrable.find((x) => x.code === code);
  if (r.mapped) continue;
  const q = m.award ? cat.qualifications.find((x) => x.boardCode === r.council && x.code === m.award && x.level === r.qualificationLevel) : null;
  await admin('PUT', `/v1/catalogue/registrable/${r.id}`, {
    boardCode: r.council, qualificationId: q?.id ?? null, unitIds: (m.units ?? []).map((c) => unitId(r.council, c)), reason: 'The June 2027 forms (walkthrough demo)',
  });
}
say(`catalogue: ${UNITS.length} papers, ${AWARDS.length} awards and the two IAL starter sets, ${MAPS.length} subjects mapped`);

// ── The June 2027 session ─────────────────────────────────────────────────────────────────────────────
const sessionsList = async () => list(await admin('GET', '/v1/sessions'), 'sessions');
let june = (await sessionsList()).find((s) => s.sessionType === SESSION.type && s.seriesYear === SESSION.year);
if (!june) {
  // The dates as the screen reads them: the computer's own clock, as a datetime-local field gives them.
  await admin('POST', '/v1/sessions', {
    type: SESSION.type, year: SESSION.year, startDate: new Date(SESSION.from).toISOString(), endDate: new Date(SESSION.to).toISOString(),
    courseStartsOn: SESSION.courseStarts, paymentDueAt: new Date(SESSION.due).toISOString(),
  });
  june = (await sessionsList()).find((s) => s.sessionType === SESSION.type && s.seriesYear === SESSION.year);
}
say(`session: ${june.name}`);

// ── The sheet: each form's subject with its own options ──────────────────────────────────────────────
let teachers = list(await admin('GET', '/v1/teachers'), 'teachers');
const tid = (name) => teachers.find((t) => t.name === name)?.id;
const pick = (names = [], online = []) => names.map((n) => ({ teacherId: tid(n), mode: online.includes(n) ? 'online' : 'in_school' }));
const offersOf = async () => (await admin('GET', `/v1/sessions/${june.id}/offers`)).offers;
const routeOf = (i) => (i.qualification?.level === 'as_level' ? 'A.S.' : i.needsPriorSeries ? 'A.2.' : 'A.L.');
let offers = await offersOf();
subjects = await subjectsList();
for (const s of SHEET) {
  const subject = subjects.find((x) => x.code === s.code);
  if (!offers.some((o) => o.subjectId === subject.id)) {
    const set = pick(s.teachers, s.online);
    if (s.external) set.push(tid(EXTERNAL) ? { teacherId: tid(EXTERNAL), mode: 'in_school' } : { providerName: EXTERNAL, mode: 'in_school' });
    await admin('POST', `/v1/sessions/${june.id}/offers`, { subjectId: subject.id, availability: s.offered, courseFee: s.fee, teachers: set, grade10Core: false, courseStartsOn: null, notes: null });
    if (s.external) teachers = list(await admin('GET', '/v1/teachers'), 'teachers');
    offers = await offersOf();
  }
  const offer = offers.find((o) => o.subjectId === subject.id);
  const items = [];
  for (const [paper, [availability, fee]] of Object.entries(s.papers ?? {})) {
    const it = offer.items.find((i) => i.kind === 'one_paper' && i.units[0]?.shortCode === paper);
    if (it && it.availability !== availability) items.push({ itemId: it.id, availability, courseFee: fee ?? null });
  }
  for (const [route, availability] of Object.entries(s.routes ?? {})) {
    const it = offer.items.find((i) => i.kind === 'route' && routeOf(i) === route);
    if (it && it.availability !== availability) items.push({ itemId: it.id, availability, courseFee: null });
  }
  for (const [code, [availability, names, online]] of Object.entries(s.units ?? {})) {
    const it = offer.items.find((i) => i.kind === 'unit' && i.units[0]?.code === code);
    if (it && (it.availability !== availability || (availability === 'open' && !it.teachers.length))) {
      items.push({ itemId: it.id, availability, courseFee: null, teachers: availability === 'open' ? pick(names, online) : [] });
    }
  }
  if (items.length) {
    await admin('PUT', `/v1/sessions/${june.id}/offers/${offer.id}/form`, {
      teachers: offer.teachers.map((t) => ({ teacherId: t.teacherId, mode: t.mode })), availability: offer.availability, courseFee: offer.courseFee,
      items, grade10Core: offer.grade10Core, courseStartsOn: offer.courseStartsOn ?? null, notes: offer.notes ?? null,
    });
  }
  // Arabic A.L.: the second qualification (GCE 9AA0) — the item endpoint, as no screen adds one.
  if (s.second && !offer.items.some((i) => i.kind === 'qualification')) {
    const gce = cat.qualifications.find((q) => q.boardCode === subject.council && q.code === s.second.award);
    const whole = offer.items.find((i) => i.kind === 'whole');
    await admin('PUT', `/v1/sessions/${june.id}/offers/${offer.id}/items/${whole.id}`, { label: 'Arabic IAL (YAA01)', exclusiveGroup: 'qualification', teachers: pick(s.teachers) });
    await admin('POST', `/v1/sessions/${june.id}/offers/${offer.id}/items`, {
      label: 'Arabic GCE (9AA0)', kind: 'qualification', enters: { kind: 'award', qualificationId: gce.id }, availability: 'open', requiredInSeries: false,
      exclusiveGroup: 'qualification', teachers: pick([s.second.teacher]),
    });
  }
}
say(`sheet: ${SHEET.length} subjects`);

// ── The fees from the boards' lists; the rows no list has, typed and left provisional ────────────────
june = (await sessionsList()).find((s) => s.id === june.id);
for (const series of june.boardSeries) {
  const lines = FEES_PASTE[series.boardCode] ?? [];
  const grid = await admin('GET', `/v1/board-fees?seriesId=${series.id}`);
  if (lines.length && grid.rows.length === 0) {
    const parsed = await admin('POST', `/v1/board-fees/${series.id}/parse`, { text: lines.join('\n') });
    if (parsed.unknown.length) say('  not recognised:', parsed.unknown.map((u) => u.line).join(' | '));
    await admin('PUT', `/v1/board-fees?seriesId=${series.id}`, { rows: parsed.matched.map((m) => ({ keyKind: m.keyKind, keyId: m.keyId, amount: m.amount, provisional: false })) });
  }
  const typed = FEES_TYPED[series.boardCode] ?? {};
  const after = await admin('GET', `/v1/board-fees?seriesId=${series.id}`);
  const rows = after.missing.filter((m) => typed[m.code] !== undefined).map((m) => ({ keyKind: m.keyKind, keyId: m.keyId, amount: typed[m.code], provisional: true }));
  if (rows.length) await admin('PUT', `/v1/board-fees?seriesId=${series.id}`, { rows });
  say(`fees: ${series.name}: ${lines.length} lines pasted, ${rows.length} typed (not published yet)`);
}

// ── The boards' dates ─────────────────────────────────────────────────────────────────────────────────
for (const series of june.boardSeries) {
  const d = DEADLINES[series.boardName];
  if (!d || series.entryDeadline) continue;
  await admin('PUT', `/v1/board-series/${series.id}`, {
    entryDeadline: new Date(`${d.entry}T23:59`).toISOString(), ...(d.retake ? { retakeDeadline: new Date(`${d.retake}T23:59`).toISOString() } : {}),
    reason: `${series.boardName} key dates for June 2027`,
  });
}
say('dates set');

// ── Open the session; the reminders on ───────────────────────────────────────────────────────────────
if (june.status === 'draft') await admin('POST', `/v1/sessions/${june.id}/activate`);
if ((await settingsList()).find((s) => s.key === 'reminders.enabled')?.value !== true) {
  await admin('PUT', '/v1/settings/reminders.enabled', { value: true, reason: 'June 2027 is open: its sheet and fees are checked' });
}
say('June 2027 open; reminders on. Done.');
