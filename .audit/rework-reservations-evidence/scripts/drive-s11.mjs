// Credentials of the local dev container and its demo accounts are read from the environment (DEV_PASSWORD, DEV_ADMIN_PASSWORD, DEV_PG_ADMIN_URL, DEV_PG_BASE_URL).
// RESERVATIONS_REWORK.md §11's desk task, measured on the running system: a walk-in family is
// onboarded, the student stays open, three subjects reserved (one a self-study retake the desk
// declares with its sitting, one with a teacher picked), one consent tick, the instrument, and
// "Reserve and collect". Every input and click the officer makes is counted. Placeholder names.
import { readFileSync } from 'node:fs';
import { browser, signedIn, shot, WEB } from './lib.mjs';

const demo = JSON.parse(readFileSync('/tmp/rwb/demo-B.json', 'utf8'));
const tag = process.argv[2] ?? `s11${Date.now() % 100000}`;
const b = await browser();
const page = await signedIn(b, 'officer.mona@igcse.local', process.env.DEV_PASSWORD, 'en');
const steps = [];
const input = (what) => steps.push(['input', what]);
const click = (what) => steps.push(['click', what]);

await page.goto(`${WEB}/desk`);
await page.getByRole('button', { name: '+ New Family (Onboard)' }).click(); click('+ New Family (Onboard)');
await page.fill('input[placeholder="Parent email *"]', `parent.${tag}@igcse.local`); input('parent email');
await page.fill('input[placeholder="Parent name (new account)"]', `Parent ${tag}`); input('parent name');
await page.locator('input[placeholder="Temp password (new account)"]').first().fill(process.env.DEV_PASSWORD); input('parent password');
await page.fill('input[placeholder="Student email *"]', `student.${tag}@igcse.local`); input('student email');
await page.fill('input[placeholder="Student name (new account)"]', `Student ${tag}`); input('student name');
await page.locator('input[placeholder="Temp password (new account)"]').nth(1).fill(process.env.DEV_PASSWORD); input('student password');
await page.locator('select').filter({ has: page.locator('option[value="11"]') }).first().selectOption('11'); input('grade');
await shot(page, 's11-onboard');
await page.getByRole('button', { name: 'Create & Link Family' }).click(); click('Create & Link Family');

// The student stays open with the Reserve page: no second search.
const sessionSelect = page.locator('#desk-session');
await sessionSelect.waitFor({ timeout: 30000 });
if ((await sessionSelect.inputValue()) !== demo.sessionId) { await sessionSelect.selectOption(demo.sessionId); input('session'); }
await page.getByRole('checkbox', { name: /Biology O\.L\./ }).waitFor({ timeout: 30000 });
const row = (name) => page.locator('tr', { has: page.getByRole('checkbox', { name }) });
await page.getByRole('checkbox', { name: /Biology O\.L\./ }).check(); input('tick Biology');
await row(/Biology O\.L\./).getByRole('combobox', { name: 'Entry' }).selectOption('retake|self_study'); input('Biology: retake, self-study');
await row(/Biology O\.L\./).getByRole('combobox', { name: 'The sitting it follows' }).selectOption({ index: 1 }); input('Biology: the sitting');
await page.getByRole('checkbox', { name: /Mathematics O\.L\./ }).check(); input('tick Mathematics');
await page.getByRole('checkbox', { name: /Chemistry O\.L\./ }).check(); input('tick Chemistry');
await row(/Chemistry O\.L\./).getByRole('combobox', { name: 'Teacher' }).selectOption({ index: 2 }); input('Chemistry: teacher');
await page.getByRole('checkbox', { name: /read and signed by the parent/ }).check(); input('consent tick');
await page.locator('select').filter({ has: page.locator('option[value="card"]') }).last().selectOption('card'); input('instrument: card');
await shot(page, 's11-filled');
await page.getByRole('button', { name: /Reserve and collect/ }).click(); click('Reserve and collect');
await page.waitForTimeout(3000);
await shot(page, 's11-done');
const result = await page.locator('text=/Reserved \\d+ line/').first().textContent().catch(() => null);
const inputs = steps.filter((s) => s[0] === 'input').length;
const clicks = steps.filter((s) => s[0] === 'click').length;
console.log(JSON.stringify({ tag, inputs, clicks, result }));
console.log(steps.map((s) => s.join(": ")).join(" | "));
await b.close();
