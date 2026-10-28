import { chromium } from 'playwright-core';
import fs from 'node:fs';
const dir = process.argv[2] ?? "/tmp/ag/page"; // the folder page-contact.mjs wrote print.pdf to, after pdftoppm -jpeg -r 40 print.pdf pp
const files = fs.readdirSync(dir).filter((f) => /^pp-\d+\.jpg$/.test(f)).sort();
const pick = [0, 1, 2, 3, 6, 7, 10, 11, 15, 16, 20, 21, 25, 26, 30, 31, files.length - 2, files.length - 1].filter((i) => i < files.length);
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
await p.setContent(`<body style="margin:0;background:#777;display:grid;grid-template-columns:repeat(6,1fr);gap:6px">${pick.map((i) => `<div style="color:#fff;font:12px sans-serif">${files[i]}<img style="width:100%;display:block" src="data:image/jpeg;base64,${fs.readFileSync(`${dir}/${files[i]}`).toString('base64')}"></div>`).join('')}</body>`);
await p.waitForTimeout(500);
await p.screenshot({ path: `${dir}/print-pages.jpg`, type: 'jpeg', quality: 60, fullPage: true });
await b.close();
