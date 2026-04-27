/**
 * Swap / Change Request Validation Schemas
 *
 * Zod schemas for student drop/swap requests and parent approval workflow
 * (SWAP-001 to SWAP-007).
 *
 * Key access rules (enforced at route level):
 * - Students: can only create requests (request-drop, request-swap)
 * - Parents: can approve/reject student requests OR directly drop/swap
 * - Core subjects (Grade 10 June session) cannot be dropped or swapped (SWAP-005)
 * - Actions only allowed when the session is active (SWAP-006)
 */

import { z } from 'zod';

// ─── Change Request Status ────────────────────────────────────────────────────

export const CHANGE_REQUEST_STATUSES = [
  'pending_approval',
  'approved',
  'rejected',
  'cancelled',
] as const;

export const ChangeRequestStatusSchema = z.enum(CHANGE_REQUEST_STATUSES);
export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatusSchema>;

export const CHANGE_REQUEST_STATUS_LABELS: Record<
  typeof CHANGE_REQUEST_STATUSES[number],
  string
> = {
  pending_approval: 'Pending Approval',
  approved:         'Approved',
  rejected:         'Rejected',
  cancelled:        'Cancelled',
};

// ─── Change Request Types ─────────────────────────────────────────────────────

export const CHANGE_REQUEST_TYPES = ['drop', 'swap'] as const;

export const ChangeRequestTypeSchema = z.enum(CHANGE_REQUEST_TYPES);
export type ChangeRequestType = z.infer<typeof ChangeRequestTypeSchema>;

// ─── Param Validation ─────────────────────────────────────────────────────────

export const ChangeRequestId = z.object({
  id: z.string().min(1, 'Invalid change request ID'),
});
export type ChangeRequestIdType = z.infer<typeof ChangeRequestId>;

export const RegistrationIdParam = z.object({
  id: z.string().min(1, 'Invalid registration ID'),
});
export type RegistrationIdParamType = z.infer<typeof RegistrationIdParam>;

// ─── Student: Request Drop ────────────────────────────────────────────────────

/**
 * Student requests to drop a confirmed registration (SWAP-001).
 * Subject must not be a core subject (SWAP-005).
 * Registration window must be open (SWAP-006).
 * Requires parent approval before the drop is applied.
 */
export const RequestDrop = z.object({
  reason: z.string().min(5, 'Please provide a reason for dropping this subject (min 5 chars)').max(500),
});
export type RequestDropType = z.infer<typeof RequestDrop>;

// ─── Student: Request Swap ────────────────────────────────────────────────────

/**
 * Student requests to swap a confirmed registration for another subject (SWAP-002).
 * Subject being dropped must not be core (SWAP-005).
 * Registration window must be open (SWAP-006).
 * Requires parent approval; financial impact shown to parent (SWAP-003).
 */
export const RequestSwap = z.object({
  newSubjectId: z.string().min(1, 'Invalid subject ID'),
  reason:       z.string().min(5, 'Please provide a reason for this swap (min 5 chars)').max(500),
});
export type RequestSwapType = z.infer<typeof RequestSwap>;

// ─── Parent: Direct Drop ──────────────────────────────────────────────────────

/**
 * Parent directly drops a subject for a linked child (SWAP-004).
 * No approval queue — takes effect immediately.
 * Same rules apply: no core subjects, window must be open.
 */
export const DirectDrop = z.object({
  reason: z.string().min(5, 'Please provide a reason for dropping this subject (min 5 chars)').max(500).optional(),
});
export type DirectDropType = z.infer<typeof DirectDrop>;

// ─── Parent: Direct Swap ──────────────────────────────────────────────────────

/**
 * Parent directly swaps a subject for a linked child (SWAP-004).
 * No approval queue — takes effect immediately.
 */
export const DirectSwap = z.object({
  newSubjectId: z.string().min(1, 'Invalid subject ID'),
  reason:       z.string().min(5, 'Please provide a reason for this swap (min 5 chars)').max(500).optional(),
});
export type DirectSwapType = z.infer<typeof DirectSwap>;

// ─── Parent: Approve Change Request ──────────────────────────────────────────

/**
 * Parent approves a pending drop or swap request from a linked child (SWAP-003).
 * Financial processing happens immediately upon approval.
 */
export const ApproveChangeRequest = z.object({
  comments: z.string().max(500).optional(),
});
export type ApproveChangeRequestType = z.infer<typeof ApproveChangeRequest>;

// ─── Parent: Reject Change Request ───────────────────────────────────────────

/**
 * Parent rejects a pending drop or swap request (SWAP-003).
 * No financial impact. Comments are required to explain the decision.
 */
export const RejectChangeRequest = z.object({
  comments: z.string().min(1, 'Please provide a reason for rejecting this request').max(500),
});
export type RejectChangeRequestType = z.infer<typeof RejectChangeRequest>;

// ─── Query Filters ────────────────────────────────────────────────────────────

export const ChangeRequestsQuery = z.object({
  studentId: z.string().min(1).optional(),
  status:    ChangeRequestStatusSchema.optional(),
  type:      ChangeRequestTypeSchema.optional(),
});
export type ChangeRequestsQueryType = z.infer<typeof ChangeRequestsQuery>;
