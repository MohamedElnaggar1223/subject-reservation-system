/**
 * The rules the system derives for a session set up the way the coordinator works
 * (COORDINATOR_REWORK.md §4, §6, A3: derive rather than ask). Pure functions: no database.
 *
 * - D8 combinations, fixed: all papers and the one-paper rows exclude each other; A.S., A.2. and A.L.
 *   exclude each other; qualification rows exclude each other; units combine freely.
 * - D6 "carried from" asked by the board rule: an A.2. always; a one-paper retake where the board asks it.
 * - C1, D12 the sitting of a row → its board series' month and year.
 * - C3 the year roll of a copy.
 */

import type { RowKind, Sitting, SeriesMonth } from '@repo/validations';

/**
 * A line that is live: it holds its row, its option, its price and the session's counts (the four setup
 * services, offer.services and reservation.services read this one list; P1b fix 5).
 */
export const LIVE_LINE_STATUSES = ['pending_approval', 'pending_payment', 'preregistered', 'confirmed', 'dropped_pending_receipt'] as const;
export const isLiveStatus = (status: string) => (LIVE_LINE_STATUSES as readonly string[]).includes(status);

export type Cells = { firstInSchool: boolean; retakeInSchool: boolean; retakeSelfStudy: boolean; firstSelfStudy: boolean };
export const NO_CELLS: Cells = { firstInSchool: false, retakeInSchool: false, retakeSelfStudy: false, firstSelfStudy: false };

/** D8: the exclusive group a row's kind puts it in (one live line per group per offering). */
export function exclusiveGroupFor(kind: string): string | null {
  if (kind === 'all_papers' || kind === 'paper') return 'entry';
  if (kind === 'as' || kind === 'a2' || kind === 'al') return 'route';
  if (kind === 'qualification') return 'qualification';
  return null;
}

/**
 * D4: the cells a row from the reference list starts with (the mock's rule, recorded as defaults for her
 * check list): all papers, A.S., A.L. and qualification rows, and units unless the subject also has a
 * qualification row — first entry in school, retake in school, retake in self study; a one-paper row
 * the two retakes; an A.2. (its own entry after the A.S., her call) and any other row nothing.
 */
export function defaultCells(kind: string, subjectHasQualification: boolean): Cells {
  const usual: Cells = { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false };
  if (kind === 'all_papers' || kind === 'as' || kind === 'al' || kind === 'qualification') return usual;
  if (kind === 'unit') return subjectHasQualification ? { ...NO_CELLS } : usual;
  if (kind === 'paper') return { ...NO_CELLS, retakeInSchool: true, retakeSelfStudy: true };
  return { ...NO_CELLS };
}

/** D6: whether a row asks the sitting it carries from — an A.2. always; a one-paper retake by the board rule. */
export function needsPriorFor(kind: string, onePaperAsksSitting: boolean): boolean {
  if (kind === 'a2') return true;
  if (kind === 'paper') return onePaperAsksSitting;
  return false;
}

/** C1, D12: a row's sitting as its board series' month and year in a session of a type and year. */
export function seriesOfSitting(sessionType: string, sessionYear: number, sitting: Sitting): { month: SeriesMonth; year: number } | null {
  if (sessionType === 'june') return sitting === 'june' ? { month: 'june', year: sessionYear } : null;
  if (sitting === 'november') return { month: 'november', year: sessionYear };
  if (sitting === 'january') return { month: 'january', year: sessionYear + 1 };
  return null;
}

/** The sitting a board series is in a session (the inverse of seriesOfSitting; October reads as November, D12). */
export function sittingOfSeries(sessionType: string, month: string | null): Sitting | null {
  if (!month) return null;
  if (sessionType === 'june') return month === 'june' ? 'june' : null;
  if (month === 'january') return 'january';
  if (month === 'november' || month === 'october') return 'november';
  return null;
}

/** A row's default sitting in a session (D12: the reference's winter sitting, else November). */
export function defaultSitting(sessionType: string, winterSitting: string | null | undefined): Sitting {
  if (sessionType === 'june') return 'june';
  return winterSitting === 'january' ? 'january' : 'november';
}

/** C3: a date moved forward by whole years (a copy's year roll). */
export function rollYears(d: Date | null, years: number): Date | null {
  if (!d) return null;
  const out = new Date(d.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + years);
  return out;
}

/** C3: a date-only string ('YYYY-MM-DD') moved forward by whole years. */
export function rollDateOnly(s: string, years: number): string {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const out = new Date(Date.UTC(y + years, m - 1, d));
  return out.toISOString().slice(0, 10);
}

/** The end of a school day (Cairo) as an instant: what a date picker's day means as a deadline. */
export function endOfCairoDay(y: number, m: number, d: number): Date {
  // Cairo is UTC+2 or UTC+3 (summer time since 2023): 23:59 local is 20:59 or 21:59 UTC; the earlier
  // of the two keeps the instant inside the day in both.
  return new Date(Date.UTC(y, m - 1, d, 20, 59, 0));
}

/**
 * The dates an empty session starts with (C5: each a date picker; P1a's defaults, listed on the check
 * list until the coordinator changes them): June Y — the first lesson 1 October Y−1, payment due
 * 31 December Y−1; winter Y — the first lesson 15 September Y, payment due 30 September Y.
 */
export function defaultSessionDates(type: string, year: number): { courseStartsOn: string; paymentDueAt: Date } {
  if (type === 'june') return { courseStartsOn: `${year - 1}-10-01`, paymentDueAt: endOfCairoDay(year - 1, 12, 31) };
  return { courseStartsOn: `${year}-09-15`, paymentDueAt: endOfCairoDay(year, 9, 30) };
}

/** D10: the order of rows inside a subject — all papers, one-paper rows, units in order, A.S., A.2., A.L., then the rest. */
/** A sitting's place in time, in months (the school's months: October counts as October). */
const monthIndex = (month: string, year: number) => year * 12 + ({ january: 1, june: 6, october: 10, november: 11 }[month] ?? 0);

/**
 * D6: an earlier exam older than the board carries a result forward (its months from the row's own sitting): a
 * warning, never a refusal. False when the board sets no limit or the row has no sitting.
 */
export function beyondCarryForward(row: { month: string; year: number } | null | undefined, prior: { month: string; year: number }, carryForwardMonths: number | null | undefined) {
  return !!(row && carryForwardMonths && monthIndex(row.month, row.year) - monthIndex(prior.month, prior.year) > carryForwardMonths);
}

export const KIND_ORDER: Record<string, number> = { all_papers: 0, paper: 1, unit: 2, as: 3, a2: 4, al: 5, qualification: 6, custom: 7 };
