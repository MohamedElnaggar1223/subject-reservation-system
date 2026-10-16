// F8 walkthrough drive: headless Chrome against the /tmp/f8-clone system (web 3190, API 3191).
// Every step signs in through the real sign-in page, acts through the screens, and shoots a JPEG
// named by its step, kept under 150 KB (the quality is lowered until it fits).
import { chromium } from 'playwright-core';
import fs from 'node:fs';

export const BASE = 'http://localhost:3190';
export const API = 'http://localhost:3191';
export const SHOTS = process.env.SHOTS ?? '/tmp/f8-pw/shots';
fs.mkdirSync(SHOTS, { recursive: true });
export const out = (...a) => console.log(...a);
export const browser = await chromium.launch({ channel: 'chrome', headless: true });
export const errors = [];

export async function newPage(lang = 'en', viewport = { width: 1360, height: 860 }) {
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
  await page.evaluate((l) => window.localStorage.setItem('language', l), lang);
  return page;
}

export async function signIn(email, password, lang = 'en', viewport) {
  const page = await newPage(lang, viewport);
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

export async function setLang(page, lang) {
  await page.evaluate((l) => window.localStorage.setItem('language', l), lang);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}

// A JPEG under 150 KB: the viewport (or a clip, or the full page), quality lowered until it fits.
export async function shot(page, name, opts = {}) {
  const path = `${SHOTS}/${name}.jpg`;
  await page.waitForTimeout(opts.wait ?? 700);
  // The Next.js dev-mode indicator is not part of the app: hidden in every shot.
  await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => { e.style.display = 'none'; })).catch(() => {});
  let q = opts.quality ?? 72;
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
  // Still over: scaled down (macOS sips), keeping the quality readable.
  const { execFileSync } = await import('node:child_process');
  for (let scale = 0.85; scale > 0.4; scale -= 0.1) {
    const [w] = execFileSync('sips', ['-g', 'pixelWidth', path]).toString().match(/pixelWidth: (\d+)/).slice(1).map(Number);
    execFileSync('sips', ['--resampleWidth', String(Math.round(w * 0.9)), '-s', 'formatOptions', '60', path, '--out', path], { stdio: 'ignore' });
    const kb = fs.statSync(path).size / 1024;
    if (kb <= 148) { out(`shot ${name} ${kb.toFixed(0)} KB scaled`); return path; }
  }
  out(`shot ${name} STILL OVER 148 KB`);
  return path;
}

// A whole scrolling box in one shot: the viewport is made as tall as the box's content, the shot is
// clipped to the box, then the viewport is put back. `box` is the scrolling element.
export async function tallShot(page, name, box, opts = {}) {
  const vp = page.viewportSize();
  const extra = await box.evaluate((el) => el.scrollHeight - el.clientHeight);
  await page.setViewportSize({ width: vp.width, height: Math.min(vp.height + Math.max(0, extra) + 8, opts.maxHeight ?? 3200) });
  await page.waitForTimeout(500);
  const b = await box.boundingBox();
  const clip = opts.fullWidth ? { x: 0, y: 0, width: vp.width, height: page.viewportSize().height } : { x: b.x, y: b.y, width: b.width, height: b.height };
  await shot(page, name, { clip, quality: opts.quality ?? 68 });
  await page.setViewportSize(vp);
  await page.waitForTimeout(300);
}
// The open drawer's scrolling panel (the Session screen's subject form).
export const drawerBox = (page) => page.locator('div[role=dialog] > div.max-w-2xl.overflow-y-auto').last();
// The main pane's scrolling box.
export const mainBox = (page) => page.locator('main').first();

// A setting's card on Settings, by its label (h3).
export function settingCard(page, label) {
  return page.locator('div.bg-card', { has: page.locator('h3', { hasText: label }) }).first();
}

// Scroll an element to the top of the main pane (the main area scrolls inside its own box).
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

export const step = async (name, fn) => {
  try { await fn(); } catch (e) { out(`STEP ${name} FAILED: ` + String(e).split('\n')[0].slice(0, 400)); errors.push(`step ${name}: ${String(e).split('\n')[0].slice(0, 300)}`); }
};
export const mainText = async (page, n = 4000) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).slice(0, n);

// Through the API as a signed-in person (the demo script's way; the walkthrough's steps use the screens).
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
