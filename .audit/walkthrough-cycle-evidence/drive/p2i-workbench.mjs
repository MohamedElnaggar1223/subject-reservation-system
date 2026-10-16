// Part 2: the Finance Workbench — the InstaPay transfer confirmed against the bank statement, the family who
// chose "Pay at School" paid in cash at the desk (their reference quoted), the receipts handed over.
import { signIn, BASE, shot, out, errors, browser, mainText, toTop } from './lib.mjs';
import { PASSWORD, STAFF } from './cycle-data.mjs';

const page = await signIn(STAFF[1].email, PASSWORD);
await page.goto(`${BASE}/finance`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot(page, 'p2-48-workbench-to-confirm');
const card = (text) => page.locator('div', { hasText: text }).filter({ has: page.getByRole('button', { name: 'Confirm' }) }).last();
// InstaPay: the transfer is on the bank statement.
await card('IPN-DEMO-000123').getByRole('button', { name: 'Confirm' }).click();
await page.getByPlaceholder('e.g., Verified on bank statement').fill('On the bank statement of 16 Oct');
await shot(page, 'p2-49-workbench-confirm-instapay');
await page.getByRole('button', { name: 'Confirm Payment' }).click();
await page.waitForTimeout(2000);
// Pay at School: the parent quoted the reference at the desk and paid cash.
await card('SCH-').getByRole('button', { name: 'Confirm' }).click();
await page.getByRole('button', { name: 'Cash', exact: true }).click();
await shot(page, 'p2-50-workbench-confirm-cash');
await page.getByRole('button', { name: 'Confirm Payment' }).click();
await page.waitForTimeout(2000);
await shot(page, 'p2-51-workbench-receipts');
out(await mainText(page, 2000));
// The receipt of the cash payment is handed over.
while (await page.getByRole('button', { name: /^Mark Handed Over$|^Hand Over$/ }).count()) {
  await page.getByRole('button', { name: /^Mark Handed Over$|^Hand Over$/ }).first().click();
  await page.waitForTimeout(1200);
}
out('errors', errors);
await browser.close();
