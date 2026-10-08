// Lead's step 4 drive, stage 10: the family reserves three subjects on June 2028, one a self-study retake declared with its sitting; count answers; then the statement.
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3000';
const out = (s) => console.log(s);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
let clicks = 0, inputs = 0;
async function signIn(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email} pageerror: ` + e.message.slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${email} console: ` + m.text().slice(0, 160)); });
  page.on('response', async (r) => { if (r.status() >= 400 && r.request().method() !== 'GET') { let body = ''; try { body = (await r.text()).slice(0, 300); } catch {} errors.push(`${email} http ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')} ${body}`); } });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.getByRole('button', { name: /^sign in$/i }).click()]);
  await page.waitForTimeout(1200);
  out(`${email} → ${page.url()}`);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `/tmp/lead-env-pw/l10-${(process.env.PARENT || 'f1').split('@')[0]}-${name}.png`, fullPage: true }).then(() => out('shot ' + name));
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 200)); } };
const text = async (page, n = 1400) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).slice(0, n);

const parent = await signIn(process.env.PARENT || 'parent.f1@lead.local', 'TestPass1');
await step('register', async () => {
  await parent.goto(`${BASE}/register`, { waitUntil: 'networkidle' }); await parent.waitForTimeout(1500);
  const sels = parent.locator('main select');
  await sels.nth(0).selectOption({ index: 1 }); inputs++; await parent.waitForTimeout(800);
  const sopts = await sels.nth(1).locator('option').allInnerTexts(); out('session options: ' + sopts.join(' / '));
  await sels.nth(1).selectOption({ index: sopts.findIndex((o) => /June 2028/.test(o)) }); inputs++; await parent.waitForTimeout(1500);
  const rows = parent.locator('main table tbody tr'); out('offer rows: ' + await rows.count());
  out('ROWS: ' + (await rows.allInnerTexts()).map((t) => t.split('\n')[0]).slice(0, 20).join(' | '));
  const tick = async (name) => { const head = parent.locator('main table tbody tr', { hasText: new RegExp('^' + name) }).first(); let row = head; let box = head.locator('input[type=checkbox]').first(); if (!(await box.count())) { row = head.locator('xpath=following-sibling::tr[1]'); box = row.locator('input[type=checkbox]').first(); } await box.check(); inputs++; await parent.waitForTimeout(900); return row; };
  const acc = await tick('Accounting'); out('ACCOUNTING: ' + (await acc.innerText()).replace(/\n/g, ' | ').slice(0, 300));
  const phy = await tick('Physics'); out('PHYSICS: ' + (await phy.innerText()).replace(/\n/g, ' | ').slice(0, 300));
  const mat = await tick('Mathematics'); out('MATHEMATICS: ' + (await mat.innerText()).replace(/\n/g, ' | ').slice(0, 400));
  // the self-study retake: entry select → "Retake, self-study — name the sitting", then the sitting
  const entry = mat.locator('select').last(); const eopts = await entry.locator('option').allInnerTexts(); out('maths entry options: ' + eopts.join(' / '));
  const ri = eopts.findIndex((o) => /retake, self-study/i.test(o)); if (ri >= 0) { await entry.selectOption({ index: ri }); inputs++; await parent.waitForTimeout(900); }
  out('MATHEMATICS after retake: ' + (await mat.innerText()).replace(/\n/g, ' | ').slice(0, 500));
  const sitting = mat.locator('select').last(); const sopts2 = await sitting.locator('option').allInnerTexts(); out('sitting options: ' + sopts2.join(' / '));
  if (sopts2.length > 1 && /carried|sitting/i.test(sopts2[0])) { await sitting.selectOption({ index: 1 }); inputs++; await parent.waitForTimeout(900); }
  // teacher picks: Accounting and Physics have one teacher each (no pick needed?)
  const tsel = acc.locator('select').first(); if (await tsel.count()) out('accounting teacher select: ' + (await tsel.locator('option').allInnerTexts()).join('/'));
  const summary = (await text(parent, 6000)).split('\n').filter((l) => /lines? ·|EGP|Due|verified|provisional|ⓟ/i.test(l)).slice(0, 12);
  out('SUMMARY:\n' + summary.join('\n'));
  await shot(parent, '01-ticked');
  const consents = parent.locator('main input[type=checkbox]:visible'); const nc = await consents.count(); out('checkboxes visible: ' + nc);
  const cboxes = parent.locator('main label', { hasText: /I confirm/ }).locator('input[type=checkbox]');
  const ncb = await cboxes.count(); out('consent boxes: ' + ncb);
  for (let i = 0; i < ncb; i++) { await cboxes.nth(i).check(); inputs++; }
  const reserve = parent.locator('main').getByRole('button', { name: /^reserve/i }).last(); out('reserve button: ' + (await reserve.innerText()));
  await reserve.click(); clicks++; await parent.waitForLoadState('networkidle'); await parent.waitForTimeout(2000);
  out('AFTER RESERVE url: ' + parent.url()); out('AFTER RESERVE:\n' + (await text(parent, 1800)));
  await shot(parent, '02-after-reserve');
});
await step('statement', async () => { await parent.goto(`${BASE}/statement`, { waitUntil: 'networkidle' }); await parent.waitForTimeout(1500); out('STATEMENT:\n' + (await text(parent, 2200))); await shot(parent, '03-statement'); });
out(`TOTAL: inputs ${inputs} clicks ${clicks}`);
await parent.context().close();
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
