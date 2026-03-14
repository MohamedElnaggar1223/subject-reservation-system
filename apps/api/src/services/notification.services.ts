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
  eq,
  isNull,
  and,
  desc,
} from '@repo/db';
import { randomUUID } from 'crypto';
import type {
  NotificationType,
  BulkAnnouncementType,
} from '@repo/validations';
import {
  sendSessionOpenedEmail,
  sendSessionClosingSoonEmail,
  sendRegistrationRequestReceivedEmail,
  sendRegistrationDecisionEmail,
  sendPaymentReceiptEmail,
  sendDropSwapRequestEmail,
  sendDropSwapProcessedEmail,
  sendEscrowBalanceChangedEmail,
  sendWithdrawalFulfilledEmail,
  sendBulkAnnouncementEmail,
  sendGradeChangedEmail,
  sendLinkRequestEmail,
  sendLinkDecisionEmail,
} from '../integrations/email';

// ─── Core Primitives ──────────────────────────────────────────────────────────

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
  const rows = await db
    .select()
    .from(notification)
    .where(and(eq(notification.userId, userId), isNull(notification.readAt)));

  return rows.length;
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
        eq(parentStudentLink.status, 'accepted')
      )
    );
}

/**
 * Convenience: create a notification for a user and
 * all confirmed parents of a student (NOT-010).
 *
 * If `parentNotification` is provided, parents receive a different
 * title/body/data than the student/primary recipient.
 */
async function notifyWithParentCC(
  primaryUserId: string,
  studentId: string,
  notification: {
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  },
  parentNotification?: {
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }
) {
  await createNotification(
    primaryUserId,
    notification.type,
    notification.title,
    notification.body,
    notification.data
  );

  if (parentNotification && primaryUserId !== studentId) {
    return;
  }

  // Notify parents (NOT-010): every action involving a student CC's their parents
  const parents = await getLinkedParents(studentId);
  if (parents.length > 0) {
    const pn = parentNotification ?? notification;
    await createBulkNotifications(
      parents.map((p) => p.parentId),
      pn.type,
      pn.title,
      pn.body,
      pn.data
    );
  }
}

/**
 * Fire-and-forget email wrapper.
 * Logs failures but never throws — email issues must not disrupt core operations.
 */
async function fireEmail<T>(label: string, fn: () => Promise<T>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[notification:email] Failed to send ${label}:`, err);
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

  await createBulkNotifications(allUserIds, 'SESSION_OPENED', title, body, {
    sessionId: data.sessionId,
  });

  // Send emails — fetch users in batch, fire-and-forget per user
  fireEmail('SESSION_OPENED blast', async () => {
    const allUsers = await db.select().from(user).where(
      and(
        // Only fetch users involved
        eq(user.role, 'student')
      )
    );
    for (const u of allUsers) {
      if (!u.email) continue;
      await sendSessionOpenedEmail(u.email, {
        recipientName: u.name,
        sessionName: data.sessionName,
        sessionType: data.sessionType,
        deadline,
      });
    }
  });
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

  await createBulkNotifications(allUserIds, 'SESSION_CLOSING_SOON', title, body, {
    sessionId: data.sessionId,
  });
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

  await createBulkNotifications(
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

    fireEmail('NOT-003 to parent', () =>
      sendRegistrationRequestReceivedEmail(parentUser.email!, {
        parentName: parentUser.name,
        studentName: data.studentName,
        sessionName: data.sessionName,
        subjects: data.subjects,
        totalCost: data.totalCost,
      })
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

  await createNotification(data.studentId, 'REGISTRATION_APPROVED', title, body, {
    sessionName: data.sessionName,
    approved: data.approved,
  });

  if (studentUser.email) {
    fireEmail('NOT-004 to student', () =>
      sendRegistrationDecisionEmail(studentUser.email!, {
        studentName: studentUser.name,
        sessionName: data.sessionName,
        approved: data.approved,
        parentName: parentUser?.name ?? 'Your parent',
        comments: data.comments,
      })
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
  await createNotification(data.parentId, 'PAYMENT_CONFIRMED', title, body, notifData);

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
      })
    );
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

  await createBulkNotifications(
    parents.map((p) => p.parentId),
    'DROP_SWAP_REQUEST_RECEIVED',
    title,
    body,
    notifData
  );

  for (const { parentId } of parents) {
    const parentUser = await getUserDetails(parentId);
    if (!parentUser?.email) continue;

    fireEmail('NOT-006 to parent', () =>
      sendDropSwapRequestEmail(parentUser.email!, {
        parentName: parentUser.name,
        studentName: data.studentName,
        changeType: data.changeType,
        subjectName: data.subjectName,
        newSubjectName: data.newSubjectName,
        financialImpact: data.financialImpact,
        reason: data.reason,
      })
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

  await createNotification(data.studentId, 'DROP_SWAP_PROCESSED', title, body, {
    changeRequestId: data.changeRequestId,
    approved: data.approved,
  });

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
      })
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

  await createBulkNotifications(
    parents.map((p) => p.parentId),
    'ESCROW_BALANCE_CHANGED',
    title,
    body,
    notifData
  );

  for (const { parentId } of parents) {
    const parentUser = await getUserDetails(parentId);
    if (!parentUser?.email) continue;

    fireEmail('NOT-008 to parent', () =>
      sendEscrowBalanceChangedEmail(parentUser.email!, {
        parentName: parentUser.name,
        studentName: data.studentName,
        previousBalance: data.previousBalance,
        newBalance: data.newBalance,
        changeAmount: data.changeAmount,
        reason: data.reason,
      })
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

  await createNotification(data.parentId, 'ESCROW_WITHDRAWAL_FULFILLED', title, body, {
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
      })
    );
  }
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
 */
export async function sendAdminAnnouncement(
  payload: BulkAnnouncementType
): Promise<{ notificationCount: number; emailResult: { success: boolean; stubbed?: boolean } }> {
  // Determine the target user query based on recipient group
  let targetUsers: { id: string; email: string; name: string }[] = [];

  if (payload.recipients === 'all') {
    targetUsers = await db.select({
      id: user.id,
      email: user.email,
      name: user.name,
    }).from(user);
  } else if (payload.recipients === 'students') {
    targetUsers = await db.select({
      id: user.id,
      email: user.email,
      name: user.name,
    }).from(user).where(eq(user.role, 'student'));
  } else if (payload.recipients === 'parents') {
    targetUsers = await db.select({
      id: user.id,
      email: user.email,
      name: user.name,
    }).from(user).where(eq(user.role, 'parent'));
  } else {
    // grade_10, grade_11, grade_12
    const grade = parseInt(payload.recipients.split('_')[1] ?? '0', 10);
    targetUsers = await db.select({
      id: user.id,
      email: user.email,
      name: user.name,
    }).from(user).where(and(eq(user.role, 'student'), eq(user.grade, grade)));
  }

  if (targetUsers.length === 0) {
    return { notificationCount: 0, emailResult: { success: true } };
  }

  // Create in-app notifications
  await createBulkNotifications(
    targetUsers.map((u) => u.id),
    'BULK_ANNOUNCEMENT',
    payload.title,
    payload.body
  );

  // Send emails if requested
  let emailResult: { success: boolean; stubbed?: boolean } = { success: true };
  if (payload.sendEmail) {
    const allEmails = targetUsers.map((u) => u.email).filter(Boolean);
    if (allEmails.length > 0) {
      const result = await sendBulkAnnouncementEmail(allEmails, {
        title: payload.title,
        body: payload.body,
      });
      emailResult = { success: result.success, stubbed: result.stubbed };
    }
  }

  return { notificationCount: targetUsers.length, emailResult };
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
