// The review of 2ca07a4, items 1 and 2, driven on the dev system (3091/3090) as the admin: the forms'
// one-paper retake on a subject with a one-paper item (the line is that item, never the whole subject),
// and Add subject at a course fee of 0 as self-study only (the reason asked). Placeholder data only.
// Usage: SHEET=… node f7o-drive.mjs en|ar [submit]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const LANG = process.argv[2] ?? 'en';
const SUBMIT = process.argv[3] === 'submit';
const BASE = 'http://localhost:3090';
const API = 'http://localhost:3091';
const seed = JSON.parse(readFileSync('/tmp/f7/drive/seed.json', 'utf8'));
const out = (s) => console.log(s);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
await ctx.addInitScript((l) => { try { window.localStorage.setItem('language', l); } catch {} }, LANG);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error' && !/hydrat/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
page.on('response', (r) => { if (r.status() >= 500) errors.push(`http ${r.status()} ${r.url().replace(BASE, '').replace(API, '')}`); });
const shot = async (name, full = false) => { await page.screenshot({ path: `/tmp/lead-env-pw/f7o-${LANG}-${name}.png`, fullPage: full }); out('shot ' + name); };
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 240)); } };
const editor = async (n = 1400) => (await page.locator('[role=dialog]').first().innerText().catch(() => '')).slice(0, n);

await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
await page.fill('input[type=email], input[name=email]', 'admin@igcse.local');
await page.fill('input[type=password], input[name=password]', process.env.DEMO_ADMIN_PASSWORD ?? '');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.locator('button[type=submit]').first().click()]);
await page.waitForTimeout(1200);

let importId = null;
await step('upload', async () => {
  await page.goto(`${BASE}/imports`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  await page.locator('input[type=file]').setInputFiles(process.env.SHEET);
  await page.waitForTimeout(400);
  await Promise.all([page.waitForURL(/\/imports\/[^/]+/, { timeout: 30000 }), page.locator('main button').filter({ hasText: /Stage for review|للمراجعة/ }).last().click()]);
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500);
  importId = page.url().split('/imports/')[1].split(/[?#]/)[0];
  out('staged ' + importId);
});
const go = async (q) => { await page.goto(`${BASE}/imports/${importId}?${q}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200); };
await step('mapping', async () => {
  await go('tab=mapping');
  const selects = page.locator(`select:has(option[value="window:${seed.sessionId}"])`).filter({ hasText: /Nov|نوفمبر/ });
  for (let i = 0; i < await selects.count(); i++) { await selects.nth(i).selectOption(`window:${seed.sessionId}`); await page.waitForTimeout(1500); }
});
await step('one-paper line', async () => {
  await go('tab=rows');
  const rows = page.locator('[role=table] [role=row]').filter({ hasText: 'Nov 2026' });
  await rows.first().locator('button').last().click(); await page.waitForTimeout(1200);
  const sec = page.locator('[role=dialog] section[aria-labelledby="row-line"]').first();
  await sec.scrollIntoViewIfNeeded().catch(() => {});
  await sec.screenshot({ path: `/tmp/lead-env-pw/f7o-${LANG}-01-one-paper-section.png` });
  await shot('01-one-paper-row'); out('ROW:\n' + await editor());
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
});
await step('discard', async () => {
  const r = await page.request.post(`${API}/v1/imports/${importId}/discard`, { headers: { Origin: BASE } });
  out('discard ' + r.status());
});
await step('add subject at 0, self-study only', async () => {
  await page.goto(`${BASE}/admin/sessions/${seed.sessionId}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  await page.locator('main button').filter({ hasText: /^Add subject$|^إضافة مادة$/ }).first().click(); await page.waitForTimeout(800);
  await page.locator('#as-search').fill(process.env.ADD_SUBJECT ?? 'Demo Astronomy'); await page.waitForTimeout(600);
  await page.locator('[role=option]').filter({ hasText: process.env.ADD_SUBJECT ?? 'Demo Astronomy' }).first().click(); await page.waitForTimeout(400);
  out('fee prefilled: "' + await page.locator('#as-fee').inputValue() + '"');
  await page.locator('#as-avail').selectOption('self_study_only');
  await page.locator('#as-fee').fill('0'); await page.waitForTimeout(400);
  await shot('02-add-subject-reason-asked');
  out('DIALOG:\n' + await editor(1200));
  if (SUBMIT) {
    await page.locator('#as-zero').fill('Self-study this cycle: the board fee alone (demo)');
    await page.locator('[role=dialog] button[type=submit]').click(); await page.waitForTimeout(2000);
    await shot('03-added-self-study-at-0');
    out('after add, dialog open: ' + (await page.locator('[role=dialog]').count()));
  }
});
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
