// Lead's step 4 drive, stage 3: open a subject's drawer on June 2028, set it up (availability, teacher, fee), the Fees tab, the series dates.
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3000';
const SESSION = process.env.SESSION_URL || 'http://localhost:3000/admin/sessions/a2944615-40a9-44a9-a93e-91350a48410a';
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
const shot = (page, name) => page.screenshot({ path: `/tmp/lead-env-pw/l3-${name}.png`, fullPage: true }).then(() => out('shot ' + name));
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

const admin = await signIn('admin@igcse.local', 'AdminPass1');
await admin.goto(SESSION, { waitUntil: 'networkidle' }); await admin.waitForTimeout(1000);
await step('drawer', async () => {
  const row = admin.locator('main table tbody tr', { hasText: /Accounting/ }).first();
  await row.click(); clicks++; await admin.waitForTimeout(900);
  const drawer = admin.locator('[role=dialog]').first();
  out('DRAWER text:\n' + (await drawer.innerText()).slice(0, 1800));
  out('DRAWER inputs:\n' + (await describe(drawer)).join('\n'));
  out('DRAWER buttons: ' + (await drawer.getByRole('button').allInnerTexts()).filter(Boolean).join(' | '));
  await shot(admin, '01-drawer');
  // set availability open, teacher, course fee
  const avail = drawer.locator('select').first();
  const opts = await avail.locator('option').allInnerTexts(); out('first select options: ' + opts.join('/'));
  const openIdx = opts.findIndex((o) => /^open/i.test(o)); if (openIdx >= 0) { await avail.selectOption({ index: openIdx }); inputs++; await admin.waitForTimeout(500); }
  out('after availability, inputs:\n' + (await describe(drawer)).join('\n'));
  const fee = drawer.locator('input[type=number], input[inputmode=decimal]').first(); if (await fee.count()) { await fee.fill('1200'); inputs++; }
  const addTeacher = drawer.getByRole('button', { name: /add teacher|teacher/i }).first();
  if (await addTeacher.count()) { out('teacher button: ' + (await addTeacher.innerText())); await addTeacher.click(); clicks++; await admin.waitForTimeout(600); out('after teacher button, inputs:\n' + (await describe(drawer)).join('\n')); const tsel = drawer.locator('select').last(); const topts = await tsel.locator('option').allInnerTexts(); out('teacher options: ' + topts.slice(0, 8).join('/')); if (topts.length > 1) { await tsel.selectOption({ index: 1 }); inputs++; } }
  await shot(admin, '02-drawer-filled');
  const save = drawer.getByRole('button', { name: /^save|save changes|done/i }).last();
  if (await save.count()) { out('save button: ' + (await save.innerText())); await save.click(); clicks++; await admin.waitForTimeout(1500); }
  const still = admin.locator('[role=dialog]').first(); if (await still.count()) { out('drawer still open; text: ' + (await still.innerText()).slice(0, 400).replace(/\n/g, ' | ')); await admin.keyboard.press('Escape'); await admin.waitForTimeout(500); }
  const rowAfter = admin.locator('main table tbody tr', { hasText: /Accounting/ }).first();
  out('ROW AFTER: ' + (await rowAfter.innerText()).replace(/\n/g, ' | '));
  out(`drawer cost: inputs ${inputs} clicks ${clicks}`);
  await shot(admin, '03-row-after');
});
await step('fees', async () => {
  await admin.getByRole('tab', { name: /fees/i }).first().click(); clicks++; await admin.waitForTimeout(1200);
  out('FEES TAB:\n' + (await text(admin, 2200)));
  out('fees buttons: ' + (await admin.locator('main button').allInnerTexts()).filter(Boolean).slice(0, 24).join(' | '));
  out('fees inputs:\n' + (await describe(admin.locator('main'))).slice(0, 14).join('\n'));
  await shot(admin, '04-fees');
});
await step('series-dates', async () => {
  await admin.getByRole('tab', { name: /subjects/i }).first().click(); await admin.waitForTimeout(800);
  const dates = admin.getByText(/Dates not set/).first();
  if (await dates.count()) { await dates.click(); await admin.waitForTimeout(900); const dlg = admin.locator('[role=dialog]').first(); if (await dlg.count()) { out('DATES dialog:\n' + (await dlg.innerText()).slice(0, 900)); out('DATES inputs:\n' + (await describe(dlg)).join('\n')); await shot(admin, '05-dates'); await admin.keyboard.press('Escape'); } else out('Dates not set: no dialog; url ' + admin.url()); }
  const correct = admin.getByRole('button', { name: /correct the series/i }).first();
  if (await correct.count()) { await correct.click(); await admin.waitForTimeout(800); const dlg = admin.locator('[role=dialog]').first(); if (await dlg.count()) { out('CORRECT dialog:\n' + (await dlg.innerText()).slice(0, 700)); out('CORRECT inputs:\n' + (await describe(dlg)).join('\n')); await shot(admin, '06-correct'); await admin.keyboard.press('Escape'); } }
});
out(`TOTAL: inputs ${inputs} clicks ${clicks}`);
await admin.context().close();
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
