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
 * Subject ID param validation
 */
export const SubjectId = z.object({
  id: z.string().min(1, 'Subject ID is required'),
});
export type SubjectIdType = z.infer<typeof SubjectId>;

/**
 * Create Subject
 *
 * Admin-only. Requires all core fields.
 * If isOfferedAtSchool is false, customPrice is required.
 */
export const CreateSubject = z
  .object({
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
    priceInSchool: z
      .number()
      .positive('Price must be greater than zero')
      .max(100000, 'Price seems too high'),
    isOfferedAtSchool: z.boolean().default(true),
    customPrice: z
      .number()
      .positive('Custom price must be greater than zero')
      .max(100000, 'Custom price seems too high')
      .optional()
      .nullable(),
    isCore: z.boolean().default(false),
  })
  .refine(
    (data) =>
      data.isOfferedAtSchool ||
      (data.customPrice !== undefined && data.customPrice !== null),
    {
      message: 'Custom price is required when subject is not offered at school',
      path: ['customPrice'],
    }
  );

export type CreateSubjectType = z.infer<typeof CreateSubject>;

/**
 * Update Subject
 *
 * Admin-only. All fields are optional (partial update).
 * Validation still enforces customPrice when isOfferedAtSchool is false
 * only if both fields are provided in the same request.
 */
export const UpdateSubject = z
  .object({
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
    priceInSchool: z
      .number()
      .positive('Price must be greater than zero')
      .max(100000, 'Price seems too high')
      .optional(),
    isOfferedAtSchool: z.boolean().optional(),
    customPrice: z
      .number()
      .positive('Custom price must be greater than zero')
      .max(100000, 'Custom price seems too high')
      .optional()
      .nullable(),
    isCore: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // Only validate if isOfferedAtSchool is explicitly set to false in this request
      if (data.isOfferedAtSchool === false) {
        return data.customPrice !== undefined && data.customPrice !== null;
      }
      return true;
    },
    {
      message: 'Custom price is required when subject is not offered at school',
      path: ['customPrice'],
    }
  )
  .refine(
    (data) => {
      // Reject explicitly nulling customPrice without also setting isOfferedAtSchool to true.
      // Sending { customPrice: null } alone could create an invalid state if the subject
      // is currently not offered at school (where customPrice is required).
      // The full state check (current DB state + partial update) happens in the service layer.
      if (data.customPrice === null && data.isOfferedAtSchool === undefined) {
        return false;
      }
      return true;
    },
    {
      message:
        'Cannot set customPrice to null without also setting isOfferedAtSchool to true',
      path: ['customPrice'],
    }
  );

export type UpdateSubjectType = z.infer<typeof UpdateSubject>;

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
