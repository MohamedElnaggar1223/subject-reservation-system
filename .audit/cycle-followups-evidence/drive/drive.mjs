// Cycle follow-ups drive (docs/features/CYCLE_FOLLOWUPS.md §4): headless Chrome against the worktree's
// servers (web 3170, API 3171, igcse_followups_dev after setup-dev.mjs).
// 1. The desk: the teacher change through each outcome (moves, no class, refused for a clash, the whole
//    class, self-study), each sentence read in English, the language switched on the open dialog, read
//    and shot in Arabic.
// 2. The Messages screen: "A list in the system" → "A teaching group" → a class → the count (English, Arabic).
// 3. The Session screen: Replace a teacher → its result sentence (English, Arabic).
// Writes ./drive.json (every sentence read, every error seen) and ./shots/*.jpg.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const BASE = 'http://localhost:3170';
const state = JSON.parse(readFileSync(new URL('./state.json', import.meta.url)));
const only = process.argv[2] ?? 'all';
const out = (...a) => console.log(...a);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const read = {};

async function signIn(email, password = 'TestPass1') {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email} pageerror: ` + e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/hydrat/i.test(m.text())) errors.push(`${email} console: ` + m.text().slice(0, 200)); });
  page.on('response', async (r) => {
    if (r.status() >= 400 && r.request().method() !== 'GET') {
      let b = '';
      try { b = (await r.text()).slice(0, 300); } catch { /* gone */ }
      errors.push(`${email} http ${r.status()} ${r.request().method()} ${r.url()} ${b}`);
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
const toggle = async (page) => {
  // The sidebar's language button (an open dialog's overlay covers it: the button's own click, as a keyboard user's).
  await page.locator('button[title="Switch language"], button[title="تغيير اللغة"]').first().dispatchEvent('click');
  await page.waitForTimeout(1500);
};
async function shot(page, name, opts = {}) {
  const path = new URL(`./shots/${name}.jpg`, import.meta.url).pathname;
  await page.waitForTimeout(opts.wait ?? 600);
  await page.screenshot({ path, fullPage: opts.full ?? false, type: 'jpeg', quality: 60 });
  out('shot', name, Math.round(statSync(path).size / 1024), 'KB');
}

// ── 1. The desk ──────────────────────────────────────────────────────────────
async function deskChange(page, tag, student, choice, reason) {
  await page.goto(`${BASE}/desk`, { waitUntil: 'networkidle' });
  await page.fill('input[type=search]', student);
  await page.locator('button', { hasText: student }).first().click();
  await page.getByRole('button', { name: 'Statement', exact: true }).click();
  await page.getByRole('button', { name: 'Teacher', exact: true }).first().click();
  await page.waitForSelector('#line-teacher');
  await page.selectOption('#line-teacher', { label: choice });
  await page.fill('#line-teacher-reason', reason);
  await shot(page, `${tag}-0-before-en`);
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  const notice = page.getByRole('dialog').getByRole('status');
  await notice.waitFor({ timeout: 20000 });
  read[tag] = { en: await notice.innerText() };
  await shot(page, `${tag}-1-en`);
  await toggle(page);
  read[tag].ar = await notice.innerText();
  read[tag].dir = await page.evaluate(() => document.documentElement.dir);
  await shot(page, `${tag}-2-ar`);
  await toggle(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
  out(tag, JSON.stringify(read[tag]));
}

if (only === 'all' || only === 'desk') {
  const desk = await signIn('officer.mona@igcse.local');
  await deskChange(desk, 'desk-a-moves', 'Student FU-1', 'Teacher B', 'The family asked for Teacher B');
  await deskChange(desk, 'desk-b-no-class', 'Student FU-3', 'Teacher C', 'The family asked for Teacher C');
  await deskChange(desk, 'desk-c-refused-clash', 'Student FU-5', 'Teacher B', 'The family asked for Teacher B');
  await deskChange(desk, 'desk-d-whole-class', 'Student FU-4', 'Teacher C', 'The family asked for Teacher C');
  await deskChange(desk, 'desk-e-self-study', 'Student FU-6', 'Self-study (no teacher)', 'The retake is studied alone');
}

// ── 2. Messages: a teaching group ────────────────────────────────────────────
if (only === 'all' || only === 'messages') {
  const adm = await signIn('admin@igcse.local', 'AdminPass1');
  for (const [tag, cls] of [['messages-a-class-a', 'Biology 11 — Teacher A'], ['messages-b-class-b', 'Biology 11 — Teacher B']]) {
    await adm.goto(`${BASE}/admin/messages`, { waitUntil: 'networkidle' });
    await adm.getByRole('button', { name: 'A list in the system' }).click();
    await adm.locator('label', { has: adm.locator('span', { hasText: /^List$/ }) }).locator('select').selectOption({ label: 'A teaching group' });
    const picker = adm.locator('label', { has: adm.locator('span', { hasText: /^Teaching group$/ }) }).locator('select');
    await picker.waitFor();
    read[`${tag}-options`] = await picker.locator('option').allInnerTexts();
    await picker.selectOption({ label: cls });
    await adm.getByText(/people? —|^1 person/).first().waitFor({ timeout: 20000 }).catch(() => {});
    await adm.waitForTimeout(1500);
    const summary = adm.locator('fieldset').first();
    read[tag] = { en: await summary.innerText() };
    await shot(adm, `${tag}-en`, { full: true });
    await toggle(adm);
    read[tag].ar = await summary.innerText();
    await shot(adm, `${tag}-ar`, { full: true });
    await toggle(adm);
    out(tag, JSON.stringify(read[tag]));
  }
}

// ── 3. The Session screen: Replace a teacher ─────────────────────────────────
for (const [mode, from, to, tag] of [['replace', 'Teacher A', 'Teacher D', 'replace'], ['replace2', 'Teacher B', 'Teacher A', 'replace2']]) if (only === 'all' || only === mode) {
  const adm = await signIn('admin@igcse.local', 'AdminPass1');
  await adm.goto(`${BASE}/admin/sessions/${state.sessionId}`, { waitUntil: 'networkidle' });
  await adm.waitForTimeout(2000);
  await shot(adm, `${tag}-0-sheet`, { full: true });
  await adm.locator('tr, li, button', { hasText: 'Biology' }).first().click();
  await adm.getByRole('button', { name: 'Replace teacher' }).click();
  // The dialog (its accessible name is translated with the page: found by its role alone).
  const dlg = adm.getByRole('dialog');
  await dlg.locator('#rt-from').selectOption({ label: from });
  await dlg.locator('#rt-to').selectOption({ label: to });
  await dlg.locator('#rt-why').fill(`${from} leaves the school`);
  await shot(adm, `${tag}-1-before-en`);
  await dlg.getByRole('button', { name: 'Replace', exact: true }).click();
  const notice = dlg.getByRole('status');
  await notice.waitFor({ timeout: 20000 });
  read[tag] = { en: await notice.innerText() };
  await shot(adm, `${tag}-2-en`);
  await toggle(adm);
  read[tag].ar = await notice.innerText();
  await shot(adm, `${tag}-3-ar`);
  await toggle(adm);
  out(tag, JSON.stringify(read[tag]));
}

writeFileSync(new URL(`./drive-${only}.json`, import.meta.url), JSON.stringify({ read, errors }, null, 2));
out('errors', errors.length, errors.slice(0, 20));
await browser.close();
