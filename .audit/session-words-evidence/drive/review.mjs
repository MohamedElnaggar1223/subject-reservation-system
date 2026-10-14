// F6a review round: the screens this round changed, EN and AR, and the like-for-like dates measurement.
import { BASE, browser, errors, out, signIn, shot, step, mainText } from './lib.mjs';
const JUNE = '0f1fecbd-152b-4f1b-9bec-701bd03fd6b9';
const JUNE28 = '51b42a30-3cec-4c8b-a15e-9e067875312b';
const drawerOf = (page) => page.locator('[role=dialog]').last();
const closeAll = async (page) => { for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); } };
const counts = {};

// 1. Finding 1 on the screen: Physics (no papers when added) gets Paper 4 from the form; "All papers" and the paper are then one or the other.
{
  const page = await signIn('admin@igcse.local', 'AdminPass1', 'en');
  await page.goto(`${BASE}/admin/sessions/${JUNE}#subjects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await step('physics paper', async () => {
    await page.locator('table button', { hasText: /^Physics$/ }).first().click();
    await page.waitForTimeout(1500);
    const d = drawerOf(page);
    const line = d.locator('div.grid', { hasText: 'Paper 4' }).first();
    out('paper 4 choices:', (await line.locator('select option').allInnerTexts()).join(' / '));
    await line.locator('select').selectOption({ label: 'Retake in school or self study' });
    await line.locator('input[type=number]').fill('3500');
    await d.locator('div.overflow-y-auto').first().evaluate((e) => { e.scrollTop = e.scrollHeight / 2; });
    await shot(page, 'review-01-physics-paper-later-en', { full: false });
    await d.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(2000);
    out('saved:', (await d.innerText()).split('\n').slice(0, 3).join(' | '));
    await closeAll(page);
  });
  // 2. "Correct the sitting" on the header, and its dialog.
  await step('correct the sitting', async () => {
    await page.getByRole('button', { name: 'Correct the sitting' }).click();
    await page.waitForTimeout(800);
    await shot(page, 'review-02-correct-the-sitting-en', { full: false });
    await closeAll(page);
  });
  // 3. The Fees tab's copy dialog ("an earlier sitting").
  await step('fees copy', async () => {
    await page.goto(`${BASE}/admin/sessions/${JUNE28}#fees`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Copy from…' }).first().click();
    await page.waitForTimeout(800);
    await shot(page, 'review-03-fees-copy-sitting-en', { full: false });
    await closeAll(page);
  });
  // 4. The dates like for like: the same five fields the baseline typed (entry deadline, retakes until,
  //    exams start, exams end, the reason), from June 2028's header, in place.
  await step('dates like for like', async () => {
    await page.goto(`${BASE}/admin/sessions/${JUNE28}#subjects`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const url0 = page.url();
    let inputs = 0, clicks = 0;
    await page.locator('main button', { hasText: /Cambridge International June 2028/ }).first().click(); clicks++;
    await page.waitForTimeout(1500);
    const dlg = page.locator('[role=dialog]').last();
    await dlg.locator('input[type=datetime-local]').nth(0).fill('2028-02-21T12:00'); inputs++;
    await dlg.locator('input[type=datetime-local]').nth(1).fill('2028-03-21T12:00'); inputs++;
    await dlg.locator('input[id^=examsStart-]').fill('2028-04-27'); inputs++;
    await dlg.locator('input[id^=examsEnd-]').fill('2028-06-14'); inputs++;
    await dlg.locator('input[id^=reason-]').fill('Cambridge June 2028 key dates published'); inputs++;
    await shot(page, 'review-04-dates-like-for-like-en', { full: false });
    await dlg.getByRole('button', { name: 'Save the dates' }).click(); clicks++;
    await page.waitForTimeout(2000);
    counts.seriesDeadlinesLikeForLike = { inputs, clicks, pageChanges: page.url() === url0 ? 0 : 1, header: (await mainText(page, 500)).split('\n').find((l) => /June 2028:/.test(l)) ?? null };
  });
  await page.context().close();
}

// 5. The family: "Subject · papers"; ticking Physics' "All papers" then "Paper 4 only" keeps one.
for (const lang of ['en', 'ar']) {
  const page = await signIn('parent.hany@igcse.local', 'TestPass1', lang);
  await step(`family ${lang}`, async () => {
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const all = page.locator('main input[type=checkbox][aria-label^="Physics: "]').first();
    const paper = page.locator('main input[type=checkbox][aria-label^="Physics: Paper 4"]').first();
    await all.check();
    await page.waitForTimeout(500);
    await paper.check();
    await page.waitForTimeout(800);
    out(lang, 'all papers ticked:', await all.isChecked(), '| paper 4 ticked:', await paper.isChecked());
    await page.locator('tr', { has: page.locator('[aria-label^="Physics: Paper 4"]') }).first().scrollIntoViewIfNeeded();
    await shot(page, `review-05-family-physics-${lang}`, { full: false });
  });
  await page.context().close();
}

// 6. The Arabic screens of this round.
{
  const page = await signIn('admin@igcse.local', 'AdminPass1', 'ar');
  await page.goto(`${BASE}/admin/sessions/${JUNE}#subjects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await step('ar physics form', async () => {
    await page.locator('table button', { hasText: /^Physics$/ }).first().click();
    await page.waitForTimeout(1500);
    await drawerOf(page).locator('div.overflow-y-auto').first().evaluate((e) => { e.scrollTop = e.scrollHeight / 2; });
    await shot(page, 'review-01-physics-paper-later-ar', { full: false });
    await closeAll(page);
  });
  await step('ar preview', async () => {
    await page.locator('tr', { has: page.locator('button', { hasText: /^Physics$/ }) }).first().locator('button', { hasText: /معاينة نموذج الأسرة/ }).click();
    await page.waitForTimeout(2000);
    await shot(page, 'review-06-preview-physics-ar', { full: false });
    await closeAll(page);
  });
  await step('ar correct', async () => {
    await page.locator('main button', { hasText: 'تصحيح الدورة' }).first().click();
    await page.waitForTimeout(800);
    await shot(page, 'review-02-correct-the-sitting-ar', { full: false });
    await closeAll(page);
  });
  await step('ar fees copy', async () => {
    await page.goto(`${BASE}/admin/sessions/${JUNE28}#fees`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.locator('main button', { hasText: /نسخ من/ }).first().click();
    await page.waitForTimeout(800);
    await shot(page, 'review-03-fees-copy-sitting-ar', { full: false });
    await closeAll(page);
  });
  await page.context().close();
}
{
  const page = await signIn('admin@igcse.local', 'AdminPass1', 'en');
  await page.goto(`${BASE}/admin/sessions/${JUNE}#subjects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await step('en preview + sheet', async () => {
    await shot(page, 'review-07-sheet-en');
    out('physics row:', (await page.locator('tr', { has: page.locator('button', { hasText: /^Physics$/ }) }).first().innerText()).replace(/\s+/g, ' '));
    await page.locator('tr', { has: page.locator('button', { hasText: /^Physics$/ }) }).first().locator('button', { hasText: "Preview the family's form" }).click();
    await page.waitForTimeout(2000);
    await shot(page, 'review-06-preview-physics-en', { full: false });
  });
  await page.context().close();
}
out('COUNTS', JSON.stringify(counts));
out('ERRORS:', errors.filter((e) => !/Hydration/.test(e)).join('\n') || 'none');
await browser.close();
