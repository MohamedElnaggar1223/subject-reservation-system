// The review of 8 Oct, items 2 and 4, driven on the dev system (3091/3090) as the admin: a sheet line
// naming two units split into two lines, each priced; a line naming a unit the session does not offer
// held for staff's choice of that code's item, then chosen; the commit and the result listing the rows
// split. Synthetic placeholder data only. Usage: SHEET=… node f7s-drive.mjs en|ar
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const LANG = process.argv[2] ?? 'en';
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
const shot = async (name, full = false) => { await page.screenshot({ path: `/tmp/lead-env-pw/f7s-${LANG}-${name}.png`, fullPage: full }); out('shot ' + name); };
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 240)); } };
const main = async (n = 900) => (await page.locator('main').innerText().catch(() => '')).slice(0, n);
const editor = async (n = 1600) => (await page.locator('[role=dialog]').first().innerText().catch(() => '')).slice(0, n);

await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
await page.fill('input[type=email], input[name=email]', 'admin@igcse.local');
await page.fill('input[type=password], input[name=password]', process.env.DEMO_ADMIN_PASSWORD ?? '');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.locator('button[type=submit]').first().click()]);
await page.waitForTimeout(1200);
out('signed in → ' + page.url());

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
  const n = await selects.count();
  out('series selects: ' + n);
  for (let i = 0; i < n; i++) { await selects.nth(i).selectOption(`window:${seed.sessionId}`); await page.waitForTimeout(1500); }
});
const openRow = async (search) => {
  await go(`tab=rows`);
  const box = page.locator('input[aria-label="Search the rows"], input[aria-label="ابحث في الأسطر"]').first();
  await box.fill(search); await page.waitForTimeout(900);
  const rows = page.locator('[role=table] [role=row]').filter({ hasText: 'Nov 2026' });
  out(`rows for "${search}": ${await rows.count()}`);
  await rows.first().locator('button').last().click(); await page.waitForTimeout(1000);
};
const closeEditor = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(400); };
const lineSection = async (name) => {
  const sec = page.locator('[role=dialog] section[aria-labelledby="row-line"]').first();
  await sec.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await sec.screenshot({ path: `/tmp/lead-env-pw/f7s-${LANG}-${name}-section.png` }).catch((e) => out('section shot failed ' + String(e).slice(0, 120)));
};

await step('split', async () => {
  await openRow('Mathematics (P1 & P2)');
  await shot('01-split-row'); await lineSection('01-split'); out('SPLIT ROW:\n' + await editor());
  await closeEditor();
});
await step('code unclear', async () => {
  await openRow('Mathematics (P1 & P5)');
  await shot('02-code-unclear'); await lineSection('02-code-unclear'); out('UNCLEAR ROW:\n' + await editor());
  const sel = page.locator('select[aria-label="The session’s item for the sheet’s code p5"], select[aria-label="بند الجلسة لرمز الجدول p5"]').first();
  const opts = await sel.locator('option').allInnerTexts();
  out('p5 options: ' + opts.join(' | '));
  const m1 = opts.find((o) => /— M1/.test(o));
  await sel.selectOption({ label: m1 }); await page.waitForTimeout(1800);
  await shot('03-code-chosen'); await lineSection('03-code-chosen'); out('CHOSEN ROW:\n' + await editor());
  await closeEditor();
});
await step('commit', async () => {
  await go('tab=problems');
  await page.locator('main button').filter({ hasText: /^Commit|اعتماد/ }).first().click(); await page.waitForTimeout(700);
  out('DIALOG:\n' + (await page.locator('[role=dialog], [role=alertdialog]').first().innerText().catch(() => '')).slice(0, 700));
  await page.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: /^Commit$|^اعتماد$/ }).last().click();
  await page.waitForTimeout(4500);
});
await step('result', async () => { await go('tab=result'); await shot('04-result', true); out('RESULT:\n' + await main(1500)); });
out('IMPORT ' + importId);
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
