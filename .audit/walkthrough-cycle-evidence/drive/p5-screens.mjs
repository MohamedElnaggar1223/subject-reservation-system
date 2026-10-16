// The cycle's other screens, each shown once at the end of the run: the balance taken back as cash (the
// parent asks, finance hands it over, a second person approves), the admin's remaining pages, each role's
// Home, and the family pages not yet shown.
import { signIn, BASE, shot, out, errors, browser, mainText, apiAs, toTop } from './lib.mjs';
import { ADMIN, FAMILIES, PASSWORD, STAFF, T } from './cycle-data.mjs';

const ONLY = process.env.ONLY;
const F = FAMILIES.app;
const admin = await apiAs(ADMIN.email, ADMIN.password);
const june = (await admin('GET', '/v1/sessions')).find((s) => s.name === 'June 2027');

if (!ONLY || ONLY === 'withdraw') {
  // The parent takes the refund back.
  const p = await signIn(F.parent.email, PASSWORD);
  await p.goto(`${BASE}/escrow/withdraw`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const child = await p.locator('#withdraw-child option', { hasText: F.student.name }).first().getAttribute('value');
  await p.selectOption('#withdraw-child', child);
  await p.locator('input[type=number]').first().fill('16850');
  await shot(p, 'p4-30-request-withdrawal');
  await p.getByRole('button', { name: 'Submit Withdrawal Request' }).click();
  await p.waitForTimeout(2000);
  await p.context().close();
  // The finance officer hands the cash over.
  const f = await signIn(STAFF[1].email, PASSWORD);
  await f.goto(`${BASE}/finance`, { waitUntil: 'networkidle' });
  await f.waitForTimeout(1500);
  await toTop(f, f.getByText('Cash refunds to hand out').first(), 20);
  await shot(f, 'p2-79-workbench-cash-refund');
  await f.getByRole('button', { name: 'Release Cash' }).first().click();
  await f.waitForTimeout(600);
  await shot(f, 'p2-80-workbench-release-cash');
  await f.getByRole('button', { name: 'Record Release' }).click();
  await f.waitForTimeout(2000);
  await f.context().close();
  // A second person approves it: the admin, on Balance withdrawals.
  const a = await signIn(ADMIN.email, ADMIN.password);
  await a.goto(`${BASE}/admin/escrow`, { waitUntil: 'networkidle' });
  await a.waitForTimeout(1500);
  await shot(a, 'p2-81-balance-withdrawals');
  await a.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await a.waitForTimeout(2000);
  await shot(a, 'p2-82-balance-withdrawal-approved');
  await a.context().close();
}

if (!ONLY || ONLY === 'admin') {
  const a = await signIn(ADMIN.email, ADMIN.password);
  for (const [path, name] of [
    ['/exams/series', 'p2-83-board-series'],
    ['/exams/services', 'p2-84-board-services'],
    ['/admin/school-fees', 'p2-85-school-fees'],
    [`/admin/sessions/${june.id}#grade10`, 'p2-86-grade-10'],
    ['/students', 'p2-87-students'],
    ['/charges', 'p2-89-charges'],
    ['/takings', 'p2-90-daily-takings'],
    ['/exams/deadlines', 'p2-91-exam-deadlines'],
    ['/notifications', 'p2-92-admin-notifications'],
    ['/profile', 'p2-93-profile'],
  ]) {
    await a.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await a.waitForTimeout(1800);
    await shot(a, name);
    out(`== ${path}\n` + (await mainText(a, 700)));
  }
  // A student's record, from Students.
  await a.goto(`${BASE}/students`, { waitUntil: 'networkidle' });
  await a.waitForTimeout(1500);
  await a.getByText(FAMILIES.desk.student.name, { exact: true }).first().click();
  await a.waitForTimeout(2500);
  await shot(a, 'p2-88-student-record');
  await a.context().close();
}

if (!ONLY || ONLY === 'homes') {
  const c = await signIn(STAFF[0].email, PASSWORD);
  await c.waitForTimeout(1500);
  await shot(c, 'p2-94-coordinator-home');
  await c.context().close();
  const t = await signIn('teacher1@igcse.local', PASSWORD);
  await t.waitForTimeout(1500);
  await shot(t, 'p2-95-teacher-home');
  await t.context().close();
}

if (!ONLY || ONLY === 'family') {
  const p = await signIn(F.parent.email, PASSWORD);
  for (const [path, name] of [
    ['/registrations/history', 'p4-31-history'],
    ['/school-fee', 'p4-32-school-fee'],
    ['/charges-due', 'p4-33-charges-instalments'],
    ['/profile', 'p4-34-profile'],
  ]) {
    await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1800);
    if (path === '/registrations/history') {
      const v = await p.locator('select option', { hasText: F.student.name }).first().getAttribute('value');
      await p.locator('select').first().selectOption(v);
      await p.waitForTimeout(1800);
    }
    await shot(p, name);
    out(`== ${path}\n` + (await mainText(p, 500)));
  }
}
out('errors', errors);
await browser.close();
