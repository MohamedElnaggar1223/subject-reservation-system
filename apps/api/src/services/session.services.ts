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

import { db, registrationSession, eq, and, lte, sql } from '@repo/db';
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
  excludeId?: string
): Promise<boolean> {
  const found = await db.query.registrationSession.findFirst({
    where: (s, { eq, and, ne }) => {
      const base = and(eq(s.status, 'active'), eq(s.sessionType, sessionType));
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

  if (initialStatus === 'active') {
    const conflict = await hasActiveSessionOfType(data.sessionType);
    if (conflict) {
      throw new Error(
        `An active ${data.sessionType} session already exists. Close it before opening a new one.`
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
      startDate: data.startDate,
      endDate: data.endDate,
      status: initialStatus,
      editHistory: [],
    })
    .returning();

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
 * Extend the deadline of an ACTIVE session.
 *
 * Only the endDate may be changed once a session is active.
 * Every change is appended to the editHistory audit trail with
 * the adminId, timestamp, old value, new value, and a mandatory reason.
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

  const newEntry = {
    editedBy: adminId,
    editedAt: new Date().toISOString(),
    field: 'endDate',
    oldValue: session.endDate.toISOString(),
    newValue: data.endDate.toISOString(),
    reason: data.reason,
  };

  const updatedHistory = [...(session.editHistory ?? []), newEntry];

  const [updated] = await db
    .update(registrationSession)
    .set({
      endDate: data.endDate,
      editHistory: updatedHistory,
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

  const conflict = await hasActiveSessionOfType(session.sessionType, id);
  if (conflict) {
    throw new Error(
      `An active ${session.sessionType} session already exists. Close it before activating this one.`
    );
  }

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

  return updated;
}

/**
 * Manually close an active session before its endDate.
 *
 * Admin-only operation. Records who closed it and when.
 * Returns the closed session, or undefined if not found or already closed.
 */
export async function closeSession(id: string, adminId: string) {
  const now = new Date();

  const [updated] = await db
    .update(registrationSession)
    .set({
      status: 'closed',
      closedAt: now,
      closedBy: adminId,
      updatedAt: now,
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
  closedSessions: { id: string; sessionType: string }[];
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
    .returning({ id: registrationSession.id, sessionType: registrationSession.sessionType });

  // Activate draft sessions whose startDate has arrived
  // We do this one at a time to respect the unique constraint per sessionType
  const draftsDue = await db.query.registrationSession.findMany({
    where: (s, { eq, lte, and }) =>
      and(eq(s.status, 'draft'), lte(s.startDate, now)),
    // name + endDate included so the scheduler can use them for NOT-001 notifications
    columns: { id: true, sessionType: true, name: true, endDate: true },
    orderBy: (s, { asc }) => [asc(s.startDate)],
  });

  let activatedCount = 0;
  const activatedSessions: { id: string; name: string; sessionType: string; endDate: Date }[] = [];

  for (const draft of draftsDue) {
    const conflict = await hasActiveSessionOfType(draft.sessionType);
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
