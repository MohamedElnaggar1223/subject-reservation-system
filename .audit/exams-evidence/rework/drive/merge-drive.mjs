// The merged system, a smoke drive: F4's screens and the rework's Reserve and To verify, English and Arabic.
// Usage: node merge-drive.mjs <web> <outdir> <sessionId>
import { chromium } from 'playwright-core';
const [WEB, OUT, SESSION] = process.argv.slice(2);
const out = (s) => console.log(s);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function open(email, password, lang, width = 1366) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 1500 : 1800 } });
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
const go = async (page, path) => { await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1800); };
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 55, fullPage: true }); out('shot ' + name); };
for (const lang of ['en', 'ar']) {
  const coord = await open('coord.nadia@igcse.local', 'TestPass1', lang);
  for (const [path, name] of [['/exams/entries', 'entries'], ['/exams/entry-lists', 'entry-lists'], [`/admin/sessions/${SESSION}#verify`, 'to-verify'], ['/messages', 'messages']]) {
    await go(coord, path);
    if (name === 'to-verify') { const t = coord.getByRole('tab', { name: lang === 'en' ? /to verify/i : /للتحقق/ }).first(); if (await t.count()) { await t.click(); await coord.waitForTimeout(1200); } }
    await shot(coord, `merge-${name}-${lang}`);
    const text = (await coord.locator('main').innerText().catch(() => '')).slice(0, 300).replace(/\n+/g, ' | ');
    out(`${name} ${lang}: ${text}`);
  }
  await coord.context().close();
  const parent = await open('parent.ziad.fouad@igcse.local', 'TestPass1', lang, 390);
  await go(parent, '/register');
  await shot(parent, `merge-reserve-${lang}`);
  await parent.context().close();
}
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
