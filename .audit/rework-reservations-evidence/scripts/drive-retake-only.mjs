// Credentials of the local dev container and its demo accounts are read from the environment (DEV_PASSWORD, DEV_ADMIN_PASSWORD, DEV_PG_ADMIN_URL, DEV_PG_BASE_URL).
// An item whose entry deadline has passed and whose retake deadline is ahead (§2.12: open per
// attempt): the family sees it as "retakes of the previous sitting only", the entry offers only
// retakes, and a declared retake of the previous sitting reserves. drive-retake-only.mjs <lang> <tag>
import { readFileSync } from 'node:fs';
import { browser, signedIn, shot, WEB } from './lib.mjs';

const demo = JSON.parse(readFileSync('/tmp/rwb/demo-B.json', 'utf8'));
const lang = process.argv[2] ?? 'en';
const who = process.argv[3];
const b = await browser();
const page = await signedIn(b, `parent.${who}@igcse.local`, process.env.DEV_PASSWORD, lang);
await page.goto(`${WEB}/register`);
await page.waitForSelector('#reserve-session', { timeout: 30000 });
if ((await page.locator('#reserve-session').inputValue()) !== demo.sessionId) await page.selectOption('#reserve-session', demo.sessionId);
const box = page.getByRole('checkbox', { name: /Geography O\.L\./ });
await box.waitFor({ timeout: 30000 });
await box.check();
const row = page.locator('tr', { has: box });
const entries = await row.getByRole('combobox', { name: 'Entry' }).locator('option').allTextContents();
console.log('entries offered:', JSON.stringify(entries));
await row.getByRole('combobox', { name: 'The sitting it follows' }).selectOption({ index: 1 });
const boxes = page.locator('input[type="checkbox"]');
const n = await boxes.count();
await boxes.nth(n - 2).check();
await boxes.nth(n - 1).check();
await shot(page, `family-retake-only-filled-${lang}`);
await page.getByRole('button', { name: /^Reserve|^الحجز/ }).last().click();
await page.waitForTimeout(2500);
await shot(page, `family-retake-only-done-${lang}`);
const msg = await page.locator('text=/Reserved: \\d+ line|could not|refused|deadline/i').first().textContent().catch(() => null);
console.log('result:', msg);
await b.close();
