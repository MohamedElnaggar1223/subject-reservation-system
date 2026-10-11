// The winter IAL form saved again with nothing changed says so; its sittings read as saved.
import { BASE, browser, errors, out, signIn, shot } from './lib.mjs';
const WINTER = '801faefd-9d95-442a-9251-e42285b3cdca';
const page = await signIn('admin@igcse.local', 'AdminPass1', 'en');
await page.goto(`${BASE}/admin/sessions/${WINTER}#subjects`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.locator('table button', { hasText: 'Mathematics A.S./A.L.' }).first().click();
await page.waitForTimeout(1500);
const d = page.locator('[role=dialog]').last();
const sittings = await d.locator('select[id^=sf-sit-]').evaluateAll((els) => els.map((e) => e.options[e.selectedIndex]?.text));
out('sittings:', sittings.join(' | '));
await d.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(2000);
out('after save:', (await d.innerText()).split('\n').slice(0, 4).join(' | '));
await shot(page, 'after-11-winter-saved-again-en', { full: false });
out('ERRORS:', errors.filter((e) => !/Hydration/.test(e)).join('\n') || 'none');
await browser.close();
