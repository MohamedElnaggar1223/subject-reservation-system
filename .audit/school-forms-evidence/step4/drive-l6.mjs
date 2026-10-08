// Lead's step 4 drive, stage 6: create placeholder Teacher A on the Team page; set the June 2028 series' entry deadline and exam dates.
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
const shot = (page, name) => page.screenshot({ path: `/tmp/lead-env-pw/l6-${name}.png`, fullPage: true }).then(() => out('shot ' + name));
const step = async (name, fn) => { try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 200)); } };
const text = async (page, n = 1400) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).slice(0, n);
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const dt = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 16);

const admin = await signIn('admin@igcse.local', 'AdminPass1');
await step('teacher', async () => {
  await admin.goto(`${BASE}/admin/team`, { waitUntil: 'networkidle' }); await admin.waitForTimeout(1000);
  const form = admin.locator('main form').first(); const scope = (await form.count()) ? form : admin.locator('main');
  await scope.locator('input').nth(0).fill('Teacher A'); inputs++;
  await scope.locator('input').nth(1).fill('teacher.a@lead.local'); inputs++;
  await scope.locator('input').nth(2).fill('TestPass1'); inputs++;
  const role = scope.locator('select').first(); await role.selectOption({ label: 'Teacher' }); inputs++; await admin.waitForTimeout(400);
  const teaches = scope.locator('select').nth(1); if (await teaches.count()) { const o = await teaches.locator('option').allInnerTexts(); out('teaches-as options: ' + o.join('/')); const i = o.findIndex((x) => /new teacher record/i.test(x)); if (i >= 0) { await teaches.selectOption({ index: i }); inputs++; } }
  await scope.getByRole('button', { name: /create account/i }).click(); clicks++; await admin.waitForTimeout(1500);
  out('TEAM after: ' + (await text(admin, 2500)).split('\n').filter((l) => /Teacher A|teacher\.a|created|error/i.test(l)).slice(0, 6).join(' | '));
  await shot(admin, '01-teacher-created');
});
await step('series-dates', async () => {
  await admin.goto(`${BASE}/exams/series`, { waitUntil: 'networkidle' }); await admin.waitForTimeout(1000);
  const year = admin.locator('main select').first(); const yopts = await year.locator('option').allInnerTexts();
  await year.selectOption({ index: yopts.findIndex((o) => o.includes('2027/28')) }); inputs++; await admin.waitForTimeout(1200);
  const row = admin.locator('main table tbody tr', { hasText: /June 2028/ }).first();
  await row.getByRole('button', { name: /dates/i }).first().click(); clicks++; await admin.waitForTimeout(800);
  const main = admin.locator('main');
  const deadline = main.locator('input[type=datetime-local]:visible').nth(0); await deadline.fill(dt(60)); inputs++;
  const retakes = main.locator('input[type=datetime-local]:visible').nth(1); await retakes.fill(dt(75)); inputs++;
  const dates = main.locator('input[type=date]:visible');
  const labels = []; const n = await dates.count();
  for (let i = 0; i < n; i++) { const id = await dates.nth(i).getAttribute('id'); labels.push(id ? await main.locator(`label[for="${id}"]`).first().innerText().catch(() => '?') : '?'); }
  out('date labels: ' + labels.join(' | '));
  const si = labels.findIndex((l) => /exams start/i.test(l)); const ei = labels.findIndex((l) => /exams end/i.test(l));
  if (si >= 0) { await dates.nth(si).fill(day(120)); inputs++; } if (ei >= 0) { await dates.nth(ei).fill(day(135)); inputs++; }
  await shot(admin, '02-dates-filled');
  await main.getByRole('button', { name: /save the dates/i }).click(); clicks++; await admin.waitForTimeout(1500);
  const t = await text(admin, 3000);
  out('after save (messages): ' + t.split('\n').filter((l) => /saved|error|must|before|after|invalid|deadline/i.test(l)).slice(0, 8).join(' | '));
  out('ROW AFTER: ' + (await admin.locator('main table tbody tr', { hasText: /June 2028/ }).first().innerText()).replace(/\n/g, ' | ').slice(0, 300));
  await shot(admin, '03-after-save');
});
out(`TOTAL: inputs ${inputs} clicks ${clicks}`);
await admin.context().close();
out('ERRORS: ' + (errors.length ? '\n' + errors.join('\n') : 'none'));
await browser.close();
