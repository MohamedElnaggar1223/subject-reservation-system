// The admin guide's drive: headless Chrome against the local run (web 3230, API 3231) on an empty
// database, as the deployed system starts. Every step goes through the real screens and shoots a
// JPEG at 1280x900, kept under 150 KB (quality lowered, then scaled, until it fits). Forked from
// the F8 walkthrough's lib.mjs (.audit/walkthrough-cycle-evidence/drive/lib.mjs).
import { chromium } from 'playwright-core';
import fs from 'node:fs';

export const BASE = process.env.BASE ?? 'http://localhost:3230';
export const API = process.env.API ?? 'http://localhost:3231';
export const SHOTS = process.env.SHOTS ?? '/tmp/ag/shots';
export const VIEWPORT = { width: 1280, height: 900 };
fs.mkdirSync(SHOTS, { recursive: true });
export const out = (...a) => console.log(...a);
export const browser = await chromium.launch({ channel: 'chrome', headless: true });
export const errors = [];

export async function newPage(viewport = VIEWPORT) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
  page.on('response', async (r) => {
    if (r.status() >= 400 && r.request().method() !== 'GET') {
      let b = '';
      try { b = (await r.text()).slice(0, 300); } catch { /* gone */ }
      errors.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(API, '')} ${b}`);
    }
  });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.localStorage.setItem('language', 'en'));
  return page;
}

export async function signIn(email, password, viewport) {
  const page = await newPage(viewport);
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email], input[name=email]', email);
  await page.fill('input[type=password], input[name=password]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 30000 }).catch(() => {}),
    page.locator('button[type=submit]').first().click(),
  ]);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
  return page;
}

// A JPEG under 150 KB: the viewport (or a clip, or a locator), quality lowered until it fits.
export async function shot(page, name, opts = {}) {
  const path = `${SHOTS}/${name}.jpg`;
  await page.waitForTimeout(opts.wait ?? 700);
  // The Next.js dev-mode indicator is not part of the app: hidden in every shot.
  await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => { e.style.display = 'none'; })).catch(() => {});
  let q = opts.quality ?? 74;
  for (;;) {
    const args = { path, type: 'jpeg', quality: q, fullPage: opts.full ?? false };
    if (opts.clip) args.clip = opts.clip;
    if (opts.locator) await opts.locator.screenshot({ path, type: 'jpeg', quality: q });
    else await page.screenshot(args);
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
  return path;
}

// A whole scrolling box in one shot: the viewport is made as tall as the box's content, the shot
// clipped to the box, then the viewport put back.
export async function tallShot(page, name, box, opts = {}) {
  const vp = page.viewportSize();
  const extra = await box.evaluate((el) => el.scrollHeight - el.clientHeight);
  await page.setViewportSize({ width: vp.width, height: Math.min(vp.height + Math.max(0, extra) + 8, opts.maxHeight ?? 2600) });
  await page.waitForTimeout(600);
  const b = await box.boundingBox();
  const clip = { x: b.x, y: b.y, width: b.width, height: b.height };
  await shot(page, name, { clip, quality: opts.quality ?? 70 });
  await page.setViewportSize(vp);
  await page.waitForTimeout(300);
}
export const drawerBox = (page) => page.locator('div[role=dialog] > div.max-w-2xl.overflow-y-auto').last();

export function settingCard(page, label) {
  return page.locator('div.bg-card', { has: page.locator('h3', { hasText: label }) }).first();
}

// Scroll an element to the top of its scrolling box.
export async function toTop(page, locator, offset = 16) {
  await locator.evaluate((el, off) => {
    let p = el.parentElement;
    while (p && !(p.scrollHeight > p.clientHeight + 4 && getComputedStyle(p).overflowY !== 'visible')) p = p.parentElement;
    const box = el.getBoundingClientRect();
    if (p) p.scrollBy(0, box.top - p.getBoundingClientRect().top - off);
    else window.scrollBy(0, box.top - off);
  }, offset);
  await page.waitForTimeout(300);
}

// Draw a box around what the step asks to click (a marker for the guide, never part of the app).
export async function mark(page, locator) {
  await locator.evaluate((el) => { el.style.outline = '3px solid #e11d48'; el.style.outlineOffset = '2px'; el.dataset.guideMark = '1'; });
}
export async function unmark(page) {
  await page.evaluate(() => document.querySelectorAll('[data-guide-mark]').forEach((el) => { el.style.outline = ''; el.style.outlineOffset = ''; delete el.dataset.guideMark; }));
}

export const step = async (name, fn) => {
  try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 400)); errors.push(`step ${name}: ${String(e).split('\n')[0].slice(0, 300)}`); }
};
export const mainText = async (page, n = 4000) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).slice(0, n);
export function report() { out(errors.length ? `ERRORS (${errors.length}):\n` + errors.join('\n') : 'no failed request, no page error'); }
