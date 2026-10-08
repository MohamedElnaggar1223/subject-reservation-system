// Agent D, after the review of 9e7a4d6: (item 2) Settings > Reminders in English and Arabic, element
// screenshots; (item 4) the Money tab's Remind under All with the second POST /v1/messages failed once
// (the network drops it): the dialog says what went, "Send the rest" sends only the other part. Each
// part's POSTs are counted from their bodies; the families' reminders are counted in the database by
// the shell around this script.
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3130';
const EV = process.env.EV;
const SESSION = process.env.SESSION;
const LANGS = (process.env.LANGS ?? 'en,ar').split(',');
const out = (s) => console.log(s);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];

async function signIn(lang, email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 1200 } });
  await ctx.addInitScript((l) => { try { window.localStorage.setItem('language', l); } catch {} }, lang);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/Hydration/.test(e.message)) errors.push(`${lang} pageerror: ` + e.message.slice(0, 160)); });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.getByRole('button', { name: /^(sign in|تسجيل الدخول)$/i }).click()]);
  await page.waitForTimeout(800);
  return page;
}

if (process.env.PART !== 'remind') {
  for (const lang of LANGS) {
    const page = await signIn(lang, 'admin@igcse.local', 'AdminPass1');
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const section = page.locator('section', { has: page.locator('#group-reminders') });
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: `${EV}/screens/d-14-settings-reminders-${lang}.png` });
    out(`SETTINGS ${lang}:\n` + (await section.innerText()).slice(0, 1400));
    await page.context().close();
  }
}

if (process.env.PART !== 'settings') {
  for (const lang of LANGS) {
    const page = await signIn(lang, 'officer.mona@igcse.local', 'TestPass1');
    // Every POST /v1/messages, by its part (the body's filter); the second one is dropped once.
    const posts = [];
    let dropped = false;
    await page.route((u) => new URL(u).pathname === '/v1/messages', async (route) => {
      const req = route.request();
      if (req.method() !== 'POST') return route.continue();
      const part = JSON.parse(req.postData() ?? '{}')?.audience?.definition?.filter ?? '?';
      const n = posts.push({ part, outcome: '' });
      if (n === 2 && !dropped) { dropped = true; posts[n - 1].outcome = 'dropped'; return route.abort('failed'); }
      const res = await route.fetch();
      posts[n - 1].outcome = String(res.status());
      return route.fulfill({ response: res });
    });
    await page.goto(`${BASE}/admin/sessions/${SESSION}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const money = page.getByRole('tab', { name: /^(Money|المال|الأموال|المدفوعات)/ });
    if (await money.count()) await money.first().click();
    await page.waitForTimeout(1500);
    await page.locator('main [role=group] button').nth(0).click(); // All
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: lang === 'en' ? 'Remind' : 'تذكير', exact: true }).click();
    const dlg = page.locator('[role=dialog]');
    await dlg.locator('ul').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(1200);
    const sendBtn = dlg.getByRole('button').last();
    out(`${lang} BEFORE: button "${await sendBtn.innerText()}"`);
    await sendBtn.click();
    const rest = lang === 'en' ? 'Send the rest' : 'إرسال الباقي';
    await dlg.getByRole('button', { name: rest }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await dlg.screenshot({ path: `${EV}/screens/d-17-remind-partial-${lang}.png` });
    const partial = await dlg.innerText();
    out(`${lang} PARTIAL:\n` + partial.split('\n').filter((l) => /sent|Sending|fetch|أُرسل|الإرسال|الباقي|Failed/i.test(l)).join('\n'));
    out(`${lang} ticks disabled: ${await dlg.locator('ul input[type=checkbox]').first().isDisabled()}`);
    await dlg.getByRole('button', { name: rest }).click();
    await dlg.getByRole('button', { name: lang === 'en' ? 'Close' : /إغلاق/ }).waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await dlg.screenshot({ path: `${EV}/screens/d-18-remind-rest-${lang}.png` });
    out(`${lang} DONE:\n` + (await dlg.innerText()).split('\n').filter((l) => /Sent to|أُرسلت|Messages|الرسائل/.test(l)).join('\n'));
    out(`${lang} POSTS: ${JSON.stringify(posts)}`);
    const count = (p) => posts.filter((x) => x.part === p && x.outcome === '201' || x.part === p && x.outcome === '200').length;
    out(`${lang} delivered POSTs per part: overdue ${count('overdue')}, due ${count('due')}; dropped ${posts.filter((x) => x.outcome === 'dropped').map((x) => x.part).join(',')}`);
    await page.context().close();
  }
}
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
