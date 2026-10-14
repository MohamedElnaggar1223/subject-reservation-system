// F4: the held state (verification.unverifiedAtDeadline = hold) and the hand entry of a cash-in, EN and AR.
import { chromium } from 'playwright-core';
const [API, WEB, OUT, CAM, PEA] = process.argv.slice(2);
const out = (s) => console.log(s);

async function cookieOf(email, password) {
  const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: WEB }, body: JSON.stringify({ email, password }) });
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
}
const admin = await cookieOf('admin@igcse.local', 'AdminPass1');
const setting = async (value) => {
  const r = await fetch(`${API}/v1/settings/verification.unverifiedAtDeadline`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: admin, Origin: WEB },
    body: JSON.stringify({ value, reason: value === 'hold' ? 'screens: the school holds unverified sittings (Q-22)' : 'screens done: back to the default' }),
  });
  out(`setting ${value}: ${r.status}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function open(lang) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 2300 } });
  await ctx.addInitScript((l) => { try { window.localStorage.setItem('language', l); } catch {} }, lang);
  const page = await ctx.newPage();
  await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', 'coord.nadia@igcse.local');
  await page.fill('input[type=password], input[name=password]', 'TestPass1');
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 30000 }).catch(() => {}), page.getByRole('button', { name: /^(sign in|تسجيل الدخول)$/i }).click()]);
  await page.waitForTimeout(1500);
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 62, fullPage: true }); out('shot ' + name); };
const go = async (page, path) => { await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); };
const preview = async (page, lang) => {
  await page.getByRole('button', { name: lang === 'en' ? /^preview$/i : /معاينة/ }).first().click();
  await page.waitForTimeout(1800);
  const box = page.getByRole('checkbox').first();
  if (await box.isChecked().catch(() => false)) await box.uncheck();
  await page.waitForTimeout(400);
};

try {
  await setting('hold');
  for (const lang of ['en', 'ar']) {
    const p = await open(lang);
    await go(p, `/exams/entries?series=${PEA}`); await preview(p, lang); await shot(p, `held-derive-pearson-${lang}`);
    if (lang === 'en') out((await p.locator('main').innerText()).split('Derive entries')[1]?.slice(0, 1600) ?? '');
    await go(p, `/exams/entry-lists?series=${PEA}`); await shot(p, `held-entrylist-pearson-${lang}`);
    await p.context().close();
  }
} finally {
  await setting('enter_as_declared');
}

// The cash-in that names no line, added by hand with its charge (English), then the entry seen in both languages.
const p = await open('en');
await go(p, `/exams/entries?series=${PEA}`);
await p.getByRole('button', { name: /^add an entry$/i }).first().click();
await p.waitForTimeout(800);
const cand = p.locator('#add-candidate');
const opts = await cand.locator('option').allInnerTexts();
await cand.selectOption({ index: opts.findIndex((o) => o.includes('Ziad')) });
await p.waitForTimeout(600);
const award = p.locator('#add-item');
const aopts = await award.locator('option').allInnerTexts();
await award.selectOption({ index: aopts.findIndex((o) => o.startsWith('XMA01')) });
await p.waitForTimeout(500);
await p.locator('#add-charge').selectOption({ index: 1 });
await p.getByRole('button', { name: /^add the entry$/i }).click();
await p.waitForTimeout(2000);
await shot(p, 'entries-cashin-added-en');
out('ADDED: ' + (await p.locator('main').innerText()).split('Add an entry by hand')[1]?.slice(0, 400));
await p.context().close();
const a = await open('ar');
await go(a, `/exams/entries?series=${PEA}`); await shot(a, 'entries-cashin-added-ar');
await a.context().close();
for (const lang of ['en', 'ar']) {
  const c = await open(lang);
  await go(c, `/exams/entries?series=${CAM}`); await preview(c, lang); await shot(c, `entries-derive-cambridge-cf-${lang}`);
  await c.context().close();
}
await browser.close();
