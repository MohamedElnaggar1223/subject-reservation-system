// Round 2, item 6's control on the screen: the school-fee refusal in Arabic with the dictionary rule as it was
// ("(N EGP)"), the web server reloading the file the control changed. Run by r2c-control.py, which restores it.
import fs from 'node:fs';
import { signIn, go, shot, read, saveReadings, step, apiAs, out, done, errors, readings, ADMIN, PASSWORD, SHOTS } from './lib.mjs';

const dir = `${SHOTS}/round2`;
process.env.SHOTS = dir;
const state = JSON.parse(fs.readFileSync('/tmp/wf/drive/state.json', 'utf8'));
const admin = await apiAs(...ADMIN);
const sched = await admin('POST', '/v1/school-fees/schedules', { academicYear: '2026-2027', grade: null, amount: 5000, opensAt: new Date(Date.now() - 86400000).toISOString() });
try {
  await step('i6-control-ar', async () => {
    const p = await signIn(state.c.parent, PASSWORD, 'ar');
    await go(p, '/register', 3500);
    await p.locator('input[type=checkbox][aria-label*="Chemistry"]').first().check();
    await p.waitForTimeout(800);
    for (const c of await p.locator('div.space-y-2.border-t label input[type=checkbox]').all()) if (!(await c.isDisabled())) await c.check();
    await p.locator('main button').filter({ hasText: 'الحجز' }).last().click();
    await p.waitForTimeout(2500);
    await shot(p, 'r2-i6-control-old-rule-ar');
    await read(p, 'i6-control-old-rule-ar');
    await p.context().close();
  });
} finally {
  await admin('DELETE', `/v1/school-fees/schedules/${sched.id}`);
}
saveReadings('/tmp/wf/drive/r2c-readings.json');
out('i6-control', (readings['i6-control-old-rule-ar'] ?? '').split('\n').filter((l) => /الرسوم|school fee|5,000/.test(l)));
out('errors', JSON.stringify(errors));
await done();
process.exit(0);
