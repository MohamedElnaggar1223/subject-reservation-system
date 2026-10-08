// Agent D: the Settings screen's Reminders group, English and Arabic (element screenshots: the page scrolls inside main).
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3130';
const EV = process.env.EV;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const lang of ['en', 'ar']) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1200 } });
  await ctx.addInitScript((l) => { try { window.localStorage.setItem('language', l); } catch {} }, lang);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', 'admin@igcse.local');
  await page.fill('input[type=password], input[name=password]', 'AdminPass1');
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.getByRole('button', { name: /^(sign in|تسجيل الدخول)$/i }).click()]);
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const section = page.locator('section', { has: page.locator('#group-reminders') });
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: `${EV}/screens/d-14-settings-reminders-${lang}.png` });
  console.log(lang, (await section.innerText()).slice(0, 900));
  await ctx.close();
}
await browser.close();
