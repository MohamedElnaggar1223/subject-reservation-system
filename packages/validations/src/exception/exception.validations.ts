/**
 * Exception Validation Schemas (V3 §6.3)
 *
 * Per-student overrides granted by finance admins — the sanctioned way
 * around the system's own rules, always with a reason, always audited.
 */

import { z } from 'zod';

export const EXCEPTION_TYPES = [
  'discount_percent',
  'discount_fixed',
  'custom_price',
  'fee_waiver',
  'deadline_extension',
  'late_registration',
  'custom_refund_percent',
] as const;

export const ExceptionTypeSchema = z.enum(EXCEPTION_TYPES);
export type ExceptionType = z.infer<typeof ExceptionTypeSchema>;

export const EXCEPTION_TYPE_LABELS: Record<typeof EXCEPTION_TYPES[number], string> = {
  discount_percent:      'Discount (%)',
  discount_fixed:        'Discount (fixed EGP)',
  custom_price:          'Custom Price',
  fee_waiver:            'School Fee Waiver',
  deadline_extension:    'Deadline Extension',
  late_registration:     'Late Registration Permission',
  custom_refund_percent: 'Custom Refund %',
};

/** Types whose `value` is required and meaningful */
export const VALUE_EXCEPTION_TYPES = [
  'discount_percent',
  'discount_fixed',
  'custom_price',
  'custom_refund_percent',
] as const;

export const ExceptionId = z.object({
  id: z.string().min(1, 'Invalid exception ID'),
});
export type ExceptionIdType = z.infer<typeof ExceptionId>;

export const CreateException = z
  .object({
    type: ExceptionTypeSchema,
    studentId: z.string().min(1, 'Invalid student ID'),
    sessionId: z.string().min(1).optional().nullable(),
    subjectId: z.string().min(1).optional().nullable(),
    value: z.number().min(0).max(1_000_000).optional().nullable(),
    reason: z.string().min(3, 'A reason is required').max(500),
    validUntil: z.coerce.date().optional().nullable(),
  })
  .refine(
    (d) =>
      !(VALUE_EXCEPTION_TYPES as readonly string[]).includes(d.type) ||
      (d.value !== undefined && d.value !== null),
    { message: 'This exception type requires a value', path: ['value'] }
  )
  .refine(
    (d) =>
      !['discount_percent', 'custom_refund_percent'].includes(d.type) ||
      d.value == null ||
      d.value <= 100,
    { message: 'Percentage must be 0–100', path: ['value'] }
  )
  .refine(
    (d) =>
      !['deadline_extension', 'late_registration'].includes(d.type) || !!d.validUntil,
    { message: 'Deadline extensions need an expiry date', path: ['validUntil'] }
  );
export type CreateExceptionType = z.infer<typeof CreateException>;

export const ListExceptionsQuery = z.object({
  studentId: z.string().min(1).optional(),
  status: z.enum(['active', 'revoked']).optional(),
  type: ExceptionTypeSchema.optional(),
});
export type ListExceptionsQueryType = z.infer<typeof ListExceptionsQuery>;
