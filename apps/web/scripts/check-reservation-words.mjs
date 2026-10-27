#!/usr/bin/env node
/**
 * The family's and the desk's words (COORDINATOR_REWORK.md F3, §13 P3; the lead's "mock" row): none of award, suite,
 * series, sitting, component, mapping, option code, provisional, cut-off or offer item on a family's or the desk's
 * screen — in English, any case, or in Arabic (دورة is the app's "sitting", سلسلة its "series", مكوّن its
 * "component", مؤقت its "provisional"). "Last day to pay", "prices not final yet", "the earlier exam" are the words.
 *
 * The same reading as the coordinator's check (scripts/check-setup-words.mjs, whose parsers it reuses):
 * - the screens' source: JSX text, and each string literal or template part that reads as words (a space in it, a
 *   capital first, or one of the words itself); class names, ids, keys and the values the code only tests are left out;
 * - the shared components these screens render, whole or only the pieces they use;
 * - the sentences of @repo/validations they show: every string or list of strings they import, and each function
 *   that makes a sentence, called with samples (a function not named below fails the check);
 * - every phrase of lib/i18n-reservations.ts, and the Arabic any dictionary (lib/i18n*.ts, .tsx) gives a phrase these
 *   screens use (the page translator may take a phrase's Arabic from another screen's dictionary).
 * What the screens show from the API (refusals, the eligibility reason, a line's basis) passes through familyWords
 * (lib/i18n-reservations.ts) first; the rendered pages are read by P3's drive (.audit/coordinator-p3-evidence).
 *
 * Run from the repository or apps/web: `node apps/web/scripts/check-reservation-words.mjs` (exit 1 on a hit); `--list`
 * prints the strings it checked; `--missing` lists the phrases no dictionary translates (a help, never a failure: a
 * sentence with data is translated by a rule). Its planted-word controls are `check-reservation-words.test.mjs`.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WEB, dictionaryPairs, DICTIONARIES, validationsImportsOf, validationsSentences } from './check-setup-words.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');

/** The family's and the desk's screens (P3's §9.3 rows) and the reservation page's parts. */
export const FAMILY_SCREENS = [
  'components/reservations/reserve.tsx',
  'components/reservations/offers.ts',
  'components/reservations/statement.tsx',
  'components/reservations/swap-pick.tsx',
  'components/reservations/class-follow.tsx',
  'app/(app)/register/register.client.tsx',
  'app/(app)/checkout/checkout.client.tsx',
  'app/(app)/registrations/registrations.client.tsx',
  'app/(app)/approvals/approvals.client.tsx',
  'app/(app)/reservation-slip/[studentId]/slip.client.tsx',
  'app/(app)/family-next.client.tsx',
  'app/(app)/home-summary.client.tsx',
  'app/(app)/escrow/escrow.client.tsx',
  'app/(app)/desk/desk.client.tsx',
  'app/(app)/desk/desk-collect.client.tsx',
  'app/(app)/desk/desk-today.client.tsx',
  'app/(app)/statement/statement.client.tsx',
];

/** The shared components these screens render; `only` names the pieces they use. */
export const FAMILY_SHARED = [
  { file: 'app/(app)/(sessions)/admin/sessions/sessions-shared.tsx', only: ['Money', 'Day', 'Modal', 'Field', 'ErrorLine', 'errorText', 'INPUT_CLASS', 'TEXTAREA_CLASS'] },
  { file: 'app/(app)/(charges)/charges/charges-shared.tsx', only: ['CollectedNotice', 'CollectBar', 'kindLabel'] },
  { file: 'app/(app)/exams/exams-shared.tsx', only: ['InstantText'] },
  { file: 'app/(app)/academic/calendar/academic-shared.tsx', only: ['DateText'] },
  { file: 'components/ui/tone.tsx' },
  { file: 'components/ui/query-state.tsx' },
  { file: 'components/ui/button.tsx' },
  { file: 'components/ui/reason-modal.tsx' },
  { file: 'components/print-heading.tsx' },
  { file: 'lib/groups-followed.ts' },
  // The desk's "Academic record" (F0a's panel, shared with /students).
  { file: 'components/student-academic-panel.tsx' },
];

export const FAMILY_FORBIDDEN_EN = /\b(awards?|suites?|series|sittings?|components?|mappings?|option[ -]codes?|provisional(?:ly)?|cut[- ]offs?|offer[ -]items?)\b/i;
// مؤقت is "provisional" (a fee, a price); a temporary password (كلمة مرور مؤقتة) is not jargon. ابن alone ("son",
// "your son") speaks of every child as a boy: the app says ابنك/ابنتك (ابن/ابنة).
export const FAMILY_FORBIDDEN_AR = /(^|[^\p{L}])[وفبكل]?(?:ال|لل)?(دورة|دورت|دورات|سلسلة|سلاسل|مكوّ?ن)|(?<!مرور\s?)(?<!المرور\s?)(?:^|[^\p{L}])(?:ال)?مؤقت|(?:^|[^\p{L}/])[وفبكل]?(?:ال|لل)?ابن(?:ك|ه|ي)?(?![\p{L}\p{M}/])/u;
export const familyForbidden = (s) => FAMILY_FORBIDDEN_EN.test(s) || FAMILY_FORBIDDEN_AR.test(s);

/** JSX attributes whose value is never read as words. */
const NOT_WORDS = new Set(['className', 'id', 'htmlFor', 'key', 'href', 'type', 'role', 'variant', 'size', 'tone', 'dir', 'lang', 'inputMode',
  'aria-controls', 'aria-labelledby', 'aria-describedby', 'value', 'name', 'step', 'min', 'max', 'rows', 'colSpan', 'headingLevel', 'place', 'queryKey']);

/**
 * Every string of a file a reader can meet, with its line (the coordinator check's reading, with this check's words:
 * a lone lowercase word is read when it is one of them). `only` keeps the strings inside the named top-level
 * functions or constants.
 */
export function familyStringsOf(file, only) {
  const text = readFileSync(file, 'utf8');
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const push = (s, node) => {
    const v = s.replace(/\s+/g, ' ').trim();
    if (!v) return;
    out.push({ v, line: src.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
  };
  const words = (s) => /\s/.test(s.trim()) || /^[A-Z“'—(]/.test(s.trim()) || familyForbidden(s);
  const tested = (node) => {
    const p = node.parent;
    return (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind))
      || ts.isCaseClause(p) || ts.isLiteralTypeNode(p)
      // A status the code looks for in a list (['pending_payment', 'confirmed'].includes(…)) is a value, not a word.
      || (ts.isArrayLiteralExpression(p) && p.elements.every((e) => ts.isStringLiteral(e) && /^[a-z_]+$/.test(e.text)));
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxAttribute(node) && NOT_WORDS.has(node.name.getText())) return;
    if (ts.isJsxAttribute(node) && node.name.getText().startsWith('data-')) return;
    if (ts.isElementAccessExpression(node)) { visit(node.expression); return; }
    // A record's keys (a status code → its label) are values; its labels are read.
    if (ts.isPropertyAssignment(node)) { visit(node.initializer); return; }
    if (ts.isJsxText(node)) push(node.getText(), node);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { if (words(node.text) && !tested(node)) push(node.text, node); }
    else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' … ');
      if (words(parts)) push(parts, node);
      node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (!only) visit(src);
  else {
    for (const st of src.statements) {
      const names = ts.isFunctionDeclaration(st) && st.name ? [st.name.text]
        : ts.isVariableStatement(st) ? st.declarationList.declarations.map((d) => d.name.getText()) : [];
      if (names.some((n) => only.includes(n))) visit(st);
    }
  }
  return out;
}

/** Each sentence function of @repo/validations these screens call, with samples that say every part of it. */
export const FAMILY_SAMPLES = {
  refundConsentText: [
    [{ kind: 'weeks', steps: [{ throughWeek: 2, percent: 100 }, { throughWeek: 3, percent: 50 }, { throughWeek: null, percent: 0 }] }],
    [{ kind: 'dates', windows: [{ startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-15T00:00:00Z', percent: 100 }] }],
    [{ kind: 'dates', windows: [] }],
    [null],
  ],
  paidByWords: [['in_school', 'cash'], ['in_school', 'card'], ['in_school', 'instapay'], ['in_school', 'other'], ['instapay', null], ['card', null], ['fawry', null]],
  gradeLabel: [[9], [10], [11], [12], [13], [null]],
};
export const FAMILY_NOT_SENTENCES = new Set(['hasRole', 'apiResponse', 'refusalCodeOf', 'formatEgp', 'schoolDateString', 'gradeInAcademicYear', 'seriesAcademicYearStart', 'isRegistryPolicyKey']);

/** Every dictionary: the lib/i18n files and the files of the lib/i18n- folders (the foundation's, the exams'). */
export const ALL_DICTIONARIES = (web = WEB) => [
  ...DICTIONARIES(web),
  ...readdirSync(path.join(web, 'lib')).filter((d) => /^i18n-/.test(d) && statSync(path.join(web, 'lib', d)).isDirectory())
    .flatMap((d) => readdirSync(path.join(web, 'lib', d)).filter((f) => /\.tsx?$/.test(f)).map((f) => `lib/${d}/${f}`)),
];

/** Every hit: "file:line: text". */
export async function checkFamily({ web = WEB, screens = FAMILY_SCREENS, shared = FAMILY_SHARED, wording = 'lib/i18n-reservations.ts', dictionaries, lib, list = false } = {}) {
  const hits = [];
  const seen = new Set();
  const read = (rel, only) => {
    const file = path.join(web, rel);
    if (!existsSync(file)) { hits.push(`${rel}: missing`); return; }
    for (const s of familyStringsOf(file, only)) {
      if (list && !seen.has(s.v)) console.log(s.v);
      seen.add(s.v);
      if (familyForbidden(s.v)) hits.push(`${rel}:${s.line}: ${s.v}`);
    }
  };
  for (const rel of screens) read(rel);
  for (const s of shared) read(s.file, s.only);
  // This check's wording: the P3 section of lib/i18n-reservations.ts (from its marker), both languages. The older
  // phrases above it are other screens' (the To verify tab, the old Reserve page): read only where a screen uses them.
  if (wording) {
    const file = path.join(web, wording);
    const text = readFileSync(file, 'utf8');
    const from = text.indexOf('// ─── P3:');
    const offset = from < 0 ? 0 : text.slice(0, from).split('\n').length;
    for (const s of familyStringsOf(file)) if (s.line > offset && familyForbidden(s.v)) hits.push(`${wording}:${s.line}: ${s.v}`);
  }
  // The Arabic any dictionary gives a phrase these screens use.
  for (const rel of dictionaries ?? (existsSync(path.join(web, 'lib')) ? ALL_DICTIONARIES(web) : [])) {
    for (const p of dictionaryPairs(path.join(web, rel))) if (seen.has(p.key) && FAMILY_FORBIDDEN_AR.test(p.value)) hits.push(`${rel}:${p.line}: '${p.key}' renders '${p.value}' on these screens`);
  }
  // The sentences @repo/validations makes for these screens.
  const names = [...new Set(screens.filter((rel) => existsSync(path.join(web, rel))).flatMap((rel) => validationsImportsOf(path.join(web, rel))))];
  const validations = lib ?? await import(pathToFileURL(createRequire(path.join(web, 'package.json')).resolve('@repo/validations')).href);
  for (const s of validationsSentences(names, validations, FAMILY_SAMPLES, FAMILY_NOT_SENTENCES)) {
    if (s.missing) hits.push(`@repo/validations ${s.name}: a function these screens call has no sample here — add one to FAMILY_SAMPLES (or to FAMILY_NOT_SENTENCES)`);
    else if (familyForbidden(s.v)) hits.push(`@repo/validations ${s.name}: ${s.v}`);
  }
  return { hits, seen, files: screens.length + shared.length, sentences: names.length };
}

/** The phrases these screens render that no dictionary has (a help: a sentence with data is a rule's). */
export function missingArabic(seen, web = WEB) {
  const keys = new Set(ALL_DICTIONARIES(web).flatMap((rel) => dictionaryPairs(path.join(web, rel)).map((p) => p.key)));
  // As the translator reads a text node: its entities decoded, its spaces folded (lib/i18n.tsx, normalizeSourceText).
  const norm = (v) => v.replace(/&nbsp;/g, ' ').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&mdash;/g, '—')
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/\s+/g, ' ').trim();
  const notProse = (v) => !/[A-Za-z]{2}/.test(v) || v.includes('…') || /^[A-Z0-9_.\/ ·()-]+$/.test(v) || /^use client$/.test(v)
    || /(^|\s)(bg|text|border|hover|dark|ring)-/.test(v) || /^[a-z0-9-]+$/.test(v) || /^\//.test(v) || /^noopener/.test(v);
  return [...seen].filter((v) => !notProse(v) && !keys.has(v) && !keys.has(norm(v)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const list = process.argv.includes('--list');
  const { hits, seen, files, sentences } = await checkFamily({ list });
  if (process.argv.includes('--missing')) {
    for (const v of missingArabic(seen)) console.log(v);
  } else if (!list) {
    if (hits.length) {
      console.error(`The family's and the desk's screens carry ${hits.length} forbidden word(s):\n${hits.join('\n')}`);
      process.exit(1);
    }
    console.log(`The family's and the desk's words: ${files} files, lib/i18n-reservations.ts and ${sentences} names from @repo/validations checked; none of award, suite, series, sitting, component, mapping, option code, provisional, cut-off, offer item.`);
  }
}
