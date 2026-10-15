// What the desk's "To collect now" ticks for a student, and its button's amount: node check-collect.mjs
import { chromium } from 'playwright-core';
import { ACCOUNTS, IDS } from './screens.mjs';
const WEB = 'http://localhost:3070';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
await page.fill('input[type=email]', ACCOUNTS.finance_officer.email);
await page.fill('input[type=password]', ACCOUNTS.finance_officer.password);
await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in')), page.locator('button[type=submit]').click()]);
await page.goto(`${WEB}/desk?student=${IDS.a1}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const rows = await page.locator('section[aria-labelledby=desk-owed] li').evaluateAll((lis) => lis.map((li) => `${li.querySelector('input')?.checked ? '[x]' : '[ ]'} ${li.innerText.replace(/\s+/g, ' ')}`));
console.log(rows.join('\n'));
console.log(await page.locator('section[aria-labelledby=desk-owed] button', { hasText: 'Collect' }).first().innerText());
await browser.close();
