// Chapter 5: the Exam Catalogue — the IAL starter sets, the papers the one-paper retakes need, the awards with
// their papers and option codes, and each of the 25 subjects mapped to what it enters.
import { BASE, signIn, shot, out, browser, report, mainText, mark, unmark, toTop } from './lib.mjs';
import { D, ADMIN } from './data.mjs';

const ONLY = process.env.ONLY;
const page = await signIn(ADMIN.email, ADMIN.password);
const cat = async (tab) => { await page.goto(`${BASE}/exams/catalogue${tab ? `?tab=${tab}` : ''}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000); };

if (!ONLY || ONLY === 'starter') {
  await cat();
  for (const s of D.starter_sets) await mark(page, page.getByRole('button', { name: s }));
  await shot(page, 'catalogue-starter-buttons');
  await unmark(page);
  for (const s of D.starter_sets) { await page.getByRole('button', { name: s }).click(); await page.waitForTimeout(1800); out(await page.locator('[role=status]').first().innerText().catch(() => '')); }
  await shot(page, 'catalogue-starter-loaded');
}

if (!ONLY || ONLY === 'units') {
  await cat('units');
  for (const [i, u] of D.papers.entries()) {
    await page.selectOption('#u-board', u.board);
    await page.fill('#u-code', u.code);
    await page.fill('#u-short', u.short);
    await page.fill('#u-title', u.title);
    await page.selectOption('#u-level', 'igcse');
    await page.selectOption('#u-kind', 'component');
    if (i === 0) { await mark(page, page.getByRole('button', { name: 'Add the unit' })); await shot(page, 'units-add-paper'); await unmark(page); }
    await page.getByRole('button', { name: 'Add the unit' }).click();
    await page.waitForTimeout(900);
  }
  await page.selectOption('#units-board', 'cambridge');
  await page.waitForTimeout(600);
  await shot(page, 'units-papers-added');
}

if (!ONLY || ONLY === 'awards') {
  await cat('qualifications');
  for (const a of D.awards) {
    await page.selectOption('#q-board', a.board);
    await page.fill('#q-code', a.code);
    await page.fill('#q-title', a.title);
    await page.selectOption('#q-level', a.level);
    await page.selectOption('#q-suite', a.suite ?? '');
    await page.fill('#q-area', a.area);
    await page.selectOption('#q-method', a.method);
    if (a.code === '0970' || a.code === '9AA0' || (a.code === '9702' && a.level === 'a_level')) {
      await mark(page, page.getByRole('button', { name: 'Add the award' }));
      await shot(page, `award-add-${a.code.toLowerCase()}${a.level === 'a_level' && a.board === 'cambridge' ? '-al' : ''}`);
      await unmark(page);
    }
    await page.getByRole('button', { name: 'Add the award' }).click();
    await page.waitForTimeout(900);
  }
  const card = (a) => page.locator('article', { hasText: `${a.code} ${a.title}` }).first();
  for (const a of D.awards) {
    const c = card(a);
    if (a.units?.length) {
      await toTop(page, c, 20);
      await c.getByRole('button', { name: 'Edit units' }).click();
      for (const code of a.units) await c.locator('li', { hasText: code }).locator('input[type=checkbox]').check();
      if (a.code === '0970') { await mark(page, c.getByRole('button', { name: 'Save the units' })); await shot(page, 'award-0970-units'); await unmark(page); }
      await c.getByRole('button', { name: 'Save the units' }).click();
      await page.waitForTimeout(900);
    }
    for (const o of a.options ?? []) {
      await toTop(page, c, 20);
      await c.getByRole('button', { name: 'Add an option' }).click();
      await c.getByLabel('Option code').fill(o.code);
      await c.getByLabel('What it enters').fill(o.label);
      if (o.cf) await c.getByLabel('Carries forward marks from an earlier series').check();
      if (a.code === '0970') { await mark(page, c.getByRole('button', { name: 'Add the option' })); await shot(page, 'award-0970-option'); await unmark(page); }
      if (a.code === '9702' && o.code === 'BX') { await mark(page, c.getByRole('button', { name: 'Add the option' })); await shot(page, 'award-9702-al-option-carry'); await unmark(page); }
      await c.getByRole('button', { name: 'Add the option' }).click();
      await page.waitForTimeout(900);
    }
  }
  await toTop(page, card(D.awards.find((a) => a.code === '0970')), 20);
  await shot(page, 'award-0970-done');
  await toTop(page, card(D.awards.find((a) => a.code === '9702' && a.level === 'as_level')), 20);
  await shot(page, 'award-9702-done');
  await toTop(page, page.locator('section[aria-label="Pearson Edexcel"]').first(), 20);
  await shot(page, 'awards-pearson');
}

if (!ONLY || ONLY === 'maps') {
  await cat();
  const SHOTS = { '0970': 'map-biology', 'IAL-MATHS': 'map-ial-maths', 'ARABIC-AL': 'map-arabic-al', 'CHEM-AS': 'map-chemistry-as' };
  let first = true;
  for (const [code, m] of D.maps) {
    await page.fill('#registrable-search', code);
    await page.waitForTimeout(500);
    const row = page.locator('tr', { hasText: code }).first();
    if (first) { await mark(page, row.getByRole('button', { name: /Map it|Change/ })); await shot(page, 'map-button'); await unmark(page); first = false; }
    await row.getByRole('button', { name: /Map it|Change/ }).click();
    const dlg = page.getByRole('dialog');
    if (m.award) {
      const s = D.subjects.find((x) => x.code === code);
      const opt = await dlg.locator('#map-qualification option').evaluateAll((os, c) => os.find((o) => o.textContent.startsWith(`${c} — `))?.value, m.award);
      await dlg.locator('#map-qualification').selectOption(opt);
    }
    for (const u of m.units ?? []) await dlg.locator('li', { hasText: u }).locator('input[type=checkbox]').check();
    if (SHOTS[code]) { await mark(page, dlg.getByRole('button', { name: 'Save' })); await shot(page, SHOTS[code]); await unmark(page); }
    await dlg.getByRole('button', { name: 'Save' }).click();
    await dlg.getByRole('button', { name: 'Close' }).click({ timeout: 10000 });
    await page.waitForTimeout(400);
  }
  await page.fill('#registrable-search', '');
  await page.waitForTimeout(500);
  const only = page.getByLabel('Only subjects not mapped yet');
  if (await only.isChecked().catch(() => false)) await only.uncheck();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await shot(page, 'catalogue-all-mapped');
  await toTop(page, page.locator('table').first(), 20);
  await shot(page, 'catalogue-mapped-table');
  out(await mainText(page, 3000));
}
report();
await browser.close();
