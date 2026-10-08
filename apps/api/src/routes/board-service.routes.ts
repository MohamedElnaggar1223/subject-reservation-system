/**
 * Board Service API Routes (RESERVATIONS_REWORK.md §3.6, §5)
 *
 * GET /board-services?boardCode=&boardSeriesId=  - The boards' services (with a series' fees and deadlines when named): everyone signed in reads
 * PUT /board-services/deadlines                  - A series' service deadlines (admin, coordinator)
 * PUT /board-services/fees                       - A series' service fees per level (admin, finance admin)
 * PUT /board-services/:id                        - A service's label, whether a family may ask for it, whether it is offered (admin, coordinator)
 * PUT /board-services/:id/refund-rule            - Its refund rule on a changed grade, a money rule (admin, finance admin)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { BoardServiceId, BoardServicesQuery, PutServiceDeadlines, PutServiceFees, UpdateBoardService, ServiceRefundRule, ROLES } from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireRole, requireFinanceAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as svc from '../services/board-service.services';
import { extractAuditContext } from '../services/audit.services';

const statusOf = (err: unknown) => (err instanceof svc.BoardServiceError ? err.status : 400);

export const boardServices = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/', zValidator('query', BoardServicesQuery), async (c) => {
    try {
      return success(c, await svc.listBoardServices(c.req.valid('query')));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to list board services'), statusOf(err));
    }
  })

  .put('/deadlines', requireRole(ROLES.ADMIN, ROLES.COORDINATOR), zValidator('json', PutServiceDeadlines), async (c) => {
    try {
      return success(c, await svc.putServiceDeadlines(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to set the deadlines'), statusOf(err));
    }
  })

  .put('/fees', requireFinanceAdmin(), zValidator('json', PutServiceFees), async (c) => {
    try {
      return success(c, await svc.putServiceFees(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to set the fees'), statusOf(err));
    }
  })

  // The refund rule on a changed grade is a money rule: the finance admin's and the admin's.
  .put('/:id/refund-rule', requireFinanceAdmin(), zValidator('param', BoardServiceId), zValidator('json', ServiceRefundRule), async (c) => {
    try {
      return success(c, await svc.updateBoardService(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to change the refund rule'), statusOf(err));
    }
  })

  .put('/:id', requireRole(ROLES.ADMIN, ROLES.COORDINATOR), zValidator('param', BoardServiceId), zValidator('json', UpdateBoardService), async (c) => {
    try {
      return success(c, await svc.updateBoardService(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to update the service'), statusOf(err));
    }
  });

export type BoardServicesApi = typeof boardServices;
