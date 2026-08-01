/**
 * School Fee Validation Schemas (V3 §6.2, D-A/D-H)
 *
 * The annual school-year access fee. Finance-admin/admin define a
 * schedule per academic year — one uniform amount (grade=null) or
 * per-grade amounts. Paying it gates subject registration for sessions
 * inside that year (waivable via a fee_waiver exception).
 */

import { z } from 'zod';
import { GradeSchema } from '../roles';

/** e.g. '2026-2027' — consecutive years */
export const AcademicYearSchema = z
  .string()
  .regex(/^\d{4}-\d{4}$/, 'Academic year must look like 2026-2027')
  .refine(
    (v) => {
      const [a, b] = v.split('-').map(Number);
      return b === (a ?? 0) + 1;
    },
    { message: 'Academic year must be two consecutive years (e.g. 2026-2027)' }
  );

export const SchoolFeeScheduleId = z.object({
  id: z.string().min(1, 'Schedule ID is required'),
});
export type SchoolFeeScheduleIdType = z.infer<typeof SchoolFeeScheduleId>;

export const CreateSchoolFeeSchedule = z.object({
  academicYear: AcademicYearSchema,
  // null/absent = uniform amount for all grades
  grade: GradeSchema.optional().nullable(),
  amount: z
    .number()
    .min(0, 'Amount cannot be negative')
    .max(10_000_000, 'Amount seems too high'),
  opensAt: z.coerce.date(),
  dueAt: z.coerce.date().optional().nullable(),
});
export type CreateSchoolFeeScheduleType = z.infer<typeof CreateSchoolFeeSchedule>;

export const UpdateSchoolFeeSchedule = z.object({
  amount: z
    .number()
    .min(0, 'Amount cannot be negative')
    .max(10_000_000, 'Amount seems too high')
    .optional(),
  opensAt: z.coerce.date().optional(),
  dueAt: z.coerce.date().optional().nullable(),
});
export type UpdateSchoolFeeScheduleType = z.infer<typeof UpdateSchoolFeeSchedule>;

export const SchoolFeeStatusQuery = z.object({
  // Parents pass the child; students default to themselves
  studentId: z.string().min(1).optional(),
});
export type SchoolFeeStatusQueryType = z.infer<typeof SchoolFeeStatusQuery>;

/**
 * Parent pays the school fee for a linked child. Amount comes from the
 * schedule server-side — never from the client.
 */
export const PaySchoolFee = z.object({
  studentId: z.string().min(1, 'Invalid student ID'),
  paymentMethod: z.enum(['in_school', 'instapay']),
});
export type PaySchoolFeeType = z.infer<typeof PaySchoolFee>;
