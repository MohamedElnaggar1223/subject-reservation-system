// Part 2, the sheet: each of the 25 forms' subjects added on the Session screen with its own options in
// the forms' words (teachers, online only, the external team, how it is offered, the course fee, then its
// papers, components or units). One shot per subject: its form, filled, before the last Save.
import { signIn, BASE, shot, out, errors, browser, tallShot, drawerBox, apiAs } from './lib.mjs';
import { ADMIN, SHEET, EXTERNAL, T } from './cycle-data.mjs';

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const admin = await apiAs(ADMIN.email, ADMIN.password);
const sessions = await admin('GET', '/v1/sessions');
const june = (Array.isArray(sessions) ? sessions : sessions.sessions).find((s) => s.name === 'June 2027');
const page = await signIn(ADMIN.email, ADMIN.password);
await page.goto(`${BASE}/admin/sessions/${june.id}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const OFFERED = { open: 'First entry and retakes', retake_only: 'Retakes only', self_study_only: 'Retake (Self Study ONLY)' };
const PAPER = { retake_only: 'Retake in school or self study', self_study_only: 'Retake self study only', closed: 'Not offered this cycle' };
const ROUTE = { open: 'Offered', self_study_only: 'Self study only', closed: 'Not offered this cycle' };
const UNIT = { open: 'Taught by', self_study_only: 'Self study only', closed: 'Not this cycle' };
const exact = (s) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** Tick teachers by name in a teacher picker (scope), "online only" for those in `online`. */
async function tick(scope, names, online = []) {
  for (const n of names) {
    const row = scope.locator('div.flex.items-center.justify-between', { has: page.locator('bdi', { hasText: exact(n) }) }).first();
    const box = row.locator('input[type=checkbox]').first();
    if (!(await box.isChecked())) await box.check();
    if (online.includes(n)) await row.locator('input[type=checkbox]').nth(1).check();
  }
}

let first = true;
for (const [i, s] of SHEET.entries()) {
  if (ONLY && !ONLY.includes(s.code)) continue;
  if (process.env.QUAL_ONLY) continue;
  const n = String(i + 1).padStart(2, '0');
  // Add subject → search → pick.
  const addButton = page.getByRole('button', { name: /^Add subjects?$/ }).first();
  await addButton.click();
  const modal = page.getByRole('dialog', { name: 'Add subject' });
  await modal.locator('#as-search').fill(s.code);
  await page.waitForTimeout(600);
  if (first) await shot(page, 'p2-22-add-subject-search');
  await modal.getByRole('option').first().click();
  await page.waitForTimeout(800);
  const drawer = page.locator('div[role=dialog]').last();
  // (a) Teachers this cycle; the external team.
  if (s.external) {
    const known = drawer.locator('bdi', { hasText: exact(EXTERNAL) });
    if (await known.count()) await tick(drawer, [EXTERNAL]);
    else { await drawer.locator('#sf-team').fill(EXTERNAL); await drawer.getByRole('button', { name: 'Add', exact: true }).click(); }
  }
  if (s.teachers) await tick(drawer, s.teachers, s.online ?? []);
  // (b) Offered as; (c) the course fee.
  await drawer.locator('label', { hasText: OFFERED[s.offered] }).first().click();
  await drawer.locator('#sf-fee').fill(String(s.fee));
  if (first) await tallShot(page, 'p2-23-add-subject-form', drawerBox(page));
  await drawer.getByRole('button', { name: 'Add subject', exact: true }).click();
  await drawer.getByText('Added.', { exact: false }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  // (d) One paper only; (e) components; units.
  let changed = false;
  for (const [paper, [avail, fee]] of Object.entries(s.papers ?? {})) {
    const line = drawer.locator('div.grid', { hasText: `${paper} only` }).first();
    await line.getByLabel('How this paper is offered').selectOption({ label: PAPER[avail] });
    if (fee) await line.getByLabel('Its course fee').fill(String(fee));
    changed = true;
  }
  for (const [route, avail] of Object.entries(s.routes ?? {})) {
    const sel = route === 'A.2.' ? drawer.getByLabel('A.2. (carry forward)', { exact: true }) : drawer.getByLabel(route, { exact: true });
    if (await sel.count()) { await sel.selectOption({ label: ROUTE[avail] }); changed = true; }
  }
  for (const [code, [avail, teachers, online]] of Object.entries(s.units ?? {})) {
    const box = drawer.locator('div.space-y-2.rounded-lg', { hasText: `(${code})` }).first();
    await box.getByLabel('How this unit is offered').selectOption({ label: UNIT[avail] });
    if (avail === 'open' && teachers) await tick(box, teachers, online ?? []);
    changed = true;
  }
  await tallShot(page, `p2-s${n}-${s.code.toLowerCase()}`, drawerBox(page));
  if (changed) {
    await drawer.getByRole('button', { name: 'Save', exact: true }).click();
    await drawer.getByText(/^(Saved\.|Nothing to change\.)$/).first().waitFor({ timeout: 15000 });
  }
  out(n, s.code, 'added');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  first = false;
}

// Arabic A.L.: the second qualification (GCE 9AA0). No screen adds a qualification under a subject
// (decision 4: the item endpoint only): made through the API, then shown on the subject's form.
if (!ONLY || ONLY.includes('ARABIC-AL')) {
  const list = await admin('GET', `/v1/sessions/${june.id}/offers`);
  const ar = list.offers.find((o) => o.subject.code === 'ARABIC-AL');
  const cat = await admin('GET', '/v1/catalogue');
  const gce = cat.qualifications.find((q) => q.boardCode === 'pearson_edexcel' && q.code === '9AA0');
  const teachers = await admin('GET', '/v1/teachers');
  const tid = (name) => teachers.find((t) => t.name === name).id;
  if (ar && !ar.items.some((it) => it.kind === 'qualification')) {
    const whole = ar.items.find((it) => it.kind === 'whole');
    await admin('PUT', `/v1/sessions/${june.id}/offers/${ar.id}/items/${whole.id}`, { label: 'Arabic IAL (YAA01)', exclusiveGroup: 'qualification', teachers: [{ teacherId: tid(T(25)), mode: 'in_school' }] });
    await admin('POST', `/v1/sessions/${june.id}/offers/${ar.id}/items`, {
      label: 'Arabic GCE (9AA0)', kind: 'qualification', enters: { kind: 'award', qualificationId: gce.id }, availability: 'open', requiredInSeries: false,
      exclusiveGroup: 'qualification', teachers: [{ teacherId: tid(T(26)), mode: 'in_school' }],
    });
    // The offer's teachers: both.
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('tr', { hasText: 'Arabic A.L.' }).first().click();
  await page.waitForTimeout(1000);
  await tallShot(page, 'p2-s18b-arabic-al-two-qualifications', drawerBox(page));
  await page.keyboard.press('Escape');
}
out('errors', errors);
await browser.close();
