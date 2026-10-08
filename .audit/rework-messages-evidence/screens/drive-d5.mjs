// Agent D, the follow-ups of 9e7a4d6..9037be2: the Money tab's Remind under the tab's Overdue filter
// (the tab's whole-day rule: the dialog lists exactly the families the tab lists) and under All (the
// due instant: a line due within the last day is overdue there); the overdue text naming each item
// with its date. Nothing is sent. English and Arabic.
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3130';
const EV = process.env.EV;
const SESSION = process.env.SESSION;
const out = (s) => console.log(s);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
for (const lang of ['en', 'ar']) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1200 } });
  await ctx.addInitScript((l) => { try { window.localStorage.setItem('language', l); } catch {} }, lang);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/Hydration/.test(e.message)) errors.push(`${lang} pageerror: ` + e.message.slice(0, 160)); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${lang} http ${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', 'officer.mona@igcse.local');
  await page.fill('input[type=password], input[name=password]', 'TestPass1');
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.getByRole('button', { name: /^(sign in|تسجيل الدخول)$/i }).click()]);
  await page.waitForTimeout(800);
  await page.goto(`${BASE}/admin/sessions/${SESSION}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const money = page.getByRole('tab', { name: /^(Money|المال|الأموال|المدفوعات)/ });
  if (await money.count()) await money.first().click();
  await page.waitForTimeout(1500);
  for (const [i, name] of [[2, 'overdue'], [0, 'all']]) {
    await page.locator('main [role=group] button').nth(i).click();
    await page.waitForTimeout(1500);
    const rows = await page.locator('main table tbody tr').allInnerTexts();
    out(`${lang} TAB ${name}: ` + rows.map((r) => r.split('\n')[0]).join(' | '));
    await page.getByRole('button', { name: lang === 'en' ? 'Remind' : 'تذكير', exact: true }).click();
    const dlg = page.locator('[role=dialog]');
    await dlg.locator('ul, [role=status]').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(1200);
    await dlg.screenshot({ path: `${EV}/screens/d-19-remind-${name}-${lang}.png` });
    const text = await dlg.innerText();
    out(`${lang} DIALOG ${name}:\n` + text.split('\n').filter((l) => l.trim()).slice(0, 18).join('\n'));
    await dlg.getByRole('button', { name: lang === 'en' ? 'Cancel' : 'إلغاء' }).click();
    await page.waitForTimeout(500);
  }
  await ctx.close();
}
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
