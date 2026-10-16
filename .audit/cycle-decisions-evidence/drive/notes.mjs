// F6's second review, its two notes on the subject form's read-back (subjects-tab.client.tsx, readBack), driven
// on the running system (web 3180, API 3181) as the admin on June 2027's sheet, the Physics O.L. form:
//  a — a refetch of the sheet started before the change (the window's focus) is still running when Save reads the
//      sheet back; that fetch is held 4 s and answered with the sheet as it was before the change. The form made
//      again after the Save must show what was saved (the note typed), not the held sheet.
//  b — the read-back after a successful Save fails (the request aborted): the screen must say "Saved." (the change
//      was made) and no error, and the form must come back from the sheet once it refetches.
// Usage: node notes.mjs <a|b> <tag>   (tag: fixed | control). Writes <EVIDENCE>/notes/<a|b>-<tag>.json and a shot.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const WEB = 'http://localhost:3180';
const EVIDENCE = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/cycle-decisions/.audit/cycle-decisions-evidence/notes';
const S = JSON.parse(fs.readFileSync(new URL('./state.json', import.meta.url), 'utf8'));
const [mode, tag, fromT = 'Teacher C', toT = 'Teacher A'] = process.argv.slice(2);
fs.mkdirSync(EVIDENCE, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.addCookies([{ name: 'language', value: 'en', url: WEB }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
await page.fill('input[type=email]', 'admin@igcse.local');
await page.fill('input[type=password]', 'AdminPass1');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 30000 }), page.locator('button[type=submit]').click()]);

const sheetUrl = `**/v1/sessions/${S.june}/offers`;
const seen = [];
const t0 = Date.now();
let armed = false;
let failUntil = 0; // (b) the network is down for the sheet's reads for 9 s after the PUT (longer than the query's retries)
await page.route(sheetUrl, async (route) => {
  const req = route.request();
  if (req.method() !== 'GET') return route.continue();
  const at = Date.now() - t0;
  if ((mode === 'a' || mode === 'r') && armed) {
    armed = false;
    seen.push({ at, what: 'GET held 4 s, answered with the sheet as it was when asked' });
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 4000));
    try { await route.fulfill({ response }); } catch { seen.push({ at: Date.now() - t0, what: 'the held GET was cancelled by the page' }); }
    return;
  }
  if ((mode === 'b' || mode === 'add') && Date.now() < failUntil) {
    seen.push({ at, what: 'GET aborted (the sheet cannot be read: the network is down for 9 s)' });
    return route.abort('failed');
  }
  seen.push({ at, what: 'GET answered' });
  return route.continue();
});
page.on('response', (r) => { if (r.request().method() === 'POST' && r.url().includes('replace-teacher')) seen.push({ at: Date.now() - t0, what: `POST replace-teacher answered ${r.status()}` }); });
page.on('request', (r) => {
  if (r.method() === 'POST' && r.url().includes('replace-teacher')) seen.push({ at: Date.now() - t0, what: 'POST replace-teacher' });
  if (mode === 'add' && r.method() === 'POST' && /\/v1\/sessions\/[^/]+\/offers$/.test(r.url())) { seen.push({ at: Date.now() - t0, what: 'POST the new subject' }); failUntil = Date.now() + 9000; }
  if (r.method() === 'PUT' && r.url().includes('/form')) { seen.push({ at: Date.now() - t0, what: 'PUT the form' }); if (mode === 'b') failUntil = Date.now() + 9000; }
});

await page.goto(`${WEB}/admin/sessions/${S.june}#subjects`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
let addedName = null;
if (mode === 'add') {
  // Add a subject the sheet does not have yet, as "Retake (Self Study ONLY)" at a course fee (no teacher needed).
  await page.getByRole('button', { name: 'Add subject', exact: true }).first().click();
  await page.waitForSelector('#as-search');
  const first = page.locator('[role=listbox] [role=option]').first();
  addedName = (await first.locator('bdi').first().textContent())?.trim() ?? null;
  await first.click();
  await page.waitForSelector('#sf-fee');
  await page.locator('label', { hasText: 'Retake (Self Study ONLY)' }).locator('input[type=radio]').check();
  await page.fill('#sf-fee', '5000');
} else {
  await page.locator('tr').filter({ has: page.getByRole('button', { name: 'Physics', exact: true }) }).getByRole('button', { name: 'Physics', exact: true }).click();
}
await page.waitForSelector('#sf-notes');
const before = await page.inputValue('#sf-notes');
const teachersBeforeEarly = { pending: true };
const note = `Read-back drive ${mode} ${tag} ${new Date().toISOString().slice(11, 19)}`;
await page.fill('#sf-notes', note);
if (mode === 'r') {
  await page.getByRole('button', { name: 'Replace teacher', exact: true }).click();
  await page.waitForSelector('#rt-to');
  const opt = async (sel, name) => page.locator(`${sel} option`).evaluateAll((os, n) => os.find((o) => o.textContent.trim() === n)?.value, name);
  await page.selectOption('#rt-from', await opt('#rt-from', fromT));
  await page.selectOption('#rt-to', await opt('#rt-to', toT));
  await page.fill('#rt-why', 'The teacher leaves this cycle (read-back drive)');
}
if (mode === 'a' || mode === 'r') {
  // The sheet is stale after a minute (the app's staleTime): the focus refetch starts only then.
  await page.waitForTimeout(61_000);
  armed = true;
  // The window regains focus: React Query refetches the sheet (stale at once), before the Save.
  await page.evaluate(() => { window.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(400);
}
const ticked = async () => Object.fromEntries(await Promise.all(['Teacher A', 'Teacher B', 'Teacher C'].map(async (n) => {
  const box = page.locator('[role=dialog] label', { hasText: n }).locator('input[type=checkbox]');
  return [n, (await box.count()) ? await box.first().isChecked() : null];
})));
let teachersBefore = null;
if (mode === 'r') {
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
} else if (mode === 'add') {
  await page.locator('[role=dialog] button[type=submit]').click();
} else {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}
let waitingShown = null;
let tabErrorShown = null;
let drawerTitle = null;
let savedSoon = null;
if (mode === 'b' || mode === 'add') {
  // Sampled 1.5 s after the change: the read-back has failed by then (one attempt, no retries).
  await page.waitForTimeout(1500);
  savedSoon = await page.getByText(mode === 'add' ? 'Added. Its papers and their fees, if the Catalogue gives it any, can be set below.' : 'Saved.', { exact: true }).count() > 0;
  drawerTitle = await page.locator('[role=dialog] h2').first().textContent().catch(() => null);
  // During the outage: what the screen says (the sheet's own error, or the drawer's notice that the form waits).
  waitingShown = await page.getByText("The sheet could not be read again just now: the subject's form comes back once it is.").count();
  tabErrorShown = await page.getByText('Could not load this').count();
  await page.screenshot({ path: path.join(EVIDENCE, `${mode}-${tag}-during.jpg`), type: 'jpeg', quality: 55 });
  await page.waitForTimeout(8000);
  // The network is back: the person reads the sheet again (the drawer's button, or the screen's own Try again).
  const again = page.getByRole('button', { name: 'Read the sheet again' });
  if (await again.count()) await again.click();
  else if (await page.getByRole('button', { name: 'Try again' }).count()) await page.getByRole('button', { name: 'Try again' }).first().click();
  await page.waitForTimeout(3000);
} else {
  await page.waitForTimeout(7000);
}
const after = await page.inputValue('#sf-notes').catch(() => null);
const saved = await page.getByText(mode === 'add' ? 'Added. Its papers and their fees, if the Catalogue gives it any, can be set below.' : 'Saved.', { exact: true }).count();
const errorShown = await page.locator('[role=dialog] .text-destructive, [role=dialog] [role=alert]').allInnerTexts().catch(() => []);
const shot = path.join(EVIDENCE, `${mode}-${tag}.jpg`);
await page.screenshot({ path: shot, type: 'jpeg', quality: 55 });
const teachersAfter = mode === 'r' ? await ticked() : undefined;
const result = { mode, tag, before, typed: note, after, replaced: mode === 'r' ? { from: fromT, to: toT, teachersBefore, teachersAfter, newTeacherTicked: teachersAfter[toT] === true, oldTeacherTicked: teachersAfter[fromT] === true } : undefined, keptWhatWasSaved: after === note, savedShown: saved > 0, errorShown, duringOutage: (mode === 'b' || mode === 'add') ? { savedShownAt1500ms: savedSoon, drawerTitle, waitingNoticeShownAt1500ms: waitingShown > 0, screenReplacedByError: tabErrorShown > 0, addedName } : undefined, requests: seen, errors };
fs.writeFileSync(path.join(EVIDENCE, `${mode}-${tag}.json`), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result));
await browser.close();
