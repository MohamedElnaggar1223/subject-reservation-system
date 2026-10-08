// Credentials of the local dev container and its demo accounts are read from the environment (DEV_PASSWORD, DEV_ADMIN_PASSWORD, DEV_PG_ADMIN_URL, DEV_PG_BASE_URL).
// The family (§4.4): the parent reserves for the child — a retake declared with its sitting
// ("to be verified by the school"), a first entry — ticks the two consents, reserves; then the
// checkout by series and the statement.
import { readFileSync } from 'node:fs';
import { browser, signedIn, shot, WEB } from './lib.mjs';

const demo = JSON.parse(readFileSync('/tmp/rwb/demo-B.json', 'utf8'));
const lang = process.argv[2] ?? 'en';
const who = process.argv[3] ?? 'demof1';
const b = await browser();
const page = await signedIn(b, `parent.${who}@igcse.local`, process.env.DEV_PASSWORD, lang);
const counts = { inputs: 0, clicks: 0 };
const answers = [];
await page.goto(`${WEB}/register`);
await page.waitForSelector('#reserve-session', { timeout: 30000 });
if ((await page.locator('#reserve-session').inputValue()) !== demo.sessionId) { await page.selectOption('#reserve-session', demo.sessionId); answers.push('session'); }
await page.getByRole('checkbox', { name: /Biology O\.L\./ }).waitFor({ timeout: 30000 });
await page.getByRole('checkbox', { name: /Biology O\.L\./ }).check(); answers.push('tick Biology');
// Biology's row: the entry select, then the sitting select that a declared retake shows.
const bioRow = page.locator('tr', { has: page.getByRole('checkbox', { name: /Biology O\.L\./ }) });
await bioRow.getByRole('combobox', { name: 'Entry' }).selectOption('retake|self_study'); answers.push('Biology: retake, self-study');
await bioRow.getByRole('combobox', { name: 'The sitting it follows' }).selectOption({ index: 1 }); answers.push('Biology: the sitting');
await page.getByRole('checkbox', { name: /Mathematics O\.L\./ }).check(); answers.push('tick Mathematics');
await page.getByRole('checkbox', { name: /Chemistry O\.L\./ }).check(); answers.push('tick Chemistry');
await page.locator('tr', { has: page.getByRole('checkbox', { name: /Chemistry O\.L\./ }) }).getByRole('combobox', { name: 'Teacher' }).selectOption({ index: 2 }); answers.push('Chemistry: teacher');
const boxes = page.locator('input[type="checkbox"]');
const n = await boxes.count();
// The two consents are the last two checkboxes on the page.
await boxes.nth(n - 2).check(); answers.push('refund policy consent');
await boxes.nth(n - 1).check(); answers.push('declaration consent');
await shot(page, `s11-family-filled-${lang}`);
await page.getByRole('button', { name: /^Reserve|^الحجز/ }).last().click(); counts.clicks++;
console.log(JSON.stringify({ answers: answers.length, clicks: counts.clicks }), answers.join(' | '));
await page.waitForTimeout(2500);
await shot(page, `s11-family-done-${lang}`);

await b.close();
