/**
 * Exception API Routes (V3 §6.3, F0a)
 *
 * GET  /exceptions            - List the exceptions of the types the caller may grant
 * POST /exceptions            - Grant an exception
 * POST /exceptions/:id/revoke - Revoke an active exception
 *
 * The role gate lets in every role that may grant some type (finance
 * admin, coordinator, admin); the handler checks the type's own roles
 * (EXCEPTION_GRANT_ROLES): a coordinator is refused a fee waiver, a
 * finance admin the grade-10 exception.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { CreateException, ExceptionId, ListExceptionsQuery, EXCEPTION_ROLES } from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireRole } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as exceptionService from '../services/exception.services';
import { closePaymentsOfExpiredRegistrations } from '../services/payment.services';
import { extractAuditContext } from '../services/audit.services';

const statusOf = (err: unknown) => (err instanceof exceptionService.ExceptionError ? err.status : 400);

export const exceptions = new Hono<HonoEnv>()
  .use('*', requireAuth())
  .use('*', requireRole(...EXCEPTION_ROLES))

  .get('/', zValidator('query', ListExceptionsQuery), async (c) => {
    const filters = c.req.valid('query');
    return success(c, await exceptionService.getExceptions(filters, c.get('user')!.role));
  })

  .post('/', zValidator('json', CreateException), async (c) => {
    const user = c.get('user')!;
    const data = c.req.valid('json');
    try {
      const created = await exceptionService.grantException(data, { id: user.id, role: user.role }, extractAuditContext(c));
      return success(c, created, 201);
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to grant exception'), statusOf(err));
    }
  })

  .post('/:id/revoke', zValidator('param', ExceptionId), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    try {
      const { exception, expired } = await exceptionService.revokeException(id, { id: user.id, role: user.role }, extractAuditContext(c));
      if (expired.length) {
        await closePaymentsOfExpiredRegistrations(expired.map((r) => r.id), 'exception_revoked')
          .catch((err) => console.error('[exceptions] Closing checkouts after a revoke failed; the recovery sweep will retry:', err));
      }
      return success(c, { ...exception, registrationsExpired: expired.length });
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to revoke exception'), statusOf(err));
    }
  });

export type ExceptionsApi = typeof exceptions;
