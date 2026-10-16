// Part 2, the Catalogue: the forms' subjects added (Subjects → Import CSV, by its address since the
// decisions of 16 Oct hide it from the sidebar), the seed's samples the forms do not use deactivated,
// the IAL starter sets, the papers the one-paper retakes need, the awards with their papers and option
// codes, and every subject mapped to what it enters.
import { signIn, BASE, shot, out, errors, browser, mainText, toTop } from './lib.mjs';
import { ADMIN, SUBJECTS_CSV, SEED_SAMPLES_RETIRED, UNITS, AWARDS, STARTER_SETS, MAPS } from './cycle-data.mjs';

const ONLY = process.env.ONLY; // run one part again while building the drive
const page = await signIn(ADMIN.email, ADMIN.password);
page.on('dialog', (d) => d.accept());

// 1. The forms' subjects, pasted on Subjects → Import CSV.
if (!ONLY || ONLY === 'subjects') {
  await page.goto(`${BASE}/admin/subjects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const csv = ['name,code,council,level,courseFee', ...SUBJECTS_CSV.map((r) => r.join(','))].join('\n');
  await page.locator('textarea').first().fill(csv);
  await shot(page, 'p2-06-subjects-import');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.waitForTimeout(6000);
  out(await mainText(page, 600));
  await shot(page, 'p2-07-subjects-imported');
}
if (!ONLY || ONLY === 'subjects' || ONLY === 'retire') {
  await page.goto(`${BASE}/admin/subjects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  // 2. The seed's samples the forms do not use: Deactivate on each row (a core one is un-cored first).
  for (const code of SEED_SAMPLES_RETIRED) {
    const row = page.locator('tr', { hasText: code }).filter({ has: page.getByRole('button', { name: 'Deactivate' }) }).first();
    if (await row.count()) {
      const core = row.locator('button[title="Remove core designation"]');
      if (await core.count()) { await core.click(); await page.waitForTimeout(800); }
      await row.getByRole('button', { name: 'Deactivate' }).click();
      await page.waitForTimeout(700);
    }
  }
  await page.waitForTimeout(1000);
  await shot(page, 'p2-08-subjects-samples-deactivated');
}

const cat = async (tab) => {
  await page.goto(`${BASE}/exams/catalogue${tab ? `?tab=${tab}` : ''}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
};

// 3. The IAL starter sets.
if (!ONLY || ONLY === 'starter') {
  await cat();
  for (const s of STARTER_SETS) {
    await page.getByRole('button', { name: s }).click();
    await page.waitForTimeout(1500);
  }
  await shot(page, 'p2-09-catalogue-starter-sets');
}

// 4. The papers, on Units and papers.
if (!ONLY || ONLY === 'units') {
  await cat('units');
  for (const [i, u] of UNITS.entries()) {
    await page.selectOption('#u-board', u.board);
    await page.fill('#u-code', u.code);
    await page.fill('#u-short', u.short);
    await page.fill('#u-title', u.title);
    await page.selectOption('#u-level', u.level);
    await page.selectOption('#u-kind', u.kind);
    if (i === 2) await shot(page, 'p2-10-catalogue-add-paper');
    await page.getByRole('button', { name: 'Add the unit' }).click();
    await page.waitForTimeout(900);
  }
}

// 5. The awards, on Qualifications.
if (!ONLY || ONLY === 'awards') {
  await cat('qualifications');
  for (const a of AWARDS) {
    await page.selectOption('#q-board', a.board);
    await page.fill('#q-code', a.code);
    await page.fill('#q-title', a.title);
    await page.selectOption('#q-level', a.level);
    if (a.suite) await page.selectOption('#q-suite', a.suite);
    await page.fill('#q-area', a.area);
    await page.selectOption('#q-method', a.method);
    if (a.code === '0970') await shot(page, 'p2-11-catalogue-add-award');
    await page.getByRole('button', { name: 'Add the award' }).click();
    await page.waitForTimeout(900);
  }
  // 6. Each award's papers (Edit units), and the option codes of the A levels.
  for (const a of AWARDS) {
    const card = page.locator('article', { hasText: `${a.code} ${a.title}` }).first();
    if (a.units?.length) {
      await toTop(page, card);
      await card.getByRole('button', { name: 'Edit units' }).click();
      for (const code of a.units) await card.locator('li', { hasText: code }).locator('input[type=checkbox]').check();
      if (a.code === '0970') await shot(page, 'p2-12-catalogue-award-papers');
      await card.getByRole('button', { name: 'Save the units' }).click();
      await page.waitForTimeout(900);
    }
    for (const o of a.options ?? []) {
      await toTop(page, card);
      await card.getByRole('button', { name: 'Add an option' }).click();
      await card.getByLabel('Option code').fill(o.code);
      await card.getByLabel('What it enters').fill(o.label);
      if (o.cf) await card.getByLabel('Carries forward marks from an earlier series').check();
      if (a.code === '9702' && o.code === 'BX') await shot(page, 'p2-13-catalogue-option-carry-forward');
      await card.getByRole('button', { name: 'Add the option' }).click();
      await page.waitForTimeout(900);
    }
  }
  await toTop(page, page.locator('article', { hasText: '9702 Physics (AS Level)' }).first());
  await shot(page, 'p2-14-catalogue-a-level-routes');
}

// 7. Map each subject: what it enters.
if (!ONLY || ONLY === 'maps') {
  await cat();
  for (const [code, m] of MAPS) {
    await page.fill('#registrable-search', code);
    await page.waitForTimeout(500);
    const row = page.locator('tr', { hasText: code }).first();
    await row.getByRole('button', { name: /Map it|Change/ }).click();
    const dlg = page.getByRole('dialog');
    if (m.award) {
      const opt = await dlg.locator('#map-qualification option').evaluateAll((os, c) => os.find((o) => o.textContent.startsWith(`${c} — `))?.value, m.award);
      await dlg.locator('#map-qualification').selectOption(opt);
    }
    for (const u of m.units ?? []) await dlg.locator('li', { hasText: u }).locator('input[type=checkbox]').check();
    if (code === '0970') await shot(page, 'p2-15-catalogue-map-biology');
    if (code === 'IAL-MATHS') await shot(page, 'p2-16-catalogue-map-ial-maths');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await dlg.getByRole('button', { name: 'Close' }).click({ timeout: 10000 });
    await page.waitForTimeout(400);
  }
  const only = page.getByLabel('Only subjects not mapped yet');
  if (await only.isChecked().catch(() => false)) await only.uncheck();
  await page.fill('#registrable-search', 'Biology');
  await page.waitForTimeout(800);
  await toTop(page, page.locator('#registrable-search'), 120);
  await shot(page, 'p2-17-catalogue-mapped');
  out(await mainText(page, 1500));
}
out('errors', errors);
await browser.close();
