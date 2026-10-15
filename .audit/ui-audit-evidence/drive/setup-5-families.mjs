// F6 dev data, part 5 (igcse_ui_dev, API 3071): the staff placeholders for the landings, the academic
// year and its sections, the school fee, and four placeholder families with reservations in every
// state the cycle's screens show — paid, unpaid, waiting for the parent's approval, a declared sitting
// to verify, dropped and refunded to the wallet, an instalment plan, a pushed charge past its due date,
// a message and a payment reminder. Through the API as the screens' own roles; never a migration or a
// seed. Placeholders only; no phone numbers. Re-runnable in parts (each step looks for what it makes).
import { signIn, out, days, listOf } from './api.mjs';

const P = 'TestPass1';
const admin = await signIn('admin@igcse.local', 'AdminPass1');
const officer = await signIn('officer.mona@igcse.local', P);
const finadmin = await signIn('finadmin.rana@igcse.local', P);
const coord = await signIn('coordinator.ui@igcse.local', P);
const step = async (name, fn) => { try { const r = await fn(); out('ok', name, r === undefined ? '' : JSON.stringify(r).slice(0, 200)); return r; } catch (e) { out('FAILED', name, String(e.message ?? e).slice(0, 500)); return null; } };

// ── Staff for the landings: a teacher account (linked to Teacher A) and a gate account ──
const teachers = await admin('GET', '/v1/teachers');
const tid = (n) => teachers.find((t) => t.name === n).id;
const users = listOf(await admin('GET', '/v1/users?limit=200'));
const hasUser = (email) => users.some((u) => u.email === email);
if (!hasUser('teacher.ui@igcse.local')) await step('teacher account', () => admin('POST', '/v1/users', { name: 'Teacher Placeholder', email: 'teacher.ui@igcse.local', password: P, role: 'teacher', teacherId: tid('Teacher A') }));
if (!hasUser('gate.ui@igcse.local')) await step('gate account', () => admin('POST', '/v1/users', { name: 'Gate Placeholder', email: 'gate.ui@igcse.local', password: P, role: 'gate' }));

// ── The academic year 2026–2027 and two sections ──
let years = await coord('GET', '/v1/academic/years');
let year = years.find((y) => y.startYear === 2026) ?? await step('academic year', () => coord('POST', '/v1/academic/years', { startYear: 2026, startsOn: '2026-09-01', endsOn: '2027-06-30' }));
const sections = listOf(await coord('GET', `/v1/academic/sections?academicYearId=${year.id}`));
const section = async (grade, name) => sections.find((s) => s.name === name) ?? await step(`section ${name}`, () => coord('POST', '/v1/academic/sections', { academicYearId: year.id, grade, name }));
const s11A = await section(11, '11A');
const s12A = await section(12, '12A');

// ── The school fee 2026–2027 (the gate before reserving) ──
const schedules = listOf(await finadmin('GET', '/v1/school-fees/schedules'));
if (!schedules.some((s) => s.academicYear === '2026-2027')) await step('school fee', () => finadmin('POST', '/v1/school-fees/schedules', { academicYear: '2026-2027', amount: 30000, opensAt: '2026-09-01T00:00:00.000Z', dueAt: '2026-11-30T21:00:00.000Z' }));

// ── Four families, onboarded at the desk ──
const onboard = async (tag, children) => {
  const ids = [];
  for (const [i, grade] of children.entries()) {
    const r = await step(`onboard ${tag}${i + 1}`, () => officer('POST', '/v1/links/desk-onboard', {
      parent: { email: `parent.${tag}@igcse.local`, name: `Parent Placeholder ${tag.toUpperCase()}`, password: P },
      student: { email: `student.${tag}${i + 1}@igcse.local`, name: `Student Placeholder ${tag.toUpperCase()}${i + 1}`, password: P, grade },
    }));
    ids.push(r?.student?.id);
  }
  return ids;
};
const [a1] = await onboard('a', [11]);
const [b1] = await onboard('b', [11]);
const [c1, c2] = await onboard('c', [11, 12]);
const [d1] = await onboard('d', [11]);
out('students', { a1, b1, c1, c2, d1 });

await step('section 11A members', () => coord('POST', `/v1/academic/sections/${s11A.id}/members`, { studentIds: [a1, b1, c1, d1], from: '2026-09-01' }));
await step('section 12A members', () => coord('POST', `/v1/academic/sections/${s12A.id}/members`, { studentIds: [c2], from: '2026-09-01' }));

// ── The June 2027 sheet ──
const sessions = await admin('GET', '/v1/sessions');
const june = sessions.find((s) => s.sessionType === 'june' && s.seriesYear === 2027 && s.label === '');
const { offers } = await admin('GET', `/v1/sessions/${june.id}/offers`);
const offer = (code) => offers.find((o) => o.subject.code === code);
const item = (code, pred = (i) => i.kind === 'whole') => offer(code).items.find(pred);
const CONSENT = { refundPolicy: true, declaration: true };
const first = (it, teacherId) => ({ offerItemId: it.id, attempt: 'first', mode: 'in_school', ...(teacherId ? { teacherId } : {}) });

// Family A: at the desk — the school fee, Arabic and Biology paid in cash in one action; Physics reserved, unpaid.
const aPaid = await step('A: desk reserve and collect', () => officer('POST', '/v1/registrations/desk', {
  studentId: a1, sessionId: june.id, consent: CONSENT,
  lines: [first(item('0544'), tid('Teacher B')), first(item('0610'), tid('Teacher A'))],
  collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0, schoolFeeYear: '2026-2027' },
}));
const aUnpaid = await step('A: desk reserve only (Physics)', () => officer('POST', '/v1/registrations/desk', {
  studentId: a1, sessionId: june.id, consent: CONSENT, lines: [first(item('0625'))],
}));

// Family B: the school fee at the desk; the parent reserves in the app — Arabic, Mathematics P1, and a
// declared retake of Biology's Paper 4 (self study) from June 2026: a sitting the school verifies.
await step('B: school fee at the desk', () => officer('POST', '/v1/registrations/desk/collect', { studentId: b1, registrationIds: [], chargeIds: [], schoolFeeYear: '2026-2027', instrumentUsed: 'cash', escrowAmountToApply: 0 }));
const parentB = await signIn('parent.b@igcse.local', P);
const bLines = await step('B: the parent reserves', () => parentB('POST', '/v1/registrations/direct', {
  studentId: b1, sessionId: june.id, consent: CONSENT,
  lines: [
    first(item('0544'), tid('Teacher A')),
    first(item('IAL-MATHS', (i) => i.label === 'P1')),
    { offerItemId: item('0610', (i) => i.kind === 'one_paper' && i.availability !== 'closed').id, attempt: 'retake', mode: 'self_study', priorSitting: { month: 'june', year: 2026 } },
  ],
}));

// Family C: the school fee for both children; C1 asks (waits for the parent's approval); C2 reserved
// Physics A.S. at the desk, paid, then dropped at the desk: refunded to the family's wallet.
await step('C1: school fee', () => officer('POST', '/v1/registrations/desk/collect', { studentId: c1, registrationIds: [], chargeIds: [], schoolFeeYear: '2026-2027', instrumentUsed: 'cash', escrowAmountToApply: 0 }));
await step('C2: school fee', () => officer('POST', '/v1/registrations/desk/collect', { studentId: c2, registrationIds: [], chargeIds: [], schoolFeeYear: '2026-2027', instrumentUsed: 'cash', escrowAmountToApply: 0 }));
const studentC1 = await signIn('student.c1@igcse.local', P);
await step('C1: the student asks', () => studentC1('POST', '/v1/registrations/request', { sessionId: june.id, consent: CONSENT, lines: [first(item('0625')), first(item('0544'), tid('Teacher C'))] }));
const c2Paid = await step('C2: Physics A.S. paid at the desk', () => officer('POST', '/v1/registrations/desk', {
  studentId: c2, sessionId: june.id, consent: CONSENT, lines: [first(item('9702', (i) => i.label === 'AS Level'))],
  collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 },
}));
const c2Line = c2Paid?.registrations?.[0]?.id;
if (c2Line) await step('C2: dropped at the desk, refunded', () => officer('POST', `/v1/registrations/${c2Line}/desk-drop`, { reason: 'The family changed its plan at the desk' }));

// Family A's Physics in three instalments (finance admin), and a pushed charge on family B past its due date.
const aPhysics = aUnpaid?.registrations?.[0]?.id;
if (aPhysics) {
  const price = Number(aUnpaid.registrations[0].finalPrice ?? aUnpaid.registrations[0].price ?? 24850);
  const third = Math.floor(price / 3);
  await step('A: instalment plan', () => finadmin('POST', '/v1/exceptions', {
    policyKey: 'plan.instalments', studentId: a1, scope: { registrationId: aPhysics },
    value: [{ dueAt: days(3), amount: third }, { dueAt: days(33), amount: third }, { dueAt: days(63), amount: price - 2 * third }],
    reason: 'The family pays Physics in three instalments',
  }));
}
await step('B: a pushed charge past its due date', () => finadmin('POST', '/v1/charges', { studentId: b1, kind: 'custom', description: 'Lab materials', amount: 500, dueAt: days(-2), reason: 'Lab materials for the practical papers' }));

// A message to every parent, and a payment reminder to the session's unpaid families.
await step('message', () => admin('POST', '/v1/messages', { audience: { definition: { kind: 'broadcast', group: 'parents' } }, title: 'June 2027 reservations are open', body: 'Reserve your child\'s subjects for June 2027 on the Reserve page or at the desk.', language: 'both', titleAr: 'الحجز لدورة يونيو 2027 مفتوح', bodyAr: 'احجز مواد ابنك لدورة يونيو 2027 من صفحة الحجز أو من المكتب.', channels: ['in_app'] }));
await step('payment reminder', () => officer('POST', '/v1/messages', { audience: { definition: { kind: 'batch', list: 'session_unpaid', sessionId: june.id, include: 'both', filter: 'unpaid' } }, templateId: 'tpl-payment-due', channels: ['in_app'] }));
out(JSON.stringify({ june: june.id, a1, b1, c1, c2, d1, aPaid: aPaid?.registrations?.map((r) => r.id), bLines: bLines?.registrations?.map((r) => r.id) ?? bLines }));
