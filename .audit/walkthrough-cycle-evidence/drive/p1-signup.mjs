// Part 1: the first account, signed up through the web app (before the seed promotes it).
import { newPage, BASE, shot, out, errors, browser, mainText } from './lib.mjs';

const page = await newPage('en');
await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
await shot(page, 'p1-sign-in-fresh');
await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle' });
await shot(page, 'p1-sign-up-choose');
await page.goto(`${BASE}/sign-up/parent`, { waitUntil: 'networkidle' });
out(await mainText(page, 1500));
const inputs = await page.locator('input').evaluateAll((els) => els.map((e) => `${e.name}|${e.type}|${e.id}|${e.placeholder}`));
out(inputs);
await page.locator('input').nth(0).fill('School Admin');
await page.locator('input[type=email]').fill('admin@igcse.local');
const pw = page.locator('input[type=password]');
await pw.nth(0).fill('AdminPass1');
await pw.nth(1).fill('AdminPass1');
await shot(page, 'p1-sign-up-admin-filled');
await Promise.all([page.waitForURL(/complete/, { timeout: 20000 }).catch(() => {}), page.locator('button[type=submit]').first().click()]);
await page.waitForTimeout(2000);
out('url', page.url());
await shot(page, 'p1-sign-up-admin-done');
out(await mainText(page, 1500));
out('errors', errors);
await browser.close();
