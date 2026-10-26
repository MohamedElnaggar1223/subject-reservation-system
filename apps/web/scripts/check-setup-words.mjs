#!/usr/bin/env node
/**
 * The coordinator's words (COORDINATOR_REWORK.md §13 P2): none of award, suite, series, sitting, component,
 * mapping, option code on her screens — in English, any case, or in Arabic (دورة is the app's "sitting", سلسلة its
 * "series", مكوّن its "component").
 *
 * Reads with the TypeScript parser, and checks every string a reader can meet:
 * - her screens' source: JSX text, and each string literal or template part that reads as words (a space in it, or
 *   a capital first) or is itself one of the words ('series', 'sittings' — a lone lowercase word is read too);
 *   class names, ids, keys and the API's field values are left out;
 * - the shared components her screens render (the dialog, the badges, the loading and error states, the switch,
 *   the reason dialog, the date), whole or only the pieces she meets;
 * - the sentences of @repo/validations her screens show: every string or list of strings they import, and each
 *   function that makes a sentence, called with a sample (a function not named below fails the check, so a new one
 *   is added here before it reaches her);
 * - every Arabic and English phrase of lib/i18n-setup.ts, and the Arabic every other dictionary (lib/i18n*.ts, .tsx) gives
 *   a phrase her screens use: the page translator takes a phrase's Arabic from the first dictionary that has it, so a
 *   word she shares with another screen may render that screen's Arabic.
 * Run from the repository or apps/web: `node apps/web/scripts/check-setup-words.mjs` (exit 1 on a hit); `--list`
 * prints the strings it checked. The planted-word controls are its test, `check-setup-words.test.mjs`
 * (`node --test`).
 *
 * What the screens render from the API (check-list notes, refusals) is checked on the rendered pages by the drive
 * of P2 (.audit/coordinator-p2.tsv); refusals pass through herWords (lib/i18n-setup.ts) first.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
export const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Her screens: Sessions, the Session and its tabs, the subject editor, her Home, the shared pieces, her wording. */
export const HER_SCREENS = [
  'app/(app)/(sessions)/admin/sessions/sessions-list.client.tsx',
  'app/(app)/(sessions)/admin/sessions/setup-shared.tsx',
  'app/(app)/(sessions)/admin/sessions/check-list.client.tsx',
  'app/(app)/(sessions)/admin/sessions/[id]/session.client.tsx',
  'app/(app)/(sessions)/admin/sessions/[id]/subjects-tab.client.tsx',
  'app/(app)/(sessions)/admin/sessions/[id]/prices-tab.client.tsx',
  'app/(app)/(sessions)/admin/sessions/[id]/agree-tab.client.tsx',
  'app/(app)/(sessions)/admin/sessions/[id]/reservations-tab.client.tsx',
  'app/(app)/(sessions)/admin/sessions/[id]/subjects/[offeringId]/subject-editor.client.tsx',
  'app/(app)/(sessions)/admin/sessions/[id]/subjects/[offeringId]/page.tsx',
  'app/(app)/cycle-landing.client.tsx',
];

/**
 * The shared components rendered on her screens; `only` names the pieces of a file she meets (the rest of
 * exams-shared is the exam screens', not hers).
 */
export const SHARED = [
  { file: 'app/(app)/(sessions)/admin/sessions/sessions-shared.tsx' },
  { file: 'components/ui/switch.tsx' },
  { file: 'components/ui/tone.tsx' },
  { file: 'components/ui/query-state.tsx' },
  { file: 'components/ui/reason-modal.tsx' },
  { file: 'components/ui/button.tsx' },
  { file: 'app/(app)/exams/exams-shared.tsx', only: ['InstantText'] },
];

export const FORBIDDEN_EN = /\b(awards?|suites?|series|sittings?|components?|mappings?|option[ -]codes?)\b/i;
export const FORBIDDEN_AR = /(^|[^\p{L}])[وفبكل]?(?:ال|لل)?(دورة|دورت|دورات|سلسلة|سلاسل|مكوّ?ن)/u;
export const forbidden = (s) => FORBIDDEN_EN.test(s) || FORBIDDEN_AR.test(s);

/** JSX attributes whose value is never read as words. */
const NOT_WORDS = new Set(['className', 'id', 'htmlFor', 'key', 'href', 'type', 'role', 'variant', 'size', 'tone', 'dir', 'lang', 'inputMode',
  'aria-controls', 'aria-labelledby', 'aria-describedby', 'value', 'name', 'step', 'min', 'max', 'rows', 'colSpan', 'headingLevel', 'place']);

/**
 * Every string of a file a reader can meet, with its line. `only` keeps the strings inside the named top-level
 * functions or constants.
 */
export function stringsOf(file, only) {
  const text = readFileSync(file, 'utf8');
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const push = (s, node) => {
    const v = s.replace(/\s+/g, ' ').trim();
    if (!v) return;
    const line = src.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    out.push({ v, line });
  };
  // Words: a space in it, a capital first, or one of the words itself (a lone lowercase 'series' reads as one).
  const words = (s) => /\s/.test(s.trim()) || /^[A-Z“'—(]/.test(s.trim()) || forbidden(s);
  // A literal compared with, or switched on, is a value the code tests, not a word on the screen.
  const tested = (node) => {
    const p = node.parent;
    return (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind))
      || ts.isCaseClause(p) || ts.isLiteralTypeNode(p);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxAttribute(node) && NOT_WORDS.has(node.name.getText())) return;
    if (ts.isJsxAttribute(node) && node.name.getText().startsWith('data-')) return;
    // A property name in brackets (api.v1.sessions[':id']) and the keys of the API's bodies are not words.
    if (ts.isElementAccessExpression(node)) { visit(node.expression); return; }
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

/** Every `'English': 'Arabic'` pair of a dictionary file, with its line (keys and values as plain strings). */
export function dictionaryPairs(file) {
  const text = readFileSync(file, 'utf8');
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.name) || ts.isIdentifier(node.name))
      && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
      out.push({ key: node.name.text.replace(/\s+/g, ' ').trim(), value: node.initializer.text, line: src.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

/** The app's dictionaries: lib/i18n*.ts and .tsx. */
export const DICTIONARIES = (web = WEB) => readdirSync(path.join(web, 'lib')).filter((f) => /^i18n.*\.tsx?$/.test(f)).map((f) => `lib/${f}`);

/** The names a file imports from @repo/validations (values only: a type is never on the screen). */
export function validationsImportsOf(file) {
  const text = readFileSync(file, 'utf8');
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = [];
  for (const st of src.statements) {
    if (!ts.isImportDeclaration(st) || st.moduleSpecifier.text !== '@repo/validations' || st.importClause?.isTypeOnly) continue;
    for (const el of st.importClause?.namedBindings?.elements ?? []) if (!el.isTypeOnly) names.push(el.name.text);
  }
  return names;
}

/**
 * Each function of @repo/validations her screens call that makes a sentence, with samples that say every part of
 * it; the ones that make no words (a fetch, a date, an amount) are listed as such.
 */
export const SENTENCE_SAMPLES = {
  impactSentence: [
    { repriced: 2, listedForFinance: 3, linesAffected: 4, dueDatesMoved: 5 },
    { repriced: 1, listedForFinance: 1, linesAffected: 1, dueDatesMoved: 1 },
    { repriced: 0, listedForFinance: 0, linesAffected: 0, dueDatesMoved: 0 },
  ].map((i) => [i]),
  refundPolicySentence: [[{ steps: [{ throughWeek: 2, percent: 100 }, { throughWeek: 3, percent: 50 }, { throughWeek: 6, percent: 25 }, { throughWeek: null, percent: 0 }] }]],
  deriveSessionName: [['june', 2027], ['winter', 2026]],
};
export const NOT_SENTENCES = new Set(['apiResponse', 'schoolDateString', 'formatEgp', 'isRole']);

/** What her screens show of @repo/validations: its strings and lists as they are, its sentences from the samples. */
export function validationsSentences(names, lib, samples = SENTENCE_SAMPLES, notSentences = NOT_SENTENCES) {
  const out = [];
  for (const n of names) {
    const v = lib[n];
    if (typeof v === 'string') out.push({ name: n, v });
    else if (Array.isArray(v)) v.filter((x) => typeof x === 'string').forEach((x) => out.push({ name: n, v: x }));
    else if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      // A closed list's words (ROLES' values, a record of labels): the values that read as words.
      Object.values(v).filter((x) => typeof x === 'string').forEach((x) => out.push({ name: n, v: x }));
    } else if (typeof v === 'function') {
      if (notSentences.has(n)) continue;
      if (/^[A-Z]/.test(n) && !(n in samples)) continue; // a schema (CamelCase), never shown
      if (!(n in samples)) { out.push({ name: n, v: '', missing: true }); continue; }
      for (const args of samples[n]) out.push({ name: n, v: String(v(...args)) });
    }
  }
  return out;
}

/** Every hit: "file:line: text". */
export async function check({ web = WEB, screens = HER_SCREENS, shared = SHARED, wording = 'lib/i18n-setup.ts', dictionaries, lib, list = false } = {}) {
  const hits = [];
  const seen = new Set();
  const read = (rel, only) => {
    const file = path.join(web, rel);
    if (!existsSync(file)) { hits.push(`${rel}: missing`); return; }
    for (const s of stringsOf(file, only)) {
      if (list && !seen.has(s.v)) console.log(s.v);
      seen.add(s.v);
      if (forbidden(s.v)) hits.push(`${rel}:${s.line}: ${s.v}`);
    }
  };
  for (const rel of screens) read(rel);
  for (const s of shared) read(s.file, s.only);
  // Her wording file: every phrase, both languages (its comments name the words on purpose, so only strings are read).
  if (wording) for (const s of stringsOf(path.join(web, wording))) if (forbidden(s.v)) hits.push(`${wording}:${s.line}: ${s.v}`);
  // The Arabic any dictionary gives a phrase her screens use (the translator may take it from another screen's).
  for (const rel of dictionaries ?? (existsSync(path.join(web, 'lib')) ? DICTIONARIES(web) : [])) {
    for (const p of dictionaryPairs(path.join(web, rel))) if (seen.has(p.key) && FORBIDDEN_AR.test(p.value)) hits.push(`${rel}:${p.line}: '${p.key}' renders '${p.value}' on her screens`);
  }
  // The sentences @repo/validations makes for her screens.
  const names = [...new Set(screens.filter((rel) => existsSync(path.join(web, rel))).flatMap((rel) => validationsImportsOf(path.join(web, rel))))];
  const validations = lib ?? await import(pathToFileURL(createRequire(path.join(web, 'package.json')).resolve('@repo/validations')).href);
  for (const s of validationsSentences(names, validations)) {
    if (s.missing) hits.push(`@repo/validations ${s.name}: a function her screens call has no sample here — add one to SENTENCE_SAMPLES (or to NOT_SENTENCES)`);
    else if (forbidden(s.v)) hits.push(`@repo/validations ${s.name}: ${s.v}`);
  }
  return { hits, files: screens.length + shared.length, sentences: names.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const list = process.argv.includes('--list');
  const { hits, files, sentences } = await check({ list });
  if (!list) {
    if (hits.length) {
      console.error(`The coordinator's screens carry ${hits.length} forbidden word(s):\n${hits.join('\n')}`);
      process.exit(1);
    }
    console.log(`Her screens' words: ${files} files, lib/i18n-setup.ts and ${sentences} names from @repo/validations checked; none of award, suite, series, sitting, component, mapping, option code.`);
  }
}
