/**
 * Audit Log API Routes
 *
 * Admin-only routes for the audit trail viewer (REP-006).
 *
 * GET /audit/logs           - Paginated audit log list with optional filters
 * GET /audit/entity/:type/:id - Full change history for a specific entity (chain of custody)
 *
 * All routes are admin-only.
 * Filters for /audit/logs: userId, action, entityType, entityId, dateFrom, dateTo, limit, offset.
 *
 * The entity history endpoint (`/audit/entity/:type/:id`) returns all log entries
 * for a given entity in chronological order — supporting the chain-of-custody
 * display: "Requested by student → Approved by parent → Confirmed by system".
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  AuditLogsQuery,
  AuditEntityTypeSchema,
} from '@repo/validations';
import { success } from '../lib/response';
import { requireAuth, requireAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { getAuditLogs, getEntityHistory } from '../services/audit.services';

// ─── CSV Helper ───────────────────────────────────────────────────────────────

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const escape = (v: unknown) => {
    let str = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [
    headers.map(escape).join(','),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
  ];
  return lines.join('\r\n');
}

export const audit = new Hono<HonoEnv>()
  .use('*', requireAuth())
  .use('*', requireAdmin())

  /**
   * GET /audit/logs
   * Query: AuditLogsQuery
   *
   * Returns a paginated list of audit log entries, newest first.
   * Supports filtering by userId, action, entityType, entityId, dateFrom, dateTo.
   * Each entry includes the acting user's name, role, and email.
   * Supports `?format=csv` to download as CSV file.
   *
   * Designed for the admin audit log viewer page (REP-006).
   */
  .get('/logs',
    zValidator('query', AuditLogsQuery),
    async (c) => {
      const filters = c.req.valid('query');
      const { data: logs, total } = await getAuditLogs(filters);

      if (filters.format === 'csv') {
        const rows = logs.map((log) => ({
          id:         log.id,
          action:     log.action,
          entityType: log.entityType,
          entityId:   log.entityId,
          userName:   log.user?.name ?? '—',
          userRole:   log.user?.role ?? '—',
          userEmail:  log.user?.email ?? '—',
          ipAddress:  log.ipAddress ?? '—',
          userAgent:  log.userAgent ?? '—',
          createdAt:  log.createdAt instanceof Date ? log.createdAt.toISOString() : String(log.createdAt),
        }));
        const csv = toCSV(rows);
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="audit-logs.csv"',
          },
        });
      }

      return success(c, { data: logs, total });
    }
  )

  /**
   * GET /audit/entity/:type/:id
   *
   * Returns the full ordered change history for a specific entity.
   * Ordered oldest-first to show the complete lifecycle.
   *
   * Used to build the chain-of-custody chain:
   * "Requested by [Student A] → Approved by [Parent B] → Confirmed by [System]"
   *
   * entityType must be one of: user, subject, session, registration, payment, escrow, change_request
   */
  .get('/entity/:type/:id',
    zValidator('param', z.object({
      type: AuditEntityTypeSchema,
      id:   z.string().min(1, 'Entity ID is required'),
    })),
    async (c) => {
      const { type, id } = c.req.valid('param');
      const history = await getEntityHistory(type, id);
      return success(c, history);
    }
  );

export type AuditApi = typeof audit;
