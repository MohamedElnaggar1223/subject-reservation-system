// Contact sheets of the generated guide (review only): the page opened from disk at 1440x900, a run of viewports
// from a starting anchor tiled 3 across. Also checks the Copy button and prints the page to PDF.
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
for (const [name, from, to] of [['start', null, 'subjects'], ['the-25-forms', 'sheet', 'fees'], ['end', 'preview', null]]) {
  const y0 = from ? await page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top + window.scrollY, from) : 0;
  const y1 = to ? await page.evaluate((id) => document.getElementById(id).getBoundingClientRect().top + window.scrollY, to) : await page.evaluate(() => document.body.scrollHeight);
  const n = Math.min(name === 'the-25-forms' ? 24 : 15, Math.ceil((y1 - y0) / 900));
  const step = (y1 - y0) / n;
  const tiles = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), y0 + i * step);
    await page.waitForTimeout(250);
    tiles.push((await page.screenshot({ type: 'jpeg', quality: 45 })).toString('base64'));
  }
  const html = `<html><body style="margin:0;background:#888;display:grid;grid-template-columns:repeat(${name === "the-25-forms" ? 4 : 3},1fr);gap:6px">${tiles.map((t) => `<img style="width:100%" src="data:image/jpeg;base64,${t}">`).join('')}</body></html>`;
  const p2 = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await p2.setContent(html);
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: `${outDir}/contact-${name}.jpg`, type: 'jpeg', quality: 55, fullPage: true });
  await p2.close();
  console.log(`contact-${name}.jpg: ${n} viewports from ${Math.round(y0)} to ${Math.round(y1)}`);
}
// The Copy button (file:// is not a secure context: the fallback copies) says "Copied".
await page.evaluate(() => window.scrollTo(0, 0));
const btn = page.locator('.paste button').first();
await btn.scrollIntoViewIfNeeded();
await btn.click();
console.log('copy button after click:', await btn.innerText());
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: `${outDir}/print.pdf`, format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
console.log('print.pdf', Math.round(fs.statSync(`${outDir}/print.pdf`).size / 1024), 'KB');
await browser.close();
