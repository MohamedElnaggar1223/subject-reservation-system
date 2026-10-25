// Chapter 4: the 25 subjects in one paste (Exam Catalogue → Import several from a list → Subject Management),
// then each subject's teachers by name (Teachers), then (optional) a teacher's own account linked to her record.
import { BASE, signIn, shot, out, browser, report, mainText, mark, unmark, toTop } from './lib.mjs';
import { D, ADMIN } from './data.mjs';

const page = await signIn(ADMIN.email, ADMIN.password);
page.on('dialog', (d) => d.accept());
await page.goto(`${BASE}/exams/catalogue`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await mark(page, page.getByRole('link', { name: 'Import several from a list' }));
await mark(page, page.locator('nav a', { hasText: 'Exam Catalogue' }).first());
await shot(page, 'catalogue-import-button');
await unmark(page);
await Promise.all([page.waitForURL(/admin\/subjects/), page.getByRole('link', { name: 'Import several from a list' }).click()]);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);
const lines = ['name,code,board,level,course fee', ...D.subjects.map((s) => [s.name, s.code, s.board, s.level, 0].join(','))];
await page.locator('textarea').first().fill(lines.join('\n'));
await mark(page, page.getByRole('button', { name: 'Import', exact: true }));
await shot(page, 'subjects-paste');
await unmark(page);
await page.getByRole('button', { name: 'Import', exact: true }).click();
await page.getByText(/Imported \d+ subject/).waitFor({ timeout: 60000 });
await page.waitForTimeout(800);
out(await page.locator('pre').first().innerText());
await shot(page, 'subjects-imported');

// Each subject's teachers: Teachers → type the names, one per line → Add → Save Teachers.
await page.getByRole('button', { name: 'Close Import' }).click();
await page.waitForTimeout(500);
let firstDone = false;
for (const s of D.subjects) {
  if (!s.teachers) continue;
  const row = page.locator('tr', { has: page.locator('td', { hasText: new RegExp(`^${s.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`) }) }).filter({ hasText: s.code }).first();
  await row.scrollIntoViewIfNeeded();
  if (!firstDone) { await mark(page, row.getByRole('button', { name: 'Teachers' })); await shot(page, 'subjects-teachers-button'); await unmark(page); }
  await row.getByRole('button', { name: 'Teachers' }).click();
  const modal = page.locator('div.fixed.inset-0', { hasText: `Teachers — ${s.name}` }).last();
  await modal.waitFor();
  await page.waitForTimeout(400);
  await modal.locator('textarea').fill(s.teachers.join('\n'));
  if (!firstDone) { await mark(page, modal.getByRole('button', { name: 'Add', exact: true })); await shot(page, 'teachers-arabic-typed'); await unmark(page); }
  await modal.getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForTimeout(800 + 400 * s.teachers.length);
  if (!firstDone) { await mark(page, modal.getByRole('button', { name: 'Save Teachers' })); await shot(page, 'teachers-arabic-added'); await unmark(page); }
  if (s.code === 'ARABIC-AL') { await shot(page, 'teachers-arabic-al-added'); }
  await modal.getByRole('button', { name: 'Save Teachers' }).click();
  await modal.waitFor({ state: 'detached', timeout: 15000 });
  await page.waitForTimeout(500);
  firstDone = true;
}
// A later subject: the teachers already made are in the list, ticked where they teach it.
{
  const s = D.subjects.find((x) => x.code === '4MA1');
  const row = page.locator('tr').filter({ hasText: s.code }).first();
  await row.getByRole('button', { name: 'Teachers' }).click();
  const modal = page.locator('div.fixed.inset-0', { hasText: `Teachers — ${s.name}` }).last();
  await modal.waitFor();
  await page.waitForTimeout(1200);
  // The list is every teacher, alphabetically: scrolled to this subject's own, which are ticked.
  await modal.locator('label', { hasText: /^Teacher 20$/ }).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  await shot(page, 'teachers-later-subject');
  await modal.getByRole('button', { name: 'Cancel' }).click();
}

// Optional: a teacher who must sign in — Team → Create Account, Role Teacher, Teaches as her record.
await page.goto(`${BASE}/admin/team`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.fill('#team-name', 'Teacher 1');
await page.fill('#team-email', 'teacher1@igcse.local');
await page.fill('#team-password', D.temp_password);
await page.selectOption('#team-role', 'teacher');
const opt = await page.locator('#team-teaches option', { hasText: /^Teacher 1$/ }).getAttribute('value');
await page.selectOption('#team-teaches', opt);
await mark(page, page.locator('#team-teaches'));
await shot(page, 'team-teacher-account');
await unmark(page);
await page.getByRole('button', { name: 'Create Account' }).click();
await page.waitForTimeout(1500);
out(await page.locator('[role=status]').first().innerText().catch(() => 'no status'));
await shot(page, 'team-teacher-account-made');
report();
await browser.close();
