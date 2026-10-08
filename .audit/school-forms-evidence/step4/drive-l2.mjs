// Lead's step 4 drive, stage 2: create June 2028 from scratch, explore and use Add subject, the Fees tab and the deadlines; count inputs and clicks.
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
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`${email} http ${r.status()} ${r.url().replace(BASE, '')}`); });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.getByRole('button', { name: /^sign in$/i }).click()]);
  await page.waitForTimeout(1200);
  out(`${email} → ${page.url()}`);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `/tmp/lead-env-pw/l2-${name}.png`, fullPage: true }).then(() => out('shot ' + name));
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 200)); } };
const text = async (page, n = 1400) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).slice(0, n);
const describe = async (scope) => {
  const items = [];
  const els = scope.locator('input:visible, select:visible, textarea:visible, [role=combobox]:visible, [role=switch]:visible, [role=radio]:visible, [role=checkbox]:visible');
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
const iso = (d) => d.toISOString().slice(0, 16);
const now = new Date();
const plus = (days) => new Date(now.getTime() + days * 86400000);

const admin = await signIn('admin@igcse.local', 'AdminPass1');
let sessionUrl = '';
await step('create', async () => {
  await admin.goto(`${BASE}/admin/sessions`, { waitUntil: 'networkidle' }); await admin.waitForTimeout(800);
  await admin.getByRole('button', { name: /new session/i }).first().click(); clicks++; await admin.waitForTimeout(800);
  const dlg = admin.locator('[role=dialog]').first();
  const sel = dlg.locator('select').first(); await sel.selectOption({ label: 'June' }); inputs++;
  await dlg.locator('input[type=number]').first().fill('2028'); inputs++;
  const dts = dlg.locator('input[type=datetime-local]');
  await dts.nth(0).fill(iso(plus(-1))); inputs++;
  await dts.nth(1).fill(iso(plus(90))); inputs++;
  await dlg.locator('input[type=date]').first().fill(plus(14).toISOString().slice(0, 10)); inputs++;
  await dts.nth(2).fill(iso(plus(45))); inputs++;
  await shot(admin, '01-new-filled');
  await dlg.getByRole('button', { name: /create session/i }).click(); clicks++; await admin.waitForLoadState('networkidle'); await admin.waitForTimeout(1500);
  sessionUrl = admin.url(); out(`created → ${sessionUrl} · inputs ${inputs} clicks ${clicks}`);
  out('SESSION HEAD:\n' + (await text(admin, 700)));
  await shot(admin, '02-created');
});
const addSubject = async (label, courseFee) => {
  const before = { i: inputs, c: clicks };
  await admin.getByRole('button', { name: /add subject/i }).first().click(); clicks++; await admin.waitForTimeout(800);
  const dlg = admin.locator('[role=dialog]').first();
  if (label === 'explore') { out('ADD SUBJECT text:\n' + (await dlg.innerText()).slice(0, 1200)); out('ADD SUBJECT inputs:\n' + (await describe(dlg)).join('\n')); out('ADD SUBJECT buttons: ' + (await dlg.getByRole('button').allInnerTexts()).join(' | ')); await shot(admin, '03-add-subject'); }
  const sel = dlg.locator('select').first();
  const opts = await sel.locator('option').allInnerTexts();
  const idx = label === 'explore' ? 1 : Math.max(1, opts.findIndex((o) => o.includes(label)));
  await sel.selectOption({ index: idx }); inputs++; await admin.waitForTimeout(600);
  if (label === 'explore') { out('after subject pick, inputs:\n' + (await describe(dlg)).join('\n')); }
  const fee = dlg.locator('input[type=number], input[inputmode=decimal], input[inputmode=numeric]').first();
  if (await fee.count()) { await fee.fill(String(courseFee)); inputs++; }
  const btn = dlg.getByRole('button', { name: /^(add|add subject|save|create)/i }).last();
  out(`add button: ${await btn.innerText().catch(() => '?')}`);
  await btn.click(); clicks++; await admin.waitForTimeout(1500);
  const open = admin.locator('[role=dialog]').first();
  if (await open.count()) { out('after add, a dialog/drawer is open:\n' + (await open.innerText()).slice(0, 900)); out('drawer inputs:\n' + (await describe(open)).join('\n')); out('drawer buttons: ' + (await open.getByRole('button').allInnerTexts()).join(' | ')); await shot(admin, '04-after-add-' + (label === 'explore' ? 'first' : label.replace(/\W/g, ''))); await admin.keyboard.press('Escape'); await admin.waitForTimeout(500); }
  out(`subject "${opts[idx]}" added · inputs +${inputs - before.i} clicks +${clicks - before.c}`);
};
await step('add-1', () => addSubject('explore', 1200));
await step('add-2', () => addSubject('Mathematics', 1100));
await step('add-3', () => addSubject('Physics', 1300));
await step('subjects-after', async () => { out('SUBJECTS TAB:\n' + (await text(admin, 1600)).split('\n').slice(0, 40).join('\n')); await shot(admin, '05-subjects'); });
await step('fees', async () => { await admin.getByRole('tab', { name: /fees/i }).first().click(); clicks++; await admin.waitForTimeout(1200); out('FEES TAB:\n' + (await text(admin, 2000))); out('fees buttons: ' + (await admin.locator('main button').allInnerTexts()).filter(Boolean).slice(0, 20).join(' | ')); out('fees inputs:\n' + (await describe(admin.locator('main'))).slice(0, 12).join('\n')); await shot(admin, '06-fees'); });
await step('deadlines', async () => { const t = await text(admin, 3000); out('DEADLINES bits:\n' + t.split('\n').filter((l) => /deadline|entry|retake|exams|date/i.test(l)).slice(0, 10).join('\n')); const edit = admin.getByRole('button', { name: /^edit$/i }).first(); if (await edit.count()) { await edit.click(); await admin.waitForTimeout(700); const dlg = admin.locator('[role=dialog]').first(); out('EDIT SESSION inputs:\n' + (await describe(dlg)).join('\n')); await shot(admin, '07-edit-session'); await admin.keyboard.press('Escape'); } });
out(`TOTAL so far: inputs ${inputs} clicks ${clicks}`);
await admin.context().close();
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
