// F4 on the reservations rework: the screens driven in headless Chrome, English and Arabic.
// Usage: node f4-drive.mjs <api> <web> <outdir> <camNov> <pearsonJan> <sessionId> <stage>
import { chromium } from 'playwright-core';
const [API, WEB, OUT, CAM, PEA, SESSION, STAGE = 'all'] = process.argv.slice(2);
const out = (s) => console.log(s);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];

async function open(email, password, lang, width = 1366) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 1500 : 2300 } });
  await ctx.addInitScript((l) => { try { window.localStorage.setItem('language', l); } catch {} }, lang);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email} ${lang} pageerror: ` + e.message.slice(0, 160)));
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`${email} ${lang} http ${r.status()} ${r.url().replace(API, '').replace(WEB, '')}`); });
  await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 30000 }).catch(() => {}), page.getByRole('button', { name: /^(sign in|تسجيل الدخول)$/i }).click()]);
  await page.waitForTimeout(1500);
  return page;
}
const shot = async (page, name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 62, fullPage: true });
  out('shot ' + name);
};
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 240)); } };
const text = async (page, n = 1500) => (await page.locator('main').innerText().catch(() => '')).slice(0, n);
const go = async (page, path) => { await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); };

for (const lang of ['en', 'ar']) {
  const coord = await open('coord.nadia@igcse.local', 'TestPass1', lang);
  if (STAGE === 'all' || STAGE === 'entries') {
    await step(`derive-cambridge-${lang}`, async () => {
      await go(coord, `/exams/entries?series=${CAM}`);
      await coord.getByRole('button', { name: lang === 'en' ? /^preview$/i : /معاينة/ }).first().click();
      await coord.waitForTimeout(1800);
      const box = coord.getByRole('checkbox').first();
      if (await box.isChecked().catch(() => false)) await box.uncheck();
      await shot(coord, `entries-derive-cambridge-${lang}`);
      if (lang === 'en') out('DERIVE CAM:\n' + await text(coord, 2500));
    });
    await step(`derive-pearson-${lang}`, async () => {
      await go(coord, `/exams/entries?series=${PEA}`);
      await coord.getByRole('button', { name: lang === 'en' ? /^preview$/i : /معاينة/ }).first().click();
      await coord.waitForTimeout(1800);
      await shot(coord, `entries-derive-pearson-${lang}`);
      if (lang === 'en') out('DERIVE PEA:\n' + await text(coord, 2500));
    });
    await step(`entry-list-pearson-${lang}`, async () => {
      await go(coord, `/exams/entry-lists?series=${PEA}`);
      await shot(coord, `entrylist-pearson-${lang}`);
      if (lang === 'en') out('LIST PEA:\n' + await text(coord, 3000));
    });
    await step(`entry-list-cambridge-${lang}`, async () => {
      await go(coord, `/exams/entry-lists?series=${CAM}`);
      await shot(coord, `entrylist-cambridge-${lang}`);
      if (lang === 'en') out('LIST CAM:\n' + await text(coord, 3000));
    });
    await step(`add-entry-cashin-${lang}`, async () => {
      await go(coord, `/exams/entries?series=${PEA}`);
      await coord.getByRole('button', { name: lang === 'en' ? /^add an entry$/i : /أضف قيدًا/ }).first().click();
      await coord.waitForTimeout(800);
      const cand = coord.locator('#add-candidate');
      const opts = await cand.locator('option').allInnerTexts();
      const ziad = opts.findIndex((o) => o.includes('Ziad'));
      if (ziad > 0) await cand.selectOption({ index: ziad });
      await coord.waitForTimeout(600);
      const award = coord.locator('#add-item');
      const aopts = await award.locator('option').allInnerTexts();
      const xma = aopts.findIndex((o) => o.startsWith('XMA01'));
      if (xma > 0) await award.selectOption({ index: xma });
      await coord.waitForTimeout(600);
      if (await coord.locator('#add-charge').count()) await coord.locator('#add-charge').selectOption({ index: 1 });
      await shot(coord, `entries-add-cashin-${lang}`);
    });
    await step(`deadlines-${lang}`, async () => {
      await go(coord, '/exams/deadlines');
      await shot(coord, `deadlines-${lang}`);
      if (lang === 'en') out('DEADLINES:\n' + await text(coord, 1500));
    });
    await step(`to-verify-${lang}`, async () => {
      await go(coord, `/admin/sessions/${SESSION}#verify`);
      await coord.waitForTimeout(1200);
      const decided = coord.getByRole('button', { name: lang === 'en' ? /decided|answered/i : /تم|أُجيب/ }).first();
      if (await decided.count()) { await decided.click(); await coord.waitForTimeout(1200); }
      await shot(coord, `to-verify-${lang}`);
      if (lang === 'en') out('TO VERIFY:\n' + await text(coord, 2000));
    });
  }
  await coord.context().close();

  if (STAGE === 'all' || STAGE === 'family') {
    const parent = await open('parent.hana.ibrahim@igcse.local', 'TestPass1', lang, 390);
    await step(`family-refund-${lang}`, async () => {
      await go(parent, '/registrations');
      const drop = parent.getByRole('button', { name: /^(drop|إسقاط|حذف)$/i });
      out(`drop buttons ${lang}: ${await drop.count()}`);
      if (await drop.count()) {
        await drop.nth(1).click().catch(async () => drop.first().click());
        await parent.waitForTimeout(1800);
      }
      await shot(parent, `family-refund-preview-${lang}`);
      if (lang === 'en') out('FAMILY:\n' + (await parent.locator('body').innerText()).slice(0, 2000));
    });
    await parent.context().close();
  }
}
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
