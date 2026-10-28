// Before you start (the admin's): the coordinator and the desk officer get their accounts on Team.
import { signedIn, go, shot, shotMarked, out, browser, report, settle } from './lib.mjs';
import { ADMIN, STAFF, TEMP_PASSWORD } from './data.mjs';

const page = await signedIn(ADMIN.email, ADMIN.password);
await go(page, '/admin/team');
await page.locator('#team-name').waitFor();
for (const [i, s] of STAFF.entries()) {
  await page.fill('#team-name', s.name);
  await page.fill('#team-email', s.email);
  await page.fill('#team-password', TEMP_PASSWORD);
  await page.selectOption('#team-role', s.role);
  if (i === 0) await shotMarked(page, 'team-coordinator', page.getByRole('button', { name: 'Create Account' }));
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/v1/users') && r.request().method() === 'POST', { timeout: 20000 }),
    page.getByRole('button', { name: 'Create Account' }).click(),
  ]);
  await page.waitForTimeout(800);
  await settle(page);
  out(s.email, '→', await page.locator('[role=status]').first().innerText().catch(() => 'no status'));
}
await shot(page, 'team-list');
report('a0-team');
await browser.close();
