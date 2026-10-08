// Do pages other than the import's show hydration errors in Arabic on this build? (counts only)
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3090';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const lang of ['ar', 'en']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((l) => { try { window.localStorage.setItem('language', l); } catch {} }, lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 60)));
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', 'admin@igcse.local');
  await page.fill('input[type=password], input[name=password]', process.env.DEMO_ADMIN_PASSWORD ?? '');
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.locator('button[type=submit]').first().click()]);
  await page.waitForTimeout(1200);
  for (const path of ['/admin/dashboard', '/admin/sessions', '/desk', '/imports']) {
    const before = errors.length;
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
    console.log(lang, path, 'pageerrors', errors.length - before, errors.slice(before).map((e) => e.slice(0, 40)).join(' | '));
  }
  await ctx.close();
}
await browser.close();
