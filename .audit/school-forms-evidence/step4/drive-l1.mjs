// Lead's step 4 drive, stage 1 (explore): the Sessions list, the New session dialog and the Add subject dialog on main.
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3000';
const out = (s) => console.log(s);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function signIn(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email} pageerror: ` + e.message.slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${email} console: ` + m.text().slice(0, 160)); });
  page.on('response', (r) => { if (r.status() >= 500) errors.push(`${email} http ${r.status()} ${r.url().replace(BASE, '')}`); });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 20000 }).catch(() => {}), page.getByRole('button', { name: /^sign in$/i }).click()]);
  await page.waitForTimeout(1200);
  out(`${email} → ${page.url()}`);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `/tmp/lead-env-pw/l1-${name}.png`, fullPage: true }).then(() => out('shot ' + name));
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 200)); } };
const text = async (page, n = 1400) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).slice(0, n);
const describe = async (scope) => {
  const items = [];
  const els = scope.locator('input:visible, select:visible, textarea:visible, [role=combobox]:visible, [role=switch]:visible, [role=radio]:visible');
  const n = await els.count();
  for (let i = 0; i < n; i++) {
    const el = els.nth(i);
    const tag = await el.evaluate((e) => e.tagName.toLowerCase());
    const type = await el.getAttribute('type');
    const name = (await el.getAttribute('name')) || (await el.getAttribute('aria-label')) || (await el.getAttribute('placeholder')) || '';
    const id = await el.getAttribute('id');
    let label = '';
    if (id) label = await scope.locator(`label[for="${id}"]`).first().innerText().catch(() => '');
    const val = tag === 'select' ? (await el.locator('option').allInnerTexts()).slice(0, 6).join('/') : await el.inputValue().catch(() => '');
    items.push(`${i}: ${tag}${type ? '[' + type + ']' : ''} ${label || name} = ${String(val).slice(0, 60)}`);
  }
  return items;
};

const admin = await signIn('admin@igcse.local', 'AdminPass1');
await step('list', async () => { await admin.goto(`${BASE}/admin/sessions`, { waitUntil: 'networkidle' }); await admin.waitForTimeout(1000); await shot(admin, '01-list'); out('LIST:\n' + await text(admin, 900)); });
await step('new-session', async () => {
  await admin.getByRole('button', { name: /new session/i }).first().click(); await admin.waitForTimeout(800);
  const dlg = admin.locator('[role=dialog]').first(); const scope = (await dlg.count()) ? dlg : admin.locator('main');
  out('NEW SESSION text:\n' + (await scope.innerText()).slice(0, 1200));
  out('NEW SESSION inputs:\n' + (await describe(scope)).join('\n'));
  out('NEW SESSION buttons: ' + (await scope.getByRole('button').allInnerTexts()).join(' | '));
  await shot(admin, '02-new-session'); await admin.keyboard.press('Escape'); await admin.waitForTimeout(400);
});
await step('open-session', async () => {
  const row = admin.locator('main table tbody tr, main a[href*="/admin/sessions/"]').first();
  if (!(await row.count())) { out('no session row'); return; }
  await row.click(); await admin.waitForLoadState('networkidle'); await admin.waitForTimeout(1000);
  out('SESSION URL: ' + admin.url()); out('SESSION:\n' + await text(admin, 1200)); await shot(admin, '03-session');
  const add = admin.getByRole('button', { name: /add subject/i }).first();
  if (await add.count()) { await add.click(); await admin.waitForTimeout(800); const dlg = admin.locator('[role=dialog]').first(); out('ADD SUBJECT text:\n' + (await dlg.innerText().catch(() => '')).slice(0, 900)); out('ADD SUBJECT inputs:\n' + (await describe(dlg)).join('\n')); out('ADD SUBJECT buttons: ' + (await dlg.getByRole('button').allInnerTexts()).join(' | ')); await shot(admin, '04-add-subject'); await admin.keyboard.press('Escape'); }
  else out('no Add subject button; buttons: ' + (await admin.locator('main button').allInnerTexts()).slice(0, 20).join(' | '));
});
await admin.context().close();
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
