// Part 2, the entries to the board: Exam Entries (the paid reservations made into entries), Candidates (what
// the board needs of each candidate, and the candidate numbers), Entry Lists (the board portal's rows and
// what the board would refuse).
import { signIn, BASE, shot, out, errors, browser, mainText, apiAs, toTop, settingCard } from './lib.mjs';
import { ADMIN, FAMILIES, CENTRES } from './cycle-data.mjs';

const admin = await apiAs(ADMIN.email, ADMIN.password);
const june = (await admin('GET', '/v1/sessions')).find((s) => s.name === 'June 2027');
const cam = june.boardSeries.find((b) => b.boardCode === 'cambridge');
const page = await signIn(ADMIN.email, ADMIN.password);

// Exam Entries: Cambridge June 2027, derived from the paid reservations.
await page.goto(`${BASE}/exams/entries?series=${cam.id}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Preview', exact: true }).click();
await page.getByRole('button', { name: /^Make the|^Bring them up to date/ }).waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
await shot(page, 'p2-65-entries-preview');
await page.getByRole('button', { name: /^Make the|^Bring them up to date/ }).click();
await page.waitForTimeout(2500);
await toTop(page, page.getByText(/^Entries$/).first(), 20).catch(() => {});
await shot(page, 'p2-66-entries-made');
out(await mainText(page, 2000));

// Candidates: the legal name, date of birth and gender of each, then the candidate numbers in the series.
await page.goto(`${BASE}/exams/candidates?series=${cam.id}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await shot(page, 'p2-67-candidates');
for (const [name, dob, gender] of [[FAMILIES.desk.student.name, '2010-03-14', 'female'], [FAMILIES.app.student.name, '2010-07-02', 'male']]) {
  await page.getByRole('row', { name: new RegExp(name) }).first().click();
  await page.waitForTimeout(1200);
  const form = page.getByRole('form', { name: "The candidate's details" });
  const [first, last] = name.split(' ');
  await form.locator('input[id^=forenames-]').fill(first);
  await form.locator('input[id^=surname-]').fill(last);
  await form.locator('input[id^=dob-]').fill(dob);
  await form.locator('select[id^=gender-]').selectOption(gender).catch(() => {});
  if (name === FAMILIES.desk.student.name) await shot(page, 'p2-68-candidate-details');
  await form.getByRole('button', { name: 'Save the details' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Close', exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(800);
}
await page.getByRole('button', { name: 'Assign candidate numbers' }).click();
await page.getByRole('button', { name: 'Assign these numbers' }).waitFor({ timeout: 15000 });
await shot(page, 'p2-69-candidate-numbers');
await page.getByRole('button', { name: 'Assign these numbers' }).click();
await page.waitForTimeout(2000);

// The school's centre number with each board (Settings → Exam entries), which every row of the list carries.
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
{
  const card = settingCard(page, 'Centre numbers and entry route');
  await toTop(page, card, 70);
  await card.getByRole('button', { name: 'Change' }).click();
  for (const [board, number] of Object.entries(CENTRES)) await card.getByLabel(`Centre number with ${board}`).fill(number);
  await card.locator('textarea').fill('The centre number the board issued to the school');
  await shot(page, 'p2-70a-settings-centre-number');
  await card.getByRole('button', { name: 'Save change' }).click();
  await page.waitForTimeout(1500);
}

// Entry Lists: the board portal's rows, with what is still flagged.
await page.goto(`${BASE}/exams/entry-lists?series=${cam.id}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await shot(page, 'p2-70-entry-list');
out(await mainText(page, 3000));
out('errors', errors);
await browser.close();
