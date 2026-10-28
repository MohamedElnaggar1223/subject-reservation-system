// Contact sheets of the generated guide (review only): the page opened from disk at 1440x900, each part's run of
// viewports tiled 3 across; then the page printed to PDF (print.pdf), to check the printed guide.
// Usage: node page-contact.mjs <index.html> <out folder>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [file, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`file://${file}`, { waitUntil: 'load' });
await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelectorAll('img').forEach((i) => { i.loading = 'eager'; }); });
await page.waitForTimeout(1500);
const parts = await page.evaluate(() => [...document.querySelectorAll('section.chapter')].map((c) => c.id));
const bounds = [null, ...parts, null];
for (let k = 0; k < bounds.length - 1; k++) {
  const [from, to] = [bounds[k], bounds[k + 1]];
  const name = from ?? 'header';
  const y0 = from ? await page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top + window.scrollY, from) : 0;
  const y1 = to ? await page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top + window.scrollY, to) : await page.evaluate(() => document.body.scrollHeight);
  const n = Math.max(1, Math.min(30, Math.ceil((y1 - y0) / 900)));
  const tiles = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), y0 + i * ((y1 - y0) / n));
    await page.waitForTimeout(200);
    tiles.push((await page.screenshot({ type: 'jpeg', quality: 45 })).toString('base64'));
  }
  const p2 = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await p2.setContent(`<html><body style="margin:0;background:#888;display:grid;grid-template-columns:repeat(3,1fr);gap:6px">${tiles.map((t) => `<img style="width:100%" src="data:image/jpeg;base64,${t}">`).join('')}</body></html>`);
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: `${outDir}/contact-${name}.jpg`, type: 'jpeg', quality: 55, fullPage: true });
  await p2.close();
  console.log(`contact-${name}.jpg: ${n} viewports`);
}
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: `${outDir}/print.pdf`, format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
console.log('print.pdf', Math.round(fs.statSync(`${outDir}/print.pdf`).size / 1024), 'KB');
await browser.close();
