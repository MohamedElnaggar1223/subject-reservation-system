// F6: the import review's row editor on a one-paper line, as the admin at a desk, EN and AR.
// node import-row.mjs <before|after> <importId>
import { chromium } from 'playwright-core';
import { mkdirSync, statSync, readFileSync } from 'node:fs';
const [phase, id] = process.argv.slice(2);
const WEB = process.env.WEB ?? 'http://localhost:3070';
const OUT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/ui-audit/.audit/ui-audit-evidence/s19b-import-one-paper-line';
mkdirSync(OUT, { recursive: true });
const AXE = readFileSync(new URL('./node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const lang of ['en', 'ar']) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addCookies([{ name: 'language', value: lang, url: WEB }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 160)));
  await page.goto(`${WEB}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('#email', 'admin@igcse.local');
  await page.fill('#password', 'AdminPass1');
  await page.locator('form button[type=submit]').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 30000 });
  await page.goto(`${WEB}/imports/${id}?tab=rows`, { waitUntil: 'networkidle' });
  const row = page.locator('[role=row][aria-rowindex="1"]');
  await row.waitFor({ timeout: 20000 });
  await row.click();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  const section = dialog.locator('section[aria-labelledby=row-line]');
  await section.scrollIntoViewIfNeeded();
  const names = await section.getByRole('button').allInnerTexts();
  const entryText = await section.innerText();
  await page.evaluate(AXE);
  const axe = { violations: await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run('[role=dialog]', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, nodes: v.nodes }));
  }) };
  const file = `${OUT}/${phase}-${lang}.jpg`;
  await section.screenshot({ path: file, type: 'jpeg', quality: 70 });
  console.log(phase, lang, 'buttons:', JSON.stringify(names), '| entry line:', JSON.stringify(entryText.split('\n').filter((l) => /Entry|القيد|Retake|إعادة|First|أول/.test(l)).slice(0, 6)),
    '| axe:', axe.violations.map((x) => `${x.id}(${x.nodes.length})`).join(',') || 'none', '| errors:', errors.length, '|', Math.round(statSync(file).size / 1024) + 'KB');
  await ctx.close();
}
await browser.close();
