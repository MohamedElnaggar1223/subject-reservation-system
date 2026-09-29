/**
 * The grade rule in SQL (FEATURES_PLAN.md F0a), for the queries that filter
 * or group on a grade: reports, announcements by grade, school-fee
 * schedules by grade. The functions are created by migration 0035 and
 * mirror @repo/validations' academic-year.ts exactly; the integration suite
 * checks both give the same answers on the same instants.
 *
 *   school_academic_year_start(ts)   1 July in Cairo time; 2026 = 2026/27
 *   school_grade(cohort, year)       10 + (year - cohort), null if no cohort
 *   school_series_academic_year_start(type, series year)
 */

import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

type IntExpr = number | SQL | AnyPgColumn;

const asInt = (v: IntExpr) => (typeof v === 'number' ? sql`${v}::integer` : sql`${v}`);

/** The start year of the academic year an instant falls in (default: now). */
export function academicYearStartSql(instant?: Date | SQL): SQL<number> {
  if (instant === undefined) return sql<number>`school_academic_year_start(now())`;
  if (instant instanceof Date) return sql<number>`school_academic_year_start(${instant.toISOString()}::timestamptz)`;
  return sql<number>`school_academic_year_start(${instant})`;
}

/** A student's grade in an academic year; null when the cohort is unknown. */
export function gradeInYearSql(cohortYear: IntExpr, academicYearStart: IntExpr): SQL<number | null> {
  return sql<number | null>`school_grade(${asInt(cohortYear)}, ${asInt(academicYearStart)})`;
}

/** Today's grade (Cairo time). */
export function gradeTodaySql(cohortYear: IntExpr): SQL<number | null> {
  return sql<number | null>`school_grade(${asInt(cohortYear)}, school_academic_year_start(now()))`;
}

/** The academic year (start year) a series belongs to. */
export function seriesAcademicYearStartSql(sessionType: string | SQL | AnyPgColumn, seriesYear: IntExpr): SQL<number> {
  const type = typeof sessionType === 'string' ? sql`${sessionType}::text` : sql`${sessionType}`;
  return sql<number>`school_series_academic_year_start(${type}, ${asInt(seriesYear)})`;
}

/**
 * `extras` for a relational query on the user table: today's grade as
 * `grade`, next to the columns, e.g.
 *   student: { columns: { id: true, name: true }, extras: gradeTodayExtras }
 * The number is raw: above 12 is graduated, below 10 not yet started, null
 * unknown (the web formats it with gradeLabel).
 */
export function gradeTodayExtras(fields: { cohortYear: AnyPgColumn }) {
  return { grade: gradeTodaySql(fields.cohortYear).as('grade') };
}
