/**
 * Board series and the windows that feed them (FEATURES_PLAN.md F0b;
 * DISCOVERY_RESEARCH.md §5 note 1; IMPORT_SPIKE.md IS-05, IS-14).
 *
 * A school registration window is not a board series. A board series is one
 * board's sitting (Pearson IAL October 2026, Cambridge November 2026) with
 * every date the board sets. One window can feed several series — the
 * school's "November" form feeds IAL October, Cambridge November and IAL
 * January — and each registration is entered in exactly one of them.
 *
 * The exam board's entry deadline — the school's hard stop (owner decision
 * MO-10, DISCOVERY.md A-08) — is a date of the board series, not the window:
 * past it, nothing more is entered, paid or confirmed for that series, and
 * the scheduler closes what is still open on it. The late-fee dates are shown
 * for information only: the school does not take late entries.
 */

import { z } from 'zod';
import { SessionTypeSchema } from '../session/session.validations';
import { SeriesYearSchema } from '../academic/academic-year';
import { DateOnlySchema } from '../academic/structure.validations';
import { BoardCodeSchema } from './catalogue.validations';

/** Every date a board sets for a series, besides the entry deadline (all informational). */
export const BOARD_SERIES_DATE_FIELDS = [
  'estimatedEntriesDue',
  'lateFeeFrom',
  'highLateFeeFrom',
  'lateEntriesClose',
  'retakeDeadline',
  'forecastGradesDue',
  'neaDue',
  'accessArrangementsDue',
  'examsStart',
  'examsEnd',
  'resultsOn',
  'certificatesOn',
] as const;
export type BoardSeriesDateField = (typeof BOARD_SERIES_DATE_FIELDS)[number];

export const BOARD_SERIES_DATE_LABELS: Record<BoardSeriesDateField, string> = {
  estimatedEntriesDue: 'Estimated entries due',
  lateFeeFrom: 'Late entry fee from',
  highLateFeeFrom: 'High late fee from',
  lateEntriesClose: 'Late entries close',
  retakeDeadline: 'Retake deadline (no late fee)',
  forecastGradesDue: 'Forecast grades due',
  neaDue: 'Coursework (NEA) marks due',
  accessArrangementsDue: 'Access arrangements due',
  examsStart: 'Exams start',
  examsEnd: 'Exams end',
  resultsOn: 'Results released',
  certificatesOn: 'Certificates available',
};

const optionalDate = DateOnlySchema.nullable().optional();
const dates = Object.fromEntries(BOARD_SERIES_DATE_FIELDS.map((f) => [f, optionalDate])) as Record<BoardSeriesDateField, typeof optionalDate>;

export const CreateBoardSeries = z.object({
  boardCode: BoardCodeSchema,
  month: SessionTypeSchema,
  year: SeriesYearSchema,
  /**
   * Only when one board runs two calendars in one month (Pearson's June for
   * IAL and for International GCSE, if their dates differ): "IAL".
   */
  label: z.string().trim().max(60).default(''),
  /** The exam board's entry deadline: the school's hard stop (MO-10). Admin only. */
  entryDeadline: z.coerce.date().nullable().optional(),
  ...dates,
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type CreateBoardSeriesType = z.infer<typeof CreateBoardSeries>;

/**
 * A change to a series' dates. The entry deadline is the admin's (MO-10):
 * it must be after every window feeding the series closes and in the future,
 * and a reason is required when it changes.
 */
export const UpdateBoardSeries = z.object({
  label: z.string().trim().max(60).optional(),
  entryDeadline: z.coerce.date().nullable().optional(),
  ...dates,
  notes: z.string().trim().max(1000).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});
export type UpdateBoardSeriesType = z.infer<typeof UpdateBoardSeries>;

export const ListBoardSeriesQuery = z.object({
  /** The academic year (its start year) the series belong to. */
  academicYear: z.coerce.number().int().min(2000).max(2100).optional(),
  boardCode: BoardCodeSchema.optional(),
});
export type ListBoardSeriesQueryType = z.infer<typeof ListBoardSeriesQuery>;

// ─── A window's series ───────────────────────────────────────────────────────

/**
 * The whole set of series a window feeds, replacing what was there (the
 * window's series panel saves in one go):
 * - `series`: each series the window feeds; per board one is the default,
 *   where that board's subjects are entered unless routed elsewhere.
 * - `routes`: a subject entered in another of the window's series of its
 *   board than the default ("Biology papers sit in January").
 *
 * Every series must be in the window's academic year and, like the window,
 * a June series or not (grade 10 sits June only; graduates retake October,
 * November and January), so a student's eligibility has one answer for the
 * whole window (F0a's mayRegisterFor). A series with registrations cannot
 * leave the window; every board with registrations keeps a series.
 */
export const SetSessionBoardSeries = z.object({
  series: z
    .array(z.object({ boardSeriesId: z.string().min(1), isDefault: z.boolean() }))
    .max(12)
    .refine((s) => new Set(s.map((x) => x.boardSeriesId)).size === s.length, 'Each series once'),
  routes: z
    .array(z.object({ subjectId: z.string().min(1), boardSeriesId: z.string().min(1) }))
    .max(200)
    .refine((r) => new Set(r.map((x) => x.subjectId)).size === r.length, 'Each subject once')
    .default([]),
  reason: z.string().trim().max(500).optional(),
});
export type SetSessionBoardSeriesType = z.infer<typeof SetSessionBoardSeries>;

/**
 * Move registrations to another series the same window feeds, of the same
 * board (a student sitting Biology Unit 1 in January rather than October).
 * Refused once either series' entry deadline has passed.
 */
export const MoveRegistrationsToSeries = z.object({
  registrationIds: z.array(z.string().min(1)).min(1, 'Choose the registrations to move').max(500),
  boardSeriesId: z.string().min(1),
  reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(500),
});
export type MoveRegistrationsToSeriesType = z.infer<typeof MoveRegistrationsToSeries>;

/**
 * Staff checked what the migration inferred — a subject entered with the
 * board that sits its window's month, a registration of it, a subject not
 * offered in a window its board does not sit: they leave the Board series
 * screen's "check these" list.
 */
export const MarkInferredChecked = z
  .object({
    registrationIds: z.array(z.string().min(1)).max(500).default([]),
    subjectIds: z.array(z.string().min(1)).max(500).default([]),
  })
  .refine((d) => d.registrationIds.length + d.subjectIds.length > 0, 'Choose what you checked');
export type MarkInferredCheckedType = z.infer<typeof MarkInferredChecked>;
