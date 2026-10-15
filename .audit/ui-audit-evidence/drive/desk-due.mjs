// F6 review fix 7: which of a plan's instalments the desk ticks as already due, read in the school's day.
// Family A's plan: instalment 2 falls due 17 Nov 2026 04:41 UTC (06:41 Cairo). The browser's clock is set
// to 16 Nov 2026 23:00 UTC — already 17 Nov 01:00 in Cairo — so instalment 2 is due today at the school.
// node desk-due.mjs <label>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const label = process.argv[2] ?? 'run';
const WEB = process.env.WEB ?? 'http://localhost:3070';
const A1 = 'LWt5OX5OJu635vIH3zP8N85lyLOBRaKP';
const AT = '2026-11-16T23:00:00Z';
const OUT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/.audit/ui-audit-evidence/review-fixes/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.addCookies([{ name: 'language', value: 'en', url: WEB }]);
const page = await ctx.newPage();
await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
await page.fill('#email', 'officer.mona@igcse.local');
await page.fill('#password', 'TestPass1');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in')), page.locator('form button[type=submit]').click()]);
await page.clock.setFixedTime(new Date(AT));
await page.goto(`${WEB}/desk?student=${A1}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const browserNow = await page.evaluate(() => new Date().toISOString());
const boxes = await page.locator('main label:has(input[type=checkbox])').evaluateAll((ls) => ls
  .map((l) => ({ text: l.innerText.replace(/\s+/g, ' ').trim().slice(0, 90), ticked: l.querySelector('input').checked }))
  .filter((x) => /instalment/i.test(x.text)));
const collect = (await page.getByRole('button', { name: /^Collect/ }).first().innerText().catch(() => null));
const result = { label, browserNowUtc: browserNow, cairo: new Date(AT).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' }), instalments: boxes, collectButton: collect };
console.log(JSON.stringify(result, null, 1));
fs.writeFileSync(`${OUT}desk-due-${label}.json`, JSON.stringify(result, null, 1));
await browser.close();
