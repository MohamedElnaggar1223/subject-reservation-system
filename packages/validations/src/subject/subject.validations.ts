/**
 * Subject Validation Schemas
 *
 * Validates data for all subject management operations:
 * - Creating and updating subjects (admin)
 * - Listing and browsing subjects (all authenticated users)
 * - Setting core subject designation (admin)
 */

import { z } from 'zod';
import { sanitizers } from '../common.validations';

/**
 * IGCSE examination councils
 */
export const COUNCILS = {
  PEARSON_EDEXCEL: 'pearson_edexcel',
  CAMBRIDGE: 'cambridge',
  OXFORD: 'oxford',
} as const;

export const CouncilSchema = z.enum([
  COUNCILS.PEARSON_EDEXCEL,
  COUNCILS.CAMBRIDGE,
  COUNCILS.OXFORD,
]);

export type Council = z.infer<typeof CouncilSchema>;

/**
 * Human-readable labels for councils
 */
export const COUNCIL_LABELS: Record<Council, string> = {
  pearson_edexcel: 'Pearson Edexcel',
  cambridge: 'Cambridge',
  oxford: 'Oxford',
};

/**
 * Qualification levels (V3 §5.5).
 * IGCSE Biology and AS Biology are separate subject rows with their own
 * codes and fees. Sessions carry a level too; January is A-Level-only.
 */
export const QUALIFICATION_LEVELS = {
  IGCSE: 'igcse',
  AS_LEVEL: 'as_level',
  A_LEVEL: 'a_level',
} as const;

export const QualificationLevelSchema = z.enum([
  QUALIFICATION_LEVELS.IGCSE,
  QUALIFICATION_LEVELS.AS_LEVEL,
  QUALIFICATION_LEVELS.A_LEVEL,
]);
export type QualificationLevel = z.infer<typeof QualificationLevelSchema>;

export const QUALIFICATION_LEVEL_LABELS: Record<QualificationLevel, string> = {
  igcse: 'IGCSE',
  as_level: 'AS Level',
  a_level: 'A Level',
};

/**
 * Subject ID param validation
 */
export const SubjectId = z.object({
  id: z.string().min(1, 'Subject ID is required'),
});
export type SubjectIdType = z.infer<typeof SubjectId>;

/**
 * Create Subject (V3 §6.2)
 *
 * Admin-only. Fees are split into courseFee (teaching) + registrationFee
 * (board entry). Subjects not offered at school automatically price at
 * 50% of the combined fee (§6.9) — the old customPrice model is gone.
 */
export const CreateSubject = z.object({
  name: z
    .string()
    .min(1, 'Subject name is required')
    .max(200, 'Subject name too long')
    .transform(sanitizers.string),
  code: z
    .string()
    .min(1, 'Subject code is required')
    .max(50, 'Subject code too long')
    .transform((s) => s.trim().toUpperCase()),
  council: CouncilSchema,
  qualificationLevel: QualificationLevelSchema.default('igcse'),
  courseFee: z
    .number()
    .min(0, 'Course fee cannot be negative')
    .max(1_000_000, 'Course fee seems too high'),
  registrationFee: z
    .number()
    .min(0, 'Registration fee cannot be negative')
    .max(1_000_000, 'Registration fee seems too high'),
  isOfferedAtSchool: z.boolean().default(true),
  isCore: z.boolean().default(false),
});

export type CreateSubjectType = z.infer<typeof CreateSubject>;

/**
 * Update Subject
 *
 * Admin-only. All fields are optional (partial update).
 * Validation still enforces customPrice when isOfferedAtSchool is false
 * only if both fields are provided in the same request.
 */
export const UpdateSubject = z.object({
  name: z
    .string()
    .min(1, 'Subject name is required')
    .max(200, 'Subject name too long')
    .transform(sanitizers.string)
    .optional(),
  code: z
    .string()
    .min(1, 'Subject code is required')
    .max(50, 'Subject code too long')
    .transform((s) => s.trim().toUpperCase())
    .optional(),
  council: CouncilSchema.optional(),
  qualificationLevel: QualificationLevelSchema.optional(),
  courseFee: z
    .number()
    .min(0, 'Course fee cannot be negative')
    .max(1_000_000, 'Course fee seems too high')
    .optional(),
  registrationFee: z
    .number()
    .min(0, 'Registration fee cannot be negative')
    .max(1_000_000, 'Registration fee seems too high')
    .optional(),
  isOfferedAtSchool: z.boolean().optional(),
  isCore: z.boolean().optional(),
});

export type UpdateSubjectType = z.infer<typeof UpdateSubject>;

/**
 * Set the full list of teachers linked to a subject (V3 §6.7).
 * Replaces the existing set — an empty array unlinks everyone.
 */
export const SetSubjectTeachers = z.object({
  teacherIds: z.array(z.string().min(1)).max(50),
});
export type SetSubjectTeachersType = z.infer<typeof SetSubjectTeachers>;

/**
 * Set Core Flag
 *
 * Admin-only. Marks or unmarks a subject as core for Grade 10.
 */
export const SetSubjectCore = z.object({
  isCore: z.boolean(),
});
export type SetSubjectCoreType = z.infer<typeof SetSubjectCore>;

/**
 * List Subjects Query
 *
 * Used by both admin (can see inactive) and students/parents (active only).
 * isActive filter is admin-only; non-admins always receive active subjects.
 */
export const ListSubjectsQuery = z.object({
  council: CouncilSchema.optional(),
  qualificationLevel: QualificationLevelSchema.optional(),
  search: z.string().max(100).optional(),
  isActive: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
  isCore: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
});
export type ListSubjectsQueryType = z.infer<typeof ListSubjectsQuery>;
