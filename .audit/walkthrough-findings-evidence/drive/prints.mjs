// F8-11's prints on the branch: the slip and the receipt in Arabic with the school's name, and with the setting
// emptied (the app's name alone), then the name put back.
import fs from 'node:fs';
import { signIn, go, shot, read, saveReadings, step, apiAs, out, done, errors, PASSWORD, ADMIN, SHOTS } from './lib.mjs';
const dir = `${SHOTS}/after`;
fs.mkdirSync(dir, { recursive: true });
process.env.SHOTS = dir;
const state = JSON.parse(fs.readFileSync(process.env.STATE ?? '/tmp/wf/drive/state.json', 'utf8'));
const C = state.c;
const admin = await apiAs(...ADMIN);
const officer = await apiAs('finance@igcse.local', PASSWORD);
const s360 = await officer('GET', `/v1/users/${C.studentId}/summary`);
const rc = s360.registrations.find((r) => r.receipt)?.receipt;
async function prints(tag, lang) {
  const p = await signIn('finance@igcse.local', PASSWORD, lang);
  await p.addInitScript(() => { window.print = () => {}; });
  await go(p, `/reservation-slip/${C.studentId}`, 3000);
  await shot(p, `f11-slip-${tag}-${lang}`);
  await read(p, `after/f11-slip-${tag}-${lang}`);
  await go(p, `/receipt-print/${rc.id}`, 2500);
  await shot(p, `f11-receipt-${tag}-${lang}`);
  await read(p, `after/f11-receipt-${tag}-${lang}`);
  await p.context().close();
}
await step('named-ar', () => prints('named', 'ar'));
await step('empty', async () => {
  await admin('PUT', '/v1/settings/school.name', { value: '', reason: 'F8-11 drive: the prints with the name empty' });
  await prints('unnamed', 'en');
});
await admin('PUT', '/v1/settings/school.name', { value: 'Demo International School', reason: 'F8-11 drive: the name put back' });
saveReadings(`${dir}/readings-prints.json`);
out('errors:', errors.length, errors.slice(0, 5));
await done();
process.exit(0);
