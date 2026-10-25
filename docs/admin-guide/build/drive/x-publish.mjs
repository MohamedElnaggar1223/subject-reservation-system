// Proof for step 9.8 (not a guide picture): a provisional row pasted again with "These are the board's published fees"
// ticked becomes confirmed. On the practice copy, after the final run.
import { BASE, signIn, shot, out, browser, report, toTop } from './lib.mjs';
// Run with SHOTS=/tmp/ag/proof so the proof stays out of the guide's shots.
const page = await signIn('admin@igcse.local', 'AdminPass1');
await page.goto(`${BASE}/admin/sessions`, { waitUntil: 'networkidle' });
const url = await page.locator('a', { hasText: 'June 2027' }).first().getAttribute('href');
await page.goto(`${BASE}${url}#fees`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const g = page.locator('section', { has: page.locator('h3', { hasText: 'Cambridge International' }) }).first();
const row = () => g.locator('tr', { hasText: '0970 CX' }).first();
out('before:', (await row().innerText()).replace(/\s+/g, ' '));
await g.getByRole('button', { name: 'Paste the fee list' }).click();
const modal = page.getByRole('dialog', { name: 'Paste the fee list' });
await modal.getByLabel('The fee list').fill('0970 CX 10,850');
await modal.getByRole('button', { name: 'Read the list' }).click();
await modal.getByText('matched').first().waitFor();
out('published box ticked by default:', await modal.getByLabel("These are the board's published fees").isChecked());
await modal.getByRole('button', { name: 'Add these fees' }).click();
await page.waitForTimeout(2000);
out('after:', (await row().innerText()).replace(/\s+/g, ' '));
await toTop(page, row(), 120);
await shot(page, 'proof-9-8-published-paste-confirms');
report();
await browser.close();
