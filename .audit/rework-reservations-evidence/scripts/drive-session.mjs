// Credentials of the local dev container and its demo accounts are read from the environment (DEV_PASSWORD, DEV_ADMIN_PASSWORD, DEV_PG_ADMIN_URL, DEV_PG_BASE_URL).
// The Session screen's To verify tab (coordinator) and Money tab (finance), §4.2, §4.6.
import { readFileSync } from 'node:fs';
import { browser, signedIn, shot, WEB } from './lib.mjs';

const demo = JSON.parse(readFileSync('/tmp/rwb/demo-B.json', 'utf8'));
const lang = process.argv[2] ?? 'en';
const act = process.argv[3] !== 'look';
const API = 'http://localhost:3111';
const ORIGIN = 'http://localhost:3110';

// A coordinator account (placeholder) made by the admin, once.
const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email: 'admin@igcse.local', password: process.env.DEV_ADMIN_PASSWORD }) });
const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
await fetch(`${API}/v1/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
  body: JSON.stringify({ name: 'Coordinator Demo', email: 'coordinator.demo@igcse.local', password: process.env.DEV_PASSWORD, role: 'coordinator' }) });

const b = await browser();
const page = await signedIn(b, 'coordinator.demo@igcse.local', process.env.DEV_PASSWORD, lang);
await page.goto(`${WEB}/admin/sessions/${demo.sessionId}#verify`);
await page.waitForTimeout(3000);
await shot(page, `session-to-verify-${lang}`);
if (act) {
  // Verify the carry-forward (another centre: its number recorded), reject the unpaid retake.
  const cfRow = page.locator('tr', { hasText: 'Physics A.S./A.L.' }).first();
  await cfRow.getByRole('button', { name: /^Verify$|^تحقق$/ }).click();
  await page.fill('#prev-centre', 'EG-CENTRE-9');
  await page.fill('#prev-candidate', '0099');
  await page.fill('#answer-reason', 'The statement of results the family brought');
  await shot(page, `session-verify-modal-${lang}`);
  await page.getByRole('dialog').getByRole('button', { name: /^Verify$|^تحقق$/ }).click();
  await page.waitForTimeout(1500);
  const bioRow = page.locator('tr', { hasText: 'Biology O.L.' }).first();
  await bioRow.getByRole('button', { name: /Not confirmed|لم تُؤكَّد/ }).click();
  await page.fill('#answer-reason', 'No such result on the board record');
  await shot(page, `session-reject-modal-${lang}`);
  await page.getByRole('dialog').getByRole('button', { name: /Not confirmed|لم تُؤكَّد/ }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /^Answered$|^تمت الإجابة$/ }).click();
  await page.waitForTimeout(1500);
  await shot(page, `session-answered-${lang}`);
}
await b.close();

const b2 = await browser();
const fin = await signedIn(b2, 'officer.mona@igcse.local', process.env.DEV_PASSWORD, lang);
await fin.goto(`${WEB}/admin/sessions/${demo.sessionId}#money`);
await fin.waitForTimeout(3000);
await shot(fin, `session-money-${lang}`);
await fin.goto(`${WEB}/admin/sessions/${demo.sessionId}#verify`);
await fin.waitForTimeout(2500);
await shot(fin, `session-to-verify-finance-${lang}`);
await b2.close();
