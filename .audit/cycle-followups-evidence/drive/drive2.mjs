// The review of d3f62cf, items 2 and 4, driven in headless Chrome on the worktree's servers (web 3170, API 3171).
//   node drive2.mjs form <tag> <from> <to>  — the Session screen: a subject's form, Replace a teacher, Close;
//                                             the form's teacher ticks before and after (item 2).
//   node drive2.mjs quickfill <tag>          — Messages: a class picked, then an old-shape saved list clicked;
//                                             the class picker's value and the summary after (item 4).
// Writes ./drive2-<mode>-<tag>.json and ./shots/r2-*.jpg.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const BASE = 'http://localhost:3170';
const state = JSON.parse(readFileSync(new URL('./state.json', import.meta.url)));
const [mode, tag, from, to] = process.argv.slice(2);
const out = (...a) => console.log(...a);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const read = {};

async function signIn(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/hydrat/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('response', async (r) => {
    if (r.status() >= 400 && r.request().method() !== 'GET') {
      let b = '';
      try { b = (await r.text()).slice(0, 300); } catch { /* gone */ }
      errors.push(`http ${r.status()} ${r.request().method()} ${r.url()} ${b}`);
    }
  });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.localStorage.setItem('language', 'en'));
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 30000 }).catch(() => {}), page.locator('button[type=submit]').first().click()]);
  await page.waitForTimeout(1500);
  return page;
}
async function shot(page, name) {
  const path = new URL(`./shots/r2-${name}.jpg`, import.meta.url).pathname;
  await page.waitForTimeout(700);
  await page.screenshot({ path, fullPage: false, type: 'jpeg', quality: 60 });
  out('shot', name, Math.round(statSync(path).size / 1024), 'KB');
}

const adm = await signIn('admin@igcse.local', 'AdminPass1');

if (mode === 'form') {
  await adm.goto(`${BASE}/admin/sessions/${state.sessionId}`, { waitUntil: 'networkidle' });
  await adm.waitForTimeout(1500);
  await adm.locator('tr, li, button', { hasText: 'Biology' }).first().click();
  await adm.getByRole('button', { name: 'Replace teacher' }).waitFor();
  const ticks = async () => Object.fromEntries(await Promise.all(['Teacher A', 'Teacher B', 'Teacher C', 'Teacher D']
    .map(async (t) => [t, await adm.getByRole('checkbox', { name: t, exact: true }).isChecked().catch(() => null)])));
  read.before = await ticks();
  await shot(adm, `${tag}-form-0-before`);
  await adm.getByRole('button', { name: 'Replace teacher' }).click();
  const dlg = adm.getByRole('dialog', { name: 'Replace a teacher' });
  await dlg.locator('#rt-from').selectOption({ label: from });
  await dlg.locator('#rt-to').selectOption({ label: to });
  await dlg.locator('#rt-why').fill(`${from} leaves the school`);
  await dlg.getByRole('button', { name: 'Replace', exact: true }).click();
  // The result sentence (or none: the dialog closes by itself).
  await Promise.race([dlg.getByRole('status').waitFor({ timeout: 20000 }), dlg.waitFor({ state: 'detached', timeout: 20000 })]).catch(() => {});
  if (await dlg.count()) {
    read.said = await dlg.getByRole('status').innerText().catch(() => null);
    await shot(adm, `${tag}-form-1-said`);
    await dlg.getByRole('button', { name: 'Close', exact: true }).last().click();
  }
  await adm.waitForTimeout(1500);
  read.after = await ticks();
  await shot(adm, `${tag}-form-2-after`);
}

if (mode === 'quickfill') {
  await adm.goto(`${BASE}/admin/messages`, { waitUntil: 'networkidle' });
  await adm.getByRole('button', { name: 'A list in the system' }).click();
  await adm.locator('label', { has: adm.locator('span', { hasText: /^List$/ }) }).locator('select').selectOption({ label: 'A teaching group' });
  const picker = adm.locator('label', { has: adm.locator('span', { hasText: /^Teaching group$/ }) }).locator('select');
  await picker.selectOption({ label: 'Biology 11 — Teacher B · Teacher A' }).catch(async () => picker.selectOption({ index: 1 }));
  await adm.waitForTimeout(2000);
  read.picked = { value: await picker.inputValue(), text: await adm.locator('fieldset').first().innerText() };
  await shot(adm, `${tag}-quickfill-0-picked`);
  await adm.getByRole('button', { name: state.legacySavedName, exact: true }).click();
  await adm.waitForTimeout(2000);
  read.afterSaved = { value: await picker.inputValue(), text: await adm.locator('fieldset').first().innerText() };
  await shot(adm, `${tag}-quickfill-1-saved-list-clicked`);
}

writeFileSync(new URL(`./drive2-${mode}-${tag}.json`, import.meta.url), JSON.stringify({ read, errors }, null, 2));
out(JSON.stringify(read, null, 1));
out('errors', errors.length, errors.slice(0, 10));
await browser.close();
