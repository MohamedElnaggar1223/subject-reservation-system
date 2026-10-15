// F6 review fix 1: how many full page passes the translator makes once a page has loaded.
// Each pass starts with document.createTreeWalker(document.body, SHOW_TEXT) (lib/i18n.tsx localizeDom);
// an init script counts those calls with their time. Per page and language: the passes before the
// network went idle (the load and hydration), and in the 12 s after it with nothing happening on the page.
// Before the fix the translator retried every 100 ms up to 100 times (Next's script tags in <body> never
// belong to React, so it always found something "waiting"). Also records React's hydration errors.
// node translator-passes.mjs <label>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const label = process.argv[2] ?? 'run';
const WEB = process.env.WEB ?? 'http://localhost:3070';
const OUT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/.audit/ui-audit-evidence/review-fixes/';
fs.mkdirSync(OUT, { recursive: true });
const ACCOUNTS = {
  anon: null,
  admin: { email: 'admin@igcse.local', password: 'AdminPass1' },
  parent_b: { email: 'parent.b@igcse.local', password: 'TestPass1' },
};
const PAGES = [
  ['anon', '/sign-in'], ['anon', '/sign-up'], ['admin', '/'], ['parent_b', '/'],
  ['admin', '/academic/years'], ['admin', '/today'],
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const rows = [];
for (const lang of ['en', 'ar']) {
  for (const [role, path] of PAGES) {
    const ctx = await browser.newContext({ viewport: role === 'parent_b' ? { width: 390, height: 844 } : { width: 1366, height: 900 } });
    await ctx.addCookies([{ name: 'language', value: lang, url: WEB }]);
    const acct = ACCOUNTS[role];
    if (acct) {
      const p = await ctx.newPage();
      await p.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
      await p.fill('#email', acct.email);
      await p.fill('#password', acct.password);
      await Promise.all([p.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 30000 }), p.locator('form button[type=submit]').click()]);
      await p.waitForLoadState('networkidle').catch(() => {});
      await p.close();
    }
    await ctx.addInitScript(() => {
      window.__passes = [];
      const orig = Document.prototype.createTreeWalker;
      Document.prototype.createTreeWalker = function (root, what, filter) {
        if (root === document.body && what === NodeFilter.SHOW_TEXT) window.__passes.push(Math.round(performance.now()));
        return orig.call(this, root, what, filter);
      };
    });
    const page = await ctx.newPage();
    const hydration = [];
    page.on('pageerror', (e) => { if (/Hydration/i.test(e.message)) hydration.push(e.message.slice(0, 100)); });
    page.on('console', (m) => { if (m.type() === 'error' && /Hydration|did not match/i.test(m.text())) hydration.push(m.text().slice(0, 100)); });
    await page.goto(WEB + path, { waitUntil: 'networkidle', timeout: 45000 });
    const idleAt = await page.evaluate(() => Math.round(performance.now()));
    await page.waitForTimeout(12000);
    const passes = await page.evaluate(() => window.__passes);
    const row = {
      lang, role, path, finalPath: page.url().slice(WEB.length),
      passesToIdle: passes.filter((t) => t <= idleAt).length,
      passesIn12sAfterIdle: passes.filter((t) => t > idleAt).length,
      lastPassMsAfterIdle: passes.length ? Math.max(0, passes[passes.length - 1] - idleAt) : null,
      hydrationErrors: hydration.length,
    };
    rows.push(row);
    console.log(label, lang, role.padEnd(8), path.padEnd(16), 'to idle', String(row.passesToIdle).padStart(3), '| 12 s after idle', String(row.passesIn12sAfterIdle).padStart(3), '| last pass +', row.lastPassMsAfterIdle, 'ms | hydration errors', row.hydrationErrors);
    await ctx.close();
  }
}
fs.writeFileSync(`${OUT}translator-passes-${label}.json`, JSON.stringify(rows, null, 1));
await browser.close();
