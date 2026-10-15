// Reproduce the Arabic hydration warning: open a page with localStorage language=ar, collect console errors.
import { chromium } from 'playwright-core';

const WEB = process.env.WEB ?? 'http://localhost:3070';
const path = process.argv[2] ?? '/sign-in';
const lang = process.argv[3] ?? 'ar';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
if (process.env.COOKIE) await ctx.addCookies([{ name: 'language', value: lang, url: WEB }]);
await ctx.addInitScript((l) => { try { localStorage.setItem('language', l); } catch {} }, lang);
const page = await ctx.newPage();
const msgs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) msgs.push(`[${m.type()}] ${m.text().slice(0, 1500)}`); });
page.on('pageerror', (e) => msgs.push(`[pageerror] ${e.message.slice(0, 6000)}`));
await page.goto(WEB + path, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
console.log(JSON.stringify({ path, lang, html: await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir })), msgs }, null, 2));
await browser.close();
