// The review of dd68598, item 4, on the screen: the desk's two transfer dialogs in Arabic, driven as the finance
// admin on student B1 (a placeholder) in this worktree's dev database. B1's InstaPay payment awaiting verification
// is rejected first (the Finance Workbench's call), so the desk offers "Transfer found" on it; the drive records the
// transfer found later, then undoes it, reading each dialog and each sentence the desk writes.
// Usage: node desk-transfer.mjs <paymentId>. Writes <EVIDENCE>/desk-transfer-ar/.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { signIn } from './api.mjs';

const WEB = 'http://localhost:3180';
const EVIDENCE = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/cycle-decisions/.audit/cycle-decisions-evidence/desk-transfer-ar';
const S = JSON.parse(fs.readFileSync(new URL('./state.json', import.meta.url), 'utf8'));
const [paymentId] = process.argv.slice(2);
fs.mkdirSync(EVIDENCE, { recursive: true });
const result = { paymentId, steps: [] };
const step = (what, data) => { result.steps.push({ at: new Date().toISOString(), what, ...data }); };

const fin = await signIn('finadmin.rana@igcse.local');
const rej = await fin('POST', `/v1/payments/${paymentId}/reject`, { reason: 'Not on the statement yet (desk transfer drive)' }, { raw: true });
step('reject (API, as the workbench does)', { status: rej.status, body: JSON.stringify(rej.json).slice(0, 200) });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
await ctx.addCookies([{ name: 'language', value: 'ar', url: WEB }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
await page.fill('input[type=email]', 'finadmin.rana@igcse.local');
await page.fill('input[type=password]', 'TestPass1');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 30000 }), page.locator('button[type=submit]').click()]);
await page.goto(`${WEB}/desk?student=${S.b1}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const dialogText = async () => (await page.locator('[role=dialog]').last().innerText()).split('\n').filter(Boolean);
const deskSays = async (needle) => (await page.locator('body').innerText()).split('\n').filter((l) => l.includes(needle));

await page.getByRole('button', { name: 'وُجد التحويل', exact: true }).first().click();
await page.waitForSelector('#reason-modal-field-0');
await page.waitForTimeout(800);
step('the "Transfer found" dialog', { dialog: await dialogText(), placeholders: await page.locator('[role=dialog] input, [role=dialog] textarea').evaluateAll((es) => es.map((e) => e.getAttribute('placeholder'))) });
await page.screenshot({ path: path.join(EVIDENCE, '1-record-dialog.jpg'), type: 'jpeg', quality: 60 });
await page.fill('#reason-modal-field-0', 'FT-PLACEHOLDER-0001');
await page.fill('#reason-modal-field-1', '8800');
await page.fill('#reason-modal-input', 'On the bank statement of 16 Oct (desk transfer drive)');
await page.getByRole('button', { name: 'إضافة إلى الرصيد', exact: true }).click();
await page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 15000 });
await page.waitForTimeout(2500);
step('recorded', { says: await deskSays('التحويل'), englishLeft: await deskSays('balance') });
await page.screenshot({ path: path.join(EVIDENCE, '2-recorded.jpg'), type: 'jpeg', quality: 60 });

await page.getByRole('button', { name: 'تراجع', exact: true }).first().click();
await page.waitForSelector('#reason-modal-input');
await page.waitForTimeout(800);
step('the "Undo" dialog', { dialog: await dialogText(), placeholders: await page.locator('[role=dialog] textarea').evaluateAll((es) => es.map((e) => e.getAttribute('placeholder'))) });
await page.screenshot({ path: path.join(EVIDENCE, '3-undo-dialog.jpg'), type: 'jpeg', quality: 60 });
await page.fill('#reason-modal-input', 'Recorded against the wrong payment (desk transfer drive)');
await page.getByRole('button', { name: 'التراجع عن التحويل', exact: true }).click();
await page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 15000 });
await page.waitForTimeout(2500);
step('undone', { says: await deskSays('التحويل'), englishLeft: await deskSays('balance') });
await page.screenshot({ path: path.join(EVIDENCE, '4-undone.jpg'), type: 'jpeg', quality: 60 });
result.errors = errors;
fs.writeFileSync(path.join(EVIDENCE, 'readings.json'), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1).slice(0, 6000));
await browser.close();
