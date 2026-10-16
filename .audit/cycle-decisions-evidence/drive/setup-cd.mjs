// Cycle decisions: the extra dev data on igcse_decisions_dev (API 3181), after the UI audit's setup-1..8,
// through the API as the admin, the coordinator, the finance admin and the officer (what the Sessions,
// Board Series, desk and Teaching Groups screens do). Never a migration or a seed; placeholders only.
//  - decision 2: Mathematics A.S./A.L. (IAL, per unit) on the winter session's sheet (its units' sitting);
//  - decision 10: Cambridge June 2027's other dates (forecasts, results, certificates) and Pearson January
//    2027 with no entry deadline (its exams' start is the cut-off);
//  - decision 12: two more Biology students with Teacher A at the desk, their course enrolments, and the
//    teaching groups "Biology 11 — Teacher A" (three students) and "Biology 11 — Teacher B" (none yet), so the
//    desk's teacher change says what happened to the student's group.
// Writes ./state.json with the ids the drive uses.
import { writeFileSync } from 'node:fs';
import { signIn, out, listOf } from './api.mjs';

const P = 'TestPass1';
const admin = await signIn('admin@igcse.local', 'AdminPass1');
const officer = await signIn('officer.mona@igcse.local', P);
const coord = await signIn('coordinator.ui@igcse.local', P);
const step = async (name, fn) => { try { const r = await fn(); out('ok', name, r === undefined ? '' : JSON.stringify(r).slice(0, 160)); return r; } catch (e) { out('FAILED', name, String(e.message ?? e).slice(0, 400)); return null; } };

const sessions = await admin('GET', '/v1/sessions');
const june = sessions.find((s) => s.sessionType === 'june' && s.seriesYear === 2027 && s.label === '');
const winter = sessions.find((s) => s.sessionType === 'winter' && s.seriesYear === 2026 && s.label === '');
const teachers = await admin('GET', '/v1/teachers');
const tid = (n) => teachers.find((t) => t.name === n).id;
const subjects = listOf(await admin('GET', '/v1/subjects'));
const sid = (code) => subjects.find((s) => s.code === code).id;

// ── Decision 2: IAL Mathematics on the winter sheet ──
const wOffers = await admin('GET', `/v1/sessions/${winter.id}/offers`);
let wMaths = wOffers.offers.find((o) => o.subject.code === 'IAL-MATHS');
if (!wMaths) {
  await step('winter: IAL Mathematics', () => admin('POST', `/v1/sessions/${winter.id}/offers`, { subjectId: sid('IAL-MATHS'), courseFee: 4000, teachers: [{ teacherId: tid('Teacher A'), mode: 'in_school' }] }));
  wMaths = (await admin('GET', `/v1/sessions/${winter.id}/offers`)).offers.find((o) => o.subject.code === 'IAL-MATHS');
}
out('winter maths', wMaths.items.map((i) => `${i.label}:${i.series?.name}`).join(', '));

// ── Decision 10: the other dates ──
const jOffers = await admin('GET', `/v1/sessions/${june.id}/offers`);
const camJune = jOffers.offers.find((o) => o.subject.council === 'cambridge').items[0].boardSeriesId;
await step('Cambridge June 2027: other dates', () => admin('PUT', `/v1/board-series/${camJune}`, {
  forecastGradesDue: '2026-11-05', accessArrangementsDue: '2026-11-10', resultsOn: '2027-08-10', certificatesOn: '2027-10-20', reason: 'Cycle decisions dev: the board published its other dates',
}));
const series = await admin('GET', '/v1/board-series');
const seriesList = listOf(series);
const peaJan = seriesList.find((s) => s.boardCode === 'pearson_edexcel' && s.month === 'january' && s.year === 2027 && !s.label)
  ?? await step('Pearson January 2027', () => admin('POST', '/v1/board-series', { boardCode: 'pearson_edexcel', month: 'january', year: 2027, label: '' }));
await step('Pearson January 2027: exams start, no entry deadline', () => admin('PUT', `/v1/board-series/${peaJan.id}`, { examsStart: '2027-01-08', examsEnd: '2027-01-28', reason: 'Cycle decisions dev: the board published its exam dates' }));

// ── Decision 12: two more Biology students with Teacher A, their enrolments and the teaching groups ──
const bio = jOffers.offers.find((o) => o.subject.code === '0610');
const bioWhole = bio.items.find((i) => i.kind === 'whole');
const users = listOf(await admin('GET', '/v1/users?limit=300'));
const F = {};
for (const tag of ['e', 'f']) {
  let studentId = users.find((u) => u.email === `student.${tag}1@igcse.local`)?.id;
  if (!studentId) {
    const r = await step(`onboard ${tag}1`, () => officer('POST', '/v1/links/desk-onboard', {
      parent: { email: `parent.${tag}@igcse.local`, name: `Parent Placeholder ${tag.toUpperCase()}`, password: P },
      student: { email: `student.${tag}1@igcse.local`, name: `Student Placeholder ${tag.toUpperCase()}1`, password: P, grade: 11 },
    }));
    studentId = r.student.id;
    await step(`${tag}1: Biology with Teacher A, the school fee collected`, () => officer('POST', '/v1/registrations/desk', {
      studentId, sessionId: june.id, consent: { refundPolicy: true, declaration: true },
      lines: [{ offerItemId: bioWhole.id, attempt: 'first', mode: 'in_school', teacherId: tid('Teacher A') }],
      collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0, schoolFeeYear: '2026-2027' },
    }));
  }
  F[tag] = studentId;
}
const a1 = users.find((u) => u.email === 'student.a1@igcse.local').id;
const years = await coord('GET', '/v1/academic/years');
const year = years.find((y) => y.startYear === 2026);
await step('enrolments from the lines', () => coord('POST', '/v1/enrolments/bulk', { academicYearId: year.id, source: 'registrations', studentIds: [a1, F.e, F.f], subjectMap: [], exclude: [], commit: true }));
const groups = listOf(await coord('GET', `/v1/scheduling/groups?academicYearId=${year.id}`));
const mk = async (name, teacherId, studentIds) => groups.find((g) => g.name === name)?.id ?? (await step(`group ${name}`, () => coord('POST', '/v1/scheduling/groups', {
  academicYearId: year.id, name, subjectId: 'subj_0610', teacherId, weeklyPeriods: 0, doublePeriods: 0, ...(studentIds.length ? { studentIds } : {}), startsOn: '2026-09-01',
})))?.id;
const G = { A: await mk('Biology 11 — Teacher A', tid('Teacher A'), [a1, F.e, F.f]), B: await mk('Biology 11 — Teacher B', tid('Teacher B'), []) };
// The Biology lines the drive changes at the desk (A → B).
const lines = {};
for (const [k, studentId] of [['a1', a1], ['e1', F.e], ['f1', F.f]]) {
  const st = await officer('GET', `/v1/statement?studentId=${studentId}`).catch(() => null);
  const all = JSON.stringify(st ?? {});
  lines[k] = { studentId, statementBytes: all.length };
}
writeFileSync(new URL('./state.json', import.meta.url), JSON.stringify({ june: june.id, winter: winter.id, winterMaths: wMaths.id, camJune, peaJan: peaJan.id, a1, e1: F.e, f1: F.f, G, lines }, null, 2));
out('state written', JSON.stringify({ G }));
