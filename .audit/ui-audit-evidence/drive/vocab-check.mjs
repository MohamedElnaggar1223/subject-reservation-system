// F6 review fix 5: the family home's list of other pages is named in Arabic for a screen reader; the
// workbench's sentence for a payment past its session's close reads "Session closed" with its Arabic.
// (No payment in dev waits on a reference after its session closed, so the second is read from the
// dictionary the page translator uses, exactly as the screen's text node would be looked up.)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const WEB = process.env.WEB ?? 'http://localhost:3070';
const OUT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/.audit/ui-audit-evidence/review-fixes/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const out = {};
for (const lang of ['en', 'ar']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await ctx.addCookies([{ name: 'language', value: lang, url: WEB }]);
  const page = await ctx.newPage();
  await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('#email', 'parent.b@igcse.local');
  await page.fill('#password', 'TestPass1');
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in')), page.locator('form button[type=submit]').click()]);
  await page.goto(`${WEB}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  out[`homeNavName_${lang}`] = await page.locator('main nav[aria-label]').last().getAttribute('aria-label');
  await ctx.close();
}
await browser.close();
const dict = fs.readFileSync('/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/apps/web/lib/i18n-ui-audit.ts', 'utf8');
const m = /'Session closed — the family has until': '([^']+)'/.exec(dict);
out.workbenchSentenceArabic = m ? m[1] : null;
out.windowWordLeft = /Window closed/.test(fs.readFileSync('/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/apps/web/app/(app)/finance/finance.client.tsx', 'utf8'));
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`${OUT}vocabulary.json`, JSON.stringify(out, null, 1));
