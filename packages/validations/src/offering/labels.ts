/**
 * The wording families read (COORDINATOR_REWORK.md D9–D10, F3), generated from the coordinator's
 * ticks the same way for every subject, in English and Arabic, in the school's vocabulary:
 *
 *   "First entry · in school · all papers"
 *   "Retake · self study 50% · Paper 41/42 only"
 *   "First entry · self study 50% · A.2. (carry forward)"
 *   "Retake · in school · Unit 5 (WBI15)"
 *
 * Pure functions, shared by the API, the web and the reference check. The self-study share is
 * the session's (E4), always a parameter; a row that charges its own self-study amount (E4,
 * `self_study_fee`) passes null and reads plain "self study". No board jargon reaches a family
 * (F3): familyJargonIn finds the words of FAMILY_BANNED_WORDS with their plurals and, in Arabic,
 * their attached forms (الدورة، للدورة، دورات …). The Arabic follows
 * apps/web/lib/i18n-reservations.ts (قيد أول، إعادة، في المدرسة، دراسة ذاتية، كل الأوراق، نقل نتيجة)
 * and "A Level" is المستوى A as elsewhere in the app; codes (A.S., WBI15, 9AA0) stay as printed.
 */

import type { Attempt, LineMode } from '../registration/line.validations';
import type { CellName, ReferenceRowKind, SittingRef } from './reference';

export type LabelLang = 'en' | 'ar';
/** An option of a row: the line's attempt and mode (registration/line.validations). */
export type OptionKind = { attempt: Attempt; mode: LineMode };

/** A row as the wording needs it: a reference row, a session row, or her own custom row (D2). */
export type LabelRow =
  | { kind: ReferenceRowKind; short?: string | null; codes: readonly string[] }
  | { kind: 'custom'; name: string; nameAr?: string | null; codes?: readonly string[] };

/** The option each column of D3 offers. */
export const CELL_OPTIONS: Record<CellName, OptionKind> = {
  firstInSchool: { attempt: 'first', mode: 'in_school' },
  retakeInSchool: { attempt: 'retake', mode: 'in_school' },
  retakeSelfStudy: { attempt: 'retake', mode: 'self_study' },
  firstSelfStudy: { attempt: 'first', mode: 'self_study' },
};

/** D10: inside a subject, all papers, one-paper rows, units in order, A.S., A.2., A.L.; then the qualifications and her own rows. */
export const ROW_KIND_ORDER: readonly (ReferenceRowKind | 'custom')[] = ['all_papers', 'paper', 'unit', 'as', 'a2', 'al', 'qualification', 'custom'];

/** D10: O.L. subjects before A.S. / A.L. */
export const GROUP_ORDER = ['O.L.', 'A.S./A.L.'] as const;

/** Sorts rows by D10; rows of one kind keep their given order (the reference's, or hers). */
export function compareRowKinds(a: { kind: string }, b: { kind: string }): number {
  return ROW_KIND_ORDER.indexOf(a.kind as ReferenceRowKind) - ROW_KIND_ORDER.indexOf(b.kind as ReferenceRowKind);
}

/** Words that never appear in family wording (F3), English and Arabic (دورة is the app's "sitting"). */
export const FAMILY_BANNED_WORDS: readonly string[] = [
  'sitting', 'series', 'component', 'award', 'syllabus', 'option code', 'cash-in', 'entry method',
  'دورة', 'سلسلة', 'مكوّن', 'مكون',
];

/** The English words with their plurals (sittings, components, syllabi …). */
const JARGON_EN = /(^|[^\p{L}])(sittings?|series|components?|awards?|syllab(?:us|uses|i)|option[ -]codes?|cash-ins?|entry methods?)(?=[^\p{L}]|$)/giu;

/** A possessive ending: دورتها، مكوناته، سلاسلنا. */
const AR_SUFFIX = '(?:ها|هم|هن|ه|ي|ك|كم|نا)';

/**
 * The Arabic words with their attached forms: a prefix (و ف ب ك ل, the article ال or لل, as in
 * الدورة، للدورة، بالدورة، والدورة), the plural (دورات، سلاسل، مكونات) and a possessive (دورتها، دوراتها).
 */
const JARGON_AR = new RegExp(
  `(^|[^\\p{L}])(?:[وفبكل]?(?:ال|لل)?)(دورة|دورت${AR_SUFFIX}|دورات${AR_SUFFIX}?|سلسلة|سلسلت${AR_SUFFIX}|سلاسل${AR_SUFFIX}?|مكو\u0651?ن(?:ات)?${AR_SUFFIX}?)(?=[^\\p{L}]|$)`,
  'gu',
);

const ATTEMPT: Record<Attempt, Record<LabelLang, string>> = {
  first: { en: 'First entry', ar: 'قيد أول' },
  retake: { en: 'Retake', ar: 'إعادة' },
};

const SEP = ' · ';

/** A qualification row's name in Arabic ("A Level" is المستوى A in the app); its code is added as printed. */
const QUALIFICATION_AR: Record<string, string> = {
  'International A Level': 'المستوى A الدولي',
  'GCE A Level': 'المستوى A البريطاني',
};

/**
 * "Paper 41/42" → "الورقة 41/42", "Unit 5" → "الوحدة 5", "Theory paper" → "الورقة النظرية",
 * "International A Level" → "المستوى A الدولي"; codes (P1, M1) stay.
 */
function shortInArabic(short: string): string {
  if (/^theory paper$/i.test(short)) return 'الورقة النظرية';
  if (QUALIFICATION_AR[short]) return QUALIFICATION_AR[short]!;
  const paper = /^Paper (.+)$/.exec(short);
  if (paper) return `الورقة ${paper[1]}`;
  const unit = /^Unit (.+)$/.exec(short);
  if (unit) return `الوحدة ${unit[1]}`;
  return short;
}

/**
 * The phrase a row contributes to its options: "all papers", "Paper 41/42 only", "Unit 5 (WBI15)",
 * "A.S.", "A.2. (carry forward)", "A.L.", "International A Level (YAA01)".
 */
export function rowPhrase(row: LabelRow, lang: LabelLang): string {
  switch (row.kind) {
    case 'all_papers':
      return lang === 'en' ? 'all papers' : 'كل الأوراق';
    case 'paper': {
      const short = row.short ?? row.codes[0] ?? '';
      return lang === 'en' ? `${short} only` : `${shortInArabic(short)} فقط`;
    }
    case 'unit':
    case 'qualification': {
      const short = row.short ?? '';
      const code = row.codes[0];
      const name = lang === 'en' ? short : shortInArabic(short);
      return code && code !== short ? `${name} (${code})` : name;
    }
    case 'as':
      return 'A.S.';
    case 'a2':
      return lang === 'en' ? 'A.2. (carry forward)' : 'A.2. (نقل نتيجة)';
    case 'al':
      return 'A.L.';
    case 'custom':
      return lang === 'ar' && row.nameAr ? row.nameAr : row.name;
  }
}

/** The row's own heading: its phrase with a capital ("All papers", "Paper 41/42 only"). */
export function rowLabel(row: LabelRow, lang: LabelLang): string {
  const p = rowPhrase(row, lang);
  return lang === 'en' ? p.charAt(0).toUpperCase() + p.slice(1) : p;
}

/** What the reference stores as a row's label (§7.1): the phrase in both languages. */
export function referenceRowLabel(row: LabelRow): { en: string; ar: string } {
  return { en: rowPhrase(row, 'en'), ar: rowPhrase(row, 'ar') };
}

/**
 * "in school", or "self study 50%" with the session's share; plain "self study" when the share is
 * null (a row charging its own self-study amount, E4, where no percentage is true).
 */
export function modeLabel(mode: LineMode, selfStudyShare: number | null, lang: LabelLang): string {
  if (mode === 'in_school') return lang === 'en' ? 'in school' : 'في المدرسة';
  if (selfStudyShare === null) return lang === 'en' ? 'self study' : 'دراسة ذاتية';
  const share = formatShare(selfStudyShare);
  return lang === 'en' ? `self study ${share}%` : `دراسة ذاتية ${share}%`;
}

function formatShare(share: number): string {
  if (!Number.isFinite(share) || share < 0 || share > 100) throw new RangeError(`A self-study share is a percentage from 0 to 100, not ${share}`);
  return Number.isInteger(share) ? String(share) : String(Math.round(share * 100) / 100);
}

/**
 * An option families pick (D9): "Retake · self study 50% · Paper 41/42 only". `selfStudyShare` is
 * the session's percentage, or null for a row with its own self-study amount ("Retake · self study · …").
 */
export function optionLabel(row: LabelRow, option: OptionKind, opts: { selfStudyShare: number | null; lang: LabelLang }): string {
  return [ATTEMPT[option.attempt][opts.lang], modeLabel(option.mode, opts.selfStudyShare, opts.lang), rowPhrase(row, opts.lang)].join(SEP);
}

const MONTHS: Record<number, Record<LabelLang, string>> = {
  1: { en: 'January', ar: 'يناير' },
  6: { en: 'June', ar: 'يونيو' },
  10: { en: 'October', ar: 'أكتوبر' },
  11: { en: 'November', ar: 'نوفمبر' },
};

/** An earlier exam a retake carries from, as families read it: "June 2026", "يونيو 2026". */
export function examMonthLabel(s: SittingRef, lang: LabelLang): string {
  return `${MONTHS[s.month]![lang]} ${s.year}`;
}

/** The board jargon in a text (F3), as written there ("Sittings", "للدورة"), or none. */
export function familyJargonIn(text: string): string[] {
  const found: string[] = [];
  for (const re of [JARGON_EN, JARGON_AR]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) found.push(m[0].slice(m[1]!.length));
  }
  return found;
}
