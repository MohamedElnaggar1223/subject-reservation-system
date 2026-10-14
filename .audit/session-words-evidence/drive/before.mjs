// F6a "before" shots: main 1b6a216's web files on the same running API and data (EN and AR).
import { BASE, browser, errors, out, signIn, setLang, shot, step, mainText } from './lib.mjs';
const JUNE = '0f1fecbd-152b-4f1b-9bec-701bd03fd6b9';
const JUNE28 = '51b42a30-3cec-4c8b-a15e-9e067875312b';

for (const lang of ['en', 'ar']) {
  const page = await signIn('admin@igcse.local', 'AdminPass1', lang);
  await step(`sheet ${lang}`, async () => {
    await page.goto(`${BASE}/admin/sessions/${JUNE}#subjects`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await shot(page, `before-01-sheet-${lang}`);
  });
  await step(`drawer biology ${lang}`, async () => {
    await page.locator('table button', { hasText: /^Biology$/ }).first().click();
    await page.waitForTimeout(1200);
    await shot(page, `before-02-drawer-biology-${lang}`, { full: false });
    await page.keyboard.press('Escape');
  });
  await step(`drawer ial ${lang}`, async () => {
    await page.locator('table button', { hasText: /Mathematics A\.S\./ }).first().click();
    await page.waitForTimeout(1200);
    await shot(page, `before-03-drawer-ial-${lang}`, { full: false });
    await page.keyboard.press('Escape');
  });
  await step(`add subject ${lang}`, async () => {
    await page.getByRole('button', { name: /^(Add subject|إضافة مادة)$/ }).first().click();
    await page.waitForTimeout(1000);
    await shot(page, `before-04-add-subject-${lang}`, { full: false });
    await page.keyboard.press('Escape');
  });
  await step(`empty ${lang}`, async () => {
    await page.goto(`${BASE}/admin/sessions/${JUNE28}#subjects`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await shot(page, `before-05-empty-${lang}`);
  });
  await step(`series dates ${lang}`, async () => {
    await page.goto(`${BASE}/exams/series`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const row = page.locator('tbody tr', { hasText: /June/ }).first();
    await row.getByRole('button').first().click();
    await page.waitForTimeout(800);
    // Change the deadline so the reason field shows.
    const dl = page.locator('input[type=datetime-local]').first();
    await dl.fill('2027-02-20T12:00');
    await page.waitForTimeout(500);
    await shot(page, `before-06-series-dates-${lang}`);
  });
  await page.context().close();
}

// The family's Reserve page: one child, one open session and one upcoming.
for (const lang of ['en', 'ar']) {
  const page = await signIn('parent.hany@igcse.local', 'TestPass1', lang);
  await step(`register ${lang}`, async () => {
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const sels = page.locator('main select');
    out(lang, 'child value:', await sels.nth(0).inputValue(), '| session value:', await sels.nth(1).inputValue(), '| session options:', (await sels.nth(1).locator('option').allInnerTexts()).join(' / '));
    await shot(page, `before-07-register-${lang}`);
  });
  await page.context().close();
}
out('ERRORS:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
