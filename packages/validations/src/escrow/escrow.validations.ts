/**
 * Escrow Validation Schemas
 *
 * Zod schemas for all escrow management operations (ESC-001 to ESC-007):
 * - Parent transfers escrow funds between linked children (ESC-003)
 * - Parent requests a cash withdrawal for a child (ESC-004)
 * - Admin fulfills or rejects a withdrawal request (ESC-005, ESC-006)
 *
 * Key access rules enforced at the route level (not here):
 * - Students: read-only access (balance + transactions) — OI-010
 * - Parents: full transactional control (transfer, withdraw)
 * - Admins: withdrawal fulfillment only
 */

import { z } from 'zod';

// ─── Withdrawal Request Status ────────────────────────────────────────────────

export const WITHDRAWAL_STATUSES = [
  'pending',
  'partially_fulfilled',
  'fulfilled',
  'rejected',
] as const;

export const WithdrawalStatusSchema = z.enum(WITHDRAWAL_STATUSES);
export type WithdrawalStatus = z.infer<typeof WithdrawalStatusSchema>;

export const WITHDRAWAL_STATUS_LABELS: Record<typeof WITHDRAWAL_STATUSES[number], string> = {
  pending:              'Pending',
  partially_fulfilled:  'Partially Fulfilled',
  fulfilled:            'Fulfilled',
  rejected:             'Rejected',
};

// ─── Param Validation ─────────────────────────────────────────────────────────

export const WithdrawalRequestId = z.object({
  id: z.string().min(1, 'Invalid withdrawal request ID'),
});
export type WithdrawalRequestIdType = z.infer<typeof WithdrawalRequestId>;

// ─── Parent: Transfer Escrow Between Children ─────────────────────────────────

/**
 * Parent transfers escrow funds from one linked child to another (ESC-003).
 * Both fromStudentId and toStudentId must be distinct linked children.
 * amount must not exceed the fromStudent's current balance.
 */
export const TransferEscrow = z.object({
  fromStudentId: z.string().min(1, 'Invalid source student ID'),
  toStudentId:   z.string().min(1, 'Invalid destination student ID'),
  amount:        z.number().positive('Transfer amount must be greater than 0').max(1_000_000, 'Amount exceeds maximum allowed'),
}).refine(
  (data) => data.fromStudentId !== data.toStudentId,
  { message: 'Cannot transfer escrow to the same student', path: ['toStudentId'] }
);
export type TransferEscrowType = z.infer<typeof TransferEscrow>;

// ─── Parent: Request Withdrawal ───────────────────────────────────────────────

/**
 * Parent requests a cash withdrawal from a specific child's escrow (ESC-004).
 * studentId identifies which linked child the withdrawal is for.
 * amount must not exceed the child's current balance.
 */
export const RequestWithdrawal = z.object({
  studentId: z.string().min(1, 'Invalid student ID'),
  amount:    z.number().positive('Withdrawal amount must be greater than 0').max(1_000_000, 'Amount exceeds maximum allowed'),
});
export type RequestWithdrawalType = z.infer<typeof RequestWithdrawal>;

// ─── Admin: Fulfill Withdrawal Request ───────────────────────────────────────

/**
 * Admin releases an amount from a pending withdrawal request (ESC-006).
 * releasedAmount is the amount being released in THIS call (incremental).
 * Can be called multiple times (partial fulfillment support).
 * Total released = sum of all previous releasedAmount calls.
 * When cumulative total reaches requestedAmount → status becomes 'fulfilled'.
 */
export const FulfillWithdrawal = z.object({
  releasedAmount: z.number().positive('Released amount must be greater than 0').max(1_000_000, 'Amount exceeds maximum allowed'),
  notes:          z.string().max(500).optional(),
});
export type FulfillWithdrawalType = z.infer<typeof FulfillWithdrawal>;

// ─── Admin: Reject Withdrawal Request ────────────────────────────────────────

/**
 * Admin rejects a withdrawal request with a mandatory reason.
 *
 * Funds ARE moved on rejection — they were debited from the student's
 * escrow when the request was created (the "hold"), so rejection must
 * credit the held-but-unreleased amount back:
 *   - Rejected from 'pending': full requestedAmount is refunded.
 *   - Rejected from 'partially_fulfilled': the unreleased remainder
 *     (requestedAmount − releasedAmount) is refunded.
 *
 * See escrow.services.ts → rejectWithdrawalRequest for the accounting.
 */
export const RejectWithdrawal = z.object({
  notes: z.string().min(1, 'A reason is required when rejecting a withdrawal request').max(500),
});
export type RejectWithdrawalType = z.infer<typeof RejectWithdrawal>;

// ─── Query Filters ────────────────────────────────────────────────────────────

export const EscrowQuery = z.object({
  studentId: z.string().min(1).optional(),
});
export type EscrowQueryType = z.infer<typeof EscrowQuery>;

export const WithdrawalsQuery = z.object({
  studentId: z.string().min(1).optional(),
  status:    WithdrawalStatusSchema.optional(),
});
export type WithdrawalsQueryType = z.infer<typeof WithdrawalsQuery>;
