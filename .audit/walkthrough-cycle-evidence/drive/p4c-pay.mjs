// Part 4: paying — the checkout per exam board: the Cambridge lines by InstaPay (the transfer's reference
// submitted), the Pearson line at the school desk (a reference to quote there).
import { signIn, BASE, shot, out, errors, browser, mainText } from './lib.mjs';
import { FAMILIES, PASSWORD } from './cycle-data.mjs';

const F = FAMILIES.app;
const page = await signIn(F.parent.email, PASSWORD);
await page.waitForTimeout(1500);
await shot(page, 'p4-09-home-pay-now');
await page.getByRole('link', { name: /Pay now/ }).first().click();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2000);
await shot(page, 'p4-10-checkout-by-board');
const allUrl = page.url();

const payFor = async (board) => {
  const card = page.locator('div', { has: page.locator('p, h2, h3', { hasText: new RegExp(`^${board} June 2027$`) }) }).filter({ has: page.getByRole('button', { name: 'Pay for this series' }) }).last();
  await card.getByRole('button', { name: 'Pay for this series' }).click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
};

// Cambridge by InstaPay.
if (!process.env.SKIP_INSTAPAY) {
await payFor('Cambridge International');
await page.getByRole('button', { name: 'InstaPay', exact: true }).click();
await page.waitForTimeout(500);
await shot(page, 'p4-11-checkout-instapay');
await page.getByRole('button', { name: /by InstaPay$/ }).click();
await page.waitForTimeout(2500);
await page.getByPlaceholder('Transaction reference from your InstaPay receipt').fill('IPN-DEMO-000123');
await shot(page, 'p4-12-instapay-details');
await page.getByRole('button', { name: 'Submit Reference' }).click();
await page.waitForTimeout(2000);
await shot(page, 'p4-13-instapay-reference-sent');
}

// Pearson at the school desk.
// The other board's line: My Registrations → tick it → Pay Selected (Home's "Pay now" leads to the
// checkout of all three, which now says "Payment already started": a finding).
await page.goto(`${BASE}/registrations`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.getByLabel('Select Mathematics for payment').check();
await shot(page, 'p4-14-registrations-pay-selected');
await page.getByRole('button', { name: /Pay Selected/ }).first().click();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2000);
if (await page.getByRole('button', { name: 'Pay for this series' }).count()) await payFor('Pearson Edexcel');
await page.getByRole('button', { name: 'Pay at School', exact: true }).click();
await page.getByRole('button', { name: /at the school desk$/ }).click();
await page.waitForTimeout(2500);
await shot(page, 'p4-15-pay-at-desk-reference');
out(await mainText(page, 800));
out('errors', errors);
await browser.close();
