/**
 * Registration Session Service
 *
 * Business logic for all registration window operations:
 * - CRUD for sessions (admin)
 * - Lifecycle management: draft → active → closed
 * - Active session queries (all authenticated users)
 * - Auto-close for expired windows
 *
 * Key rules enforced here:
 * - Only one active session per sessionType at a time (also enforced by DB partial unique index)
 * - Draft sessions: any field may be updated
 * - Active sessions: only endDate may be extended; all changes are audit-logged
 * - Closed sessions: no updates allowed
 *
 * All database imports come from @repo/db — never from drizzle-orm directly.
 */

import { db, registrationSession, registration, changeRequest, paymentRegistration, payment, user, eq, and, lte, inArray, sql } from '@repo/db';
import { capturePreregistrationsForSession } from './prereg.services';
import { notifySessionOpened, createNotification } from './notification.services';
import { failPayment } from './payment.services';
import { randomUUID } from 'crypto';
import type {
  CreateSessionType,
  UpdateDraftSessionType,
  UpdateActiveSessionType,
} from '@repo/validations';

/**
 * Determine the correct initial status when creating a session.
 * A session whose startDate is now or in the past opens immediately as 'active'.
 */
function resolveInitialStatus(startDate: Date): 'draft' | 'active' {
  return startDate <= new Date() ? 'active' : 'draft';
}

/**
 * Check whether a session exists by ID.
 */
export async function sessionExists(id: string): Promise<boolean> {
  const found = await db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, id),
    columns: { id: true },
  });
  return !!found;
}

/**
 * Get a single session by ID.
 */
export async function getSessionById(id: string) {
  return db.query.registrationSession.findFirst({
    where: (s, { eq }) => eq(s.id, id),
  });
}

/**
 * Get all sessions with optional status/type filters.
 *
 * Admin-only operation; returns all statuses by default.
 */
export async function getSessions(filters?: {
  status?: string;
  sessionType?: string;
}) {
  return db.query.registrationSession.findMany({
    where: (s, { eq, and }) => {
      const conditions = [];
      if (filters?.status) conditions.push(eq(s.status, filters.status));
      if (filters?.sessionType) conditions.push(eq(s.sessionType, filters.sessionType));
      return conditions.length > 0 ? and(...conditions) : undefined;
    },
    orderBy: (s, { desc }) => [desc(s.startDate)],
  });
}

/**
 * Get all currently active sessions (one per sessionType, max three).
 *
 * Used on student/parent dashboards to show which registration
 * windows are currently open.
 */
export async function getActiveSessions() {
  return db.query.registrationSession.findMany({
    where: (s, { eq }) => eq(s.status, 'active'),
    orderBy: (s, { asc }) => [asc(s.sessionType)],
  });
}

/**
 * Get the active session for a specific session type.
 * Returns null if no active session of that type exists.
 */
export async function getActiveSession(sessionType: string) {
  const found = await db.query.registrationSession.findFirst({
    where: (s, { eq, and }) =>
      and(eq(s.status, 'active'), eq(s.sessionType, sessionType)),
  });
  return found ?? null;
}

/**
 * Check whether an active session of the given type already exists.
 * Used before activating a draft or creating an immediately-active session.
 */
export async function hasActiveSessionOfType(
  sessionType: string,
  qualificationLevel: string,
  excludeId?: string
): Promise<boolean> {
  const found = await db.query.registrationSession.findFirst({
    where: (s, { eq, and, ne }) => {
      const base = and(
        eq(s.status, 'active'),
        eq(s.sessionType, sessionType),
        eq(s.qualificationLevel, qualificationLevel),
      );
      return excludeId ? and(base, ne(s.id, excludeId)) : base;
    },
    columns: { id: true },
  });
  return !!found;
}

/**
 * Create a new registration session.
 *
 * Admin-only operation.
 * If startDate is now or in the past the session opens as 'active' immediately,
 * provided no other active session of the same type exists.
 * Otherwise it starts as 'draft' and is opened by the auto-scheduler or
 * by an explicit activate call.
 *
 * Returns the created session.
 * Throws if the immediate-active path would violate the unique-per-type constraint.
 */
export async function createSession(data: CreateSessionType) {
  const initialStatus = resolveInitialStatus(data.startDate);

  const qualificationLevel = data.qualificationLevel ?? 'igcse';

  if (initialStatus === 'active') {
    const conflict = await hasActiveSessionOfType(data.sessionType, qualificationLevel);
    if (conflict) {
      throw new Error(
        `An active ${qualificationLevel} ${data.sessionType} session already exists. Close it before opening a new one.`
      );
    }
  }

  const id = randomUUID();

  const [created] = await db
    .insert(registrationSession)
    .values({
      id,
      name: data.name,
      sessionType: data.sessionType,
      qualificationLevel,
      startDate: data.startDate,
      endDate: data.endDate,
      status: initialStatus,
      editHistory: [],
    })
    .returning();

  if (initialStatus === 'active') {
    const students = await db.query.user.findMany({
      where: (u, { eq: eqOp }) => eqOp(u.role, 'student'),
      columns: { id: true },
    });
    const parents = await db.query.user.findMany({
      where: (u, { eq: eqOp }) => eqOp(u.role, 'parent'),
      columns: { id: true },
    });
    notifySessionOpened({
      sessionId: id,
      sessionName: data.name,
      sessionType: data.sessionType,
      deadline: data.endDate,
      studentIds: students.map((s) => s.id),
      parentIds: parents.map((p) => p.id),
    }).catch((err) => console.error('[notification] session-opened (immediate) failed:', err));
  }

  return created;
}

/**
 * Update a DRAFT session.
 *
 * All fields (name, sessionType, startDate, endDate) may be changed
 * while the session has not yet been activated.
 * Returns the updated session, or undefined if not found.
 */
export async function updateDraftSession(
  id: string,
  data: UpdateDraftSessionType
) {
  // V3 §5.5: validate the MERGED state never yields a January IGCSE
  // session (no January IGCSE series exists in Egypt).
  if (data.sessionType !== undefined || data.qualificationLevel !== undefined) {
    const current = await getSessionById(id);
    if (!current) return undefined;
    const mergedType = data.sessionType ?? current.sessionType;
    const mergedLevel = data.qualificationLevel ?? current.qualificationLevel;
    if (mergedType === 'january' && mergedLevel === 'igcse') {
      throw new Error('January series are A-Level only — no January IGCSE exists in Egypt');
    }
  }

  const [updated] = await db
    .update(registrationSession)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(registrationSession.id, id),
        eq(registrationSession.status, 'draft')
      )
    )
    .returning();

  return updated;
}

/**
 * Change the deadline of an ACTIVE session.
 *
 * Only the endDate may be changed once a session is active. The route
 * layer requires the new endDate to be in the future AND different from
 * the current one; this function accepts both forward extensions and
 * earlier-but-still-future deadlines. Every change is appended to the
 * editHistory audit trail with the adminId, timestamp, old value, new
 * value, and a mandatory reason. When the new endDate is more than 24
 * hours away, reminderSentAt is reset so NOT-002 fires again for the
 * new deadline (see H-7 in FIX_AND_COMPLETION_PLAN notes).
 *
 * Returns the updated session, or undefined if not found / wrong status.
 */
export async function extendActiveSessionDeadline(
  id: string,
  data: UpdateActiveSessionType,
  adminId: string
) {
  const session = await getSessionById(id);
  if (!session || session.status !== 'active') return undefined;

  // Atomic JSONB append — wraps the new entry in an array so the || operator
  // concatenates arrays rather than merging objects, preventing TOCTOU races.
  const newEntryArray = JSON.stringify([{
    editedBy: adminId,
    editedAt: new Date().toISOString(),
    field: 'endDate',
    oldValue: session.endDate.toISOString(),
    newValue: data.endDate.toISOString(),
    reason: data.reason,
  }]);

  // If the deadline moves more than 24h into the future, clear the
  // "reminder already sent" flag so NOT-002 fires again relative to the
  // new endDate. Otherwise users miss the updated closing warning.
  const in24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const shouldResetReminder = data.endDate > in24h;

  const [updated] = await db
    .update(registrationSession)
    .set({
      endDate: data.endDate,
      editHistory: sql`COALESCE(${registrationSession.editHistory}, '[]'::jsonb) || ${newEntryArray}::jsonb`,
      ...(shouldResetReminder ? { reminderSentAt: null } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(registrationSession.id, id),
        eq(registrationSession.status, 'active')
      )
    )
    .returning();

  return updated;
}

/**
 * Manually activate a draft session.
 *
 * Admin-only operation. Validates that no other active session of the
 * same type exists before activating.
 *
 * Returns the activated session, or undefined if session not found or not in draft.
 * Throws if a conflicting active session exists.
 */
export async function activateSession(id: string) {
  const session = await getSessionById(id);
  if (!session || session.status !== 'draft') return undefined;

  const conflict = await hasActiveSessionOfType(session.sessionType, session.qualificationLevel, id);
  if (conflict) {
    throw new Error(
      `An active ${session.qualificationLevel} ${session.sessionType} session already exists. Close it before activating this one.`
    );
  }

  // The app-level conflict check above handles the common case, but a
  // race between two admins clicking "Activate" on draft sessions of the
  // same sessionType can still slip past it. The partial unique index
  // `one_active_per_session_type_idx` catches the loser at the DB level;
  // we convert the Postgres 23505 error into the same friendly message
  // so the route can map it cleanly to HTTP 409 instead of bubbling a
  // raw "duplicate key value violates unique constraint" 500.
  try {
    const [updated] = await db
      .update(registrationSession)
      .set({ status: 'active', updatedAt: new Date() })
      .where(
        and(
          eq(registrationSession.id, id),
          eq(registrationSession.status, 'draft')
        )
      )
      .returning();

    // V3 §6.8: capture preregistrations on manual activation too
    if (updated) {
      capturePreregistrationsForSession(id).catch((err) =>
        console.error(`[session] Prereg capture failed for ${id}:`, err)
      );
    }

    return updated;
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === '23505'
    ) {
      throw new Error(
        `An active ${session.sessionType} session already exists. Close it before activating this one.`
      );
    }
    throw err;
  }
}

/**
 * Finalize all pending records when a session closes.
 *
 * Called from both manual close and auto-close paths.
 * 1. unpaid checkouts ('pending' payments) on this session → failed, escrow back
 * 2. pending_approval and pending_payment registrations → expired, except those
 *    held by a transfer awaiting verification ('pending_verification'): the
 *    family may already have sent that money, so finance confirms or rejects
 *    it after the close (money audit MA-01)
 * 3. pending_approval change requests for registrations in this session → rejected with system comment
 * 4. any 'pending' payment left on an expired registration (a checkout started
 *    while the close ran) → failed, escrow back
 *
 * Returns counts of affected records.
 */
export async function finalizePendingRecords(sessionId: string): Promise<{
  expiredRegistrations: number;
  rejectedChangeRequests: number;
}> {
  const now = new Date();

  // 1. Fail unpaid checkouts first. failPayment is told to move only
  //    'pending' payments: one whose reference arrives in the meantime is left
  //    alone, and step 2 then sees it and keeps its registrations.
  const unpaid = await db
    .selectDistinct({ id: payment.id })
    .from(payment)
    .innerJoin(paymentRegistration, eq(paymentRegistration.paymentId, payment.id))
    .innerJoin(registration, eq(registration.id, paymentRegistration.registrationId))
    .where(and(eq(registration.sessionId, sessionId), eq(registration.status, 'pending_payment'), eq(payment.status, 'pending')));
  for (const { id } of unpaid) {
    try {
      await failPayment(id, { from: ['pending'], reason: 'Registration window closed before payment' });
    } catch (err) {
      console.error(`[session:finalize] Failed to fail payment ${id}:`, err);
    }
  }

  // 2. Expire pending_approval and pending_payment registrations for this session,
  // except those held by a transfer awaiting verification.
  // Return enough data to notify each affected student individually afterward
  // (SES-004: "Students/parents notified of early closure" and H-16:
  // students whose swap-generated pending_payment expires must know their
  // new subject didn't go through — even though they still have the escrow
  // credit from the original drop).
  const expiredRegs = await db
    .update(registration)
    .set({
      status: 'expired',
      updatedAt: now,
    })
    .where(
      and(
        eq(registration.sessionId, sessionId),
        inArray(registration.status, ['pending_approval', 'pending_payment']),
        sql`not exists (
          select 1 from ${paymentRegistration} pr join ${payment} p on p.id = pr.payment_id
          where pr.registration_id = ${registration.id} and p.status = 'pending_verification'
        )`,
      )
    )
    .returning({
      id: registration.id,
      studentId: registration.studentId,
      subjectId: registration.subjectId,
    });

  // 3. Reject all pending_approval change requests for registrations in this session
  // First, get all registration IDs belonging to this session
  const sessionRegs = await db.query.registration.findMany({
    where: (r, { eq: eqOp }) => eqOp(r.sessionId, sessionId),
    columns: { id: true },
  });
  const sessionRegIds = sessionRegs.map((r) => r.id);

  let rejectedCRs: { id: string }[] = [];
  if (sessionRegIds.length > 0) {
    rejectedCRs = await db
      .update(changeRequest)
      .set({
        status: 'rejected',
        comments: '[SYSTEM] Automatically rejected — registration session closed.',
        processedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          inArray(changeRequest.registrationId, sessionRegIds),
          eq(changeRequest.status, 'pending_approval'),
        )
      )
      .returning({ id: changeRequest.id });
  }

  // 4. A checkout started while the close ran can still be 'pending' on a
  // now-expired registration; fail it so its escrow comes back.
  const expiredRegIds = expiredRegs.map((r) => r.id);
  if (expiredRegIds.length > 0) {
    const pendingPaymentLinks = await db.query.paymentRegistration.findMany({
      where: (pr, { inArray: inArr }) => inArr(pr.registrationId, expiredRegIds),
      with: {
        payment: { columns: { id: true, status: true } },
      },
    });

    const pendingPaymentIds = [
      ...new Set(pendingPaymentLinks.filter((pl) => pl.payment.status === 'pending').map((pl) => pl.payment.id)),
    ];

    for (const pid of pendingPaymentIds) {
      try {
        await failPayment(pid, { from: ['pending'], reason: 'Registration window closed before payment' });
      } catch (err) {
        console.error(`[session:finalize] Failed to fail payment ${pid}:`, err);
      }
    }
  }

  // SES-004 / H-16: Per-student notification for each expired registration.
  // The existing session-closed blast tells everyone "the window closed";
  // this focused notification tells each affected student exactly WHICH of
  // THEIR registrations didn't go through, so a student who swapped then
  // never paid understands why the new subject is gone (the escrow credit
  // from the original drop remains on their account).
  if (expiredRegs.length > 0) {
    try {
      const subjectIds = [...new Set(expiredRegs.map((r) => r.subjectId))];
      const subjects = await db.query.subject.findMany({
        where: (s, { inArray: inArr }) => inArr(s.id, subjectIds),
        columns: { id: true, name: true },
      });
      const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]));

      const sessionRow = await db.query.registrationSession.findFirst({
        where: (s, { eq: eqOp }) => eqOp(s.id, sessionId),
        columns: { name: true },
      });
      const sessionName = sessionRow?.name ?? 'the session';

      // Group expired registrations per student so each student gets a
      // single notification rather than one per subject.
      const byStudent = new Map<string, string[]>();
      for (const r of expiredRegs) {
        const name = subjectNameById.get(r.subjectId) ?? 'a subject';
        const arr = byStudent.get(r.studentId) ?? [];
        arr.push(name);
        byStudent.set(r.studentId, arr);
      }

      for (const [studentId, subjectNames] of byStudent) {
        await createNotification(
          studentId,
          'SESSION_CLOSED',
          `Your pending registrations for ${sessionName} were not completed`,
          `The registration window for ${sessionName} has closed. The following pending registration(s) were not completed and have been expired: ${subjectNames.join(', ')}. Any escrow already credited to your account from earlier actions is unaffected.`,
          { sessionId, sessionName, subjectNames, reason: 'session_closed' }
        );
      }
    } catch (err) {
      console.error('[session:finalize] Per-student expiry notifications failed:', err);
    }
  }

  return {
    expiredRegistrations: expiredRegs.length,
    rejectedChangeRequests: rejectedCRs.length,
  };
}

/**
 * Manually close an active session before its endDate.
 *
 * Admin-only operation. Records who closed it and when.
 * Returns the closed session, or undefined if not found or already closed.
 */
export async function closeSession(id: string, adminId: string, reason?: string) {
  const now = new Date();

  const [updated] = await db
    .update(registrationSession)
    .set({
      status: 'closed',
      closedAt: now,
      closedBy: adminId,
      closeReason: reason ?? null,
      updatedAt: now,
    })
    .where(
      and(
        eq(registrationSession.id, id),
        eq(registrationSession.status, 'active')
      )
    )
    .returning();

  // Finalize pending records when a session is manually closed
  if (updated) {
    const finalized = await finalizePendingRecords(id);
    if (finalized.expiredRegistrations > 0 || finalized.rejectedChangeRequests > 0) {
      console.log(
        `[session:close] Finalized ${finalized.expiredRegistrations} registration(s) and ${finalized.rejectedChangeRequests} change request(s) for session ${id}.`
      );
    }
  }

  return updated;
}

/**
 * Auto-close all sessions whose endDate has passed.
 *
 * Called by the session-closer job every minute.
 * Also auto-activates draft sessions whose startDate has arrived,
 * as long as no other active session of the same type exists.
 *
 * Returns the number of sessions closed and activated, plus the
 * details of newly-activated sessions so the scheduler can fire
 * NOT-001 (session opened) notifications.
 */
export async function autoManageSessions(): Promise<{
  closed: number;
  closedSessions: { id: string; name: string; sessionType: string }[];
  activated: number;
  activatedSessions: { id: string; name: string; sessionType: string; endDate: Date }[];
}> {
  const now = new Date();

  // Close expired active sessions — return sessionType so the scheduler can
  // call progressGrades() for each unique sessionType that just closed.
  const closedResult = await db
    .update(registrationSession)
    .set({ status: 'closed', closedAt: now, updatedAt: now })
    .where(
      and(
        eq(registrationSession.status, 'active'),
        lte(registrationSession.endDate, now)
      )
    )
    .returning({ id: registrationSession.id, name: registrationSession.name, sessionType: registrationSession.sessionType });

  // Activate draft sessions whose startDate has arrived
  // We do this one at a time to respect the unique constraint per sessionType
  const draftsDue = await db.query.registrationSession.findMany({
    where: (s, { eq, lte, and }) =>
      and(eq(s.status, 'draft'), lte(s.startDate, now)),
    // name + endDate included so the scheduler can use them for NOT-001 notifications
    columns: { id: true, sessionType: true, qualificationLevel: true, name: true, endDate: true },
    orderBy: (s, { asc }) => [asc(s.startDate)],
  });

  let activatedCount = 0;
  const activatedSessions: { id: string; name: string; sessionType: string; endDate: Date }[] = [];

  for (const draft of draftsDue) {
    const conflict = await hasActiveSessionOfType(draft.sessionType, draft.qualificationLevel);
    if (!conflict) {
      await db
        .update(registrationSession)
        .set({ status: 'active', updatedAt: now })
        .where(eq(registrationSession.id, draft.id));
      activatedCount++;
      activatedSessions.push({
        id:          draft.id,
        name:        draft.name,
        sessionType: draft.sessionType,
        endDate:     draft.endDate,
      });
    }
  }

  return {
    closed: closedResult.length,
    closedSessions: closedResult,
    activated: activatedCount,
    activatedSessions,
  };
}
