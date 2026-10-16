// Part 2, the alternative start: the day-one import of the school's own response sheet (a placeholder sheet
// in its shape) — upload, the staged review, the mapping of its series to the June 2027 session, a line,
// the commit, the result.
import { signIn, BASE, shot, out, errors, browser, mainText, apiAs, tallShot, mainBox } from './lib.mjs';
import { ADMIN } from './cycle-data.mjs';

const SHEET = process.env.SHEET ?? '/tmp/f8-pw/june-2027-placeholder-sheet.xlsx';
const admin = await apiAs(ADMIN.email, ADMIN.password);
const june = (await admin('GET', '/v1/sessions')).find((s) => s.name === 'June 2027');
const page = await signIn(ADMIN.email, ADMIN.password);
await page.goto(`${BASE}/imports`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.locator('input[type=file]').setInputFiles(SHEET);
await page.waitForTimeout(600);
await shot(page, 'p2-71-import-upload');
await Promise.all([page.waitForURL(/\/imports\/[^/]+/, { timeout: 30000 }), page.locator('main button').filter({ hasText: /Stage for review/ }).last().click()]);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);
const importId = page.url().split('/imports/')[1].split(/[?#]/)[0];
out('staged', importId);
await shot(page, 'p2-72-import-review');
out(await mainText(page, 1500));
const go = async (q) => { await page.goto(`${BASE}/imports/${importId}?${q}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); };
// The mapping: the sheet's June 2027 lines → lines awaiting payment in June 2027.
await go('tab=mapping');
const selects = page.locator(`select:has(option[value="window:${june.id}"])`);
const n = await selects.count();
out('series selects', n);
for (let i = 0; i < n; i++) { await selects.nth(i).selectOption(`window:${june.id}`); await page.waitForTimeout(1500); }
await shot(page, 'p2-73-import-mapping');
// The rows: a line as the session will hold it.
await go('tab=rows');
const rows = page.locator('[role=table] [role=row]').filter({ hasText: 'Chemistry' });
if (await rows.count()) {
  await rows.first().locator('button').last().click();
  await page.waitForTimeout(1200);
  await shot(page, 'p2-74-import-line');
  out((await page.locator('[role=dialog]').first().innerText().catch(() => '')).slice(0, 1200));
  await page.keyboard.press('Escape');
}
// The problems, then the commit.
await go('tab=problems');
await shot(page, 'p2-75-import-problems');
out(await mainText(page, 1500));
await page.locator('main button').filter({ hasText: /^Commit/ }).first().click();
await page.waitForTimeout(800);
await shot(page, 'p2-76-import-commit');
await page.locator('[role=dialog] button, [role=alertdialog] button').filter({ hasText: /^Commit$/ }).last().click();
await page.waitForTimeout(5000);
await go('tab=result');
await shot(page, 'p2-77-import-result');
out(await mainText(page, 1500));
out('errors', errors);
await browser.close();
