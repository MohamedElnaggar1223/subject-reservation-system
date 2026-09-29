/**
 * The school's level codes — O.L., A.S., A.2., A.L. and "A.S./A.2." — derived,
 * never stored (FEATURES_PLAN.md F0b; IMPORT_SPIKE.md IS-01; DISCOVERY.md §5:
 * "Level vocabulary shown to the school is theirs").
 *
 * Three facts are kept apart in the catalogue: a unit's own level (AS or A2),
 * the awards it counts toward (M1 counts toward AS and A Level Mathematics),
 * and the student's year. The code the school writes is computed from them.
 *
 * What "A.S./A.2." marks on a single AS unit such as M1 is the coordinator's
 * question (IMPORT_SPIKE.md §3 question 1). The readings are a setting
 * (`catalogue.levelCodeReading`), so the answer changes configuration, not
 * code (owner decision 3):
 *
 * - `student_series` (default: the owner's own words of 26 Sep 2026, "for a
 *   student sitting both in one series", DISCOVERY.md §1) — an AS entry of a
 *   student who also sits A2 units in the same series. It fits the June 2023
 *   tab, where every combined code on a single unit is on M1 or S1.
 * - `student_year` — an AS entry sat in the student's A2 year (grade 12).
 * - `awards` — an AS unit that also counts toward an A Level award (the
 *   research's inference, DISCOVERY_RESEARCH.md §1).
 * - `units` — only an entry that mixes AS and A2 units (Biology "Paper 3 &
 *   Paper 4").
 *
 * Under every reading, an entry that mixes AS and A2 units is "A.S./A.2.", an
 * A2-only entry "A.2.", an IGCSE entry "O.L.", and a whole A Level entered by
 * its code "A.L." (June 2023's code; whether it is today's "A.2." is the
 * coordinator's question too).
 */

import { z } from 'zod';
import type { UnitLevel } from './catalogue.validations';

export const LEVEL_CODE_READINGS = ['student_series', 'student_year', 'awards', 'units'] as const;
export const LevelCodeReadingSchema = z.enum(LEVEL_CODE_READINGS);
export type LevelCodeReading = z.infer<typeof LevelCodeReadingSchema>;

export type LevelCode = 'O.L.' | 'A.S.' | 'A.2.' | 'A.S./A.2.' | 'A.L.';

export type LevelCodeInput = {
  /** The registrable row's level (the window's level): igcse, as_level, a_level. */
  qualificationLevel: string;
  /** The own levels of the units the entry covers; empty for a whole qualification. */
  unitLevels: readonly UnitLevel[];
  /** The levels of the awards those units count toward. */
  awardLevels: readonly string[];
  /** The student's grade in the series' academic year (null: unknown). */
  gradeInSeriesYear: number | null;
  /** Whether the student sits any A2 unit in the same board series. */
  studentSitsA2InSeries: boolean;
};

export function deriveLevelCode(input: LevelCodeInput, reading: LevelCodeReading): LevelCode {
  if (input.qualificationLevel === 'igcse' || input.unitLevels.includes('igcse')) return 'O.L.';
  if (input.unitLevels.length === 0) return input.qualificationLevel === 'a_level' ? 'A.L.' : 'A.S.';
  const hasAs = input.unitLevels.includes('as');
  const hasA2 = input.unitLevels.includes('a2');
  if (hasAs && hasA2) return 'A.S./A.2.';
  if (hasA2) return 'A.2.';
  // Only AS units: what the combined code marks is the reading.
  switch (reading) {
    case 'student_series':
      return input.studentSitsA2InSeries ? 'A.S./A.2.' : 'A.S.';
    case 'student_year':
      return input.gradeInSeriesYear !== null && input.gradeInSeriesYear >= 12 ? 'A.S./A.2.' : 'A.S.';
    case 'awards':
      return input.awardLevels.includes('a_level') && input.awardLevels.includes('as_level') ? 'A.S./A.2.' : 'A.S.';
    case 'units':
      return 'A.S.';
  }
}

export const LEVEL_CODE_READING_LABELS: Record<LevelCodeReading, string> = {
  student_series: 'An AS entry of a student who also sits A2 units in that series',
  student_year: 'An AS entry sat in the student’s A2 year (grade 12)',
  awards: 'An AS unit that also counts toward an A Level',
  units: 'Only an entry that mixes AS and A2 units',
};
