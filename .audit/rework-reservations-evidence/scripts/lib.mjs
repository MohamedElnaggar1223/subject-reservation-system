// Credentials of the local dev container and its demo accounts are read from the environment (DEV_PASSWORD, DEV_ADMIN_PASSWORD, DEV_PG_ADMIN_URL, DEV_PG_BASE_URL).
import { chromium } from 'playwright-core';

export const WEB = 'http://localhost:3110';
export const EV = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/rework-reservations/.audit/rework-reservations-evidence/screens';

export async function browser() {
  return chromium.launch({ channel: 'chrome', headless: true });
}

/** A page signed in as `email`, in `lang` ('en' | 'ar'). */
export async function signedIn(b, email, password = process.env.DEV_PASSWORD, lang = 'en') {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript((l) => { try { window.localStorage.setItem('language', l); } catch {} }, lang);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, m.text().slice(0, 300)); });
  await page.goto(`${WEB}/sign-in`);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 30000 }), page.click('button[type="submit"]')]);
  return page;
}

export async function shot(page, name) {
  await page.waitForTimeout(600);
  // The app scrolls inside its main panel: grow the viewport to the panel's height for the shot.
  const h = await page.evaluate(() => {
    let max = document.documentElement.scrollHeight;
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.tagName !== 'SELECT') { el.scrollTop = 0; max = Math.max(max, el.scrollHeight + 80); }
    }
    return max;
  });
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 6000) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${EV}/${name}.png` });
  await page.setViewportSize(vp);
  console.log('shot', name);
}
