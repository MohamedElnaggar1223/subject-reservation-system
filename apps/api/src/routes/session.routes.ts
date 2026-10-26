/**
 * Registration sessions (RESERVATIONS_REWORK.md §4.1, §4.2, §5; docs/features/RESERVATIONS.md §2.9).
 *
 * Any signed-in user:
 * - GET  /sessions/active, /sessions/upcoming
 * Admin; coordinator and finance read:
 * - GET  /sessions, /sessions/:id      — with the coordinator rework: the settings families agree to, the
 *                                        check list, the counts and the subjects
 * Admin and coordinator (the coordinator rework, B1; COORDINATOR_REWORK.md Appendix A):
 * - POST /sessions                     — a type and a year, empty or copied with the years moved forward
 *                                        (the deprecated legacy contract: with its dates)
 * - PUT  /sessions/:id                 — the header and what families agree to (a share change answers its impact)
 * - POST /sessions/:id/open, /reopen    — the Accepting switch (its close is the admin's until P1b:
 *                                        today's close still expires waiting lines)
 * - PUT  /sessions/:id/prices-final    — one-way once a line exists (impact first)
 *   (offerings, price lists, prices, the preview, the reservations: setup.routes.ts)
 * Admin:
 * - POST /sessions/:id/copy-from       — deprecated: offers of an earlier session of the same kind
 * - PUT  /sessions/:id/series          — correct the exam series (F0a)
 * - POST /sessions/:id/activate        — deprecated: the old screen's open (the new switch is /open)
 * - POST /sessions/:id/board-series/move — lines to another series (behind the item's series)
 * Admin and coordinator — the links sheet:
 * - GET  /sessions/:id/board-series    — the series its items are entered in (derived, read only)
 * - GET  /sessions/:id/offers, /offers/addable; POST /offers; PUT/DELETE /offers/:offerId;
 *   POST /offers/:offerId/replace-teacher; POST /offers/:offerId/items; PUT/DELETE …/items/:itemId
 * - PUT  /sessions/:id/offers/:offerId/form — one subject's whole form, one transaction (F6a)
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
  DeleteSession,
  SessionId,
  ListSessionsQuery,
  CorrectSessionSeries,
  CopySessionFrom,
  MoveRegistrationsToSeries,
  CreateOffer,
  UpdateOffer,
  OfferForm,
  UpdateOfferItem,
  OfferItemInput,
  ReplaceOfferTeacher,
  OfferParam,
  OfferItemParam,
  Grade10Bulk,
  SessionMoneyQuery,
  SessionReason,
  PricesFinal,
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
import { StudentsKeptChanging } from '../lib/student-locks';
import * as setup from '../services/setup/session-setup.services';
import { SetupError } from '../services/setup/offering.services';
import { ImpactChanged } from '../services/setup/reprice.services';

/** The status a refusal answers with, from the error the service threw. */
function failure(err: unknown, fallback: string) {
  const message = clientMessage(err, fallback);
  const status = err instanceof sessionService.SessionError || err instanceof seriesService.SeriesError
    || err instanceof offerService.OfferError || err instanceof Grade10Error || err instanceof StudentsKeptChanging
    || err instanceof SetupError || err instanceof ImpactChanged
    ? err.status
    : seriesService.seriesRuleSentence(err) ? 409 : 400;
  return { message: seriesService.seriesRuleSentence(err) ?? message, status: status as 400 | 403 | 404 | 409 };
}

const STAFF_READ = [ROLES.ADMIN, ROLES.COORDINATOR, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN] as const;
const LINKS_SHEET = [ROLES.ADMIN, ROLES.COORDINATOR] as const;
/** The coordinator rework (B1): all of set-up is the coordinator's and the admin's. */
const SET_UP = [ROLES.ADMIN, ROLES.COORDINATOR] as const;
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
      const { db } = await import('@repo/db');
      return success(c, { ...found, ...(await setup.sessionSetupView(db, found)) });
    }
  )

  /**
   * CREATE A SESSION (C1–C3) — a type and a year; the name derived; empty, or `copyFromSessionId` copied
   * with every year moved forward; born a draft. With `startDate` (deprecated): the legacy contract.
   */
  .post('/',
    requireRole(...SET_UP),
    zValidator('json', CreateSession),
    async (c) => {
      try {
        const body = c.req.valid('json');
        if (body.startDate) {
          const created = await sessionService.createSession(body as sessionService.LegacyCreateSession, c.get('user')!.id, extractAuditContext(c));
          return success(c, { ...created, copy: null }, 201);
        }
        const created = await setup.createSetupSession({ type: body.type, year: body.year, label: body.label, copyFromSessionId: body.copyFromSessionId }, c.get('user')!.id, extractAuditContext(c));
        return success(c, created, 201);
      } catch (err) {
        const f = failure(err, 'Failed to create session');
        return error(c, f.message, f.status);
      }
    }
  )

  /**
   * THE HEADER AND WHAT FAMILIES AGREE TO — the close date, payment due, first lesson, self-study share,
   * grades, cancel days, refund policy (until a consent), the session's questions. A share change answers
   * its impact first: `{ saved: false, impact }` until the same counts come back as `expected`.
   */
  .put('/:id',
    requireRole(...SET_UP),
    zValidator('param', SessionId),
    zValidator('json', UpdateSession),
    async (c) => {
      const { id } = c.req.valid('param');
      try {
        const saved = await setup.updateSetupSession(id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c));
        const now = await sessionService.getSessionById(id);
        return success(c, { ...now!, ...saved });
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
        if (err instanceof sessionService.SessionError) return error(c, message, err.status);
        if (err instanceof StudentsKeptChanging) return error(c, message, err.status);
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

  /**
   * DELETE A DRAFT SESSION (F8-01): admin only, with a reason; refused for a session that is open or closed, or
   * that has reservations, granted exceptions or sent reminders. Its sheet goes with it; one audit row.
   */
  .delete('/:id',
    requireAdmin(),
    zValidator('param', SessionId),
    zValidator('json', DeleteSession),
    async (c) => {
      try {
        return success(c, await sessionService.deleteDraftSession(c.req.valid('param').id, c.req.valid('json').reason, c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to delete the session');
        return error(c, f.message, f.status);
      }
    }
  )

  /** CLOSE A SESSION — the Accepting switch off (C4); the coordinator's and the admin's. */
  // The admin's alone until P1b: today's close still expires the waiting lines (C10 moves that to the cut-off).
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

  /** OPEN — the Accepting switch on (C4): a draft opens, refused while the check list blocks it. */
  .post('/:id/open',
    requireRole(...SET_UP),
    zValidator('param', SessionId),
    async (c) => {
      try {
        return success(c, await setup.openSetupSession(c.req.valid('param').id, c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to open the session');
        return error(c, f.message, f.status);
      }
    }
  )

  /** REOPEN — a closed session opens again (§9.1: closed → active). */
  .post('/:id/reopen',
    requireRole(...SET_UP),
    zValidator('param', SessionId),
    zValidator('json', SessionReason),
    async (c) => {
      try {
        return success(c, await setup.reopenSetupSession(c.req.valid('param').id, c.get('user')!.id, c.req.valid('json').reason, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to reopen the session');
        return error(c, f.message, f.status);
      }
    }
  )

  /**
   * PRICES FINAL (E6) — families may reserve before it and pay only once it is on; one-way once a line
   * exists. Switching it on makes the waiting lines payable and re-dates them: its impact answered first.
   */
  .put('/:id/prices-final',
    requireRole(...SET_UP),
    zValidator('param', SessionId),
    zValidator('json', PricesFinal),
    async (c) => {
      const { id } = c.req.valid('param');
      try {
        const saved = await setup.setPricesFinal(id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c));
        const now = await sessionService.getSessionById(id);
        return success(c, { ...now!, ...saved });
      } catch (err) {
        const f = failure(err, 'Failed to change prices final');
        return error(c, f.message, f.status);
      }
    }
  )

  // ─── The links sheet: offers, teachers, items (§4.2) — deprecated by the coordinator rework ─────
  // The old screen's routes keep working until P2 replaces it (the new subject editor is
  // /sessions/:id/offerings, setup.routes.ts); items made here are priced from their fee keys.

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

  /**
   * PUT /sessions/:id/offers/:offerId/form (F6a, docs/features/SESSION_WORDS.md) — one subject's
   * form on the links sheet, saved whole in one transaction: who teaches it, how it is offered, the
   * course fee, its papers, routes, units and qualifications, the grade-10 core, the course start
   * and the notes. Only what differs is written; the same form twice changes nothing.
   */
  .put('/:id/offers/:offerId/form',
    requireRole(...LINKS_SHEET),
    zValidator('param', OfferParam),
    zValidator('json', OfferForm),
    async (c) => {
      const { id, offerId } = c.req.valid('param');
      try {
        return success(c, await offerService.saveOfferForm(id, offerId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to save the subject');
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
