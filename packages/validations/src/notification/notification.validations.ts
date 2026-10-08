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
  // Reservations rework: a line re-priced when the board confirmed its fee, or moved
  'PRICE_CHANGED',
  // Reservations rework, step C: a charge added or pushed, or what happened to it; a plan's news
  'CHARGE_ADDED',
  'CHARGE_UPDATED',
  'PLAN_UPDATED',
  // Step B: the school's answer to a declared sitting (a retake or a carry-forward)
  'DECLARATION_REVIEWED',
  // Reservations rework: a moved line whose price stayed but is now to be confirmed
  'PRICE_TO_BE_CONFIRMED',
  // Step D (messages and reminders): a message from the school to chosen people or a list, a
  // payment or school-fee reminder, a reminder to staff. A broadcast stays BULK_ANNOUNCEMENT and
  // a closing reminder SESSION_CLOSING_SOON, as families have always received them.
  'SCHOOL_MESSAGE',
  'PAYMENT_REMINDER',
  'STAFF_REMINDER',
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
  PRICE_CHANGED:                    'Price Changed',
  CHARGE_ADDED:                     'New Charge',
  CHARGE_UPDATED:                   'Charge Updated',
  PLAN_UPDATED:                     'Instalment Plan',
  DECLARATION_REVIEWED:             'Declared Sitting Reviewed',
  PRICE_TO_BE_CONFIRMED:            'Price To Be Confirmed',
  SCHOOL_MESSAGE:                   'Message from the School',
  PAYMENT_REMINDER:                 'Payment Reminder',
  STAFF_REMINDER:                   'Reminder',
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
  PRICE_CHANGED:                    '💱',
  CHARGE_ADDED:                     '🧾',
  CHARGE_UPDATED:                   '🧾',
  PLAN_UPDATED:                     '🗓️',
  DECLARATION_REVIEWED:             '🔎',
  PRICE_TO_BE_CONFIRMED:            '💱',
  SCHOOL_MESSAGE:                   '✉️',
  PAYMENT_REMINDER:                 '⏰',
  STAFF_REMINDER:                   '📌',
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

// The admin's bulk announcement form (NOT-011) and its scheduled queue were replaced by messages
// (step D, RESERVATIONS_REWORK.md §3.8): /v1/messages. The recipient groups above stay as the
// names the old announcements were sent under; the backfill (0051) maps them onto audiences.
