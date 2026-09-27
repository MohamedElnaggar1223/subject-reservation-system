/**
 * Desk Operations Validation Schemas (UX_AUDIT G1/G5 + team management G7)
 *
 * Staff acting on a family's behalf at the school desk — the flows that
 * replace the Excel sheet during the transition to app-first self-serve.
 */

import { z } from 'zod';
import { RoleSchema, GradeSchema } from '../roles';
import { CommonSchemas, isWholePiastres, PIASTRES_MESSAGE } from '../common.validations';
import { SubjectRegistrationOptions } from '../registration/registration.validations';

// ─── Team management (G7) ────────────────────────────────────────────────────

export const AdminCreateUser = z
  .object({
    name: z.string().min(1, 'Name is required').max(100),
    email: z.string().email('Invalid email'),
    password: CommonSchemas.password,
    role: RoleSchema,
    // Required when creating a student
    grade: GradeSchema.optional(),
  })
  .refine((d) => d.role !== 'student' || d.grade !== undefined, {
    message: 'Students need a grade',
    path: ['grade'],
  });
export type AdminCreateUserType = z.infer<typeof AdminCreateUser>;

// ─── Desk onboarding (G5) ────────────────────────────────────────────────────

/**
 * One form enrolls a walk-in family: find-or-create the parent,
 * find-or-create the student, and link them APPROVED on the spot
 * (staff vouch in person — no student-login approval loop).
 */
const DeskPerson = z.object({
  // Either an existing account's email, or full details to create one
  email: z.string().email('Invalid email'),
  name: z.string().min(1).max(100).optional(),
  password: CommonSchemas.password.optional(),
  phone: z
    .string()
    .regex(/^[\d\s\-+()]+$/, 'Invalid phone number format')
    .min(8)
    .max(20)
    .optional()
    .nullable(),
});

export const DeskOnboardFamily = z.object({
  parent: DeskPerson,
  student: DeskPerson.extend({
    grade: GradeSchema.optional(),
  }),
});
export type DeskOnboardFamilyType = z.infer<typeof DeskOnboardFamily>;

// ─── Desk registration + payment (G1) ────────────────────────────────────────

/**
 * One action at the desk: register the subjects AND record the money the
 * officer just took. `collectNow` omitted = register only (family pays
 * later, rows sit at pending_payment).
 */
export const DeskRegistration = z.object({
  studentId: z.string().min(1, 'Pick a student'),
  sessionId: z.string().min(1, 'Pick a session'),
  subjectIds: z
    .array(z.string().min(1))
    .min(1, 'Select at least one subject')
    .max(20),
  subjectOptions: z.record(z.string(), SubjectRegistrationOptions).optional(),
  collectNow: z
    .object({
      instrumentUsed: z.enum(['cash', 'card', 'instapay', 'other']),
      escrowAmountToApply: z.number().min(0).max(1_000_000).refine(isWholePiastres, PIASTRES_MESSAGE).default(0),
      notes: z.string().max(500).optional(),
    })
    .optional(),
});
export type DeskRegistrationType = z.infer<typeof DeskRegistration>;

/**
 * Desk collection for subjects already registered and waiting for payment —
 * after a reversal, a rejected transfer or a cancelled checkout, or a
 * register-only desk visit (money audit MA-18).
 */
export const DeskCollect = z.object({
  studentId: z.string().min(1, 'Pick a student'),
  registrationIds: z.array(z.string().min(1)).min(1, 'Select at least one subject').max(20),
  instrumentUsed: z.enum(['cash', 'card', 'instapay', 'other']),
  escrowAmountToApply: z.number().min(0).max(1_000_000).refine(isWholePiastres, PIASTRES_MESSAGE).default(0),
  notes: z.string().max(500).optional(),
});
export type DeskCollectType = z.infer<typeof DeskCollect>;

/** Desk school-fee collection: officer takes the money, gate unlocks now */
export const DeskSchoolFeePayment = z.object({
  studentId: z.string().min(1, 'Pick a student'),
  instrumentUsed: z.enum(['cash', 'card', 'instapay', 'other']),
  notes: z.string().max(500).optional(),
  /**
   * Which year is being paid. Omitted = the year containing today.
   * Needed near the 1 July rollover, when the year the registration
   * gate demands differs from the year today falls in.
   */
  academicYear: z
    .string()
    .regex(/^\d{4}-\d{4}$/, 'Academic year must look like 2026-2027')
    .optional(),
});
export type DeskSchoolFeePaymentType = z.infer<typeof DeskSchoolFeePayment>;
