/**
 * Exception Validation Schemas (V3 §6.3)
 *
 * Per-student overrides granted by finance admins — the sanctioned way
 * around the system's own rules, always with a reason, always audited.
 */

import { z } from 'zod';
import { ROLES, type Role } from '../roles';
import { CreatePolicyException, PolicyKeySchema } from './policies';

export const EXCEPTION_TYPES = [
  'discount_percent',
  'discount_fixed',
  'custom_price',
  'fee_waiver',
  'deadline_extension',
  'late_registration',
  'custom_refund_percent',
  // F0a: a grade-10 student may sit a series other than June (an audited
  // exception to "grade 10 sits June only"). Scope: one series, or every
  // series of their grade-10 year when no session is given.
  'grade10_other_series',
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
  grade10_other_series:  'Grade 10: sit a series other than June',
};

/**
 * Who may grant (and revoke) each exception type, checked in the handler
 * (F0a). Money exceptions are the finance admin's; the grade-10 rule is
 * academic, the coordinator's. Admin may grant every type.
 */
export const EXCEPTION_GRANT_ROLES: Record<(typeof EXCEPTION_TYPES)[number], readonly Role[]> = {
  discount_percent:      [ROLES.FINANCE_ADMIN, ROLES.ADMIN],
  discount_fixed:        [ROLES.FINANCE_ADMIN, ROLES.ADMIN],
  custom_price:          [ROLES.FINANCE_ADMIN, ROLES.ADMIN],
  fee_waiver:            [ROLES.FINANCE_ADMIN, ROLES.ADMIN],
  deadline_extension:    [ROLES.FINANCE_ADMIN, ROLES.ADMIN],
  late_registration:     [ROLES.FINANCE_ADMIN, ROLES.ADMIN],
  custom_refund_percent: [ROLES.FINANCE_ADMIN, ROLES.ADMIN],
  grade10_other_series:  [ROLES.COORDINATOR, ROLES.ADMIN],
};

/** Every role that may grant at least one exception type. */
export const EXCEPTION_ROLES = [ROLES.FINANCE_ADMIN, ROLES.COORDINATOR, ROLES.ADMIN] as const;

export function exceptionTypesGrantableBy(role: string | null | undefined): (typeof EXCEPTION_TYPES)[number][] {
  return EXCEPTION_TYPES.filter((t) => (EXCEPTION_GRANT_ROLES[t] as readonly string[]).includes(role ?? ''));
}

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
  // The reservations rework (§3.7): a family's own exceptions (a parent account).
  familyId: z.string().min(1).optional(),
  // 'lapsed': past its validUntil (F0a's grade-10 step; a plan's lapse). 'used': a one-shot gate
  // used by the reservation it let through, or a plan whose line was paid from its deposits.
  status: z.enum(['active', 'revoked', 'lapsed', 'used']).optional(),
  type: ExceptionTypeSchema.optional(),
  policyKey: PolicyKeySchema.optional(),
});
export type ListExceptionsQueryType = z.infer<typeof ListExceptionsQuery>;

/**
 * POST /v1/exceptions takes either shape (§3.7): a policy of the registry with its scope, or one of
 * the eight legacy types ({ type, studentId, sessionId?, subjectId?, value?, validUntil? }), which
 * the API maps onto its policy key exactly as the migration does (LEGACY_TYPE_TO_POLICY), so a
 * caller written before the registry keeps working for one release.
 */
export const GrantException = z.union([CreatePolicyException, CreateException]);
export type GrantExceptionType = z.infer<typeof GrantException>;
