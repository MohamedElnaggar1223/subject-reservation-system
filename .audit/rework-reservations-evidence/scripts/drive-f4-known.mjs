// The family's Reserve page with June's sitting known from F4 (a result, an entry sent): the retake
// is pre-set with its series, nothing to declare. drive-f4-known.mjs <lang> <family tag> <shot>
import { readFileSync } from 'node:fs';
import { browser, signedIn, shot, WEB } from './lib.mjs';

const f4 = JSON.parse(readFileSync('/tmp/rwb/f4.json', 'utf8'));
const [lang, who, name] = process.argv.slice(2);
const b = await browser();
const page = await signedIn(b, `parent.${who}@igcse.local`, process.env.DEV_PASSWORD, lang);
await page.goto(`${WEB}/register`);
await page.waitForSelector('#reserve-session', { timeout: 30000 });
await page.selectOption('#reserve-session', f4.session);
const box = page.getByRole('checkbox', { name: /Chemistry O\.L\./ });
await box.waitFor({ timeout: 30000 });
await box.check();
const row = page.locator('tr', { has: box });
await page.waitForTimeout(800);
const entry = await row.locator('select').first().inputValue();
const sittingPicker = (await row.locator('select').count()) > 1 ? 1 : 0;
console.log(`[${lang}] entry:`, entry, '| sitting picker shown:', sittingPicker > 0, '| row:', (await row.textContent())?.replace(/\s+/g, ' ').slice(0, 220));
await shot(page, name);
await b.close();
