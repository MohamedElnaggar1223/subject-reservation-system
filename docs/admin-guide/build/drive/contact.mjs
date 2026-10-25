// Contact sheets of a folder of JPEGs (review only): PER per sheet, each with its name.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const dir = process.env.DIR ?? '/tmp/ag/shots';
const outDir = process.env.OUT ?? '/tmp/ag/contact';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).filter((f) => !process.env.MATCH || new RegExp(process.env.MATCH).test(f)).sort();
const per = Number(process.env.PER ?? 9);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
fs.mkdirSync(outDir, { recursive: true });
for (let i = 0; i < files.length; i += per) {
  const html = `<html><body style="margin:0;font:13px sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:4px">${files.slice(i, i + per).map((f) => `<div><div>${f}</div><img src="file://${dir}/${f}" style="width:596px;max-height:520px;object-fit:contain;object-position:top;border:1px solid #999"></div>`).join('')}</body></html>`;
  fs.writeFileSync(`${outDir}/page.html`, html);
  await page.goto(`file://${outDir}/page.html`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outDir}/c${String(i / per).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 70, fullPage: true });
}
console.log('sheets', Math.ceil(files.length / per), 'files', files.length);
await browser.close();
