/**
 * Teacher Validation Schemas (V3 §6.7, F0a)
 *
 * A teacher record is the person who teaches, linked to the subjects they
 * teach. Since F0a a record can be linked to one staff account
 * (teacher.userId): teaching is a capability, so a coordinator or admin who
 * teaches gets the teacher screens for their own lessons, and a `teacher`
 * account is always linked to one.
 */

import { z } from 'zod';
import { sanitizers } from '../common.validations';

export const TeacherId = z.object({
  id: z.string().min(1, 'Teacher ID is required'),
});
export type TeacherIdType = z.infer<typeof TeacherId>;

export const CreateTeacher = z.object({
  name: z
    .string()
    .min(1, 'Teacher name is required')
    .max(200, 'Teacher name too long')
    .transform(sanitizers.string),
  phone: z
    .string()
    .regex(/^[\d\s\-+()]+$/, 'Invalid phone number format')
    .min(8, 'Phone number too short')
    .max(20, 'Phone number too long')
    .optional()
    .nullable(),
  email: z.string().email('Invalid email').optional().nullable(),
});
export type CreateTeacherType = z.infer<typeof CreateTeacher>;

export const UpdateTeacher = z.object({
  name: z
    .string()
    .min(1, 'Teacher name is required')
    .max(200, 'Teacher name too long')
    .transform(sanitizers.string)
    .optional(),
  phone: z
    .string()
    .regex(/^[\d\s\-+()]+$/, 'Invalid phone number format')
    .min(8, 'Phone number too short')
    .max(20, 'Phone number too long')
    .optional()
    .nullable(),
  email: z.string().email('Invalid email').optional().nullable(),
  isActive: z.boolean().optional(),
});
export type UpdateTeacherType = z.infer<typeof UpdateTeacher>;

export const ListTeachersQuery = z.object({
  search: z.string().max(100).optional(),
  isActive: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
});
export type ListTeachersQueryType = z.infer<typeof ListTeachersQuery>;

/** Link a teacher record to a staff account, or unlink it (userId null). */
export const LinkTeacherAccount = z.object({
  userId: z.string().min(1).nullable(),
});
export type LinkTeacherAccountType = z.infer<typeof LinkTeacherAccount>;
