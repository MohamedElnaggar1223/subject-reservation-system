/**
 * A session's set-up as the coordinator works (COORDINATOR_REWORK.md B1, Appendix A), mounted at
 * /v1/sessions beside session.routes.ts.
 *
 * Coordinator and admin (finance roles read the GETs, B3):
 * - POST   /sessions/:id/offerings                 — a subject from the reference list, not on the list, or a copy
 * - GET    /sessions/:id/offerings/:offeringId      — the subject editor's read
 * - PUT    /sessions/:id/offerings/:offeringId      — the subject editor's save (impact first)
 * - DELETE /sessions/:id/offerings/:offeringId      — refused while reservations exist
 * - POST   /sessions/:id/price-lists/parse          — a list as printed, matched (writes nothing)
 * - POST   /sessions/:id/price-lists                — applied (impact first)
 * - GET    /sessions/:id/prices                     — every row's exam fee; the missing prices
 * - PUT    /sessions/:id/rows/:rowId/exam-fee       — typed, the board rule or the units' sum (impact first)
 * - GET    /sessions/:id/preview?as=&offeringId=    — the family payload for a first-timer or a retaker
 * - GET    /sessions/:id/reservations (+ ?format=csv) — who reserved what, paid or not, the answers
 *
 * A route that changes prices or closes something answers `{ saved: false, impact }` first; the client
 * sends the same counts back as `expected` (409 IMPACT_CHANGED if they moved).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  ROLES, SessionId, AddOffering, UpdateOffering, OfferingParam, RowParam, ParsePriceList, ApplyPriceList, SetRowExamFee,
  SessionPreviewQuery, SessionReservationsQuery,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireRole } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import { addOffering, getOffering, updateOffering, deleteOffering, SetupError } from '../services/setup/offering.services';
import { parsePriceList, applyPriceList, sessionPrices, setRowExamFee } from '../services/setup/price-list.services';
import { sessionReservations, sessionReservationsCsv } from '../services/setup/reservations.services';
import { ImpactChanged } from '../services/setup/reprice.services';
import { PricingError } from '../services/pricing.services';
import { familyOfferings } from '../services/offers-read.services';

const SET_UP = [ROLES.ADMIN, ROLES.COORDINATOR] as const;
const SET_UP_READ = [ROLES.ADMIN, ROLES.COORDINATOR, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN] as const;

function fail(err: unknown, fallback: string) {
  const status = err instanceof SetupError || err instanceof ImpactChanged || err instanceof PricingError ? err.status : 400;
  return { message: clientMessage(err, fallback), status: status as 400 | 403 | 404 | 409 };
}

export const setupRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .post('/:id/offerings',
    requireRole(...SET_UP),
    zValidator('param', SessionId),
    zValidator('json', AddOffering),
    async (c) => {
      try {
        return success(c, await addOffering(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)), 201);
      } catch (err) {
        const f = fail(err, 'Failed to add the subject');
        return error(c, f.message, f.status);
      }
    })

  .get('/:id/offerings/:offeringId',
    requireRole(...SET_UP_READ),
    zValidator('param', OfferingParam),
    async (c) => {
      const { id, offeringId } = c.req.valid('param');
      try {
        return success(c, await getOffering(id, offeringId));
      } catch (err) {
        const f = fail(err, 'Failed to load the subject');
        return error(c, f.message, f.status);
      }
    })

  .put('/:id/offerings/:offeringId',
    requireRole(...SET_UP),
    zValidator('param', OfferingParam),
    zValidator('json', UpdateOffering),
    async (c) => {
      const { id, offeringId } = c.req.valid('param');
      try {
        const saved = await updateOffering(id, offeringId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c));
        return success(c, { saved: saved.saved, impact: saved.impact, offering: await getOffering(id, offeringId) });
      } catch (err) {
        const f = fail(err, 'Failed to save the subject');
        return error(c, f.message, f.status);
      }
    })

  .delete('/:id/offerings/:offeringId',
    requireRole(...SET_UP),
    zValidator('param', OfferingParam),
    async (c) => {
      const { id, offeringId } = c.req.valid('param');
      try {
        return success(c, await deleteOffering(id, offeringId, c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = fail(err, 'Failed to remove the subject');
        return error(c, f.message, f.status);
      }
    })

  .post('/:id/price-lists/parse',
    requireRole(...SET_UP),
    zValidator('param', SessionId),
    zValidator('json', ParsePriceList),
    async (c) => {
      const body = c.req.valid('json');
      try {
        return success(c, await parsePriceList(c.req.valid('param').id, body.board, body.text));
      } catch (err) {
        const f = fail(err, 'Failed to read the list');
        return error(c, f.message, f.status);
      }
    })

  .post('/:id/price-lists',
    requireRole(...SET_UP),
    zValidator('param', SessionId),
    zValidator('json', ApplyPriceList),
    async (c) => {
      try {
        return success(c, await applyPriceList(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = fail(err, 'Failed to apply the list');
        return error(c, f.message, f.status);
      }
    })

  .get('/:id/prices',
    requireRole(...SET_UP_READ),
    zValidator('param', SessionId),
    async (c) => {
      try {
        return success(c, await sessionPrices(c.req.valid('param').id));
      } catch (err) {
        const f = fail(err, 'Failed to load the prices');
        return error(c, f.message, f.status);
      }
    })

  .put('/:id/rows/:rowId/exam-fee',
    requireRole(...SET_UP),
    zValidator('param', RowParam),
    zValidator('json', SetRowExamFee),
    async (c) => {
      const { id, rowId } = c.req.valid('param');
      try {
        return success(c, await setRowExamFee(id, rowId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = fail(err, 'Failed to set the exam fee');
        return error(c, f.message, f.status);
      }
    })

  .get('/:id/preview',
    requireRole(...SET_UP_READ),
    zValidator('param', SessionId),
    zValidator('query', SessionPreviewQuery),
    async (c) => {
      const q = c.req.valid('query');
      try {
        const read = await familyOfferings(c.req.valid('param').id, { preview: q.as, ...(q.offeringId ? { offeringId: q.offeringId } : {}) });
        if (!read) return error(c, 'Session not found', 404);
        return success(c, { as: q.as, ...read });
      } catch (err) {
        const f = fail(err, 'Failed to build the preview');
        return error(c, f.message, f.status);
      }
    })

  .get('/:id/reservations',
    requireRole(...SET_UP_READ),
    zValidator('param', SessionId),
    zValidator('query', SessionReservationsQuery),
    async (c) => {
      const { id } = c.req.valid('param');
      try {
        const r = await sessionReservations(id);
        if (c.req.valid('query').format === 'csv') {
          // A text body (typed as such), so the JSON answer below keeps its RPC type.
          return c.text(sessionReservationsCsv(r), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="reservations-${id}.csv"` });
        }
        return success(c, r);
      } catch (err) {
        const f = fail(err, 'Failed to load the reservations');
        return error(c, f.message, f.status);
      }
    });

export type SetupApi = typeof setupRoutes;
