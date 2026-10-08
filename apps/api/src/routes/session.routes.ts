/**
 * Registration sessions (RESERVATIONS_REWORK.md §4.1, §4.2, §5; docs/features/RESERVATIONS.md §2.9).
 *
 * Any signed-in user:
 * - GET  /sessions/active, /sessions/upcoming
 * Admin; coordinator and finance read:
 * - GET  /sessions, /sessions/:id
 * Admin:
 * - POST /sessions                     — six inputs; the name and refund policy follow; copy from a predecessor
 * - PUT  /sessions/:id                 — the header (dates, course start, payment due, refund policy)
 * - POST /sessions/:id/copy-from       — offers of an earlier session of the same kind
 * - PUT  /sessions/:id/series          — correct the exam series (F0a)
 * - POST /sessions/:id/activate, /close
 * - POST /sessions/:id/board-series/move — lines to another series (behind the item's series)
 * Admin and coordinator — the links sheet:
 * - GET  /sessions/:id/board-series    — the series its items are entered in (derived, read only)
 * - GET  /sessions/:id/offers, /offers/addable; POST /offers; PUT/DELETE /offers/:offerId;
 *   POST /offers/:offerId/replace-teacher; POST /offers/:offerId/items; PUT/DELETE …/items/:itemId
 * - POST /sessions/:id/grade10/preview, /commit
 * Admin and finance:
 * - GET  /sessions/:id/money           — lines only (§4.6)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  CreateSession,
  UpdateSession,
  CloseSession,
  SessionId,
  ListSessionsQuery,
  CorrectSessionSeries,
  CopySessionFrom,
  MoveRegistrationsToSeries,
  CreateOffer,
  UpdateOffer,
  UpdateOfferItem,
  OfferItemInput,
  ReplaceOfferTeacher,
  OfferParam,
  OfferItemParam,
  Grade10Bulk,
  SessionMoneyQuery,
  ROLES,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireAdmin, requireRole } from '../middleware/access-control.middleware';
import { closePaymentsOfExpiredRegistrations } from '../services/payment.services';
import type { HonoEnv } from '../lib/types';
import * as sessionService from '../services/session.services';
import * as seriesService from '../services/series.services';
import * as offerService from '../services/offer.services';
import { getSessionMoney } from '../services/session-money.services';
import { previewGrade10, commitGrade10, Grade10Error } from '../services/grade10.services';
import { notifySessionOpened, notifySessionClosed, getStudentAndParentBroadcastIds } from '../services/notification.services';
import { logAction, extractAuditContext } from '../services/audit.services';

/** The status a refusal answers with, from the error the service threw. */
function failure(err: unknown, fallback: string) {
  const message = clientMessage(err, fallback);
  const status = err instanceof sessionService.SessionError || err instanceof seriesService.SeriesError
    || err instanceof offerService.OfferError || err instanceof Grade10Error
    ? err.status
    : seriesService.seriesRuleSentence(err) ? 409 : 400;
  return { message: seriesService.seriesRuleSentence(err) ?? message, status: status as 400 | 403 | 404 | 409 };
}

const STAFF_READ = [ROLES.ADMIN, ROLES.COORDINATOR, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN] as const;
const LINKS_SHEET = [ROLES.ADMIN, ROLES.COORDINATOR] as const;
const MONEY_READ = [ROLES.ADMIN, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN] as const;

export const sessions = new Hono<HonoEnv>()
  .use('*', requireAuth())

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

  /** LIST SESSIONS — with their series, subjects and money summary (§4.1). */
  .get('/',
    requireRole(...STAFF_READ),
    zValidator('query', ListSessionsQuery),
    async (c) => success(c, await sessionService.getSessions(c.req.valid('query')))
  )

  /** A SESSION'S HEADER — with the series its items are entered in (§4.2). */
  .get('/:id',
    requireRole(...STAFF_READ),
    zValidator('param', SessionId),
    async (c) => {
      const found = await sessionService.getSessionDetail(c.req.valid('param').id);
      if (!found) return error(c, 'Session not found', 404);
      return success(c, found);
    }
  )

  /**
   * CREATE A SESSION — type, year, reserve from, reserve to, course starts, payment due; the
   * name and refund policy follow; `copyFromSessionId` brings an earlier session's offers.
   */
  .post('/',
    requireAdmin(),
    zValidator('json', CreateSession),
    async (c) => {
      try {
        const created = await sessionService.createSession(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c));
        return success(c, created, 201);
      } catch (err) {
        const f = failure(err, 'Failed to create session');
        return error(c, f.message, f.status);
      }
    }
  )

  /** CHANGE A SESSION'S HEADER (draft: any; open: end with a reason, course start, payment due, refund policy until a consent). */
  .put('/:id',
    requireAdmin(),
    zValidator('param', SessionId),
    zValidator('json', UpdateSession),
    async (c) => {
      try {
        return success(c, await sessionService.updateSession(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to update session');
        return error(c, f.message, f.status);
      }
    }
  )

  /** COPY AN EARLIER SESSION'S OFFERS (board fees provisional). */
  .post('/:id/copy-from',
    requireAdmin(),
    zValidator('param', SessionId),
    zValidator('json', CopySessionFrom),
    async (c) => {
      try {
        return success(c, await sessionService.copySessionFrom(c.req.valid('param').id, c.req.valid('json').fromSessionId, c.get('user')!.id));
      } catch (err) {
        const f = failure(err, 'Failed to copy the session');
        return error(c, f.message, f.status);
      }
    }
  )

  /** The board series a session's items are entered in (derived; read only since the rework). */
  .get('/:id/board-series',
    requireRole(...LINKS_SHEET),
    zValidator('param', SessionId),
    async (c) => {
      try {
        return success(c, await seriesService.getWindowSeries(c.req.valid('param').id));
      } catch (err) {
        const f = failure(err, 'Failed to load the session\'s series');
        return error(c, f.message, f.status);
      }
    }
  )

  /** Move lines to another series of their board in the session (admin; behind the item's series). */
  .post('/:id/board-series/move',
    requireAdmin(),
    zValidator('param', SessionId),
    zValidator('json', MoveRegistrationsToSeries),
    async (c) => {
      try {
        return success(c, await seriesService.moveRegistrations(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to move the registrations');
        return error(c, f.message, f.status);
      }
    }
  )

  /**
   * CORRECT A SESSION'S EXAM SERIES (F0a)
   * PUT /sessions/:id/series  { sessionType, seriesYear, reason }
   *
   * Admin only, any status. Waiting registrations students may no longer sit
   * under the corrected series expire; their open checkouts are closed with
   * any escrow returned, and families told.
   */
  .put('/:id/series',
    requireAdmin(),
    zValidator('param', SessionId),
    zValidator('json', CorrectSessionSeries),
    async (c) => {
      const { id } = c.req.valid('param');
      try {
        const { session, expired } = await sessionService.correctSessionSeries(id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c));
        const paymentsClosed = expired.length
          ? await closePaymentsOfExpiredRegistrations(expired.map((r) => r.id), 'series_corrected').catch((err) => {
              console.error('[session:series] Closing checkouts failed; the recovery sweep will retry:', err);
              return 0;
            })
          : 0;
        return success(c, { ...session, registrationsExpired: expired.length, paymentsClosed });
      } catch (err) {
        const message = clientMessage(err, 'Failed to correct the series');
        return error(c, message, message.includes('not found') ? 404 : message.includes('already') ? 409 : 400);
      }
    }
  )

  /** OPEN A DRAFT SESSION BY HAND (its capture runs; a series past its deadline refunds, MO-21). */
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

  /** CLOSE A SESSION EARLY. */
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
      // No grade moves at a close (F0a): a grade is derived from the cohort
      // and the series' academic year (STATE_AUDIT.md ST-13).
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
  )

  // ─── The links sheet: offers, teachers, items (§4.2) ───────────────────────

  .get('/:id/offers',
    requireRole(...LINKS_SHEET),
    zValidator('param', SessionId),
    async (c) => {
      try {
        return success(c, await offerService.listOffers(c.req.valid('param').id));
      } catch (err) {
        const f = failure(err, 'Failed to load the session\'s subjects');
        return error(c, f.message, f.status);
      }
    }
  )

  .get('/:id/offers/addable',
    requireRole(...LINKS_SHEET),
    zValidator('param', SessionId),
    async (c) => success(c, await offerService.addableSubjects(c.req.valid('param').id))
  )

  .post('/:id/offers',
    requireRole(...LINKS_SHEET),
    zValidator('param', SessionId),
    zValidator('json', CreateOffer),
    async (c) => {
      try {
        return success(c, await offerService.createOffer(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
      } catch (err) {
        const f = failure(err, 'Failed to add the subject');
        return error(c, f.message, f.status);
      }
    }
  )

  .put('/:id/offers/:offerId',
    requireRole(...LINKS_SHEET),
    zValidator('param', OfferParam),
    zValidator('json', UpdateOffer),
    async (c) => {
      const { id, offerId } = c.req.valid('param');
      try {
        return success(c, await offerService.updateOffer(id, offerId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to update the subject');
        return error(c, f.message, f.status);
      }
    }
  )

  .delete('/:id/offers/:offerId',
    requireRole(...LINKS_SHEET),
    zValidator('param', OfferParam),
    async (c) => {
      const { id, offerId } = c.req.valid('param');
      try {
        return success(c, await offerService.deleteOffer(id, offerId, c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to remove the subject');
        return error(c, f.message, f.status);
      }
    }
  )

  .post('/:id/offers/:offerId/replace-teacher',
    requireRole(...LINKS_SHEET),
    zValidator('param', OfferParam),
    zValidator('json', ReplaceOfferTeacher),
    async (c) => {
      const { id, offerId } = c.req.valid('param');
      try {
        return success(c, await offerService.replaceTeacher(id, offerId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to replace the teacher');
        return error(c, f.message, f.status);
      }
    }
  )

  .post('/:id/offers/:offerId/items',
    requireRole(...LINKS_SHEET),
    zValidator('param', OfferParam),
    zValidator('json', OfferItemInput),
    async (c) => {
      const { id, offerId } = c.req.valid('param');
      try {
        return success(c, await offerService.createItem(id, offerId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
      } catch (err) {
        const f = failure(err, 'Failed to add the item');
        return error(c, f.message, f.status);
      }
    }
  )

  .put('/:id/offers/:offerId/items/:itemId',
    requireRole(...LINKS_SHEET),
    zValidator('param', OfferItemParam),
    zValidator('json', UpdateOfferItem),
    async (c) => {
      const { id, offerId, itemId } = c.req.valid('param');
      try {
        return success(c, await offerService.updateItem(id, offerId, itemId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to update the item');
        return error(c, f.message, f.status);
      }
    }
  )

  .delete('/:id/offers/:offerId/items/:itemId',
    requireRole(...LINKS_SHEET),
    zValidator('param', OfferItemParam),
    async (c) => {
      const { id, offerId, itemId } = c.req.valid('param');
      try {
        return success(c, await offerService.deleteItem(id, offerId, itemId, c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to remove the item');
        return error(c, f.message, f.status);
      }
    }
  )

  // ─── The session's money (§4.6, lines only) ──────────────────────────────

  .get('/:id/money',
    requireRole(...MONEY_READ),
    zValidator('param', SessionId),
    zValidator('query', SessionMoneyQuery),
    async (c) => {
      const money = await getSessionMoney(c.req.valid('param').id, c.req.valid('query'));
      if (!money) return error(c, 'Session not found', 404);
      return success(c, money);
    }
  )

  // ─── Grade 10 registered by the school (A-15) ─────────────────────────────

  .post('/:id/grade10/preview',
    requireRole(...LINKS_SHEET),
    zValidator('param', SessionId),
    zValidator('json', Grade10Bulk),
    async (c) => {
      try {
        return success(c, await previewGrade10(c.req.valid('param').id, c.req.valid('json').studentIds));
      } catch (err) {
        const f = failure(err, 'Failed to preview grade 10');
        return error(c, f.message, f.status);
      }
    }
  )

  .post('/:id/grade10/commit',
    requireRole(...LINKS_SHEET),
    zValidator('param', SessionId),
    zValidator('json', Grade10Bulk),
    async (c) => {
      try {
        return success(c, await commitGrade10(c.req.valid('param').id, c.req.valid('json').studentIds, c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to register grade 10');
        return error(c, f.message, f.status);
      }
    }
  );

export type SessionsApi = typeof sessions;
