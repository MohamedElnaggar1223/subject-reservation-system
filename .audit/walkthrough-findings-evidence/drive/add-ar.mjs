// F8-02 in Arabic: the Catalogue's Add a subject dialog and its result, right to left.
import fs from 'node:fs';
import { signIn, go, shot, read, saveReadings, step, out, done, errors, ADMIN, SHOTS } from './lib.mjs';
const dir = `${SHOTS}/after`;
fs.mkdirSync(dir, { recursive: true });
process.env.SHOTS = dir;
await step('add-subject-ar', async () => {
  const p = await signIn(...ADMIN, 'ar');
  await go(p, '/exams/catalogue', 3000);
  await p.locator('a[href="/admin/subjects?import=1"] + button').click();
  await p.waitForTimeout(800);
  const dlg = p.getByRole('dialog');
  await p.fill('#add-subject-name', 'Sociology O.L.');
  await p.fill('#add-subject-code', '0495');
  await dlg.locator('button[aria-pressed]').nth(1).click();
  await p.selectOption('#add-subject-level', 'igcse');
  await p.fill('#add-subject-fee', '12000');
  await shot(p, 'f02-catalogue-add-subject-dialog-ar');
  await dlg.locator('button[type=submit]').click();
  await p.waitForTimeout(2500);
  await shot(p, 'f02-catalogue-subject-added-ar');
  await read(p, 'after/f02-catalogue-subject-added-ar');
  await p.context().close();
});
saveReadings(`${dir}/readings-add-ar.json`);
out('errors:', errors.length, errors.slice(0, 5));
await done();
process.exit(0);
