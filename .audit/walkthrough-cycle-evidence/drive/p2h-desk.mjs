// Part 2, the desk: a walk-in family onboarded, three subjects reserved with a declared retake, the money
// collected (one payment per entry deadline), the receipts and the reservation slip; then the app family's
// Pearson line paid in cash at the desk (Part 4's "pay at the desk").
import { signIn, BASE, shot, out, errors, browser, mainText, tallShot, mainBox, toTop } from './lib.mjs';
import { FAMILIES, PASSWORD, STAFF } from './cycle-data.mjs';

const ONLY = process.env.ONLY;
const W = FAMILIES.desk;
const officer = STAFF[1];
const page = await signIn(officer.email, PASSWORD);
await page.waitForTimeout(1500);

if (!ONLY || ONLY === 'walkin') {
  await shot(page, 'p2-37-desk-today');
  await page.getByRole('button', { name: '+ New family' }).click();
  await page.getByPlaceholder('Parent email *').fill(W.parent.email);
  await page.getByPlaceholder('Parent name (new account)').fill(W.parent.name);
  await page.getByPlaceholder('Temp password (new account)').first().fill(PASSWORD);
  await page.getByPlaceholder('Student email *').fill(W.student.email);
  await page.getByPlaceholder('Student name (new account)').fill(W.student.name);
  await page.getByPlaceholder('Temp password (new account)').nth(1).fill(PASSWORD);
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Grade this year (new account)…' }) }).selectOption(String(W.student.grade));
  await shot(page, 'p2-38-desk-new-family');
  await page.getByRole('button', { name: 'Create & Link Family' }).click();
  await page.getByText('Reserve at the desk').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  await shot(page, 'p2-39-desk-family-onboarded');

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
  await pick('Chemistry: All papers', { teacher: 'Teacher 9' });
  await pick('Physics: All papers', { entry: 'retake|self_study', sitting: 'Cambridge International June 2026' });
  await pick('Mathematics: All papers', { teacher: 'Teacher 22' });
  await page.locator('label', { hasText: 'Refund policy and declaration read and signed by the parent' }).locator('input').first().check();
  await page.selectOption('#desk-instrument', 'cash');
  await toTop(page, row('Chemistry: All papers'), 140);
  await shot(page, 'p2-40a-desk-ticked');
  await toTop(page, page.getByRole('button', { name: /Reserve and collect/ }), 420);
  await shot(page, 'p2-40-desk-reserve-and-collect');
  await page.getByRole('button', { name: /Reserve and collect/ }).click();
  await page.getByText('Receipts to hand over').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await toTop(page, page.getByText('Reserve at the desk').first(), 20);
  await shot(page, 'p2-41-desk-collected');
  out(await mainText(page, 1500));

  // The reservation slip (a new tab).
  const [slip] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('link', { name: 'Print the reservation slip' }).first().click()]);
  await slip.waitForLoadState('networkidle');
  await slip.waitForTimeout(1500);
  await shot(slip, 'p2-42-reservation-slip', { full: true });
  await slip.close();
  // The statement at the desk: each line with its receipt.
  await page.getByRole('button', { name: 'Statement' }).first().click();
  await page.waitForTimeout(2000);
  const st = page.getByText('Payments').last();
  await toTop(page, page.locator('h3, h2', { hasText: /Statement/ }).last(), 20).catch(() => {});
  await shot(page, 'p2-43-desk-statement');
  out(await mainText(page, 4000));
}
// The receipts: handed over (the paper leaves the desk), and one printed.
if (!ONLY || ONLY === 'walkin' || ONLY === 'receipts') {
  await page.goto(`${BASE}/desk`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder("Type a student's name, email, or ID…").fill(W.student.name);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: new RegExp(W.student.name) }).first().click();
  await page.waitForTimeout(2000);
  const regs = page.locator('h3', { hasText: 'Registrations' }).first();
  await toTop(page, regs, 20);
  await shot(page, 'p2-44-desk-receipts-to-hand-over');
  while (await page.getByRole('button', { name: 'Hand Over' }).count()) {
    await page.getByRole('button', { name: 'Hand Over' }).first().click();
    await page.waitForTimeout(1200);
  }
  const [rcpt] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('link', { name: 'Print' }).first().click()]);
  await rcpt.waitForLoadState('networkidle');
  await rcpt.waitForTimeout(1500);
  await shot(rcpt, 'p2-45-receipt-print', { full: true });
  await rcpt.close();
}

// The app family's Pearson line, paid in cash at the desk (they quote the reference or the name).
if (ONLY === 'appfamily') {
  const A = FAMILIES.app;
  await page.goto(`${BASE}/desk`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder("Type a student's name, email, or ID…").fill(A.student.name);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: new RegExp(A.student.name) }).first().click();
  await page.waitForTimeout(2500);
  out(await mainText(page, 3000));
  const owed = page.locator('section[aria-labelledby=desk-owed]');
  if (await owed.count()) {
    await toTop(page, owed, 20);
    await shot(page, 'p2-46-desk-collect-app-family');
    await owed.getByRole('button', { name: /^Collect/ }).click();
    await page.waitForTimeout(2500);
    await shot(page, 'p2-47-desk-collected-app-family');
    while (await page.getByRole('button', { name: 'Hand Over' }).count()) {
      await page.getByRole('button', { name: 'Hand Over' }).first().click();
      await page.waitForTimeout(1200);
    }
  }
}
out('errors', errors);
await browser.close();
