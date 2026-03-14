/**
 * Registration Session API Routes
 *
 * Admin only:
 * - GET  /sessions               — List all sessions (filterable by status/type)
 * - GET  /sessions/:id           — Get single session with full detail
 * - POST /sessions               — Create new session
 * - PUT  /sessions/:id           — Update session (draft: all fields; active: endDate + reason)
 * - POST /sessions/:id/activate  — Manually activate a draft session
 * - POST /sessions/:id/close     — Manually close an active session
 *
 * Authenticated (any role):
 * - GET /sessions/active         — Get all currently active sessions
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  CreateSession,
  UpdateDraftSession,
  UpdateActiveSession,
  CloseSession,
  SessionId,
  ListSessionsQuery,
} from '@repo/validations';
import { success, error } from '../lib/response';
import { requireAuth, requireAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as sessionService from '../services/session.services';
import { logAction, extractAuditContext } from '../services/audit.services';

export const sessions = new Hono<HonoEnv>()
  .use('*', requireAuth())

  /**
   * GET ALL ACTIVE SESSIONS
   * GET /sessions/active
   *
   * Returns all currently active registration windows (one per type max).
   * Used on student/parent dashboards. Any authenticated user may call this.
   */
  .get('/active', async (c) => {
    const activeSessions = await sessionService.getActiveSessions();
    return success(c, activeSessions);
  })

  /**
   * LIST ALL SESSIONS
   * GET /sessions
   * Query: { status?: 'draft'|'active'|'closed', sessionType?: 'june'|'november'|'january' }
   *
   * Admin only. Returns all sessions ordered by startDate descending.
   */
  .get('/',
    requireAdmin(),
    zValidator('query', ListSessionsQuery),
    async (c) => {
      const filters = c.req.valid('query');
      const list = await sessionService.getSessions(filters);
      return success(c, list);
    }
  )

  /**
   * GET SESSION BY ID
   * GET /sessions/:id
   *
   * Admin only. Returns full session detail including editHistory.
   */
  .get('/:id',
    requireAdmin(),
    zValidator('param', SessionId),
    async (c) => {
      const { id } = c.req.valid('param');
      const found = await sessionService.getSessionById(id);

      if (!found) {
        return error(c, 'Session not found', 404);
      }

      return success(c, found);
    }
  )

  /**
   * CREATE SESSION
   * POST /sessions
   * Body: CreateSessionType
   *
   * Admin only. If startDate <= now, the session opens as 'active' immediately
   * (subject to the one-active-per-type constraint). Otherwise it starts as 'draft'.
   */
  .post('/',
    requireAdmin(),
    zValidator('json', CreateSession),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');

      try {
        const created = await sessionService.createSession(data);

        logAction(user.id, 'SESSION_CREATED', 'session', created!.id, null, created as Record<string, unknown>, extractAuditContext(c))
          .catch((err) => console.error('[audit] SESSION_CREATED failed:', err));

        return success(c, created, 201);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create session';
        return error(c, msg, 409);
      }
    }
  )

  /**
   * UPDATE SESSION
   * PUT /sessions/:id
   *
   * Admin only. Behavior differs by current session status:
   * - draft:  All fields (name, sessionType, startDate, endDate) may be changed.
   * - active: Only endDate may be extended. Requires a reason for the audit log.
   * - closed: No updates allowed.
   */
  .put('/:id',
    requireAdmin(),
    zValidator('param', SessionId),
    async (c) => {
      const { id } = c.req.valid('param');
      const currentUser = c.get('user')!;

      const session = await sessionService.getSessionById(id);
      if (!session) {
        return error(c, 'Session not found', 404);
      }

      if (session.status === 'closed') {
        return error(c, 'Cannot update a closed session', 400);
      }

      if (session.status === 'draft') {
        const parsed = UpdateDraftSession.safeParse(await c.req.json());
        if (!parsed.success) {
          return c.json({ success: false, error: 'Validation failed', details: parsed.error.flatten() }, 422);
        }

        const updated = await sessionService.updateDraftSession(id, parsed.data);
        if (!updated) {
          return error(c, 'Session is no longer in draft status', 409);
        }

        logAction(currentUser.id, 'SESSION_UPDATED', 'session', id, session as Record<string, unknown>, updated as Record<string, unknown>, extractAuditContext(c))
          .catch((err) => console.error('[audit] SESSION_UPDATED (draft) failed:', err));

        return success(c, updated);
      }

      // status === 'active'
      const parsed = UpdateActiveSession.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json({ success: false, error: 'Validation failed', details: parsed.error.flatten() }, 422);
      }

      if (parsed.data.endDate <= new Date()) {
        return error(c, 'New end date must be in the future', 400);
      }

      if (parsed.data.endDate <= session.endDate) {
        return error(c, 'New end date must be later than the current end date', 400);
      }

      const updated = await sessionService.extendActiveSessionDeadline(
        id,
        parsed.data,
        currentUser.id
      );

      if (!updated) {
        return error(c, 'Failed to update session', 500);
      }

      logAction(currentUser.id, 'SESSION_UPDATED', 'session', id, session as Record<string, unknown>, updated as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] SESSION_UPDATED (active) failed:', err));

      return success(c, updated);
    }
  )

  /**
   * ACTIVATE SESSION
   * POST /sessions/:id/activate
   *
   * Admin only. Manually activates a draft session.
   * Fails if another active session of the same type already exists.
   */
  .post('/:id/activate',
    requireAdmin(),
    zValidator('param', SessionId),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');

      const previous = await sessionService.getSessionById(id);

      try {
        const updated = await sessionService.activateSession(id);

        if (!updated) {
          return error(c, 'Session not found or is not in draft status', 400);
        }

        logAction(user.id, 'SESSION_ACTIVATED', 'session', id, previous as Record<string, unknown>, updated as Record<string, unknown>, extractAuditContext(c))
          .catch((err) => console.error('[audit] SESSION_ACTIVATED failed:', err));

        return success(c, updated);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to activate session';
        return error(c, msg, 409);
      }
    }
  )

  /**
   * CLOSE SESSION (manual early close)
   * POST /sessions/:id/close
   * Body: { reason?: string }
   *
   * Admin only. Closes an active session before its endDate.
   */
  .post('/:id/close',
    requireAdmin(),
    zValidator('param', SessionId),
    zValidator('json', CloseSession),
    async (c) => {
      const { id } = c.req.valid('param');
      const currentUser = c.get('user')!;

      const session = await sessionService.getSessionById(id);
      if (!session) {
        return error(c, 'Session not found', 404);
      }

      if (session.status !== 'active') {
        return error(c, `Cannot close a session that is currently "${session.status}"`, 400);
      }

      const updated = await sessionService.closeSession(id, currentUser.id);

      if (!updated) {
        return error(c, 'Failed to close session', 500);
      }

      logAction(currentUser.id, 'SESSION_CLOSED', 'session', id, session as Record<string, unknown>, updated as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] SESSION_CLOSED failed:', err));

      return success(c, updated);
    }
  );

export type SessionsApi = typeof sessions;
