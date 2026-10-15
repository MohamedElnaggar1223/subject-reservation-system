// A signed-in page in a language, with React's whole hydration message: node hydration-signed.mjs <role> <path> <lang>
import { chromium } from 'playwright-core';
import { ACCOUNTS } from './screens.mjs';
const WEB = 'http://localhost:3070';
const [role, path, lang = 'ar'] = process.argv.slice(2);
const a = ACCOUNTS[role];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.addCookies([{ name: 'language', value: lang, url: WEB }]);
const page = await ctx.newPage();
await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
await page.fill('input[type=email]', a.email);
await page.fill('input[type=password]', a.password);
await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in')), page.locator('button[type=submit]').click()]);
const msgs = [];
page.on('pageerror', (e) => msgs.push(e.message));
for (let i = 0; i < Number(process.env.TRIES ?? 3); i++) {
  await page.goto(WEB + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}
console.log(msgs.length ? msgs.map((m) => m.slice(-2500)).join('\n=====\n') : 'no page errors');
await browser.close();
