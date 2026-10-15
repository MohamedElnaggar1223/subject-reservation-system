// F6 group 7: the sign-in refusal and the sign-up checks, as a person meets them, in EN and AR.
// For each: the sentence shown, whether it is in an alert (announced), console errors.
import { chromium } from 'playwright-core';
const WEB = process.env.WEB ?? 'http://localhost:3070';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const lang of ['en', 'ar']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: 'language', value: lang, url: WEB }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 160)));

  // 1. Sign in with a wrong password.
  await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('#email', 'nobody-placeholder@example.com');
  await page.fill('#password', 'wrong-password-1');
  await page.locator('form button[type=submit]').click();
  const alert = page.locator('form [role=alert]');
  await alert.first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  console.log(lang, 'sign-in refusal:', JSON.stringify(await alert.first().innerText()));

  // 2. Parent sign-up with passwords that differ.
  await page.goto(`${WEB}/sign-up/parent`, { waitUntil: 'networkidle' });
  const inputs = page.locator('form input');
  const n = await inputs.count();
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(await inputs.nth(i).getAttribute('id'));
  await page.fill('#name', 'Parent Placeholder').catch(() => {});
  await page.fill('#email', 'parent-placeholder@example.com').catch(() => {});
  const pw = ids.filter((x) => x && /password/i.test(x));
  await page.fill('#' + pw[0], 'abcdefgh1');
  await page.fill('#' + pw[1], 'abcdefgh2');
  await page.locator('form button[type=submit]').click();
  await page.waitForTimeout(800);
  const a2 = page.locator('form [role=alert]');
  console.log(lang, 'parent sign-up inputs:', ids.join(','), '| alert:', (await a2.count()) ? JSON.stringify(await a2.first().innerText()) : '(none)');
  console.log(lang, 'console errors:', errors.length ? errors : 'none');
  await ctx.close();
}
await browser.close();
