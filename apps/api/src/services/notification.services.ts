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
 * - Bulk announcements (NOT-011) fan out to all matching users via `createBulkNotifications`.
 *
 * Integration: import the relevant exported trigger function into the
 * service that performs the action (registration, payment, escrow, swap).
 */

import {
  db,
  notification,
  user,
  parentStudentLink,
  scheduledAnnouncement,
  eq,
  isNull,
  and,
  or,
  desc,
  lte,
  inArray,
  sql,
} from '@repo/db';
import { randomUUID } from 'crypto';
import type {
  NotificationType,
  BulkAnnouncementType,
} from '@repo/validations';
import {
  sendSessionOpenedEmail,
  sendSessionClosingSoonEmail,
  sendSessionClosedEmail,
  sendRegistrationRequestReceivedEmail,
  sendDirectRegistrationEmail,
  sendRegistrationDecisionEmail,
  sendPaymentReceiptEmail,
  sendPaymentReversedEmail,
  sendDropSwapRequestEmail,
  sendDropSwapProcessedEmail,
  sendDirectDropSwapEmail,
  sendEscrowBalanceChangedEmail,
  sendWithdrawalFulfilledEmail,
  sendBulkAnnouncementEmail,
  sendGradeChangedEmail,
  sendLinkRequestEmail,
  sendLinkDecisionEmail,
} from '../integrations/email';
import { clientMessage } from '../lib/response';

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
  const title = 'Payment reversed';
  const body =
    `The finance office reversed a payment of EGP ${data.amount.toFixed(2)} for ${studentName} (${data.reason}). ` +
    `${data.registrationsReverted} registration${data.registrationsReverted === 1 ? ' is' : 's are'} back to pending payment.${receiptNote} ` +
    `Please settle again at the finance desk.`;
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
  const gradeLabel = (g: number | null) =>
    g === null ? 'Graduated' : `Grade ${g}`;

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

/**
 * NOT-011: Admin sends a bulk announcement to a recipient group.
 * Called from notification.routes.ts → POST /admin/notifications/announce.
 *
 * If `scheduledAt` is provided and in the future, the announcement is stored
 * in the scheduled_announcement table for later dispatch by the cron job.
 * Otherwise, it is sent immediately (current behavior).
 */
export async function sendAdminAnnouncement(
  payload: BulkAnnouncementType,
  createdBy?: string
): Promise<{
  notificationCount: number;
  emailResult: { success: boolean; stubbed?: boolean };
  scheduled?: boolean;
  scheduledAt?: Date;
}> {
  // Check if this should be scheduled for the future
  if (payload.scheduledAt) {
    const scheduledTime = new Date(payload.scheduledAt);
    const now = new Date();

    if (scheduledTime > now) {
      // Store for future dispatch
      await db.insert(scheduledAnnouncement).values({
        id: randomUUID(),
        title: payload.title,
        body: payload.body,
        recipients: payload.recipients,
        sendEmail: payload.sendEmail,
        scheduledAt: scheduledTime,
        status: 'pending',
        createdBy: createdBy ?? 'system',
      });

      return {
        notificationCount: 0,
        emailResult: { success: true },
        scheduled: true,
        scheduledAt: scheduledTime,
      };
    }
    // scheduledAt is in the past — send immediately (fall through)
  }

  return dispatchAnnouncement(payload);
}

/**
 * Core announcement dispatch logic.
 * Separated from sendAdminAnnouncement so the cron job can also call it.
 */
async function dispatchAnnouncement(
  payload: Pick<BulkAnnouncementType, 'title' | 'body' | 'recipients' | 'sendEmail'>
): Promise<{ notificationCount: number; emailResult: { success: boolean; stubbed?: boolean } }> {
  // Determine the target user query based on recipient group.
  // All branches exclude banned accounts and accounts stuck at role=null or
  // role='user' (incomplete sign-up) — URD "all users" / "active" semantics.
  const notBanned = or(eq(user.banned, false), isNull(user.banned));
  const hasRealRole = inArray(user.role, ['student', 'parent', 'admin']);

  let targetUsers: { id: string; email: string; name: string }[] = [];

  if (payload.recipients === 'all') {
    targetUsers = await db.select({
      id: user.id,
      email: user.email,
      name: user.name,
    }).from(user).where(and(hasRealRole, notBanned));
  } else if (payload.recipients === 'students') {
    targetUsers = await db.select({
      id: user.id,
      email: user.email,
      name: user.name,
    }).from(user).where(and(eq(user.role, 'student'), notBanned));
  } else if (payload.recipients === 'parents') {
    targetUsers = await db.select({
      id: user.id,
      email: user.email,
      name: user.name,
    }).from(user).where(and(eq(user.role, 'parent'), notBanned));
  } else {
    // grade_10, grade_11, grade_12
    const grade = parseInt(payload.recipients.split('_')[1] ?? '0', 10);
    targetUsers = await db.select({
      id: user.id,
      email: user.email,
      name: user.name,
    }).from(user).where(
      and(eq(user.role, 'student'), eq(user.grade, grade), notBanned)
    );
  }

  if (targetUsers.length === 0) {
    return { notificationCount: 0, emailResult: { success: true } };
  }

  // Create in-app notifications — keep the created rows so we can mark
  // emailSentAt per-recipient as each email actually goes out (M-17).
  const created = await createBulkNotifications(
    targetUsers.map((u) => u.id),
    'BULK_ANNOUNCEMENT',
    payload.title,
    payload.body
  );

  // Send emails if requested. Tracks emailSentAt per notification on success.
  let emailResult: { success: boolean; stubbed?: boolean } = { success: true };
  if (payload.sendEmail) {
    const emailByUser = new Map(targetUsers.map((u) => [u.id, u.email]));
    const successfullySent: string[] = [];
    let failed = 0;
    let stubbed = false;
    for (const n of created) {
      const email = emailByUser.get(n.userId);
      if (!email) continue;
      const result = await sendBulkAnnouncementEmail(email, {
        title: payload.title,
        body: payload.body,
      });
      if (result.success) {
        successfullySent.push(n.id);
      } else {
        failed++;
      }
      if (result.stubbed) stubbed = true;
    }
    if (successfullySent.length > 0) {
      await db
        .update(notification)
        .set({ emailSentAt: new Date() })
        .where(inArray(notification.id, successfullySent))
        .catch((err) => console.error('[notification] BULK_ANNOUNCEMENT emailSentAt update failed:', err));
    }
    emailResult = { success: failed === 0, stubbed };
  }

  return { notificationCount: targetUsers.length, emailResult };
}

/**
 * L-6: Admin read — list every scheduled announcement (pending, sent,
 * failed, cancelled). Ordered by scheduledAt descending so the soonest
 * upcoming and most-recently-sent rows rise to the top.
 */
export async function getScheduledAnnouncements() {
  return db.query.scheduledAnnouncement.findMany({
    orderBy: (s, { desc: descOp }) => [descOp(s.scheduledAt)],
    with: {
      createdByUser: { columns: { id: true, name: true, email: true } },
    },
  });
}

/**
 * L-6: Admin cancels a pending scheduled announcement. Returns undefined
 * if the row isn't found or has already transitioned out of 'pending'
 * (sent, failed, or already cancelled). The status-guarded UPDATE means
 * two admins clicking "Cancel" simultaneously don't both "win".
 */
export async function cancelScheduledAnnouncement(id: string) {
  const [updated] = await db
    .update(scheduledAnnouncement)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scheduledAnnouncement.id, id),
        eq(scheduledAnnouncement.status, 'pending'),
      )
    )
    .returning();
  return updated;
}

/**
 * Process all scheduled announcements whose scheduledAt has arrived.
 * Called by the session-closer cron job on each tick (every 60 seconds).
 *
 * Finds all 'pending' scheduled announcements where scheduledAt <= now,
 * dispatches each one, and updates the record status to 'sent' or 'failed'.
 */
export async function processScheduledAnnouncements(): Promise<number> {
  const now = new Date();

  const pending = await db
    .select()
    .from(scheduledAnnouncement)
    .where(
      and(
        eq(scheduledAnnouncement.status, 'pending'),
        lte(scheduledAnnouncement.scheduledAt, now)
      )
    );

  if (pending.length === 0) return 0;

  let dispatched = 0;

  for (const ann of pending) {
    try {
      const result = await dispatchAnnouncement({
        title: ann.title,
        body: ann.body,
        recipients: ann.recipients as BulkAnnouncementType['recipients'],
        sendEmail: ann.sendEmail,
      });

      await db
        .update(scheduledAnnouncement)
        .set({
          status: 'sent',
          sentAt: new Date(),
          notificationCount: result.notificationCount,
        })
        .where(eq(scheduledAnnouncement.id, ann.id));

      // L-7: Audit the actual dispatch (not just the scheduling).
      // Imported lazily to avoid a circular dependency between the
      // notification service and the audit service.
      try {
        const { logAction } = await import('./audit.services');
        await logAction(
          ann.createdBy ?? null,
          'ADMIN_ANNOUNCEMENT',
          'notification',
          ann.id,
          { status: 'pending', scheduledAt: ann.scheduledAt } as Record<string, unknown>,
          {
            status: 'sent',
            recipients: ann.recipients,
            sendEmail: ann.sendEmail,
            notificationCount: result.notificationCount,
            dispatchedBy: 'scheduler',
          },
        );
      } catch (auditErr) {
        console.error(`[audit] ADMIN_ANNOUNCEMENT (cron) failed for ${ann.id}:`, auditErr);
      }

      dispatched++;
    } catch (err) {
      // The stored text can reach an admin screen, so it gets the same guard
      // as a client response (RF-07): a driver error is logged in full here
      // and stored as a generic sentence.
      console.error(`[notification] Failed to dispatch scheduled announcement ${ann.id}:`, err);
      const errorMsg = clientMessage(err, 'Announcement could not be sent');

      await db
        .update(scheduledAnnouncement)
        .set({
          status: 'failed',
          errorMessage: errorMsg.slice(0, 500),
        })
        .where(eq(scheduledAnnouncement.id, ann.id));
    }
  }

  return dispatched;
}

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
