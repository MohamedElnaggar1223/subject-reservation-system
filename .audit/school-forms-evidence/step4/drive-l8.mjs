// Lead's step 4 drive, stage 8: set up three subjects on June 2028 (Accounting open with Teacher A, Mathematics self-study only, Physics open with Teacher A), counting inputs and clicks per subject.
import { chromium } from 'playwright-core';
const BASE = 'http://localhost:3000';
const SESSION = 'http://localhost:3000/admin/sessions/a2944615-40a9-44a9-a93e-91350a48410a';
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
const shot = (page, name) => page.screenshot({ path: `/tmp/lead-env-pw/l8-${name}.png`, fullPage: true }).then(() => out('shot ' + name));
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 200)); } };

const admin = await signIn('admin@igcse.local', 'AdminPass1');
await admin.goto(SESSION, { waitUntil: 'networkidle' }); await admin.waitForTimeout(1000);
const setup = async (subject, availability, fee, teacher) => {
  const before = { i: inputs, c: clicks };
  await admin.locator('main table tbody tr', { hasText: new RegExp('^' + subject) }).first().click(); clicks++; await admin.waitForTimeout(900);
  const drawer = admin.locator('[role=dialog]').first();
  await drawer.locator('select').first().selectOption({ label: availability }); inputs++;
  await drawer.locator('input[type=number]').first().fill(String(fee)); inputs++;
  if (teacher) {
    const box = drawer.locator('label', { hasText: teacher }).locator('input[type=checkbox]').first();
    if (!(await box.count())) { await drawer.getByRole('button', { name: /show every teacher/i }).first().click(); clicks++; await admin.waitForTimeout(600); }
    const box2 = drawer.locator('label', { hasText: teacher }).first();
    if (await box2.count()) { await box2.click(); inputs++; await admin.waitForTimeout(300); out(`teacher control for ${subject}: ` + (await box2.innerText()).replace(/\n/g, ' ')); }
    else { out(`no control for ${teacher}; drawer labels: ` + (await drawer.locator('label').allInnerTexts()).join(' | ')); const t = await drawer.innerText(); out('teachers section: ' + t.slice(t.indexOf('Teachers'), t.indexOf('Teachers') + 300).replace(/\n/g, ' | ')); }
  }
  await shot(admin, '01-' + subject.toLowerCase().replace(/\W/g, '') + '-filled');
  await drawer.getByRole('button', { name: /^save$/i }).first().click(); clicks++; await admin.waitForTimeout(1500);
  const still = admin.locator('[role=dialog]').first();
  if (await still.count()) { const t = await still.innerText(); const msg = t.split('\n').filter((l) => /who teaches|must|cannot|error|at least/i.test(l)).join(' | '); out(`drawer still open after Save (${subject}): ` + msg.slice(0, 300)); await admin.keyboard.press('Escape'); await admin.waitForTimeout(500); }
  const row = await admin.locator('main table tbody tr', { hasText: new RegExp('^' + subject) }).first().innerText();
  out(`${subject}: ` + row.replace(/\n/g, ' | ').slice(0, 300) + ` · cost inputs +${inputs - before.i} clicks +${clicks - before.c}`);
};
await step('accounting', () => setup('Accounting', 'Open', 1200, 'Teacher A'));
await step('mathematics', () => setup('Mathematics', 'Self-study only', 1100, null));
await step('physics', () => setup('Physics', 'Open', 1300, 'Teacher A'));
await shot(admin, '02-subjects');
out(`TOTAL: inputs ${inputs} clicks ${clicks}`);
await admin.context().close();
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
