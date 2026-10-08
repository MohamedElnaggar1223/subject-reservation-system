// Lead's step 4 drive, stage 9: lift a rule for one family (an exception) as finance admin; count inputs and clicks; the Exceptions list.
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
  page.on('response', async (r) => { if (r.status() >= 400 && r.request().method() !== 'GET') { let body = ''; try { body = (await r.text()).slice(0, 200); } catch {} errors.push(`${email} http ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')} ${body}`); } });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.getByRole('button', { name: /^sign in$/i }).click()]);
  await page.waitForTimeout(1200);
  out(`${email} → ${page.url()}`);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `/tmp/lead-env-pw/l9-${name}.png`, fullPage: true }).then(() => out('shot ' + name));
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
    items.push(`${i}: ${tag}${type ? '[' + type + ']' : ''} ${label || name} = ${String(val).slice(0, 120)}`);
  }
  return items;
};

const fa = await signIn('finadmin.rana@igcse.local', 'TestPass1');
await step('exceptions', async () => {
  await fa.goto(`${BASE}/admin/exceptions`, { waitUntil: 'networkidle' }); await fa.waitForTimeout(1200);
  out('EXCEPTIONS:\n' + (await text(fa, 1200)));
  out('buttons: ' + (await fa.locator('main button').allInnerTexts()).filter(Boolean).slice(0, 16).join(' | '));
  const grant = fa.getByRole('button', { name: /grant|new exception/i }).first();
  if (await grant.count()) { await grant.click(); clicks++; await fa.waitForTimeout(800); }
  const dlg = fa.locator('[role=dialog]').first(); const scope = (await dlg.count()) ? dlg : fa.locator('main');
  out('GRANT FORM text: ' + (await scope.innerText()).slice(0, 1200).replace(/\n/g, ' | '));
  out('GRANT FORM inputs:\n' + (await describe(scope)).join('\n'));
  out('GRANT FORM buttons: ' + (await scope.getByRole('button').allInnerTexts()).filter(Boolean).slice(0, 12).join(' | '));
  await shot(fa, '01-grant-form');
  // fill: who (student search), policy (discount percent), value, reason
  const whoSel = scope.locator('select:visible').first(); await whoSel.selectOption({ index: 1 }); inputs++; await fa.waitForTimeout(600);
  await scope.locator('input[type=radio]').nth(1).check(); inputs++; await fa.waitForTimeout(300);
  const selects = scope.locator('select:visible'); const ns = await selects.count(); out('selects after who: ' + ns);
  for (let i = 0; i < ns; i++) out(`  select ${i}: ` + (await selects.nth(i).locator('option').allInnerTexts()).slice(0, 12).join(' / '));
  const policy = selects.nth(1); const popts = await policy.locator('option').allInnerTexts(); const pi = popts.findIndex((o) => /discount.*%|percent/i.test(o)); if (pi >= 0) { await policy.selectOption({ index: pi }); inputs++; await fa.waitForTimeout(600); }
  out('after policy, inputs:\n' + (await describe(scope)).join('\n'));
  const num = scope.locator('input[type=number]:visible').first(); if (await num.count()) { await num.fill('20'); inputs++; }
  const reason = scope.locator('textarea:visible, input[placeholder*="reason" i], input[placeholder*="why" i]').first(); if (await reason.count()) { await reason.fill('Lead check: staff child discount'); inputs++; }
  await shot(fa, '02-grant-filled');
  const submit = scope.getByRole('button', { name: /^grant|^save|^create/i }).last(); out('submit: ' + (await submit.innerText().catch(() => '?')));
  await submit.click(); clicks++; await fa.waitForTimeout(1500);
  const still = fa.locator('[role=dialog]').first(); if (await still.count()) { out('form still open: ' + (await still.innerText()).slice(0, 400).replace(/\n/g, ' | ')); await fa.keyboard.press('Escape'); }
  out('LIST after: ' + (await text(fa, 2000)).split('\n').filter((l) => /Salma|Discount|20|active/i.test(l)).slice(0, 8).join(' | '));
  await shot(fa, '03-after-grant');
});
out(`TOTAL: inputs ${inputs} clicks ${clicks}`);
await fa.context().close();
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
