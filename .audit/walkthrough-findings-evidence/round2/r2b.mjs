// Round 2's drive, the Arabic part after the dictionary's new rules: the kept draft's refusal, the board card as the
// coordinator, and the school-fee refusal on the Reserve page (a schedule for the drive, removed after).
import fs from 'node:fs';
import { signIn, go, shot, read, saveReadings, step, apiAs, out, done, errors, readings, ADMIN, PASSWORD, SHOTS } from './lib.mjs';

const dir = `${SHOTS}/round2`;
fs.mkdirSync(dir, { recursive: true });
process.env.SHOTS = dir;
const COORD = 'coordinator@igcse.local';
const state = JSON.parse(fs.readFileSync('/tmp/wf/drive/state.json', 'utf8'));
const first = JSON.parse(fs.readFileSync('/tmp/wf/drive/r2-readings.json', 'utf8')).readings;
const keptId = first['i2-sessions'].kept[0];
const admin = await apiAs(...ADMIN);
const DAY = 86400000;

await step('i2-kept-ar', async () => {
  const p = await signIn(...ADMIN, 'ar');
  await go(p, `/admin/sessions/${keptId}#subjects`, 3500);
  await p.locator('button', { hasText: 'حذف هذه المسودة' }).first().click();
  await p.waitForTimeout(600);
  const modal = p.locator('div[role=dialog]').last();
  await modal.locator('textarea, input').first().fill('round 2 drive: is it kept?');
  await modal.locator('button', { hasText: 'حذف المسودة' }).last().click();
  await p.waitForTimeout(2000);
  await shot(p, 'r2-i2-kept-refusal-ar');
  await read(p, 'i2-kept-refusal-ar', modal);
  await p.context().close();
});
await step('i1-coordinator-ar', async () => {
  const p = await signIn(COORD, PASSWORD, 'ar');
  await go(p, '/exams/catalogue', 3000);
  const card = p.locator('section[aria-label*="Cambridge"]').first();
  await card.locator('button').filter({ hasText: /تعديل|Edit/ }).first().click();
  await p.waitForTimeout(600);
  await card.scrollIntoViewIfNeeded();
  await shot(p, 'r2-i1-board-coordinator-ar');
  await read(p, 'i1-board-coordinator-ar', card);
  await p.context().close();
});
const sched = await admin('POST', '/v1/school-fees/schedules', { academicYear: '2026-2027', grade: null, amount: 5000, opensAt: new Date(Date.now() - DAY).toISOString() });
try {
  await step('i6-school-fee-ar', async () => {
    const p = await signIn(state.c.parent, PASSWORD, 'ar');
    await go(p, '/register', 3500);
    await p.locator('#reserve-session').selectOption({ label: 'يونيو 2027' }).catch(async () => {
      const opts = await p.locator('#reserve-session option').allInnerTexts();
      readings['i6-session-options-ar'] = opts;
    });
    await p.waitForTimeout(1500);
    await p.locator('input[type=checkbox][aria-label*="Chemistry"]').first().check();
    await p.waitForTimeout(800);
    for (const c of await p.locator('div.space-y-2.border-t label input[type=checkbox]').all()) if (!(await c.isDisabled())) await c.check();
    await p.waitForTimeout(400);
    await p.locator('main button').filter({ hasText: 'الحجز' }).last().click();
    await p.waitForTimeout(2500);
    await shot(p, 'r2-i6-school-fee-refusal-ar');
    await read(p, 'i6-school-fee-refusal-ar');
    await p.context().close();
  });
} finally {
  await admin('DELETE', `/v1/school-fees/schedules/${sched.id}`);
}
saveReadings('/tmp/wf/drive/r2b-readings.json');
for (const k of ['i2-kept-refusal-ar', 'i1-board-coordinator-ar']) out(k, readings[k]);
out('i6', (readings['i6-school-fee-refusal-ar'] ?? '').split('\n').filter((l) => /الرسوم|school fee|5,000/.test(l)));
out('options', readings['i6-session-options-ar']);
out('errors', JSON.stringify(errors, null, 1));
await done();
process.exit(0);
