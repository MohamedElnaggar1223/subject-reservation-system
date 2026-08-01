/**
 * Teacher Validation Schemas (V3 §6.7)
 *
 * Teachers are data-only profiles — no login, no portal. Admins manage
 * them; students optionally pick a preferred teacher at registration.
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
