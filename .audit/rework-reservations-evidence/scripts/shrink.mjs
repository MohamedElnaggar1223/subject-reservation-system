// Re-encode a screenshot smaller (same name, PNG): drawn at a narrower width in headless Chrome,
// in 8-bit colour, until it is under the limit. shrink.mjs <file> [maxBytes]
import { chromium } from 'playwright-core';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
const [file, maxArg] = process.argv.slice(2);
const max = Number(maxArg ?? 290_000);
const data = readFileSync(file);
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage();
const dims = await p.evaluate(async (src) => {
  const img = new Image(); img.src = src; await img.decode();
  return { w: img.naturalWidth, h: img.naturalHeight };
}, `data:image/png;base64,${data.toString('base64')}`);
let width = dims.w;
let out = data;
while (out.length > max && width > 700) {
  width = Math.round(width * 0.85);
  const height = Math.round((dims.h * width) / dims.w);
  // Posterize lightly (fewer colours compress far better); text stays readable.
  const b64 = await p.evaluate(async ({ src, width, height }) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, width, height);
    const d = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < d.data.length; i += 4) { for (let k = 0; k < 3; k++) d.data[i + k] = Math.round(d.data[i + k] / 8) * 8; d.data[i + 3] = 255; }
    ctx.putImageData(d, 0, 0);
    return c.toDataURL('image/png').split(',')[1];
  }, { src: `data:image/png;base64,${data.toString('base64')}`, width, height });
  out = Buffer.from(b64, 'base64');
}
writeFileSync(file, out);
console.log(file.split('/').pop(), dims.w + 'px', data.length, '->', width + 'px', statSync(file).size);
await b.close();
