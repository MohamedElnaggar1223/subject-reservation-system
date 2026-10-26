/**
 * The coordinator's screens (COORDINATOR_REWORK.md §5; P2): Sessions, the Session with its check list
 * and tabs, the subject editor and her Home — their words in Arabic, for the page translator
 * (lib/i18n.tsx), and `herWords`, which puts an API refusal in her words.
 *
 * Her vocabulary (§13 P2): none of award, suite, series, sitting, component, mapping, option code on
 * her screens, in English or Arabic (دورة is the app's "sitting"; the exam month is شهر الامتحان).
 * `apps/web/scripts/check-setup-words.mjs` checks this file and her screens' source for them.
 *
 * Text with a number, a name or a date in it is split into its own nodes on the screens, so most
 * entries here are whole phrases; `translateSetupText` takes the sentences that carry data.
 */

// ─── Her words for an API refusal ────────────────────────────────────────────

/**
 * The board's words a refusal may carry (a row's sitting, a series rule), in hers. Each rule is a whole
 * word, so a subject's name or code is never touched.
 */
const HER_WORDS: [RegExp, string][] = [
  [/\bsittings\b/gi, 'exam months'],
  [/\bsitting\b/gi, 'exam month'],
  [/\bseries\b/gi, 'exam month'],
  [/\bawards\b/gi, 'qualifications'],
  [/\baward\b/gi, 'qualification'],
  [/\bcomponents\b/gi, 'papers'],
  [/\bcomponent\b/gi, 'paper'],
  [/\bsuites\b/gi, 'sets'],
  [/\bsuite\b/gi, 'set'],
  [/\bmappings\b/gi, 'links'],
  [/\bmapping\b/gi, 'link'],
  [/\boption codes\b/gi, 'codes'],
  [/\boption code\b/gi, 'code'],
];

export function herWords(text: string): string {
  let out = text;
  for (const [re, to] of HER_WORDS) out = out.replace(re, to);
  return out;
}

// ─── Arabic ──────────────────────────────────────────────────────────────────

export const setupArabic: Record<string, string> = {};

/** Her screens' sentences that carry a number, a name or a date. */
export function translateSetupText(text: string): string | null {
  void text;
  return null;
}
