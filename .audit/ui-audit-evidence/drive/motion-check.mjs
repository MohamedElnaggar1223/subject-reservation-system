// F6: the entrance animation with and without the reader's reduced-motion preference (sign-in's panel).
import { chromium } from 'playwright-core';
const WEB = process.env.WEB ?? 'http://localhost:3070';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const reducedMotion of ['no-preference', 'reduce']) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion });
  const page = await ctx.newPage();
  await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
  const names = await page.evaluate(() => [...document.querySelectorAll('.animate-fade-up')].map((e) => getComputedStyle(e).animationName));
  console.log(reducedMotion, 'animate-fade-up elements:', names.length, 'animation names:', [...new Set(names)].join(','));
  await ctx.close();
}
await browser.close();
