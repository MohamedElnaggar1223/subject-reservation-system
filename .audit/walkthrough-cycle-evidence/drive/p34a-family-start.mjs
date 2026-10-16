// Parts 3 and 4, the start: the parent signs up (4), the student signs up (3), the parent asks to link the
// child and the child accepts (4, 3), the parent's Home shows the next step (4).
import { newPage, signIn, BASE, shot, out, errors, browser, mainText } from './lib.mjs';
import { FAMILIES, PASSWORD } from './cycle-data.mjs';

const F = FAMILIES.app;

// 4.1 The parent signs up: Create one → I'm a Parent.
{
  const page = await newPage('en');
  await page.goto(`${BASE}/sign-up/parent`, { waitUntil: 'networkidle' });
  await page.fill('#name', F.parent.name);
  await page.fill('#email', F.parent.email);
  await page.fill('#password', PASSWORD);
  await page.fill('#confirmPassword', PASSWORD);
  await shot(page, 'p4-01-parent-sign-up');
  await Promise.all([page.waitForURL(/complete|\/$/, { timeout: 20000 }).catch(() => {}), page.locator('button[type=submit]').first().click()]);
  await page.waitForTimeout(2500);
  await shot(page, 'p4-02-parent-home-no-child');
  out('parent after sign-up', page.url());
  await page.context().close();
}

// 3.1 The student signs up: I'm a Student, with the grade this year.
{
  const page = await newPage('en');
  await page.goto(`${BASE}/sign-up/student`, { waitUntil: 'networkidle' });
  await page.fill('#name', F.student.name);
  await page.fill('#email', F.student.email);
  await page.getByRole('button', { name: new RegExp(`^${F.student.grade}`) }).click();
  await page.fill('#password', PASSWORD);
  await page.fill('#confirmPassword', PASSWORD);
  await shot(page, 'p3-01-student-sign-up');
  await Promise.all([page.waitForURL(/complete/, { timeout: 20000 }).catch(() => {}), page.locator('button[type=submit]').first().click()]);
  await page.waitForURL((u) => u.pathname === '/', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await shot(page, 'p3-02-student-home');
  out(await mainText(page, 800));
  await page.context().close();
}

// 4.2 The parent links the child: Linked Children → + Add Child → the child's email → Send Request.
{
  const page = await signIn(F.parent.email, PASSWORD);
  await page.goto(`${BASE}/links`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: '+ Add Child' }).click();
  await page.fill('#studentIdentifier', F.student.email);
  await shot(page, 'p4-03-link-child');
  await page.getByRole('button', { name: 'Send Request' }).click();
  await page.waitForTimeout(1500);
  await shot(page, 'p4-04-link-awaiting');
  await page.context().close();
}

// 3.2 The student accepts the link: Linked Parents → Approve.
{
  const page = await signIn(F.student.email, PASSWORD);
  await page.goto(`${BASE}/links`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot(page, 'p3-03-link-request');
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await page.waitForTimeout(1500);
  await shot(page, 'p3-04-link-approved');
  await page.context().close();
}

// 4.3 The parent's Home: the next step for the child.
{
  const page = await signIn(F.parent.email, PASSWORD);
  await page.waitForTimeout(1500);
  await shot(page, 'p4-05-parent-home-next-step');
  out(await mainText(page, 1200));
}
out('errors', errors);
await browser.close();
