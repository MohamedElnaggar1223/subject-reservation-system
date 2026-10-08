/**
 * Academic years, exam series and a student's grade (FEATURES_PLAN.md F0a).
 *
 * One set of pure rules shared by the API, the web app and the tests, so the
 * grade a screen shows is the grade the API judges by.
 *
 * - The academic year runs 1 July to 30 June, decided in Cairo time whatever
 *   the server's or the browser's zone (the end of the June session, owner
 *   decision 28 Sep 2026; FEATURES_PLAN.md §0b). It is named by the year it
 *   starts in: 2026 is "2026-2027".
 * - A student's cohort is the academic year they start grade 10 in. Their
 *   grade in an academic year is 10 + (year − cohort); past 12 they have
 *   graduated, below 10 they have not started.
 * - An exam series (a registration window's session type and year) belongs
 *   to one academic year: June and January of year Y to Y−1/Y; October and
 *   November of year Y to Y/Y+1. A window's own open and close dates never
 *   decide a grade.
 *
 * The same rules exist in SQL (packages/db: school_academic_year_start,
 * school_grade), for the queries that filter on a grade.
 */

import { z } from 'zod';

export const SCHOOL_TIME_ZONE = 'Africa/Cairo';

/** The first month of the academic year (July), 1-based. */
export const ACADEMIC_YEAR_FIRST_MONTH = 7;

/** Year, month (1–12) and day of an instant, as the school's calendar reads it. */
export function schoolDateParts(instant: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** The school's calendar date of an instant, as YYYY-MM-DD. */
export function schoolDateString(instant: Date): string {
  const { year, month, day } = schoolDateParts(instant);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The start year of the academic year an instant falls in (1 July, Cairo time). */
export function academicYearStartOf(instant: Date = new Date()): number {
  const { year, month } = schoolDateParts(instant);
  return month >= ACADEMIC_YEAR_FIRST_MONTH ? year : year - 1;
}

/** "2026-2027" for 2026 — the label school-fee schedules and payments carry. */
export function academicYearLabel(start: number): string {
  return `${start}-${start + 1}`;
}

/** "2026/27" for 2026 — the short form the school writes. */
export function academicYearShortLabel(start: number): string {
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

/** 2026 for "2026-2027"; null for anything else. */
export function academicYearStartFromLabel(label: string): number | null {
  const m = /^(\d{4})-(\d{4})$/.exec(label.trim());
  if (!m) return null;
  const start = Number(m[1]);
  return Number(m[2]) === start + 1 ? start : null;
}

// ─── Exam series ─────────────────────────────────────────────────────────────

/** Session types whose series of year Y belong to the academic year Y−1/Y. */
const SPRING_SERIES = ['june', 'january'] as const;

/**
 * The academic year (start year) a series belongs to: June and January of
 * year Y to Y−1/Y, October and November of year Y to Y/Y+1.
 */
export function seriesAcademicYearStart(sessionType: string, seriesYear: number): number {
  return (SPRING_SERIES as readonly string[]).includes(sessionType) ? seriesYear - 1 : seriesYear;
}

/** The series year of a session type in a given academic year (the inverse). */
export function seriesYearInAcademicYear(sessionType: string, academicYearStart: number): number {
  return (SPRING_SERIES as readonly string[]).includes(sessionType) ? academicYearStart + 1 : academicYearStart;
}

const SERIES_MONTH: Record<string, string> = {
  january: 'January',
  june: 'June',
  october: 'October',
  november: 'November',
};

/** "November 2026"; a winter session (the reservations rework) "November 2026 – January 2027". */
export function seriesLabel(sessionType: string, seriesYear: number): string {
  if (sessionType === 'winter') return `November ${seriesYear} – January ${seriesYear + 1}`;
  return `${SERIES_MONTH[sessionType] ?? sessionType} ${seriesYear}`;
}

/**
 * Series a student who has finished grade 12 may still sit (A-12): the
 * October, November and January series of the academic year right after
 * their grade-12 year — never the June after it.
 */
export const GRADUATE_RETAKE_SESSION_TYPES = ['winter', 'october', 'november', 'january'] as const;

/** Grade 10 sits the June series only (owner decision 28 Sep 2026). */
export const GRADE_10_SESSION_TYPES = ['june'] as const;

// ─── Grades ──────────────────────────────────────────────────────────────────

export const FIRST_GRADE = 10;
export const LAST_GRADE = 12;

/** A student's grade in an academic year; null when the cohort is unknown. */
export function gradeInAcademicYear(cohortYear: number | null | undefined, academicYearStart: number): number | null {
  if (cohortYear === null || cohortYear === undefined) return null;
  return FIRST_GRADE + (academicYearStart - cohortYear);
}

/** Today's grade (Cairo time). */
export function gradeToday(cohortYear: number | null | undefined, now: Date = new Date()): number | null {
  return gradeInAcademicYear(cohortYear, academicYearStartOf(now));
}

/** The cohort of a student who is in `grade` in the academic year `academicYearStart`. */
export function cohortFromGrade(grade: number, academicYearStart: number): number {
  return academicYearStart - (grade - FIRST_GRADE);
}

/**
 * Where a student stands in an academic year, before anything else (a
 * withdrawal) is taken into account.
 */
export type GradeStanding = 'unknown' | 'upcoming' | 'in_school' | 'graduated';

export function gradeStanding(grade: number | null): GradeStanding {
  if (grade === null) return 'unknown';
  if (grade < FIRST_GRADE) return 'upcoming';
  if (grade > LAST_GRADE) return 'graduated';
  return 'in_school';
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

/**
 * "Grade in the current academic year" — what sign-up, desk onboarding and
 * the admin's forms ask; the cohort is stored. 9 means the student is in
 * grade 9 now and starts grade 10 next academic year (a family enrolling
 * before the summer).
 */
export const EntryGradeSchema = z.union([z.literal(9), z.literal(10), z.literal(11), z.literal(12)]);
export type EntryGrade = z.infer<typeof EntryGradeSchema>;

/** A cohort: the start year of the academic year the student starts grade 10. */
export const CohortYearSchema = z.number().int().min(2000).max(2100);

/** A series year, e.g. 2027 for June 2027. */
export const SeriesYearSchema = z.number().int().min(2000).max(2100);

export const AcademicYearStartSchema = z.number().int().min(2000).max(2100);

/**
 * How a grade reads on a screen or a receipt: "Grade 11"; above 12
 * "Graduated"; 9 "Grade 9 (starts grade 10 next year)"; unknown
 * "Grade not recorded".
 */
export function gradeLabel(grade: number | null | undefined): string {
  if (grade === null || grade === undefined) return 'Grade not recorded';
  if (grade > LAST_GRADE) return 'Graduated';
  if (grade === FIRST_GRADE - 1) return 'Grade 9 (starts grade 10 next year)';
  if (grade < FIRST_GRADE - 1) return 'Not started yet';
  return `Grade ${grade}`;
}
