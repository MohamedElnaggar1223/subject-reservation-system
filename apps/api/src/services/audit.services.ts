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
