// Chapters 7-8: the June 2027 session (Sessions → New session) and its sheet, the 25 forms one by one.
import { BASE, signIn, shot, tallShot, drawerBox, out, browser, report, mainText, mark, unmark, toTop } from './lib.mjs';
import { D, ADMIN } from './data.mjs';

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const page = await signIn(ADMIN.email, ADMIN.password);
const S = D.session;

// The session.
await page.goto(`${BASE}/admin/sessions`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
let sessionUrl = await page.locator('a', { hasText: 'June 2027' }).first().getAttribute('href').catch(() => null);
if (!sessionUrl) {
  await mark(page, page.getByRole('button', { name: 'New session' }));
  await mark(page, page.locator('nav a', { hasText: 'Sessions' }).first());
  await shot(page, 'sessions-empty');
  await unmark(page);
  await page.getByRole('button', { name: 'New session' }).click();
  await page.selectOption('#ns-type', S.type);
  await page.fill('#ns-year', String(S.year));
  await page.fill('#ns-from', S.from);
  await page.fill('#ns-to', S.to);
  await page.fill('#ns-course', S.course_starts);
  await page.fill('#ns-due', S.due);
  await page.selectOption('#ns-copy', 'none');
  await mark(page, page.getByRole('button', { name: 'Create session' }));
  await shot(page, 'session-new-filled');
  await unmark(page);
  await Promise.all([page.waitForURL(/\/admin\/sessions\/[^/]+$/, { timeout: 30000 }), page.getByRole('button', { name: 'Create session' }).click()]);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  sessionUrl = new URL(page.url()).pathname;
  await shot(page, 'session-empty-sheet');
  out(await mainText(page, 1500));
}
out('session', sessionUrl);
await page.goto(`${BASE}${sessionUrl}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const OFFERED = { open: 'First entry and retakes', retake_only: 'Retakes only', self_study_only: 'Retake (Self Study ONLY)' };
const PAPER = { retake_only: 'Retake in school or self study', self_study_only: 'Retake self study only', closed: 'Not offered this cycle' };
const ROUTE = { open: 'Offered', self_study_only: 'Self study only', closed: 'Not offered this cycle' };
const UNIT = { open: 'Taught by', self_study_only: 'Self study only', closed: 'Not this cycle' };
const exact = (s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

async function tick(scope, names, online = [], only = false) {
  const rows = scope.locator('div.flex.items-center.justify-between', { has: page.locator('label input[type=checkbox]') });
  if (only) { // untick anyone not named (a single-teacher pool comes ticked)
    for (const r of await rows.all()) {
      const n = (await r.locator('bdi').first().innerText().catch(() => '')).trim();
      const b = r.locator('input[type=checkbox]').first();
      if (n && !names.includes(n) && await b.isChecked()) await b.uncheck();
    }
  }
  for (const n of names) {
    let row = scope.locator('div.flex.items-center.justify-between', { has: page.locator('bdi', { hasText: exact(n) }) }).first();
    if (!(await row.count())) {
      await scope.getByRole('button', { name: 'Show every teacher' }).first().click();
      await page.waitForTimeout(300);
      row = scope.locator('div.flex.items-center.justify-between', { has: page.locator('bdi', { hasText: exact(n) }) }).first();
    }
    const box = row.locator('input[type=checkbox]').first();
    if (!(await box.isChecked())) await box.check();
    if (online.includes(n)) await row.locator('input[type=checkbox]').nth(1).check();
  }
}

let first = true;
for (const s of D.subjects) {
  if (ONLY && !ONLY.includes(s.code)) continue;
  const n = String(s.n).padStart(2, '0');
  const sh = s.sheet;
  const addButton = page.getByRole('button', { name: /^Add subjects?$/ }).first();
  if (first) { await mark(page, addButton); await shot(page, 'sheet-add-button'); await unmark(page); }
  await addButton.click();
  const modal = page.getByRole('dialog', { name: 'Add subject' });
  await modal.locator('#as-search').fill(s.code);
  await page.waitForTimeout(700);
  if (first) { await mark(page, modal.getByRole('option').first()); await shot(page, 'sheet-add-search'); await unmark(page); }
  await modal.getByRole('option').first().click();
  await page.waitForTimeout(900);
  const drawer = page.locator('div[role=dialog]').last();
  if (first) await tallShot(page, 'sheet-form-new', drawerBox(page));
  // (a) Teachers this cycle; the external team.
  if (s.external) {
    const known = drawer.locator('bdi', { hasText: exact(D.external_team) });
    if (await known.count()) await tick(drawer, [D.external_team]);
    else { await drawer.locator('#sf-team').fill(D.external_team); await drawer.getByRole('button', { name: 'Add', exact: true }).click(); }
  }
  const subjectTeachers = sh.subject_teachers ?? s.teachers;
  if (subjectTeachers) await tick(drawer, subjectTeachers, s.online ?? [], true);
  // (b) Offered as; (c) the course fee.
  await drawer.locator('label', { hasText: OFFERED[sh.offered] }).first().click();
  await drawer.locator('#sf-fee').fill(String(sh.fee));
  const more = sh.papers || sh.routes || sh.units || sh.second;
  if (!more) await mark(page, drawer.getByRole('button', { name: 'Add subject', exact: true }));
  await tallShot(page, more ? `sheet-${n}-${s.code.toLowerCase()}-a` : `sheet-${n}-${s.code.toLowerCase()}`, drawerBox(page));
  await unmark(page);
  await drawer.getByRole('button', { name: 'Add subject', exact: true }).click();
  await drawer.getByText('Added.', { exact: false }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(900);
  // (d) One paper only; (e) components; units.
  let changed = false;
  for (const [paper, [avail, fee]] of Object.entries(sh.papers ?? {})) {
    const line = drawer.locator('div.grid', { hasText: `${paper} only` }).first();
    await line.getByLabel('How this paper is offered').selectOption({ label: PAPER[avail] });
    if (fee) await line.getByLabel('Its course fee').fill(String(fee));
    changed = true;
  }
  for (const [route, avail] of Object.entries(sh.routes ?? {})) {
    const sel = route === 'A.2.' ? drawer.getByLabel('A.2. (carry forward)', { exact: true }) : drawer.getByLabel(route, { exact: true });
    if (await sel.count()) { await sel.selectOption({ label: ROUTE[avail] }); changed = true; } else out(`  no route ${route} on ${s.code}`);
  }
  for (const [code, [avail, teachers, online]] of Object.entries(sh.units ?? {})) {
    const box = drawer.locator('div.space-y-2.rounded-lg', { hasText: `(${code})` }).first();
    await box.getByLabel('How this unit is offered').selectOption({ label: UNIT[avail] });
    if (avail === 'open' && teachers) await tick(box, teachers, online ?? []);
    changed = true;
  }
  if (changed) {
    await mark(page, drawer.getByRole('button', { name: 'Save', exact: true }));
    await tallShot(page, `sheet-${n}-${s.code.toLowerCase()}-b`, drawerBox(page));
    await unmark(page);
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await drawer.getByText(/^(Saved\.|Nothing to change\.)$/).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(600);
  }
  // Arabic A.L.: the second qualification, chosen with its teacher.
  if (sh.second) {
    const btn = drawer.getByRole('button', { name: new RegExp(`Add a qualification:.*${sh.second.award}`) });
    await btn.scrollIntoViewIfNeeded();
    await mark(page, btn);
    await tallShot(page, `sheet-${n}-${s.code.toLowerCase()}-b`, drawerBox(page));
    await unmark(page);
    await btn.click();
    await page.waitForTimeout(500);
    const panel = drawer.locator('section[aria-labelledby=sf-add-qualification]');
    await tick(panel, [sh.second.teacher]);
    await mark(page, panel.getByRole('button', { name: 'Add the qualification' }));
    await tallShot(page, `sheet-${n}-${s.code.toLowerCase()}-c`, drawerBox(page));
    await unmark(page);
    await panel.getByRole('button', { name: 'Add the qualification' }).click();
    await drawer.getByText(/^Added Edexcel/).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(1000);
    await tallShot(page, `sheet-${n}-${s.code.toLowerCase()}-d`, drawerBox(page));
  }
  out(n, s.code, 'added');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  first = false;
}
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot(page, 'sheet-after-25');
report();
await browser.close();
