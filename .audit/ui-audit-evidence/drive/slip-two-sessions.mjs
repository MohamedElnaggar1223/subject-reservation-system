// F6 review fix 3: a student with live reservations in two sessions; the slip opened without ids must print
// the latest session's. The template's student with a live line in November 2026 – January 2027 (closed)
// gets one in June 2027 at the desk (reserve only), then the slip is read in the browser.
// node slip-two-sessions.mjs <label> [--reserve]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { signIn } from './api.mjs';
const [label, reserve] = process.argv.slice(2);
const WEB = process.env.WEB ?? 'http://localhost:3070';
const JUNE = '6d34f4aa-11fc-45a8-b04b-55e04a25b3a9';
const STUDENT = '22PnmE9vLmtEDZ72Op9T2ZfRhEyotiLs';
const OUT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/.audit/ui-audit-evidence/review-fixes/';
const LIVE = ['pending_approval', 'pending_payment', 'preregistered', 'confirmed'];

const admin = await signIn('admin@igcse.local', 'AdminPass1');
if (reserve === '--reserve') {
  const officer = await signIn('officer.mona@igcse.local', 'TestPass1');
  // The school fee gates reserving: collected first at the desk (cash), as setup-5 did for family B.
  await officer('POST', '/v1/registrations/desk/collect', { studentId: STUDENT, registrationIds: [], chargeIds: [], schoolFeeYear: '2026-2027', instrumentUsed: 'cash', escrowAmountToApply: 0 });
  const { offers } = await admin('GET', `/v1/sessions/${JUNE}/offers`);
  const physics = offers.find((o) => o.subject.code === '0625');
  const whole = physics.items.find((i) => i.kind === 'whole');
  const r = await officer('POST', '/v1/registrations/desk', {
    studentId: STUDENT, sessionId: JUNE, consent: { refundPolicy: true, declaration: true },
    lines: [{ offerItemId: whole.id, attempt: 'first', mode: 'in_school' }],
  });
  console.log('reserved at the desk:', JSON.stringify(r).slice(0, 200));
}
const st = await admin('GET', `/v1/statement?studentId=${STUDENT}`);
const sessions = st.students[0].sessions.map((s) => ({ name: s.name, live: s.lines.filter((l) => LIVE.includes(l.status)).length }));
console.log('statement order (as the API returns it):', JSON.stringify(sessions));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 1200 } });
await ctx.addCookies([{ name: 'language', value: 'en', url: WEB }]);
const page = await ctx.newPage();
await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed ?? 0) + 1; }; });
await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
await page.fill('#email', 'admin@igcse.local');
await page.fill('#password', 'AdminPass1');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in')), page.locator('form button[type=submit]').click()]);
await page.goto(`${WEB}/reservation-slip/${STUDENT}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const text = await page.locator('body').innerText();
const printedSession = text.includes('November 2026 – January 2027') ? 'November 2026 – January 2027 (closed)' : text.includes('June 2027') ? 'June 2027' : null;
const result = { label, statementOrder: sessions, slipPrints: printedSession, printDialogOpened: await page.evaluate(() => window.__printed ?? 0) };
console.log(JSON.stringify(result));
fs.writeFileSync(`${OUT}slip-two-sessions-${label}.json`, JSON.stringify(result, null, 1));
await browser.close();
