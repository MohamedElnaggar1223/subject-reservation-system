/**
 * The family's and the desk's words check, its own controls (`node --test apps/web/scripts/check-reservation-words.test.mjs`):
 * each forbidden word planted in a copy of a screen, a shared component, a dictionary and @repo/validations' sentences
 * must be caught — in any case and in Arabic, the P3 words (provisional, cut-off, offer item, مؤقت) as well as the
 * coordinator's — and the values the code only tests must not be; the real tree must be clean.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkFamily, familyForbidden } from './check-reservation-words.mjs';

/** A web root with the given files, checked with a stand-in for @repo/validations. */
function tree(files) {
  const web = mkdtempSync(path.join(tmpdir(), 'family-words-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(web, rel)), { recursive: true });
    writeFileSync(path.join(web, rel), text);
  }
  return web;
}
const LIB = { DESK_CONSENT_TEXT: 'Read and signed.', apiResponse: () => null, refundConsentText: () => 'I confirm that I have read the refund policy.' };
const run = (files, opts = {}) => checkFamily({
  web: tree(files), screens: Object.keys(files).filter((f) => f.startsWith('screen')), shared: opts.shared ?? [], wording: null,
  dictionaries: opts.dictionaries ?? [], lib: opts.lib ?? LIB,
});

test('a planted word on a screen is caught: JSX text, a sentence, any case, a lone lowercase word, Arabic, the P3 words', async () => {
  const { hits } = await run({
    'screen.tsx': [
      'export const A = () => <p>Name the sitting your child sat</p>;',
      "export const B = 'Pick the SERIES first';",
      "export const C = 'provisional';",
      'export const D = <span aria-label="Board fee Provisional">x</span>;',
      "export const E = 'Your cut-off is near';",
      "export const F = 'Pick an offer item';",
      "export const G = 'رسوم مؤقتة';",
      "export const H = 'اختر الدورة';",
      'export const I = `${1} components left`;',
      "export const J = 'the cut off date';",
    ].join('\n'),
  });
  assert.equal(hits.length, 10, hits.join('\n'));
});

test('a value the code only tests, a class name, a key, a status list and a record key are not words', async () => {
  const { hits } = await run({
    'screen.tsx': [
      "export const a = (k: string) => k === 'provisional' || k !== 'sitting';",
      "export const b = (k: string) => { switch (k) { case 'components': return 1; } return 0; };",
      'export const c = <div className="series-grid" data-kind="series" key="sitting" />;',
      "type K = 'series' | 'award';",
      "export const d = (s: string) => ['provisional', 'series'].includes(s);",
      "export const e = { provisional: 'Not final yet' };",
    ].join('\n'),
  });
  assert.deepEqual(hits, []);
});

test('a shared component is read, only the pieces the screens use when named', async () => {
  const shared = [{ file: 'ui/badge.tsx' }, { file: 'charges.tsx', only: ['CollectedNotice'] }];
  const { hits } = await run({
    'screen.tsx': 'export const ok = <p>Fine</p>;',
    'ui/badge.tsx': 'export const Badge = () => <span>Provisional</span>;',
    'charges.tsx': 'export function SeriesCard() { return <span>Series</span>; }\nexport function CollectedNotice() { return <p>One payment per cut-off</p>; }',
  }, { shared });
  assert.equal(hits.length, 2, hits.join('\n'));
  assert.ok(hits.some((h) => h.includes('Provisional')) && hits.some((h) => h.includes('cut-off')) && !hits.some((h) => h.includes(': Series')));
});

test('the sentences of @repo/validations the screens show are checked, and a new sentence function must be named', async () => {
  const screen = "import { refundConsentText, STATUS_TEXT, makeLabel, ReserveSchema } from '@repo/validations';\nexport const x = 1;";
  const lib = {
    refundConsentText: () => 'The board fee is provisional.',
    STATUS_TEXT: { waiting: 'Waiting for the sitting' },
    makeLabel: () => 'harmless',
    ReserveSchema: function Schema() {},
  };
  const { hits } = await run({ 'screen.tsx': screen }, { lib });
  assert.equal(new Set(hits.map((h) => h.split(':')[0])).size, 3, hits.join('\n'));
  assert.ok(hits.some((h) => h.includes('refundConsentText')));
  assert.ok(hits.some((h) => h.includes('STATUS_TEXT')));
  assert.ok(hits.some((h) => h.includes('makeLabel') && h.includes('no sample')));
});

test('the Arabic a dictionary gives a phrase of these screens is checked: the translator may render it', async () => {
  const web = tree({
    'screen.tsx': 'export const A = () => <p>Prices not final</p>;\nexport const B = () => <p>Fine</p>;',
    'lib/i18n-other.ts': "export const other = { 'Prices not final': 'الأسعار مؤقتة', 'Fine': 'جيد', 'Not ours': 'السلسلة' };",
  });
  const { hits } = await checkFamily({ web, screens: ['screen.tsx'], shared: [], wording: null, lib: LIB });
  assert.equal(hits.length, 1, hits.join('\n'));
  assert.ok(hits[0].includes("'Prices not final' renders"));
});

test('the words: plain words pass, every forbidden one is caught', () => {
  for (const ok of ['Last day to pay', 'prices not final yet', 'the earlier exam', 'آخر يوم للدفع', 'الأسعار ليست نهائية بعد', 'Exam month', 'كلمة مرور مؤقتة', 'كلمات المرور المؤقتة', 'ماذا سيأخذ ابنك/ابنتك؟', 'صفحة لكل ابن/ابنة', 'الابن/الابنة']) assert.equal(familyForbidden(ok), false, ok);
  for (const bad of ['Sittings', 'series', 'Award', 'suite', 'component', 'mapping', 'option code', 'provisionally', 'cut-off', 'cutoff day', 'Offer items', 'للدورة', 'مؤقتة', 'ماذا سيأخذ ابنك؟', 'صفحة لكل ابن:', 'متاحة لابنك في']) {
    assert.equal(familyForbidden(bad === 'cutoff day' ? 'cut off day' : bad), true, bad);
  }
});

test('the older words on a screen are caught (the fix round of P4a): payment due, pending payment, board fee, registration', async () => {
  const { hits } = await run({
    'screen.tsx': [
      'export const A = () => <p>Payment due 31 Dec</p>;',
      "export const B = 'Pending Payment';",
      'export const C = <span>Board fee</span>;',
      "export const D = 'No registrations yet';",
      'export const E = `${2} registration${"s"} approved`;',
    ].join('\n'),
  });
  assert.equal(hits.length, 5, hits.join('\n'));
  for (const w of ['Payment due', 'Pending Payment', 'Board fee', 'No registrations yet', 'registration']) assert.ok(hits.some((h) => h.includes(w)), w);
});

test('a route, a query key, a tested value and a shared component are not read for the older words', async () => {
  const shared = [{ file: 'panel.tsx' }];
  const { hits } = await run({
    'screen.tsx': [
      'export const a = <a href="/registrations">Your reservations</a>;',
      "export const b = { queryKey: ['registrations', 'pending'] };",
      "export const c = (t: string) => t.startsWith('Swap from registration');",
      "export const d = '/registrations/history';",
      'export const e = `/checkout?ids=${1}`;',
    ].join('\n'),
    'panel.tsx': 'export const P = () => <p>Registrations expired:</p>;',
  }, { shared });
  assert.deepEqual(hits, []);
});

test('the real tree is clean', async () => {
  const { hits } = await checkFamily();
  assert.deepEqual(hits, []);
});
