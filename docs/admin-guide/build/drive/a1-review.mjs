// Part A: review the pre-loaded June 2027 and open it. The coordinator signs in, goes through the check list line by
// line, pastes the boards' lists, types the fees no list holds and the course fees, sets the dates, reads what
// families agree to; the admin enters Cambridge's June 2027 entry deadline; the coordinator switches prices final and
// opens. Every picture is taken on the way; every count the guide quotes is printed for the record.
import fs from 'node:fs';
import { newPage, signedIn, signInPage, go, shot, shotMarked, toTop, settle, out, browser, report, mainText, BASE, SHOTS } from './lib.mjs';
import { ADMIN, COORDINATOR, TEMP_PASSWORD, listText, COURSE_FEE, TYPED_EXAM_FEE, CAMBRIDGE_JUNE_2027_ENTRY } from './data.mjs';

const facts = {};
const page = await newPage();

// A1 sign in.
await signInPage(page, COORDINATOR.email, TEMP_PASSWORD, (p) => shotMarked(p, 'a-sign-in', p.locator('button[type=submit]')));

// A2 Home: June 2027 waiting, its check list.
await page.getByRole('link', { name: 'Open June 2027' }).waitFor();
facts.homeCount = (await page.locator('main h2, main h3').filter({ hasText: 'Check before you open' }).first().innerText()).trim();
await shotMarked(page, 'a-home', page.getByRole('link', { name: 'Open June 2027' }));
await page.getByRole('link', { name: 'Open June 2027' }).click();
await page.waitForURL(/\/admin\/sessions\/[0-9a-f-]{36}/);
await settle(page);
const sessionPath = new URL(page.url()).pathname;
fs.writeFileSync(`${SHOTS}/../session-2027.txt`, sessionPath);
await shot(page, 'a-session');

const checks = page.locator('#checks');
const line = (text) => checks.locator('li', { hasText: text }).last();
const waitFewer = async (label, before) => page.waitForFunction(([l, n]) => [...document.querySelectorAll('#checks button')].filter((x) => x.textContent.trim() === l).length < n, [label, before], { timeout: 30000 });

// A3 the default ticks: Show the list, then Looks right.
{
  const l = line('Ticked by a default');
  facts.defaults = (await l.innerText()).split('\n')[0];
  await l.getByRole('button', { name: 'Show the list' }).click();
  await toTop(page, l, 90);
  await shotMarked(page, 'a-check-defaults', l.getByRole('button', { name: 'Looks right' }));
  const n = await checks.getByRole('button', { name: 'Looks right', exact: true }).count();
  await l.getByRole('button', { name: 'Looks right' }).click();
  await waitFewer('Looks right', n);
  await settle(page);
}

// A4 a note on how the form was read (Arabic O.L.).
{
  const l = line('Arabic O.L.:');
  await toTop(page, l, 120);
  await shotMarked(page, 'a-check-note', l.getByRole('button', { name: 'Looks right' }));
}

// A5 a teacher's name in doubt: open the subject (Combined Science O.L.), its teachers, back.
{
  const l = line('Combined Science O.L.:');
  facts.doubtNote = (await l.innerText()).split('\n').slice(1).join(' ');
  await toTop(page, l, 120);
  await shotMarked(page, 'a-check-doubt', l.getByRole('link', { name: 'Open the subject' }));
  await l.getByRole('link', { name: 'Open the subject' }).click();
  await page.waitForURL(/subjects\//);
  await settle(page);
  const t = page.locator('section', { has: page.locator('h2', { hasText: /^Teachers$/ }) });
  await toTop(page, t, 120);
  await shot(page, 'a-editor-teachers');
  facts.doubtTeachers = await t.innerText();
  await page.getByRole('link', { name: /June 2027/ }).first().click();
  await page.waitForURL((u) => /\/admin\/sessions\/[0-9a-f-]{36}$/.test(u.pathname));
  await settle(page);
}

// A6 every note: Looks right, one line at a time (the line leaves before the next click).
{
  facts.noteLines = [];
  for (let i = 0; i < 40; i++) {
    const b = checks.getByRole('button', { name: 'Looks right', exact: true });
    const n = await b.count();
    if (!n) break;
    facts.noteLines.push((await b.first().locator('xpath=ancestor::li[1]').innerText()).split('\n')[0]);
    await b.first().click();
    await waitFewer('Looks right', n);
  }
  await settle(page);
  out('notes looked at:', facts.noteLines.length);
}

// A7 teacher to be confirmed: open the subject (Computer Science A.S./A.L.), back.
{
  const l = line('teacher to be confirmed');
  await toTop(page, l, 120);
  await shotMarked(page, 'a-check-tbc', l.getByRole('link', { name: 'Open the subject' }));
  await l.getByRole('link', { name: 'Open the subject' }).click();
  await page.waitForURL(/subjects\//);
  await settle(page);
  const t = page.locator('section', { has: page.locator('h2', { hasText: /^Teachers$/ }) });
  await toTop(page, t, 200);
  await shot(page, 'a-editor-tbc');
  await page.getByRole('link', { name: /June 2027/ }).first().click();
  await page.waitForURL((u) => /\/admin\/sessions\/[0-9a-f-]{36}$/.test(u.pathname));
  await settle(page);
}

// A8 the older exam (Physics A.S./A.L., November 2025): Keep it.
{
  const l = line('older than');
  facts.olderLine = (await l.innerText()).split('\n')[0];
  await toTop(page, l, 120);
  await shotMarked(page, 'a-check-keep', l.getByRole('button', { name: 'Keep it' }));
  await l.getByRole('button', { name: 'Keep it' }).click();
  await waitFewer('Keep it', 1);
  await settle(page);
  await toTop(page, checks, 16);
  await shot(page, 'a-check-reviewed');
  facts.afterReview = (await checks.locator('li').allInnerTexts()).map((x) => x.split('\n')[0]);
}

// A9–A14 Prices: Go to Prices, paste Cambridge's list, use it; Pearson Edexcel's; the fees no list holds; course fees.
// The check list's "Go to Prices" changes the address but not the tab on this screen (it works from Home): the tab.
await page.getByRole('tab', { name: /^Prices/ }).click();
await page.getByRole('heading', { name: 'Paste a list as printed' }).waitFor();
await settle(page);
await toTop(page, page.getByRole('tablist'), 10);
await shot(page, 'a-prices');
facts.lists = {};
for (const [board, list, tag] of [['cambridge', 'Cambridge June 2026', 'cambridge'], ['pearson_edexcel', 'Edexcel June 2026', 'edexcel']]) {
  await page.locator('#pl-board').selectOption(board);
  await page.locator('#pl-text').fill(listText(list));
  facts.lists[tag] = { name: await page.locator('#pl-for').locator('xpath=..').locator('xpath=..').locator('strong').innerText().catch(() => '') };
  if (tag === 'cambridge') {
    await toTop(page, page.getByRole('heading', { name: 'Paste a list as printed' }), 70);
    await shotMarked(page, `a-paste-${tag}`, page.getByRole('button', { name: 'Read the list' }));
  }
  await page.getByRole('button', { name: 'Read the list' }).click();
  await page.getByRole('button', { name: 'Use these prices' }).waitFor();
  await settle(page);
  const sec = page.locator('section', { has: page.getByRole('heading', { name: 'Paste a list as printed' }) });
  facts.lists[tag].read = (await sec.locator('h3').allInnerTexts()).join(' | ');
  facts.lists[tag].toCheck = await sec.locator('[id^=tc-]').count();
  await toTop(page, sec.locator('h3').first(), 80);
  await shot(page, `a-read-${tag}`);
  if (facts.lists[tag].toCheck) {
    await toTop(page, sec.locator('h3', { hasText: 'To check' }), 80);
    await shot(page, `a-tocheck-${tag}`);
    facts.lists[tag].toCheckText = await sec.locator('h3', { hasText: 'To check' }).locator('xpath=..').innerText();
  }
  if (tag === 'cambridge') {
    await toTop(page, page.getByRole('button', { name: 'Use these prices' }), 500);
    await shotMarked(page, `a-use-${tag}`, page.getByRole('button', { name: 'Use these prices' }));
  }
  await page.getByRole('button', { name: 'Use these prices' }).click();
  await page.waitForTimeout(600);
  const ask = page.getByRole('button', { name: 'Save it' });
  if (await ask.count()) { facts.lists[tag].asked = await page.getByRole('dialog').innerText(); await ask.click(); }
  await page.locator('text=rows priced from').first().waitFor({ timeout: 30000 });
  await settle(page);
  facts.lists[tag].used = await page.locator('text=rows priced from').first().locator('xpath=..').innerText();
}
await toTop(page, page.getByRole('heading', { name: 'Price lists in use' }), 70);
await shot(page, 'a-lists-in-use');

// The exam fees no list holds: typed (a placeholder figure), one row at a time.
{
  const missing = page.locator('section', { has: page.getByRole('heading', { name: /^Missing exam fees/ }) });
  facts.missingBefore = (await missing.locator('h2').innerText()).trim();
  facts.missingRows = (await missing.locator('tbody tr').allInnerTexts()).map((x) => x.split('\t')[0].trim());
  await toTop(page, missing, 70);
  const first = missing.locator('input[type=number]').first();
  await first.fill(String(TYPED_EXAM_FEE));
  await shotMarked(page, 'a-missing', first);
  for (let i = 0; i < 20; i++) {
    const inputs = missing.locator('input[type=number]');
    const n = await inputs.count();
    if (!n) break;
    const f = inputs.first();
    await f.fill(String(TYPED_EXAM_FEE));
    await f.press('Enter');
    await page.waitForFunction(([sel, k]) => document.querySelectorAll(sel).length < k, ['section[aria-labelledby=missing-title] input[type=number]', n], { timeout: 30000 });
  }
  await settle(page);
  facts.missingAfter = (await missing.innerText()).split('\n').slice(0, 3).join(' ');
}

// Course fees: one per subject (placeholders: one figure for O.L., one for A.S./A.L.).
{
  const course = page.locator('section[aria-labelledby=course-title]');
  await toTop(page, course, 70);
  const inputs = course.locator('input[type=number]');
  const n = await inputs.count();
  facts.courseFees = n;
  for (let i = 0; i < n; i++) {
    const f = inputs.nth(i);
    const label = await f.getAttribute('aria-label');
    const fee = /A\.S\.\/A\.L\.|A\.L\.|A\.S\./.test(label.replace(/: course fee$/, '')) ? COURSE_FEE['A.S./A.L.'] : COURSE_FEE['O.L.'];
    await f.fill(String(fee));
    await f.press('Enter');
    await page.waitForResponse((r) => r.url().includes('/offerings/') && r.request().method() === 'PUT', { timeout: 30000 });
    await page.waitForTimeout(150);
  }
  await settle(page);
  await toTop(page, course, 70);
  await shot(page, 'a-course-fees');
}

// A15–A17 the dates, in the header.
await page.evaluate(() => window.scrollTo(0, 0));
await toTop(page, page.locator('#dates'), 260);
await page.locator('#sess-due').fill('2027-01-15');
await shotMarked(page, 'a-date-pay-by', page.locator('#sess-due'));
await page.locator('#sess-due').blur();
await page.waitForResponse((r) => r.request().method() === 'PUT' && /\/v1\/sessions\/[0-9a-f-]{36}$/.test(r.url()), { timeout: 30000 });
await settle(page);
await page.locator('#sess-first').fill('2026-11-01');
await page.locator('#sess-first').blur();
await page.waitForResponse((r) => r.request().method() === 'PUT' && /\/v1\/sessions\/[0-9a-f-]{36}$/.test(r.url()), { timeout: 30000 });
await settle(page);
await toTop(page, page.locator('#dates'), 260);
await shotMarked(page, 'a-date-first', page.locator('#sess-first'));
await shotMarked(page, 'a-date-close', page.locator('#sess-close'));
facts.datesHelp = await page.locator('#dates').innerText();

// A18–A19 What families agree to.
await page.getByRole('tab', { name: 'What families agree to' }).click();
await settle(page);
await toTop(page, page.getByRole('tablist'), 10);
await shot(page, 'a-agree');
facts.agree = (await page.locator('#session-tabpanel').innerText()).slice(0, 1500);
const settings = page.locator('#session-tabpanel section').filter({ hasText: 'Last day to pay' }).first();
await toTop(page, settings, 300);
await shot(page, 'a-agree-more');

// A20 the admin: Cambridge's June 2027 entry deadline, once, from her Home.
{
  const admin = await signedIn(ADMIN.email, ADMIN.password);
  await go(admin, '/');
  const f = admin.getByLabel('Entry deadline').first();
  await f.waitFor();
  await toTop(admin, f, 300);
  await f.fill(CAMBRIDGE_JUNE_2027_ENTRY);
  await shotMarked(admin, 'a-admin-date', [f, admin.getByRole('button', { name: 'Save the date' }).first()]);
  await admin.getByRole('button', { name: 'Save the date' }).first().click();
  await admin.waitForResponse((r) => r.url().includes('board-date'), { timeout: 30000 });
  await admin.waitForTimeout(800);
  await settle(admin);
  facts.adminAfter = (await mainText(admin, 1200));
  await admin.context().close();
}

// A21 prices final; A22 accepting reservations.
await page.goto(`${BASE}${sessionPath}`, { waitUntil: 'domcontentloaded' });
await settle(page);
await page.evaluate(() => window.scrollTo(0, 0));
facts.beforeOpen = (await checks.locator('li').allInnerTexts()).map((x) => x.split('\n')[0]);
await shotMarked(page, 'a-prices-final', page.getByRole('switch', { name: 'Prices final', exact: true }));
await page.getByRole('switch', { name: 'Prices final', exact: true }).click();
await page.waitForTimeout(800);
if (await page.getByRole('button', { name: 'Save it' }).count()) { facts.finalAsked = await page.getByRole('dialog').innerText(); await page.getByRole('button', { name: 'Save it' }).click(); }
await page.waitForFunction(() => document.querySelector('[role=switch][aria-label="Prices final"], button[role=switch]') && [...document.querySelectorAll('[role=switch]')].some((s) => (s.getAttribute('aria-label') ?? s.textContent).includes('Prices final') && s.getAttribute('aria-checked') === 'true'), null, { timeout: 30000 }).catch(() => out('prices final: switch state not read'));
await settle(page);
await shotMarked(page, 'a-accepting', page.getByRole('switch', { name: 'Accepting reservations', exact: true }));
await page.getByRole('switch', { name: 'Accepting reservations', exact: true }).click();
await page.getByText('Accepting reservations', { exact: false }).first().waitFor();
await page.waitForTimeout(1500);
await settle(page);
await page.evaluate(() => window.scrollTo(0, 0));
await shot(page, 'a-open');
facts.afterOpen = (await checks.locator('li').allInnerTexts()).map((x) => x.split('\n')[0]);
facts.header = (await page.locator('main section').first().innerText()).slice(0, 600);

// Home once open.
await go(page, '/');
await shot(page, 'a-home-open');
facts.homeOpen = await mainText(page, 1500);

fs.writeFileSync(`${SHOTS}/../a1-facts.json`, JSON.stringify(facts, null, 1));
out(JSON.stringify(facts, null, 1).slice(0, 6000));
report('a1-review');
await browser.close();
