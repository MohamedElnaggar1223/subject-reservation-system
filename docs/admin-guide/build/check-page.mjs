// Open the admin guide offline (file://) and check it: every image loads, every in-page link has its target, no request
// leaves the file; it prints each part's step count (the score of the counted parts). Forked from the walkthrough's check (.audit/walkthrough-cycle-evidence/drive/check-page.mjs).
// Usage: node check-page.mjs [path/to/index.html] [folder for the review shots]
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(process.argv[2] ?? path.join(here, '..', 'index.html'));
const shotsDir = process.argv[3];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const external = [];
const errors = [];
page.on('request', (r) => { if (!r.url().startsWith('file://')) external.push(r.url()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`file://${file}`, { waitUntil: 'load' });
await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelectorAll('img').forEach((i) => { i.loading = 'eager'; }); });
await page.evaluate(async () => { for (const i of document.querySelectorAll('img')) { i.scrollIntoView(); await new Promise((r) => setTimeout(r, 5)); } });
await page.waitForTimeout(2000);
const res = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('img')];
  const broken = imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src'));
  const anchors = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href').slice(1));
  const missing = [...new Set(anchors.filter((id) => !document.getElementById(id)))];
  const otherLinks = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => !h.startsWith('#'));
  const parts = [...document.querySelectorAll('section.chapter')].map((c) => ({ part: c.dataset.part, steps: c.querySelectorAll('section.step').length, counted: c.classList.contains('counted'), title: c.querySelector('h2').textContent }));
  return { parts, steps: document.querySelectorAll('section.step').length, images: imgs.length, broken, links: anchors.length, missing, otherLinks };
});
const onDisk = fs.readdirSync(path.join(path.dirname(file), 'img')).length;
console.log(JSON.stringify({ file: path.relative(process.cwd(), file), ...res, imageFilesOnDisk: onDisk, externalRequests: external, pageErrors: errors }, null, 1));
if (shotsDir) {
  fs.mkdirSync(shotsDir, { recursive: true });
  for (const [id, name] of [['start', 'page-start'], ['s-a3', 'page-a3'], ['s-c2', 'page-c2'], ['wrong', 'page-end']]) {
    await page.evaluate((x) => document.getElementById(x)?.scrollIntoView(), id);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shotsDir}/${name}.jpg`, type: 'jpeg', quality: 70 });
  }
}
await browser.close();
if (res.broken.length || res.missing.length || external.length || errors.length) process.exit(1);
