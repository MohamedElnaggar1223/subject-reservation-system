/**
 * The answer to "may this student register for this series?"
 * (FEATURES_PLAN.md F0a; decided by mayRegisterFor in
 * apps/api/src/services/eligibility.services.ts).
 *
 * Declared here rather than in the API so that every response carrying it
 * names a type the web can import: the web's typed client (hc<AppType>) is
 * emitted with declarations, and a type declared inside an API service file
 * cannot be named from the web (TS2742).
 */

export type EligibilityCode =
  | 'ok'
  | 'not_a_student'
  | 'left'
  | 'grade_unknown'
  | 'not_started'
  | 'grade10_june_only'
  | 'graduate_retakes_off'
  | 'graduated';

export type Eligibility = {
  allowed: boolean;
  code: EligibilityCode;
  /** The sentence a refused path answers with; null when allowed. */
  reason: string | null;
  /** The student's grade in the series' academic year (past 12: graduated). */
  grade: number | null;
  academicYearStart: number;
  academicYear: string;
  series: { sessionType: string; seriesYear: number; label: string };
  /** Allowed as a graduate retaking (A-12): owes no school fee under A-13. */
  graduateRetake: boolean;
  /** The grade-10 exception that allowed a series other than June. */
  grade10ExceptionId: string | null;
};
