// The Fees tab's list of lines still provisional on confirmed fees, and "Confirm their fees again"
// (the review of 40c1447..af33662, item 5), in English and Arabic.
import { chromium } from 'playwright-core';
const WEB = 'http://localhost:3120';
const OUT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-sessions/.audit/rework-sessions-evidence/screens';
const id = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function signIn(lang) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript((l) => { window.localStorage.setItem('language', l); }, lang);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${lang}: ${e.message.slice(0, 160)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${lang} console: ${m.text().slice(0, 160)}`); });
  await page.goto(`${WEB}/sign-in`);
  await page.fill('#email', 'admin@igcse.local');
  await page.fill('input[type=password]', 'AdminPass1');
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/sign-in')), page.click('button[type=submit]')]);
  return page;
}
const ar = await signIn('ar');
await ar.goto(`${WEB}/admin/sessions/${id}#fees`);
await ar.waitForSelector('table');
await ar.waitForSelector('[role=status] button');
await ar.waitForTimeout(1500);
await ar.screenshot({ path: `${OUT}/61-fees-stuck-ar.png`, fullPage: true });
const en = await signIn('en');
await en.goto(`${WEB}/admin/sessions/${id}#fees`);
await en.waitForSelector('text=Lines still provisional on confirmed fees');
const notice = en.locator('[role=status]', { hasText: 'Lines still provisional on confirmed fees' });
console.log('notice', (await notice.innerText()).replace(/\s+/g, ' ').slice(0, 300));
await en.screenshot({ path: `${OUT}/60-fees-stuck-en.png`, fullPage: true });
await notice.locator('button:has-text("Confirm their fees again")').click();
await en.waitForSelector('text=Lines still provisional on confirmed fees', { state: 'detached', timeout: 15000 });
await en.waitForTimeout(800);
await en.screenshot({ path: `${OUT}/62-fees-after-confirm-again-en.png`, fullPage: true });
console.log('after: notice gone');
console.log('errors', errors);
await browser.close();
