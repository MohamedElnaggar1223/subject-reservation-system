// Cycle follow-ups: the dev data on igcse_followups_dev (API 3171), through the API as the admin, a
// coordinator, the finance admin and the officer — what the Team, Academic, Sessions, desk and
// Teaching Groups screens do. Never a migration or a seed. Placeholder names only.
// Writes ./state.json with the ids the drive uses. Re-runnable only on a fresh copy.
import { writeFileSync } from 'node:fs';

const API = 'http://localhost:3171';
const ORIGIN = 'http://localhost:3170';
const out = (...a) => console.log(...a);
const PHONE = (p) => `${p}${'0'.repeat(11 - p.length)}`; // built at run time: no number written down

async function signIn(email, password) {
  const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  if (r.status !== 200) throw new Error(`sign-in ${email}: ${r.status} ${await r.text()}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return async (method, path, body) => {
    const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 500)}`);
    return json?.data ?? json;
  };
}

const admin = await signIn('admin@igcse.local', 'AdminPass1');
const officer = await signIn('officer.mona@igcse.local', 'TestPass1');
const finadmin = await signIn('finadmin.rana@igcse.local', 'TestPass1');
const coordinatorEmail = 'coordinator.followups@igcse.local';
await admin('POST', '/v1/users', { name: 'Coordinator FU', email: coordinatorEmail, password: 'TestPass1', role: 'coordinator' }).catch((e) => out('coordinator:', e.message.slice(0, 120)));
const coord = await signIn(coordinatorEmail, 'TestPass1');

// ── Teachers (placeholders) ──
const T = {};
for (const k of ['A', 'B', 'C', 'D', 'H']) T[k] = (await admin('POST', '/v1/teachers', { name: `Teacher ${k}` })).id;
out('teachers', T);

// ── The school's year 2026-27, its first term, four periods a day, three rooms ──
const yearId = (await coord('POST', '/v1/academic/years', { startYear: 2026, startsOn: '2026-09-06', endsOn: '2027-06-25' })).id;
const termId = (await coord('POST', '/v1/academic/terms', { academicYearId: yearId, name: 'Term 1', startsOn: '2026-09-06', endsOn: '2026-12-20' })).id;
const bells = await coord('POST', '/v1/academic/bell-schedules', { academicYearId: yearId, name: 'Regular', isDefault: true });
await coord('PUT', `/v1/academic/bell-schedules/${bells.id}/periods`, {
  periods: [1, 2, 3, 4].map((p) => ({ weekday: null, label: `P${p}`, kind: 'lesson', startsAt: `${String(7 + p).padStart(2, '0')}:00`, endsAt: `${String(7 + p).padStart(2, '0')}:45` })),
});
for (const r of ['1', '2', '3']) await coord('POST', '/v1/academic/rooms', { name: `Room ${r}`, capacity: 30, type: 'classroom', features: [] });

// ── A June 2027 sitting with its entries open, Biology's board fee, a session open now with Biology taught by A, B, C and D ──
const DAY = 86_400_000;
const seriesId = (await admin('POST', '/v1/board-series', { boardCode: 'cambridge', month: 'june', year: 2027, label: 'Follow-ups', entryDeadline: new Date(Date.now() + 60 * DAY).toISOString() })).id;
await finadmin('PUT', `/v1/board-fees?seriesId=${seriesId}`, { rows: [{ keyKind: 'subject', keyId: 'subj_0610', amount: 4000, provisional: false }] });
const sessionId = (await admin('POST', '/v1/sessions', {
  type: 'june', year: 2027, label: 'Follow-ups', startDate: new Date(Date.now() - DAY).toISOString(), endDate: new Date(Date.now() + 45 * DAY).toISOString(),
  courseStartsOn: '2026-09-06', paymentDueAt: new Date(Date.now() + 30 * DAY).toISOString(),
})).id;
const offer = await admin('POST', `/v1/sessions/${sessionId}/offers`, {
  subjectId: 'subj_0610', courseFee: 12000, teachers: ['A', 'B', 'C', 'D'].map((k) => ({ teacherId: T[k], mode: 'in_school' })),
  items: [{ label: 'Whole subject', kind: 'whole', enters: { kind: 'subject' }, boardSeriesId: seriesId, availability: 'open', requiredInSeries: false }],
});
const itemId = offer.items[0];
out('session', sessionId, 'offer', offer.id, 'item', itemId);

// ── Six families, grade 11, onboarded at the desk; each reserves Biology (FU-6 a retake declared at the desk) ──
const F = {};
for (const n of [1, 2, 3, 4, 5, 6]) {
  const r = await officer('POST', '/v1/links/desk-onboard', {
    parent: { email: `parent.fu${n}@igcse.local`, name: `Parent FU-${n}`, password: 'TestPass1', phone: PHONE('010') },
    student: { email: `student.fu${n}@igcse.local`, name: `Student FU-${n}`, password: 'TestPass1', phone: PHONE('011'), grade: 11 },
  });
  F[n] = { studentId: r.student.id };
}
const priorSeries = 'bs_b70e7a49c5586862d54533451b8f9ba8'; // Cambridge June 2026
const teacherOf = { 1: 'A', 2: 'A', 3: 'A', 4: 'D', 5: 'A', 6: 'A' };
for (const n of [1, 2, 3, 4, 5, 6]) {
  const line = n === 6
    ? { offerItemId: itemId, attempt: 'retake', mode: 'in_school', teacherId: T[teacherOf[n]], priorSittingSeriesId: priorSeries, priorSittingSource: 'declared_by_desk' }
    : { offerItemId: itemId, attempt: 'first', mode: 'in_school', teacherId: T[teacherOf[n]] };
  const r = await officer('POST', '/v1/registrations/desk', { studentId: F[n].studentId, sessionId, lines: [line], consent: { refundPolicy: true, declaration: true } });
  F[n].lineId = r.registrations[0].id;
}
out('families', F);

// ── The course enrolments from the lines, then the classes: A's (five), B's (none yet), D's (FU-4), a homeroom for FU-5 ──
await coord('POST', '/v1/enrolments/bulk', { academicYearId: yearId, source: 'registrations', studentIds: Object.values(F).map((f) => f.studentId), subjectMap: [], exclude: [], commit: true });
const mk = async (name, teacherId, studentIds, weeklyPeriods, subjectId = 'subj_0610') => (await coord('POST', '/v1/scheduling/groups', {
  academicYearId: yearId, name, ...(subjectId ? { subjectId } : {}), teacherId, weeklyPeriods, doublePeriods: 0, ...(studentIds.length ? { studentIds } : {}), startsOn: '2026-09-06',
})).id;
const G = {
  A: await mk('Biology 11 — Teacher A', T.A, [1, 2, 3, 5, 6].map((n) => F[n].studentId), 0),
  B: await mk('Biology 11 — Teacher B', T.B, [], 1),
  D: await mk('Biology 11 — Teacher D', T.D, [F[4].studentId], 0),
  H: await mk('Homeroom 11 — Teacher H', T.H, [F[5].studentId], 1, null),
};
out('classes', G);

// ── The term's timetable: B's class and FU-5's homeroom both on Wednesday at period 2, published from today ──
const v = (await coord('POST', '/v1/timetables', { termId, name: 'Term 1 — first' })).id;
const tt = await coord('GET', `/v1/timetables/${v}`);
for (const [name] of [['Biology 11 — Teacher B'], ['Homeroom 11 — Teacher H']]) {
  const g = tt.groups.find((x) => x.name === name);
  const l = tt.engine.lessons.find((x) => x.groupId === g.id && x.seq === 1);
  await coord('POST', `/v1/timetables/${v}/lessons/${l.id}/move`, { weekday: 3, period: 2, from: { weekday: l.weekday, period: l.period } });
}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
await coord('POST', `/v1/timetables/${v}/publish`, { effectiveFrom: today, acceptUnplaced: true });
out('published', v, 'from', today);

writeFileSync(new URL('./state.json', import.meta.url), JSON.stringify({ T, yearId, termId, seriesId, sessionId, offerId: offer.id, itemId, F, G, timetableId: v, coordinatorEmail }, null, 2));
out('state written');
