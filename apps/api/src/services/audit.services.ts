/**
 * Audit Trail Service
 *
 * Append-only record of every significant system action (REP-006).
 * Provides full chain-of-custody for all admin-visible operations:
 * "Requested by student → Approved by parent → Processed by system"
 *
 * Design principles:
 * - `logAction` is a simple, synchronous-feeling wrapper around a single INSERT.
 *   Callers should `await` it in admin/critical paths; use `.catch()` in non-critical paths.
 * - The audit log is never updated or deleted — it is append-only by convention.
 * - `previousData` / `newData` capture before/after state for diff display in the viewer.
 *   Callers are responsible for fetching `previousData` before the mutation.
 * - `ipAddress` and `userAgent` are extracted from the Hono context where available
 *   and passed through to `logAction` as optional metadata.
 *
 * Integration pattern (see development plan Step 4.2):
 *   const previous = await getSubjectById(id);
 *   const updated = await db.update(subject)...;
 *   await logAction(adminId, 'SUBJECT_UPDATED', 'subject', id, previous, updated, ctx);
 */

import {
  db,
  auditLog,
  eq,
  and,
  gte,
  lte,
  count,
} from '@repo/db';
import { randomUUID } from 'crypto';
import { clientIp } from '../lib/client-ip';
import { env } from '../env';
import type { AuditAction, AuditEntityType, AuditLogsQueryType } from '@repo/validations';

// ─── Log Context (from HTTP request) ─────────────────────────────────────────

export type AuditContext = {
  ipAddress?: string;
  userAgent?: string;
};

// ─── Core: logAction ─────────────────────────────────────────────────────────

/**
 * Append a single audit log entry.
 *
 * @param userId       - Who performed the action (null for system actions)
 * @param action       - The action type (from AUDIT_ACTIONS)
 * @param entityType   - The domain entity category
 * @param entityId     - The primary key of the affected entity
 * @param previousData - State before the mutation (pass null for creates)
 * @param newData      - State after the mutation (pass null for deletes)
 * @param ctx          - Optional HTTP context for IP/UA capture
 * @param executor     - The money transaction to write inside. A money action
 *                       passes its transaction so the movement and its audit
 *                       row commit together or not at all (money audit, O-7).
 */
export async function logAction(
  userId: string | null,
  action: AuditAction,
  entityType: AuditEntityType,
  entityId: string,
  previousData?: Record<string, unknown> | null,
  newData?: Record<string, unknown> | null,
  ctx?: AuditContext,
  executor: Pick<typeof db, 'insert'> = db
) {
  await executor.insert(auditLog).values({
    id:           randomUUID(),
    userId:       userId ?? null,
    action,
    entityType,
    entityId,
    previousData: previousData ?? null,
    newData:      newData ?? null,
    ipAddress:    ctx?.ipAddress ?? null,
    userAgent:    ctx?.userAgent ?? null,
  });
}

/**
 * Append several audit entries in one insert, inside the caller's
 * transaction: a system sweep that moves many rows (a close expiring every
 * unpaid registration) writes one audit row per row it moved, and they
 * commit with the moves or not at all (SO-1).
 */
export async function logActions(
  entries: {
    userId: string | null;
    action: AuditAction;
    entityType: AuditEntityType;
    entityId: string;
    previousData?: Record<string, unknown> | null;
    newData?: Record<string, unknown> | null;
  }[],
  executor: Pick<typeof db, 'insert'>
) {
  if (entries.length === 0) return;
  await executor.insert(auditLog).values(entries.map((e) => ({
    id:           randomUUID(),
    userId:       e.userId,
    action:       e.action,
    entityType:   e.entityType,
    entityId:     e.entityId,
    previousData: e.previousData ?? null,
    newData:      e.newData ?? null,
    ipAddress:    null,
    userAgent:    null,
  })));
}

// 'graduated' is history: nothing writes it since F0a derived the grade from
// the cohort. 'ineligible' is F0a's: the student may no longer sit the series
// (withdrawn, cohort or series corrected, A-12 off, exception revoked), with
// the cause in `detail`.
export type ExpiryReason =
  | 'session_closed' | 'entry_deadline' | 'graduated' | 'payment_closed' | 'preregistration_unfunded_at_deadline'
  | 'ineligible'
  // Step B (RESERVATIONS_REWORK.md §3.5): a declared sitting rejected on a waiting line; one still
  // unverified at its deadline under `verification.unverifiedAtDeadline = hold`.
  | 'declaration_rejected' | 'hold_unverified';

/**
 * One REGISTRATION_EXPIRED row per registration the system expired, with the
 * status it had (`from`) and why; `detail` carries the payment's own reason
 * when a closing payment expired it.
 */
export function expiryEntries(rows: { id: string; from: string }[], reason: ExpiryReason, detail?: string) {
  return rows.map((r) => ({
    userId: null,
    action: 'REGISTRATION_EXPIRED' as const,
    entityType: 'registration' as const,
    entityId: r.id,
    previousData: { status: r.from },
    newData: { status: 'expired', reason, ...(detail ? { detail } : {}) },
  }));
}

// ─── Read: Admin Queries ──────────────────────────────────────────────────────

/**
 * Get paginated audit logs with optional filters (REP-006).
 *
 * Includes the acting user's name and role for display.
 * Returns newest entries first.
 */
export async function getAuditLogs(filters: AuditLogsQueryType) {
  const conditions = [];

  if (filters.userId)     conditions.push(eq(auditLog.userId,     filters.userId));
  if (filters.action)     conditions.push(eq(auditLog.action,     filters.action));
  if (filters.entityType) conditions.push(eq(auditLog.entityType, filters.entityType));
  if (filters.entityId)   conditions.push(eq(auditLog.entityId,   filters.entityId));

  if (filters.dateFrom) {
    conditions.push(gte(auditLog.createdAt, new Date(filters.dateFrom)));
  }
  if (filters.dateTo) {
    // Include the entire dateTo day by setting time to end-of-day
    const end = new Date(filters.dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(auditLog.createdAt, end));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // M-16: Return both the page and the filtered total so the admin UI
  // can render "page X of Y" / "showing N of TOTAL". Run both queries
  // in parallel so this adds a round-trip, not a round-trip × 2.
  const [logs, totalRow] = await Promise.all([
    db.query.auditLog.findMany({
      where: whereClause,
      with: {
        user: {
          columns: { id: true, name: true, role: true, email: true },
        },
      },
      orderBy: (al, { desc: descOp }) => [descOp(al.createdAt)],
      limit:  filters.limit,
      offset: filters.offset,
    }),
    db
      .select({ total: count() })
      .from(auditLog)
      .where(whereClause),
  ]);

  return {
    data: logs,
    total: Number(totalRow[0]?.total ?? 0),
  };
}

/**
 * Get the full history of changes to a single entity (chain of custody).
 * Ordered oldest-first to show the full progression.
 *
 * Used to build the "Requested by → Approved by → Confirmed by" chain
 * in the audit log viewer.
 */
export async function getEntityHistory(
  entityType: AuditEntityType,
  entityId: string
) {
  return db.query.auditLog.findMany({
    where: (al, { eq: eqOp, and: andOp }) =>
      andOp(eqOp(al.entityType, entityType), eqOp(al.entityId, entityId)),
    with: {
      user: {
        columns: { id: true, name: true, role: true },
      },
    },
    orderBy: (al, { asc }) => [asc(al.createdAt)],
  });
}

/**
 * Extract Hono request context for audit logging.
 *
 * The address comes from clientIp(), the same function that keys the rate
 * limiters: a proxy header counts only when CLIENT_IP_HEADER names it. This
 * used to trust `cf-connecting-ip` from any client (RF-11), so the address in
 * an audit row was whatever the caller chose to write there.
 */
export function extractAuditContext(c: Parameters<typeof clientIp>[0]): AuditContext {
  const ip = clientIp(c, env.CLIENT_IP_HEADER);
  return {
    ipAddress: ip === 'unknown' ? undefined : ip,
    userAgent: c.req.header('user-agent'),
  };
}
