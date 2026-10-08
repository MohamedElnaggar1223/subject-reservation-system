// The lead's two checks on the merged system: (1) a family's own declaration that the school's
// results already show is verified with no person — the To verify tab's Answered list says "The
// results on record", English and Arabic; (2) the Settings screen's reminder hour reads "… Cairo time".
// Usage: node answered-drive.mjs <api> <web> <outdir> <sessionId> <physicsItemId> <studentId>
import { chromium } from 'playwright-core';
const [API, WEB, OUT, SESSION, ITEM, STUDENT] = process.argv.slice(2);
const out = (s) => console.log(s);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function open(email, password, lang, width = 1366) {
  const ctx = await browser.newContext({ viewport: { width, height: 1400 } });
  await ctx.addInitScript((l) => { try { window.localStorage.setItem('language', l); } catch {} }, lang);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/Hydration|hydrat/i.test(e.message)) errors.push(`${email} ${lang} pageerror: ` + e.message.slice(0, 160)); });
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`${email} ${lang} http ${r.status()} ${r.url()}`); });
  await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 30000 }).catch(() => {}), page.getByRole('button', { name: /^(sign in|تسجيل الدخول)$/i }).click()]);
  await page.waitForTimeout(1500);
  return page;
}
// (1) The parent reserves Physics in the app as a retake of June 2026, which the school's results show.
{
  const parent = await open('parent.hana.ibrahim@igcse.local', 'TestPass1', 'en');
  const r = await parent.request.post(`${API}/v1/registrations/direct`, {
    headers: { Origin: WEB },
    data: { sessionId: SESSION, studentId: STUDENT, lines: [{ offerItemId: ITEM, attempt: 'retake', mode: 'in_school', priorSitting: { month: 'june', year: 2026 } }], consent: { refundPolicy: true, declaration: true } },
  });
  out(`the parent's own declaration (Physics, a retake of June 2026): ${r.status()} ${(await r.text()).slice(0, 160)}`);
  await parent.context().close();
}
for (const lang of ['en', 'ar']) {
  const coord = await open('coord.nadia@igcse.local', 'TestPass1', lang);
  await coord.goto(`${WEB}/admin/sessions/${SESSION}#verify`, { waitUntil: 'networkidle' });
  await coord.waitForTimeout(1500);
  const tab = coord.getByRole('tab', { name: lang === 'en' ? /to verify/i : /للتحقق/ }).first();
  if (await tab.count()) { await tab.click(); await coord.waitForTimeout(1200); }
  const answered = coord.getByRole('button', { name: lang === 'en' ? /^answered$/i : /تمت الإجابة/ }).first();
  if (await answered.count()) { await answered.click(); await coord.waitForTimeout(1800); }
  await coord.screenshot({ path: `${OUT}/answered-results-on-record-${lang}.jpg`, type: 'jpeg', quality: 60, fullPage: true });
  const text = await coord.locator('main').innerText().catch(() => '');
  out(`ANSWERED ${lang}: ${(lang === 'en' ? /The results on record/ : /النتائج المسجلة/).test(text) ? 'shows the results on record' : 'NOT FOUND'}`);
  out(text.slice(0, 1500));
  await coord.context().close();
  const adm = await open('admin@igcse.local', 'AdminPass1', lang);
  await adm.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
  await adm.waitForTimeout(1800);
  const st = await adm.locator('main').innerText().catch(() => '');
  const hour = st.split('\n').find((l) => /Cairo time|بتوقيت القاهرة/.test(l));
  out(`SETTINGS ${lang}: reminder hour line: ${hour ?? 'NOT FOUND'}`);
  await adm.context().close();
}
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
