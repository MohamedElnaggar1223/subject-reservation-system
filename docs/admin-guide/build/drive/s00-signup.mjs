// The first admin on the empty database: signed up through the sign-up page (then the db seed promotes it), as the
// deployed system starts after its reset. No picture.
import { BASE, newPage, settle, out, browser, report } from './lib.mjs';
import { ADMIN } from './data.mjs';
const page = await newPage();
await page.goto(`${BASE}/sign-up/parent`, { waitUntil: 'domcontentloaded' });
await page.locator('#name').waitFor();
await settle(page);
await page.waitForTimeout(1500); // typed only once the page has come alive
await page.fill('#name', ADMIN.name);
await page.fill('#email', ADMIN.email);
await page.fill('#password', ADMIN.password);
await page.fill('#confirmPassword', ADMIN.password);
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes('sign-up'), { timeout: 60000, waitUntil: 'commit' }),
  page.locator('button[type=submit]').click(),
]);
await settle(page);
out('after sign-up:', page.url());
report('s00-signup');
await browser.close();
