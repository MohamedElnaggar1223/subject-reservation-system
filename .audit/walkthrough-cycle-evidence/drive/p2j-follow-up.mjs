// Part 2, following up: the To verify tab (the coordinator verifies the declared sittings), an exception for
// a family (Exceptions), the Money tab and Remind, a message to the session's unpaid families (Messages).
import { signIn, BASE, shot, out, errors, browser, mainText, apiAs, toTop, tallShot, mainBox } from './lib.mjs';
import { ADMIN, PASSWORD, STAFF } from './cycle-data.mjs';

const ONLY = process.env.ONLY;
const admin = await apiAs(ADMIN.email, ADMIN.password);
const june = (await admin('GET', '/v1/sessions')).find((s) => s.name === 'June 2027');

if (!ONLY || ONLY === 'verify') {
  const page = await signIn(STAFF[0].email, PASSWORD); // the coordinator
  await page.goto(`${BASE}/admin/sessions/${june.id}#verify`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, 'p2-52-to-verify');
  out(await mainText(page, 2500));
  const first = page.getByRole('button', { name: 'Verify', exact: true }).first();
  await first.click();
  const modal = page.getByRole('dialog', { name: 'Verify the declared sitting' });
  await modal.locator('#answer-reason').fill("Seen on the June 2026 statement of results");
  await shot(page, 'p2-53-verify-sitting');
  await modal.getByRole('button', { name: 'Verify', exact: true }).click();
  await page.waitForTimeout(2000);
  // The second declared sitting, verified the same way.
  while (await page.getByRole('button', { name: 'Verify', exact: true }).count()) {
    await page.getByRole('button', { name: 'Verify', exact: true }).first().click();
    await page.getByRole('dialog').locator('#answer-reason').fill("Seen on the June 2026 statement of results");
    await page.getByRole('dialog').getByRole('button', { name: 'Verify', exact: true }).click();
    await page.waitForTimeout(2000);
  }
  await page.getByRole('button', { name: /Answered/ }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, 'p2-54-to-verify-answered');
  await page.context().close();
}
if (!ONLY || ONLY === 'exception') {
  const page = await signIn(ADMIN.email, ADMIN.password);
  await page.goto(`${BASE}/admin/exceptions`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.fill('#exc-student-search', 'Student One');
  await page.waitForTimeout(1200);
  await page.selectOption('#exc-student', { label: 'Student One (Grade 11)' }).catch(async () => {
    const v = await page.locator('#exc-student option', { hasText: 'Student One' }).first().getAttribute('value');
    await page.selectOption('#exc-student', v);
  });
  await page.selectOption('#exc-policy', { label: 'Payment due date' });
  await page.fill('#exc-date', '2026-12-20');
  await page.waitForTimeout(1200);
  const lineOpt = await page.locator('#exc-scope-line option', { hasText: 'Arabic' }).first().getAttribute('value');
  await page.selectOption('#exc-scope-line', lineOpt);
  await page.fill('#exc-reason', 'Parent One asked for more time on Arabic; agreed by the admin');
  await shot(page, 'p2-55-exception-grant');
  await page.getByRole('button', { name: 'Grant', exact: true }).click();
  await page.waitForTimeout(2000);
  await shot(page, 'p2-56-exception-granted');
  out(await mainText(page, 1500));
  await page.context().close();
}

if (!ONLY || ONLY === 'money') {
  const page = await signIn(ADMIN.email, ADMIN.password);
  await page.goto(`${BASE}/admin/sessions/${june.id}#money`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, 'p2-57-money-tab');
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: /^Unpaid/ }).click();
  await page.waitForTimeout(1500);
  await shot(page, 'p2-58-money-unpaid');
  await page.getByRole('button', { name: 'Remind', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Remind these families' });
  await dlg.getByRole('button', { name: /^Remind \d|^Remind one|^Remind a/ }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  await shot(page, 'p2-59-remind-dialog');
  await dlg.getByRole('button', { name: /^Remind / }).click();
  await dlg.getByText(/^Sent to/).waitFor({ timeout: 15000 });
  await shot(page, 'p2-60-remind-sent');
  await page.context().close();
}

if (!ONLY || ONLY === 'message') {
  const page = await signIn(ADMIN.email, ADMIN.password);
  await page.goto(`${BASE}/admin/messages`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.getByRole('group', { name: 'Audience' }).getByRole('button', { name: 'A list in the system' }).click();
  const sel = (label) => page.locator('label', { has: page.locator('span', { hasText: new RegExp(`^${label}$`) }) }).locator('select').first();
  await sel('List').selectOption('session_unpaid');
  await sel('Session').selectOption({ label: 'June 2027' });
  await sel('To').selectOption('families');
  await page.locator('label', { has: page.locator('span', { hasText: /^Title$/ }) }).locator('input').fill('June 2027: what is still to pay');
  await page.locator('label', { has: page.locator('span', { hasText: /^Message$/ }) }).locator('textarea')
    .fill('Dear {guardian},\n\n{student} still owes {amount} for June 2027, due by {due}. Pay in the app (Home → Pay now) or at the school desk.');
  await page.waitForTimeout(2000);
  await tallShot(page, 'p2-61-message-unpaid-families', mainBox(page), { fullWidth: true, quality: 64 });
  await page.getByRole('button', { name: /^Send/ }).last().click();
  await page.waitForTimeout(2500);
  await page.getByRole('tab', { name: 'Sent' }).click().catch(() => page.getByText('Sent', { exact: true }).first().click());
  await page.waitForTimeout(1500);
  await shot(page, 'p2-62-message-sent');
  out(await mainText(page, 1500));
  await page.context().close();
}
out('errors', errors);
await browser.close();
