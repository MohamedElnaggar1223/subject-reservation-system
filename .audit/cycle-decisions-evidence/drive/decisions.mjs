// The cycle decisions' drive (docs/features/CYCLE_DECISIONS.md): headless Chrome (playwright-core,
// channel chrome) against the worktree's servers (web 3180, API 3181, igcse_decisions_dev after setup-1..8
// and setup-cd). Every screen a decision changes, in English and in Arabic, as the role that reaches it.
// Usage: node decisions.mjs <phase: before|after|…> [screen-id regex]
// Writes <EVIDENCE>/<phase>/<id>-<lang>.jpg (each under 300 KB) and <EVIDENCE>/<phase>/readings.json
// (what each screen said: the sidebar's items, the select's options, the sentence; errors seen).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const WEB = process.env.WEB ?? 'http://localhost:3180';
const EVIDENCE = process.env.EVIDENCE ?? '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/cycle-decisions/.audit/cycle-decisions-evidence';
const phase = process.argv[2] ?? 'before';
const filter = new RegExp(process.argv[3] ?? '.');
const S = JSON.parse(fs.readFileSync(new URL('./state.json', import.meta.url), 'utf8'));
const dir = path.join(EVIDENCE, phase);
fs.mkdirSync(dir, { recursive: true });
const READINGS = path.join(dir, 'readings.json');
const readings = fs.existsSync(READINGS) ? JSON.parse(fs.readFileSync(READINGS, 'utf8')) : {};

const ACCOUNTS = {
  admin: { email: 'admin@igcse.local', password: 'AdminPass1' },
  coordinator: { email: 'coordinator.ui@igcse.local' },
  officer: { email: 'officer.mona@igcse.local' },
  parent_b: { email: 'parent.b@igcse.local', phone: true },
  parent_c: { email: 'parent.c@igcse.local', phone: true },
  parent_c_desk: { email: 'parent.c@igcse.local' },
  anon: { email: null },
  anon_phone: { email: null, phone: true },
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function contextFor(role, lang) {
  const a = ACCOUNTS[role];
  const ctx = await browser.newContext({
    viewport: a.phone ? { width: 390, height: 844 } : { width: 1366, height: 900 }, deviceScaleFactor: 1, isMobile: !!a.phone, hasTouch: !!a.phone,
  });
  await ctx.addCookies([{ name: 'language', value: lang, url: WEB }]);
  await ctx.addInitScript((l) => { try { localStorage.setItem('language', l); } catch { /* none */ } }, lang);
  if (a.email) {
    const page = await ctx.newPage();
    await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
    await page.fill('input[type=email]', a.email);
    await page.fill('input[type=password]', a.password ?? 'TestPass1');
    await Promise.all([page.waitForURL((u) => !u.pathname.includes('sign-in'), { timeout: 30000 }).catch(() => {}), page.locator('button[type=submit]').first().click()]);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.close();
  }
  return ctx;
}

/** A JPEG of the element (or the page's main area grown to its height), stepped down until under 290 KB. */
async function capture(page, file, selector) {
  const target = selector ? page.locator(selector).first() : null;
  const vp = page.viewportSize();
  let grown = false;
  if (!target) {
    const h = await page.evaluate(() => {
      const m = document.querySelector('main');
      const extra = m ? m.getBoundingClientRect().top : 0;
      return Math.ceil(Math.max(document.documentElement.scrollHeight, m ? m.scrollHeight + extra : 0));
    });
    const height = Math.min(Math.max(vp.height, h), 5000);
    if (height !== vp.height) { await page.setViewportSize({ width: vp.width, height }); await page.waitForTimeout(400); grown = true; }
  }
  for (let quality = 60; ; quality -= 10) {
    if (target) await target.screenshot({ path: file, type: 'jpeg', quality });
    else await page.screenshot({ path: file, type: 'jpeg', quality, fullPage: true });
    if (fs.statSync(file).size < 290_000 || quality <= 20) break;
  }
  if (grown) await page.setViewportSize(vp);
  return fs.statSync(file).size;
}

/** The sidebar's language button, clicked as a keyboard user does (an open dialog's overlay covers it). */
async function toggle(page) {
  await page.locator('button[title="Switch language"], button[title="تغيير اللغة"], button[title="التبديل إلى English"], button[title="Switch to Arabic"]').first().dispatchEvent('click');
  await page.waitForTimeout(1800);
}

const navItems = (page) => page.evaluate(() => [...document.querySelectorAll('aside nav a, nav[aria-label] a')].map((a) => `${a.getAttribute('href')} ${a.textContent.trim()}`));
const rowOf = (page, name) => page.locator('tr', { hasText: name }).first();
const openSession = async (page, id) => { await page.goto(`${WEB}/admin/sessions/${id}#subjects`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1500); };

const SCREENS = [
  // 5, 8, 13: the sidebars.
  { id: 'd05-08-13-admin-sidebar', role: 'admin', path: '/', shot: 'aside', read: navItems },
  { id: 'd05-coordinator-sidebar', role: 'coordinator', path: '/', shot: 'aside', read: navItems },
  // 7: Board Services, a series' grid open.
  { id: 'd07-board-services', role: 'admin', path: '/exams/services', act: async (p) => { await p.selectOption('#svc-series', S.camJune).catch(() => {}); await p.waitForTimeout(1500); },
    read: (p) => p.evaluate(() => [...document.querySelectorAll('main table tbody tr')].map((r) => r.innerText.split('\n')[0])) },
  // 9: the Student 360's block (the student record; the desk shares the panel).
  { id: 'd09-student-record', role: 'admin', path: `/students/${S.a1}`, read: (p) => p.evaluate(() => [...document.querySelectorAll('main h3')].map((h) => h.textContent.trim())) },
  // 10: Exam Deadlines.
  { id: 'd10-exam-deadlines', role: 'coordinator', path: '/exams/deadlines', read: (p) => p.evaluate(() => [...document.querySelectorAll('main tbody tr')].map((r) => r.innerText.replace(/\s+/g, ' ').slice(0, 140))) },
  // 12: the desk's teacher change, the sentence (a student of Teacher A's group moves to Teacher B's).
  { id: 'd12-desk-teacher-change', role: 'officer', toggle: true, path: () => `/desk?student=${phase === 'before' ? S.e1 : S.f1}`,
    act: async (p) => {
      await p.getByRole('button', { name: 'Statement', exact: true }).click();
      await p.waitForTimeout(800);
      await p.getByRole('button', { name: 'Teacher', exact: true }).first().click();
      await p.waitForSelector('#line-teacher');
      const value = await p.locator('#line-teacher option').evaluateAll((os) => os.find((o) => o.textContent.trim().startsWith('Teacher B'))?.value);
      await p.selectOption('#line-teacher', value);
      await p.fill('#line-teacher-reason', 'The family asked for Teacher B at the desk');
      await p.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
      await p.getByRole('dialog').getByRole('status').waitFor({ timeout: 20000 });
    },
    shot: '[role=dialog]', read: (p) => p.getByRole('dialog').getByRole('status').innerText() },
  // 12: the Messages screen's "A section" (Arabic: فصل).
  { id: 'd12-messages-section', role: 'admin', toggle: true, path: '/admin/messages',
    act: async (p) => { await p.getByRole('button', { name: 'A list in the system' }).click(); await p.locator('fieldset select').first().selectOption('section'); await p.waitForTimeout(600); },
    shot: 'fieldset', read: (p) => p.locator('fieldset').first().innerText() },
  // 1: the preview of Chemistry (Retake (Self Study ONLY)).
  { id: 'd01-preview-chemistry', role: 'admin', toggle: true, path: () => `/admin/sessions/${S.june}#subjects`,
    act: async (p) => { await p.waitForTimeout(1200); await rowOf(p, 'Chemistry').getByRole('button', { name: "Preview the family's form" }).click(); await p.waitForTimeout(1500); },
    shot: '[role=dialog]', read: (p) => p.getByRole('dialog').evaluate((d) => [...d.querySelectorAll('select[aria-label="Entry"] option, li')].map((o) => o.textContent.trim())) },
  // 3: the preview of Arabic A.L. (two qualifications, a teacher each).
  { id: 'd03-preview-arabic-al', role: 'admin', toggle: true, path: () => `/admin/sessions/${S.june}#subjects`,
    act: async (p) => { await p.waitForTimeout(1200); await rowOf(p, 'Arabic A.L.').getByRole('button', { name: "Preview the family's form" }).click(); await p.waitForTimeout(1500); },
    shot: '[role=dialog]', read: (p) => p.getByRole('dialog').evaluate((d) => [...d.querySelectorAll('tbody td:nth-child(3)')].map((o) => o.textContent.trim()).filter(Boolean)) },
  // 1 and 3: the family's Reserve page — Chemistry's entry choices, Arabic A.L. (IAL) with its teacher.
  { id: 'd01-03-reserve-parent', role: 'parent_b', path: '/register',
    act: async (p) => {
      await p.waitForTimeout(1500);
      for (const name of ['Chemistry: All papers', 'Arabic A.L.: Arabic IAL (YAA01)']) {
        const box = p.getByRole('checkbox', { name, exact: true });
        if (await box.count()) await box.first().check().catch(() => {});
      }
      await p.waitForTimeout(800);
    },
    read: (p) => p.evaluate(() => [...document.querySelectorAll('main tr')].filter((r) => /Chemistry|Arabic A\.L\./.test(r.innerText) || r.querySelector('select')).map((r) => r.innerText.replace(/\s+/g, ' ').slice(0, 160))) },
  // 2: the winter session's IAL subject, its units' sitting.
  { id: 'd02-winter-ial-units', role: 'admin', toggle: true, path: () => `/admin/sessions/${S.winter}#subjects`,
    act: async (p) => { await p.waitForTimeout(1200); await rowOf(p, 'Mathematics A.S./A.L.').locator('button').first().click(); await p.waitForTimeout(1500); await p.locator('select[id^="sf-sit-"]').first().scrollIntoViewIfNeeded(); },
    shot: '[role=dialog]', read: (p) => p.evaluate(() => [...document.querySelectorAll('select[id^="sf-sit-"]')].map((s) => [...s.options].map((o) => o.textContent.trim()).join(' | '))) },
  // 16: Entry Lists' rule source.
  { id: 'd16-entry-lists', role: 'coordinator', path: () => `/exams/entry-lists?series=${S.camJune}`,
    read: (p) => p.evaluate(() => [...document.querySelectorAll('main p, main li')].map((x) => x.textContent.trim()).filter((t) => /Handbook|handbook|DISCOVERY|دليل/.test(t))) },
  // 15: the settings screen, and the auth pages.
  { id: 'd15-settings', role: 'admin', path: '/settings', act: async (p) => { await p.locator('#group-school').scrollIntoViewIfNeeded().catch(() => {}); },
    read: (p) => p.evaluate(() => [...document.querySelectorAll('main section h2')].map((h) => h.textContent.trim())) },
  { id: 'd15-sign-in', role: 'anon', path: '/sign-in', read: (p) => p.evaluate(() => document.body.innerText.slice(0, 260)) },
  { id: 'd15-sign-in-phone', role: 'anon_phone', path: '/sign-in', read: (p) => p.evaluate(() => document.body.innerText.slice(0, 200)) },
  { id: 'd15-sign-up', role: 'anon', path: '/sign-up', read: (p) => p.evaluate(() => document.body.innerText.slice(0, 200)) },
  { id: 'd15-forgot-password', role: 'anon', path: '/forgot-password', read: (p) => p.evaluate(() => document.body.innerText.slice(0, 200)) },
  // 14: "Balance" — the family's nav, home, page and statement; the desk; the admin's screen.
  { id: 'd14-parent-sidebar', role: 'parent_c_desk', path: '/', shot: 'aside', read: navItems },
  { id: 'd14-parent-home', role: 'parent_c', path: '/', read: (p) => p.evaluate(() => [...document.querySelectorAll('main a')].map((a) => a.textContent.trim()).filter(Boolean)) },
  { id: 'd14-parent-balance-page', role: 'parent_c', path: '/escrow', read: (p) => p.evaluate(() => [...document.querySelectorAll('main h1, main h2, main p')].map((x) => x.textContent.trim()).slice(0, 8)) },
  { id: 'd14-parent-statement', role: 'parent_c', path: '/statement', read: (p) => p.evaluate(() => document.body.innerText.match(/.{0,40}(Escrow|Wallet|Balance|الرصيد|المحفظة).{0,40}/g)) },
  { id: 'd14-desk', role: 'officer', path: () => `/desk?student=${S.c2 ?? ''}`, read: (p) => p.evaluate(() => document.body.innerText.match(/.{0,40}(Escrow|escrow|Wallet|Balance|balance|الرصيد|المحفظة).{0,40}/g)) },
  { id: 'd14-admin-balance-withdrawals', role: 'admin', path: '/admin/escrow', read: (p) => p.evaluate(() => document.body.innerText.match(/.{0,40}(Escrow|escrow|Wallet|Balance|balance|الرصيد|المحفظة).{0,40}/g)) },
];

const errors = [];
for (const s of SCREENS.filter((x) => filter.test(x.id))) {
  const rec = readings[s.id] ?? {};
  if (s.toggle) {
    const ctx = await contextFor(s.role, 'en');
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${s.id} pageerror: ${e.message.slice(0, 200)}`));
    try {
      await page.goto(WEB + (typeof s.path === 'function' ? s.path() : s.path), { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(1200);
      if (s.act) await s.act(page);
      await page.waitForTimeout(600);
      rec.en = s.read ? await s.read(page).catch((e) => `read: ${e.message.slice(0, 120)}`) : null;
      rec.enBytes = await capture(page, path.join(dir, `${s.id}-en.jpg`), s.shot);
      await toggle(page);
      rec.ar = s.read ? await s.read(page).catch((e) => `read: ${e.message.slice(0, 120)}`) : null;
      rec.dir = await page.evaluate(() => document.documentElement.dir);
      rec.arBytes = await capture(page, path.join(dir, `${s.id}-ar.jpg`), s.shot);
    } catch (e) { errors.push(`${s.id}: ${String(e.message ?? e).split('\n')[0].slice(0, 240)}`); }
    await ctx.close();
  } else {
    for (const lang of ['en', 'ar']) {
      const ctx = await contextFor(s.role, lang);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${s.id} ${lang} pageerror: ${e.message.slice(0, 200)}`));
      try {
        const res = await page.goto(WEB + (typeof s.path === 'function' ? s.path() : s.path), { waitUntil: 'networkidle', timeout: 45000 });
        rec[`${lang}Status`] = res?.status() ?? 0;
        await page.waitForTimeout(1500);
        if (s.act) await s.act(page);
        await page.waitForTimeout(600);
        rec[lang] = s.read ? await s.read(page).catch((e) => `read: ${e.message.slice(0, 120)}`) : null;
        if (lang === 'ar') rec.dir = await page.evaluate(() => document.documentElement.dir);
        rec[`${lang}Bytes`] = await capture(page, path.join(dir, `${s.id}-${lang}.jpg`), s.shot);
      } catch (e) { errors.push(`${s.id} ${lang}: ${String(e.message ?? e).split('\n')[0].slice(0, 240)}`); }
      await ctx.close();
    }
  }
  readings[s.id] = rec;
  console.log(phase, s.id, JSON.stringify(rec).slice(0, 300));
}
readings._errors = { ...(readings._errors ?? {}), [new Date().toISOString()]: errors };
// No mobile number in the evidence (CLAUDE.md): an 11-digit run is replaced.
fs.writeFileSync(READINGS, JSON.stringify(readings, null, 1).replace(/(^|[^0-9])01[0-9]{9}(?![0-9])/g, '$1<number>'));
console.log('errors', errors);
await browser.close();
