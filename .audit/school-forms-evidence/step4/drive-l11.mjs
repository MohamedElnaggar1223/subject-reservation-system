// Lead's step 4 drive, stage 11: onboard a placeholder family at the desk (explore the form, then fill it); count inputs and clicks.
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3000';
const FAMILY = process.env.FAMILY || 'F1';
const GRADE = process.env.GRADE || '11';
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
const shot = (page, name) => page.screenshot({ path: `/tmp/lead-env-pw/l11-${FAMILY}-${name}.png`, fullPage: true }).then(() => out('shot ' + name));
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 200)); } };
const text = async (page, n = 1400) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).slice(0, n);
const describe = async (scope) => {
  const items = [];
  const els = scope.locator('input:visible, select:visible, textarea:visible, [role=combobox]:visible, [role=switch]:visible, [role=checkbox]:visible, [role=radio]:visible');
  const n = await els.count();
  for (let i = 0; i < n; i++) {
    const el = els.nth(i);
    const tag = await el.evaluate((e) => e.tagName.toLowerCase());
    const type = await el.getAttribute('type');
    const name = (await el.getAttribute('name')) || (await el.getAttribute('aria-label')) || (await el.getAttribute('placeholder')) || '';
    const id = await el.getAttribute('id');
    let label = '';
    if (id) label = await scope.locator(`label[for="${id}"]`).first().innerText().catch(() => '');
    const val = tag === 'select' ? (await el.locator('option').allInnerTexts()).slice(0, 10).join('/') : await el.inputValue().catch(() => '');
    items.push({ i, tag, type, label: label || name, val: String(val).slice(0, 100), el });
  }
  return items;
};

const officer = await signIn('officer.mona@igcse.local', 'TestPass1');
await step('onboard', async () => {
  await officer.goto(`${BASE}/desk`, { waitUntil: 'networkidle' }); await officer.waitForTimeout(1000);
  await officer.getByRole('button', { name: /new family|onboard/i }).first().click(); clicks++; await officer.waitForTimeout(900);
  const dlg = officer.locator('[role=dialog]').first(); const scope = (await dlg.count()) ? dlg : officer.locator('main');
  const items = await describe(scope);
  out('ONBOARD inputs:\n' + items.map((x) => `${x.i}: ${x.tag}${x.type ? '[' + x.type + ']' : ''} ${x.label} = ${x.val}`).join('\n'));
  out('ONBOARD buttons: ' + (await scope.getByRole('button').allInnerTexts()).filter(Boolean).slice(0, 12).join(' | '));
  await shot(officer, '01-onboard-form');
  const f = (i, v) => items[i].el.fill(v).then(() => { inputs++; });
  await f(0, `parent.${FAMILY.toLowerCase()}@lead.local`); await f(1, `Parent ${FAMILY}`); await f(2, 'TestPass1');
  await f(4, `student.${FAMILY.toLowerCase()}@lead.local`); await f(5, `Student ${FAMILY}`); await f(6, 'TestPass1');
  const gopts = await items[7].el.locator('option').allInnerTexts(); const gi = gopts.findIndex((o) => new RegExp('^Grade ' + GRADE + '\\b').test(o)); await items[7].el.selectOption({ index: gi }); inputs++;
  await shot(officer, '02-onboard-filled');
  const submit = scope.getByRole('button', { name: /create & link family/i }).first(); out('submit: ' + (await submit.innerText()));
  await submit.click(); clicks++; await officer.waitForTimeout(2000);
  const still = officer.locator('[role=dialog]').first(); if (await still.count()) { out('form still open: ' + (await still.innerText()).slice(0, 500).replace(/\n/g, ' | ')); await shot(officer, '03-onboard-error'); await officer.keyboard.press('Escape'); }
  out('AFTER ONBOARD url: ' + officer.url()); out('AFTER ONBOARD:\n' + (await text(officer, 1200)));
  await shot(officer, '03-after-onboard');
});
out(`TOTAL: inputs ${inputs} clicks ${clicks}`);
await officer.context().close();
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
