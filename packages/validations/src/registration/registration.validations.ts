/**
 * Registration Validation Schemas
 *
 * Zod schemas for the subject registration workflow:
 * - Student submits a registration request (pending parent approval)
 * - Parent directly registers for their child (auto-approved, pending payment)
 * - Parent approves or rejects pending registration requests
 * - Admin overrides parent approval for exceptional cases
 */

import { z } from 'zod';
import { ReservationLines, ReservationConsent } from './reservation.validations';

// ─── Status Enum ────────────────────────────────────────────────────────────

export const REGISTRATION_STATUSES = [
  'pending_approval',
  'pending_payment',
  'preregistered',
  'confirmed',
  'dropped_pending_receipt',
  'dropped',
  'rejected',
  'expired',
] as const;

export const RegistrationStatusSchema = z.enum(REGISTRATION_STATUSES);
export type RegistrationStatus = z.infer<typeof RegistrationStatusSchema>;

export const REGISTRATION_STATUS_LABELS: Record<typeof REGISTRATION_STATUSES[number], string> = {
  pending_approval: 'Pending Parent Approval',
  pending_payment:  'Pending Payment',
  preregistered:    'Preregistered (Future Session)',
  confirmed:        'Confirmed',
  dropped_pending_receipt: 'Dropped — Return Receipt to School',
  dropped:          'Dropped',
  rejected:         'Rejected',
  expired:          'Expired',
};

// ─── Param Validation ────────────────────────────────────────────────────────

export const RegistrationId = z.object({
  id: z.string().min(1, 'Invalid registration ID'),
});
export type RegistrationIdType = z.infer<typeof RegistrationId>;

// ─── Student: Submit Registration Request ────────────────────────────────────

/**
 * Used by students to request a reservation: one line per item ticked (the reservations
 * rework, RESERVATIONS_REWORK.md §3.5 — `lines` and `consent` replace `subjectIds` and
 * `subjectOptions`). Lines are created in 'pending_approval' and wait for a parent.
 */
export const RequestRegistration = z.object({
  sessionId: z.string().min(1, 'Invalid session ID'),
  lines: ReservationLines,
  consent: ReservationConsent,
});
export type RequestRegistrationType = z.infer<typeof RequestRegistration>;

// ─── Parent: Direct Registration for Child ───────────────────────────────────

/**
 * Used by parents to register subjects directly for a linked child.
 * Registrations are created in 'pending_payment' status (auto-approved).
 * Requires an approved parent-student link.
 */
export const DirectRegistration = z.object({
  sessionId: z.string().min(1, 'Invalid session ID'),
  studentId: z.string().min(1, 'Invalid student ID'),
  lines: ReservationLines,
  consent: ReservationConsent,
});
export type DirectRegistrationType = z.infer<typeof DirectRegistration>;

// ─── Parent: Preregistration for a Future Session (V3 §6.8) ─────────────────

/**
 * Parent preregisters subjects for a DRAFT (not-yet-open) session.
 * Price locks at preregistration time (D-E). Payment lands in the
 * held wallet and is auto-captured when the session activates.
 */
export const PreregisterRegistration = DirectRegistration;
export type PreregisterRegistrationType = z.infer<typeof PreregisterRegistration>;

// ─── Parent: Approve Pending Registrations ───────────────────────────────────

/**
 * Parent approves one or more pending registration requests from their child.
 * Approved registrations move from 'pending_approval' to 'pending_payment'.
 * Comment is optional — typically used to provide additional context.
 */
export const ApproveRegistrations = z.object({
  registrationIds: z
    .array(z.string().min(1, 'Invalid registration ID'))
    .min(1, 'Select at least one registration to approve'),
  comments: z.string().max(500).optional(),
});
export type ApproveRegistrationsType = z.infer<typeof ApproveRegistrations>;

// ─── Parent: Revert Approval Before Payment ─────────────────────────────────

/**
 * Parent moves one or more unpaid, previously approved student requests back
 * from 'pending_payment' to 'pending_approval'.
 */
export const RevertApprovedRegistrations = z.object({
  registrationIds: z
    .array(z.string().min(1, 'Invalid registration ID'))
    .min(1, 'Select at least one registration to revert'),
});
export type RevertApprovedRegistrationsType = z.infer<typeof RevertApprovedRegistrations>;

// ─── Parent: Reject Pending Registrations ────────────────────────────────────

/**
 * Parent rejects one or more pending registration requests.
 * Rejected registrations move to 'rejected' (terminal state).
 * A comment is mandatory to explain the rejection to the student.
 */
export const RejectRegistrations = z.object({
  registrationIds: z
    .array(z.string().min(1, 'Invalid registration ID'))
    .min(1, 'Select at least one registration to reject'),
  comments: z.string().min(1, 'A reason is required when rejecting a request').max(500),
});
export type RejectRegistrationsType = z.infer<typeof RejectRegistrations>;

// ─── Admin: Override Parent Approval ─────────────────────────────────────────

/**
 * Admin bypasses the parent approval requirement for exceptional cases
 * (e.g., orphaned students, legal guardianship issues).
 * Registrations are created directly in 'pending_payment' status.
 * The reason is stored in approvalComments with an [ADMIN OVERRIDE] prefix
 * to provide a clear audit trail.
 */
export const AdminOverrideApproval = z.object({
  studentId:  z.string().min(1, 'Invalid student ID'),
  sessionId:  z.string().min(1, 'Invalid session ID'),
  lines: ReservationLines,
  // Recorded on the desk channel: the family's paper, read and signed (§3.5).
  consent: ReservationConsent,
  reason: z.string().min(5, 'Reason must be at least 5 characters').max(500),
});
export type AdminOverrideApprovalType = z.infer<typeof AdminOverrideApproval>;

// ─── Query Filters ────────────────────────────────────────────────────────────

export const ListRegistrationsQuery = z.object({
  sessionId: z.string().min(1).optional(),
  studentId: z.string().min(1).optional(),
  status:    RegistrationStatusSchema.optional(),
});
export type ListRegistrationsQueryType = z.infer<typeof ListRegistrationsQuery>;

