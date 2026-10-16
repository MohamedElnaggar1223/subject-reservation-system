// Parts 3, 4 and 2: a drop. The student asks to drop a paid subject (3); the parent approves it (4); the
// paper receipt comes back to the desk, which takes it back and so releases the refund to the family's
// balance (2); the parent sees the refund on the statement and the balance (4).
import { signIn, BASE, shot, out, errors, browser, mainText, toTop } from './lib.mjs';
import { FAMILIES, PASSWORD, STAFF } from './cycle-data.mjs';

const F = FAMILIES.app;
const SUBJECT = 'Physics';
const ONLY = process.env.ONLY;

if (!ONLY || ONLY === 'request') {
  const page = await signIn(F.student.email, PASSWORD);
  await page.goto(`${BASE}/registrations`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const card = page.locator('div.rounded-lg.border', { has: page.locator('div.font-medium', { hasText: new RegExp(`^${SUBJECT}$`) }) }).first();
  await toTop(page, card, 80);
  await shot(page, 'p3-08-student-registrations');
  await card.getByRole('button', { name: 'Request Drop' }).click();
  const modal = page.locator('div.fixed.inset-0', { has: page.locator('h2', { hasText: 'Request Drop' }) });
  await modal.locator('textarea').fill('I will sit Physics next cycle instead');
  await page.waitForTimeout(1200);
  await shot(page, 'p3-09-student-request-drop');
  await modal.getByRole('button', { name: 'Submit Request' }).click();
  await page.waitForTimeout(2000);
  await page.goto(`${BASE}/pending-requests`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'p3-10-student-pending-requests');
  await page.context().close();
}

if (!ONLY || ONLY === 'approve') {
  const page = await signIn(F.parent.email, PASSWORD);
  await page.waitForTimeout(1500);
  await shot(page, 'p4-19-parent-home-drop-request');
  await page.goto(`${BASE}/approvals`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'p4-20-approvals-drop-request');
  await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await page.waitForTimeout(800);
  await shot(page, 'p4-21-approve-drop');
  await page.getByRole('button', { name: 'Confirm Approval' }).click();
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/registrations`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const card = page.locator('div.rounded-lg.border', { has: page.locator('div.font-medium', { hasText: new RegExp(`^${SUBJECT}$`) }) }).first();
  await toTop(page, card, 80);
  await shot(page, 'p4-22-drop-bring-receipt');
  out(await mainText(page, 2500));
  await page.context().close();
}

if (!ONLY || ONLY === 'desk') {
  const page = await signIn(STAFF[1].email, PASSWORD);
  await page.goto(`${BASE}/desk`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder("Type a student's name, email, or ID…").fill(F.student.name);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: new RegExp(F.student.name) }).first().click();
  await page.waitForTimeout(2500);
  const regs = page.locator('h3', { hasText: 'Registrations' }).first();
  await toTop(page, regs, 20);
  await shot(page, 'p2-63-desk-take-back-receipt');
  await page.getByRole('button', { name: 'Take Back' }).first().click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await shot(page, 'p2-64-desk-refund-to-balance');
  out(await mainText(page, 1500));
  await page.context().close();
}

if (!ONLY || ONLY === 'balance') {
  const page = await signIn(F.parent.email, PASSWORD);
  await page.goto(`${BASE}/statement`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, 'p4-23-statement-after-drop');
  await page.goto(`${BASE}/escrow`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, 'p4-24-balance');
  out(await mainText(page, 2000));
  await page.context().close();
}
out('errors', errors);
await browser.close();
