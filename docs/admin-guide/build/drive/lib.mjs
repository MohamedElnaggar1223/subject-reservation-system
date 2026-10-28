// The admin guide's drive: headless Chrome against a local run (web WEB, API API) on a fresh database
// with the June 2027 pre-load, as the deployed system starts after its reset. Every step goes through the
// real screens and shoots a JPEG at 1280x900, kept under 150 KB (quality lowered, then scaled, until it
// fits). It waits for content (the main area settled), never for the network to go quiet.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

export const BASE = process.env.BASE ?? 'http://localhost:3300';
export const API = process.env.API ?? 'http://localhost:3299';
export const SHOTS = process.env.SHOTS ?? '/tmp/ag/shots';
export const VIEWPORT = { width: 1280, height: 900 };
fs.mkdirSync(SHOTS, { recursive: true });
export const out = (...a) => console.log(...a);
export const browser = await chromium.launch({ channel: 'chrome', headless: true });
export const errors = [];

function watch(page) {
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('response', async (r) => {
    if (r.status() >= 400 && r.request().method() !== 'GET' && !r.url().includes('/api/auth/get-session')) {
      let b = '';
      try { b = (await r.text()).slice(0, 300); } catch { /* gone */ }
      errors.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(API, '')} ${b}`);
    }
  });
}

/** A fresh browser context in English, Cairo time, at the guide's size. */
export async function newContext(viewport = VIEWPORT) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-GB', timezoneId: 'Africa/Cairo' });
  const host = new URL(BASE).hostname;
  await ctx.addCookies([{ name: 'language', value: 'en', domain: host, path: '/' }]);
  await ctx.addInitScript(() => { try { window.localStorage.setItem('language', 'en'); } catch { /* none */ } });
  return ctx;
}

export async function newPage(viewport = VIEWPORT) {
  const ctx = await newContext(viewport);
  const page = await ctx.newPage();
  watch(page);
  return page;
}

/** Signed in without the sign-in page (the page itself is shown once, in Part A): the API's own sign-in, its cookie kept. */
export async function signedIn(email, password, viewport) {
  const ctx = await newContext(viewport);
  const r = await ctx.request.post(`${API}/api/auth/sign-in/email`, { data: { email, password }, headers: { Origin: BASE } });
  if (!r.ok()) throw new Error(`sign-in ${email}: ${r.status()} ${await r.text()}`);
  const page = await ctx.newPage();
  watch(page);
  return page;
}

/** The sign-in page, filled and sent as a person does. */
export async function signInPage(page, email, password, before) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.locator('#email').waitFor();
  // Filled only once the page has come alive: a field typed into before that is forgotten when it does.
  await settle(page);
  await page.waitForTimeout(1500);
  await page.fill('#email', email);
  await page.fill('#password', password);
  if (before) await before(page);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 60000, waitUntil: 'commit' }),
    page.locator('button[type=submit]').first().click(),
  ]);
  await settle(page);
}

export async function go(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
}

/** Wait until the main area has settled: no loading text, nothing busy, the text unchanged for 700 ms. */
export async function settle(page, { timeout = 60000 } = {}) {
  const start = Date.now();
  let last = '';
  let stableSince = Date.now();
  while (Date.now() - start < timeout) {
    const t = await page.evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      const txt = main.innerText;
      const busy = document.querySelector('[aria-busy="true"], .animate-spin, .animate-pulse, [data-loading="true"]');
      return { txt, busy: !!busy, loading: /Loading|Compiling|Reading…|Saving…|Using…/.test(txt) };
    }).catch(() => ({ txt: '', busy: true, loading: true }));
    if (t.txt !== last || t.busy || t.loading) { last = t.txt; stableSince = Date.now(); }
    else if (Date.now() - stableSince > 700 && t.txt.length > 0) return;
    await page.waitForTimeout(200);
  }
  out('settle: timed out');
}

// A JPEG under 150 KB: the viewport (or a clip), quality lowered until it fits.
export async function shot(page, name, opts = {}) {
  const path = `${SHOTS}/${name}.jpg`;
  await page.waitForTimeout(opts.wait ?? 500);
  // The Next.js dev-mode indicator is not part of the app: hidden in every shot.
  await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => { e.style.display = 'none'; })).catch(() => {});
  let q = opts.quality ?? 74;
  for (;;) {
    const args = { path, type: 'jpeg', quality: q, fullPage: opts.full ?? false };
    if (opts.clip) args.clip = opts.clip;
    await page.screenshot(args);
    const kb = fs.statSync(path).size / 1024;
    if (kb <= 148) { out(`shot ${name} ${kb.toFixed(0)} KB q${q}`); return path; }
    if (q <= 48) break;
    q -= 8;
  }
  const { execFileSync } = await import('node:child_process');
  for (let i = 0; i < 6; i++) {
    const [w] = execFileSync('sips', ['-g', 'pixelWidth', path]).toString().match(/pixelWidth: (\d+)/).slice(1).map(Number);
    execFileSync('sips', ['--resampleWidth', String(Math.round(w * 0.9)), '-s', 'formatOptions', '60', path, '--out', path], { stdio: 'ignore' });
    const kb = fs.statSync(path).size / 1024;
    if (kb <= 148) { out(`shot ${name} ${kb.toFixed(0)} KB scaled`); return path; }
  }
  out(`shot ${name} STILL OVER 148 KB`);
  errors.push(`shot ${name} over 148 KB`);
  return path;
}

// Scroll an element to the top of its scrolling box (or the window), offset px below the top.
export async function toTop(page, locator, offset = 16) {
  await locator.first().evaluate((el, off) => {
    let p = el.parentElement;
    while (p && !(p.scrollHeight > p.clientHeight + 4 && getComputedStyle(p).overflowY !== 'visible')) p = p.parentElement;
    const box = el.getBoundingClientRect();
    if (p && p !== document.body && p !== document.documentElement) p.scrollBy(0, box.top - p.getBoundingClientRect().top - off);
    else window.scrollBy(0, box.top - off);
  }, offset);
  await page.waitForTimeout(300);
}

// Draw a box around what the step asks to click (a marker for the guide, never part of the app).
export async function mark(page, locator) {
  await locator.first().evaluate((el) => { el.style.outline = '3px solid #e11d48'; el.style.outlineOffset = '2px'; el.dataset.guideMark = '1'; });
}
export async function unmark(page) {
  await page.evaluate(() => document.querySelectorAll('[data-guide-mark]').forEach((el) => { el.style.outline = ''; el.style.outlineOffset = ''; delete el.dataset.guideMark; }));
}

/** Mark, shoot, unmark: the picture of a step with what it asks to click framed. */
export async function shotMarked(page, name, locators, opts) {
  for (const l of [locators].flat()) await mark(page, l);
  await shot(page, name, opts);
  await unmark(page);
}

export const mainText = async (page, n = 4000) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).slice(0, n);
export function report(name) {
  out(errors.length ? `${name ?? ''} ERRORS (${errors.length}):\n` + errors.join('\n') : `${name ?? ''} no failed request, no page error`);
  if (errors.length) process.exitCode = 1;
}
