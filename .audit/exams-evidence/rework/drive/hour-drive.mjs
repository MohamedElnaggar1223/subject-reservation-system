// The reminder hour as the Settings screen shows a value the viewer cannot change (the finance
// officer: the hour is the admin's and the finance admin's), English and Arabic.
// Usage: node hour-drive.mjs <web> <outdir>
import { chromium } from 'playwright-core';
const [WEB, OUT] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [email, pw] of [['coord.nadia@igcse.local', 'TestPass1'], ['officer.mona@igcse.local', 'TestPass1']]) {
  for (const lang of ['en', 'ar']) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 1400 } });
    await ctx.addInitScript((l) => { try { window.localStorage.setItem('language', l); } catch {} }, lang);
    const page = await ctx.newPage();
    await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
    await page.fill('input[type=email], input[name=email]', email);
    await page.fill('input[type=password], input[name=password]', pw);
    await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 30000 }).catch(() => {}), page.getByRole('button', { name: /^(sign in|تسجيل الدخول)$/i }).click()]);
    await page.waitForTimeout(1200);
    await page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const text = await page.locator('body').innerText().catch(() => '');
    const lines = text.split('\n').filter((l) => /^\d{2}:00( Cairo time| بتوقيت القاهرة)?$/.test(l.trim()));
    console.log(`${email} ${lang}: ${page.url().replace(WEB, '')} → ${lines.length ? lines.join(' | ') : 'no hour value shown'}`);
    if (lines.length) await page.screenshot({ path: `${OUT}/settings-reminder-hour-${lang}.jpg`, type: 'jpeg', quality: 55, fullPage: true });
    await ctx.close();
  }
}
await browser.close();
