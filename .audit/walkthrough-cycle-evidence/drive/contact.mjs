// Contact sheets of the shots for review (not for the artifact): N per page, each with its name.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const dir = process.env.DIR ?? '/tmp/f8-pw/shots';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).filter((f) => !process.env.MATCH || f.includes(process.env.MATCH)).sort();
const per = Number(process.env.PER ?? 6);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
fs.mkdirSync('/tmp/f8-pw/contact', { recursive: true });
for (let i = 0; i < files.length; i += per) {
  const html = `<html><body style="margin:0;font:12px sans-serif;display:grid;grid-template-columns:repeat(3,1fr);gap:4px">${files.slice(i, i + per).map((f) => `<div><div>${f}</div><img src="file://${dir}/${f}" style="width:596px;max-height:470px;object-fit:contain;object-position:top;border:1px solid #999"></div>`).join('')}</body></html>`;
  fs.writeFileSync('/tmp/f8-pw/contact/page.html', html);
  await page.goto('file:///tmp/f8-pw/contact/page.html');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/f8-pw/contact/c${String(i / per).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 70, fullPage: true });
}
console.log('pages', Math.ceil(files.length / per));
await browser.close();
