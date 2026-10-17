// The families the drive's screens are shown on (placeholders only), made through the API as the screens would.
// Usage: node data.mjs a|b|c   (A: three subjects reserved by the parent, Cambridge's two paid by InstaPay and
// waiting for finance; B and C: a walk-in family at the desk, cash, receipts handed over, a drop asked, approved and
// its receipt returned — B before the switch, C after it, so each code's own sentences are written.)
import { apiAs, ADMIN, PASSWORD, out } from './lib.mjs';
import fs from 'node:fs';

const which = process.argv[2];
const admin = await apiAs(...ADMIN);
const officer = await apiAs('finance@igcse.local', PASSWORD);
const sessions = await admin('GET', '/v1/sessions');
const june = (Array.isArray(sessions) ? sessions : sessions.sessions).find((s) => s.sessionType === 'june' && s.seriesYear === 2027);
const STATE = process.env.STATE ?? '/tmp/wf/drive/state.json';
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
const CONSENT = { refundPolicy: true, declaration: true };

async function family(tag, grade = 11) {
  const parent = `parent.${tag}@igcse.local`;
  const student = `student.${tag}@igcse.local`;
  if (!state[tag]) {
    const r = await officer('POST', '/v1/links/desk-onboard', {
      parent: { email: parent, name: `Parent ${tag.toUpperCase()}`, password: PASSWORD },
      student: { email: student, name: `Student ${tag.toUpperCase()}`, password: PASSWORD, grade },
    });
    state[tag] = { studentId: r.student.id, parent, student };
    save();
  }
  return state[tag];
}

async function lineFor(studentId, subjectName) {
  const read = await admin('GET', `/v1/registrations/offers?studentId=${studentId}&sessionId=${june.id}`);
  const o = read.offers.find((x) => x.subject.name === subjectName && x.subject.level === 'igcse');
  const it = o.items.find((i) => i.kind === 'whole');
  return { offerItemId: it.id, attempt: 'first', mode: 'in_school', teacherId: it.teachers[0]?.id ?? null };
}

if (which === 'a') {
  const f = await family('a');
  const p = await apiAs(f.parent, PASSWORD);
  if (!state.a.lines) {
    const lines = [await lineFor(f.studentId, 'Biology'), await lineFor(f.studentId, 'Physics'), await lineFor(f.studentId, 'Mathematics')];
    const made = await p('POST', '/v1/registrations/direct', { sessionId: june.id, studentId: f.studentId, lines, consent: CONSENT });
    state.a.lines = made.map((r) => ({ id: r.id, subject: r.subjectId, price: r.priceAtRegistration }));
    save();
  }
  // Cambridge's two subjects by InstaPay (one payment per board deadline), the reference given: it waits for finance.
  if (!state.a.payment) {
    const regs = await p('GET', `/v1/statement?studentId=${f.studentId}`);
    const lines = regs.students[0].sessions.find((s) => s.id === june.id).lines;
    const cam = lines.filter((l) => /Cambridge/.test(l.series ?? '')).map((l) => l.id);
    const pay = await p('POST', '/v1/payments/initiate', { registrationIds: cam, paymentMethod: 'instapay', escrowAmountToApply: 0 });
    await p('POST', `/v1/payments/${pay.id}/instapay-reference`, { reference: 'FT-DEMO-A-0001' });
    state.a.payment = pay.id;
    save();
  }
  out('family A', JSON.stringify(state.a));
}

if (which === 'b' || which === 'c') {
  const tag = which;
  const f = await family(tag);
  const st = state[tag];
  if (!st.desk) {
    const lines = [await lineFor(f.studentId, 'Chemistry'), await lineFor(f.studentId, 'Biology')];
    const r = await officer('POST', '/v1/registrations/desk', { studentId: f.studentId, sessionId: june.id, lines, consent: CONSENT, collectNow: { instrumentUsed: 'cash', escrowAmountToApply: 0 } });
    st.desk = { registrations: r.registrations.map((x) => ({ id: x.id, subjectId: x.subjectId })), collected: r.collected };
    save();
  }
  if (!st.issued) {
    const s360 = await officer('GET', `/v1/users/${f.studentId}/summary`);
    for (const reg of s360.registrations.filter((x) => x.receipt && x.receipt.status === 'pending_issue')) {
      await officer('POST', `/v1/receipts/${reg.receipt.id}/issue`);
    }
    st.issued = true;
    save();
  }
  out(`family ${tag.toUpperCase()}`, JSON.stringify(st));
}

if (which === 'd1' || which === 'd2') {
  // A family that reserved at the desk and pays later: its waiting line takes the payment due date exception.
  const f = await family(which);
  if (!state[which].line) {
    const r = await officer('POST', '/v1/registrations/desk', { studentId: f.studentId, sessionId: june.id, lines: [await lineFor(f.studentId, 'Physics')], consent: CONSENT });
    state[which].line = r.registrations[0].id;
    save();
  }
  out(`family ${which}`, JSON.stringify(state[which]));
}

if (which === 'b-drop' || which === 'c-drop') {
  // The student asks to drop Chemistry (Pending Requests), the parent approves, the receipt comes back: the refund
  // goes to the balance (the balance notice).
  const tag = which[0];
  const st = state[tag];
  const stu = await apiAs(st.student, PASSWORD);
  const par = await apiAs(st.parent, PASSWORD);
  const chem = st.desk.registrations[0].id;
  if (!st.dropAsked) {
    st.dropAsked = (await stu('POST', `/v1/registrations/${chem}/request-drop`, { reason: 'The student takes it next year' })).id;
    save();
  }
  out(`family ${tag.toUpperCase()} drop asked`, st.dropAsked);
}

if (which === 'b-approve' || which === 'c-approve') {
  const tag = which[0];
  const st = state[tag];
  const par = await apiAs(st.parent, PASSWORD);
  if (!st.dropApproved) {
    await par('PUT', `/v1/change-requests/${st.dropAsked}/approve`, {});
    st.dropApproved = true;
    save();
  }
  if (!st.returned) {
    const s360 = await officer('GET', `/v1/users/${st.studentId}/summary`);
    const rc = s360.registrations.find((x) => x.id === st.desk.registrations[0].id).receipt;
    await officer('POST', `/v1/receipts/${rc.id}/return`, {});
    st.returned = true;
    save();
  }
  out(`family ${tag.toUpperCase()} drop approved, receipt returned`);
}
process.exit(0);
