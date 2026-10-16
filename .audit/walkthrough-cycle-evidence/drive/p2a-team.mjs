// Part 2, the Team: a coordinator, a finance officer, the teachers (Teacher 1 … 33) from the links sheet.
// Each account through Team → Create Account; a teacher's account makes its teacher record ("Teaches as:
// New teacher record (this name)"). The external team is named later, on the subject's form.
import { signIn, BASE, shot, out, errors, browser, mainText } from './lib.mjs';
import { STAFF, PASSWORD, TEACHER_COUNT, T, teacherEmail, ADMIN } from './cycle-data.mjs';

const page = await signIn(ADMIN.email, ADMIN.password);
await page.goto(`${BASE}/admin/team`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await shot(page, 'p2-01-team');

async function create(name, email, role, teaches, shotName) {
  await page.fill('#team-name', name);
  await page.fill('#team-email', email);
  await page.fill('#team-password', PASSWORD);
  await page.selectOption('#team-role', role);
  if (teaches) await page.selectOption('#team-teaches', teaches).catch(() => {});
  if (shotName) await shot(page, shotName);
  await page.getByRole('button', { name: 'Create Account' }).click();
  await page.waitForResponse((r) => r.url().includes('/v1/users') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
}

await create(STAFF[0].name, STAFF[0].email, STAFF[0].role, null, 'p2-02-team-coordinator');
await create(STAFF[1].name, STAFF[1].email, STAFF[1].role, null, 'p2-03-team-finance-officer');
for (let n = 1; n <= TEACHER_COUNT; n++) {
  await create(T(n), teacherEmail(n), 'teacher', 'new', n === 1 ? 'p2-04-team-teacher' : null);
}
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
out((await mainText(page, 800)));
await page.locator('table').first().scrollIntoViewIfNeeded().catch(() => {});
await shot(page, 'p2-05-team-list');
out('errors', errors);
await browser.close();
