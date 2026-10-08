// Lead's step 4 drive, stage 13: the desk collects Student F1's three family-reserved lines ("To collect now"), then the family's statement and the session's Money tab.
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3000';
const SESSION = 'http://localhost:3000/admin/sessions/a2944615-40a9-44a9-a93e-91350a48410a';
const out = (s) => console.log(s);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
let clicks = 0, inputs = 0;
async function signIn(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email} pageerror: ` + e.message.slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${email} console: ` + m.text().slice(0, 160)); });
  page.on('response', async (r) => { if (r.status() >= 400 && r.request().method() !== 'GET') { let body = ''; try { body = (await r.text()).slice(0, 300); } catch {} errors.push(`${email} http ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')} ${body}`); } });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.getByRole('button', { name: /^sign in$/i }).click()]);
  await page.waitForTimeout(1200);
  out(`${email} → ${page.url()}`);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `/tmp/lead-env-pw/l13-${name}.png`, fullPage: true }).then(() => out('shot ' + name));
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 200)); } };
const text = async (page, n = 1400) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).slice(0, n);

const officer = await signIn('officer.mona@igcse.local', 'TestPass1');
await step('collect-f1', async () => {
  await officer.goto(`${BASE}/desk`, { waitUntil: 'networkidle' }); await officer.waitForTimeout(1000);
  await officer.locator('input[placeholder*="student" i]').first().fill('Student F1'); inputs++; await officer.waitForTimeout(1200);
  await officer.getByText(/Student F1/).first().click(); clicks++; await officer.waitForTimeout(1500);
  const t = await text(officer, 6000);
  out('360 (collect bits):\n' + t.split('\n').filter((l) => /collect|owes|EGP|Accounting|Physics|Mathematics|verified|consent|Paid with/i.test(l)).slice(0, 20).join('\n'));
  out('360 buttons: ' + (await officer.locator('main button').allInnerTexts()).filter(Boolean).slice(0, 20).join(' | '));
  await shot(officer, '01-f1-360');
  const panel = officer.locator('main').locator('section, div', { hasText: /To collect now/ }).last();
  const boxes = officer.locator('main input[type=checkbox]:visible'); out('visible checkboxes: ' + await boxes.count());
  const labels = await officer.locator('main label:visible').allInnerTexts(); out('labels: ' + labels.filter(Boolean).slice(0, 20).join(' | '));
  const consent = officer.locator('main label', { hasText: /consent|signed|parent/i }).locator('input[type=checkbox]');
  const nc = await consent.count(); out('consent boxes: ' + nc); for (let i = 0; i < nc; i++) { if (!(await consent.nth(i).isChecked())) { await consent.nth(i).check(); inputs++; } }
  const collect = officer.locator('main').getByRole('button', { name: /^collect/i }).first(); out('collect button: ' + (await collect.innerText()).replace(/\n/g, ' '));
  await collect.click(); clicks++; await officer.waitForLoadState('networkidle'); await officer.waitForTimeout(2500);
  const dlg = officer.locator('[role=dialog]').first(); if (await dlg.count()) { out('DIALOG:\n' + (await dlg.innerText()).slice(0, 800)); await shot(officer, '02-collect-dialog'); const ok = dlg.getByRole('button', { name: /confirm|collect|ok|done/i }).last(); if (await ok.count()) { await ok.click(); clicks++; await officer.waitForTimeout(2000); } }
  out('AFTER COLLECT:\n' + (await text(officer, 3000)).split('\n').filter((l) => /collect|owes|EGP|receipt|RCP|paid|Accounting|Physics|Mathematics/i.test(l)).slice(0, 24).join('\n'));
  await shot(officer, '03-after-collect');
});
await officer.context().close();
const parent = await signIn('parent.f1@lead.local', 'TestPass1');
await step('statement-f1', async () => { await parent.goto(`${BASE}/statement`, { waitUntil: 'networkidle' }); await parent.waitForTimeout(1500); out('STATEMENT F1:\n' + (await text(parent, 2500))); await shot(parent, '04-statement-f1'); });
await parent.context().close();
const admin = await signIn('admin@igcse.local', 'AdminPass1');
await step('money-tab', async () => { await admin.goto(SESSION, { waitUntil: 'networkidle' }); await admin.waitForTimeout(800); await admin.getByRole('tab', { name: /money/i }).first().click(); await admin.waitForTimeout(1500); out('MONEY TAB:\n' + (await text(admin, 3500))); await shot(admin, '05-money'); await admin.getByRole('tab', { name: /verify/i }).first().click(); await admin.waitForTimeout(1200); out('TO VERIFY:\n' + (await text(admin, 2500)).split('\n').filter((l) => /Student F|Mathematics|declared|days left|Verify|Not confirmed/i.test(l)).slice(0, 10).join('\n')); await shot(admin, '06-to-verify'); });
await admin.context().close();
out(`TOTAL: inputs ${inputs} clicks ${clicks}`);
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
