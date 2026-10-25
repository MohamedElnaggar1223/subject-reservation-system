// The Copy buttons of the guide, opened from disk in Chrome: each button is clicked as a person would, the text the
// browser's copy event carries is read, and compared with the block it sits on. Usage: node copy-check.mjs <index.html>
import { chromium } from 'playwright-core';
const file = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`file://${file}`, { waitUntil: 'load' });
await page.evaluate(() => {
  window.__copied = [];
  document.addEventListener('copy', () => {
    const a = document.activeElement;
    window.__copied.push(a && 'value' in a ? a.value.substring(a.selectionStart, a.selectionEnd) : String(window.getSelection()));
  });
});
const buttons = page.locator('.paste button');
const n = await buttons.count();
const results = [];
for (let i = 0; i < n; i++) {
  const b = buttons.nth(i);
  await b.scrollIntoViewIfNeeded();
  await b.click();
  const label = await b.innerText();
  const [block, copied] = await page.evaluate((k) => [document.querySelectorAll('.paste pre')[k].textContent, window.__copied[window.__copied.length - 1] ?? null], i);
  const step = await b.evaluate((el) => el.closest('section.step')?.querySelector('h3 .n')?.textContent);
  results.push({ step, lines: block.split('\n').length, buttonAfterClick: label, copiedEqualsBlock: copied === block });
}
console.log(JSON.stringify({ file, copyButtons: n, results }, null, 1));
await browser.close();
if (results.some((r) => !r.copiedEqualsBlock || r.buttonAfterClick !== 'Copied')) process.exit(1);
