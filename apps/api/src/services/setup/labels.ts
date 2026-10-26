/**
 * The family wording (COORDINATOR_REWORK.md D9–D10, F3) is P0's (`@repo/validations` offering/labels.ts:
 * rowLabel, optionLabel, examMonthLabel — one wording for the API, the web and the reference check).
 * This module holds only P1a's bridges onto it: a session row as the wording reads it, both languages
 * at once, and a board series' month name as an exam month.
 */

import { examMonthLabel, type LabelLang, type LabelRow } from '@repo/validations';

export { rowLabel, optionLabel, examMonthLabel } from '@repo/validations';

// ─── P1a's bridges onto them ─────────────────────────────────────────────────

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
