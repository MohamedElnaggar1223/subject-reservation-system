// F6a measurement (FEATURES_PLAN.md F6a "The measurement"), in the forms' terms, against step 4's
// counts (.audit/school-forms-evidence/step4/measure-counts.json). An input is a field filled or a
// control picked; a click is a button or row pressed; sign-in and page navigation are not counted.
import { BASE, browser, errors, out, signIn, shot, step, mainText } from './lib.mjs';
const JUNE = '0f1fecbd-152b-4f1b-9bec-701bd03fd6b9';
const counts = {};
const page = await signIn('admin@igcse.local', 'AdminPass1', 'en');
await page.goto(`${BASE}/admin/sessions/${JUNE}#subjects`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const url0 = page.url();
const drawer = () => page.locator('[role=dialog]').last();

// A. An O.L. subject set up open with a teacher (Economics, no papers on the Catalogue).
await step('A', async () => {
  let inputs = 0, clicks = 0;
  await page.getByRole('button', { name: 'Add subject', exact: true }).click(); clicks++;
  await page.waitForTimeout(800);
  await page.locator('[role=option]', { hasText: 'Economics' }).click(); inputs++;
  await page.waitForTimeout(1000);
  await drawer().locator('label', { hasText: 'Teacher A' }).locator('input[type=checkbox]').first().check(); inputs++;
  await drawer().locator('#sf-fee').fill('11000'); inputs++;
  await shot(page, 'after-m1-add-economics-filled-en', { full: false });
  await drawer().getByRole('button', { name: 'Add subject', exact: true }).click(); clicks++;
  await page.waitForTimeout(2000);
  await shot(page, 'after-m1-add-economics-saved-en', { full: false });
  counts.olSubjectOpenWithTeacher = { inputs, clicks, note: 'Add subject, the subject picked, the teacher ticked, the course fee typed, Add subject; one dialog and the form, no other screen' };
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
});

// B. A one-paper retake opened: Computer Science added, then its Paper 2 in the same form.
await step('B', async () => {
  let inputs = 0, clicks = 0;
  await page.getByRole('button', { name: 'Add subject', exact: true }).click(); clicks++;
  await page.waitForTimeout(800);
  await page.locator('[role=option]', { hasText: 'Computer Science' }).click(); inputs++;
  await page.waitForTimeout(1000);
  await drawer().locator('label', { hasText: 'Teacher B' }).locator('input[type=checkbox]').first().check(); inputs++;
  await drawer().locator('#sf-fee').fill('12000'); inputs++;
  await drawer().getByRole('button', { name: 'Add subject', exact: true }).click(); clicks++;
  await page.waitForTimeout(2500);
  const base = { inputs, clicks };
  // The same form, now with "One paper only": Paper 2 as a retake in school or self study at EGP 3,000.
  const line = drawer().locator('div.grid', { hasText: 'Paper 2' }).first();
  await line.locator('select').selectOption({ label: 'Retake in school or self study' }); inputs++;
  await line.locator('input[type=number]').fill('3000'); inputs++;
  await shot(page, 'after-m2-one-paper-filled-en', { full: false });
  await drawer().getByRole('button', { name: 'Save', exact: true }).click(); clicks++;
  await page.waitForTimeout(2000);
  await shot(page, 'after-m2-one-paper-saved-en', { full: false });
  counts.onePaperRetakeOpened = { inputs: inputs - base.inputs, clicks: clicks - base.clicks, screens: 0, total: { inputs, clicks },
    note: 'after the subject is added the form stays open with "One paper only": the paper\'s choice and its fee, Save; no other screen' };
  out('B text:', (await drawer().innerText()).replace(/\n+/g, ' | ').slice(0, 600));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
});

// C. A series' deadlines from the session's header, in place.
await step('C', async () => {
  let inputs = 0, clicks = 0;
  await page.getByRole('button', { name: /Pearson Edexcel June 2027/ }).click(); clicks++;
  await page.waitForTimeout(1500);
  const dlg = page.locator('[role=dialog]').last();
  await dlg.locator('input[type=datetime-local]').first().fill('2027-02-25T12:00'); inputs++;
  await dlg.locator('input[id^=examsStart-]').fill('2027-05-03'); inputs++;
  await dlg.locator('input[id^=reason-]').fill('Pearson key dates 2026/27 published'); inputs++;
  await shot(page, 'after-m3-dates-dialog-en', { full: false });
  await dlg.getByRole('button', { name: 'Save the dates' }).click(); clicks++;
  await page.waitForTimeout(2000);
  await shot(page, 'after-m3-dates-saved-en', { full: false });
  counts.seriesDeadlines = { inputs, clicks, pageChanges: page.url() === url0 ? 0 : 1, note: 'the series\' line on the session\'s header, the entry deadline, the exams\' start, the reason ("Reason"), Save the dates; the header then reads the new date' };
  out('C header:', (await mainText(page, 600)).replace(/\n+/g, ' | '));
});

out('COUNTS', JSON.stringify(counts, null, 1));
out('ERRORS:', errors.filter((e) => !/Hydration/.test(e)).join('\n') || 'none');
await browser.close();
