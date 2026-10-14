// The review of 8 Oct, item 4: the family's Reserve page in Arabic with a session closed while it is
// open — A's and B's sentences in their own Arabic (no half-translated "Registration window غير مفتوحة").
// The dev system's demo family; placeholder data. Usage: node f7s-family.mjs ar|en
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const LANG = process.argv[2] ?? 'ar';
const BASE = 'http://localhost:3090';
const API = 'http://localhost:3091';
const fam = JSON.parse(readFileSync('/tmp/f7/drive/family.json', 'utf8'));
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
const main = async (n = 1500) => (await page.locator('main').innerText().catch(() => '')).slice(0, n);

await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
await page.fill('input[type=email], input[name=email]', fam.parentEmail);
await page.fill('input[type=password], input[name=password]', process.env.FAMILY_PASSWORD ?? '');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.locator('button[type=submit]').first().click()]);
await page.waitForTimeout(1200);
out('signed in → ' + page.url());

await step('reserve page', async () => {
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  const child = page.locator('#reserve-child');
  if (await child.count()) {
    const opts = await child.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    if (opts.length) await child.selectOption(opts[0]);
  }
  await page.locator('#reserve-session').selectOption(fam.sessionId); await page.waitForTimeout(2500);
  const boxes = page.locator('table input[type=checkbox]:not([disabled])');
  out('reservable boxes: ' + await boxes.count());
  if (await boxes.count()) await boxes.first().check();
  await page.waitForTimeout(600);
  for (const b of await page.locator('main label input[type=checkbox]:not([disabled])').all()) { if (!(await b.isChecked())) await b.check().catch(() => {}); }
  await page.waitForTimeout(600);
  await shot('05-family-reserve', true); out('RESERVE:\n' + await main());
});
await step('close the session meanwhile (the admin)', async () => {
  const res = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ email: 'admin@igcse.local', password: process.env.DEMO_ADMIN_PASSWORD ?? '' }) });
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const r = await fetch(`${API}/v1/sessions/${fam.sessionId}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie }, body: JSON.stringify({ reason: 'closed during the family check (demo)' }) });
  out('close: ' + r.status);
});
await step('reserve refused', async () => {
  await page.locator('main button').filter({ hasText: /^Reserve|^احجز|^الحجز/ }).last().click(); await page.waitForTimeout(2500);
  await shot('06-family-refused', true); out('REFUSED:\n' + await main());
});
await step('after the close', async () => {
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500);
  await shot('07-family-after-close'); out('AFTER:\n' + await main(800));
});
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
