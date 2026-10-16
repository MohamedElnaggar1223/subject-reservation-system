// Parts 3 and 4: the student reserves a subject as the form asks — the request waits for the parent — and the
// parent approves it.
import { signIn, BASE, shot, out, errors, browser, mainText, toTop } from './lib.mjs';
import { FAMILIES, PASSWORD } from './cycle-data.mjs';

const F = FAMILIES.app;
{
  const page = await signIn(F.student.email, PASSWORD);
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const row = (label) => page.locator('tr', { has: page.getByLabel(label, { exact: true }) }).first();
  await page.getByLabel('Arabic: All papers', { exact: true }).check();
  await page.waitForTimeout(400);
  await row('Arabic: All papers').getByLabel('Teacher').selectOption({ label: 'Teacher 2' });
  await page.getByLabel('Chemistry: Paper 41/42 only (retake)', { exact: true }).check();
  await page.waitForTimeout(400);
  await row('Chemistry: Paper 41/42 only (retake)').getByLabel('The sitting it follows').selectOption({ label: 'Cambridge International June 2026' });
  await page.waitForTimeout(500);
  await page.locator('label', { hasText: 'I confirm that I have read the refund policy' }).locator('input').check();
  await page.locator('label', { hasText: 'I confirm that the information given' }).locator('input').check();
  await toTop(page, row('Arabic: All papers'), 140);
  await shot(page, 'p3-05-student-reserve');
  await toTop(page, row('Chemistry: Paper 41/42 only (retake)'), 140);
  await shot(page, 'p3-05b-student-reserve-retake');
  await page.getByRole('button', { name: 'Send to my parent' }).click();
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelector('main')?.scrollTo(0, 0));
  await shot(page, 'p3-06-student-sent-to-parent');
  out(await mainText(page, 600));
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'p3-07-student-home-waiting');
  out(await mainText(page, 1000));
  await page.context().close();
}
{
  const page = await signIn(F.parent.email, PASSWORD);
  await page.waitForTimeout(1500);
  await shot(page, 'p4-16-parent-home-approval');
  out(await mainText(page, 1000));
  await page.goto(`${BASE}/approvals`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Select all' }).first().click();
  await shot(page, 'p4-17-approvals');
  await page.getByRole('button', { name: 'Approve Selected' }).click();
  await page.getByRole('button', { name: 'Confirm Approval' }).click();
  await page.waitForTimeout(2500);
  await shot(page, 'p4-18-approved');
  out(await mainText(page, 800));
}
out('errors', errors);
await browser.close();
