// Credentials of the local dev container and its demo accounts are read from the environment (DEV_PASSWORD, DEV_ADMIN_PASSWORD, DEV_PG_ADMIN_URL, DEV_PG_BASE_URL).
// The four proof screenshots of the review of 887fad4: the dates sentence on a converted session's
// Reserve page (English and Arabic), the grade-10 checkout's terms, the slip's "to be verified".
import { readFileSync } from 'node:fs';
import { browser, signedIn, shot, WEB } from './lib.mjs';

const ids = JSON.parse(readFileSync('/tmp/rwb/proof.json', 'utf8'));
const g10Line = process.argv[2];
const b = await browser();

for (const lang of ['en', 'ar']) {
  const page = await signedIn(b, `parent.${ids.convFamily}@igcse.local`, process.env.DEV_PASSWORD, lang);
  await page.goto(`${WEB}/register`);
  await page.waitForSelector('#reserve-session', { timeout: 30000 });
  await page.selectOption('#reserve-session', ids.conv);
  await page.getByRole('checkbox', { name: /Biology O\.L\./ }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const sentence = await page.locator('label', { has: page.locator('input[type="checkbox"]') }).filter({ hasText: /refund|الاسترداد/ }).last().textContent();
  console.log(`[${lang}] the refund tick:`, sentence);
  await shot(page, `proof-converted-dates-${lang}`);
  await page.context().close();
}

{
  const page = await signedIn(b, `parent.${ids.g10Family}@igcse.local`, process.env.DEV_PASSWORD, 'en');
  await page.goto(`${WEB}/checkout?ids=${g10Line}`);
  await page.waitForTimeout(3500);
  const text = await page.locator('body').textContent();
  console.log('[en] grade-10 checkout terms:', (text ?? '').match(/I confirm that I have read the refund policy[^.]*\./)?.[0] ?? '(not found)');
  await shot(page, 'proof-grade10-checkout-terms-en');
  await page.context().close();
}

{
  const page = await signedIn(b, 'officer.mona@igcse.local', process.env.DEV_PASSWORD, 'en');
  await page.goto(`${WEB}/reservation-slip/${ids.deskStudent}?ids=${ids.deskLines.join(',')}`);
  await page.waitForTimeout(3000);
  const text = await page.locator('body').textContent();
  console.log('[en] slip mark:', /to be verified by the school/.test(text ?? '') ? 'present' : 'missing');
  await shot(page, 'proof-slip-to-be-verified-en');
  await page.context().close();
}
await b.close();
