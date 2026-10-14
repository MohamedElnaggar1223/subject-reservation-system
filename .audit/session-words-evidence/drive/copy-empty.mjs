// The empty June 2028: "Copy from June 2027" in one click, then the sheet it brought (EN, then AR).
import { BASE, browser, errors, out, signIn, shot, step, mainText } from './lib.mjs';
const JUNE28 = '51b42a30-3cec-4c8b-a15e-9e067875312b';
const page = await signIn('admin@igcse.local', 'AdminPass1', 'en');
await page.goto(`${BASE}/admin/sessions/${JUNE28}#subjects`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await step('copy', async () => {
  await shot(page, 'after-13-empty-copy-en');
  await page.locator('main button', { hasText: 'Copy from' }).first().click();
  await page.waitForTimeout(3000);
  await shot(page, 'after-13-copied-en');
  out((await mainText(page, 2500)).replace(/\n+/g, ' | '));
});
await page.evaluate(() => window.localStorage.setItem('language', 'ar'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await shot(page, 'after-13-copied-ar');
out('ERRORS:', errors.filter((e) => !/Hydration/.test(e)).join('\n') || 'none');
await browser.close();
