// Part 1: the first sign-in as the admin, what the fresh database shows, and the school's name on sign-in.
import { newPage, signIn, BASE, shot, out, errors, browser, mainText, settingCard, toTop } from './lib.mjs';

// The sign-in page, filled.
{
  const page = await newPage('en');
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', 'admin@igcse.local');
  await page.fill('input[type=password], input[name=password]', 'AdminPass1');
  await shot(page, 'p1-11-sign-in-admin');
  await page.context().close();
}

const page = await signIn('admin@igcse.local', 'AdminPass1');
out('landed', page.url());
await shot(page, 'p1-12-admin-home');
out(await mainText(page, 1200));

await page.goto(`${BASE}/admin/sessions`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await shot(page, 'p1-13-sessions-after-seed');
out(await mainText(page, 1200));

await page.goto(`${BASE}/exams/catalogue`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await shot(page, 'p1-14-catalogue-after-seed');

// The school's name: Settings → The school → Change.
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const card = settingCard(page, "The school's name");
await toTop(page, card, 60);
await card.getByRole('button', { name: 'Change' }).click();
await card.locator('input[type=text]').fill('Demo International School');
await card.locator('textarea').fill("The school's name on the sign-in page");
await shot(page, 'p1-15-settings-school-name');
await card.getByRole('button', { name: 'Save change' }).click();
await page.waitForTimeout(1500);
await toTop(page, settingCard(page, "The school's name"), 60);
await shot(page, 'p1-16-settings-school-name-saved');

// Signed out: the sign-in page now carries the name.
const visitor = await newPage('en');
await visitor.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
await shot(visitor, 'p1-17-sign-in-with-school-name');
out('errors', errors);
await browser.close();
