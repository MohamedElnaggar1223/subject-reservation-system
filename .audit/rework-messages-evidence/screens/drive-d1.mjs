// Agent D's drive of step D on web 3130 / API 3131 (igcse_rwd_dev): the Messages screen (new message,
// log and deliveries, reminders, texts), the Money tab's Remind, Arabic, the finance officer's view,
// a family's notifications; and the step counts of RESERVATIONS_REWORK.md §11 measured.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const BASE = 'http://localhost:3130';
const API = 'http://localhost:3131';
const EV = process.env.EV;
const SESSION = process.env.SESSION;
const out = (s) => console.log(s);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const counts = { inputs: 0, clicks: 0 };
const results = [];
const measured = (label, fn) => async () => { counts.inputs = 0; counts.clicks = 0; await fn(); results.push({ label, inputs: counts.inputs, clicks: counts.clicks }); out(`MEASURE ${label}: ${counts.inputs} inputs, ${counts.clicks} clicks`); };
const input = async (loc, v) => { await loc.fill(v); counts.inputs++; };
const click = async (loc) => { await loc.click(); counts.clicks++; };
async function signIn(email, password, lang = 'en') {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1900 } });
  await ctx.addInitScript((l) => { try { window.localStorage.setItem('language', l); } catch {} }, lang);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email} (${lang}) pageerror: ` + e.message.slice(0, 120)));
  page.on('console', (m) => { if (m.type() === 'error' && !/hydrat/i.test(m.text())) errors.push(`${email} (${lang}) console: ` + m.text().slice(0, 200)); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${email} (${lang}) http ${r.status()} ${r.url().replace(BASE, '').replace(API, '')}`); });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.getByRole('button', { name: /^(sign in|تسجيل الدخول)$/i }).click()]);
  await page.waitForTimeout(1200);
  out(`${email} (${lang}) → ${page.url()}`);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${EV}/screens/${name}.png`, fullPage: true }).then(() => out('shot ' + name));
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 240)); errors.push(`step ${name} failed`); } };
const text = async (page, n = 2000) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).slice(0, n);
const main = (page) => page.locator('main');

// ── The admin, English ──
const admin = await signIn('admin@igcse.local', 'AdminPass1');
await step('open', async () => { await admin.goto(`${BASE}/admin/messages`, { waitUntil: 'networkidle' }); await admin.waitForTimeout(1500); await shot(admin, 'd-01-new-message'); });
await step('announce-g11', measured('an announcement to parents of grade 11, and one for tomorrow (the same people)', async () => {
  const m = main(admin);
  await click(m.getByRole('button', { name: 'Parents of grade 11', exact: true }));
  await admin.waitForTimeout(800);
  await input(m.getByLabel('Title', { exact: true }), 'Grade 11 parents evening');
  await input(m.getByLabel('Message', { exact: true }), 'Dear {guardian}, the grade 11 parents evening is on Thursday at 17:00. Please come with {student}.');
  await admin.waitForTimeout(1200);
  await shot(admin, 'd-02-composed-preview');
  await click(m.getByRole('button', { name: /^Send to \d+ (person|people)$/ }));
  await m.getByText(/^Sent to/).first().waitFor({ timeout: 10000 });
  await shot(admin, 'd-03-sent');
  await input(m.getByLabel('Title', { exact: true }), 'Reminder: parents evening tomorrow');
  await input(m.getByLabel('Message', { exact: true }), 'The grade 11 parents evening is tomorrow at 17:00 in the main hall.');
  await click(m.getByRole('button', { name: 'Tomorrow 09:00', exact: true }));
  await click(m.getByRole('button', { name: /^Schedule for/ }));
  await m.getByText(/^Scheduled for/).first().waitFor({ timeout: 10000 });
  await shot(admin, 'd-04-scheduled');
}));
await step('log', async () => {
  await main(admin).getByRole('tab', { name: 'Sent' }).click(); await admin.waitForTimeout(1500);
  await shot(admin, 'd-05-log');
  out('LOG:\n' + (await text(admin, 1500)).split('\n').slice(0, 30).join('\n'));
  await main(admin).getByRole('button', { name: 'Deliveries' }).first().click(); await admin.waitForTimeout(1500);
  await shot(admin, 'd-06-deliveries');
});
await step('reminders', async () => {
  await main(admin).getByRole('tab', { name: 'Reminders' }).click(); await admin.waitForTimeout(1500);
  await shot(admin, 'd-07-reminders');
});
await step('rule-once', measured('a reminder rule set once (the payment rule for every session: its days)', async () => {
  const card = main(admin).locator('section', { has: admin.getByRole('heading', { name: 'Payment due (lines, instalments, charges)' }) });
  await click(card.getByRole('button', { name: 'Change' }).first());
  await input(card.getByLabel(/^Days/), '-10, -5, 0, 3');
  await input(card.getByLabel('Reason'), 'ten days ahead this year');
  await click(card.getByRole('button', { name: 'Save' }));
  await admin.waitForTimeout(1500);
  await shot(admin, 'd-08-rule-saved');
}));
await step('rule-restore', async () => {
  const card = main(admin).locator('section', { has: admin.getByRole('heading', { name: 'Payment due (lines, instalments, charges)' }) });
  await card.getByRole('button', { name: 'Change' }).first().click();
  await card.getByLabel(/^Days/).fill('-7, -3, 0, 3');
  await card.getByLabel('Reason').fill('back to the default days');
  await card.getByRole('button', { name: 'Save' }).click();
  await admin.waitForTimeout(1200);
});
await step('texts', async () => { await main(admin).getByRole('tab', { name: 'Texts' }).click(); await admin.waitForTimeout(1200); await shot(admin, 'd-09-texts'); });
await step('money-remind', async () => {
  await admin.goto(`${BASE}/admin/sessions/${SESSION}`, { waitUntil: 'networkidle' }); await admin.waitForTimeout(1500);
  await main(admin).getByRole('tab', { name: /^Money/ }).click().catch(async () => { await main(admin).getByRole('button', { name: /^Money/ }).first().click(); });
  await admin.waitForTimeout(1500);
  await shot(admin, 'd-10-money-tab');
});
await step('remind-count', measured("the Money tab's Remind to the families it shows", async () => {
  await click(main(admin).getByRole('button', { name: 'Remind', exact: true }));
  const dlg = admin.locator('[role=dialog]');
  await dlg.getByRole('button', { name: /^Remind \d+ famil/ }).waitFor({ timeout: 10000 });
  await admin.waitForTimeout(800);
  await shot(admin, 'd-11-remind-dialog');
  out('REMIND DIALOG:\n' + (await dlg.innerText()).slice(0, 1200));
  await click(dlg.getByRole('button', { name: /^Remind \d+ famil/ }));
  await dlg.getByText(/^Sent to/).waitFor({ timeout: 10000 });
  await shot(admin, 'd-12-remind-sent');
  await dlg.getByRole('button', { name: 'Close' }).click();
}));
await step('settings', async () => { await admin.goto(`${BASE}/settings`, { waitUntil: 'networkidle' }); await admin.waitForTimeout(2000); await admin.getByRole('heading', { name: 'Reminders', exact: true }).first().scrollIntoViewIfNeeded(); await shot(admin, 'd-13-settings'); });
await admin.context().close();

// ── The admin, Arabic (right to left) ──
const adminAr = await signIn('admin@igcse.local', 'AdminPass1', 'ar');
await step('ar', async () => {
  await adminAr.goto(`${BASE}/admin/messages`, { waitUntil: 'networkidle' }); await adminAr.waitForTimeout(2500);
  out('dir=' + await adminAr.evaluate(() => document.documentElement.dir) + ' lang=' + await adminAr.evaluate(() => document.documentElement.lang));
  await main(adminAr).getByRole('button', { name: 'أولياء أمور الصف 11', exact: true }).click(); await adminAr.waitForTimeout(800);
  await main(adminAr).locator('select').first().selectOption({ index: 1 }).catch(() => {});
  await adminAr.waitForTimeout(1200);
  await shot(adminAr, 'd-20-ar-new-message');
  out('AR NEW:\n' + (await text(adminAr, 1600)).split('\n').slice(0, 40).join('\n'));
  await main(adminAr).getByRole('tab').nth(1).click(); await adminAr.waitForTimeout(1500); await shot(adminAr, 'd-21-ar-log');
  await main(adminAr).getByRole('tab').nth(2).click(); await adminAr.waitForTimeout(1500); await shot(adminAr, 'd-22-ar-reminders');
  out('AR REMINDERS:\n' + (await text(adminAr, 1400)).split('\n').slice(0, 30).join('\n'));
  await main(adminAr).getByRole('tab').nth(3).click(); await adminAr.waitForTimeout(1200); await shot(adminAr, 'd-23-ar-texts');
  await adminAr.goto(`${BASE}/admin/sessions/${SESSION}`, { waitUntil: 'networkidle' }); await adminAr.waitForTimeout(1500);
  await main(adminAr).getByRole('tab').filter({ hasText: /المال|Money|المدفوعات/ }).first().click().catch(() => {});
  await adminAr.waitForTimeout(1200);
  await main(adminAr).getByRole('button', { name: 'تذكير', exact: true }).click(); await adminAr.waitForTimeout(2000);
  await shot(adminAr, 'd-24-ar-remind-dialog');
  out('AR REMIND:\n' + (await adminAr.locator('[role=dialog]').innerText()).slice(0, 900));
  await adminAr.goto(`${BASE}/settings`, { waitUntil: 'networkidle' }); await adminAr.waitForTimeout(2000);
  await adminAr.getByRole('heading', { name: 'التذكيرات' }).scrollIntoViewIfNeeded().catch(() => {});
  await shot(adminAr, 'd-25-ar-settings');
});
await adminAr.context().close();

// ── The finance officer ──
const officer = await signIn('officer.mona@igcse.local', 'TestPass1');
await step('officer', async () => {
  out('officer nav has Messages: ' + (await officer.getByRole('link', { name: 'Messages' }).count()));
  await officer.goto(`${BASE}/admin/messages`, { waitUntil: 'networkidle' }); await officer.waitForTimeout(1500);
  out('OFFICER tabs: ' + (await main(officer).getByRole('tab').allInnerTexts()).join(' | '));
  out('OFFICER lists: ' + (await main(officer).locator('select').first().locator('option').allInnerTexts()).join(' | '));
  await shot(officer, 'd-30-officer');
});
await officer.context().close();

// ── A family ──
const parent = await signIn('parent.d5@rwd.local', 'TestPass1');
await step('parent', async () => {
  await parent.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' }); await parent.waitForTimeout(1500);
  await shot(parent, 'd-40-parent-notifications');
  out('PARENT:\n' + (await text(parent, 1500)).split('\n').slice(0, 24).join('\n'));
  out('parent delete buttons: ' + (await main(parent).getByRole('button', { name: /delete|remove/i }).count()));
});
await parent.context().close();
const parentAr = await signIn('parent.d5@rwd.local', 'TestPass1', 'ar');
await step('parent-ar', async () => { await parentAr.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' }); await parentAr.waitForTimeout(2000); await shot(parentAr, 'd-41-parent-notifications-ar'); });
await parentAr.context().close();

writeFileSync(`${EV}/measure-counts.json`, JSON.stringify({ measuredAt: new Date().toISOString(), base: BASE, results }, null, 1) + '\n');
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
