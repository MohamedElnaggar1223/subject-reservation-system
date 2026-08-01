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
 * Admin can update additional fields like grade and role
 */
export const AdminUpdateUser = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
  phone: z.string()
    .regex(/^[\d\s\-+()]+$/, 'Invalid phone number format')
    .min(8, 'Phone number too short')
    .max(20, 'Phone number too long')
    .optional()
    .nullable(),
  grade: GradeSchema.optional().nullable(),
  // V3: admins provision finance staff by promoting an account's role
  role: RoleSchema.optional(),
  banned: z.boolean().optional(),
  banReason: z.string().max(500, 'Ban reason too long').optional().nullable(),
});
export type AdminUpdateUserType = z.infer<typeof AdminUpdateUser>;

/**
 * Student Registration Data
 * Additional fields collected during student sign-up
 */
export const StudentRegistrationData = z.object({
  grade: GradeSchema,
});
export type StudentRegistrationDataType = z.infer<typeof StudentRegistrationData>;

/**
 * User query filters (for admin)
 */
export const UserQueryFilters = z.object({
  role: RoleSchema.optional(),
  grade: GradeSchema.optional(),
  search: z.string().optional(),
});
export type UserQueryFiltersType = z.infer<typeof UserQueryFilters>;

/**
 * Manual Grade Adjustment (GRADE-002)
 * Admin sets a student's grade with a mandatory reason.
 * newGrade of null means the student is marked as graduated.
 */
export const ManualGradeAdjustment = z.object({
  newGrade: GradeSchema.nullable(),
  reason: z
    .string()
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Reason too long'),
});
export type ManualGradeAdjustmentType = z.infer<typeof ManualGradeAdjustment>;
