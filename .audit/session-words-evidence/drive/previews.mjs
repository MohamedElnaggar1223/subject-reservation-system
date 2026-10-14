// "Preview the family's form" for the six shapes, EN and AR (admin), after the preview was widened.
import { BASE, browser, errors, out, signIn, shot, step } from './lib.mjs';
const JUNE = '0f1fecbd-152b-4f1b-9bec-701bd03fd6b9';
const shapes = [['Arabic Language', 'ol'], [/^Biology$/, 'ol-one-paper'], [/^Chemistry$/, 'retake-self-study'], ['Mathematics A.S./A.L.', 'ial'], ['Physics A.S./A.L.', 'a-level'], ['Arabic A.L.', 'arabic-al']];
const texts = {};
for (const lang of ['en', 'ar']) {
  const page = await signIn('admin@igcse.local', 'AdminPass1', lang);
  await page.goto(`${BASE}/admin/sessions/${JUNE}#subjects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  for (const [subject, name] of shapes) {
    await step(`${name} ${lang}`, async () => {
      await page.locator('tr', { has: page.locator('button', { hasText: subject }) }).first().locator('button', { hasText: /Preview the family's form|معاينة نموذج الأسرة/ }).click();
      await page.waitForTimeout(2200);
      await shot(page, `after-09-preview-${name}-${lang}`, { full: false });
      if (lang === 'en') texts[name] = (await page.locator('[role=dialog]').last().innerText()).replace(/\n+/g, ' | ').slice(0, 900);
      for (let i = 0; i < 2; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
    });
  }
  await page.context().close();
}
out(JSON.stringify(texts, null, 1));
out('ERRORS:', errors.filter((e) => !/Hydration/.test(e)).join('\n') || 'none');
await browser.close();
