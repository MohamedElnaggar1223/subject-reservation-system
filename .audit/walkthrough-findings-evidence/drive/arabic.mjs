// F8-04's drive: Arabic A.L.'s second qualification (the Edexcel GCE 9AA0 beside the IAL YAA01) on the subject's form.
// PHASE=before: the demo made the GCE item through the item endpoint (no screen did); it is removed here (no line on
// it) and the form shown: nothing on it adds one. PHASE=after: the form's "Add a qualification" makes it again with its
// own teacher; the form and the family's form (Preview) shown.
import fs from 'node:fs';
import { signIn, go, shot, read, saveReadings, step, apiAs, out, done, errors, readings, ADMIN, SHOTS } from './lib.mjs';

const PHASE = process.env.PHASE ?? 'after';
const dir = `${SHOTS}/${PHASE}`;
fs.mkdirSync(dir, { recursive: true });
process.env.SHOTS = dir;
const admin = await apiAs(...ADMIN);
const sessions = await admin('GET', '/v1/sessions');
const june = (Array.isArray(sessions) ? sessions : sessions.sessions).find((s) => s.sessionType === 'june' && s.seriesYear === 2027);
const offers = (await admin('GET', `/v1/sessions/${june.id}/offers`)).offers;
const ar = offers.find((o) => o.subject.name === 'Arabic A.L.');
readings[`${PHASE}/f04-items-before-drive`] = ar.items.map((i) => ({ kind: i.kind, label: i.label, group: i.exclusiveGroup, q: i.qualification?.code, teachers: i.teachers.map((t) => t.name) }));
readings[`${PHASE}/f04-qualificationsToAdd`] = ar.qualificationsToAdd ?? '(not in main\'s read)';

if (PHASE === 'before') {
  const gce = ar.items.find((i) => i.kind === 'qualification');
  if (gce) await admin('DELETE', `/v1/sessions/${june.id}/offers/${ar.id}/items/${gce.id}`);
}

async function openForm(p) {
  await go(p, `/admin/sessions/${june.id}#subjects`, 3500);
  await p.locator('button, tr, li, div[role=button]', { hasText: 'Arabic A.L.' }).first().click();
  await p.waitForTimeout(2000);
}

for (const lang of ['en', 'ar']) {
  await step(`form-${lang}`, async () => {
    const p = await signIn(...ADMIN, lang);
    await openForm(p);
    const drawer = p.locator('div[role=dialog]').last();
    const sec = drawer.locator('section', { hasText: lang === 'en' ? 'Another qualification' : 'مؤهل آخر' });
    if (await sec.count()) await sec.scrollIntoViewIfNeeded();
    else await drawer.locator('h3', { hasText: lang === 'en' ? 'Grade 10 core' : 'Grade 10' }).first().scrollIntoViewIfNeeded().catch(() => {});
    await shot(p, `f04-arabic-al-form-${lang}`);
    await read(p, `${PHASE}/f04-arabic-al-form-${lang}`, drawer);
    if (PHASE === 'after' && lang === 'en') {
      await sec.locator('button', { hasText: 'Add a qualification' }).first().click();
      await p.waitForTimeout(800);
      await sec.locator('button', { hasText: 'Show every teacher' }).click().catch(() => {});
      await sec.locator('label', { hasText: 'Teacher 26' }).first().locator('input[type=checkbox]').check();
      await shot(p, 'f04-arabic-al-add-panel-en');
      await sec.locator('button', { hasText: 'Add the qualification' }).click();
      await p.waitForTimeout(3500);
      const q = drawer.locator('section', { hasText: 'Qualifications' }).first();
      if (await q.count()) await q.scrollIntoViewIfNeeded();
      await shot(p, 'f04-arabic-al-added-en');
      await read(p, `${PHASE}/f04-arabic-al-added-en`, drawer);
      await drawer.locator('button', { hasText: "Preview the family's form" }).click();
      await p.waitForTimeout(3000);
      await shot(p, 'f04-arabic-al-preview-en');
      await read(p, `${PHASE}/f04-arabic-al-preview-en`, p.locator('div[role=dialog]').last());
    }
    await p.context().close();
  });
}
const after = (await admin('GET', `/v1/sessions/${june.id}/offers`)).offers.find((o) => o.id === ar.id);
readings[`${PHASE}/f04-items-after-drive`] = after.items.map((i) => ({ kind: i.kind, label: i.label, group: i.exclusiveGroup, q: i.qualification?.code, teachers: i.teachers.map((t) => t.name) }));
saveReadings(`${dir}/readings-f04.json`);
out('errors:', errors.length, errors.slice(0, 8));
await done();
process.exit(0);
