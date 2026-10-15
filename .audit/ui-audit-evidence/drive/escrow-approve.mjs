// F6 review fix 4: Approve on the admin's Escrow screen, clicked — a partial hand-over (the officer releases
// EGP 4,000 of C2's EGP 10,000 request first, through the API as the desk would) and a request already
// fulfilled (the template's). Each with the state the API reports before and after. A money step on dev data.
// node escrow-approve.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { signIn } from './api.mjs';
const WEB = process.env.WEB ?? 'http://localhost:3070';
const OUT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/.audit/ui-audit-evidence/review-fixes/';
const admin = await signIn('admin@igcse.local', 'AdminPass1');
const officer = await signIn('officer.mona@igcse.local', 'TestPass1');
const list = async () => admin('GET', '/v1/escrow/admin/withdrawals');
const brief = (r) => r ? { status: r.status, requested: r.requestedAmount, released: r.releasedAmount ?? 0, approved: !!r.approvedBy, walletBalance: r.escrow.balance } : 'not in the queue';

let reqs = await list();
const partial = reqs.find((r) => r.escrow.student.name === 'Student Placeholder C2');
const full = reqs.find((r) => r.status === 'fulfilled' && !r.approvedBy);
const log = { partial: { id: partial.id }, full: full ? { id: full.id } : null };
if (partial.status === 'pending') {
  await officer('POST', `/v1/escrow/admin/withdrawals/${partial.id}/fulfill`, { releasedAmount: 4000, notes: 'Part handed over at the desk (F6 review drive)' });
}
reqs = await list();
log.partial.beforeApprove = brief(reqs.find((r) => r.id === partial.id));
if (full) log.full.beforeApprove = brief(full);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const lang of ['ar', 'en']) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addCookies([{ name: 'language', value: lang, url: WEB }]);
  const page = await ctx.newPage();
  await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('#email', 'admin@igcse.local');
  await page.fill('#password', 'AdminPass1');
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in')), page.locator('form button[type=submit]').click()]);
  await page.goto(`${WEB}/admin/escrow`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const card = page.locator('main div.rounded-xl.border', { hasText: 'Student Placeholder C2' }).first();
  await card.screenshot({ path: `${OUT}escrow-partial-before-approve-${lang}.jpg`, type: 'jpeg', quality: 70 });
  log.partial[`buttons_${lang}`] = await card.getByRole('button').allInnerTexts();
  if (lang === 'en') {
    // Click Approve on the partial hand-over, then on the fulfilled one.
    await card.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('status').filter({ hasText: 'Approved' }).waitFor({ timeout: 15000 });
    log.partial.screenSaid = await page.getByRole('status').filter({ hasText: 'Approved' }).innerText();
    await page.waitForTimeout(1200);
    await card.screenshot({ path: `${OUT}escrow-partial-after-approve-en.jpg`, type: 'jpeg', quality: 70 });
    log.partial.buttonsAfter = await card.getByRole('button').allInnerTexts();
    if (full) {
      const fullCard = page.locator('main div.rounded-xl.border').filter({ has: page.getByText('Cash released — approval pending') }).first();
      await fullCard.getByRole('button', { name: 'Approve' }).click();
      await page.waitForTimeout(2000);
      log.full.screenSaid = await page.locator('main [role=status], main [role=alert]').first().innerText().catch(() => null);
    }
  }
  await ctx.close();
}
await browser.close();
reqs = await list();
log.partial.afterApprove = brief(reqs.find((r) => r.id === partial.id));
if (full) log.full.afterApprove = brief(reqs.find((r) => r.id === full.id));
console.log(JSON.stringify(log, null, 1));
fs.writeFileSync(`${OUT}escrow-approve.json`, JSON.stringify(log, null, 1));
