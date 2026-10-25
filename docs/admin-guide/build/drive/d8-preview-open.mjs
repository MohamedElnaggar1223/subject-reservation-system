// Chapters 13-15: the family's form previewed beside the school's; Home before opening; Open now; the reminders; Home after.
import { BASE, signIn, shot, out, browser, report, mainText, mark, unmark, toTop, settingCard } from './lib.mjs';
import { ADMIN } from './data.mjs';

const ONLY = process.env.ONLY;
const page = await signIn(ADMIN.email, ADMIN.password);
await page.goto(`${BASE}/admin/sessions`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const sessionUrl = await page.locator('a', { hasText: 'June 2027' }).first().getAttribute('href');
const re = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

if (!ONLY || ONLY === 'preview') {
  await page.goto(`${BASE}${sessionUrl}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  let first = true;
  for (const [subject, name] of [['Biology', 'preview-biology'], ['Arabic A.L.', 'preview-arabic-al'], ['Computer Science A.S./A.L.', 'preview-cs-asal'], ['Mathematics A.S./A.L.', 'preview-ial-maths'], ['Physics A.S./A.L.', 'preview-physics-asal']]) {
    const row = page.locator('tr', { has: page.locator('td', { hasText: new RegExp(`^${re(subject)}`) }) }).first();
    await toTop(page, row, 140);
    const link = row.getByRole('button', { name: "Preview the family's form" });
    if (first) { await mark(page, link); await shot(page, 'preview-link'); await unmark(page); first = false; }
    await link.click();
    const dlg = page.getByRole('dialog', { name: "The family's form" });
    await dlg.waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await shot(page, name);
    out(`== ${subject}\n` + (await dlg.innerText()).slice(0, 1800));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

if (!ONLY || ONLY === 'open') {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'home-before-opening');
  out(await mainText(page, 2000));
  await page.goto(`${BASE}${sessionUrl}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await mark(page, page.getByRole('button', { name: 'Open now' }).first());
  await shot(page, 'open-now-button');
  await unmark(page);
  await page.getByRole('button', { name: 'Open now' }).first().click();
  const modal = page.getByRole('dialog', { name: 'Open this session now' });
  await mark(page, modal.getByRole('button', { name: 'Open now' }));
  await shot(page, 'open-now-dialog');
  await unmark(page);
  await modal.getByRole('button', { name: 'Open now' }).click();
  await page.waitForTimeout(2500);
  await shot(page, 'session-open');
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const card = settingCard(page, 'Send reminders automatically');
  await toTop(page, card, 70);
  await card.getByRole('button', { name: 'Change' }).click();
  await card.locator('label', { hasText: /^On$/ }).first().click();
  await card.locator('textarea').fill('June 2027 is open: its sheet and fees are checked');
  await mark(page, card.getByRole('button', { name: 'Save change' }));
  await shot(page, 'reminders-on');
  await unmark(page);
  await card.getByRole('button', { name: 'Save change' }).click();
  await page.waitForTimeout(1500);
  await toTop(page, settingCard(page, 'Send reminders automatically'), 70);
  await shot(page, 'reminders-saved');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'home-open');
  out(await mainText(page, 2000));
}
report();
await browser.close();
