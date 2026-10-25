// Chapter 3: the team — the coordinator and the finance officer get accounts from Team.
import { BASE, signIn, shot, out, browser, report, mainText, mark, unmark } from './lib.mjs';
import { D, ADMIN } from './data.mjs';

const page = await signIn(ADMIN.email, ADMIN.password);
await page.goto(`${BASE}/admin/team`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await mark(page, page.locator('nav a', { hasText: 'Team' }).first());
await shot(page, 'team-open');
await unmark(page);
for (const [i, s] of D.staff.entries()) {
  await page.fill('#team-name', s.name);
  await page.fill('#team-email', s.email);
  await page.fill('#team-password', D.temp_password);
  await page.selectOption('#team-role', s.role);
  await mark(page, page.getByRole('button', { name: 'Create Account' }));
  await shot(page, `team-${s.role}-filled`);
  await unmark(page);
  await page.getByRole('button', { name: 'Create Account' }).click();
  await page.waitForResponse((r) => r.url().includes('/v1/users') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  out(await page.locator('[role=status]').first().innerText().catch(() => 'no status'));
  if (i === D.staff.length - 1) await shot(page, 'team-list');
}
out(await mainText(page, 1500));
report();
await browser.close();
