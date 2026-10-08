// Lead's step 4 drive, stage 4: set up Accounting properly (subject form), undo the item's retake-only, set the series dates, confirm fees.
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3000';
const SESSION = 'http://localhost:3000/admin/sessions/a2944615-40a9-44a9-a93e-91350a48410a';
const SERIES_URL = process.env.SERIES_URL || `${BASE}/exams/series`;
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
const shot = (page, name) => page.screenshot({ path: `/tmp/lead-env-pw/l4-${name}.png`, fullPage: true }).then(() => out('shot ' + name));
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
const plus = (days) => new Date(Date.now() + days * 86400000);

const admin = await signIn('admin@igcse.local', 'AdminPass1');
await step('subject-setup', async () => {
  await admin.goto(SESSION, { waitUntil: 'networkidle' }); await admin.waitForTimeout(1000);
  await admin.locator('main table tbody tr', { hasText: /Accounting/ }).first().click(); clicks++; await admin.waitForTimeout(900);
  const drawer = admin.locator('[role=dialog]').first();
  // the item: back to Open
  const selects = drawer.locator('select');
  await selects.nth(2).selectOption({ label: 'Open' }); await admin.waitForTimeout(300);
  await drawer.getByRole('button', { name: /save item/i }).click(); await admin.waitForTimeout(1200);
  out('item reset to Open (not counted)');
  // the subject form: availability, fee, teacher
  await selects.nth(0).selectOption({ label: 'Open' }); inputs++;
  await drawer.locator('input[type=number]').first().fill('1200'); inputs++;
  await drawer.getByRole('button', { name: /show every teacher/i }).first().click(); clicks++; await admin.waitForTimeout(700);
  out('teacher controls after Show every teacher:\n' + (await describe(drawer)).slice(0, 12).join('\n'));
  const tsel = drawer.locator('select').nth(1);
  const topts = await tsel.locator('option').allInnerTexts(); out('select 1 options: ' + topts.slice(0, 8).join('/'));
  const teacherSel = drawer.locator('select', { has: admin.locator('option', { hasText: /teacher|Mr|Ms|Dr|\(/i }) }).first();
  const anyTeacherBox = drawer.locator('input[type=checkbox]');
  out('checkboxes in drawer: ' + await anyTeacherBox.count());
  const teacherList = await drawer.locator('label').allInnerTexts();
  out('labels: ' + teacherList.slice(0, 20).join(' | '));
  await shot(admin, '01-teachers-shown');
  // pick the first teacher checkbox whose label is not Grade 10 core / flags
  const tboxes = drawer.locator('label', { hasText: /^(?!.*(grade 10|group|first entry|earlier sitting)).*$/i }).locator('input[type=checkbox]');
  out('candidate teacher boxes: ' + await tboxes.count());
  const save = drawer.getByRole('button', { name: /^save$/i }).first();
  await save.click(); clicks++; await admin.waitForTimeout(1500);
  const still = admin.locator('[role=dialog]').first(); if (await still.count()) { out('drawer still open after Save: ' + (await still.innerText()).slice(0, 300).replace(/\n/g, ' | ')); await admin.keyboard.press('Escape'); await admin.waitForTimeout(500); }
  out('ROW AFTER: ' + (await admin.locator('main table tbody tr', { hasText: /Accounting/ }).first().innerText()).replace(/\n/g, ' | '));
  await shot(admin, '02-row-after');
});
await step('series-page', async () => {
  await admin.goto(SERIES_URL, { waitUntil: 'networkidle' }); await admin.waitForTimeout(1200);
  out('SERIES PAGE url: ' + admin.url()); out('SERIES PAGE:\n' + (await text(admin, 1500)));
  out('series buttons: ' + (await admin.locator('main button').allInnerTexts()).filter(Boolean).slice(0, 20).join(' | '));
  const row = admin.locator('main tr, main li, main div', { hasText: /June 2028/ }).last();
  if (await row.count()) { out('JUNE 2028 ROW: ' + (await row.innerText()).replace(/\n/g, ' | ').slice(0, 400)); const btn = row.getByRole('button').first(); if (await btn.count()) { out('row button: ' + (await btn.innerText())); await btn.click(); clicks++; await admin.waitForTimeout(800); const dlg = admin.locator('[role=dialog]').first(); const scope = (await dlg.count()) ? dlg : admin.locator('main'); out('SERIES EDIT inputs:\n' + (await describe(scope)).join('\n')); out('SERIES EDIT buttons: ' + (await scope.getByRole('button').allInnerTexts()).filter(Boolean).slice(0, 12).join(' | ')); await shot(admin, '03-series-edit'); } }
  await shot(admin, '04-series-page');
});
await step('confirm-fees', async () => {
  await admin.goto(SESSION + '#fees', { waitUntil: 'networkidle' }); await admin.waitForTimeout(1000);
  await admin.getByRole('tab', { name: /fees/i }).first().click(); await admin.waitForTimeout(1000);
  const confirm = admin.getByRole('button', { name: /confirm all/i }).first();
  await confirm.click(); clicks++; await admin.waitForTimeout(800);
  const dlg = admin.locator('[role=dialog]').first();
  if (await dlg.count()) { out('CONFIRM dialog:\n' + (await dlg.innerText()).slice(0, 600)); out('CONFIRM inputs:\n' + (await describe(dlg)).join('\n')); const ok = dlg.getByRole('button', { name: /confirm/i }).last(); await ok.click(); clicks++; await admin.waitForTimeout(1500); }
  const t = await text(admin, 2500); out('FEES after confirm: provisional=' + (t.match(/provisional/g) || []).length + ' confirmed=' + (t.match(/confirmed/g) || []).length);
  await shot(admin, '05-fees-confirmed');
});
out(`TOTAL: inputs ${inputs} clicks ${clicks}`);
await admin.context().close();
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
