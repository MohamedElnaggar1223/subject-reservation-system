// Open the walkthrough page offline (file://) and check it: every image loads, every in-page link has its
// target, no external request; shots of a few places for review.
import { chromium } from 'playwright-core';
const file = process.argv[2] ?? '/tmp/f8/repo/docs/walkthrough/index.html';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const external = [];
page.on('request', (r) => { if (!r.url().startsWith('file://')) external.push(r.url()); });
await page.goto(`file://${file}`, { waitUntil: 'load' });
// Load every lazy image.
await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelectorAll('img').forEach((i) => { i.loading = 'eager'; }); });
await page.evaluate(async () => { for (const i of document.querySelectorAll('img')) { i.scrollIntoView(); await new Promise((r) => setTimeout(r, 5)); } });
await page.waitForTimeout(1500);
const res = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('img')];
  const broken = imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src'));
  const anchors = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href').slice(1));
  const missing = anchors.filter((id) => !document.getElementById(id));
  return { images: imgs.length, broken, links: anchors.length, missing, steps: document.querySelectorAll('section.step').length };
});
console.log(JSON.stringify(res), 'external requests:', external.length);
for (const [id, name] of [['p1', 'page-p1'], ['s2-1', 'page-team'], ['s2-37', 'page-sheet-step'], ['p4', 'page-p4']]) {
  await page.evaluate((x) => document.getElementById(x)?.scrollIntoView(), id);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/f8-pw/${name}.jpg`, type: 'jpeg', quality: 70 });
}
await browser.close();
