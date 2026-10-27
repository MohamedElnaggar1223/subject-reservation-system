/**
 * The words check's own controls (`node --test apps/web/scripts/check-setup-words.test.mjs`): words planted in a
 * copy of a screen, a shared component and @repo/validations' sentences must each be caught, in any case and in
 * Arabic, and the values the code only tests must not be; the real tree must be clean.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { check, validationsSentences } from './check-setup-words.mjs';

/** A web root with the given files, checked with a stand-in for @repo/validations. */
function tree(files) {
  const web = mkdtempSync(path.join(tmpdir(), 'setup-words-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(web, rel)), { recursive: true });
    writeFileSync(path.join(web, rel), text);
  }
  return web;
}
const LIB = { impactSentence: () => 'This changes nothing for families.', DECLARATION_TEXT: 'I confirm.', apiResponse: () => null };
const run = (files, opts = {}) => check({ web: tree(files), screens: Object.keys(files).filter((f) => f.startsWith('screen')), shared: opts.shared ?? [], wording: null, lib: opts.lib ?? LIB });

test('a planted word on a screen is caught: JSX text, a sentence, any case, a lone lowercase word, Arabic', async () => {
  const { hits } = await run({
    'screen.tsx': [
      "export const A = () => <p>Check the sitting of each subject</p>;",
      "export const B = 'Pick the SERIES first';",
      "export const C = 'sittings';",
      "export const D = <span aria-label=\"Components\">x</span>;",
      "export const E = 'اختر الدورة';",
      'export const F = `${1} option codes left`;',
    ].join('\n'),
  });
  assert.equal(hits.length, 6, hits.join('\n'));
});

test('a value the code only tests, a class name and a key are not words', async () => {
  const { hits } = await run({
    'screen.tsx': [
      "export const a = (k: string) => k === 'series' || k !== 'sitting';",
      "export const b = (k: string) => { switch (k) { case 'components': return 1; } return 0; };",
      "export const c = <div className=\"series-grid\" data-kind=\"series\" key=\"sitting\" />;",
      "type K = 'series' | 'award';",
    ].join('\n'),
  });
  assert.deepEqual(hits, []);
});

test('a shared component is read, only the pieces she meets when named', async () => {
  const shared = [{ file: 'ui/badge.tsx' }, { file: 'exams.tsx', only: ['InstantText'] }];
  const { hits } = await run({
    'screen.tsx': 'export const ok = <p>Fine</p>;',
    'ui/badge.tsx': "export const Badge = () => <span>Award</span>;",
    'exams.tsx': "export function SeriesName() { return <span>Series</span>; }\nexport function InstantText() { return <time>Sitting date</time>; }",
  }, { shared });
  assert.equal(hits.length, 2, hits.join('\n'));
  assert.ok(hits.some((h) => h.includes('Award')) && hits.some((h) => h.includes('Sitting date')) && !hits.some((h) => h.includes(': Series')));
});

test('the sentences of @repo/validations her screens show are checked, and a new sentence function must be named', async () => {
  const screen = "import { impactSentence, IMPACT_TEXT, deriveSessionName, makeLabel, ImpactSchema } from '@repo/validations';\nexport const x = 1;";
  const lib = {
    impactSentence: () => 'This re-prices 2 lines of the series.',
    IMPACT_TEXT: 'Saved for each sitting',
    deriveSessionName: (t, y) => `June ${y}`,
    makeLabel: () => 'harmless',
    ImpactSchema: function Schema() {},
  };
  const { hits } = await run({ 'screen.tsx': screen }, { lib });
  // Each of impactSentence's samples is a hit of its own; three names in all, deriveSessionName and the schema clean.
  assert.equal(new Set(hits.map((h) => h.split(':')[0])).size, 3, hits.join('\n'));
  assert.ok(hits.some((h) => h.includes('impactSentence')));
  assert.ok(hits.some((h) => h.includes('IMPACT_TEXT')));
  assert.ok(hits.some((h) => h.includes('makeLabel') && h.includes('no sample')));
});

test("the Arabic another dictionary gives a phrase of hers is checked: the translator may render it", async () => {
  const web = tree({
    'screen.tsx': 'export const A = () => <p>This cycle</p>;\nexport const B = () => <p>Fine</p>;',
    'lib/i18n-other.ts': "export const other = { 'This cycle': 'هذه الدورة', 'Fine': 'جيد', 'Not hers': 'السلسلة' };",
  });
  const { hits } = await check({ web, screens: ['screen.tsx'], shared: [], wording: null, lib: LIB });
  assert.equal(hits.length, 1, hits.join('\n'));
  assert.ok(hits[0].includes("'This cycle' renders"));
});

test('validationsSentences calls each sample and reads strings, lists and records', () => {
  const out = validationsSentences(['f', 'S', 'L', 'R'], { f: (n) => `n=${n}`, S: 'one', L: ['two', 3], R: { a: 'three' } }, { f: [[1], [2]] }, new Set());
  assert.deepEqual(out.map((x) => x.v), ['n=1', 'n=2', 'one', 'two', 'three']);
});

test('the real tree is clean', async () => {
  const { hits } = await check();
  assert.deepEqual(hits, []);
});
