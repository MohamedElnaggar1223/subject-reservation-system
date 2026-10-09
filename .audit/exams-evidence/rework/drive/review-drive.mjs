// The review of 093dbd1, item 10: the rework's Reserve, statement and To verify screens driven once
// more in English and Arabic (F4's Arabic now loads after theirs), and F4's new states.
// Usage: node review-drive.mjs <api> <web> <outdir> <sessionId> <pearsonSeries> <ziadLine>
import { chromium } from 'playwright-core';
const [API, WEB, OUT, SESSION, PEA, ZIAD] = process.argv.slice(2);
const out = (s) => console.log(s);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];

async function open(email, password, lang, width = 1366) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 1500 : 2000 } });
  await ctx.addInitScript((l) => { try { window.localStorage.setItem('language', l); } catch {} }, lang);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/Hydration|hydrat/i.test(e.message)) errors.push(`${email} ${lang} pageerror: ` + e.message.slice(0, 160)); });
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`${email} ${lang} http ${r.status()} ${r.url().replace(API, '').replace(WEB, '')}`); });
  await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 30000 }).catch(() => {}), page.getByRole('button', { name: /^(sign in|تسجيل الدخول)$/i }).click()]);
  await page.waitForTimeout(1500);
  return page;
}
const shot = async (page, name) => {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 60, fullPage: true });
  out('shot ' + name);
};
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 240)); } };
const text = async (page, n = 1800) => (await page.locator('main').innerText().catch(() => '')).slice(0, n);
const go = async (page, path) => { await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1800); };
/** Latin words left on an Arabic page (codes, names and the boards' terms are data and stay). */
const latin = (t) => [...new Set((t.match(/[A-Za-z][A-Za-z'’-]{3,}(?: [A-Za-z][A-Za-z'’-]+)*/g) ?? []))].slice(0, 40).join(' | ');

async function rework(lang, stage) {
  const parent = await open('parent.ziad.fouad@igcse.local', 'TestPass1', lang, 390);
  await step(`reserve-${lang}`, async () => {
    await go(parent, `/register`);
    await shot(parent, `review-reserve-${lang}`);
    const t = await text(parent, 2500);
    out(`RESERVE ${lang}:\n${t}\n`);
    if (lang === 'ar') out('LATIN LEFT (reserve): ' + latin(t));
  });
  await step(`statement-${lang}`, async () => {
    await go(parent, `/statement`);
    await shot(parent, `review-statement-${lang}`);
    const t = await text(parent, 2500);
    out(`STATEMENT ${lang}:\n${t}\n`);
    if (lang === 'ar') out('LATIN LEFT (statement): ' + latin(t));
  });
  await parent.context().close();

  const coord = await open('coord.nadia@igcse.local', 'TestPass1', lang);
  await step(`to-verify-${lang}`, async () => {
    await go(coord, `/admin/sessions/${SESSION}#verify`);
    const tab = coord.getByRole('tab', { name: lang === 'en' ? /to verify/i : /للتحقق/ }).first();
    if (await tab.count()) { await tab.click(); await coord.waitForTimeout(1500); }
    await shot(coord, `review-to-verify-${stage}-${lang}`);
    const check = coord.getByRole('button', { name: lang === 'en' ? /check against the results on record/i : /طابِق مع النتائج المسجلة/ }).first();
    out(`check button (${lang}): ${await check.count()}`);
    if (await check.count()) {
      await check.click();
      await coord.waitForTimeout(2500);
      await shot(coord, `review-to-verify-${stage}-checked-${lang}`);
    }
    const t = await text(coord, 2500);
    out(`TO VERIFY ${lang}:\n${t}\n`);
    if (lang === 'ar') out('LATIN LEFT (to verify): ' + latin(t));
  });
  return coord;
}

for (const lang of ['en', 'ar']) {
  const coord = await rework(lang, 'before');
  await coord.context().close();
}

// The coordinator could not confirm Ziad's declared June sitting after his retake entry was sent:
// the line stands as a first entry and the sent entry is flagged (item 2).
{
  const coord = await open('coord.nadia@igcse.local', 'TestPass1', 'en');
  const r = await coord.request.post(`${API}/v1/registrations/${ZIAD}/verify-prior`, {
    headers: { Origin: WEB },
    data: { outcome: 'rejected', reason: 'no such sitting on the board statement (demo, the review drive)' },
  });
  out(`reject Ziad's declaration: ${r.status()} ${(await r.text()).slice(0, 200)}`);
  await coord.context().close();
}

for (const lang of ['en', 'ar']) {
  const coord = await open('coord.nadia@igcse.local', 'TestPass1', lang);
  await step(`entry-list-${lang}`, async () => {
    await go(coord, `/exams/entry-lists?series=${PEA}`);
    await shot(coord, `review-entrylist-retake-differs-${lang}`);
    const t = await text(coord, 4000);
    out(`ENTRY LIST ${lang}:\n${t}\n`);
    if (lang === 'ar') out('LATIN LEFT (entry list): ' + latin(t));
  });
  await step(`derive-${lang}`, async () => {
    await go(coord, `/exams/entries?series=${PEA}`);
    await coord.getByRole('button', { name: lang === 'en' ? /^preview$/i : /معاينة/ }).first().click();
    await coord.waitForTimeout(2000);
    await shot(coord, `review-derive-pearson-${lang}`);
    const t = await text(coord, 3500);
    out(`DERIVE ${lang}:\n${t}\n`);
    if (lang === 'ar') out('LATIN LEFT (derive): ' + latin(t));
  });
  await coord.context().close();
}
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
