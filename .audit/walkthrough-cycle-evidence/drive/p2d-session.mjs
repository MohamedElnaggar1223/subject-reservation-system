// Part 2, the new June 2027 session: Sessions → New session, its dates, started empty; the empty sheet.
import { signIn, BASE, shot, out, errors, browser, mainText } from './lib.mjs';
import { ADMIN, SESSION } from './cycle-data.mjs';

const page = await signIn(ADMIN.email, ADMIN.password);
await page.goto(`${BASE}/admin/sessions`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'New session' }).click();
await page.selectOption('#ns-type', SESSION.type);
await page.fill('#ns-year', String(SESSION.year));
await page.fill('#ns-from', SESSION.from);
await page.fill('#ns-to', SESSION.to);
await page.fill('#ns-course', SESSION.courseStarts);
await page.fill('#ns-due', SESSION.due);
await page.selectOption('#ns-copy', 'none');
await shot(page, 'p2-20-new-session');
await Promise.all([
  page.waitForURL(/\/admin\/sessions\/[^/]+$/, { timeout: 20000 }),
  page.getByRole('button', { name: 'Create session' }).click(),
]);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);
out('session url', page.url());
await shot(page, 'p2-21-session-empty-sheet');
out(await mainText(page, 1500));
out('errors', errors);
await browser.close();
