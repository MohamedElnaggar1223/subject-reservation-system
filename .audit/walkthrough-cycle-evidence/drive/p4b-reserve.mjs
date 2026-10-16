// Part 4: the parent reserves for the child exactly as the forms asked — three subjects, one of them a
// self-study retake with its earlier sitting named ("Retake Self Study 50% fees (All Papers)").
import { signIn, BASE, shot, out, errors, browser, mainText, toTop } from './lib.mjs';
import { FAMILIES, PASSWORD } from './cycle-data.mjs';

const F = FAMILIES.app;
const page = await signIn(F.parent.email, PASSWORD);
await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await shot(page, 'p4-06-reserve-page');

const row = (label) => page.locator('tr', { has: page.getByLabel(label, { exact: true }) }).first();
async function pick(label, { teacher, entry, sitting } = {}) {
  await page.getByLabel(label, { exact: true }).check();
  await page.waitForTimeout(400);
  const r = row(label);
  if (entry) await r.getByLabel('Entry').selectOption(entry);
  if (teacher) await r.getByLabel('Teacher').selectOption({ label: teacher });
  if (sitting) await r.getByLabel('The sitting it follows').selectOption({ label: sitting });
  await page.waitForTimeout(400);
}
await pick('Biology: All papers', { teacher: 'Teacher 4' });
await pick('Mathematics: All papers', { teacher: 'Teacher 21' });
await pick('Physics: All papers', { entry: 'retake|self_study', sitting: 'Cambridge International June 2026' });
await page.locator('label', { hasText: 'I confirm that I have read the refund policy' }).locator('input').check();
await page.locator('label', { hasText: 'I confirm that the information given' }).locator('input').check();
await toTop(page, row('Biology: All papers'), 140);
await shot(page, 'p4-07a-reserve-biology');
await toTop(page, row('Mathematics: All papers'), 140);
await shot(page, 'p4-07b-reserve-maths-physics');
await toTop(page, page.locator('label', { hasText: 'I confirm that I have read the refund policy' }), 260);
await shot(page, 'p4-07c-reserve-consents');
await page.getByRole('button', { name: /^Reserve/ }).last().click();
await page.waitForTimeout(3000);
await page.getByText('Pay now').first().scrollIntoViewIfNeeded();
await shot(page, 'p4-08-reserved');
out(await mainText(page, 1500));
out('errors', errors);
await browser.close();
