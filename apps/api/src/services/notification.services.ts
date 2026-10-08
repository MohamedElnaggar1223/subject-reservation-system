/**
 * Notification Service
 *
 * Manages in-app notifications and triggers email delivery for all
 * user-facing events (NOT-001 to NOT-011).
 *
 * Design principles:
 * - `createNotification` is the core primitive — all other functions call it.
 * - Email sending is fire-and-forget; failures are logged but never throw
 *   so a broken email config cannot crash a critical operation.
 * - Parent auto-CC (NOT-010) is handled by the `notifyParentsOfStudent` helper,
 *   which is called by every trigger that involves a student's action.
 * - Messages and reminders (step D) write these same notification rows through
 *   message.services.ts, with a delivery row per recipient and channel.
 *
 * Integration: import the relevant exported trigger function into the
 * service that performs the action (registration, payment, escrow, swap).
 */

import {
  db,
  notification,
  user,
  parentStudentLink,
  eq,
  isNull,
  and,
  or,
  desc,
  inArray,
  sql,
  gradeTodaySql,
} from '@repo/db';
import { randomUUID } from 'crypto';
import type { NotificationType } from '@repo/validations';
import {
  sendSessionOpenedEmail,
  sendSessionClosingSoonEmail,
  sendSessionClosedEmail,
  sendRegistrationRequestReceivedEmail,
  sendDirectRegistrationEmail,
  sendRegistrationDecisionEmail,
  sendPaymentReceiptEmail,
  sendPaymentReversedEmail,
  sendPaymentRejectedEmail,
  sendPaymentNoticeEmail,
  sendDropSwapRequestEmail,
  sendDropSwapProcessedEmail,
  sendDirectDropSwapEmail,
  sendEscrowBalanceChangedEmail,
  sendWithdrawalFulfilledEmail,
  sendGradeChangedEmail,
  sendLinkRequestEmail,
  sendLinkDecisionEmail,
} from '../integrations/email';
import { gradeLabel } from '@repo/validations';
import { schoolDate, schoolDateTime } from './window.services';

// ─── Core Primitives ──────────────────────────────────────────────────────────

/**
 * Return IDs of users who should receive broadcast notifications.
 *
 * Excludes:
 * - banned accounts (URD NOT-001/011 talk about "active" users)
 * - accounts that haven't completed role setup (role IS NULL or role='user')
 *
 * Used by session-opened/closed/reminder blasts and bulk announcements so
 * that incomplete sign-ups and revoked accounts don't get spammed.
 */
export async function getBroadcastRecipientIds(
  roles: ('student' | 'parent' | 'admin')[],
): Promise<string[]> {
  if (roles.length === 0) return [];
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        inArray(user.role, roles),
        or(eq(user.banned, false), isNull(user.banned)),
      )
    );
  return rows.map((r) => r.id);
}

/** Convenience: return IDs of active students and parents for broadcasts. */
export async function getStudentAndParentBroadcastIds(): Promise<{
  studentIds: string[];
  parentIds: string[];
}> {
  const rows = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(
      and(
        inArray(user.role, ['student', 'parent']),
        or(eq(user.banned, false), isNull(user.banned)),
      )
    );
  return {
    studentIds: rows.filter((r) => r.role === 'student').map((r) => r.id),
    parentIds: rows.filter((r) => r.role === 'parent').map((r) => r.id),
  };
}

/**
 * Creates a single in-app notification for one user.
 * Returns the created notification record.
 */
export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  const [created] = await db
    .insert(notification)
    .values({
      id: randomUUID(),
      userId,
      type,
      title,
      body,
      data: data ?? null,
    })
    .returning();

  return created;
}

/**
 * Creates in-app notifications for multiple users in one batch.
 * All users receive the same title, body, and data payload.
 */
export async function createBulkNotifications(
  userIds: string[],
  type: NotificationType,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  if (userIds.length === 0) return [];

  const rows = userIds.map((userId) => ({
    id: randomUUID(),
    userId,
    type,
    title,
    body,
    data: data ?? null,
  }));

  const created = await db.insert(notification).values(rows).returning();
  return created;
}

// ─── Read Operations ──────────────────────────────────────────────────────────

/** Returns paginated notifications for a user, newest first. */
export async function getUserNotifications(
  userId: string,
  options: { unreadOnly?: boolean; limit?: number; offset?: number } = {}
) {
  const { unreadOnly = false, limit = 50, offset = 0 } = options;

  const conditions = [eq(notification.userId, userId)];
  if (unreadOnly) {
    conditions.push(isNull(notification.readAt));
  }

  const rows = await db
    .select()
    .from(notification)
    .where(and(...conditions))
    .orderBy(desc(notification.createdAt))
    .limit(limit)
    .offset(offset);

  return rows;
}

/** Returns the count of unread notifications for a user (used for badge display). */
export async function getUnreadCount(userId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)));

  return result?.count ?? 0;
}

// ─── Write Operations ─────────────────────────────────────────────────────────

/**
 * Marks a single notification as read.
 * Validates that the notification belongs to the requesting user.
 * Returns null if not found or not owned.
 */
export async function markAsRead(notificationId: string, userId: string) {
  const [updated] = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.id, notificationId),
        eq(notification.userId, userId),
        isNull(notification.readAt)
      )
    )
    .returning();

  return updated ?? null;
}

/**
 * Marks ALL unread notifications for a user as read in one update.
 */
export async function markAllAsRead(userId: string) {
  await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)));
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Fetches user details (name, email) for use in notification payloads.
 * Returns null if user is not found.
 */
async function getUserDetails(userId: string) {
  const [found] = await db.select().from(user).where(eq(user.id, userId));
  return found ?? null;
}

/**
 * Fetches all confirmed parent links for a given student.
 * Used to implement NOT-010 (parent auto-CC on all child-related actions).
 */
async function getLinkedParents(studentId: string) {
  return db
    .select({ parentId: parentStudentLink.parentId })
    .from(parentStudentLink)
    .where(
      and(
        eq(parentStudentLink.studentId, studentId),
        eq(parentStudentLink.status, 'approved')
      )
    );
}

/**
 * Fire-and-forget email wrapper.
 * Logs failures but never throws — email issues must not disrupt core operations.
 * When notificationIds are provided, marks emailSentAt on success.
 */
async function fireEmail<T>(label: string, fn: () => Promise<T>, notificationIds?: string[]): Promise<void> {
  try {
    await fn();
    if (notificationIds && notificationIds.length > 0) {
      await db
        .update(notification)
        .set({ emailSentAt: new Date() })
        .where(inArray(notification.id, notificationIds))
        .catch((err) => console.error(`[notification:email] Failed to update emailSentAt:`, err));
    }
  } catch (err) {
    console.error(`[notification:email] Failed to send ${label}:`, err);
  }
}

/**
 * Send an individual email to every in-app notification just created by a
 * bulk blast, and update each row's `emailSentAt` as its email goes out.
 *
 * Used by session-wide broadcasts (NOT-001, NOT-002, SESSION_CLOSED) so
 * the admin notification viewer can distinguish between "email delivered"
 * and "email skipped/failed" rows. Individual send failures don't block
 * the rest of the batch — each row's emailSentAt is only touched on success.
 *
 * The `createdNotifications` array comes straight from
 * createBulkNotifications; each row has `{ id, userId }` so we can route
 * the email to the right user without a second DB round-trip.
 */
async function fanOutBlastEmail<Row extends { id: string; userId: string }>(
  label: string,
  createdNotifications: Row[],
  userLookup: Map<string, { email: string | null; name: string }>,
  buildAndSend: (to: string, recipient: { name: string }) => Promise<unknown>,
): Promise<void> {
  const successfullySent: string[] = [];
  for (const n of createdNotifications) {
    const recipient = userLookup.get(n.userId);
    if (!recipient?.email) continue;
    try {
      await buildAndSend(recipient.email, { name: recipient.name });
      successfullySent.push(n.id);
    } catch (err) {
      console.error(`[notification:email] Failed to send ${label} to ${recipient.email}:`, err);
    }
  }
  if (successfullySent.length > 0) {
    await db
      .update(notification)
      .set({ emailSentAt: new Date() })
      .where(inArray(notification.id, successfullySent))
      .catch((err) => console.error(`[notification:email] Failed to update emailSentAt for ${label} batch:`, err));
  }
}

// ─── Notification Triggers ────────────────────────────────────────────────────

/**
 * NOT-001: Registration window opened.
 * Called from the session scheduler when a session becomes active.
 * Fan-out: notifies all active students and parents.
 *
 * @param studentIds - IDs of all active students
 * @param parentIds  - IDs of all active parents
 */
export async function notifySessionOpened(data: {
  sessionId: string;
  sessionName: string;
  sessionType: string;
  deadline: Date;
  studentIds: string[];
  parentIds: string[];
}) {
  const deadline = data.deadline.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const allUserIds = [...data.studentIds, ...data.parentIds];
  const title = `Registration Open — ${data.sessionName}`;
  const body = `The registration window for ${data.sessionName} (${data.sessionType}) is now open. Deadline: ${deadline}.`;

  const created = await createBulkNotifications(allUserIds, 'SESSION_OPENED', title, body, {
    sessionId: data.sessionId,
  });

  // Look up email/name once and drive per-user sends so emailSentAt is
  // tracked accurately per recipient (M-17).
  const recipients = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(inArray(user.id, allUserIds));
  const userLookup = new Map(recipients.map((u) => [u.id, { email: u.email, name: u.name }]));

  fanOutBlastEmail('SESSION_OPENED', created, userLookup, (to, r) =>
    sendSessionOpenedEmail(to, {
      recipientName: r.name,
      sessionName: data.sessionName,
      sessionType: data.sessionType,
      deadline,
    }),
  ).catch((err) => console.error('[notification] SESSION_OPENED fan-out failed:', err));
}

/**
 * NOT-002: Registration window closing soon (24-hour reminder).
 * Called from the session scheduler ~24 hours before deadline.
 */
export async function notifySessionClosingSoon(data: {
  sessionId: string;
  sessionName: string;
  deadline: Date;
  studentIds: string[];
  parentIds: string[];
}) {
  const deadline = data.deadline.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const allUserIds = [...data.studentIds, ...data.parentIds];
  const title = `Reminder: ${data.sessionName} closes in 24 hours`;
  const body = `Registration for ${data.sessionName} closes on ${deadline}. Make sure your registration is complete.`;

  const created = await createBulkNotifications(allUserIds, 'SESSION_CLOSING_SOON', title, body, {
    sessionId: data.sessionId,
  });

  const recipients = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(inArray(user.id, allUserIds));
  const userLookup = new Map(recipients.map((u) => [u.id, { email: u.email, name: u.name }]));

  fanOutBlastEmail('NOT-002', created, userLookup, (to, r) =>
    sendSessionClosingSoonEmail(to, {
      recipientName: r.name,
      sessionName: data.sessionName,
      deadline,
    }),
  ).catch((err) => console.error('[notification] NOT-002 fan-out failed:', err));
}

/**
 * Session closed notification.
 * Called from session-closer (auto-close) and session routes (manual close).
 */
export async function notifySessionClosed(data: {
  sessionId: string;
  sessionName: string;
  reason?: string;
  studentIds: string[];
  parentIds: string[];
}) {
  const allUserIds = [...data.studentIds, ...data.parentIds];
  const title = `Registration Closed — ${data.sessionName}`;
  const body = data.reason
    ? `The registration window for ${data.sessionName} has been closed. Reason: ${data.reason}`
    : `The registration window for ${data.sessionName} has been closed.`;

  const created = await createBulkNotifications(allUserIds, 'SESSION_CLOSED', title, body, {
    sessionId: data.sessionId,
    closed: true,
  });

  const recipients = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(inArray(user.id, allUserIds));
  const userLookup = new Map(recipients.map((u) => [u.id, { email: u.email, name: u.name }]));

  fanOutBlastEmail('SESSION_CLOSED', created, userLookup, (to, r) =>
    sendSessionClosedEmail(to, {
      recipientName: r.name,
      sessionName: data.sessionName,
      reason: data.reason,
    }),
  ).catch((err) => console.error('[notification] SESSION_CLOSED fan-out failed:', err));
}

/**
 * NOT-003: Parent notified when child submits a registration request.
 * Called from registration.services.ts → requestRegistration().
 */
export async function notifyRegistrationRequestReceived(data: {
  studentId: string;
  studentName: string;
  sessionName: string;
  subjects: { name: string; price: number }[];
  totalCost: number;
}) {
  const parents = await getLinkedParents(data.studentId);
  if (parents.length === 0) return;

  const title = `Action Required: ${data.studentName} submitted a registration request`;
  const body = `${data.studentName} has requested to register ${data.subjects.length} subject(s) for ${data.sessionName}. Total: EGP ${data.totalCost.toFixed(2)}. Your approval is needed.`;
  const notifData = {
    studentId: data.studentId,
    sessionName: data.sessionName,
    subjectCount: data.subjects.length,
    totalCost: data.totalCost,
  };

  const created = await createBulkNotifications(
    parents.map((p) => p.parentId),
    'REGISTRATION_REQUEST_RECEIVED',
    title,
    body,
    notifData
  );

  // Email parents
  for (const { parentId } of parents) {
    const parentUser = await getUserDetails(parentId);
    if (!parentUser?.email) continue;

    const matchingNotif = created.find((n) => n.userId === parentId);
    fireEmail('NOT-003 to parent', () =>
      sendRegistrationRequestReceivedEmail(parentUser.email!, {
        parentName: parentUser.name,
        studentName: data.studentName,
        sessionName: data.sessionName,
        subjects: data.subjects,
        totalCost: data.totalCost,
      }),
      matchingNotif ? [matchingNotif.id] : undefined
    );
  }
}

/**
 * REG-003: Student notified when their parent directly registers subjects
 * for them. Unlike the student-initiated flow there's no approval needed —
 * this is an informational "your parent did X for you" email + in-app.
 */
export async function notifyDirectRegistrationCreated(data: {
  studentId: string;
  parentId: string;
  sessionName: string;
  subjects: { name: string; price: number }[];
  totalCost: number;
}) {
  const [studentUser, parentUser] = await Promise.all([
    getUserDetails(data.studentId),
    getUserDetails(data.parentId),
  ]);
  if (!studentUser) return;

  const parentName = parentUser?.name ?? 'Your parent';
  const subjectNames = data.subjects.map((s) => s.name).join(', ');
  const title = `${parentName} registered subjects for you`;
  const body = `${parentName} has registered the following subjects for you in ${data.sessionName}: ${subjectNames}. Total: EGP ${data.totalCost.toFixed(2)}. Payment is now pending.`;

  const created = await createNotification(
    data.studentId,
    'REGISTRATION_REQUEST_RECEIVED',
    title,
    body,
    {
      sessionName: data.sessionName,
      subjectCount: data.subjects.length,
      totalCost: data.totalCost,
      parentInitiated: true,
    },
  );

  if (studentUser.email) {
    fireEmail('REG-003 direct to student', () =>
      sendDirectRegistrationEmail(studentUser.email!, {
        studentName: studentUser.name,
        parentName,
        sessionName: data.sessionName,
        subjects: data.subjects,
        totalCost: data.totalCost,
      }),
      created ? [created.id] : undefined
    );
  }
}

/**
 * NOT-004: Student notified when their registration request is approved or rejected.
 * Called from registration.services.ts → approveRegistration() / rejectRegistration().
 */
export async function notifyRegistrationDecision(data: {
  studentId: string;
  parentId: string;
  sessionName: string;
  approved: boolean;
  comments?: string;
}) {
  const [studentUser, parentUser] = await Promise.all([
    getUserDetails(data.studentId),
    getUserDetails(data.parentId),
  ]);

  if (!studentUser) return;

  const decision = data.approved ? 'approved' : 'rejected';
  const title = `Registration request ${decision}`;
  const body = data.approved
    ? `Your registration request for ${data.sessionName} was approved by ${parentUser?.name ?? 'your parent'}. Payment can now be completed.`
    : `Your registration request for ${data.sessionName} was rejected by ${parentUser?.name ?? 'your parent'}.${data.comments ? ` Reason: ${data.comments}` : ''}`;

  const created = await createNotification(
    data.studentId,
    data.approved ? 'REGISTRATION_APPROVED' : 'REGISTRATION_REJECTED',
    title,
    body,
    { sessionName: data.sessionName, approved: data.approved },
  );

  // NOT-010: CC linked parents on registration decision
  const parents = await getLinkedParents(data.studentId);
  if (parents.length > 0) {
    const parentTitle = `Registration ${decision} for ${studentUser.name}`;
    const parentBody = data.approved
      ? `${studentUser.name}'s registration request for ${data.sessionName} was approved. Payment can now be completed.`
      : `${studentUser.name}'s registration request for ${data.sessionName} was rejected.${data.comments ? ` Reason: ${data.comments}` : ''}`;

    await createBulkNotifications(
      parents.map((p) => p.parentId),
      data.approved ? 'REGISTRATION_APPROVED' : 'REGISTRATION_REJECTED',
      parentTitle,
      parentBody,
      { sessionName: data.sessionName, approved: data.approved },
    );
  }

  if (studentUser.email) {
    fireEmail('NOT-004 to student', () =>
      sendRegistrationDecisionEmail(studentUser.email!, {
        studentName: studentUser.name,
        sessionName: data.sessionName,
        approved: data.approved,
        parentName: parentUser?.name ?? 'Your parent',
        comments: data.comments,
      }),
      created ? [created.id] : undefined
    );
  }
}

/**
 * NOT-005: Parent receives payment receipt after registration is confirmed.
 * Called from payment.services.ts → confirmPayment().
 */
export async function notifyPaymentConfirmed(data: {
  studentId: string;
  parentId: string;
  sessionName: string;
  amount: number;
  method: string;
  paymentId: string;
  subjects: string[];
  /**
   * Optional PDF receipt buffer — when provided, attached to the parent's
   * confirmation email (NOT-005 / PAY-006). The payment service generates
   * it after confirmation succeeds and hands it in here so we don't build
   * the PDF twice (once for the /receipt endpoint, once for the email).
   */
  receiptPdf?: Buffer;
}) {
  const [studentUser, parentUser] = await Promise.all([
    getUserDetails(data.studentId),
    getUserDetails(data.parentId),
  ]);

  if (!parentUser) return;

  const title = `Payment confirmed — ${data.sessionName}`;
  const body = `Payment of EGP ${data.amount.toFixed(2)} via ${data.method} has been confirmed for ${studentUser?.name ?? 'your child'}'s registration.`;
  const notifData = {
    paymentId: data.paymentId,
    studentId: data.studentId,
    sessionName: data.sessionName,
    amount: data.amount,
  };

  // Notify parent
  const parentNotif = await createNotification(data.parentId, 'PAYMENT_CONFIRMED', title, body, notifData);

  // Also notify the student that payment was confirmed
  if (studentUser) {
    const studentTitle = `Payment confirmed — ${data.sessionName}`;
    const studentBody = `Payment of EGP ${data.amount.toFixed(2)} via ${data.method} has been confirmed for your registration in ${data.sessionName}. Your subjects are now fully registered.`;
    await createNotification(data.studentId, 'PAYMENT_CONFIRMED', studentTitle, studentBody, notifData);
  }

  if (parentUser.email) {
    fireEmail('NOT-005 to parent', () =>
      sendPaymentReceiptEmail(parentUser.email!, {
        parentName: parentUser.name,
        studentName: studentUser?.name ?? 'your child',
        sessionName: data.sessionName,
        amount: data.amount,
        method: data.method,
        paymentId: data.paymentId,
        subjects: data.subjects,
        receiptPdf: data.receiptPdf,
      }),
      parentNotif ? [parentNotif.id] : undefined
    );
  }
}

/**
 * RF-08: a reversal re-opens the registration and voids any receipt still at
 * the desk, so the family must hear about it. Every approved linked parent
 * and the student are notified; parents also get an email.
 * Called from payment.services.ts → reversePayment().
 */
export async function notifyPaymentReversed(data: {
  studentId: string;
  paymentId: string;
  amount: number;
  reason: string;
  /** MO-11: the money was handed back, or the confirmation was a mistake and none had been received. */
  moneyReturned: boolean;
  /** The series' board deadline has passed: the subjects cannot be paid for again. */
  pastEntryDeadline?: boolean;
  voidedReceiptNumbers: string[];
  registrationsReverted: number;
}) {
  const [studentUser, parents] = await Promise.all([
    getUserDetails(data.studentId),
    getLinkedParents(data.studentId),
  ]);
  const studentName = studentUser?.name ?? 'your child';
  const n = data.voidedReceiptNumbers.length;
  const receiptNote = n > 0
    ? ` Receipt${n === 1 ? '' : 's'} ${data.voidedReceiptNumbers.join(', ')} ${n === 1 ? 'is' : 'are'} no longer valid.`
    : '';
  const moneyNote = data.moneyReturned
    ? ' The money was returned to you.'
    : ' It had been recorded by mistake: no money was received for it.';
  const title = 'Payment reversed';
  const body =
    `The finance office reversed a payment of EGP ${data.amount.toFixed(2)} for ${studentName} (${data.reason}).${moneyNote} ` +
    (data.pastEntryDeadline
      ? `The exam board's entry deadline for this series has passed, so ${data.registrationsReverted === 1 ? 'this subject' : 'these subjects'} can no longer be entered.${receiptNote}`
      : `${data.registrationsReverted} registration${data.registrationsReverted === 1 ? ' is' : 's are'} back to pending payment.${receiptNote} ` +
        `Please settle again at the finance desk.`);
  const notifData = {
    paymentId: data.paymentId,
    studentId: data.studentId,
    amount: data.amount,
    voidedReceiptNumbers: data.voidedReceiptNumbers,
  };

  for (const { parentId } of parents) {
    const parentUser = await getUserDetails(parentId);
    const created = await createNotification(parentId, 'PAYMENT_REVERSED', title, body, notifData);
    if (parentUser?.email) {
      fireEmail('RF-08 reversal to parent', () =>
        sendPaymentReversedEmail(parentUser.email!, {
          parentName: parentUser.name,
          studentName,
          amount: data.amount,
          reason: data.reason,
          voidedReceiptNumbers: data.voidedReceiptNumbers,
          registrationsReverted: data.registrationsReverted,
        }),
        created ? [created.id] : undefined
      );
    }
  }

  if (studentUser) {
    await createNotification(data.studentId, 'PAYMENT_REVERSED', title, body, notifData);
  }
}

/**
 * Money audit MA-03: finance rejected an open payment (a reference that is
 * not on the bank statement, or an abandoned checkout). Parents get the
 * notification and an email; the student gets the notification.
 * Called from payment.services.ts → rejectPayment().
 */
export async function notifyPaymentRejected(data: {
  studentId: string;
  paymentId: string;
  amount: number;
  escrowReturned: number;
  reason: string;
  registrationsExpired: number;
}) {
  const [studentUser, parents] = await Promise.all([
    getUserDetails(data.studentId),
    getLinkedParents(data.studentId),
  ]);
  const studentName = studentUser?.name ?? 'your child';
  const escrowNote = data.escrowReturned > 0
    ? ` EGP ${data.escrowReturned.toFixed(2)} applied from escrow has been returned.`
    : '';
  const next = data.registrationsExpired > 0
    ? 'The registration window has closed, so these subjects are no longer reserved; if you did send the transfer, contact the finance desk with your bank receipt.'
    : 'The subjects are still waiting for payment; if you did send the transfer, contact the finance desk with your bank receipt.';
  const title = 'Payment not received';
  const body =
    `The finance office could not match a payment of EGP ${data.amount.toFixed(2)} for ${studentName} (${data.reason}).` +
    `${escrowNote} ${next}`;
  const notifData = { paymentId: data.paymentId, studentId: data.studentId, amount: data.amount, escrowReturned: data.escrowReturned };

  for (const { parentId } of parents) {
    const parentUser = await getUserDetails(parentId);
    const created = await createNotification(parentId, 'PAYMENT_REJECTED', title, body, notifData);
    if (parentUser?.email) {
      fireEmail('MA-03 rejection to parent', () =>
        sendPaymentRejectedEmail(parentUser.email!, {
          parentName: parentUser.name,
          studentName,
          amount: data.amount,
          escrowReturned: data.escrowReturned,
          reason: data.reason,
          registrationsExpired: data.registrationsExpired,
        }),
        created ? [created.id] : undefined
      );
    }
  }

  if (studentUser) {
    await createNotification(data.studentId, 'PAYMENT_REJECTED', title, body, notifData);
  }
}

/**
 * Owner decision MO-10: payment notices about the time left, or run out,
 * after a window closes. Parents get the notification and an email; the
 * student gets the notification.
 */
async function notifyFamilyOfPayment(
  paymentId: string,
  type: 'PAYMENT_REFERENCE_DUE' | 'PAYMENT_EXPIRED' | 'PAYMENT_REJECTED',
  title: string,
  body: (ctx: { studentName: string; amount: string; subjects: string; sessionName: string }) => string
) {
  const pay = await db.query.payment.findFirst({
    where: (p, { eq: eqOp }) => eqOp(p.id, paymentId),
    columns: { id: true, studentId: true, amount: true, escrowAmountApplied: true, referenceDueAt: true },
    with: {
      paymentRegistrations: {
        with: { registration: { with: { subject: { columns: { name: true } }, session: { columns: { name: true } } } } },
      },
    },
  });
  if (!pay) return;
  const [studentUser, parents] = await Promise.all([getUserDetails(pay.studentId), getLinkedParents(pay.studentId)]);
  const studentName = studentUser?.name ?? 'your child';
  const text = body({
    studentName,
    amount: `EGP ${(pay.amount + pay.escrowAmountApplied).toFixed(2)}`,
    subjects: pay.paymentRegistrations.map((pr) => pr.registration.subject.name).join(', '),
    sessionName: pay.paymentRegistrations[0]?.registration.session.name ?? 'the session',
  });
  const notifData = { paymentId, studentId: pay.studentId, referenceDueAt: pay.referenceDueAt?.toISOString() ?? null };

  for (const { parentId } of parents) {
    const parentUser = await getUserDetails(parentId);
    const created = await createNotification(parentId, type, title, text, notifData);
    if (parentUser?.email) {
      fireEmail(`MO-10 ${type} to parent`, () =>
        sendPaymentNoticeEmail(parentUser.email!, { parentName: parentUser.name, studentName, title, body: text }),
        created ? [created.id] : undefined
      );
    }
  }
  if (studentUser) await createNotification(pay.studentId, type, title, text, notifData);
}

/** At the close: an InstaPay checkout was kept open for its reference until referenceDueAt. */
export async function notifyPaymentReferenceDue(paymentId: string) {
  const pay = await db.query.payment.findFirst({ where: (p, { eq: eqOp }) => eqOp(p.id, paymentId), columns: { referenceDueAt: true } });
  const due = pay?.referenceDueAt ? schoolDateTime(pay.referenceDueAt) : 'the time allowed';
  await notifyFamilyOfPayment(paymentId, 'PAYMENT_REFERENCE_DUE', 'Submit your InstaPay reference', (c) =>
    `The registration window for ${c.sessionName} has closed. You started an InstaPay payment of ${c.amount} for ${c.studentName} (${c.subjects}). ` +
    `If you have transferred the money, submit the transaction reference by ${due}; the subjects stay reserved until then. ` +
    `If no reference arrives by then, the payment is cancelled and the subjects are released.`
  );
}

/** After the grace period: no reference came, so the checkout lapsed. */
export async function notifyPaymentExpired(paymentId: string, escrowReturned: number) {
  const escrowNote = escrowReturned > 0 ? ` EGP ${escrowReturned.toFixed(2)} applied from escrow has been returned.` : '';
  await notifyFamilyOfPayment(paymentId, 'PAYMENT_EXPIRED', 'InstaPay payment not completed', (c) =>
    `No transfer reference was submitted for the InstaPay payment of ${c.amount} for ${c.studentName} (${c.subjects}) in the time allowed after the ${c.sessionName} window closed, ` +
    `so the payment was cancelled and the subjects were released.${escrowNote} If you did transfer, contact the finance desk with your bank receipt.`
  );
}

/**
 * At the board's entry deadline: an unconfirmed payment was closed
 * automatically. Sent as PAYMENT_EXPIRED ("Payment Not Completed"), not as a
 * rejection — nobody judged the transfer, and if it did arrive finance
 * credits it to escrow once it is found.
 */
export async function notifyPaymentClosedAtEntryDeadline(paymentId: string, entryDeadline: Date, escrowReturned: number) {
  const escrowNote = escrowReturned > 0 ? ` EGP ${escrowReturned.toFixed(2)} applied from escrow has been returned.` : '';
  await notifyFamilyOfPayment(paymentId, 'PAYMENT_EXPIRED', 'Payment closed at the exam board deadline', (c) =>
    `The exam board's entry deadline for ${c.sessionName} (${schoolDate(entryDeadline)}) passed before the payment of ${c.amount} for ${c.studentName} was confirmed, ` +
    `so the payment was closed and its subjects in that series were not entered.${escrowNote} ` +
    `If you did transfer the money, contact the finance desk with your bank receipt: once the transfer is found it is added to your escrow balance, to use or to take back.`
  );
}

/**
 * At the board's entry deadline of a series that never opened (MO-21): its
 * preregistrations will not be entered, and what was paid for them is back
 * in escrow in full — or, for a paper receipt the family holds, once the
 * receipt comes back to the desk.
 */
export async function notifyPreregistrationsRefundedAtDeadline(
  sessionId: string,
  entryDeadline: Date,
  rows: { studentId: string; subjectId: string; refunded: number; gated: boolean }[]
) {
  const [sessionRow, subjects] = await Promise.all([
    db.query.registrationSession.findFirst({ where: (s, { eq: eqOp }) => eqOp(s.id, sessionId), columns: { name: true } }),
    db.query.subject.findMany({
      where: (s, { inArray: inArr }) => inArr(s.id, [...new Set(rows.map((r) => r.subjectId))]),
      columns: { id: true, name: true },
    }),
  ]);
  const nameOf = new Map(subjects.map((s) => [s.id, s.name]));
  const sessionName = sessionRow?.name ?? 'the series';
  const byStudent = new Map<string, typeof rows>();
  for (const r of rows) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r]);
  for (const [studentId, mine] of byStudent) {
    const names = (list: typeof rows) => list.map((r) => nameOf.get(r.subjectId) ?? 'a subject').join(', ');
    const now = mine.filter((r) => r.refunded > 0 && !r.gated);
    const onReturn = mine.filter((r) => r.refunded > 0 && r.gated);
    const total = (list: typeof rows) => list.reduce((s, r) => s + r.refunded, 0).toFixed(2);
    const title = `Refunded: ${sessionName} did not open`;
    const body =
      `The exam board's entry deadline for ${sessionName} (${schoolDate(entryDeadline)}) passed before the school opened registration, ` +
      `so these preregistered subjects will not be entered: ${names(mine)}.` +
      (now.length ? ` EGP ${total(now)} paid for ${names(now)} has been returned to your escrow balance in full.` : '') +
      (onReturn.length ? ` EGP ${total(onReturn)} for ${names(onReturn)} is returned in full once the paper receipt is brought back to the finance desk.` : '');
    const meta = { sessionId, subjectNames: mine.map((r) => nameOf.get(r.subjectId)), reason: 'entry_deadline_unopened' };
    await createNotification(studentId, 'SESSION_CLOSED', title, body, meta);
    for (const { parentId } of await getLinkedParents(studentId)) {
      await createNotification(parentId, 'SESSION_CLOSED', title, body, { ...meta, studentId });
    }
  }
}

/** The recovery sweep closed a payment whose registrations had all expired. */
export async function notifyStrandedPaymentClosed(paymentId: string, escrowReturned: number) {
  const escrowNote = escrowReturned > 0 ? ` EGP ${escrowReturned.toFixed(2)} applied from escrow has been returned.` : '';
  await notifyFamilyOfPayment(paymentId, 'PAYMENT_EXPIRED', 'Payment closed', (c) =>
    `The subjects this payment of ${c.amount} for ${c.studentName} covered (${c.subjects}) are no longer open for registration, so the payment was closed before it was confirmed.${escrowNote} ` +
    `If you did transfer the money, contact the finance desk with your bank receipt: once the transfer is found it is added to your escrow balance.`
  );
}

/**
 * A checkout left open on subjects the student may no longer sit (they left,
 * a cohort or series was corrected, A-12 was turned off, a grade-10
 * exception was revoked; F0a) was closed by the system, any escrow it took
 * returned.
 */
export async function notifyPaymentClosedIneligible(
  paymentId: string,
  escrowReturned: number,
  cause: 'withdrawn' | 'transferred' | 'cohort_corrected' | 'graduate_retakes_off' | 'series_corrected' | 'exception_revoked' | 'exception_lapsed',
) {
  const escrowNote = escrowReturned > 0 ? ` EGP ${escrowReturned.toFixed(2)} applied from escrow has been returned.` : '';
  const because: Record<typeof cause, (name: string) => string> = {
    withdrawn: (n) => `${n} has been withdrawn from the school`,
    transferred: (n) => `${n} has transferred to another school`,
    cohort_corrected: (n) => `${n}'s grade was corrected and they may no longer sit this series`,
    graduate_retakes_off: (n) => `the school no longer registers graduates such as ${n} for this series`,
    series_corrected: (n) => `this registration window's exam series was corrected and ${n} may no longer sit it`,
    exception_revoked: (n) => `${n}'s grade-10 exception for this series was revoked`,
    exception_lapsed: (n) => `${n}'s grade-10 exception for this series ran out`,
  };
  await notifyFamilyOfPayment(paymentId, 'PAYMENT_EXPIRED', 'Payment closed', (c) =>
    `${because[cause](c.studentName)}, so the payment of ${c.amount} for ${c.subjects} (${c.sessionName}) was closed before it was confirmed.${escrowNote} ` +
    `If you did transfer the money, contact the finance desk with your bank receipt: once the transfer is found it is added to your escrow balance.`
  );
}

/**
 * F0a: a paid or unpaid preregistration held at its series' opening because
 * the student may no longer sit the series. Finance and the admin are told:
 * the money stays held and nothing releases it until the owner decides
 * (SO-4) — the family cannot cancel an opened series' preregistration, and
 * after the window closes it stays held.
 */
export async function notifyFinanceOfHeldPreregistration(registrationId: string, heldAmount: number, reason: string) {
  const reg = await db.query.registration.findFirst({
    where: (r, { eq: eqOp }) => eqOp(r.id, registrationId),
    columns: { id: true, studentId: true },
    with: {
      student: { columns: { name: true } },
      subject: { columns: { name: true, code: true } },
      session: { columns: { name: true } },
    },
  });
  if (!reg) return;
  const staff = await db.select({ id: user.id }).from(user)
    .where(and(inArray(user.role, ['finance_officer', 'finance_admin', 'admin']), or(eq(user.banned, false), isNull(user.banned))));
  const money = heldAmount > 0 ? `EGP ${heldAmount.toFixed(2)} stays held in the family's wallet` : 'It was not paid for';
  const title = `Preregistration held: ${reg.student.name}`;
  const body = `${reg.student.name}'s preregistration for ${reg.subject.name} (${reg.subject.code}), ${reg.session.name}, was not confirmed when the series opened: ${reason}. ` +
    `${money}. Nothing releases it until the school decides what to do with it (a refund is the owner's decision); ` +
    `the family cannot cancel it now that the series is open, and after the window closes it stays held.`;
  for (const s of staff) {
    await createNotification(s.id, 'PREREGISTRATION_HELD', title, body, { registrationId, studentId: reg.studentId, heldAmount });
  }
}

/**
 * At the board's entry deadline: registrations still waiting on the series
 * expired. F0b: the deadline is a board series' (`seriesName`), one of the
 * series the window (`sessionId`) feeds.
 */
export async function notifyRegistrationsExpiredAtEntryDeadline(
  sessionId: string,
  entryDeadline: Date,
  expired: { studentId: string; subjectId: string }[],
  seriesName?: string | null,
) {
  const [sessionRow, subjects] = await Promise.all([
    db.query.registrationSession.findFirst({ where: (s, { eq: eqOp }) => eqOp(s.id, sessionId), columns: { name: true } }),
    db.query.subject.findMany({
      where: (s, { inArray: inArr }) => inArr(s.id, [...new Set(expired.map((r) => r.subjectId))]),
      columns: { id: true, name: true },
    }),
  ]);
  const nameOf = new Map(subjects.map((s) => [s.id, s.name]));
  const byStudent = new Map<string, string[]>();
  for (const r of expired) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), nameOf.get(r.subjectId) ?? 'a subject']);
  const sessionName = sessionRow?.name ?? 'the series';
  for (const [studentId, names] of byStudent) {
    const title = `Not entered for ${sessionName}`;
    const body = seriesName
      ? `The exam board's entry deadline for ${seriesName} (${schoolDate(entryDeadline)}) has passed, so these subjects registered in ${sessionName} were not entered: ${names.join(', ')}.`
      : `The exam board's entry deadline for ${sessionName} (${schoolDate(entryDeadline)}) has passed, so these subjects were not entered: ${names.join(', ')}.`;
    await createNotification(studentId, 'SESSION_CLOSED', title, body, { sessionId, subjectNames: names, reason: 'entry_deadline' });
    for (const { parentId } of await getLinkedParents(studentId)) {
      await createNotification(parentId, 'SESSION_CLOSED', title, body, { sessionId, studentId, subjectNames: names, reason: 'entry_deadline' });
    }
  }
}

/**
 * NOT-006: Parent notified when child requests a subject drop or swap.
 * Called from swap.services.ts → createDropRequest() / createSwapRequest().
 */
export async function notifyDropSwapRequestReceived(data: {
  studentId: string;
  studentName: string;
  changeType: 'drop' | 'swap';
  subjectName: string;
  newSubjectName?: string;
  financialImpact: string;
  reason?: string;
  changeRequestId: string;
}) {
  const parents = await getLinkedParents(data.studentId);
  if (parents.length === 0) return;

  const verb = data.changeType === 'drop' ? 'drop' : 'swap';
  const title = `Action Required: ${data.studentName} requested a subject ${verb}`;
  const body = `${data.studentName} has requested to ${verb} ${data.subjectName}${data.newSubjectName ? ` for ${data.newSubjectName}` : ''}. Financial impact: ${data.financialImpact}.`;
  const notifData = {
    changeRequestId: data.changeRequestId,
    studentId: data.studentId,
    changeType: data.changeType,
  };

  const created = await createBulkNotifications(
    parents.map((p) => p.parentId),
    'DROP_SWAP_REQUEST_RECEIVED',
    title,
    body,
    notifData
  );

  for (const { parentId } of parents) {
    const parentUser = await getUserDetails(parentId);
    if (!parentUser?.email) continue;

    const matchingNotif = created.find((n) => n.userId === parentId);
    fireEmail('NOT-006 to parent', () =>
      sendDropSwapRequestEmail(parentUser.email!, {
        parentName: parentUser.name,
        studentName: data.studentName,
        changeType: data.changeType,
        subjectName: data.subjectName,
        newSubjectName: data.newSubjectName,
        financialImpact: data.financialImpact,
        reason: data.reason,
      }),
      matchingNotif ? [matchingNotif.id] : undefined
    );
  }
}

/**
 * NOT-007: Student notified when their drop/swap request is processed.
 * Called from swap.services.ts → approveChangeRequest() / rejectChangeRequest().
 */
export async function notifyDropSwapProcessed(data: {
  studentId: string;
  parentId: string;
  changeType: 'drop' | 'swap';
  subjectName: string;
  newSubjectName?: string;
  approved: boolean;
  financialImpact: string;
  comments?: string;
  changeRequestId: string;
}) {
  const [studentUser, parentUser] = await Promise.all([
    getUserDetails(data.studentId),
    getUserDetails(data.parentId),
  ]);

  if (!studentUser) return;

  const decision = data.approved ? 'approved' : 'rejected';
  const title = `Your ${data.changeType} request was ${decision}`;
  const body = `Your request to ${data.changeType} ${data.subjectName}${data.newSubjectName ? ` for ${data.newSubjectName}` : ''} was ${decision}. ${data.financialImpact}`;

  const created = await createNotification(data.studentId, 'DROP_SWAP_PROCESSED', title, body, {
    changeRequestId: data.changeRequestId,
    approved: data.approved,
  });

  // NOT-010: CC linked parents on drop/swap decision
  const parents = await getLinkedParents(data.studentId);
  if (parents.length > 0) {
    const parentTitle = `${studentUser.name}'s ${data.changeType} request was ${decision}`;
    const parentBody = `${studentUser.name}'s request to ${data.changeType} ${data.subjectName}${data.newSubjectName ? ` for ${data.newSubjectName}` : ''} was ${decision}. ${data.financialImpact}`;
    await createBulkNotifications(
      parents.map((p) => p.parentId),
      'DROP_SWAP_PROCESSED',
      parentTitle,
      parentBody,
      { changeRequestId: data.changeRequestId, approved: data.approved },
    );
  }

  if (studentUser.email) {
    fireEmail('NOT-007 to student', () =>
      sendDropSwapProcessedEmail(studentUser.email!, {
        studentName: studentUser.name,
        changeType: data.changeType,
        subjectName: data.subjectName,
        newSubjectName: data.newSubjectName,
        approved: data.approved,
        parentName: parentUser?.name ?? 'Your parent',
        financialImpact: data.financialImpact,
        comments: data.comments,
      }),
      created ? [created.id] : undefined
    );
  }
}

/**
 * NOT-007 (SWAP-004 variant): Student notified when a parent directly
 * drops or swaps a subject on their behalf. The change-request variant
 * (notifyDropSwapProcessed) reports an approval decision on a student-
 * initiated request; this variant is informational — the parent acted
 * directly. Also emails the student so SWAP-004's "Child receives email
 * notification of changes" requirement is met.
 */
export async function notifyDirectDropSwapExecuted(data: {
  studentId: string;
  parentId: string;
  changeType: 'drop' | 'swap';
  subjectName: string;
  newSubjectName?: string;
  financialImpact: string;
}) {
  const [studentUser, parentUser] = await Promise.all([
    getUserDetails(data.studentId),
    getUserDetails(data.parentId),
  ]);

  if (!studentUser) return;

  const parentName = parentUser?.name ?? 'Your parent';
  const verb = data.changeType === 'drop' ? 'dropped' : 'swapped';
  const title = `${parentName} ${verb} a subject for you`;
  const body = data.newSubjectName
    ? `${parentName} swapped ${data.subjectName} for ${data.newSubjectName} on your behalf. ${data.financialImpact}`
    : `${parentName} dropped ${data.subjectName} on your behalf. ${data.financialImpact}`;

  const created = await createNotification(data.studentId, 'DROP_SWAP_PROCESSED', title, body, {
    changeType: data.changeType,
    subjectName: data.subjectName,
    newSubjectName: data.newSubjectName,
    parentInitiated: true,
  });

  if (studentUser.email) {
    fireEmail('NOT-007 direct to student', () =>
      sendDirectDropSwapEmail(studentUser.email!, {
        studentName: studentUser.name,
        changeType: data.changeType,
        subjectName: data.subjectName,
        newSubjectName: data.newSubjectName,
        parentName,
        financialImpact: data.financialImpact,
      }),
      created ? [created.id] : undefined
    );
  }
}

/**
 * NOT-008: Parent notified when a child's escrow balance changes.
 * Called from escrow.services.ts → creditEscrow() / debitEscrow().
 */
export async function notifyEscrowBalanceChanged(data: {
  studentId: string;
  studentName: string;
  previousBalance: number;
  newBalance: number;
  changeAmount: number;
  reason: string;
}) {
  const parents = await getLinkedParents(data.studentId);
  if (parents.length === 0) return;

  const direction = data.changeAmount >= 0 ? 'credited' : 'debited';
  const absAmount = Math.abs(data.changeAmount);
  const title = `Escrow balance ${direction} for ${data.studentName}`;
  const body = `EGP ${absAmount.toFixed(2)} was ${direction} to ${data.studentName}'s escrow. New balance: EGP ${data.newBalance.toFixed(2)}. Reason: ${data.reason}`;
  const notifData = {
    studentId: data.studentId,
    previousBalance: data.previousBalance,
    newBalance: data.newBalance,
    changeAmount: data.changeAmount,
  };

  const created = await createBulkNotifications(
    parents.map((p) => p.parentId),
    'ESCROW_BALANCE_CHANGED',
    title,
    body,
    notifData
  );

  for (const { parentId } of parents) {
    const parentUser = await getUserDetails(parentId);
    if (!parentUser?.email) continue;

    const matchingNotif = created.find((n) => n.userId === parentId);
    fireEmail('NOT-008 to parent', () =>
      sendEscrowBalanceChangedEmail(parentUser.email!, {
        parentName: parentUser.name,
        studentName: data.studentName,
        previousBalance: data.previousBalance,
        newBalance: data.newBalance,
        changeAmount: data.changeAmount,
        reason: data.reason,
      }),
      matchingNotif ? [matchingNotif.id] : undefined
    );
  }
}

/**
 * NOT-009: Parent notified when a withdrawal request is fulfilled.
 * Called from escrow.services.ts → fulfillWithdrawalRequest().
 */
export async function notifyWithdrawalFulfilled(data: {
  parentId: string;
  studentId: string;
  studentName: string;
  amountRequested: number;
  amountReleased: number;
  remainingBalance: number;
  adminNotes?: string;
}) {
  const parentUser = await getUserDetails(data.parentId);
  if (!parentUser) return;

  const title = `Escrow withdrawal fulfilled for ${data.studentName}`;
  const body = `EGP ${data.amountReleased.toFixed(2)} was released from ${data.studentName}'s escrow. Remaining balance: EGP ${data.remainingBalance.toFixed(2)}.`;

  const parentNotif = await createNotification(data.parentId, 'ESCROW_WITHDRAWAL_FULFILLED', title, body, {
    studentId: data.studentId,
    amountReleased: data.amountReleased,
    remainingBalance: data.remainingBalance,
  });

  // Also notify the student (they should know their escrow changed)
  await createNotification(
    data.studentId,
    'ESCROW_BALANCE_CHANGED',
    `Escrow withdrawal processed`,
    `EGP ${data.amountReleased.toFixed(2)} was withdrawn from your escrow. Remaining balance: EGP ${data.remainingBalance.toFixed(2)}.`,
    { amountReleased: data.amountReleased, remainingBalance: data.remainingBalance }
  );

  if (parentUser.email) {
    fireEmail('NOT-009 to parent', () =>
      sendWithdrawalFulfilledEmail(parentUser.email!, {
        parentName: parentUser.name,
        studentName: data.studentName,
        amountRequested: data.amountRequested,
        amountReleased: data.amountReleased,
        remainingBalance: data.remainingBalance,
        adminNotes: data.adminNotes,
      }),
      parentNotif ? [parentNotif.id] : undefined
    );
  }
}

/**
 * Notify student when a parent creates a withdrawal request for their escrow.
 */
export async function notifyWithdrawalRequested(data: {
  studentId: string;
  studentName: string;
  amount: number;
  parentName: string;
}) {
  const title = `Escrow withdrawal requested`;
  const body = `${data.parentName} has requested a withdrawal of EGP ${data.amount.toFixed(2)} from your escrow account. The request is pending admin processing.`;

  await createNotification(data.studentId, 'ESCROW_BALANCE_CHANGED', title, body, {
    withdrawalRequested: true,
    amount: data.amount,
  });
}

/**
 * Notify parent and student when a withdrawal request is rejected.
 */
export async function notifyWithdrawalRejected(data: {
  parentId: string;
  studentId: string;
  studentName: string;
  /** Amount credited back to escrow (full for 'pending' rejections; unreleased remainder for 'partially_fulfilled'). */
  amount: number;
  reason: string;
}) {
  const title = `Withdrawal request rejected for ${data.studentName}`;
  const body = data.amount > 0
    ? `The withdrawal request for ${data.studentName} was rejected. EGP ${data.amount.toFixed(2)} has been returned to the escrow balance. Reason: ${data.reason}`
    : `The withdrawal request for ${data.studentName} was rejected. Reason: ${data.reason}`;

  // Dedicated type so the inbox distinguishes fulfilled vs rejected
  // (previously both shared ESCROW_WITHDRAWAL_FULFILLED, which was misleading).
  await createNotification(data.parentId, 'ESCROW_WITHDRAWAL_REJECTED', title, body, {
    studentId: data.studentId,
    amountRefunded: data.amount,
    reason: data.reason,
  });

  await createNotification(data.studentId, 'ESCROW_WITHDRAWAL_REJECTED', title, body, {
    amountRefunded: data.amount,
    reason: data.reason,
  });
}

/**
 * GRADE_CHANGED: Student and parents notified when grade changes.
 * Called from grade.services.ts (Phase 4 Step 4.5).
 */
export async function notifyGradeChanged(data: {
  studentId: string;
  studentName: string;
  previousGrade: number | null;
  newGrade: number | null;
  reason: string;
}) {
  // F0a: the shared label (above 12 graduated, null not recorded).

  const title = `Grade updated to ${gradeLabel(data.newGrade)}`;
  const body = `${data.studentName}'s grade has been updated from ${gradeLabel(data.previousGrade)} to ${gradeLabel(data.newGrade)}. ${data.reason}`;
  const notifData = {
    studentId: data.studentId,
    previousGrade: data.previousGrade,
    newGrade: data.newGrade,
  };

  // Notify student (in-app + email)
  await createNotification(data.studentId, 'GRADE_CHANGED', title, body, notifData);

  const studentUser = await getUserDetails(data.studentId);
  if (studentUser?.email) {
    fireEmail('GRADE_CHANGED to student', () =>
      sendGradeChangedEmail(studentUser.email!, {
        recipientName: studentUser.name,
        studentName:   data.studentName,
        previousGrade: data.previousGrade,
        newGrade:      data.newGrade,
        reason:        data.reason,
        isStudent:     true,
      })
    );
  }

  // Notify parents (NOT-010)
  const parents = await getLinkedParents(data.studentId);
  if (parents.length > 0) {
    await createBulkNotifications(
      parents.map((p) => p.parentId),
      'GRADE_CHANGED',
      `${data.studentName}'s grade updated`,
      body,
      notifData
    );

    for (const { parentId } of parents) {
      const parentUser = await getUserDetails(parentId);
      if (!parentUser?.email) continue;

      fireEmail('GRADE_CHANGED to parent', () =>
        sendGradeChangedEmail(parentUser.email!, {
          recipientName: parentUser.name,
          studentName:   data.studentName,
          previousGrade: data.previousGrade,
          newGrade:      data.newGrade,
          reason:        data.reason,
          isStudent:     false,
        })
      );
    }
  }
}

/*
 * NOT-011 (the admin's bulk announcement) and its scheduled queue moved to messages (step D,
 * RESERVATIONS_REWORK.md §3.8): message.services.ts sends a broadcast as BULK_ANNOUNCEMENT
 * notifications, as before, with a delivery row per recipient and channel; the scheduler's
 * message step sends a scheduled one. scheduled_announcement is kept one release, its rows moved
 * to messages by migration 0051.
 */

// ─── AUTH-003: Parent-Student Link Request Received ───────────────────────────

/**
 * Notifies the student when a parent sends a link request (AUTH-003).
 * - Creates an in-app notification for the student.
 * - Sends an email to the student.
 *
 * @param studentId   - The student who needs to review the request
 * @param parentId    - The parent who sent the request
 */
export async function notifyLinkRequestReceived(
  studentId: string,
  parentId: string
): Promise<void> {
  const [studentDetails, parentDetails] = await Promise.all([
    getUserDetails(studentId),
    getUserDetails(parentId),
  ]);

  if (!studentDetails || !parentDetails) return;

  await createNotification(
    studentId,
    'LINK_REQUEST_RECEIVED',
    'New Parent Link Request',
    `${parentDetails.name} has requested to link to your account as your parent/guardian. Please review this request in your profile settings.`
  );

  sendLinkRequestEmail(studentDetails.email, {
    studentName: studentDetails.name,
    parentName: parentDetails.name,
    parentEmail: parentDetails.email,
  }).catch((err) => console.error('[email] sendLinkRequestEmail failed:', err));
}

// ─── AUTH-004: Parent-Student Link Decision ───────────────────────────────────

/**
 * Notifies the parent when a student approves or rejects their link request (AUTH-004).
 * - Creates an in-app notification for the parent.
 * - Sends an email to the parent.
 *
 * @param parentId    - The parent who sent the original request
 * @param studentId   - The student who made the decision
 * @param approved    - Whether the student approved (true) or rejected (false) the request
 */
export async function notifyLinkDecision(
  parentId: string,
  studentId: string,
  approved: boolean
): Promise<void> {
  const [parentDetails, studentDetails] = await Promise.all([
    getUserDetails(parentId),
    getUserDetails(studentId),
  ]);

  if (!parentDetails || !studentDetails) return;

  const title = approved ? 'Link Request Approved' : 'Link Request Rejected';
  const body = approved
    ? `${studentDetails.name} has approved your link request. You can now manage their registrations and payments.`
    : `${studentDetails.name} has rejected your link request.`;

  await createNotification(parentId, 'LINK_DECISION', title, body);

  sendLinkDecisionEmail(parentDetails.email, {
    parentName: parentDetails.name,
    studentName: studentDetails.name,
    approved,
  }).catch((err) => console.error('[email] sendLinkDecisionEmail failed:', err));
}
