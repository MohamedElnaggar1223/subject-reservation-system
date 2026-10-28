// The families of Part B, made through the desk ("+ New family", the desk's own sign-up of a family): a parent with two
// children, and a walk-in family. Invented names, no phone numbers. No picture: the guide does not teach this.
import { signedIn, go, settle, out, browser, report } from './lib.mjs';
import { OFFICER, TEMP_PASSWORD, PARENT, CHILDREN, WALKIN_PARENT, WALKIN, FAMILY_PASSWORD } from './data.mjs';

const page = await signedIn(OFFICER.email, TEMP_PASSWORD);
await go(page, '/desk');
const families = [
  { parent: PARENT, student: CHILDREN[0] },
  { parent: { email: PARENT.email }, student: CHILDREN[1] },
  { parent: WALKIN_PARENT, student: WALKIN },
];
for (const f of families) {
  await page.getByRole('button', { name: '+ New family' }).click();
  const card = page.locator('div', { has: page.getByRole('heading', { name: 'Onboard a walk-in family' }) }).last();
  await card.getByPlaceholder('Parent email *').fill(f.parent.email);
  if (f.parent.name) {
    await card.getByPlaceholder('Parent name (new account)').fill(f.parent.name);
    await card.getByPlaceholder('Temp password (new account)').first().fill(FAMILY_PASSWORD);
  }
  await card.getByPlaceholder('Student email *').fill(f.student.email);
  await card.getByPlaceholder('Student name (new account)').fill(f.student.name);
  await card.getByPlaceholder('Temp password (new account)').last().fill(FAMILY_PASSWORD);
  await card.locator('select').selectOption(String(f.student.grade));
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/v1/links/desk-onboard'), { timeout: 30000 }),
    card.getByRole('button', { name: 'Create & Link Family' }).click(),
  ]);
  await page.waitForTimeout(800);
  await settle(page);
  out(f.student.email, '→', (await page.locator('main').innerText()).match(/Family onboarded[^\n]*/)?.[0] ?? 'no notice');
  await go(page, '/desk');
}
report('b0-families');
await browser.close();
