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
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as sessionService from '../services/session.services';
import { notifySessionOpened, notifySessionClosed, getStudentAndParentBroadcastIds } from '../services/notification.services';
import { progressGrades } from '../services/grade.services';
import { logAction, extractAuditContext } from '../services/audit.services';
import { db, registrationSession as registrationSessionTable, eq } from '@repo/db';

export const sessions = new Hono<HonoEnv>()
  .use('*', requireAuth())

  /**
   * GET ALL ACTIVE SESSIONS
   * GET /sessions/active
   *
   * Returns all currently active registration windows (one per type max).
   * Used on student/parent dashboards. Any authenticated user may call this.
   */
  /**
   * GET /sessions/upcoming
   *
   * Draft sessions with a future start date — preregistration targets
   * (V3 §6.8). Any authenticated user.
   */
  .get('/upcoming', async (c) => {
    const { db } = await import('@repo/db');
    const rows = await db.query.registrationSession.findMany({
      where: (s, { eq, gt, and }) => and(eq(s.status, 'draft'), gt(s.startDate, new Date())),
      orderBy: (s, { asc }) => [asc(s.startDate)],
    });
    return success(c, rows);
  })

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

        await logAction(user.id, 'SESSION_CREATED', 'session', created!.id, null, created as Record<string, unknown>, extractAuditContext(c))
          .catch((err) => console.error('[audit] SESSION_CREATED failed:', err));

        return success(c, created, 201);
      } catch (err) {
        const msg = clientMessage(err, 'Failed to create session');
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

        // Extract reason before passing the remaining fields to the service.
        // It isn't a column on registrationSession — it lives in the audit log.
        const { reason, ...updateFields } = parsed.data;
        const updated = await sessionService.updateDraftSession(id, updateFields);
        if (!updated) {
          return error(c, 'Session is no longer in draft status', 409);
        }

        // Including _updateReason in the audit newData preserves the
        // rationale alongside the before/after field snapshots.
        await logAction(
          currentUser.id,
          'SESSION_UPDATED',
          'session',
          id,
          session as Record<string, unknown>,
          { ...(updated as Record<string, unknown>), _updateReason: reason ?? null },
          extractAuditContext(c),
        ).catch((err) => console.error('[audit] SESSION_UPDATED (draft) failed:', err));

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

      // URD SES-003 allows "modifying deadlines when necessary" — previously
      // this endpoint only allowed pushing the deadline later. An admin
      // needing to bring a deadline earlier had to use "close" (which has
      // very different side effects). Both directions are now accepted, so
      // long as the new endDate is still in the future. Reducing the deadline
      // to now-or-past still requires the explicit close route (to run
      // finalizePendingRecords + grade progression + notifications).
      if (parsed.data.endDate.getTime() === session.endDate.getTime()) {
        return error(c, 'New end date is identical to the current end date', 400);
      }

      const updated = await sessionService.extendActiveSessionDeadline(
        id,
        parsed.data,
        currentUser.id
      );

      if (!updated) {
        return error(c, 'Failed to update session', 500);
      }

      await logAction(currentUser.id, 'SESSION_UPDATED', 'session', id, session as Record<string, unknown>, updated as Record<string, unknown>, extractAuditContext(c))
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

        await logAction(user.id, 'SESSION_ACTIVATED', 'session', id, previous as Record<string, unknown>, updated as Record<string, unknown>, extractAuditContext(c))
          .catch((err) => console.error('[audit] SESSION_ACTIVATED failed:', err));

        // NOT-001: Notify all active students and parents when session is manually activated
        {
          const { studentIds, parentIds } = await getStudentAndParentBroadcastIds();
          notifySessionOpened({
            sessionId: id,
            sessionName: updated.name,
            sessionType: updated.sessionType,
            deadline: updated.endDate,
            studentIds,
            parentIds,
          }).catch((err) => console.error('[notification] NOT-001 (manual activate) failed:', err));
        }

        return success(c, updated);
      } catch (err) {
        const msg = clientMessage(err, 'Failed to activate session');
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
      const { reason } = c.req.valid('json');
      const currentUser = c.get('user')!;

      const session = await sessionService.getSessionById(id);
      if (!session) {
        return error(c, 'Session not found', 404);
      }

      if (session.status !== 'active') {
        return error(c, `Cannot close a session that is currently "${session.status}"`, 400);
      }

      const updated = await sessionService.closeSession(id, currentUser.id, reason);

      if (!updated) {
        return error(c, 'Failed to close session', 500);
      }

      await logAction(currentUser.id, 'SESSION_CLOSED', 'session', id, session as Record<string, unknown>, updated as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] SESSION_CLOSED failed:', err));

      // GRADE-001 + M-10: Await so admins see failures. On success, stamp
      // gradeProgressionCompletedAt so the scheduler's retry sweep knows
      // this session is done. On failure, leave the column null — the
      // scheduler will retry on its next tick.
      try {
        const progressed = await progressGrades(session.sessionType);
        await db
          .update(registrationSessionTable)
          .set({ gradeProgressionCompletedAt: new Date() })
          .where(eq(registrationSessionTable.id, id));
        if (progressed.length > 0) {
          console.log(`[session:close] Progressed ${progressed.length} student(s) after manual close.`);
        }
      } catch (err) {
        console.error('[session:close] Grade progression failed:', err);
        return error(
          c,
          'Session was closed, but automatic grade progression failed. The scheduler will retry it on the next tick. You can also re-run it manually.',
          500
        );
      }

      // Notify all active students and parents that the session has been closed
      {
        const { studentIds, parentIds } = await getStudentAndParentBroadcastIds();
        notifySessionClosed({
          sessionId: id,
          sessionName: session.name,
          reason,
          studentIds,
          parentIds,
        }).catch((err) => console.error('[notification] SESSION_CLOSED (manual) failed:', err));
      }

      return success(c, updated);
    }
  );

export type SessionsApi = typeof sessions;
