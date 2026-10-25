// The first admin on the empty database: signed up through the sign-up page (then the seed promotes it).
import { BASE, newPage, out, browser, report } from './lib.mjs';
const page = await newPage();
await page.goto(`${BASE}/sign-up/parent`, { waitUntil: 'networkidle' });
await page.fill('#name', 'School Admin');
await page.fill('#email', 'admin@igcse.local');
await page.fill('#password', 'AdminPass1');
await page.fill('#confirmPassword', 'AdminPass1');
await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-up'), { timeout: 30000 }).catch(() => {}), page.locator('button[type=submit]').click()]);
await page.waitForTimeout(2000);
out('after sign-up:', page.url());
report();
await browser.close();
