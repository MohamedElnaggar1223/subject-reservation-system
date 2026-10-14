// F6a "after" drive: every screen changed, as the admin, the coordinator, a parent and a finance
// officer, in English and Arabic (right to left), with the six form shapes and their previews.
import { BASE, browser, errors, out, signIn, shot, step, mainText } from './lib.mjs';
const JUNE = '0f1fecbd-152b-4f1b-9bec-701bd03fd6b9';
const WINTER = '801faefd-9d95-442a-9251-e42285b3cdca';
const JUNE28 = '51b42a30-3cec-4c8b-a15e-9e067875312b';
const only = process.argv[2] ?? 'all';

/** Visible text left in Latin letters on an Arabic page, outside data (names, codes: data-i18n-skip). */
async function latinLeft(page) {
  return page.evaluate(() => {
    const out = new Set();
    const w = document.createTreeWalker(document.querySelector('main') ?? document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode;
      const el = n.parentElement;
      if (!el || el.closest('[data-i18n-skip="true"]') || el.closest('script,style')) continue;
      const t = (n.nodeValue ?? '').trim();
      if (!/[A-Za-z]{3,}/.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      out.add(t.slice(0, 120));
    }
    for (const el of document.querySelectorAll('[role=dialog] select option, main select option')) {
      const t = (el.textContent ?? '').trim();
      if (/[A-Za-z]{3,}/.test(t) && !el.closest('[data-i18n-skip="true"]') && !el.hasAttribute('data-i18n-skip')) out.add('option: ' + t.slice(0, 80));
    }
    return [...out];
  });
}
const latin = {};
const noteLatin = async (page, name) => { latin[name] = await latinLeft(page); };
const drawerOf = (page) => page.locator('[role=dialog]').last();
async function openRow(page, name) {
  await page.locator('table button', { hasText: name }).first().click();
  await page.waitForTimeout(1500);
}
async function drawerShots(page, name) {
  const d = drawerOf(page);
  const scroller = d.locator('div.overflow-y-auto').first();
  await shot(page, `${name}-a`, { full: false });
  await scroller.evaluate((e) => { e.scrollTop = e.scrollHeight / 2 - 300; });
  await shot(page, `${name}-b`, { full: false });
  await scroller.evaluate((e) => { e.scrollTop = e.scrollHeight; });
  await shot(page, `${name}-c`, { full: false });
  await scroller.evaluate((e) => { e.scrollTop = 0; });
}
async function closeAll(page) {
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
}
async function preview(page, subject, name) {
  await page.locator('tr', { has: page.locator('button', { hasText: subject }) }).first().locator('button', { hasText: /Preview the family's form|معاينة نموذج الأسرة/ }).click();
  await page.waitForTimeout(2000);
  await shot(page, name, { full: false });
  await closeAll(page);
}

// ── 1. The parent: the Reserve page preselects the only child and the only open session; a reservation for the "not offered" refusal ──
if (only === 'all' || only === 'parent') {
  for (const lang of ['en', 'ar']) {
    const page = await signIn('parent.hany@igcse.local', 'TestPass1', lang);
    await step(`register ${lang}`, async () => {
      await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      const sels = page.locator('main select');
      out(lang, 'child:', await sels.nth(0).inputValue(), '| session:', await sels.nth(1).locator('option:checked').innerText());
      await shot(page, `after-07-register-${lang}`);
      if (lang === 'ar') await noteLatin(page, 'register-ar');
      if (lang === 'en') {
        const row = page.locator('tbody tr', { has: page.locator('[aria-label="Arabic Language: All papers"]') }).first();
        await row.locator('input[type=checkbox]').check();
        await page.waitForTimeout(800);
        for (const box of await page.locator('main label', { hasText: /I confirm|read the refund/i }).locator('input[type=checkbox]').all()) await box.check();
        await shot(page, 'after-07-register-ticked-en');
        await page.locator('main').getByRole('button', { name: /^Reserve/ }).last().click();
        await page.waitForTimeout(2500);
        out('reserved:', (await mainText(page, 300)).replace(/\n+/g, ' | '));
      }
    });
    await page.context().close();
  }
}

// ── 2. The admin, English: each shape's form saved, its preview, the refusal, the dates, the empty sheet ──
if (only === 'all' || only === 'admin') {
  const page = await signIn('admin@igcse.local', 'AdminPass1', 'en');
  await page.goto(`${BASE}/admin/sessions/${JUNE}#subjects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await step('cambridge dates from the header', async () => {
    await page.locator('main button', { hasText: /Cambridge International June 2027/ }).first().click();
    await page.waitForTimeout(1500);
    const dlg = page.locator('[role=dialog]').last();
    await dlg.locator('input[type=datetime-local]').nth(0).fill('2027-02-20T12:00');
    await dlg.locator('input[type=datetime-local]').nth(1).fill('2027-03-20T12:00');
    await dlg.locator('input[id^=reason-]').fill('Cambridge June 2027 key dates published');
    await shot(page, 'after-m3-dates-dialog-cambridge-en', { full: false });
    await dlg.getByRole('button', { name: 'Save the dates' }).click();
    await page.waitForTimeout(2000);
  });
  await step('biology', async () => {
    await openRow(page, /^Biology$/);
    const d = drawerOf(page);
    const line = d.locator('div.grid', { hasText: 'Paper 4' }).first();
    await line.locator('select').selectOption({ label: 'Retake in school or self study' });
    await line.locator('input[type=number]').fill('3000');
    await d.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(2000);
    await drawerShots(page, 'after-02-form-biology-en');
    await closeAll(page);
  });
  await step('ial', async () => {
    await openRow(page, 'Mathematics A.S./A.L.');
    const d = drawerOf(page);
    const unit = (code) => d.locator('div.space-y-2.rounded-lg', { hasText: code }).first();
    for (const code of ['WMA11', 'WMA12']) {
      await unit(code).locator('label', { hasText: 'Teacher A' }).locator('input[type=checkbox]').first().check();
      await page.waitForTimeout(200);
      await unit(code).locator('label', { hasText: 'online only' }).locator('input[type=checkbox]').first().check();
    }
    await unit('WME01').locator('label', { hasText: 'Teacher B' }).locator('input[type=checkbox]').first().check().catch(async () => {
      await unit('WME01').getByText('Show every teacher').click();
      await unit('WME01').locator('label', { hasText: 'Teacher B' }).locator('input[type=checkbox]').first().check();
    });
    await unit('WME01').locator('label', { hasText: 'Teacher A' }).locator('input[type=checkbox]').first().check();
    await unit('WMA14').locator('select').selectOption({ label: 'Not this cycle' });
    await unit('WST01').locator('select').selectOption({ label: 'Self study only' });
    await unit('WST01').locator('input[type=number]').fill('2000');
    await d.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(2000);
    await drawerShots(page, 'after-03-form-ial-en');
    out('ial saved:', (await d.innerText()).slice(0, 120).replace(/\n+/g, ' | '));
    await closeAll(page);
  });
  await step('a level', async () => {
    await openRow(page, 'Physics A.S./A.L.');
    const d = drawerOf(page);
    const route = (word) => d.locator('div.grid', { hasText: word }).first();
    await route('A.S.').locator('input[type=number]').fill('14000');
    await route('A.2.').locator('select').selectOption({ label: 'Self study only' });
    await route('A.2.').locator('input[type=number]').fill('11400');
    await route('A.L.').locator('select').selectOption({ label: 'Not offered' });
    await d.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(2000);
    await drawerShots(page, 'after-04-form-alevel-en');
    await closeAll(page);
  });
  await step('arabic al', async () => {
    await openRow(page, 'Arabic A.L.');
    await drawerShots(page, 'after-05-form-arabic-al-en');
    await closeAll(page);
  });
  await step('retake self study only', async () => {
    await openRow(page, /^Chemistry$/);
    const d = drawerOf(page);
    await d.locator('label', { hasText: 'Retake (Self Study ONLY)' }).locator('input[type=radio]').check();
    await d.locator('label', { hasText: 'Teacher B' }).locator('input[type=checkbox]').first().uncheck();
    await d.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(2000);
    await drawerShots(page, 'after-06-form-retake-self-study-en');
    await closeAll(page);
  });
  await step('sheet after', async () => {
    await page.goto(`${BASE}/admin/sessions/${JUNE}#subjects`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await shot(page, 'after-01-sheet-en');
    out('sheet:', (await mainText(page, 4000)).replace(/\n+/g, ' | ').slice(0, 3000));
  });
  for (const [subject, name] of [['Arabic Language', 'ol'], [/^Biology$/, 'ol-one-paper'], [/^Chemistry$/, 'retake-self-study'], ['Mathematics A.S./A.L.', 'ial'], ['Physics A.S./A.L.', 'a-level'], ['Arabic A.L.', 'arabic-al']]) {
    await step(`preview ${name}`, async () => preview(page, subject, `after-09-preview-${name}-en`));
  }
  await step('add to winter', async () => {
    await page.goto(`${BASE}/admin/sessions/${WINTER}#subjects`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await shot(page, 'after-10-empty-winter-en');
    await page.getByRole('button', { name: 'Add subjects' }).click();
    await page.waitForTimeout(800);
    await page.locator('[role=option]', { hasText: 'Mathematics A.S./A.L.' }).click();
    await page.waitForTimeout(1000);
    const d = drawerOf(page);
    await d.locator('#sf-fee').fill('4000');
    await d.locator('label', { hasText: 'Teacher A' }).locator('input[type=checkbox]').first().check();
    await d.getByRole('button', { name: 'Add subject', exact: true }).click();
    await page.waitForTimeout(2500);
    const unit = (code) => d.locator('div.space-y-2.rounded-lg', { hasText: code }).first();
    await unit('WMA13').locator('select').last().selectOption({ index: 2 });
    await unit('WMA14').locator('select').last().selectOption({ index: 2 });
    await d.locator('div.overflow-y-auto').first().evaluate((e) => { e.scrollTop = e.scrollHeight / 2; });
    await shot(page, 'after-11-winter-units-sittings-en', { full: false });
    await d.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(2000);
    await closeAll(page);
    await page.goto(`${BASE}/admin/sessions/${WINTER}#subjects`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await shot(page, 'after-11-winter-sheet-en');
  });
  await step('series page', async () => {
    await page.goto(`${BASE}/exams/series`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.locator('tbody tr', { hasText: /2027/ }).first().locator('button').first().click();
    await page.waitForTimeout(800);
    await page.locator('input[type=datetime-local]').first().fill('2027-02-20T12:00');
    await shot(page, 'after-12-series-page-reason-en');
  });
  await step('empty june 2028: copy from the last June', async () => {
    await page.goto(`${BASE}/admin/sessions/${JUNE28}#subjects`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await shot(page, 'after-13-empty-copy-en');
  });
  await page.context().close();
}

// ── 2b. The admin, after the family's reservation: "Not offered this cycle" says its reservation stands ──
if (only === 'admin-not-offered') {
  const page = await signIn('admin@igcse.local', 'AdminPass1', 'en');
  await page.goto(`${BASE}/admin/sessions/${JUNE}#subjects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await step('not offered with a reservation', async () => {
    await openRow(page, 'Arabic Language');
    const d = drawerOf(page);
    await d.locator('label', { hasText: 'Not offered this cycle' }).locator('input[type=radio]').check();
    await page.waitForTimeout(500);
    await d.locator('div.overflow-y-auto').first().evaluate((e) => { e.scrollTop = e.scrollHeight; });
    await shot(page, 'after-08-not-offered-with-reservation-en', { full: false });
    // The server's own refusal, as the screen says it, if the tick were bypassed: the button stays off until ticked.
    out('save disabled until ticked:', await d.getByRole('button', { name: 'Save', exact: true }).isDisabled());
    await closeAll(page);
  });
  await page.context().close();
}

// ── 3. The admin, Arabic: the same screens read right to left ──
if (only === 'all' || only === 'admin-ar') {
  const page = await signIn('admin@igcse.local', 'AdminPass1', 'ar');
  await page.goto(`${BASE}/admin/sessions/${JUNE}#subjects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await step('sheet ar', async () => { await shot(page, 'after-01-sheet-ar'); await noteLatin(page, 'sheet-ar'); });
  for (const [subject, name] of [[/^Biology$/, 'after-02-form-biology-ar'], ['Mathematics A.S./A.L.', 'after-03-form-ial-ar'], ['Physics A.S./A.L.', 'after-04-form-alevel-ar'], ['Arabic A.L.', 'after-05-form-arabic-al-ar'], [/^Chemistry$/, 'after-06-form-retake-self-study-ar']]) {
    await step(name, async () => { await openRow(page, subject); await drawerShots(page, name); await noteLatin(page, name); await closeAll(page); });
  }
  await step('not offered ar', async () => {
    await openRow(page, 'Arabic Language');
    const d = drawerOf(page);
    await d.locator('input[type=radio]').nth(3).check();
    await page.waitForTimeout(500);
    await d.locator('div.overflow-y-auto').first().evaluate((e) => { e.scrollTop = e.scrollHeight; });
    await shot(page, 'after-08-not-offered-with-reservation-ar', { full: false });
    await noteLatin(page, 'not-offered-ar');
    await closeAll(page);
  });
  for (const [subject, name] of [['Arabic Language', 'ol'], [/^Biology$/, 'ol-one-paper'], [/^Chemistry$/, 'retake-self-study'], ['Mathematics A.S./A.L.', 'ial'], ['Physics A.S./A.L.', 'a-level'], ['Arabic A.L.', 'arabic-al']]) {
    await step(`preview ${name} ar`, async () => {
      await page.locator('tr', { has: page.locator('button', { hasText: subject }) }).first().locator('button', { hasText: /معاينة نموذج الأسرة/ }).click();
      await page.waitForTimeout(2000);
      await shot(page, `after-09-preview-${name}-ar`, { full: false });
      await noteLatin(page, `preview-${name}-ar`);
      await closeAll(page);
    });
  }
  await step('dates ar', async () => {
    await page.locator('main button', { hasText: /Pearson Edexcel/ }).first().click();
    await page.waitForTimeout(1500);
    await shot(page, 'after-m3-dates-dialog-ar', { full: false });
    await noteLatin(page, 'dates-ar');
    await closeAll(page);
  });
  await step('winter ar', async () => {
    await page.goto(`${BASE}/admin/sessions/${WINTER}#subjects`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await shot(page, 'after-11-winter-sheet-ar');
    await openRow(page, 'Mathematics A.S./A.L.');
    await drawerShots(page, 'after-11-winter-units-sittings-ar');
    await noteLatin(page, 'winter-form-ar');
    await closeAll(page);
  });
  await step('series page ar', async () => {
    await page.goto(`${BASE}/exams/series`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.locator('tbody tr', { hasText: /2027/ }).first().locator('button').first().click();
    await page.waitForTimeout(800);
    await page.locator('input[type=datetime-local]').first().fill('2027-02-20T12:00');
    await shot(page, 'after-12-series-page-reason-ar');
  });
  await step('empty ar', async () => {
    await page.goto(`${BASE}/admin/sessions/${JUNE28}#subjects`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await shot(page, 'after-13-empty-copy-ar');
    await noteLatin(page, 'empty-ar');
    await page.getByRole('button', { name: 'Add subjects' }).or(page.locator('main button', { hasText: 'إضافة المواد' })).first().click();
    await page.waitForTimeout(800);
    await shot(page, 'after-14-add-subject-ar', { full: false });
    await noteLatin(page, 'add-subject-ar');
    await closeAll(page);
  });
  await page.context().close();
}

// ── 4. The coordinator: the sheet, the form, the dates (the entry deadline stays the admin's) ──
if (only === 'all' || only === 'coordinator') {
  for (const lang of ['en', 'ar']) {
    const page = await signIn('coordinator.words@igcse.local', 'TestPass1', lang);
    await step(`coordinator ${lang}`, async () => {
      await page.goto(`${BASE}/admin/sessions/${JUNE}#subjects`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      await shot(page, `after-15-coordinator-sheet-${lang}`);
      await openRow(page, 'Physics A.S./A.L.');
      await shot(page, `after-15-coordinator-form-${lang}`, { full: false });
      await closeAll(page);
      await page.locator('main button', { hasText: /Pearson Edexcel/ }).first().click();
      await page.waitForTimeout(1500);
      await shot(page, `after-15-coordinator-dates-${lang}`, { full: false });
      if (lang === 'ar') await noteLatin(page, 'coordinator-dates-ar');
      await closeAll(page);
      await page.locator('tr', { has: page.locator('button', { hasText: /^Biology$/ }) }).first().locator('button', { hasText: /Preview the family's form|معاينة نموذج الأسرة/ }).click();
      await page.waitForTimeout(2000);
      await shot(page, `after-15-coordinator-preview-${lang}`, { full: false });
      await closeAll(page);
    });
    await page.context().close();
  }
}

// ── 5. A finance officer: the header's deadlines are read, not buttons; no Subjects tab ──
if (only === 'all' || only === 'finance') {
  const page = await signIn('officer.mona@igcse.local', 'TestPass1', 'en');
  await step('finance', async () => {
    await page.goto(`${BASE}/admin/sessions/${JUNE}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    out('finance deadline buttons:', await page.locator('main button', { hasText: /June 2027:/ }).count());
    await shot(page, 'after-16-finance-header-en', { full: false });
  });
  await page.context().close();
}

out('LATIN LEFT ON ARABIC PAGES:', JSON.stringify(latin, null, 1));
out('ERRORS:', errors.filter((e) => !/Hydration/.test(e)).join('\n') || 'none');
await browser.close();
