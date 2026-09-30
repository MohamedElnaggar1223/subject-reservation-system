/**
 * Notification Validation Schemas
 *
 * Zod schemas for the notification system (NOT-001 to NOT-011) and link events.
 *
 * NOTIFICATION_TYPES maps each type to its display label and covers:
 * - Session lifecycle events (NOT-001, NOT-002)
 * - Registration approval flow (NOT-003, NOT-004)
 * - Payment receipt (NOT-005)
 * - Drop/swap request flow (NOT-006, NOT-007)
 * - Escrow events (NOT-008, NOT-009)
 * - Grade changes (GRADE-002)
 * - Admin bulk announcements (NOT-011)
 * - Parent-student link events (AUTH-003, AUTH-004)
 *
 * NOT-010 (parent auto-CC) is enforced at the service layer, not via a separate type.
 */

import { z } from 'zod';

// ─── Notification Types ───────────────────────────────────────────────────────

export const NOTIFICATION_TYPES = [
  // Session lifecycle
  'SESSION_OPENED',
  'SESSION_CLOSED',
  'SESSION_CLOSING_SOON',
  // Registration approval flow
  'REGISTRATION_REQUEST_RECEIVED',
  'REGISTRATION_APPROVED',
  'REGISTRATION_REJECTED',
  // Payment
  'PAYMENT_CONFIRMED',
  'PAYMENT_REVERSED',
  'PAYMENT_REJECTED',
  'PAYMENT_REFERENCE_DUE',
  'PAYMENT_EXPIRED',
  // Drop / swap request flow
  'DROP_SWAP_REQUEST_RECEIVED',
  'DROP_SWAP_PROCESSED',
  // Escrow
  'ESCROW_BALANCE_CHANGED',
  'ESCROW_WITHDRAWAL_FULFILLED',
  'ESCROW_WITHDRAWAL_REJECTED',
  // Grade progression
  'GRADE_CHANGED',
  // Admin broadcast
  'BULK_ANNOUNCEMENT',
  // Parent-student link events (AUTH-003, AUTH-004)
  'LINK_REQUEST_RECEIVED',
  'LINK_DECISION',
  // Staff: a preregistration held at its series' opening (F0a)
  'PREREGISTRATION_HELD',
  // F1: the timetable and cover
  'TIMETABLE_PUBLISHED',
  'COVER_ASSIGNED',
  'LESSON_COVERED',
  'LESSON_CANCELLED',
  // F2: campus leave
  'LEAVE_REQUESTED',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'LEAVE_CANCELLED',
  'LEAVE_CHECKED_OUT',
  'LEAVE_RETURNED',
  'LEAVE_NO_SHOW',
  'LEAVE_LATE_RETURN',
  'LEAVE_LESSON_MISSED',
  'LEAVE_COLLECTOR_REQUESTED',
  'LEAVE_COLLECTOR_DECIDED',
  'LEAVE_CUSTODY_ALERT',
] as const;

export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  SESSION_OPENED:                   'Registration Window Opened',
  SESSION_CLOSED:                   'Registration Window Closed',
  SESSION_CLOSING_SOON:             'Registration Closing Soon',
  REGISTRATION_REQUEST_RECEIVED:    'New Registration Request',
  REGISTRATION_APPROVED:            'Registration Approved',
  REGISTRATION_REJECTED:            'Registration Rejected',
  PAYMENT_CONFIRMED:                'Payment Confirmed',
  PAYMENT_REVERSED:                 'Payment Reversed',
  PAYMENT_REJECTED:                 'Payment Not Received',
  PAYMENT_REFERENCE_DUE:            'Transfer Reference Due',
  PAYMENT_EXPIRED:                  'Payment Not Completed',
  DROP_SWAP_REQUEST_RECEIVED:       'Drop / Swap Request',
  DROP_SWAP_PROCESSED:              'Drop / Swap Processed',
  ESCROW_BALANCE_CHANGED:           'Escrow Balance Updated',
  ESCROW_WITHDRAWAL_FULFILLED:      'Withdrawal Fulfilled',
  ESCROW_WITHDRAWAL_REJECTED:       'Withdrawal Rejected',
  GRADE_CHANGED:                    'Grade Updated',
  BULK_ANNOUNCEMENT:                'Announcement',
  LINK_REQUEST_RECEIVED:            'New Parent Link Request',
  LINK_DECISION:                    'Link Request Decision',
  PREREGISTRATION_HELD:             'Preregistration Held',
  TIMETABLE_PUBLISHED:              'Timetable Published',
  COVER_ASSIGNED:                   'Cover Lesson for You',
  LESSON_COVERED:                   'A Lesson Is Covered',
  LESSON_CANCELLED:                 'A Lesson Is Cancelled',
  LEAVE_REQUESTED:                  'Leave Requested',
  LEAVE_APPROVED:                   'Leave Approved',
  LEAVE_REJECTED:                   'Leave Not Approved',
  LEAVE_CANCELLED:                  'Leave Cancelled',
  LEAVE_CHECKED_OUT:                'Left School',
  LEAVE_RETURNED:                   'Back at School',
  LEAVE_NO_SHOW:                    'Leave Not Taken',
  LEAVE_LATE_RETURN:                'Not Back from Leave',
  LEAVE_LESSON_MISSED:              'A Student Leaves During Your Lesson',
  LEAVE_COLLECTOR_REQUESTED:        'Collector to Approve',
  LEAVE_COLLECTOR_DECIDED:          'Collector Decision',
  LEAVE_CUSTODY_ALERT:              'Custody Alert at the Gate',
};

// Icons mapped per type (used in the notification center UI)
export const NOTIFICATION_TYPE_ICONS: Record<NotificationType, string> = {
  SESSION_OPENED:                   '📅',
  SESSION_CLOSED:                   '📅',
  SESSION_CLOSING_SOON:             '⏰',
  REGISTRATION_REQUEST_RECEIVED:    '📋',
  REGISTRATION_APPROVED:            '✅',
  REGISTRATION_REJECTED:            '❌',
  PAYMENT_CONFIRMED:                '💳',
  PAYMENT_REVERSED:                 '↩️',
  PAYMENT_REJECTED:                 '⚠️',
  PAYMENT_REFERENCE_DUE:            '⏰',
  PAYMENT_EXPIRED:                  '⌛',
  DROP_SWAP_REQUEST_RECEIVED:       '🔄',
  DROP_SWAP_PROCESSED:              '📝',
  ESCROW_BALANCE_CHANGED:           '💰',
  ESCROW_WITHDRAWAL_FULFILLED:      '🏦',
  ESCROW_WITHDRAWAL_REJECTED:       '🚫',
  GRADE_CHANGED:                    '🎓',
  BULK_ANNOUNCEMENT:                '📢',
  LINK_REQUEST_RECEIVED:            '🔗',
  LINK_DECISION:                    '🔗',
  PREREGISTRATION_HELD:             '⏸️',
  TIMETABLE_PUBLISHED:              '🗓️',
  COVER_ASSIGNED:                   '🧑‍🏫',
  LESSON_COVERED:                   '🔁',
  LESSON_CANCELLED:                 '🚫',
  LEAVE_REQUESTED:                  '🚪',
  LEAVE_APPROVED:                   '✅',
  LEAVE_REJECTED:                   '❌',
  LEAVE_CANCELLED:                  '↩️',
  LEAVE_CHECKED_OUT:                '🚶',
  LEAVE_RETURNED:                   '🏫',
  LEAVE_NO_SHOW:                    '⏰',
  LEAVE_LATE_RETURN:                '⏰',
  LEAVE_LESSON_MISSED:              '🚪',
  LEAVE_COLLECTOR_REQUESTED:        '🪪',
  LEAVE_COLLECTOR_DECIDED:          '🪪',
  LEAVE_CUSTODY_ALERT:              '⚠️',
};

// ─── Admin bulk announcement recipient groups ─────────────────────────────────

export const ANNOUNCEMENT_RECIPIENT_GROUPS = [
  'all',
  'students',
  'parents',
  'grade_10',
  'grade_11',
  'grade_12',
] as const;

export const AnnouncementRecipientGroupSchema = z.enum(ANNOUNCEMENT_RECIPIENT_GROUPS);
export type AnnouncementRecipientGroup = z.infer<typeof AnnouncementRecipientGroupSchema>;

export const ANNOUNCEMENT_RECIPIENT_LABELS: Record<AnnouncementRecipientGroup, string> = {
  all:      'All Users',
  students: 'All Students',
  parents:  'All Parents',
  grade_10: 'Grade 10 Students',
  grade_11: 'Grade 11 Students',
  grade_12: 'Grade 12 Students',
};

// ─── Param Validation ─────────────────────────────────────────────────────────

export const NotificationId = z.object({
  id: z.string().min(1, 'Invalid notification ID'),
});
export type NotificationIdType = z.infer<typeof NotificationId>;

// ─── Query Filters ────────────────────────────────────────────────────────────

export const GetNotificationsQuery = z.object({
  unreadOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10) || 50, 100) : 50)),
  offset: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) || 0 : 0)),
});
export type GetNotificationsQueryType = z.infer<typeof GetNotificationsQuery>;

// ─── Admin: Bulk Announcement ─────────────────────────────────────────────────

/**
 * Admin composes a bulk announcement to a selected recipient group (NOT-011).
 * sendEmail: true sends both in-app notification AND email.
 * scheduledAt: optional future date to schedule the announcement instead of sending immediately.
 *   - If omitted or in the past, the announcement is sent immediately (current behavior).
 *   - If in the future, the announcement is stored and dispatched by the session-closer cron
 *     when the scheduled time arrives.
 */
export const BulkAnnouncement = z.object({
  title:       z.string().min(3, 'Title must be at least 3 characters').max(150),
  body:        z.string().min(10, 'Body must be at least 10 characters').max(2000),
  recipients:  AnnouncementRecipientGroupSchema,
  sendEmail:   z.boolean().default(true),
  scheduledAt: z.coerce.date().optional(),
});
export type BulkAnnouncementType = z.infer<typeof BulkAnnouncement>;
