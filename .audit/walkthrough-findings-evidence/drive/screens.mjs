// The screens each finding changed, before (main 2a149dd on 3212/3213) and after (the branch on 3210/3211), on the
// same database: PHASE=before|after node screens.mjs. Shots in $SHOTS/<phase>/<name>-<lang>.jpg; what each screen
// says in $SHOTS/<phase>/readings.json. Actions that change data happen in each phase where its finding needs them.
import fs from 'node:fs';
import { signIn, go, shot, read, saveReadings, step, apiAs, out, done, errors, readings, ADMIN, PASSWORD, SHOTS } from './lib.mjs';

const PHASE = process.env.PHASE ?? 'after';
const after = PHASE === 'after';
const dir = `${SHOTS}/${PHASE}`;
fs.mkdirSync(dir, { recursive: true });
process.env.SHOTS = dir;
const S = (name) => `${PHASE}/${name}`;
const state = JSON.parse(fs.readFileSync(process.env.STATE ?? '/tmp/wf/drive/state.json', 'utf8'));
const A = state.a, B = state.b, C = state.c;
const D = after ? state.d2 : state.d1;
const OFFICER = 'finance@igcse.local';
const admin = await apiAs(...ADMIN);
const officer = await apiAs(OFFICER, PASSWORD);
const sessions = await admin('GET', '/v1/sessions');
const list = Array.isArray(sessions) ? sessions : sessions.sessions;
const june = list.find((s) => s.sessionType === 'june' && s.seriesYear === 2027);
const draft = list.find((s) => s.status === 'draft' && s.name.startsWith('November 2026'));
const family = after ? C : B; // the desk family whose notices were written by this phase's code

// ── F8-08: the parent's Home with Cambridge's InstaPay transfer waiting for finance ────────────────────────────
for (const lang of ['en', 'ar']) {
  await step(`home-a-${lang}`, async () => {
    const p = await signIn(A.parent, PASSWORD, lang);
    await go(p, '/');
    const card = p.locator('section', { hasText: lang === 'en' ? 'What comes next' : 'ما التالي' }).first();
    await shot(p, `f08-home-parent-${lang}`, { locator: (await card.count()) ? card : p.locator('main') });
    await read(p, S(`f08-home-parent-${lang}`), (await card.count()) ? card : undefined);
    if (lang === 'en') {
      // "Pay now" → the checkout it opens.
      const pay = p.locator('a[href^="/checkout?ids="]').first();
      readings[S('f08-pay-now-href')] = await pay.getAttribute('href');
      await pay.click();
      await p.waitForLoadState('networkidle').catch(() => {});
      await p.waitForTimeout(2000);
      await shot(p, `f08-checkout-from-pay-now-${lang}`);
      await read(p, S(`f08-checkout-from-pay-now-${lang}`));
    }
    await p.context().close();
  });
}

// ── F8-12: the payment due date exception (the sentence's date; the result's grammar), on D's waiting line ────────
for (const lang of ['en', 'ar']) {
  await step(`exception-${lang}`, async () => {
    const p = await signIn(...ADMIN, lang);
    await go(p, `/admin/exceptions?studentId=${D.studentId}&registrationId=${D.line}&policyKey=deadline.payment`, 2500);
    await p.fill('#exc-date', '2026-12-20');
    await p.fill('#exc-reason', 'The family pays after the salary on the 20th (placeholder)');
    await p.waitForTimeout(800);
    const sentence = p.locator('div', { has: p.locator('p', { hasText: lang === 'en' ? 'It will apply as' : 'سيُطبَّق' }) }).last();
    await shot(p, `f12-exception-sentence-${lang}`, { locator: (await sentence.count()) ? sentence : p.locator('main') });
    await read(p, S(`f12-exception-sentence-${lang}`), (await sentence.count()) ? sentence : undefined);
    if (lang === 'en') {
      await p.locator('button[type=submit]', { hasText: 'Grant' }).click();
      await p.waitForTimeout(2500);
      const notice = p.locator('div', { hasText: 'Granted' }).last();
      await shot(p, `f12-exception-granted-${lang}`, { full: false });
      await read(p, S(`f12-exception-granted-${lang}`));
    }
    await p.context().close();
  });
}

// ── F8-09: the desk on student A ───────────────────────────────────────────────────────────────────────────────
for (const lang of ['en', 'ar']) {
  await step(`desk-a-${lang}`, async () => {
    const p = await signIn(OFFICER, PASSWORD, lang);
    await go(p, `/desk?student=${A.studentId}`, 3000);
    const owed = p.locator('section[aria-labelledby="desk-owed"]');
    await owed.scrollIntoViewIfNeeded().catch(() => {});
    await shot(p, `f09-desk-to-collect-${lang}`);
    await read(p, S(`f09-desk-to-collect-${lang}`));
    if (lang === 'en') {
      // Collect what is ticked: before, the three (refused); after, Mathematics alone (collected).
      await owed.locator('button', { hasText: 'Collect' }).click();
      await p.waitForTimeout(3000);
      await shot(p, `f09-desk-collect-result-${lang}`);
      await read(p, S(`f09-desk-collect-result-${lang}`));
    }
    await p.context().close();
  });
}

// ── F8-10: the Finance Workbench's confirm dialog for A's transfer (after: then confirmed, the family told) ─────────
await step('workbench', async () => {
  const p = await signIn(OFFICER, PASSWORD, 'en');
  await go(p, '/finance', 3000);
  const row = p.locator('li, tr, div.rounded-xl', { hasText: 'FT-DEMO-A-0001' }).last();
  await row.locator('button', { hasText: 'Confirm' }).first().click();
  await p.waitForTimeout(1200);
  await shot(p, 'f10-workbench-confirm-dialog-en');
  await read(p, S('f10-workbench-confirm-dialog-en'), p.locator('div.fixed').last());
  if (after) {
    await p.locator('button', { hasText: 'Confirm Payment' }).last().click();
    await p.waitForTimeout(3000);
  } else {
    await p.locator('button', { hasText: 'Cancel' }).last().click();
  }
  await p.context().close();
});

// ── F8-10: the desk family's requests, then the drop approved and its receipt back, then its statement and notices
// (B: main's sentences; C: the branch's) ────────────────────────────────────────────────────────────────────────
for (const lang of ['en', 'ar']) {
  await step(`requests-${lang}`, async () => {
    const p = await signIn(family.student, PASSWORD, lang);
    await go(p, '/pending-requests', 2500);
    await shot(p, `f10-pending-requests-${lang}`);
    await read(p, S(`f10-pending-requests-${lang}`));
    await p.context().close();
  });
}
await step('approve-drop', async () => {
  const par = await apiAs(family.parent, PASSWORD);
  await par('PUT', `/v1/change-requests/${family.dropAsked}/approve`, {});
  const s360 = await officer('GET', `/v1/users/${family.studentId}/summary`);
  const rc = s360.registrations.find((r) => r.id === family.desk.registrations[0].id).receipt;
  await officer('POST', `/v1/receipts/${rc.id}/return`, {});
  await new Promise((r) => setTimeout(r, 1500));
});
for (const lang of ['en', 'ar']) {
  await step(`statement-${lang}`, async () => {
    const p = await signIn(family.parent, PASSWORD, lang);
    await go(p, '/statement', 2500);
    const pays = p.locator('h3', { hasText: lang === 'en' ? 'Payments' : 'المدفوعات' }).first();
    if (await pays.count()) await pays.scrollIntoViewIfNeeded();
    await shot(p, `f10-statement-${lang}`);
    await read(p, S(`f10-statement-${lang}`));
    await go(p, '/notifications', 2500);
    await shot(p, `f10-notifications-${lang}`);
    await read(p, S(`f10-notifications-${lang}`));
    await p.context().close();
  });
}
if (after) {
  await step('parent-a-notifications', async () => {
    const p = await signIn(A.parent, PASSWORD, 'en');
    await go(p, '/notifications', 2500);
    await shot(p, 'f10-notifications-parent-a-en');
    await read(p, S('f10-notifications-parent-a-en'));
    await p.context().close();
  });
}

// ── F8-11: the slip and the receipt of the desk family ────────────────────────────────────────────────────────────
await step('slip-receipt', async () => {
  const p = await signIn(OFFICER, PASSWORD, 'en');
  await p.evaluate(() => { window.print = () => {}; });
  await p.addInitScript(() => { window.print = () => {}; });
  await go(p, `/reservation-slip/${family.studentId}`, 3000);
  await shot(p, 'f11-slip-en');
  await read(p, S('f11-slip-en'));
  const s360 = await officer('GET', `/v1/users/${family.studentId}/summary`);
  const rc = s360.registrations.find((r) => r.receipt)?.receipt;
  await go(p, `/receipt-print/${rc.id}`, 2500);
  await shot(p, 'f11-receipt-en');
  await read(p, S('f11-receipt-en'));
  await p.context().close();
});

// ── F8-12: My Registrations' dialogs (role dialog), the admin's Profile ───────────────────────────────────────────
await step('registrations-dialogs', async () => {
  const p = await signIn(family.student, PASSWORD, 'en');
  await go(p, '/registrations', 2500);
  await p.locator('button', { hasText: 'Request Drop' }).first().click();
  await p.waitForTimeout(800);
  readings[S('f12-request-drop-dialog-role')] = await p.evaluate(() => [...document.querySelectorAll('[role=dialog]')].map((d) => ({ name: d.getAttribute('aria-labelledby') ? document.getElementById(d.getAttribute('aria-labelledby'))?.textContent : null, modal: d.getAttribute('aria-modal') })));
  const dialog = p.getByRole('dialog', { name: 'Request Drop' });
  readings[S('f12-request-drop-dialog-by-role')] = await dialog.count();
  await shot(p, 'f12-request-drop-dialog-en');
  await p.context().close();
});
await step('profile-admin', async () => {
  const p = await signIn(...ADMIN, 'en');
  await go(p, '/profile', 2000);
  await shot(p, 'f12-profile-admin-en', { full: true });
  await read(p, S('f12-profile-admin-en'));
  await p.context().close();
});

// ── Admin's screens: Settings' refund card, the Catalogue, the Subjects form, the draft session, the Fees tab ───────
for (const lang of ['en', 'ar']) {
  await step(`settings-${lang}`, async () => {
    const p = await signIn(...ADMIN, lang);
    await go(p, '/settings', 2500);
    const card = p.locator('div.bg-card', { hasText: lang === 'en' ? 'Copied into each new June session' : 'تُنسخ إلى كل جلسة يونيو جديدة' }).last();
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await shot(p, `f12-settings-refund-${lang}`, { locator: (await card.count()) ? card : undefined });
    await read(p, S(`f12-settings-refund-${lang}`), (await card.count()) ? card : undefined);
    await go(p, '/exams/catalogue', 3000);
    await shot(p, `f02-f03-f05-catalogue-${lang}`);
    await read(p, S(`f02-f03-f05-catalogue-${lang}`));
    await p.context().close();
  });
}
await step('subjects-form', async () => {
  const p = await signIn(...ADMIN, 'en');
  await go(p, '/admin/subjects', 2500);
  await p.locator('button', { hasText: 'New Subject' }).click();
  await p.waitForTimeout(800);
  await shot(p, 'f02-subjects-new-subject-form-en');
  await read(p, S('f02-subjects-new-subject-form-en'), p.locator('form').first());
  await p.context().close();
});
await step('draft-session', async () => {
  if (!draft) { readings[S('f01-draft-session')] = 'no draft session'; return; }
  const p = await signIn(...ADMIN, 'en');
  await go(p, `/admin/sessions/${draft.id}`, 2500);
  await shot(p, 'f01-draft-session-en');
  await read(p, S('f01-draft-session-en'));
  await p.context().close();
});
await step('fees-pearson', async () => {
  const p = await signIn(...ADMIN, 'en');
  await go(p, `/admin/sessions/${june.id}#fees`, 3500);
  const sec = p.locator('section[aria-label="Pearson Edexcel June 2027"]');
  await shot(p, 'f05-fees-pearson-en', { locator: (await sec.count()) ? sec : undefined });
  await read(p, S('f05-fees-pearson-en'), (await sec.count()) ? sec : undefined);
  await p.context().close();
});

saveReadings(`${dir}/readings.json`);
out('errors:', errors.length, errors.slice(0, 12));
await done();
process.exit(0);
