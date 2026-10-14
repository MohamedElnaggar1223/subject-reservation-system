// The review of 093dbd1, item 3: the To verify tab's check, with a declared sitting awaiting an answer
// that has no result on record (a desk reservation of a P1 retake, not paid), in English and Arabic.
// Usage: node review-drive2.mjs <api> <web> <outdir> <sessionId> <p1ItemId> <studentId>
import { chromium } from 'playwright-core';
const [API, WEB, OUT, SESSION, P1, STUDENT] = process.argv.slice(2);
const out = (s) => console.log(s);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function open(email, password, lang, width = 1366) {
  const ctx = await browser.newContext({ viewport: { width, height: 2000 } });
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
{
  const officer = await open('officer.mona@igcse.local', 'TestPass1', 'en');
  const r = await officer.request.post(`${API}/v1/registrations/desk`, {
    headers: { Origin: WEB },
    data: { studentId: STUDENT, sessionId: SESSION, lines: [{ offerItemId: P1, attempt: 'retake', mode: 'in_school', priorSitting: { month: 'june', year: 2026 } }], consent: { refundPolicy: true, declaration: true } },
  });
  out(`desk reservation (declared P1 retake, June 2026): ${r.status()} ${(await r.text()).slice(0, 160)}`);
  await officer.context().close();
}
for (const lang of ['en', 'ar']) {
  const coord = await open('coord.nadia@igcse.local', 'TestPass1', lang);
  await coord.goto(`${WEB}/admin/sessions/${SESSION}#verify`, { waitUntil: 'networkidle' });
  await coord.waitForTimeout(1800);
  const tab = coord.getByRole('tab', { name: lang === 'en' ? /to verify/i : /للتحقق/ }).first();
  if (await tab.count()) { await tab.click(); await coord.waitForTimeout(1500); }
  const check = coord.getByRole('button', { name: lang === 'en' ? /check against the results on record/i : /طابِق مع النتائج المسجلة/ }).first();
  out(`check button (${lang}): ${await check.count()}`);
  if (await check.count()) { await check.click(); await coord.waitForTimeout(2500); }
  await coord.screenshot({ path: `${OUT}/review-to-verify-checked-none-${lang}.jpg`, type: 'jpeg', quality: 60, fullPage: true });
  out(`shot review-to-verify-checked-none-${lang}`);
  const t = (await coord.locator('main').innerText().catch(() => '')).slice(0, 2200);
  out(`TO VERIFY ${lang}:\n${t}\n`);
  await coord.context().close();
}
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
