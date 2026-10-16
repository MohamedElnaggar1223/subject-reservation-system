// Explore: visit pages as a role, dump the main text and a screenshot (not for the artifact).
import { signIn, out, errors, browser, mainText, BASE } from './lib.mjs';
import fs from 'node:fs';
const [email, password, ...paths] = process.argv.slice(2);
const lang = process.env.LANG_UI ?? 'en';
const page = await signIn(email, password, lang);
out('landed', page.url());
fs.mkdirSync('/tmp/f8-pw/explore', { recursive: true });
for (const p of paths.length ? paths : ['/']) {
  if (p !== '/') await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const name = 'x' + p.replace(/[^a-z0-9]+/gi, '-');
  await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => { e.style.display = 'none'; })).catch(() => {});
  await page.screenshot({ path: `/tmp/f8-pw/explore/${name}.jpg`, type: 'jpeg', quality: 60, fullPage: true });
  out(`==== ${p} ====`);
  out(await mainText(page, Number(process.env.MAXT ?? 6000)));
}
const nav = await page.locator('aside').first().innerText().catch(() => '');
out('==== NAV ====\n' + nav);
out('errors', errors);
await browser.close();
