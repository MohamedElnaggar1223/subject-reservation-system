import { browser, signedIn, shot, WEB } from './lib.mjs';
const b = await browser();
const page = await signedIn(b, 'officer.mona@igcse.local');
await page.goto(`${WEB}/desk`);
await page.fill('input[type="search"]', 'Demo B');
await page.waitForTimeout(2500);
await shot(page, 'dbg-desk-search');
console.log(await page.locator('button').allTextContents());
await b.close();
