/**
 * Exception API Routes (V3 §6.3)
 *
 * GET  /exceptions            - List exceptions (finance admin)
 * POST /exceptions            - Grant an exception (finance admin)
 * POST /exceptions/:id/revoke - Revoke an active exception (finance admin)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { CreateException, ExceptionId, ListExceptionsQuery } from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireFinanceAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as exceptionService from '../services/exception.services';
import { logAction, extractAuditContext } from '../services/audit.services';

export const exceptions = new Hono<HonoEnv>()
  .use('*', requireAuth())
  .use('*', requireFinanceAdmin())

  .get('/', zValidator('query', ListExceptionsQuery), async (c) => {
    const filters = c.req.valid('query');
    return success(c, await exceptionService.getExceptions(filters));
  })

  .post('/', zValidator('json', CreateException), async (c) => {
    const user = c.get('user')!;
    const data = c.req.valid('json');
    try {
      const created = await exceptionService.grantException(data, user.id);
      logAction(user.id, 'EXCEPTION_GRANTED', 'exception', created!.id, null, created as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] EXCEPTION_GRANTED failed:', err));
      return success(c, created, 201);
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to grant exception'), 400);
    }
  })

  .post('/:id/revoke', zValidator('param', ExceptionId), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    try {
      const updated = await exceptionService.revokeException(id, user.id);
      logAction(user.id, 'EXCEPTION_REVOKED', 'exception', id, null, updated as Record<string, unknown>, extractAuditContext(c))
        .catch((err) => console.error('[audit] EXCEPTION_REVOKED failed:', err));
      return success(c, updated);
    } catch (err) {
      const message = clientMessage(err, 'Failed to revoke exception');
      return error(c, message, message.includes('not found') ? 404 : 400);
    }
  });

export type ExceptionsApi = typeof exceptions;
