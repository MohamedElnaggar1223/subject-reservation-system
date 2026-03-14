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
import { success, error } from '../lib/response';
import { requireAuth, requireAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { getAuditLogs, getEntityHistory } from '../services/audit.services';

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
   *
   * Designed for the admin audit log viewer page (REP-006).
   */
  .get('/logs',
    zValidator('query', AuditLogsQuery),
    async (c) => {
      const filters = c.req.valid('query');
      const logs = await getAuditLogs(filters);
      return success(c, logs);
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

      if (history.length === 0) {
        return error(c, 'No audit history found for this entity', 404);
      }

      return success(c, history);
    }
  );

export type AuditApi = typeof audit;
