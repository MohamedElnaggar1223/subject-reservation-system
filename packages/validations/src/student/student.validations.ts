/**
 * Student record inputs (FEATURES_PLAN.md F0a): the cohort correction, a
 * student leaving the school (withdrawn or transferred) and coming back,
 * the students list, and the eligibility question. Input types only.
 */

import { z } from 'zod';
import { CohortYearSchema, EntryGradeSchema } from '../academic/academic-year';
import { DateOnlySchema } from '../academic/structure.validations';

/**
 * An admin corrects a student's cohort (a repeated year, a wrong entry):
 * either the cohort itself, or the grade the student is in this academic
 * year. Audited with the reason; registrations the student may no longer
 * sit expire, with their open checkouts closed and any escrow returned.
 */
export const CorrectCohort = z
  .object({
    cohortYear: CohortYearSchema.optional(),
    gradeNow: EntryGradeSchema.optional(),
    reason: z.string().trim().min(5, 'Please give a reason (at least 5 characters)').max(500),
  })
  .refine((d) => (d.cohortYear === undefined) !== (d.gradeNow === undefined), {
    message: 'Give either the grade this year or the cohort, not both',
    path: ['gradeNow'],
  });
export type CorrectCohortType = z.infer<typeof CorrectCohort>;

export const LEAVING_KINDS = ['withdrawn', 'transferred'] as const;
export const LeavingKindSchema = z.enum(LEAVING_KINDS);

export const RecordLeaving = z.object({
  kind: LeavingKindSchema,
  // The day the student left (not in the future).
  leftOn: DateOnlySchema,
  reason: z.string().trim().min(5, 'Please give a reason (at least 5 characters)').max(500),
});
export type RecordLeavingType = z.infer<typeof RecordLeaving>;

export const Readmit = z.object({
  reason: z.string().trim().min(5, 'Please give a reason (at least 5 characters)').max(500),
});
export type ReadmitType = z.infer<typeof Readmit>;

export const STUDENT_STATUSES = ['in_school', 'upcoming', 'graduated', 'withdrawn', 'transferred', 'unknown'] as const;
export const StudentStatusSchema = z.enum(STUDENT_STATUSES);
export type StudentStatus = z.infer<typeof StudentStatusSchema>;

export const ListStudentsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  // Today's grade.
  grade: z.coerce.number().int().min(9).max(14).optional(),
  status: StudentStatusSchema.optional(),
  sectionId: z.string().min(1).optional(),
  // Section membership is read for this academic year (default: today's).
  withoutSection: z.enum(['true', 'false']).optional(),
  // Students whose graduation the F0a backfill inferred (STUDENT_COHORT_INFERRED), for staff to review.
  inferred: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListStudentsQueryType = z.infer<typeof ListStudentsQuery>;

export const EligibilityQuery = z.object({
  studentId: z.string().min(1),
  sessionId: z.string().min(1),
});
export type EligibilityQueryType = z.infer<typeof EligibilityQuery>;
