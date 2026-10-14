/**
 * Arabic for the F4 screens (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md
 * §8): one file per area, merged here and into the page translator in
 * lib/i18n.tsx — exact English text → Arabic, and rules for sentences that
 * carry a name, a number, a code or a date.
 *
 * Words (as F0b's): an exam board is المجلس, a board's sitting دورة, an entry
 * with a board قيد, a candidate مرشح, a paper ورقة, a sitting (a date and
 * session) جلسة امتحان, an invigilator مراقب, a forecast grade الدرجة
 * المتوقعة, a certificate شهادة. Board names ("Cambridge International",
 * "Pearson Edexcel", "OxfordAQA"), codes and the boards' titles are data and
 * stay as the boards write them.
 */

import { sharedArabic, sharedRules } from './shared';
import { candidatesArabic, candidatesRules } from './candidates';
import { entriesArabic, entriesRules } from './entries';
import { timetableArabic, timetableRules } from './timetable';
import { resultsArabic, resultsRules } from './results';

export type Rule = [RegExp, (m: RegExpExecArray) => string];

const dictionaries: Record<string, string>[] = [sharedArabic, candidatesArabic, entriesArabic, timetableArabic, resultsArabic];
const rules: Rule[] = [...sharedRules, ...candidatesRules, ...entriesRules, ...timetableRules, ...resultsRules];

export const examsArabic: Record<string, string> = {};
for (const d of dictionaries) for (const [en, ar] of Object.entries(d)) if (!(en in examsArabic)) examsArabic[en] = ar;

/** An F4 sentence with a name, number, code or date in it, or null. */
export function translateExamsText(text: string): string | null {
  for (const [re, to] of rules) {
    const m = re.exec(text);
    if (m) return to(m);
  }
  return null;
}
