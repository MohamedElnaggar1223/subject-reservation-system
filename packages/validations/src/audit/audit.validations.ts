/**
 * Audit Log Validation Schemas
 *
 * Zod schemas for the audit trail system (REP-006).
 *
 * AUDIT_ACTIONS covers every significant system operation:
 * - Subject CRUD
 * - Session lifecycle
 * - Registration approval flow
 * - Payment lifecycle
 * - Change request (drop/swap) flow
 * - Escrow operations
 * - User / grade management
 * - Admin broadcasts
 *
 * AUDIT_ENTITY_TYPES matches the entityType column — links each log entry
 * back to the domain entity it describes.
 *
 * AuditLogsQuery drives the admin audit log viewer (REP-006):
 * filterable by userId, action, entityType, dateFrom, dateTo, and
 * paginated via limit/offset.
 */

import { z } from 'zod';

// ─── Entity Types ─────────────────────────────────────────────────────────────

export const AUDIT_ENTITY_TYPES = [
  'user',
  'subject',
  'session',
  'registration',
  'payment',
  'escrow',
  'change_request',
  'notification',
] as const;

export const AuditEntityTypeSchema = z.enum(AUDIT_ENTITY_TYPES);
export type AuditEntityType = z.infer<typeof AuditEntityTypeSchema>;

export const AUDIT_ENTITY_TYPE_LABELS: Record<AuditEntityType, string> = {
  user:           'User',
  subject:        'Subject',
  session:        'Session',
  registration:   'Registration',
  payment:        'Payment',
  escrow:         'Escrow',
  change_request: 'Change Request',
  notification:   'Notification',
};

// ─── Action Types ─────────────────────────────────────────────────────────────

export const AUDIT_ACTIONS = [
  // Subject management
  'SUBJECT_CREATED',
  'SUBJECT_UPDATED',
  'SUBJECT_DEACTIVATED',
  'SUBJECT_ACTIVATED',
  'SUBJECT_CORE_UPDATED',
  // Session lifecycle
  'SESSION_CREATED',
  'SESSION_UPDATED',
  'SESSION_ACTIVATED',
  'SESSION_CLOSED',
  'SESSION_AUTO_CLOSED',
  'SESSION_AUTO_ACTIVATED',
  // Registration flow
  'REGISTRATION_REQUESTED',
  'REGISTRATION_DIRECT',
  'REGISTRATION_APPROVED',
  'REGISTRATION_APPROVAL_REVERTED',
  'REGISTRATION_REJECTED',
  'REGISTRATION_ADMIN_OVERRIDE',
  'REGISTRATION_CONFIRMED',
  // Payment lifecycle
  'PAYMENT_INITIATED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_FAILED',
  // Change requests
  'CHANGE_REQUEST_CREATED',
  'CHANGE_REQUEST_APPROVED',
  'CHANGE_REQUEST_REJECTED',
  'CHANGE_REQUEST_CANCELLED',
  'DIRECT_DROP_EXECUTED',
  'DIRECT_SWAP_EXECUTED',
  // Escrow
  'ESCROW_TRANSFER',
  'WITHDRAWAL_REQUESTED',
  'WITHDRAWAL_FULFILLED',
  'WITHDRAWAL_REJECTED',
  // User / grade
  'USER_UPDATED',
  'USER_GRADE_CHANGED',
  // Admin
  'ADMIN_ANNOUNCEMENT',
] as const;

export const AuditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  SUBJECT_CREATED:            'Subject Created',
  SUBJECT_UPDATED:            'Subject Updated',
  SUBJECT_DEACTIVATED:        'Subject Deactivated',
  SUBJECT_ACTIVATED:          'Subject Reactivated',
  SUBJECT_CORE_UPDATED:       'Core Subject Flag Updated',
  SESSION_CREATED:            'Session Created',
  SESSION_UPDATED:            'Session Updated',
  SESSION_ACTIVATED:          'Session Activated',
  SESSION_CLOSED:             'Session Closed',
  SESSION_AUTO_CLOSED:        'Session Auto-Closed',
  SESSION_AUTO_ACTIVATED:     'Session Auto-Activated',
  REGISTRATION_REQUESTED:     'Registration Request Submitted',
  REGISTRATION_DIRECT:        'Direct Registration by Parent',
  REGISTRATION_APPROVED:      'Registration Request Approved',
  REGISTRATION_APPROVAL_REVERTED: 'Registration Approval Reverted',
  REGISTRATION_REJECTED:      'Registration Request Rejected',
  REGISTRATION_ADMIN_OVERRIDE:'Admin Override Applied',
  REGISTRATION_CONFIRMED:     'Registration Confirmed (Payment)',
  PAYMENT_INITIATED:          'Payment Initiated',
  PAYMENT_CONFIRMED:          'Payment Confirmed',
  PAYMENT_FAILED:             'Payment Failed',
  CHANGE_REQUEST_CREATED:     'Drop/Swap Request Created',
  CHANGE_REQUEST_APPROVED:    'Drop/Swap Request Approved',
  CHANGE_REQUEST_REJECTED:    'Drop/Swap Request Rejected',
  CHANGE_REQUEST_CANCELLED:   'Drop/Swap Request Cancelled',
  DIRECT_DROP_EXECUTED:       'Direct Drop by Parent',
  DIRECT_SWAP_EXECUTED:       'Direct Swap by Parent',
  ESCROW_TRANSFER:            'Escrow Transfer',
  WITHDRAWAL_REQUESTED:       'Withdrawal Request Created',
  WITHDRAWAL_FULFILLED:       'Withdrawal Fulfilled',
  WITHDRAWAL_REJECTED:        'Withdrawal Rejected',
  USER_UPDATED:               'User Profile Updated',
  USER_GRADE_CHANGED:         'Student Grade Changed',
  ADMIN_ANNOUNCEMENT:         'Admin Announcement Sent',
};

// ─── Query Filters ────────────────────────────────────────────────────────────

/**
 * Query parameters for the admin audit log viewer (REP-006).
 * All filters are optional — returns all entries when empty.
 */
export const AuditLogsQuery = z.object({
  userId:     z.string().min(1, 'Invalid user ID').optional(),
  action:     AuditActionSchema.optional(),
  entityType: AuditEntityTypeSchema.optional(),
  entityId:   z.string().optional(),
  dateFrom:   z.string().optional(),
  dateTo:     z.string().optional(),
  format:     z.enum(['json', 'csv']).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10) || 50, 200) : 50)),
  offset: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) || 0 : 0)),
});
export type AuditLogsQueryType = z.infer<typeof AuditLogsQuery>;
