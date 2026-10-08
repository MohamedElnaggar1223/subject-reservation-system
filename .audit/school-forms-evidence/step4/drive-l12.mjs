// Lead's step 4 drive, stage 12: the walk-in desk flow for Student F2 (already onboarded): reserve three subjects, one a declared self-study retake, and collect cash in one action; count inputs and clicks.
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3000';
const STUDENT = process.env.STUDENT || 'Student F2';
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
const shot = (page, name) => page.screenshot({ path: `/tmp/lead-env-pw/l12-${name}.png`, fullPage: true }).then(() => out('shot ' + name));
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 200)); } };
const text = async (page, n = 1400) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).slice(0, n);

const officer = await signIn('officer.mona@igcse.local', 'TestPass1');
await step('desk-reserve-collect', async () => {
  await officer.goto(`${BASE}/desk`, { waitUntil: 'networkidle' }); await officer.waitForTimeout(1000);
  await officer.locator('input[placeholder*="student" i]').first().fill(STUDENT); inputs++; await officer.waitForTimeout(1200);
  await officer.getByText(new RegExp(STUDENT)).first().click(); clicks++; await officer.waitForTimeout(1500);
  const reserveBtn = officer.getByRole('button', { name: /\+ reserve|^reserve$/i }).first(); await reserveBtn.click(); clicks++; await officer.waitForTimeout(1500);
  const sess = officer.locator('main select').first(); const sopts = await sess.locator('option').allInnerTexts(); out('session options: ' + sopts.join(' / '));
  await sess.selectOption({ index: sopts.findIndex((o) => /June 2028/.test(o)) }); inputs++; await officer.waitForTimeout(1500);
  const tick = async (name) => { const head = officer.locator('main table tbody tr', { hasText: new RegExp('^' + name) }).first(); let row = head; let box = head.locator('input[type=checkbox]').first(); if (!(await box.count())) { row = head.locator('xpath=following-sibling::tr[1]'); box = row.locator('input[type=checkbox]').first(); } await box.check(); inputs++; await officer.waitForTimeout(900); return row; };
  const acc = await tick('Accounting'); out('ACCOUNTING: ' + (await acc.innerText()).replace(/\n/g, ' | ').slice(0, 300));
  const phy = await tick('Physics'); out('PHYSICS: ' + (await phy.innerText()).replace(/\n/g, ' | ').slice(0, 300));
  const mat = await tick('Mathematics'); out('MATHEMATICS: ' + (await mat.innerText()).replace(/\n/g, ' | ').slice(0, 400));
  const entry = mat.locator('select').last(); const eopts = await entry.locator('option').allInnerTexts(); out('maths entry options: ' + eopts.join(' / '));
  const ri = eopts.findIndex((o) => /retake, self-study/i.test(o)); if (ri >= 0) { await entry.selectOption({ index: ri }); inputs++; await officer.waitForTimeout(900); }
  const sitting = mat.locator('select').last(); const sopts2 = await sitting.locator('option').allInnerTexts(); out('sitting options: ' + sopts2.join(' / '));
  if (sopts2.length > 1 && /sitting/i.test(sopts2[0])) { await sitting.selectOption({ index: 1 }); inputs++; await officer.waitForTimeout(900); }
  out('MATHEMATICS after: ' + (await mat.innerText()).replace(/\n/g, ' | ').slice(0, 400));
  const t = await text(officer, 8000);
  out('SUMMARY:\n' + t.split('\n').filter((l) => /lines? ·|EGP|Due|verif|consent|signed|Paid with|Reserve and collect|Reserve only|discount|exception/i.test(l)).slice(0, 16).join('\n'));
  // consent tick(s)
  const consent = officer.locator('main label', { hasText: /refund policy|declaration|signed|consent/i }).locator('input[type=checkbox]');
  const nc = await consent.count(); out('consent boxes: ' + nc); for (let i = 0; i < nc; i++) { await consent.nth(i).check(); inputs++; }
  // instrument: cash is the default? count only if changed
  const instr = officer.locator('main select', { has: officer.locator('option', { hasText: /cash/i }) }).first(); if (await instr.count()) out('instrument default: ' + (await instr.inputValue()));
  await shot(officer, '01-desk-ticked');
  const collect = officer.locator('main').getByRole('button', { name: /reserve and collect/i }).first(); out('collect button: ' + (await collect.innerText()));
  await collect.click(); clicks++; await officer.waitForLoadState('networkidle'); await officer.waitForTimeout(2500);
  const dlg = officer.locator('[role=dialog]').first(); if (await dlg.count()) { out('DIALOG after collect:\n' + (await dlg.innerText()).slice(0, 800)); await shot(officer, '02-collect-dialog'); const ok = dlg.getByRole('button', { name: /confirm|collect|ok|done/i }).last(); if (await ok.count()) { await ok.click(); clicks++; await officer.waitForTimeout(2000); } }
  out('AFTER COLLECT:\n' + (await text(officer, 2500)).split('\n').filter(Boolean).slice(0, 40).join('\n'));
  await shot(officer, '03-after-collect');
});
out(`TOTAL: inputs ${inputs} clicks ${clicks}`);
await officer.context().close();
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
