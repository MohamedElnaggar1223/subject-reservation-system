// Chapters 9-12: the board fees (paste, type), Board Services and School Fees (looked at), the boards' dates,
// Board Series, Grade 10.
import { BASE, signIn, shot, out, browser, report, mainText, mark, unmark, toTop } from './lib.mjs';
import { D, ADMIN } from './data.mjs';

const ONLY = process.env.ONLY;
const page = await signIn(ADMIN.email, ADMIN.password);
await page.goto(`${BASE}/admin/sessions`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const sessionUrl = await page.locator('a', { hasText: 'June 2027' }).first().getAttribute('href');
const BOARD = { cambridge: 'Cambridge International', pearson_edexcel: 'Pearson Edexcel', oxford: 'OxfordAQA' };
const grid = (board) => page.locator('section', { has: page.locator('h3', { hasText: BOARD[board] }) }).first();

if (!ONLY || ONLY === 'fees') {
  await page.goto(`${BASE}${sessionUrl}#fees`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await mark(page, page.getByRole('tab', { name: 'Fees' }));
  await shot(page, 'fees-empty');
  await unmark(page);
  for (const [board, key] of [['cambridge', 'cambridge_paste'], ['pearson_edexcel', 'edexcel_paste']]) {
    const g = grid(board);
    await toTop(page, g, 20);
    if (board === 'cambridge') { await mark(page, g.getByRole('button', { name: 'Paste the fee list' })); await shot(page, 'fees-paste-button'); await unmark(page); }
    await g.getByRole('button', { name: 'Paste the fee list' }).click();
    const modal = page.getByRole('dialog', { name: 'Paste the fee list' });
    await modal.getByLabel('The fee list').fill(D.fees[key].join('\n'));
    await mark(page, modal.getByRole('button', { name: 'Read the list' }));
    await shot(page, `fees-paste-${board}-typed`);
    await unmark(page);
    await modal.getByRole('button', { name: 'Read the list' }).click();
    await modal.getByText('matched').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    // Last cycle's list: not the board's published June 2027 fees — the box unticked, the rows provisional.
    const pub = modal.getByLabel("These are the board's published fees");
    if (await pub.isChecked()) await pub.uncheck();
    out(board, await modal.locator('p', { hasText: 'matched' }).first().innerText());
    await mark(page, modal.getByRole('button', { name: 'Add these fees' }));
    await mark(page, pub);
    await shot(page, `fees-paste-${board}-read`);
    await unmark(page);
    await modal.getByRole('button', { name: 'Add these fees' }).click();
    await page.waitForTimeout(1800);
  }
  // The rows no list has: typed, left provisional.
  for (const [board, rows] of Object.entries(D.fees.typed)) {
    const g = grid(board);
    await toTop(page, g, 20);
    if (board === 'cambridge') await shot(page, 'fees-cambridge-no-fee');
    for (const [code, amount] of Object.entries(rows)) await g.getByLabel(`Amount for ${code}`, { exact: true }).fill(String(amount));
    if (board === 'cambridge') { await mark(page, g.getByRole('button', { name: 'Save fees' })); await shot(page, 'fees-cambridge-typed'); await unmark(page); }
    await g.getByRole('button', { name: 'Save fees' }).click();
    await page.waitForTimeout(1800);
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  for (const b of ['cambridge', 'pearson_edexcel', 'oxford']) {
    await toTop(page, grid(b), 20);
    await shot(page, `fees-${b}-priced`);
  }
  out(await mainText(page, 400));
}

if (!ONLY || ONLY === 'services') {
  await page.goto(`${BASE}/exams/services`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await mark(page, page.locator('nav a', { hasText: 'Board Services' }).first());
  await shot(page, 'board-services');
  await unmark(page);
  await page.goto(`${BASE}/admin/school-fees`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await mark(page, page.locator('nav a', { hasText: 'School Fees' }).first());
  await shot(page, 'school-fees');
  await unmark(page);
}

if (!ONLY || ONLY === 'dates') {
  await page.goto(`${BASE}${sessionUrl}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  let firstDate = true;
  for (const [boardName, d] of Object.entries(D.deadlines)) {
    const btn = page.getByRole('button', { name: new RegExp(`^${boardName} June 2027`) });
    if (firstDate) { await mark(page, btn); await shot(page, 'dates-button'); await unmark(page); }
    await btn.click();
    const modal = page.getByRole('dialog', { name: "The board's dates" });
    await modal.locator('input[id^=deadline-]').waitFor();
    await modal.locator('input[id^=deadline-]').fill(`${d.entry}T23:59`);
    if (d.retake) await modal.locator('input[id^=retake-]').fill(`${d.retake}T23:59`);
    await modal.locator('input[id^=reason-]').fill(`${boardName} key dates for June 2027`);
    await mark(page, modal.getByRole('button', { name: 'Save the dates' }));
    if (firstDate) await shot(page, 'dates-cambridge');
    await unmark(page);
    await modal.getByRole('button', { name: 'Save the dates' }).click();
    await page.waitForTimeout(1800);
    firstDate = false;
  }
  await shot(page, 'dates-set');
  await page.goto(`${BASE}/exams/series`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'board-series');
  out(await mainText(page, 1500));
  await page.goto(`${BASE}${sessionUrl}#grade10`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'grade-10');
  out(await mainText(page, 2500));
}
report();
await browser.close();
