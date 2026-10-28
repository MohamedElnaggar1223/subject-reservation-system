// Part C: June 2028 made by copying June 2027. The coordinator: New session (June, 2028, copy the last June session),
// the dates the copy moved, the boards' new lists pasted, what is left, then prices final and open once the admin has
// entered the three boards' June 2028 entry deadlines. The lists pasted are the school's newest (June 2026): June 2027's
// are not published yet, so the screen names them for the June 2027 fees (the list a year on).
import fs from 'node:fs';
import { signedIn, go, shot, shotMarked, toTop, settle, out, browser, report, mainText, BASE, SHOTS } from './lib.mjs';
import { ADMIN, COORDINATOR, TEMP_PASSWORD, listText, JUNE_2028_ENTRY } from './data.mjs';

const facts = {};
const page = await signedIn(COORDINATOR.email, TEMP_PASSWORD);
await go(page, '/admin/sessions');
await shotMarked(page, 'c-sessions', page.getByRole('button', { name: 'New session' }).first());
await page.getByRole('button', { name: 'New session' }).first().click();
const dlg = page.getByRole('dialog');
await dlg.waitFor();
await page.waitForTimeout(400);
facts.dialog = (await dlg.innerText()).replace(/\s+/g, ' ');
facts.picked = { type: await page.locator('#ns-type').inputValue(), year: await page.locator('#ns-year').inputValue(), from: await page.locator('#ns-from').inputValue() };
await shotMarked(page, 'c-new-session', dlg.getByRole('button', { name: /^Create/ }));
await dlg.getByRole('button', { name: /^Create/ }).click();
await page.waitForURL(/\/admin\/sessions\/[0-9a-f-]{36}$/, { timeout: 60000 });
await settle(page);
const sessionPath = new URL(page.url()).pathname;
fs.writeFileSync(`${SHOTS}/../session-2028.txt`, sessionPath);
await shot(page, 'c-session');
const checks = page.locator('#checks');
const line = (text) => checks.locator('li', { hasText: text }).last();
facts.checkList = (await checks.locator('li').allInnerTexts()).map((x) => x.split('\n')[0]);

// The dates the copy moved a year: kept.
{
  const l = line('The copy moved the dates');
  await toTop(page, l, 160);
  await shotMarked(page, 'c-dates', l.getByRole('button', { name: 'Keep them' }));
  await l.getByRole('button', { name: 'Keep them' }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('#checks li')].some((x) => x.textContent.includes('The copy moved the dates')), null, { timeout: 30000 });
  await settle(page);
}

// The subjects as copied: a subject not taught this cycle is switched off on its tile (not done here).
await page.getByRole('tab', { name: /^Subjects/ }).click();
await settle(page);
await toTop(page, page.getByRole('tablist'), 10);
await shotMarked(page, 'c-subjects', page.getByRole('switch').filter({ hasNot: page.locator('[aria-label="Accepting reservations"]') }).nth(2));

// Prices: the boards' lists pasted, each read and used.
await page.getByRole('tab', { name: /^Prices/ }).click();
await page.getByRole('heading', { name: 'Paste a list as printed' }).waitFor();
await settle(page);
await toTop(page, page.getByRole('tablist'), 10);
await shot(page, 'c-prices');
facts.lists = {};
for (const [board, list, tag] of [['cambridge', 'Cambridge June 2026', 'cambridge'], ['pearson_edexcel', 'Edexcel June 2026', 'edexcel']]) {
  await page.locator('#pl-board').selectOption(board);
  await page.locator('#pl-text').fill(listText(list));
  const sec = page.locator('section', { has: page.getByRole('heading', { name: 'Paste a list as printed' }) });
  facts.lists[tag] = { name: await sec.locator('strong').first().innerText() };
  if (tag === 'cambridge') {
    await toTop(page, page.getByRole('heading', { name: 'Paste a list as printed' }), 70);
    await shotMarked(page, 'c-paste-cambridge', [page.locator('#pl-for'), page.getByRole('button', { name: 'Read the list' })]);
  }
  await page.getByRole('button', { name: 'Read the list' }).click();
  await page.getByRole('button', { name: 'Use these prices' }).waitFor();
  await settle(page);
  facts.lists[tag].read = (await sec.locator('h3').allInnerTexts()).join(' | ');
  await toTop(page, sec.locator('h3').first(), 80);
  await shotMarked(page, `c-read-${tag}`, page.getByRole('button', { name: 'Use these prices' }));
  await page.getByRole('button', { name: 'Use these prices' }).click();
  await page.waitForTimeout(600);
  const ask = page.getByRole('button', { name: 'Save it' });
  if (await ask.count()) { facts.lists[tag].asked = await page.getByRole('dialog').innerText(); await ask.click(); }
  await page.locator('text=rows priced from').first().waitFor({ timeout: 30000 });
  await settle(page);
  facts.lists[tag].used = await page.locator('text=rows priced from').first().locator('xpath=..').innerText();
}
const missing = page.locator('section[aria-labelledby=missing-title]');
facts.missing = (await missing.innerText()).split('\n').slice(0, 3).join(' ');
await toTop(page, missing, 70);
await shot(page, 'c-missing-course');
facts.courseFeesSet = await page.locator('section[aria-labelledby=course-title] input[type=number]').evaluateAll((xs) => xs.filter((x) => x.value !== '').length);

// What families agree to, as copied.
await page.getByRole('tab', { name: 'What families agree to' }).click();
await settle(page);
await toTop(page, page.getByRole('tablist'), 10);
await shot(page, 'c-agree');

// The admin: the three boards' June 2028 entry deadlines.
{
  const admin = await signedIn(ADMIN.email, ADMIN.password);
  await go(admin, sessionPath);
  facts.adminLines = [];
  for (let i = 0; i < 5; i++) {
    const f = admin.locator('#checks').getByLabel('Entry deadline');
    if (!(await f.count())) break;
    const li = f.first().locator('xpath=ancestor::li[1]');
    const text = (await li.innerText()).split('\n')[0];
    facts.adminLines.push(text);
    const board = /Cambridge/.test(text) ? 'cambridge' : /Edexcel|Pearson/.test(text) ? 'pearson_edexcel' : 'oxford';
    await f.first().fill(JUNE_2028_ENTRY[board]);
    if (i === 0) { await toTop(admin, admin.locator('#checks'), 16); await shotMarked(admin, 'c-admin-dates', [f.first(), admin.locator('#checks').getByRole('button', { name: 'Save the date' }).first()]); }
    await admin.locator('#checks').getByRole('button', { name: 'Save the date' }).first().click();
    await admin.waitForResponse((r) => r.url().includes('board-date'), { timeout: 30000 });
    await admin.waitForTimeout(1000);
    await settle(admin);
  }
  await admin.context().close();
}

// Prices final, then accepting reservations.
await page.goto(`${BASE}${sessionPath}`, { waitUntil: 'domcontentloaded' });
await settle(page);
await page.evaluate(() => window.scrollTo(0, 0));
facts.beforeOpen = (await checks.locator('li').allInnerTexts()).map((x) => x.split('\n')[0]);
await shotMarked(page, 'c-prices-final', page.getByRole('switch', { name: 'Prices final', exact: true }));
await page.getByRole('switch', { name: 'Prices final', exact: true }).click();
await page.waitForTimeout(800);
if (await page.getByRole('button', { name: 'Save it' }).count()) { facts.finalAsked = await page.getByRole('dialog').innerText(); await page.getByRole('button', { name: 'Save it' }).click(); }
await page.waitForTimeout(1200);
await settle(page);
await shotMarked(page, 'c-final-accepting', page.getByRole('switch', { name: 'Accepting reservations', exact: true }));
await page.getByRole('switch', { name: 'Accepting reservations', exact: true }).click();
await page.waitForTimeout(1500);
await settle(page);
await page.evaluate(() => window.scrollTo(0, 0));
await shot(page, 'c-open');
facts.header = (await page.locator('main section').first().innerText()).slice(0, 500);
facts.afterOpen = (await checks.locator('li').allInnerTexts()).map((x) => x.split('\n')[0]);
await go(page, '/admin/sessions');
await shot(page, 'c-sessions-after');
facts.sessions = await mainText(page, 1500);

fs.writeFileSync(`${SHOTS}/../c1-facts.json`, JSON.stringify(facts, null, 1));
out(JSON.stringify(facts, null, 1).slice(0, 5000));
report('c1-copy');
await browser.close();
