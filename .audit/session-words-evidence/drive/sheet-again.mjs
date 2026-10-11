// The links sheet again (EN, AR) after the column became "Entry options".
import { BASE, browser, errors, out, signIn, shot } from './lib.mjs';
const JUNE = '0f1fecbd-152b-4f1b-9bec-701bd03fd6b9';
for (const [email, password, who] of [['admin@igcse.local', 'AdminPass1', ''], ['coordinator.words@igcse.local', 'TestPass1', '15-coordinator-']]) {
  for (const lang of ['en', 'ar']) {
    const page = await signIn(email, password, lang);
    await page.goto(`${BASE}/admin/sessions/${JUNE}#subjects`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await shot(page, who ? `after-${who}sheet-${lang}` : `after-01-sheet-${lang}`);
    await page.context().close();
  }
}
out('ERRORS:', errors.filter((e) => !/Hydration/.test(e)).join('\n') || 'none');
await browser.close();
