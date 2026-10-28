// Part B, for reference: a parent reserves for two children on one page each, then pays at the school (the checkout
// starts a payment with a reference the desk takes in b2-desk.mjs).
import fs from 'node:fs';
import { signedIn, go, shot, shotMarked, toTop, settle, out, browser, report, mainText, SHOTS } from './lib.mjs';
import { PARENT, CHILDREN, FAMILY_PASSWORD } from './data.mjs';

const facts = {};
const page = await signedIn(PARENT.email, FAMILY_PASSWORD);
await go(page, '/');
await shotMarked(page, 'b-parent-home', page.getByRole('link', { name: /^Reserve subjects/ }).first());
facts.home = await mainText(page, 800);
await page.getByRole('link', { name: /^Reserve subjects/ }).first().click();
await page.waitForURL(/\/register/);
await settle(page);

const card = (title) => page.locator('article').filter({ has: page.locator('h3', { hasText: title }) }).first();
const first = async (title, which = /^First entry · in school/) => card(title).getByRole('radio', { name: which }).first().check();
const summary = () => page.locator('section').filter({ has: page.getByRole('heading', { name: /Reserving for/ }) });

// The child's page: Laila (the first child in the list).
const child = (await page.locator('main h2').filter({ hasText: /Reserve for/ }).first().innerText()).replace('Reserve for', '').trim();
facts.firstChild = child;
await first('Arabic O.L.');
await first('Biology O.L.');
await first('Mathematics O.L.');
await toTop(page, card('Biology O.L.'), 140);
await shot(page, 'b-reserve-picks');
const boxes = summary().locator('input[type=checkbox]');
await boxes.nth(0).check();
await boxes.nth(1).check();
await toTop(page, summary(), 60);
await shotMarked(page, 'b-reserve-agree', summary().getByRole('button', { name: /^Reserve now/ }));
facts.summary1 = await summary().innerText();
await summary().getByRole('button', { name: /^Reserve now/ }).click();
await page.getByText(/Reserved: \d+/).first().waitFor({ timeout: 30000 });
await settle(page);
const other = CHILDREN.map((c) => c.name).find((n) => n !== child);
await toTop(page, page.getByText(/Reserved: \d+/).first(), 120);
await shotMarked(page, 'b-reserved', page.getByRole('button', { name: /Reserve for/ }).filter({ hasText: other }).first());
facts.reserved1 = (await mainText(page, 3000)).match(/Reserved:[^\n]*/)?.[0];

// The second child's page, from the result: one first entry, and a retake (Sat it before?).
await page.getByRole('button', { name: /Reserve for/ }).filter({ hasText: other }).first().click();
await settle(page);
await first('Chemistry A.S./A.L.', /^First entry · in school · A\.S\./);
await first('Computer Science A.S./A.L.', /^First entry · in school · A\.S\./);
await card('Physics O.L.').getByRole('button', { name: 'Sat it before? Show the retake choices' }).click();
await page.waitForTimeout(400);
await card('Physics O.L.').getByRole('radio', { name: /^Retake · self study 50% · all papers/ }).first().check();
await page.waitForTimeout(400);
// When did your child sit it? The first exam on the school's list.
const when = card('Physics O.L.').locator('select').first();
const opts = await when.locator('option').allInnerTexts();
facts.whenOptions = opts;
await when.selectOption({ index: 1 });
await page.waitForTimeout(300);
await toTop(page, card('Physics O.L.'), 140);
await shot(page, 'b-reserve-retake');
facts.retakeCard = await card('Physics O.L.').innerText();
const boxes2 = summary().locator('input[type=checkbox]');
await boxes2.nth(0).check();
await boxes2.nth(1).check();
await summary().getByRole('button', { name: /^Reserve now/ }).click();
await page.getByText(/Reserved: \d+/).first().waitFor({ timeout: 30000 });
await settle(page);
facts.reserved2 = (await mainText(page, 3000)).match(/Reserved:[^\n]*/)?.[0];

// The reservations, read back: My reservations, one block per child.
await go(page, '/registrations');
await shot(page, 'b-my-reservations');
facts.myReservations = await mainText(page, 1500);
// Paying: Home's next step for the first child, Pay now; the checkout; Pay at School.
await go(page, '/');
const payBtn = page.getByRole('link', { name: /^Pay now$/ }).first();
facts.homeToPay = await mainText(page, 1200);
await shotMarked(page, 'b-pay-now', payBtn);
await payBtn.click();
await page.waitForURL(/\/checkout/, { timeout: 30000 });
await settle(page);
const school = page.getByRole('button', { name: /^Pay at School$/ });
if (await school.count()) await school.click();
await page.waitForTimeout(400);
const go2 = page.getByRole('button', { name: /^Pay / }).last();
facts.checkoutButton = await go2.innerText();
await shotMarked(page, 'b-checkout', [school, go2]);
facts.checkout = await mainText(page, 2500);
await go2.click();
await page.waitForTimeout(2000);
await settle(page);
await shot(page, 'b-payment-started');
facts.started = await mainText(page, 2000);
const ref = facts.started.match(/SCH-[A-Z0-9]+/)?.[0];
facts.reference = ref;
fs.writeFileSync(`${SHOTS}/../reference.txt`, ref ?? '');
await go(page, '/');
await shot(page, 'b-parent-home-after');
facts.homeAfter = await mainText(page, 1500);

fs.writeFileSync(`${SHOTS}/../b1-facts.json`, JSON.stringify(facts, null, 1));
out(JSON.stringify(facts, null, 1).slice(0, 5000));
report('b1-parent');
await browser.close();
