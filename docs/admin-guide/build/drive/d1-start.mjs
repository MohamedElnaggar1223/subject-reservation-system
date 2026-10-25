// Chapter 1-2: the sign-in, the admin's Home on an empty system, the school's name on the sign-in page.
import { BASE, newPage, signIn, shot, out, browser, report, mainText, settingCard, toTop, mark, unmark } from './lib.mjs';
import { D, ADMIN } from './data.mjs';

{ // The sign-in page as she first sees it, then filled.
  const page = await newPage();
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('#email', ADMIN.email);
  await page.fill('#password', ADMIN.password);
  await mark(page, page.locator('button[type=submit]'));
  await shot(page, 'sign-in-filled');
  await page.context().close();
}
const page = await signIn(ADMIN.email, ADMIN.password);
out('landed', page.url());
await shot(page, 'home-empty');
out(await mainText(page, 800));

// Settings → The school's name → Change.
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
let card = settingCard(page, "The school's name");
await toTop(page, card, 70);
await mark(page, card.getByRole('button', { name: 'Change' }));
await mark(page, page.locator('nav a', { hasText: 'Settings' }).first());
await shot(page, 'settings-school-name');
await unmark(page);
await card.getByRole('button', { name: 'Change' }).click();
await card.locator('input[type=text]').fill(D.school_name);
await card.locator('textarea').fill("The school's name on the sign-in page");
await mark(page, card.getByRole('button', { name: 'Save change' }));
await shot(page, 'settings-school-name-typed');
await unmark(page);
await card.getByRole('button', { name: 'Save change' }).click();
await page.waitForTimeout(1500);
card = settingCard(page, "The school's name");
await toTop(page, card, 70);
await shot(page, 'settings-school-name-saved');
out(await card.innerText());

const visitor = await newPage();
await visitor.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
await visitor.waitForTimeout(800);
await shot(visitor, 'sign-in-with-school-name');
report();
await browser.close();
