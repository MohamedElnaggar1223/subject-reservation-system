// The before state of F8-01 (the admin's Home with the sample draft) and F8-03 (a core subject's Deactivate on the
// Subjects page), on main's system.
import fs from 'node:fs';
import { signIn, go, shot, read, saveReadings, step, apiAs, out, done, errors, readings, ADMIN, SHOTS } from './lib.mjs';
const dir = `${SHOTS}/before`;
fs.mkdirSync(dir, { recursive: true });
process.env.SHOTS = dir;
const admin = await apiAs(...ADMIN);
await step('home', async () => {
  const p = await signIn(...ADMIN, 'en');
  await go(p, '/', 3000);
  await shot(p, 'f01-admin-home-with-draft-en');
  await read(p, 'before/f01-admin-home-with-draft-en');
  await p.context().close();
});
await step('deactivate-core', async () => {
  const made = await admin('POST', '/v1/subjects', { name: 'Core sample on the page', code: 'CORE-SAMPLE-PAGE', council: 'cambridge', qualificationLevel: 'igcse', courseFee: 1000, registrationFee: 0, isOfferedAtSchool: true, isCore: true });
  const p = await signIn(...ADMIN, 'en');
  p.on('dialog', (d) => d.accept());
  await go(p, '/admin/subjects', 3000);
  await p.fill('input[aria-label="Search by name or code..."]', 'CORE-SAMPLE-PAGE');
  await p.waitForTimeout(800);
  await p.locator('tr', { hasText: 'CORE-SAMPLE-PAGE' }).locator('button', { hasText: 'Deactivate' }).click();
  await p.waitForTimeout(2000);
  await shot(p, 'f03-core-deactivate-refused-en');
  await read(p, 'before/f03-core-deactivate-refused-en');
  const back = await admin('GET', `/v1/subjects/${made.id}`);
  readings['before/f03-core-after'] = { isActive: back.isActive, isCore: back.isCore };
  await p.context().close();
});
saveReadings(`${dir}/readings-extra.json`);
out('errors:', errors.length, errors.slice(0, 5));
await done();
process.exit(0);
