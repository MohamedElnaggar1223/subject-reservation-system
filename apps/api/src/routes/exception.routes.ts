/**
 * Exception API Routes (V3 §6.3, F0a; the policy registry, RESERVATIONS_REWORK.md §3.7)
 *
 * GET  /exceptions               - The exceptions of the policies the caller may grant
 * POST /exceptions               - Grant one: { policyKey, studentId | familyId, scope, value?, validUntil?, reason },
 *                                  or V3's { type, studentId, sessionId?, subjectId?, value?, validUntil?, reason }
 * POST /exceptions/:id/revoke    - Revoke an active exception (a plan: its line expires, its deposits settled as a drop)
 * POST /exceptions/:id/release   - End a plan and keep the line payable: every deposit released
 * GET  /exceptions/check-these   - Migrated exceptions whose meaning changed, to confirm or revoke
 * POST /exceptions/:id/confirm   - Confirm one of them
 *
 * The role gate lets in every role that may grant some policy (finance admin, coordinator,
 * admin); the handler checks the policy's own grantors (POLICIES.grantRoles): a coordinator is
 * refused a fee waiver, a finance admin the grade-10 exception.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { GrantException, ExceptionId, ListExceptionsQuery, ConfirmCheckedException, RevokeException, POLICY_GRANT_ROLES } from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireRole } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as exceptionService from '../services/exception.services';
import { closePaymentsOfExpiredRegistrations, failInstalmentPaymentsOfDeadPlans } from '../services/payment.services';
import { extractAuditContext } from '../services/audit.services';

const statusOf = (err: unknown) => (err instanceof exceptionService.ExceptionError ? err.status : 400);

export const exceptions = new Hono<HonoEnv>()
  .use('*', requireAuth())
  .use('*', requireRole(...POLICY_GRANT_ROLES))

  .get('/', zValidator('query', ListExceptionsQuery), async (c) => {
    const filters = c.req.valid('query');
    return success(c, await exceptionService.getExceptions(filters, c.get('user')!.role));
  })

  .get('/check-these', async (c) => {
    return success(c, await exceptionService.getCheckThese(c.get('user')!.role));
  })

  .post('/', zValidator('json', GrantException), async (c) => {
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
    // An optional reason ({ reason }) the plan's settlement records; V3's callers send no body.
    const body = RevokeException.safeParse(await c.req.json().catch(() => ({})));
    try {
      const { exception, expired } = await exceptionService.revokeException(id, { id: user.id, role: user.role }, extractAuditContext(c), { reason: body.success ? body.data.reason : undefined });
      if (expired.length && exception.policyKey === 'eligibility.grade10OtherSeries') {
        await closePaymentsOfExpiredRegistrations(expired.map((r) => r.id), 'exception_revoked')
          .catch((err) => console.error('[exceptions] Closing checkouts after a revoke failed; the recovery sweep will retry:', err));
      }
      if (exception.policyKey === 'plan.instalments') {
        // The plan's open instalment payments, failed after the settlement committed (a payment is locked before a line).
        await failInstalmentPaymentsOfDeadPlans().catch((err) => console.error('[exceptions] Closing a revoked plan\'s payments failed; the deadline sweep will retry:', err));
      }
      return success(c, { ...exception, registrationsExpired: expired.length });
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to revoke exception'), statusOf(err));
    }
  })

  .post('/:id/release', zValidator('param', ExceptionId), zValidator('json', ConfirmCheckedException), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const { note } = c.req.valid('json');
    try {
      const r = await exceptionService.releasePlanInFull(id, { id: user.id, role: user.role }, note ?? 'released in full', extractAuditContext(c));
      await failInstalmentPaymentsOfDeadPlans().catch((err) => console.error('[exceptions] Closing a released plan\'s payments failed; the deadline sweep will retry:', err));
      return success(c, r);
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to release the plan'), statusOf(err));
    }
  })

  .post('/:id/confirm', zValidator('param', ExceptionId), zValidator('json', ConfirmCheckedException), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const { note } = c.req.valid('json');
    try {
      return success(c, await exceptionService.confirmCheckedException(id, { id: user.id, role: user.role }, note, extractAuditContext(c)));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to confirm the exception'), statusOf(err));
    }
  });

export type ExceptionsApi = typeof exceptions;
