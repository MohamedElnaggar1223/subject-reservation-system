/**
 * Course enrolment per academic year (FEATURES_PLAN.md F0b).
 *
 * What each student is taught this year — each subject or unit (a
 * registrable row), by which teacher, in school or as self-study. It is not
 * an exam registration: a student is taught a subject all year and registers
 * for its exam in a window; the two are checked against each other and
 * disagreements are flagged, never blocked.
 *
 * - F1 builds teaching groups from the in-school enrolments (self-study
 *   forms no group).
 * - F4 takes each student's teacher for forecast grades from it.
 * - F7's day-one import fills it through the same batch entry point the
 *   Enrolment screen's paste uses.
 *
 * Input types only (PATTERNS.md).
 */

import { z } from 'zod';
import { DateOnlySchema } from '../academic/structure.validations';

export const ENROLMENT_MODES = ['in_school', 'self_study'] as const;
export const EnrolmentModeSchema = z.enum(ENROLMENT_MODES);
export type EnrolmentMode = z.infer<typeof EnrolmentModeSchema>;

export const ENROLMENT_MODE_LABELS: Record<EnrolmentMode, string> = {
  in_school: 'In school',
  self_study: 'Self-study',
};

/** Where an enrolment came from. */
export const ENROLMENT_SOURCES = ['manual', 'carried_forward', 'registrations', 'section', 'import'] as const;
export const EnrolmentSourceSchema = z.enum(ENROLMENT_SOURCES);
export type EnrolmentSource = z.infer<typeof EnrolmentSourceSchema>;

export const ENROLMENT_SOURCE_LABELS: Record<EnrolmentSource, string> = {
  manual: 'Added by hand',
  carried_forward: 'Carried forward',
  registrations: 'From registrations',
  section: 'Whole section',
  import: 'Imported',
};

export const ListEnrolmentsQuery = z.object({
  academicYearId: z.string().min(1),
  studentId: z.string().min(1).optional(),
  sectionId: z.string().min(1).optional(),
  subjectId: z.string().min(1).optional(),
  teacherId: z.string().min(1).optional(),
  mode: EnrolmentModeSchema.optional(),
  /** Include enrolments that ended during the year. */
  includeEnded: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
export type ListEnrolmentsQueryType = z.infer<typeof ListEnrolmentsQuery>;

export const StudentEnrolmentParam = z.object({ studentId: z.string().min(1) });
export const StudentEnrolmentQuery = z.object({ academicYearId: z.string().min(1).optional() });

export const CreateEnrolment = z
  .object({
    academicYearId: z.string().min(1),
    studentId: z.string().min(1),
    subjectId: z.string().min(1),
    teacherId: z.string().min(1).nullable().optional(),
    mode: EnrolmentModeSchema.default('in_school'),
    startedOn: DateOnlySchema.optional(),
  })
  .refine((d) => d.mode !== 'self_study' || !d.teacherId, {
    message: 'A self-study enrolment has no teacher',
    path: ['teacherId'],
  });
export type CreateEnrolmentType = z.infer<typeof CreateEnrolment>;

export const UpdateEnrolment = z
  .object({
    teacherId: z.string().min(1).nullable().optional(),
    mode: EnrolmentModeSchema.optional(),
  })
  .refine((d) => d.mode !== 'self_study' || !d.teacherId, {
    message: 'A self-study enrolment has no teacher',
    path: ['teacherId'],
  });
export type UpdateEnrolmentType = z.infer<typeof UpdateEnrolment>;

export const EndEnrolment = z.object({
  endedOn: DateOnlySchema.optional(),
  reason: z.string().trim().min(3, 'Say why (at least 3 characters)').max(300),
});
export type EndEnrolmentType = z.infer<typeof EndEnrolment>;

/**
 * Staff create the year's enrolments in bulk (preview, then commit):
 * - `previous_enrolment`: carry last year's in-school and self-study
 *   enrolments forward, for students still at school next year, with
 *   `subjectMap` replacing a finished subject by the one that follows it
 *   ("Biology AS units → Biology A2 units");
 * - `registrations`: from the exam registrations of the series in
 *   `registrationYear` (default: the target year), with the teacher each
 *   registration names (`registration.teacherId`) and self-study where the
 *   registration was taken outside school.
 * `sectionIds` / `studentIds` narrow who is enrolled.
 */
export const BulkEnrol = z.object({
  academicYearId: z.string().min(1),
  source: z.enum(['previous_enrolment', 'registrations']),
  registrationYear: z.number().int().min(2000).max(2100).optional(),
  sectionIds: z.array(z.string().min(1)).max(50).optional(),
  studentIds: z.array(z.string().min(1)).max(2000).optional(),
  subjectMap: z.array(z.object({ from: z.string().min(1), to: z.string().min(1).nullable() })).max(200).default([]),
  /** Rows of the preview left out ("studentId|subjectId"). */
  exclude: z.array(z.string().min(1)).max(5000).default([]),
  commit: z.boolean().default(false),
});
export type BulkEnrolType = z.infer<typeof BulkEnrol>;

/** Enrol every current member of a section in some subjects, with one teacher each. */
export const EnrolSection = z.object({
  sectionId: z.string().min(1),
  subjects: z
    .array(z.object({
      subjectId: z.string().min(1),
      teacherId: z.string().min(1).nullable().optional(),
      mode: EnrolmentModeSchema.default('in_school'),
    }))
    .min(1, 'Choose at least one subject')
    .max(30)
    .refine((s) => new Set(s.map((x) => x.subjectId)).size === s.length, 'Each subject once'),
  /** Leave these members out. */
  excludeStudentIds: z.array(z.string().min(1)).max(100).default([]),
});
export type EnrolSectionType = z.infer<typeof EnrolSection>;

/**
 * Rows from a sheet (the Enrolment screen's paste, and F7's import): each
 * names the student (the school's student ID, email, or id), the subject
 * (its code or id), optionally the teacher (name or id) and the mode.
 * Preview first; commit writes the rows that resolved.
 */
export const BatchEnrolRow = z.object({
  student: z.string().trim().min(1, 'Name the student'),
  subject: z.string().trim().min(1, 'Name the subject'),
  teacher: z.string().trim().max(200).nullable().optional(),
  mode: EnrolmentModeSchema.default('in_school'),
  /** Where the row came from (a sheet line), kept on the enrolment. */
  ref: z.string().trim().max(200).optional(),
});
export type BatchEnrolRowType = z.infer<typeof BatchEnrolRow>;

export const BatchEnrol = z.object({
  academicYearId: z.string().min(1),
  rows: z.array(BatchEnrolRow).min(1).max(2000),
  commit: z.boolean().default(false),
});
export type BatchEnrolType = z.infer<typeof BatchEnrol>;

export const EnrolmentCheckQuery = z.object({
  academicYearId: z.string().min(1),
  studentId: z.string().min(1).optional(),
});
export type EnrolmentCheckQueryType = z.infer<typeof EnrolmentCheckQuery>;

export const ClassListQuery = z.object({
  subjectId: z.string().min(1),
  academicYearId: z.string().min(1).optional(),
});
