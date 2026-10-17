// The admin's drives on the branch (PHASE after): F8-02 — "Add a subject" on the Catalogue, then the subject on the
// sheet's Add subject; the Catalogue's "Import several from a list" landing on the Subjects page's import; F8-03 — a
// subject marked core deactivated on the Subjects page; F8-01 — the sample draft deleted from its Session screen, and
// the admin's Home before and after.
import fs from 'node:fs';
import { signIn, go, shot, read, saveReadings, step, apiAs, out, done, errors, readings, ADMIN, SHOTS } from './lib.mjs';

const dir = `${SHOTS}/after`;
fs.mkdirSync(dir, { recursive: true });
process.env.SHOTS = dir;
const admin = await apiAs(...ADMIN);
const sessions = await admin('GET', '/v1/sessions');
const list = Array.isArray(sessions) ? sessions : sessions.sessions;
const june = list.find((s) => s.sessionType === 'june' && s.seriesYear === 2027);
const draft = list.find((s) => s.status === 'draft' && s.name.startsWith('November 2026'));

// ── F8-02: Add a subject on the Catalogue ───────────────────────────────────────────────────────────────────────
for (const lang of ['en', 'ar']) {
  await step(`add-subject-${lang}`, async () => {
    const p = await signIn(...ADMIN, lang);
    await go(p, '/exams/catalogue', 3000);
    await p.locator('button', { hasText: lang === 'en' ? 'Add a subject' : 'إضافة مادة' }).first().click();
    await p.waitForTimeout(800);
    const dlg = p.getByRole('dialog');
    await p.fill('#add-subject-name', lang === 'en' ? 'Sociology A.S./A.L.' : 'Sociology O.L.');
    await p.fill('#add-subject-code', lang === 'en' ? '9699' : '0495');
    await dlg.locator('button', { hasText: 'Cambridge International' }).click();
    await p.selectOption('#add-subject-level', lang === 'en' ? 'a_level' : 'igcse');
    await p.fill('#add-subject-fee', lang === 'en' ? '15,000' : '12000');
    await shot(p, `f02-catalogue-add-subject-dialog-${lang}`);
    await dlg.locator('button[type=submit]').click();
    await p.waitForTimeout(2500);
    await shot(p, `f02-catalogue-subject-added-${lang}`);
    await read(p, `after/f02-catalogue-subject-added-${lang}`);
    await p.context().close();
  });
}
await step('sheet-add-subject', async () => {
  const p = await signIn(...ADMIN, 'en');
  await go(p, `/admin/sessions/${june.id}#subjects`, 3500);
  await p.locator('button', { hasText: /^Add subject$|^Add subjects$/ }).first().click();
  await p.waitForTimeout(1500);
  const box = p.locator('div[role=dialog]').last();
  const search = box.locator('input').first();
  await search.fill('Sociology');
  await p.waitForTimeout(1200);
  await shot(p, 'f02-sheet-add-subject-lists-it-en');
  await read(p, 'after/f02-sheet-add-subject-lists-it-en', box);
  await p.context().close();
});
await step('import-entry', async () => {
  const p = await signIn(...ADMIN, 'en');
  await go(p, '/exams/catalogue', 3000);
  await p.locator('a', { hasText: 'Import several from a list' }).click();
  await p.waitForURL((u) => u.pathname.startsWith('/admin/subjects'), { timeout: 20000 });
  await p.waitForTimeout(2500);
  await shot(p, 'f02-import-entry-subjects-page-en');
  await read(p, 'after/f02-import-entry-subjects-page-en');
  await p.context().close();
});

// ── F8-03: a subject marked core, deactivated on the Subjects page ──────────────────────────────────────────────
await step('deactivate-core', async () => {
  const made = await admin('POST', '/v1/subjects', { name: 'Core sample on the page', code: 'CORE-SAMPLE-PAGE', council: 'cambridge', qualificationLevel: 'igcse', courseFee: 1000, isCore: true });
  readings['after/f03-core-made'] = { isCore: made.isCore };
  const p = await signIn(...ADMIN, 'en');
  p.on('dialog', (d) => d.accept());
  await go(p, '/admin/subjects', 3000);
  await p.fill('input[aria-label="Search by name or code..."]', 'CORE-SAMPLE-PAGE');
  await p.waitForTimeout(800);
  await p.locator('tr', { hasText: 'CORE-SAMPLE-PAGE' }).locator('button', { hasText: 'Deactivate' }).click();
  await p.waitForTimeout(2000);
  await shot(p, 'f03-core-deactivated-en');
  await read(p, 'after/f03-core-deactivated-en');
  const back = await admin('GET', `/v1/subjects/${made.id}`);
  readings['after/f03-core-after'] = { isActive: back.isActive, isCore: back.isCore };
  await p.context().close();
});

// ── F8-01: the sample draft deleted from its Session screen ─────────────────────────────────────────────────────
await step('home-before-delete', async () => {
  const p = await signIn(...ADMIN, 'en');
  await go(p, '/', 3000);
  await shot(p, 'f01-admin-home-with-draft-en');
  await read(p, 'after/f01-admin-home-with-draft-en');
  await p.context().close();
});
await step('delete-draft', async () => {
  if (!draft) { readings['after/f01-delete'] = 'no draft'; return; }
  const p = await signIn(...ADMIN, 'en');
  await go(p, `/admin/sessions/${draft.id}`, 3000);
  await p.locator('button', { hasText: 'Delete this draft' }).click();
  await p.waitForTimeout(800);
  const dlg = p.getByRole('dialog').last();
  await dlg.locator('textarea, input').first().fill('The seed\'s sample draft: not this school\'s cycle');
  await shot(p, 'f01-delete-draft-dialog-en');
  await dlg.locator('button', { hasText: 'Delete the draft' }).click();
  await p.waitForURL((u) => u.pathname === '/admin/sessions', { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(2500);
  await shot(p, 'f01-sessions-after-delete-en');
  await read(p, 'after/f01-sessions-after-delete-en');
  await go(p, '/', 3000);
  await shot(p, 'f01-admin-home-after-delete-en');
  await read(p, 'after/f01-admin-home-after-delete-en');
  await p.context().close();
});

saveReadings(`${dir}/readings-admin.json`);
out('errors:', errors.length, errors.slice(0, 8));
await done();
process.exit(0);
