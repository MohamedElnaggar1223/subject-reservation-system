// Crop a region of a screenshot: crop.mjs <in> <out> <x> <y> <w> <h>
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const [inp, out, x, y, w, h] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: Number(w), height: Number(h) } });
const data = readFileSync(inp).toString('base64');
await p.setContent(`<body style="margin:0;overflow:hidden"><img src="data:image/png;base64,${data}" style="position:absolute;left:-${x}px;top:-${y}px"></body>`);
await p.screenshot({ path: out });
await b.close();
