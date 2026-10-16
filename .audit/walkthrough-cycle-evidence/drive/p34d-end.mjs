// Parts 3 and 4, the end: the student's statement and notifications (3); the parent's receipt, the reminder
// and the message received, and the language switch to Arabic (4); the admin's Home with the cycle running (2).
import { signIn, BASE, shot, out, errors, browser, mainText, setLang } from './lib.mjs';
import { FAMILIES, PASSWORD, ADMIN } from './cycle-data.mjs';

const F = FAMILIES.app;
{
  const page = await signIn(F.student.email, PASSWORD);
  await page.goto(`${BASE}/statement`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, 'p3-11-student-statement');
  await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, 'p3-12-student-notifications');
  out(await mainText(page, 1500));
  await page.context().close();
}
{
  const page = await signIn(F.parent.email, PASSWORD);
  await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, 'p4-25-parent-notifications');
  out(await mainText(page, 2500));
  // A receipt, from My Registrations ("View").
  await page.goto(`${BASE}/registrations`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const [rcpt] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('link', { name: 'View' }).first().click()]);
  await rcpt.waitForLoadState('networkidle');
  await rcpt.waitForTimeout(1500);
  await shot(rcpt, 'p4-26-parent-receipt', { full: true });
  await rcpt.close();
  // Arabic: the sidebar's language button, right to left.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Arabic' }).first().click().catch(async () => setLang(page, 'ar'));
  await page.waitForTimeout(2000);
  await shot(page, 'p4-27-parent-home-arabic');
  await page.goto(`${BASE}/statement`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, 'p4-28-parent-statement-arabic');
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await shot(page, 'p4-29-parent-reserve-arabic');
  await setLang(page, 'en');
  await page.context().close();
}
{
  const page = await signIn(ADMIN.email, ADMIN.password);
  await page.waitForTimeout(1500);
  await shot(page, 'p2-78-admin-home-cycle-running');
  out(await mainText(page, 2500));
}
out('errors', errors);
await browser.close();
