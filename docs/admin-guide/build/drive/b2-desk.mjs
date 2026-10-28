// Part B, for reference: the desk. A walk-in family: find the student, reserve on the family's behalf and collect in one
// payment. Then the family that started a pay-at-school payment at home (b1-parent.mjs): found by its reference, taken.
import fs from 'node:fs';
import { signedIn, go, shot, shotMarked, toTop, settle, out, browser, report, mainText, SHOTS } from './lib.mjs';
import { OFFICER, TEMP_PASSWORD, WALKIN, CHILDREN } from './data.mjs';

const facts = {};
const page = await signedIn(OFFICER.email, TEMP_PASSWORD);
await go(page, '/desk');
const search = page.locator('input[type=search]');
const find = async (text, who) => {
  const hit = page.locator('main button').filter({ hasText: who }).first();
  for (let i = 0; i < 3; i++) {
    await search.fill('');
    await search.pressSequentially(text, { delay: 40 });
    try { await hit.waitFor({ timeout: 8000 }); return hit; } catch { /* typed before the page came alive: again */ }
  }
  throw new Error(`desk search ${text}: ${who} not found`);
};

// The walk-in: Yousef.
const hit = await find(WALKIN.name.split(' ')[0], WALKIN.name);
await shotMarked(page, 'b-desk-search', hit);
await hit.click();
await settle(page);
await shotMarked(page, 'b-desk-student', page.getByRole('button', { name: /^\+ Reserve/ }).first());
facts.student = await mainText(page, 1500);
await page.getByRole('button', { name: /^\+ Reserve/ }).first().click();
await settle(page);
const card = (title) => page.locator('article').filter({ has: page.locator('h3', { hasText: title }) }).first();
for (const t of ['Business O.L.', 'French O.L.', 'ICT O.L.']) await card(t).getByRole('radio', { name: /^First entry · in school/ }).first().check();
const summary = page.locator('section').filter({ has: page.getByRole('heading', { name: /Reserving for/ }) });
await summary.locator('input[type=checkbox]').first().check();
await toTop(page, summary, 60);
const collect = summary.getByRole('button', { name: /Reserve and collect/ });
facts.collectLabel = (await collect.innerText()).replace(/\s+/g, ' ');
facts.deskSummary = await summary.innerText();
await shotMarked(page, 'b-desk-reserve', [summary.locator('input[type=checkbox]').first(), collect]);
await collect.click();
await page.getByText(/Collected EGP/).first().waitFor({ timeout: 30000 });
await settle(page);
await toTop(page, page.getByText(/Collected EGP/).first(), 160);
await shot(page, 'b-desk-collected');
facts.collected = (await mainText(page, 4000)).match(/Collected EGP[^\n]*/)?.[0];

// The family that started a payment at home: its reference.
const ref = fs.readFileSync(`${SHOTS}/../reference.txt`, 'utf8').trim();
facts.reference = ref;
await go(page, '/desk');
const child = CHILDREN[0].name;
const hit2 = await find(ref, child);
await shotMarked(page, 'b-desk-reference', hit2);
await hit2.click();
await settle(page);
const started = page.locator('li').filter({ hasText: 'Pay at the school, started by the family' }).first();
await started.waitFor({ timeout: 30000 });
await toTop(page, started, 160);
const take = started.getByRole('button', { name: /^Take it/ });
facts.started = await started.innerText();
await shotMarked(page, 'b-desk-take', [started.locator('select').first(), take]);
await take.click();
await page.getByText(/Taken at the desk/).first().waitFor({ timeout: 30000 });
await settle(page);
await toTop(page, page.getByText(/Taken at the desk/).first(), 160);
await shot(page, 'b-desk-taken');
facts.taken = (await page.getByText(/Taken at the desk/).first().locator('..').innerText()).replace(/\s+/g, ' ');

fs.writeFileSync(`${SHOTS}/../b2-facts.json`, JSON.stringify(facts, null, 1));
out(JSON.stringify(facts, null, 1).slice(0, 4000));
report('b2-desk');
await browser.close();
