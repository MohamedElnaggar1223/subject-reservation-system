/**
 * User Validation Schemas
 * 
 * Validates data for user profile operations:
 * - Viewing profile
 * - Updating profile
 * - Admin user management
 */

import { z } from 'zod';
import { GradeSchema } from '../roles';

/**
 * User ID validation (UUID format)
 */
export const UserId = z.object({
  id: z.string().uuid('Invalid user ID format'),
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
  role: z.enum(['admin', 'student', 'parent']).optional(),
  grade: GradeSchema.optional(),
  search: z.string().optional(),
});
export type UserQueryFiltersType = z.infer<typeof UserQueryFilters>;
