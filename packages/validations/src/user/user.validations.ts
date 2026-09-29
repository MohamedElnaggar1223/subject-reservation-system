/**
 * User Validation Schemas
 * 
 * Validates data for user profile operations:
 * - Viewing profile
 * - Updating profile
 * - Admin user management
 */

import { z } from 'zod';
import { GradeSchema, RoleSchema } from '../roles';
import { EntryGradeSchema } from '../academic/academic-year';

/**
 * User ID validation (UUID format)
 */
export const UserId = z.object({
  id: z.string().min(1, 'Invalid user ID format'),
});
export type UserIdType = z.infer<typeof UserId>;

/**
 * Update Profile
 * Users can update their name and phone number
 */
export const UpdateProfile = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
  phone: z.string()
    .regex(/^[\d\s\-+()]+$/, 'Invalid phone number format')
    .min(8, 'Phone number too short')
    .max(20, 'Phone number too long')
    .optional()
    .nullable(),
});
export type UpdateProfileType = z.infer<typeof UpdateProfile>;

/**
 * Admin Update User
 * Admin can update the name, phone, role and ban. A student's grade is not
 * edited here: it is derived from the cohort, and a correction is an audited
 * cohort change with a reason (PUT /v1/students/:id/cohort, F0a).
 */
export const AdminUpdateUser = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
  phone: z.string()
    .regex(/^[\d\s\-+()]+$/, 'Invalid phone number format')
    .min(8, 'Phone number too short')
    .max(20, 'Phone number too long')
    .optional()
    .nullable(),
  // V3: admins provision finance staff by promoting an account's role
  role: RoleSchema.optional(),
  banned: z.boolean().optional(),
  banReason: z.string().max(500, 'Ban reason too long').optional().nullable(),
});
export type AdminUpdateUserType = z.infer<typeof AdminUpdateUser>;

/**
 * Student Registration Data
 * Additional fields collected during student sign-up: the grade the student
 * is in this academic year (9 = starts grade 10 next year). The cohort is
 * stored (F0a).
 */
export const StudentRegistrationData = z.object({
  grade: EntryGradeSchema,
});
export type StudentRegistrationDataType = z.infer<typeof StudentRegistrationData>;

/**
 * User query filters (for admin). `grade` is today's grade.
 */
export const UserQueryFilters = z.object({
  role: RoleSchema.optional(),
  grade: z.coerce.number().pipe(GradeSchema).optional(),
  search: z.string().optional(),
});
export type UserQueryFiltersType = z.infer<typeof UserQueryFilters>;

// The manual grade adjustment (GRADE-002) was removed by F0a: a grade is
// derived from the cohort; see CorrectCohort in student.validations.ts.
