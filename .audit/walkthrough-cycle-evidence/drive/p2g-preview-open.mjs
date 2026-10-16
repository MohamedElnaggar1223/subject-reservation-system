// Part 2: "Preview the family's form" on a subject, held next to the school's form; the admin's Home
// before opening; "Open now"; the reminders turned on.
import { signIn, BASE, shot, out, errors, browser, apiAs, settingCard, toTop, mainText } from './lib.mjs';
import { ADMIN } from './cycle-data.mjs';

const ONLY = process.env.ONLY;
const admin = await apiAs(ADMIN.email, ADMIN.password);
const june = (await admin('GET', '/v1/sessions')).find((s) => s.name === 'June 2027');
const page = await signIn(ADMIN.email, ADMIN.password);

if (!ONLY || ONLY === 'preview') {
  await page.goto(`${BASE}/admin/sessions/${june.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  for (const [subject, name] of [['Biology', 'p2-30-preview-biology'], ['Mathematics A.S./A.L.', 'p2-31-preview-ial-maths'], ['Physics A.S./A.L.', 'p2-32-preview-physics-al']]) {
    const row = page.locator('tr', { has: page.locator('td', { hasText: new RegExp(`^${subject.replace(/[./]/g, (c) => `\\${c}`)}\\s*Preview`) }) }).first();
    await toTop(page, row, 120);
    await row.getByRole('button', { name: "Preview the family's form" }).click().catch(async () => row.getByText("Preview the family's form").click());
    await page.getByRole('dialog', { name: "The family's form" }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(1200);
    await shot(page, name);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

if (!ONLY || ONLY === 'open') {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'p2-33-home-before-opening');
  out(await mainText(page, 1500));
  await page.goto(`${BASE}/admin/sessions/${june.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Open now' }).first().click();
  const modal = page.getByRole('dialog', { name: 'Open this session now' });
  await shot(page, 'p2-34-open-now');
  await modal.getByRole('button', { name: 'Open now' }).click();
  await page.waitForTimeout(2000);
  await shot(page, 'p2-35-session-open');
  // The reminders: off when the system is installed; on once the session and its fees are checked.
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const card = settingCard(page, 'Send reminders automatically');
  await toTop(page, card, 70);
  await card.getByRole('button', { name: 'Change' }).click();
  await card.locator('label', { hasText: 'On' }).first().click();
  await card.locator('textarea').fill('June 2027 is open: its sheet and fees are checked');
  await shot(page, 'p2-36-reminders-on');
  await card.getByRole('button', { name: 'Save change' }).click();
  await page.waitForTimeout(1500);
}
out('errors', errors);
await browser.close();
