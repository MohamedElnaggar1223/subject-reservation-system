#!/usr/bin/env node
/**
 * The coordinator's words (COORDINATOR_REWORK.md §13 P2): none of award, suite, series, sitting, component,
 * mapping, option code on her screens — in English, or in Arabic (دورة is the app's "sitting", سلسلة its
 * "series", مكوّن its "component").
 *
 * Reads the source of her screens with the TypeScript parser and checks every string a reader can meet: JSX
 * text, and each string literal or template part that reads as words (a space in it, or a capital first) —
 * class names, ids, keys and the API's field values are left out. Then every Arabic and English phrase of
 * lib/i18n-setup.ts. Run from apps/web: `node scripts/check-setup-words.mjs` (exit 1 on a hit);
 * `--list` prints the strings it checked (the Arabic dictionary is checked against that list).
 *
 * What the screens render from the API (check-list notes, refusals) is checked on the rendered pages by the
 * drive of P2 (.audit/coordinator-p2.tsv); refusals pass through herWords (lib/i18n-setup.ts) first.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  'components/ui/switch.tsx',
];

const FORBIDDEN_EN = /\b(awards?|suites?|series|sittings?|components?|mappings?|option[ -]codes?)\b/i;
const FORBIDDEN_AR = /(^|[^\p{L}])[وفبكل]?(?:ال|لل)?(دورة|دورت|دورات|سلسلة|سلاسل|مكوّ?ن)/u;

/** JSX attributes whose value is never read as words. */
const NOT_WORDS = new Set(['className', 'id', 'htmlFor', 'key', 'href', 'type', 'role', 'variant', 'size', 'tone', 'dir', 'lang', 'inputMode',
  'aria-controls', 'aria-labelledby', 'aria-describedby', 'value', 'name', 'step', 'min', 'max', 'rows', 'colSpan', 'headingLevel', 'place']);

function stringsOf(file) {
  const text = readFileSync(file, 'utf8');
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const push = (s, node) => {
    const v = s.replace(/\s+/g, ' ').trim();
    if (!v) return;
    const line = src.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    out.push({ v, line });
  };
  const words = (s) => /\s/.test(s.trim()) || /^[A-Z“'—(]/.test(s.trim());
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxAttribute(node) && NOT_WORDS.has(node.name.getText())) return;
    if (ts.isJsxAttribute(node) && node.name.getText().startsWith('data-')) return;
    // A property name in brackets (api.v1.sessions[':id']) and the keys of the API's bodies are not words.
    if (ts.isElementAccessExpression(node)) { visit(node.expression); return; }
    if (ts.isJsxText(node)) push(node.getText(), node);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { if (words(node.text)) push(node.text, node); }
    else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' … ');
      if (words(parts)) push(parts, node);
      node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

const list = process.argv.includes('--list');
const hits = [];
const seen = new Set();
for (const rel of HER_SCREENS) {
  const file = path.join(WEB, rel);
  if (!existsSync(file)) { hits.push(`${rel}: missing`); continue; }
  for (const s of stringsOf(file)) {
    if (list && !seen.has(s.v)) { seen.add(s.v); console.log(s.v); }
    if (FORBIDDEN_EN.test(s.v) || FORBIDDEN_AR.test(s.v)) hits.push(`${rel}:${s.line}: ${s.v}`);
  }
}
// Her wording file: every phrase, both languages (its comments name the words on purpose, so only strings are read).
for (const s of stringsOf(path.join(WEB, 'lib/i18n-setup.ts'))) {
  if (FORBIDDEN_EN.test(s.v) || FORBIDDEN_AR.test(s.v)) hits.push(`lib/i18n-setup.ts:${s.line}: ${s.v}`);
}
if (!list) {
  if (hits.length) {
    console.error(`The coordinator's screens carry ${hits.length} forbidden word(s):\n${hits.join('\n')}`);
    process.exit(1);
  }
  console.log(`Her screens' words: ${HER_SCREENS.length} files and lib/i18n-setup.ts checked; none of award, suite, series, sitting, component, mapping, option code.`);
}
