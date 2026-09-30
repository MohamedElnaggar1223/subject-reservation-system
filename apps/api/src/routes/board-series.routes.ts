/**
 * Board series (FEATURES_PLAN.md F0b), mounted at /v1/board-series.
 *
 * Read (admin, the coordinator, the desk: the finance workbench shows each
 * payment's deadline): every series with its dates, the windows feeding it,
 * and what its deadline would close.
 * Change (the coordinator and admin): a series and its dates. The exam
 * board's entry deadline — the school's hard stop, which closes money
 * (owner decision MO-10) — is the admin's alone; the handler refuses anyone
 * else with a sentence.
 * The windows' side (which series a window feeds) is under
 * /v1/sessions/:id/board-series.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ROLES, IdParam, CreateBoardSeries, UpdateBoardSeries, ListBoardSeriesQuery, MarkInferredChecked } from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireAcademic, requireRole } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { extractAuditContext } from '../services/audit.services';
import * as series from '../services/series.services';

const fail = (err: unknown, fallback: string) => ({
  message: clientMessage(err, fallback),
  status: err instanceof series.SeriesError ? err.status : 400,
});

export const boardSeriesRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/',
    requireRole(ROLES.ADMIN, ROLES.COORDINATOR, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN),
    zValidator('query', ListBoardSeriesQuery),
    async (c) => success(c, await series.listBoardSeries(c.req.valid('query'))))

  // What the F0b migration inferred (a registration entered with the board that
  // sits its window's month, not its subject's old board), for staff to check.
  .get('/inferred',
    requireRole(ROLES.ADMIN, ROLES.COORDINATOR, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN),
    async (c) => success(c, await series.listInferredRoutings()))

  .post('/inferred/checked', requireAcademic(), zValidator('json', MarkInferredChecked), async (c) => {
    try {
      return success(c, await series.markInferredChecked(c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to record the check');
      return error(c, f.message, f.status);
    }
  })

  .post('/', requireAcademic(), zValidator('json', CreateBoardSeries), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await series.createBoardSeries(c.req.valid('json'), user.id, user.role, extractAuditContext(c)), 201);
    } catch (err) {
      const f = fail(err, 'Failed to add the series');
      return error(c, f.message, f.status);
    }
  })

  .put('/:id', requireAcademic(), zValidator('param', IdParam), zValidator('json', UpdateBoardSeries), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await series.updateBoardSeries(c.req.valid('param').id, c.req.valid('json'), user.id, user.role, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to save the series');
      return error(c, f.message, f.status);
    }
  })

  .delete('/:id', requireAcademic(), zValidator('param', IdParam), async (c) => {
    try {
      return success(c, await series.deleteBoardSeries(c.req.valid('param').id, c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to remove the series');
      return error(c, f.message, f.status);
    }
  });

export type BoardSeriesApi = typeof boardSeriesRoutes;
