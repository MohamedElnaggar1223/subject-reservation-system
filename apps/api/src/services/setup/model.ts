/**
 * The rules the system derives for a session set up the way the coordinator works
 * (COORDINATOR_REWORK.md §4, §6, A3: derive rather than ask). Pure functions: no database.
 *
 * - D8 combinations, fixed: all papers and the one-paper rows exclude each other; A.S., A.2. and A.L.
 *   exclude each other; qualification rows exclude each other; units combine freely.
 * - D6 "carried from" asked by the board rule: an A.2. always; a one-paper retake where the board asks it.
 * - The cells (D3) and today's availability kept in step both ways until P1b drops the old column.
 * - C1, D12 the sitting of a row → its board series' month and year.
 * - C3 the year roll of a copy.
 */

import type { Availability, RowKind, Sitting, SeriesMonth } from '@repo/validations';

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

/**
 * Today's availability, derived from the four cells so the reservation path P1b has not replaced yet
 * (line rules reading `availability`) offers what the cells allow, as nearly as the old enum says it:
 * a first entry in school → open (first entries and retakes); a retake in school without a first
 * entry → retakes only; self study only → self-study only; no cell → closed. The old enum cannot
 * say every combination (a first entry in school with no retake in school reads as open); P1b's line
 * rules read the cells themselves.
 */
export function availabilityOf(cells: Cells): Availability {
  if (cells.firstInSchool) return 'open';
  if (cells.retakeInSchool) return 'retake_only';
  if (cells.retakeSelfStudy || cells.firstSelfStudy) return 'self_study_only';
  return 'closed';
}

/**
 * The cells an item made by the deprecated routes stands for (its offer's and its own availability
 * together, as migration 0066 converted them): closed → none; retakes only → retake in school and in
 * self study; self-study only → retake in self study, and a first entry in self study where the row
 * carries a sitting forward; open → first entry in school, retake in school and in self study. A
 * one-paper row takes no first entry.
 */
export function cellsOfAvailability(offer: string, item: string, kind: string, needsPriorSeries: boolean): Cells {
  const closed = offer === 'closed' || item === 'closed';
  const retakeOnly = offer === 'retake_only' || item === 'retake_only';
  const selfStudyOnly = offer === 'self_study_only' || item === 'self_study_only';
  if (closed) return { ...NO_CELLS };
  const paper = kind === 'paper';
  return {
    firstInSchool: !retakeOnly && !selfStudyOnly && !paper,
    retakeInSchool: !selfStudyOnly,
    retakeSelfStudy: true,
    firstSelfStudy: !retakeOnly && selfStudyOnly && needsPriorSeries && !paper,
  };
}

/** The deprecated routes' item kinds in her words (migration 0066's conversion, for what they still write). */
export function kindOfLegacy(kind: string, a: { needsPriorSeries?: boolean; label: string; qualificationLevel?: string | null }): RowKind {
  if (kind === 'whole') return 'all_papers';
  if (kind === 'one_paper') return 'paper';
  if (kind === 'route') {
    if (a.needsPriorSeries || /\ba\.?\s?2\b/i.test(a.label)) return 'a2';
    if (a.qualificationLevel === 'as_level' || /\ba\.?\s?s\b/i.test(a.label)) return 'as';
    return 'al';
  }
  return kind as RowKind;
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
export const KIND_ORDER: Record<string, number> = { all_papers: 0, paper: 1, unit: 2, as: 3, a2: 4, al: 5, qualification: 6, custom: 7 };
