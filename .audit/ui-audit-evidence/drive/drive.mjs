// F6 — the audit's drive: every screen of the reservation cycle, per role, in English and Arabic.
// For each screen: the whole main area as a JPEG (under 300 KB), axe-core (WCAG 2.2 A/AA), the
// console's errors (the hydration warning among them), the API requests the screen made and the time
// to settle. Usage: node drive.mjs <phase: before|after> [screen-id-filter-regex] [lang: en|ar|both]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { SCREENS, ACCOUNTS } from './screens.mjs';

const WEB = process.env.WEB ?? 'http://localhost:3070';
const API = process.env.API ?? 'http://localhost:3071';
const EVIDENCE = process.env.EVIDENCE ?? '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/.audit/ui-audit-evidence';
const phase = process.argv[2] ?? 'before';
const filter = new RegExp(process.argv[3] ?? '.');
const langs = (process.argv[4] ?? 'both') === 'both' ? ['en', 'ar'] : [process.argv[4]];
const AXE = fs.readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const RESULTS = path.join(EVIDENCE, `drive-${phase}.json`);
const results = fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, 'utf8')) : {};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function contextFor(role, lang) {
  const acct = ACCOUNTS[role];
  const mobile = acct.device === 'phone';
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
  });
  await ctx.addCookies([{ name: 'language', value: lang, url: WEB }]);
  await ctx.addInitScript((l) => { try { localStorage.setItem('language', l); } catch { /* none */ } }, lang);
  if (acct.email) {
    const page = await ctx.newPage();
    await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
    await page.fill('input[type=email], input[name=email]', acct.email);
    await page.fill('input[type=password], input[name=password]', acct.password);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 30000 }).catch(() => {}),
      page.locator('button[type=submit]').first().click(),
    ]);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.close();
  }
  return ctx;
}

async function capture(page, file) {
  // The app shell scrolls <main>, not the page: grow the viewport to the main area's height so the
  // screenshot holds the whole screen, then put it back.
  const vp = page.viewportSize();
  const h = await page.evaluate(() => {
    const m = document.querySelector('main');
    const extra = m ? m.getBoundingClientRect().top : 0;
    return Math.ceil(Math.max(document.documentElement.scrollHeight, m ? m.scrollHeight + extra : 0));
  });
  const height = Math.min(Math.max(vp.height, h), 6000);
  if (height !== vp.height) { await page.setViewportSize({ width: vp.width, height }); await page.waitForTimeout(400); }
  let quality = 55;
  for (;;) {
    await page.screenshot({ path: file, type: 'jpeg', quality, fullPage: true });
    const size = fs.statSync(file).size;
    if (size < 290_000 || quality <= 20) break;
    quality -= 10;
  }
  if (height !== vp.height) await page.setViewportSize(vp);
  return fs.statSync(file).size;
}

async function axe(page) {
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, v.id === 'color-contrast' ? 40 : 5).map((n) => n.target.join(' ') + (n.any?.[0]?.message ? ` — ${n.any[0].message}` : '')) }));
  });
}

const byRole = new Map();
for (const s of SCREENS.filter((s) => filter.test(s.id))) {
  if (!byRole.has(s.role)) byRole.set(s.role, []);
  byRole.get(s.role).push(s);
}

for (const lang of langs) {
  for (const [role, screens] of byRole) {
    const ctx = await contextFor(role, lang);
    for (const s of screens) {
      const page = await ctx.newPage();
      const errors = [];
      const api = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.split('\n')[0].slice(0, 300)}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().split('\n')[0].slice(0, 300)}`); });
      page.on('request', (r) => { if (r.url().startsWith(API)) api.push(`${r.method()} ${r.url().slice(API.length).split('?')[0]}`); });
      const t0 = Date.now();
      let status = 0;
      try {
        const res = await page.goto(WEB + s.path, { waitUntil: 'networkidle', timeout: 45000 });
        status = res?.status() ?? 0;
      } catch (e) { errors.push(`goto: ${String(e).slice(0, 200)}`); }
      await page.waitForTimeout(s.wait ?? 1200);
      if (s.act) { try { await s.act(page); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(800); } catch (e) { errors.push(`act: ${String(e).split('\n')[0].slice(0, 200)}`); } }
      const settled = Date.now() - t0;
      const dir = path.join(EVIDENCE, s.id);
      if (!process.env.NOSHOT) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${phase}-${lang}.jpg`);
      const size = process.env.NOSHOT ? 0 : await capture(page, file);
      let violations = [];
      if (!process.env.NOSHOT) { try { violations = await axe(page); } catch (e) { errors.push(`axe: ${String(e).slice(0, 200)}`); } }
      const finalUrl = page.url().slice(WEB.length);
      const html = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
      results[`${s.id}:${lang}`] = { id: s.id, role, lang, path: s.path, finalUrl, status, settledMs: settled, apiRequests: api.length, api: [...new Set(api)], errors, html, axe: violations, shot: path.relative(EVIDENCE, file), bytes: size };
      console.log(`${phase} ${lang} ${s.id} ${status} ${finalUrl} ${settled}ms api=${api.length} errors=${errors.length} axe=${violations.map((v) => `${v.id}(${v.nodes})`).join(',')} ${Math.round(size / 1024)}KB`);
      await page.close();
    }
    await ctx.close();
  }
}
if (!process.env.NOSHOT) fs.writeFileSync(RESULTS, JSON.stringify(results, null, 1));
await browser.close();
