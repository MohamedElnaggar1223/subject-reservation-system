// Shared by the F6a drives: sign in, switch language, screenshot as a JPEG under 300 KB, count inputs and clicks.
import { chromium } from 'playwright-core';
export const BASE = 'http://localhost:3150';
export const out = (...a) => console.log(...a);
export const browser = await chromium.launch({ channel: 'chrome', headless: true });
export const errors = [];
export async function signIn(email, password = 'TestPass1', lang = 'en') {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email} pageerror: ` + e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/hydrat/i.test(m.text())) errors.push(`${email} console: ` + m.text().slice(0, 200)); });
  page.on('response', async (r) => {
    if (r.status() >= 400 && r.request().method() !== 'GET') {
      let b = '';
      try { b = (await r.text()).slice(0, 300); } catch { /* gone */ }
      errors.push(`${email} http ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')} ${b}`);
    }
  });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.evaluate((l) => window.localStorage.setItem('language', l), lang);
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.locator('button[type=submit]').first().click()]);
  await page.waitForTimeout(1500);
  return page;
}
export async function setLang(page, lang) {
  await page.evaluate((l) => window.localStorage.setItem('language', l), lang);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}
export async function shot(page, name, opts = {}) {
  const path = `/tmp/sw-pw/shots/${name}.jpg`;
  await page.waitForTimeout(opts.wait ?? 800);
  await page.screenshot({ path, fullPage: opts.full ?? true, type: 'jpeg', quality: opts.quality ?? 60 });
  out('shot', name);
  return path;
}
export const step = async (name, fn) => {
  try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 300)); }
};
export const mainText = async (page, n = 3000) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).slice(0, n);
