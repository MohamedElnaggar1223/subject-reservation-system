// The review of a326890, item 3, driven on the dev system (3091/3090) as the admin: a new winter session
// copied from the drive's winter session shows, before it opens, what came across closed (no course fee)
// and what came across self-study only at a course fee of 0 (its reason recorded). Placeholder data only.
// Usage: node f7c-drive.mjs en|ar <November year>
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const LANG = process.argv[2] ?? 'en';
const YEAR = process.argv[3] ?? '2027';
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
const shot = async (name) => { await page.screenshot({ path: `/tmp/lead-env-pw/f7c-${LANG}-${name}.png` }); out('shot ' + name); };
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 240)); } };

await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
await page.fill('input[type=email], input[name=email]', 'admin@igcse.local');
await page.fill('input[type=password], input[name=password]', process.env.DEMO_ADMIN_PASSWORD ?? '');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.locator('button[type=submit]').first().click()]);
await page.waitForTimeout(1200);

await step('new session copied', async () => {
  await page.goto(`${BASE}/admin/sessions`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
  await page.locator('main button').filter({ hasText: /^New session$|^جلسة جديدة$/ }).first().click(); await page.waitForTimeout(600);
  await page.locator('#ns-type').selectOption('winter');
  await page.locator('#ns-year').fill(YEAR);
  const d = (days) => { const t = new Date(Date.now() + days * 86_400_000); const p = (n) => String(n).padStart(2, '0'); return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`; };
  await page.locator('#ns-from').fill(`${d(-1)}T08:00`);
  await page.locator('#ns-to').fill(`${d(30)}T20:00`);
  await page.locator('#ns-course').fill(d(5));
  await page.locator('#ns-due').fill(`${d(30)}T20:00`);
  await page.locator('#ns-copy').selectOption(seed.sessionId);
  await page.locator('[role=dialog] button[type=submit]').click(); await page.waitForTimeout(3000);
  await shot('01-new-session-copy-summary');
  out('MODAL:\n' + (await page.locator('[role=dialog]').first().innerText().catch(() => '')).slice(0, 1500));
  await page.locator('[role=dialog] button').filter({ hasText: /^Open the session$|^افتح الجلسة$/ }).first().click(); await page.waitForTimeout(2500);
  out('opened ' + page.url().replace(BASE, ''));
  await shot('02-new-session-subjects');
});
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
