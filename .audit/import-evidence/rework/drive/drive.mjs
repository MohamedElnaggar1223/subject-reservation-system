// F7's drive on the reworked model (3091/3090): upload, map to the session, the line in the session
// (legacy, declared, provisional, no grid row, a self-study first entry, a retake naming no sitting,
// a unit, an item staff choose), commit, the result, the session's Money and To verify tabs, the
// statement. Synthetic placeholder data only. Usage: node f7-drive.mjs en|ar
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
const shot = async (name, full = false) => { await page.screenshot({ path: `/tmp/lead-env-pw/f7r-${LANG}-${name}.png`, fullPage: full }); out('shot ' + name); };
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 240)); } };
const main = async (n = 900) => (await page.locator('main').innerText().catch(() => '')).slice(0, n);
const editor = async (n = 1400) => (await page.locator('[role=dialog]').first().innerText().catch(() => '')).slice(0, n);

await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
await page.fill('input[type=email], input[name=email]', 'admin@igcse.local');
await page.fill('input[type=password], input[name=password]', process.env.DEMO_ADMIN_PASSWORD ?? '');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.locator('button[type=submit]').first().click()]);
await page.waitForTimeout(1200);
out('signed in → ' + page.url());

let importId = process.argv[3] ?? null;
if (!importId) {
  await step('upload', async () => {
    await page.goto(`${BASE}/imports`, { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
    await shot('01-imports');
    await page.locator('input[type=file]').setInputFiles(process.env.SHEET ?? '/tmp/f7/drive/demo-sheet.xlsx');
    await page.waitForTimeout(400);
    await Promise.all([page.waitForURL(/\/imports\/[^/]+/, { timeout: 30000 }), page.locator('main button').filter({ hasText: /Stage for review|للمراجعة/ }).last().click()]);
    await page.waitForLoadState('networkidle'); await page.waitForTimeout(1500);
    importId = page.url().split('/imports/')[1].split(/[?#]/)[0];
    out('staged ' + importId);
    await shot('02-review-problems');
    out('REVIEW:\n' + await main(700));
  });
}
const go = async (q) => { await page.goto(`${BASE}/imports/${importId}?${q}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200); };

if (!process.argv[3]) await step('mapping', async () => {
  await go('tab=mapping');
  const selects = page.locator(`select:has(option[value="window:${seed.sessionId}"])`).filter({ hasText: /Nov|نوفمبر/ });
  const n = await selects.count();
  out('series selects: ' + n);
  for (let i = 0; i < n; i++) { await selects.nth(i).selectOption(`window:${seed.sessionId}`); await page.waitForTimeout(1500); }
  await shot('03-mapping');
  out('MAPPING:\n' + (await main(1600)).slice(0, 1600));
});

await step('problems', async () => { await go('tab=problems'); await shot('04-problems-mapped', true); out('PROBLEMS:\n' + await main(1500)); });

const openRow = async (search, ...must) => {
  await go(`tab=rows`);
  const box = page.locator('input[aria-label="Search the rows"], input[aria-label="ابحث في الأسطر"]').first();
  await box.fill(search); await page.waitForTimeout(900);
  let rows = page.locator('[role=table] [role=row]').filter({ hasText: 'Nov 2026' });
  for (const m of must) rows = rows.filter({ hasText: m });
  const n = await rows.count();
  out(`rows for "${search}" ${must.join('+')}: ${n}`);
  await rows.first().locator('button').last().click(); await page.waitForTimeout(1000);
};
const closeEditor = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(400); };

await step('legacy', async () => { await openRow('Demo Biology', process.env.S2 ?? 'Demo Student 2', 'Nov 2026'); await shot('05-line-legacy'); out('ROW 6:\n' + await editor()); await closeEditor(); });
await step('declared', async () => { await openRow('Demo Chemistry'); await shot('06-line-declared'); out('ROW 7:\n' + await editor()); await closeEditor(); });
await step('self-study first entry', async () => {
  await openRow('Demo Physics', process.env.S2 ?? 'Demo Student 2'); await shot('07-self-study-first-entry'); out('ROW 8:\n' + await editor(900));
  if (!process.argv[3]) { await page.locator('[role=dialog] button').filter({ hasText: /Taught in school instead|تُدرَّس في المدرسة/ }).first().click(); await page.waitForTimeout(1200); await shot('07b-taught-instead'); }
  await closeEditor();
});
await step('provisional', async () => { await openRow('Demo History'); await shot('08-line-provisional'); out('ROW 4:\n' + await editor(900)); await closeEditor(); });
await step('no grid row', async () => {
  await openRow('Demo Geography'); await shot('09-fee-missing'); out('ROW 5:\n' + await editor(900));
  if (!process.argv[3]) { await page.locator('[role=dialog] button').filter({ hasText: /Leave it out|استبعد/ }).first().click(); await page.waitForTimeout(1200); }
  await closeEditor();
});
await step('retake naming no sitting', async () => {
  await openRow('Demo Physics', process.env.S3 ?? 'Demo Student 3'); await shot('10-retake-no-sitting'); out('ROW 9:\n' + await editor(900));
  if (!process.argv[3]) {
    await page.locator('select[aria-label="Sitting month"], select[aria-label="شهر الدورة"]').first().selectOption('june');
    await page.locator('input[aria-label="Sitting year"], input[aria-label="سنة الدورة"]').first().fill('2026');
    await page.locator('[role=dialog] button').filter({ hasText: /Name this sitting|سمِّ هذه الدورة/ }).first().click(); await page.waitForTimeout(1500);
    await shot('10b-sitting-named'); out('ROW 9 after:\n' + await editor(900));
  }
  await closeEditor();
});
await step('unit', async () => { await openRow('Pure Mathematics'); await shot('11-unit-line'); out('ROW 10:\n' + await editor(900)); await closeEditor(); });
await step('item unclear', async () => {
  await openRow('Mathematics (P1'); await shot('12-item-unclear'); out('ROW 11:\n' + await editor(900));
  if (!process.argv[3]) {
    const sel = page.locator('select[aria-label="The item of the session this line is"], select[aria-label="بند الجلسة الذي يمثّله هذا السطر"]').first();
    const opts = await sel.locator('option').allInnerTexts();
    const p2 = opts.find((o) => /— P2/.test(o));
    await sel.selectOption({ label: p2 }); await page.waitForTimeout(1500);
    await shot('12b-item-chosen'); out('ROW 11 after:\n' + await editor(900));
  }
  await closeEditor();
});
if (!process.argv[3]) await step('commit', async () => {
  await go('tab=problems');
  await page.locator('main button').filter({ hasText: /^Commit|اعتماد/ }).first().click(); await page.waitForTimeout(700);
  await shot('13-commit-dialog'); out('DIALOG:\n' + (await page.locator('[role=dialog], [role=alertdialog]').first().innerText().catch(() => '')).slice(0, 700));
  await page.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: /^Commit$|^اعتماد$/ }).last().click();
  await page.waitForTimeout(4000);
});
await step('result', async () => { await go('tab=result'); await shot('14-result', true); out('RESULT:\n' + await main(1500)); });
await step('money', async () => {
  await page.goto(`${BASE}/admin/sessions/${seed.sessionId}#money`, { waitUntil: 'networkidle' }); await page.waitForTimeout(2000);
  await shot('15-session-money', true); out('MONEY:\n' + await main(1600));
});
await step('to verify', async () => {
  await page.goto(`${BASE}/admin/sessions/${seed.sessionId}#verify`, { waitUntil: 'networkidle' }); await page.waitForTimeout(2000);
  await shot('16-to-verify'); out('VERIFY:\n' + await main(1200));
});
await step('statement', async () => {
  const res = await page.request.get(`${API}/v1/users?search=${process.env.STU ?? 'demo.student2'}`, { headers: { Origin: BASE } }).catch(() => null);
  let sid = null;
  try { const j = await res.json(); sid = (j.data?.users ?? j.data ?? []).find?.((u) => u.email === `${process.env.STU ?? 'demo.student2'}@example.test`)?.id ?? null; } catch {}
  out('student id found: ' + !!sid);
  if (sid) { await page.goto(`${BASE}/statement?studentId=${sid}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(2000); await shot('17-statement', true); out('STATEMENT:\n' + await main(1600)); }
});
out('IMPORT ' + importId);
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
