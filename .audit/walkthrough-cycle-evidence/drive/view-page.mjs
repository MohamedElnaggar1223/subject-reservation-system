// Screenshots of chosen places of the walkthrough page, for review.
import { chromium } from 'playwright-core';
const file = '/tmp/f8/repo/docs/walkthrough/index.html';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`file://${file}`, { waitUntil: 'load' });
await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
for (const id of process.argv.slice(2)) {
  await page.evaluate((x) => document.getElementById(x)?.scrollIntoView(), id);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/f8-pw/view-${id}.jpg`, type: 'jpeg', quality: 70 });
}
await browser.close();
