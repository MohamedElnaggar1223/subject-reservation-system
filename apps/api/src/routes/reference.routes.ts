/**
 * The reference data (COORDINATOR_REWORK.md §7, D1; Appendix A), mounted at /v1/reference: read by the
 * coordinator and the admin to pick subjects, and by finance (B3). Loaded by the seed; never edited here.
 *
 * - GET /reference/boards              — the boards with their rules and sittings (board dates)
 * - GET /reference/subjects?board=     — the subjects with code, name, group and their suggested rows
 * Admin:
 * - PUT /reference/sittings/:id/board-date — C6: a sitting's missing board entry deadline, entered once
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ROLES, ReferenceSubjectsQuery, EnterBoardDate, SittingParam } from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireRole, requireAdmin } from '../middleware/access-control.middleware';
import { extractAuditContext } from '../services/audit.services';
import type { HonoEnv } from '../lib/types';
import { referenceBoards, referenceSubjects, enterBoardDate } from '../services/setup/reference.services';
import { SetupError } from '../services/setup/offering.services';

const READ = [ROLES.ADMIN, ROLES.COORDINATOR, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN] as const;

function fail(err: unknown, fallback: string) {
  return { message: clientMessage(err, fallback), status: (err instanceof SetupError ? err.status : 400) as 400 | 403 | 404 | 409 };
}

export const referenceRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())
  .get('/boards', requireRole(...READ), async (c) => success(c, await referenceBoards()))
  .get('/subjects', requireRole(...READ), zValidator('query', ReferenceSubjectsQuery), async (c) => success(c, await referenceSubjects(c.req.valid('query').board)))
  .put('/sittings/:id/board-date', requireAdmin(), zValidator('param', SittingParam), zValidator('json', EnterBoardDate), async (c) => {
    try {
      return success(c, await enterBoardDate(c.req.valid('param').id, c.req.valid('json'), c.get('user')!.id, extractAuditContext(c)));
    } catch (err) {
      const f = fail(err, 'Failed to enter the board date');
      return error(c, f.message, f.status);
    }
  });

export type ReferenceApi = typeof referenceRoutes;
