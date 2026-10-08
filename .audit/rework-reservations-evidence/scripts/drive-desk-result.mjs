// The desk's Reserve result in Arabic after a reservation that also collects the year's school fee
// (step C's "Also collect now"): does each sentence of the result translate? drive-desk-result.mjs <tag> <shot-name>
import { readFileSync } from 'node:fs';
import { browser, signedIn, shot, WEB } from './lib.mjs';

const demo = JSON.parse(readFileSync('/tmp/rwb/demo-B.json', 'utf8'));
const tag = process.argv[2];
const name = process.argv[3];
const b = await browser();
const page = await signedIn(b, 'officer.mona@igcse.local', process.env.DEV_PASSWORD, 'ar');
await page.goto(`${WEB}/desk`);
await page.fill('input[type="search"]', tag);
await page.getByRole('button', { name: new RegExp(`student\\.${tag}@igcse\\.local`) }).first().click();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: '+ حجز' }).click();
if ((await page.locator('#desk-session').inputValue()) !== demo.sessionId) await page.selectOption('#desk-session', demo.sessionId);
await page.getByRole('checkbox', { name: /Mathematics O\.L\./ }).waitFor({ timeout: 30000 });
await page.getByRole('checkbox', { name: /Mathematics O\.L\./ }).check();
// "Also collect now": the year's school fee.
const fee = page.locator('fieldset').locator('input[type="checkbox"]').first();
await fee.waitFor({ timeout: 15000 });
await fee.check();
await page.getByRole('checkbox', { name: /قرأ ولي الأمر|read and signed by the parent/ }).check();
await page.getByRole('button', { name: /حجز وتحصيل|Reserve and collect/ }).click();
await page.waitForTimeout(3500);
const card = page.locator('.border-emerald-200').last();
console.log('result:', (await card.textContent())?.replace(/\s+/g, ' ').slice(0, 400));
const banner = page.locator('.border-emerald-200').first();
console.log('banner:', (await banner.textContent())?.replace(/\s+/g, ' ').slice(0, 400));
await shot(page, name);
await b.close();
