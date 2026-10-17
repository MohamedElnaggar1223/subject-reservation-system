/**
 * Arabic for the fix round of F8's findings (docs/features/WALKTHROUGH_FINDINGS.md): the words the round adds to
 * the cycle's screens. Merged into the page translator in lib/i18n.tsx last, after the decisions' (lib/i18n-decisions.ts),
 * so a sentence rewritten here wins over an older one.
 *
 * Words as the app already uses them: a board fee رسوم المجلس, a syllabus المنهج, a retake إعادة, the balance الرصيد,
 * a transfer تحويل, InstaPay إنستاباي, the school's name is data (never translated).
 */

export const findingsArabic: Record<string, string> = {
  // F8-05: the board's rule for a one-paper retake's board fee (the Catalogue's board card).
  'A one-paper retake:': 'إعادة ورقة واحدة:',
  "the paper's own board fee": 'رسوم المجلس للورقة نفسها',
  "the syllabus's board fee": 'رسوم المجلس للمنهج كله',
  "A one-paper retake's board fee": 'رسوم المجلس لإعادة ورقة واحدة',
  "The syllabus's fee (the list prices the syllabus)": 'رسوم المنهج (تُسعّر القائمة المنهج)',
  "The paper's own fee (the list prices each paper)": 'رسوم الورقة نفسها (تُسعّر القائمة كل ورقة)',
  'A one-paper retake added to a session from now on reads it; one already on a sheet keeps its fee.':
    'تقرؤه كل إعادة ورقة واحدة تُضاف إلى دورة من الآن؛ وتحتفظ الإعادة الموجودة في جدول برسومها.',
};

/** Sentences with data in them (a name, an amount, a count): each rule anchored to its sentence's end. */
const FINDINGS_RULES: [RegExp, (m: RegExpExecArray) => string][] = [];

export function translateFindingsText(text: string): string | null {
  for (const [re, ar] of FINDINGS_RULES) {
    const m = re.exec(text);
    if (m) return ar(m);
  }
  return null;
}
