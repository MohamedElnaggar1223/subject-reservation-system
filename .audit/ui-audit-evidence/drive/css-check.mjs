// F6: does the served stylesheet carry the reduced-motion rule (Turbopack has served a stale globals.css before)?
import { chromium } from 'playwright-core';
const WEB = process.env.WEB ?? 'http://localhost:3070';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
const found = await page.evaluate(() => {
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) if (r.media && /reduced-motion/.test(r.media.mediaText)) out.push((sheet.href ?? 'inline').slice(-60) + ' :: ' + r.cssText.slice(0, 160));
  }
  return out;
});
console.log(found.length ? found : 'no reduced-motion rule served');
await browser.close();
