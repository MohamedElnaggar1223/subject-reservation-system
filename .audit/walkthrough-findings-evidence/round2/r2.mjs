// Round 2's drive (the review of 744e553) on the branch's servers (web 3210, API 3211, igcse_findings_walk at 65):
// item 1 the board card's one-paper rule (admin, coordinator); item 2 a draft deleted from its screen (the address it
// lands on and every response of 400 or more, GETs too) and a draft whose exception was revoked (the refusal, English
// and Arabic); item 6 the school-fee refusal in Arabic on the Reserve page; item 7 the receipt PDF's heading with the
// school's name set and empty; item 9 piastres on the desk, the family's home and statement (a charge of EGP 150.50).
// Everything it makes for the drive is removed or undone at the end (the drafts deleted or kept as the refusal says,
// the schedule deleted, the charge cancelled, the school's name put back).
import fs from 'node:fs';
import { signIn, go, shot, read, saveReadings, step, apiAs, out, done, errors, readings, ADMIN, PASSWORD, SHOTS, API } from './lib.mjs';

const dir = `${SHOTS}/round2`;
fs.mkdirSync(dir, { recursive: true });
process.env.SHOTS = dir;
const OFFICER = 'finance@igcse.local';
const COORD = 'coordinator@igcse.local';
const state = JSON.parse(fs.readFileSync('/tmp/wf/drive/state.json', 'utf8'));
const admin = await apiAs(...ADMIN);
const coordinator = await apiAs(COORD, PASSWORD);
const sessions = await admin('GET', '/v1/sessions');
const june = (Array.isArray(sessions) ? sessions : sessions.sessions).find((s) => s.status === 'active');
const juneOffers = (await admin('GET', `/v1/sessions/${june.id}/offers`)).offers;
const bio = juneOffers.find((o) => o.subject.name === 'Biology' && o.subject.qualificationLevel === 'igcse');
const teacherId = bio.teachers[0]?.teacherId ?? bio.items[0].teachers[0]?.teacherId;
const DAY = 86400000;
const draft = async (label) => {
  const s = await admin('POST', '/v1/sessions', {
    type: 'june', year: 2028, label, startDate: new Date(Date.now() + 200 * DAY).toISOString(), endDate: new Date(Date.now() + 260 * DAY).toISOString(),
    courseStartsOn: new Date(Date.now() + 210 * DAY).toISOString().slice(0, 10), paymentDueAt: new Date(Date.now() + 250 * DAY).toISOString(),
  });
  const o = await admin('POST', `/v1/sessions/${s.id}/offers`, { subjectId: bio.subject.id, courseFee: 12000, teachers: teacherId ? [{ teacherId, mode: 'in_school' }] : [] });
  return { s, o };
};

// ── Item 1: the board card ──────────────────────────────────────────────────────────────────────────────────────────
await step('i1-admin', async () => {
  const p = await signIn(...ADMIN, 'en');
  await go(p, '/exams/catalogue', 3000);
  const card = p.locator('section[aria-label="Cambridge International"], section[aria-label*="Cambridge"]').first();
  await card.locator('button', { hasText: 'Edit' }).click();
  await p.waitForTimeout(600);
  await card.locator('select[id^="one-paper-"]').selectOption('unit');
  await p.waitForTimeout(400);
  await card.scrollIntoViewIfNeeded();
  await shot(p, 'r2-i1-board-admin-changed-en');
  await read(p, 'i1-board-admin-changed-en', card);
  // Saved without a reason: the form says so, nothing is sent.
  await card.locator('button', { hasText: 'Save' }).click();
  await p.waitForTimeout(800);
  await shot(p, 'r2-i1-board-admin-no-reason-en');
  await read(p, 'i1-board-admin-no-reason-en', card);
  await card.locator('button', { hasText: 'Cancel' }).click();
  await p.context().close();
});
await step('i1-coordinator', async () => {
  const p = await signIn(COORD, PASSWORD, 'en');
  await go(p, '/exams/catalogue', 3000);
  const card = p.locator('section[aria-label*="Cambridge"]').first();
  await card.locator('button', { hasText: 'Edit' }).click();
  await p.waitForTimeout(600);
  await card.scrollIntoViewIfNeeded();
  await shot(p, 'r2-i1-board-coordinator-en');
  await read(p, 'i1-board-coordinator-en', card);
  readings['i1-coordinator-select-count'] = await card.locator('select[id^="one-paper-"]').count();
  await card.locator('button', { hasText: 'Cancel' }).click();
  await p.context().close();
});
readings['i1-api-coordinator-refused'] = await coordinator('PUT', '/v1/catalogue/boards/cambridge', { onePaperFeeKey: 'unit', reason: 'round 2 drive: the coordinator tries' }).then(() => 'accepted').catch((e) => String(e));

// ── Item 2: a draft deleted from its screen; a draft whose exception was revoked ────────────────────────────────────
const del = await draft('r2-deleted');
const kept = await draft('r2-kept');
const keptItem = kept.o.items?.[0]?.id ?? kept.o.items?.[0];
const ex = await coordinator('POST', '/v1/exceptions', { policyKey: 'gate.availability', studentId: state.c.studentId, scope: { offerItemId: keptItem }, reason: 'round 2 drive: an item not open to them' });
await coordinator('POST', `/v1/exceptions/${ex.id}/revoke`, {});
readings['i2-sessions'] = { deleted: [del.s.id, del.s.name], kept: [kept.s.id, kept.s.name], exception: ex.id };

await step('i2-delete', async () => {
  const p = await signIn(...ADMIN, 'en');
  const bad = [];
  p.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, '').replace(/^http:\/\/localhost:3210/, '')}`); });
  await go(p, `/admin/sessions/${del.s.id}#subjects`, 3500);
  await shot(p, 'r2-i2-draft-before-delete-en');
  await p.locator('button', { hasText: 'Delete this draft' }).click();
  await p.waitForTimeout(600);
  const modal = p.locator('div[role=dialog]').last();
  await modal.locator('textarea, input').first().fill("round 2 drive: a draft made by mistake");
  await shot(p, 'r2-i2-delete-modal-en');
  await modal.locator('button', { hasText: 'Delete the draft' }).click();
  await p.waitForURL((u) => u.pathname === '/admin/sessions', { timeout: 15000 }).catch(() => {});
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(2500);
  await shot(p, 'r2-i2-after-delete-en');
  readings['i2-after-delete-url'] = new URL(p.url()).pathname;
  readings['i2-responses-400-or-more'] = bad;
  readings['i2-list-names-deleted'] = (await p.locator('main').innerText()).includes(del.s.name);
  await p.context().close();
});
for (const lang of ['en', 'ar']) {
  await step(`i2-kept-${lang}`, async () => {
    const p = await signIn(...ADMIN, lang);
    await go(p, `/admin/sessions/${kept.s.id}#subjects`, 3500);
    await p.locator('button', { hasText: lang === 'en' ? 'Delete this draft' : /حذف|Delete/ }).first().click();
    await p.waitForTimeout(600);
    const modal = p.locator('div[role=dialog]').last();
    await modal.locator('textarea, input').first().fill('round 2 drive: is it kept?');
    await modal.locator('button').filter({ hasText: lang === 'en' ? 'Delete the draft' : /حذف|Delete/ }).last().click();
    await p.waitForTimeout(2000);
    await shot(p, `r2-i2-kept-refusal-${lang}`);
    await read(p, `i2-kept-refusal-${lang}`, modal);
    readings[`i2-kept-url-${lang}`] = new URL(p.url()).pathname;
    await p.context().close();
  });
}

// ── Item 6: the school-fee refusal in Arabic (a schedule for the drive, removed after) ─────────────────────────────
const sched = await admin('POST', '/v1/school-fees/schedules', { academicYear: '2026-2027', grade: null, amount: 5000, opensAt: new Date(Date.now() - DAY).toISOString() });
try {
  for (const lang of ['ar', 'en']) {
    await step(`i6-school-fee-${lang}`, async () => {
      const p = await signIn(state.c.parent, PASSWORD, lang);
      await go(p, '/register', 3500);
      const box = p.locator('input[type=checkbox][aria-label*="Chemistry"]').first();
      await box.check();
      await p.waitForTimeout(800);
      for (const c of await p.locator('div.space-y-2.border-t label input[type=checkbox]').all()) if (!(await c.isDisabled())) await c.check();
      await p.waitForTimeout(400);
      const submit = p.locator('main button').filter({ hasText: lang === 'en' ? /^Reserve/ : /احجز|Reserve/ }).last();
      readings[`i6-submit-enabled-${lang}`] = await submit.isEnabled();
      await submit.click();
      await p.waitForTimeout(2500);
      await shot(p, `r2-i6-school-fee-refusal-${lang}`, { full: false });
      await read(p, `i6-school-fee-refusal-${lang}`);
      await p.context().close();
    });
  }
} finally {
  await admin('DELETE', `/v1/school-fees/schedules/${sched.id}`);
}

// ── Item 7: the receipt PDF's heading, the school's name set and empty ──────────────────────────────────────────────
const pdfHeading = async (paymentId) => {
  const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3210' }, body: JSON.stringify({ email: state.b.parent, password: PASSWORD }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const res = await fetch(`${API}/v1/payments/${paymentId}/receipt`, { headers: { Cookie: cookie, Origin: 'http://localhost:3210' } });
  const text = Buffer.from(await res.arrayBuffer()).toString('latin1');
  return { status: res.status, type: res.headers.get('content-type'), heading: [...text.matchAll(/\(([^)]*)\) Tj/g)].slice(0, 6).map((m) => m[1]) };
};
const parentB = await apiAs(state.b.parent, PASSWORD);
const payB = (await parentB('GET', `/v1/payments?studentId=${state.b.studentId}`).catch(() => null));
const payList = Array.isArray(payB) ? payB : payB?.payments ?? payB?.items ?? [];
const completed = payList.find((x) => x.status === 'completed');
readings['i7-payment'] = completed?.id ?? JSON.stringify(payB).slice(0, 200);
if (completed) {
  const name = (await admin('GET', '/v1/settings/public')).schoolName;
  readings['i7-pdf-named'] = { schoolName: name, ...(await pdfHeading(completed.id)) };
  await admin('PUT', '/v1/settings/school.name', { value: '', reason: 'round 2 drive: the receipt with the name empty' });
  readings['i7-pdf-empty'] = { schoolName: '', ...(await pdfHeading(completed.id)) };
  await admin('PUT', '/v1/settings/school.name', { value: name, reason: 'round 2 drive: the name put back' });
}

// ── Item 9: piastres, one formatter (a charge of EGP 150.50 for student C, cancelled after) ─────────────────────────
const charge = await admin('POST', '/v1/charges', { studentId: state.c.studentId, kind: 'custom', amount: 150.5, description: 'A replacement ID card (round 2 drive)', dueAt: new Date(Date.now() + 14 * DAY).toISOString(), reason: 'round 2 drive: piastres on the screens' });
readings['i9-charge'] = { id: charge.id, amount: charge.amount, status: charge.status };
try {
  for (const lang of ['en', 'ar']) {
    await step(`i9-desk-${lang}`, async () => {
      const p = await signIn(OFFICER, PASSWORD, lang);
      await go(p, `/desk?student=${state.c.studentId}`, 3500);
      const owed = p.locator('section[aria-labelledby="desk-owed"]');
      await owed.scrollIntoViewIfNeeded().catch(() => {});
      await shot(p, `r2-i9-desk-${lang}`);
      await read(p, `i9-desk-${lang}`);
      await p.context().close();
    });
    await step(`i9-home-${lang}`, async () => {
      const p = await signIn(state.c.parent, PASSWORD, lang);
      await go(p, '/', 3500);
      await shot(p, `r2-i9-home-${lang}`);
      await read(p, `i9-home-${lang}`);
      await p.context().close();
    });
  }
} finally {
  await admin('POST', `/v1/charges/${charge.id}/cancel`, { reason: 'round 2 drive: done' });
}

saveReadings('/tmp/wf/drive/r2-readings.json');
out(JSON.stringify(readings, null, 1).slice(0, 6000));
out('errors', JSON.stringify(errors, null, 1));
await done();
process.exit(0);
