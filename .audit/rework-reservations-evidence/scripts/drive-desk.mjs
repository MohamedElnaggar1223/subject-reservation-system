// Credentials of the local dev container and its demo accounts are read from the environment (DEV_PASSWORD, DEV_ADMIN_PASSWORD, DEV_PG_ADMIN_URL, DEV_PG_BASE_URL).
// The desk (§4.3): find the student, Reserve, tick lines (a teacher left as no preference, a
// provisional line, a carry-forward with its sitting), the one consent tick, "Reserve and
// collect" with cash; the result, the slip; the statement section and the teacher change.
import { mkdirSync, readFileSync } from 'node:fs';
import { browser, signedIn, shot, WEB, EV } from './lib.mjs';

mkdirSync(EV, { recursive: true });
const demo = JSON.parse(readFileSync('/tmp/rwb/demo-B.json', 'utf8'));
const lang = process.argv[2] ?? 'en';
const who = process.argv[3] ?? 'demob';
const b = await browser();
const page = await signedIn(b, 'officer.mona@igcse.local', process.env.DEV_PASSWORD, lang);
const counts = { inputs: 0, clicks: 0 };
const input = () => counts.inputs++;
const click = () => counts.clicks++;

await page.goto(`${WEB}/desk`);
await page.fill('input[type="search"]', who); input();
await page.getByRole('button', { name: new RegExp(`student\\.${who}@igcse\\.local`) }).first().click(); click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: lang === 'ar' ? '+ حجز' : '+ Reserve' }).click(); click();
await page.selectOption('#desk-session', demo.sessionId); input();
await page.getByRole('checkbox', { name: /Biology O\.L\./ }).waitFor({ timeout: 30000 });
await shot(page, `desk-reserve-empty-${lang}`);

const tick = async (label) => { await page.getByRole('checkbox', { name: new RegExp(label) }).check(); click(); };
await tick('Biology O.L.');
await tick('Mathematics O.L.');
await tick('Statistics O.L.');
await tick('Physics A.S./A.L.');
// The carry-forward names its AS sitting (declared at the desk).
const sittingSelect = page.getByRole('combobox', { name: lang === 'ar' ? 'The sitting it follows' : 'The sitting it follows' });
const opts = await sittingSelect.locator('option').allTextContents();
await sittingSelect.selectOption({ index: Math.min(1, opts.length - 1) }); input();
await page.getByRole('checkbox', { name: /read and signed by the parent|قرأ ولي الأمر/ }).check(); click();
await shot(page, `desk-reserve-filled-${lang}`);
await page.getByRole('button', { name: /Reserve and collect|حجز وتحصيل/ }).click(); click();
await page.waitForTimeout(2500);
await shot(page, `desk-reserve-done-${lang}`);
console.log('desk counts (from the search box):', JSON.stringify(counts));

// The statement on the Student 360, and the teacher change.
await page.getByRole('button', { name: /^Statement$|^كشف الحساب$/ }).click();
await page.waitForTimeout(1500);
await shot(page, `desk-statement-${lang}`);
const teacherBtn = page.getByRole('button', { name: /^Teacher$|^المعلم$/ }).first();
if (await teacherBtn.count()) {
  await teacherBtn.click();
  await page.waitForTimeout(800);
  await shot(page, `desk-teacher-modal-${lang}`);
  await page.keyboard.press('Escape');
}

// The slip.
const slip = page.getByRole('link', { name: /Print the reservation slip|اطبع قسيمة الحجز/ });
if (await slip.count()) {
  const href = await slip.getAttribute('href');
  const p2 = await page.context().newPage();
  await p2.goto(`${WEB}${href}`);
  await p2.waitForTimeout(1500);
  await shot(p2, `slip-${lang}`);
}
await b.close();
