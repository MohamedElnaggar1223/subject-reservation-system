// Part 2, the fees from the boards' lists (Fees tab: "Paste the fee list" per sitting; the rows no list has
// typed by hand, left "provisional"), and the boards' deadlines from the session's header.
import { signIn, BASE, shot, out, errors, browser, apiAs, toTop, tallShot, mainBox } from './lib.mjs';
import { ADMIN, FEES_PASTE, FEES_TYPED, DEADLINES } from './cycle-data.mjs';

const ONLY = process.env.ONLY;
const admin = await apiAs(ADMIN.email, ADMIN.password);
const june = (await admin('GET', '/v1/sessions')).find((s) => s.name === 'June 2027');
const page = await signIn(ADMIN.email, ADMIN.password);
const BOARD = { cambridge: 'Cambridge International', pearson_edexcel: 'Pearson Edexcel', oxford: 'OxfordAQA' };
const grid = (board) => page.locator('section', { has: page.locator('h3', { hasText: BOARD[board] }) }).first();

if (!ONLY || ONLY === 'fees') {
  await page.goto(`${BASE}/admin/sessions/${june.id}#fees`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, 'p2-24-fees-empty');
  for (const board of ['cambridge', 'pearson_edexcel']) {
    const g = grid(board);
    await toTop(page, g);
    await g.getByRole('button', { name: 'Paste the fee list' }).click();
    const modal = page.getByRole('dialog', { name: 'Paste the fee list' });
    await modal.getByLabel('The fee list').fill(FEES_PASTE[board].join('\n'));
    await modal.getByRole('button', { name: 'Read the list' }).click();
    await modal.getByText('matched').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await shot(page, `p2-25-fees-paste-${board}`);
    await modal.getByRole('button', { name: 'Add these fees' }).click();
    await page.waitForTimeout(1500);
  }
  // The rows no list has: typed, provisional ("These are the board's published fees" left unticked).
  for (const [board, rows] of Object.entries(FEES_TYPED)) {
    const g = grid(board);
    await toTop(page, g);
    for (const [code, amount] of Object.entries(rows)) await g.getByLabel(`Amount for ${code}`, { exact: true }).fill(String(amount));
    if (board === 'cambridge') await shot(page, 'p2-26-fees-typed');
    await g.getByRole('button', { name: 'Save fees' }).click();
    await page.waitForTimeout(1500);
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await toTop(page, grid('cambridge'), 20);
  await shot(page, 'p2-27-fees-cambridge');
  await toTop(page, grid('pearson_edexcel'), 20);
  await shot(page, 'p2-27b-fees-pearson');
}

if (!ONLY || ONLY === 'dates') {
  await page.goto(`${BASE}/admin/sessions/${june.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  for (const [boardName, d] of Object.entries(DEADLINES)) {
    await page.getByRole('button', { name: new RegExp(`^${boardName} June 2027`) }).click();
    const modal = page.getByRole('dialog', { name: "The board's dates" });
    await modal.locator('input[id^=deadline-]').fill(`${d.entry}T23:59`);
    if (d.retake) await modal.locator('input[id^=retake-]').fill(`${d.retake}T23:59`);
    await modal.locator('input[id^=reason-]').fill(`${boardName} key dates for June 2027`);
    if (boardName === 'Cambridge International') await shot(page, 'p2-28-dates-cambridge');
    await modal.getByRole('button', { name: 'Save the dates' }).click();
    await page.waitForTimeout(1500);
  }
  await shot(page, 'p2-29-dates-set');
  await toTop(page, page.getByText('A.S. / A.L.', { exact: true }).first(), 20).catch(() => {});
  await shot(page, 'p2-29b-sheet-as-al');
}
out('errors', errors);
await browser.close();
