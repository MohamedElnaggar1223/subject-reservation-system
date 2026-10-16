// Part 2, the settings that matter for the forms: the self-study share, the board fee's share, the refund
// policy of a new June session (the June forms' policy). Shown, not changed: the defaults are the forms'.
import { signIn, BASE, shot, out, errors, browser, settingCard, toTop } from './lib.mjs';
import { ADMIN } from './cycle-data.mjs';

const page = await signIn(ADMIN.email, ADMIN.password);
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await toTop(page, settingCard(page, 'Self-study: share of the course fee'), 70);
await shot(page, 'p2-18-settings-self-study');
await toTop(page, settingCard(page, 'Refund policy of a new June session'), 70);
await shot(page, 'p2-19-settings-refund-policy');
out('errors', errors);
await browser.close();
