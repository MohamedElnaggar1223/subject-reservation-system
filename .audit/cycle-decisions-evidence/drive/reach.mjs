// Decisions 5, 8 and 13: the screens the switch's lists now hide (Subjects, Payments) still open by their URL for
// the admin, and Candidates (now in the sidebar) opens for the admin and the coordinator. Writes
// <EVIDENCE>/after/reachable.json.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const WEB = 'http://localhost:3180';
const OUT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/cycle-decisions/.audit/cycle-decisions-evidence/after/reachable.json';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const result = [];
for (const [email, password, paths] of [
  ['admin@igcse.local', 'AdminPass1', ['/admin/subjects', '/admin/payments', '/exams/candidates']],
  ['coordinator.ui@igcse.local', 'TestPass1', ['/exams/candidates']],
]) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addCookies([{ name: 'language', value: 'en', url: WEB }]);
  const page = await ctx.newPage();
  await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 30000 }), page.locator('button[type=submit]').click()]);
  for (const p of paths) {
    const res = await page.goto(WEB + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const h1 = await page.locator('main h1').first().textContent().catch(() => null);
    const inSidebar = await page.locator(`aside a[href="${p}"]`).count();
    result.push({ who: email, path: p, status: res?.status(), finalPath: new URL(page.url()).pathname, heading: h1?.trim() ?? null, inSidebar: inSidebar > 0 });
  }
  await ctx.close();
}
fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result));
await browser.close();
