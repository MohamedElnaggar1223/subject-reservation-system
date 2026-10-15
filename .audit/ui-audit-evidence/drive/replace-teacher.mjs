// F6 review fix 2: Replace a teacher on the subject's form, as the admin at a desk, then Save; what the form
// ticks after the replacement and what the sheet holds after the Save.
// node replace-teacher.mjs <label> "<subject>" "<who leaves>" "<who takes over>"
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { signIn } from './api.mjs';
const [label, subject, fromName, toName] = process.argv.slice(2);
const WEB = process.env.WEB ?? 'http://localhost:3070';
const JUNE = '6d34f4aa-11fc-45a8-b04b-55e04a25b3a9';
const OUT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/.audit/ui-audit-evidence/review-fixes/';
fs.mkdirSync(OUT, { recursive: true });
const NOTE = `Typed before the replacement (${label})`;

const api = await signIn('admin@igcse.local', 'AdminPass1');
const sheet = async () => (await api('GET', `/v1/sessions/${JUNE}/offers`)).offers.find((o) => o.subject.name === subject);
const before = await sheet();

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.addCookies([{ name: 'language', value: 'en', url: WEB }]);
const page = await ctx.newPage();
await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
await page.fill('#email', 'admin@igcse.local');
await page.fill('#password', 'AdminPass1');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in')), page.locator('form button[type=submit]').click()]);
await page.goto(`${WEB}/admin/sessions/${JUNE}#subjects`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: subject, exact: true }).first().click();
const notes = page.locator('#sf-notes');
await notes.waitFor();
await notes.fill(NOTE);
await page.getByRole('button', { name: 'Replace teacher' }).click();
await page.locator('#rt-from').selectOption({ label: fromName });
await page.locator('#rt-to').selectOption({ label: toName });
await page.locator('#rt-why').fill(`${fromName} leaves (F6 review check)`);
await page.getByRole('button', { name: 'Replace', exact: true }).click();
await page.locator('#rt-from').waitFor({ state: 'detached', timeout: 20000 });
await page.waitForTimeout(1500);

// The form as made again: each teacher in its picker, ticked or not; the note typed before.
const picker = page.locator('form section').first();
const ticks = await picker.evaluate((sec) => [...sec.querySelectorAll('label')].filter((l) => l.querySelector('bdi'))
  .map((l) => ({ name: l.querySelector('bdi').textContent, ticked: l.querySelector('input[type=checkbox]').checked })));
const noteAfter = await notes.inputValue();
await picker.scrollIntoViewIfNeeded();
await picker.screenshot({ path: `${OUT}replace-teacher-${label}.jpg`, type: 'jpeg', quality: 70 });
const afterReplace = await sheet();

await page.locator('form button[type=submit]').click();
await page.getByText(/^(Saved\.|Nothing to change\.)$/).first().waitFor({ timeout: 20000 });
await page.waitForTimeout(800);
const afterSave = await sheet();

const names = (o) => o.teachers.map((t) => t.name).sort();
const result = {
  label, subject, replaced: `${fromName} -> ${toName}`,
  sheetBefore: names(before),
  sheetAfterReplace: names(afterReplace),
  formTicksAfterReplace: ticks.filter((t) => t.ticked).map((t) => t.name).sort(),
  formNoteKept: noteAfter === NOTE,
  sheetAfterSave: names(afterSave),
  noteSaved: afterSave.notes,
  departedBack: names(afterSave).includes(fromName),
};
console.log(JSON.stringify(result, null, 1));
fs.writeFileSync(`${OUT}replace-teacher-${label}.json`, JSON.stringify(result, null, 1));
await browser.close();
