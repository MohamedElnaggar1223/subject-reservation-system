// Lead's step 4 drive, stage 5: a placeholder teacher via the Team page; the June 2028 series dates on the Board Series page.
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3000';
const out = (s) => console.log(s);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
let clicks = 0, inputs = 0;
async function signIn(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email} pageerror: ` + e.message.slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${email} console: ` + m.text().slice(0, 160)); });
  page.on('response', (r) => { if (r.status() >= 400 && r.request().method() !== 'GET') errors.push(`${email} http ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.getByRole('button', { name: /^sign in$/i }).click()]);
  await page.waitForTimeout(1200);
  out(`${email} → ${page.url()}`);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `/tmp/lead-env-pw/l5-${name}.png`, fullPage: true }).then(() => out('shot ' + name));
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 200)); } };
const text = async (page, n = 1400) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).slice(0, n);
const describe = async (scope) => {
  const items = [];
  const els = scope.locator('input:visible, select:visible, textarea:visible, [role=combobox]:visible, [role=switch]:visible, [role=checkbox]:visible');
  const n = await els.count();
  for (let i = 0; i < n; i++) {
    const el = els.nth(i);
    const tag = await el.evaluate((e) => e.tagName.toLowerCase());
    const type = await el.getAttribute('type');
    const name = (await el.getAttribute('name')) || (await el.getAttribute('aria-label')) || (await el.getAttribute('placeholder')) || '';
    const id = await el.getAttribute('id');
    let label = '';
    if (id) label = await scope.locator(`label[for="${id}"]`).first().innerText().catch(() => '');
    const val = tag === 'select' ? (await el.locator('option').allInnerTexts()).slice(0, 8).join('/') : await el.inputValue().catch(() => '');
    items.push(`${i}: ${tag}${type ? '[' + type + ']' : ''} ${label || name} = ${String(val).slice(0, 80)}`);
  }
  return items;
};
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const dt = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 16);

const admin = await signIn('admin@igcse.local', 'AdminPass1');
await step('team', async () => {
  const link = admin.locator('nav a, aside a', { hasText: /^Team$/ }).first();
  if (await link.count()) { await link.click(); await admin.waitForLoadState('networkidle'); } else await admin.goto(`${BASE}/admin/team`, { waitUntil: 'networkidle' });
  await admin.waitForTimeout(1000); out('TEAM url: ' + admin.url()); out('TEAM:\n' + (await text(admin, 900)));
  out('team buttons: ' + (await admin.locator('main button').allInnerTexts()).filter(Boolean).slice(0, 16).join(' | '));
  const add = admin.getByRole('button', { name: /add|invite|new/i }).first();
  if (await add.count()) { out('add button: ' + (await add.innerText())); await add.click(); await admin.waitForTimeout(800); const dlg = admin.locator('[role=dialog]').first(); const scope = (await dlg.count()) ? dlg : admin.locator('main'); out('ADD MEMBER inputs:\n' + (await describe(scope)).join('\n')); out('ADD MEMBER text: ' + (await scope.innerText()).slice(0, 700).replace(/\n/g, ' | ')); await shot(admin, '01-team-add'); await admin.keyboard.press('Escape'); }
});
await step('series-dates', async () => {
  await admin.goto(`${BASE}/exams/series`, { waitUntil: 'networkidle' }); await admin.waitForTimeout(1000);
  const year = admin.locator('main select').first();
  const yopts = await year.locator('option').allInnerTexts(); out('year options: ' + yopts.join('/'));
  const idx = yopts.findIndex((o) => o.includes('2027/28')); if (idx >= 0) { await year.selectOption({ index: idx }); inputs++; await admin.waitForTimeout(1200); }
  out('SERIES 2027/28:\n' + (await text(admin, 1600)).split('\n').filter((l) => /June 2028|deadline|Dates|confirmed/i.test(l)).slice(0, 12).join('\n'));
  const row = admin.locator('main table tbody tr', { hasText: /June 2028/ }).first();
  if (!(await row.count())) { out('no June 2028 row; rows: ' + (await admin.locator('main table tbody tr').allInnerTexts()).map((t) => t.split('\n')[0]).join(' | ')); return; }
  await row.getByRole('button', { name: /dates/i }).first().click(); clicks++; await admin.waitForTimeout(800);
  const dlg = admin.locator('[role=dialog]').first(); const scope = (await dlg.count()) ? dlg : admin.locator('main');
  out('DATES text: ' + (await scope.innerText()).slice(0, 900).replace(/\n/g, ' | '));
  out('DATES inputs:\n' + (await describe(scope)).join('\n'));
  out('DATES buttons: ' + (await scope.getByRole('button').allInnerTexts()).filter(Boolean).join(' | '));
  await shot(admin, '02-dates-dialog');
  // fill: every date/datetime input in order with sensible values
  const dts = scope.locator('input[type=datetime-local]:visible'); const ds = scope.locator('input[type=date]:visible');
  const nd = await dts.count(), nn = await ds.count(); out(`datetime inputs ${nd}, date inputs ${nn}`);
  const plan = [60, 75, 90, 150, 180];
  for (let i = 0; i < nd; i++) { await dts.nth(i).fill(dt(plan[i] ?? 100)); inputs++; }
  for (let i = 0; i < nn; i++) { await ds.nth(i).fill(day(plan[nd + i] ?? 120)); inputs++; }
  const save = scope.getByRole('button', { name: /save|set|apply|confirm/i }).last();
  out('save button: ' + (await save.innerText().catch(() => '?'))); await save.click(); clicks++; await admin.waitForTimeout(1500);
  const after = admin.locator('[role=dialog]').first(); if (await after.count()) { out('dialog still open: ' + (await after.innerText()).slice(0, 400).replace(/\n/g, ' | ')); await admin.keyboard.press('Escape'); }
  out('ROW AFTER: ' + (await admin.locator('main table tbody tr', { hasText: /June 2028/ }).first().innerText()).replace(/\n/g, ' | ').slice(0, 400));
  await shot(admin, '03-series-after');
});
out(`TOTAL: inputs ${inputs} clicks ${clicks}`);
await admin.context().close();
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
