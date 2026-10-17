// The fix round's drive (walkthrough-findings): headless Chrome against a running system. BASE and API from the
// environment (main's before-state on 3212/3213, the branch's after-state on 3210/3211). Every screen is reached
// through the real sign-in page; each shot is a JPEG under 150 KB (quality lowered, then scaled if needed).
import { chromium } from 'playwright-core';
import fs from 'node:fs';

export const BASE = process.env.BASE ?? 'http://localhost:3210';
export const API = process.env.API ?? 'http://localhost:3211';
export const SHOTS = process.env.SHOTS ?? '/tmp/wf/shots';
fs.mkdirSync(SHOTS, { recursive: true });
export const out = (...a) => console.log(...a);
let browser = null;
export async function getBrowser() { browser ??= await chromium.launch({ channel: 'chrome', headless: true }); return browser; }
export async function done() { if (browser) await browser.close(); }
export const errors = [];
export const readings = {};

export async function signIn(email, password, lang = 'en', viewport = { width: 1360, height: 900 }) {
  const ctx = await (await getBrowser()).newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'language', value: lang, url: BASE }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('response', async (r) => {
    if (r.status() >= 400 && r.request().method() !== 'GET') {
      let b = '';
      try { b = (await r.text()).slice(0, 300); } catch { /* gone */ }
      errors.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(API, '')} ${b}`);
    }
  });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[name=email]', email);
  await page.fill('input[type=password]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 30000 }).catch(() => {}),
    page.locator('button[type=submit]').first().click(),
  ]);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
  return page;
}

export async function go(page, path, wait = 1500) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(wait);
}

// A JPEG under 150 KB: the viewport (or a locator, or the full page), quality lowered until it fits.
export async function shot(page, name, opts = {}) {
  // The directory read at each shot: a drive script sets SHOTS to its phase's directory after importing this file.
  const path = `${process.env.SHOTS ?? SHOTS}/${name}.jpg`;
  await page.waitForTimeout(opts.wait ?? 700);
  await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => { e.style.display = 'none'; })).catch(() => {});
  let q = opts.quality ?? 72;
  for (;;) {
    if (opts.locator) await opts.locator.screenshot({ path, type: 'jpeg', quality: q });
    else await page.screenshot({ path, type: 'jpeg', quality: q, fullPage: opts.full ?? false });
    const kb = fs.statSync(path).size / 1024;
    if (kb <= 148) { out(`shot ${name} ${kb.toFixed(0)} KB q${q}`); return path; }
    if (q <= 48) break;
    q -= 8;
  }
  const { execFileSync } = await import('node:child_process');
  for (let i = 0; i < 6; i++) {
    const [w] = execFileSync('sips', ['-g', 'pixelWidth', path]).toString().match(/pixelWidth: (\d+)/).slice(1).map(Number);
    execFileSync('sips', ['--resampleWidth', String(Math.round(w * 0.88)), '-s', 'formatOptions', '60', path, '--out', path], { stdio: 'ignore' });
    const kb = fs.statSync(path).size / 1024;
    if (kb <= 148) { out(`shot ${name} ${kb.toFixed(0)} KB scaled`); return path; }
  }
  out(`shot ${name} STILL OVER 148 KB`);
  return path;
}

/** What a screen says (the main pane's text), kept beside the shots as the reading of the screen. */
export async function read(page, name, locator) {
  const t = await (locator ?? page.locator('main')).innerText().catch(async () => page.locator('body').innerText());
  readings[name] = t.replace(/\s+\n/g, '\n').slice(0, 4000);
  return readings[name];
}

export function saveReadings(file) {
  fs.writeFileSync(file, JSON.stringify({ errors, readings }, null, 2));
}

export const step = async (name, fn) => {
  try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 400)); errors.push(`step ${name}: ${String(e).split('\n')[0].slice(0, 300)}`); }
};

// Through the API as a signed-in person (the data the screens are shown on; every screen shot is the screens').
export async function apiAs(email, password) {
  const r = await fetch(`${API}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ email, password }) });
  if (r.status !== 200) throw new Error(`sign-in ${email}: ${r.status} ${await r.text()}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return async (method, path, body) => {
    const res = await fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 400)}`);
    return json?.data ?? json;
  };
}

export const ADMIN = ['admin@igcse.local', 'AdminPass1'];
export const PASSWORD = 'TestPass1';
export const OFFICER = 'finance.officer@igcse.local';
export const COORD = 'coordinator@igcse.local';
