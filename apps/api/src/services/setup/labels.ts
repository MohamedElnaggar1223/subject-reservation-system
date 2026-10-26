/**
 * The family wording (COORDINATOR_REWORK.md D9–D10, F3), in English and Arabic:
 * "First entry · in school · all papers", "Retake · self study 50% · Paper 41/42 only".
 *
 * PENDING P0's merge: these are P0's functions (`@repo/validations` offering/labels.ts: rowPhrase,
 * rowLabel, optionLabel, examMonthLabel — the one wording shared by the API, the web and the reference
 * check), restated with the same signatures and results until P0's branch lands on main; on its merge
 * this module re-exports P0's and the copies go.
 */

export type LabelLang = 'en' | 'ar';
export type OptionKind = { attempt: 'first' | 'retake'; mode: 'in_school' | 'self_study' };
export type LabelRow =
  | { kind: 'all_papers' | 'paper' | 'unit' | 'as' | 'a2' | 'al' | 'qualification'; short?: string | null; codes: readonly string[] }
  | { kind: 'custom'; name: string; nameAr?: string | null; codes?: readonly string[] };

const ATTEMPT: Record<OptionKind['attempt'], Record<LabelLang, string>> = {
  first: { en: 'First entry', ar: 'قيد أول' },
  retake: { en: 'Retake', ar: 'إعادة' },
};
const SEP = ' · ';

function shortInArabic(short: string): string {
  if (/^theory paper$/i.test(short)) return 'الورقة النظرية';
  const paper = /^Paper (.+)$/.exec(short);
  if (paper) return `الورقة ${paper[1]}`;
  const unit = /^Unit (.+)$/.exec(short);
  if (unit) return `الوحدة ${unit[1]}`;
  return short;
}

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

export function rowLabel(row: LabelRow, lang: LabelLang): string {
  const p = rowPhrase(row, lang);
  return lang === 'en' ? p.charAt(0).toUpperCase() + p.slice(1) : p;
}

export function modeLabel(mode: OptionKind['mode'], selfStudyShare: number, lang: LabelLang): string {
  if (mode === 'in_school') return lang === 'en' ? 'in school' : 'في المدرسة';
  const share = Number.isInteger(selfStudyShare) ? String(selfStudyShare) : String(Math.round(selfStudyShare * 100) / 100);
  return lang === 'en' ? `self study ${share}%` : `دراسة ذاتية ${share}%`;
}

export function optionLabel(row: LabelRow, option: OptionKind, opts: { selfStudyShare: number; lang: LabelLang }): string {
  return [ATTEMPT[option.attempt][opts.lang], modeLabel(option.mode, opts.selfStudyShare, opts.lang), rowPhrase(row, opts.lang)].join(SEP);
}

const MONTHS: Record<number, Record<LabelLang, string>> = {
  1: { en: 'January', ar: 'يناير' },
  6: { en: 'June', ar: 'يونيو' },
  10: { en: 'October', ar: 'أكتوبر' },
  11: { en: 'November', ar: 'نوفمبر' },
};

export function examMonthLabel(s: { month: 1 | 6 | 10 | 11; year: number }, lang: LabelLang): string {
  return `${MONTHS[s.month]![lang]} ${s.year}`;
}

// ─── P1a's bridges onto them (stay after P0's merge) ─────────────────────────

const MONTH_NUMBER: Record<string, 1 | 6 | 10 | 11> = { january: 1, june: 6, october: 10, november: 11 };

/**
 * A session row as the wording reads it: its kind, its reference row's short name and its codes. A custom
 * row reads by its name; so does a paper, unit or qualification row that came from no reference row (its
 * stored label was made from the name she gave it), since the wording would otherwise have only a code.
 */
export function labelRowOf(r: { kind: string; label: string; short?: string | null; referenceCodes: readonly string[]; fromReference?: boolean }): LabelRow {
  if (r.kind === 'custom') return { kind: 'custom', name: r.label, codes: r.referenceCodes };
  if (r.fromReference === false && !r.short && (r.kind === 'paper' || r.kind === 'unit' || r.kind === 'qualification')) {
    return { kind: 'custom', name: r.label, codes: r.referenceCodes };
  }
  return { kind: r.kind as Exclude<LabelRow['kind'], 'custom'>, short: r.short ?? null, codes: r.referenceCodes };
}

/** Both languages at once (the payloads carry `{ en, ar }`). */
export const both = (f: (lang: LabelLang) => string) => ({ en: f('en'), ar: f('ar') });

/** A board series' month and year as families read it ("June 2026"), from its month name. */
export function sittingLabel(month: string, year: number): { en: string; ar: string } {
  const m = MONTH_NUMBER[month] ?? 6;
  return both((lang) => examMonthLabel({ month: m, year }, lang));
}
