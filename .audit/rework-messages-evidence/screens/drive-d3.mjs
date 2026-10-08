// Agent D, after the review of 5c2f2bf: the Money tab's Remind under the Overdue filter and under All
// (the overdue and the due texts per line), English and Arabic; the Reminders tab's Arabic counts.
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3130';
const EV = process.env.EV;
const SESSION = process.env.SESSION;
const out = (s) => console.log(s);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function signIn(lang) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1100 } });
  await ctx.addInitScript((l) => { try { window.localStorage.setItem('language', l); } catch {} }, lang);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/Hydration/.test(e.message)) errors.push(`${lang} pageerror: ` + e.message.slice(0, 160)); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${lang} http ${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', 'officer.mona@igcse.local');
  await page.fill('input[type=password], input[name=password]', 'TestPass1');
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.getByRole('button', { name: /^(sign in|تسجيل الدخول)$/i }).click()]);
  await page.waitForTimeout(1000);
  return page;
}
for (const lang of ['en', 'ar']) {
  const page = await signIn(lang);
  await page.goto(`${BASE}/admin/sessions/${SESSION}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.getByRole('tab').nth(2).click().catch(() => {});
  const tabs = await page.getByRole('tab').allInnerTexts();
  out(`${lang} tabs: ${tabs.join(' | ')}`);
  const money = page.getByRole('tab', { name: /^(Money|المال|الأموال|المدفوعات)/ });
  if (await money.count()) await money.first().click();
  await page.waitForTimeout(1500);
  // The Overdue filter, then Remind.
  const overdueBtn = page.locator('main [role=group] button').nth(2);
  await overdueBtn.click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: lang === 'en' ? 'Remind' : 'تذكير', exact: true }).click();
  const dlg = page.locator('[role=dialog]');
  await dlg.locator('ul, [role=status]').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await dlg.screenshot({ path: `${EV}/screens/d-15-remind-overdue-${lang}.png` });
  out(`${lang} OVERDUE:\n` + (await dlg.innerText()).slice(0, 900));
  await dlg.getByRole('button').first().click();
  // All lines: the overdue and the not-yet-due parts.
  await page.locator('main [role=group] button').nth(0).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: lang === 'en' ? 'Remind' : 'تذكير', exact: true }).click();
  await dlg.locator('ul').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await dlg.screenshot({ path: `${EV}/screens/d-16-remind-all-${lang}.png` });
  out(`${lang} ALL:\n` + (await dlg.innerText()).slice(0, 900));
  await page.context().close();
}
// The admin's Reminders tab, Arabic: the counts.
{
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1100 } });
  await ctx.addInitScript(() => { try { window.localStorage.setItem('language', 'ar'); } catch {} });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', 'admin@igcse.local');
  await page.fill('input[type=password], input[name=password]', 'AdminPass1');
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.getByRole('button', { name: /^(sign in|تسجيل الدخول)$/i }).click()]);
  await page.goto(`${BASE}/admin/messages`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);
  await page.getByRole('tab').nth(2).click();
  await page.waitForTimeout(1800);
  const main = page.locator('main');
  await main.screenshot({ path: `${EV}/screens/d-26-ar-reminders-counts.png` });
  out('AR REMINDERS:\n' + (await main.innerText()).split('\n').filter((l) => /قبل|بعد|كل|يوم/.test(l)).slice(0, 12).join('\n'));
  await ctx.close();
}
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
