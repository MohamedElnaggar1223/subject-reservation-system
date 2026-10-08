/**
 * The boards' fee grids per series (RESERVATIONS_REWORK.md §3.4, §4.2 Fees tab, §5).
 *
 * - GET  /board-fees?seriesId=                 admin, finance admin, coordinator (read)
 * - PUT  /board-fees?seriesId=                 admin, finance admin — set rows (new rows; provisional amounts)
 * - POST /board-fees/:seriesId/confirm         admin, finance admin — the board published
 * - POST /board-fees/:seriesId/reprice         admin, finance admin — re-price unpaid lines (board part)
 * - POST /board-fees/:seriesId/copy            admin, finance admin — an earlier series' grid, provisional
 * - POST /board-fees/:seriesId/parse           admin, finance admin — match pasted fee-list rows
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  BoardFeesQuery, BoardFeeSeriesParam, PutBoardFees, ConfirmBoardFees, RepriceBoardFees, CopyBoardFees, ParseBoardFees, ROLES,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireRole } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as fees from '../services/board-fee.services';
import { extractAuditContext } from '../services/audit.services';

const WRITE = [ROLES.ADMIN, ROLES.FINANCE_ADMIN] as const;
const READ = [ROLES.ADMIN, ROLES.FINANCE_ADMIN, ROLES.COORDINATOR] as const;

const failure = (err: unknown, fallback: string) => ({
  message: clientMessage(err, fallback),
  status: (err instanceof fees.BoardFeeError ? err.status : 400) as 400 | 404 | 409,
});

export const boardFeeRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/',
    requireRole(...READ),
    zValidator('query', BoardFeesQuery),
    async (c) => {
      try {
        return success(c, await fees.getFeeGrid(c.req.valid('query').seriesId));
      } catch (err) {
        const f = failure(err, 'Failed to load the fee grid');
        return error(c, f.message, f.status);
      }
    }
  )

  .put('/',
    requireRole(...WRITE),
    zValidator('query', BoardFeesQuery),
    zValidator('json', PutBoardFees),
    async (c) => {
      try {
        return success(c, await fees.putFees(c.req.valid('query').seriesId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to save the fees');
        return error(c, f.message, f.status);
      }
    }
  )

  .post('/:seriesId/confirm',
    requireRole(...WRITE),
    zValidator('param', BoardFeeSeriesParam),
    zValidator('json', ConfirmBoardFees),
    async (c) => {
      try {
        return success(c, await fees.confirmFees(c.req.valid('param').seriesId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to confirm the fees');
        return error(c, f.message, f.status);
      }
    }
  )

  .post('/:seriesId/reprice',
    requireRole(...WRITE),
    zValidator('param', BoardFeeSeriesParam),
    zValidator('json', RepriceBoardFees),
    async (c) => {
      try {
        return success(c, await fees.repriceLines(c.req.valid('param').seriesId, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to re-price the lines');
        return error(c, f.message, f.status);
      }
    }
  )

  .post('/:seriesId/copy',
    requireRole(...WRITE),
    zValidator('param', BoardFeeSeriesParam),
    zValidator('json', CopyBoardFees),
    async (c) => {
      try {
        return success(c, await fees.copyFees(c.req.valid('param').seriesId, c.req.valid('json').fromSeriesId, c.get('user')!.id, extractAuditContext(c)));
      } catch (err) {
        const f = failure(err, 'Failed to copy the fees');
        return error(c, f.message, f.status);
      }
    }
  )

  .post('/:seriesId/parse',
    requireRole(...WRITE),
    zValidator('param', BoardFeeSeriesParam),
    zValidator('json', ParseBoardFees),
    async (c) => {
      try {
        return success(c, await fees.parseFees(c.req.valid('param').seriesId, c.req.valid('json').text));
      } catch (err) {
        const f = failure(err, 'Failed to read the pasted rows');
        return error(c, f.message, f.status);
      }
    }
  );

export type BoardFeeApi = typeof boardFeeRoutes;
