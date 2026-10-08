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
await page.goto(`${WEB}/register`);
await page.waitForSelector('#reserve-session', { timeout: 30000 });
await page.selectOption('#reserve-session', demo.sessionId); counts.inputs++;
await page.getByRole('checkbox', { name: /Biology O\.L\./ }).waitFor({ timeout: 30000 });
await shot(page, `family-reserve-empty-${lang}`);
await page.getByRole('checkbox', { name: /Biology O\.L\./ }).check(); counts.clicks++;
// Biology's row: the entry select, then the sitting select that a declared retake shows.
const bioRow = page.locator('tr', { has: page.getByRole('checkbox', { name: /Biology O\.L\./ }) });
await bioRow.getByRole('combobox', { name: 'Entry' }).selectOption('retake|self_study'); counts.inputs++;
await bioRow.getByRole('combobox', { name: 'The sitting it follows' }).selectOption({ index: 1 }); counts.inputs++;
await page.getByRole('checkbox', { name: /Mathematics O\.L\./ }).check(); counts.clicks++;
const boxes = page.locator('input[type="checkbox"]');
const n = await boxes.count();
// The two consents are the last two checkboxes on the page.
await boxes.nth(n - 2).check(); counts.clicks++;
await boxes.nth(n - 1).check(); counts.clicks++;
await shot(page, `family-reserve-filled-${lang}`);
await page.getByRole('button', { name: /^Reserve|^الحجز/ }).last().click(); counts.clicks++;
await page.waitForTimeout(2500);
await shot(page, `family-reserve-done-${lang}`);
console.log('family counts (from the page):', JSON.stringify(counts));
const pay = page.getByRole('link', { name: /Pay now|ادفع الآن/ });
if (await pay.count()) {
  await pay.click();
  await page.waitForTimeout(3000);
  await shot(page, `family-checkout-${lang}`);
}
await page.goto(`${WEB}/statement`);
await page.waitForTimeout(3000);
await shot(page, `family-statement-${lang}`);
await b.close();
