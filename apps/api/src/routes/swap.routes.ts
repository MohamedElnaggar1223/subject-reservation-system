/**
 * Swap / Change Request API Routes
 *
 * Two route groups exported from this file:
 *
 * registrationSwapRoutes — mounted at /v1/registrations:
 *   POST /:id/request-drop    - Student requests to drop a confirmed registration (SWAP-001)
 *   POST /:id/request-swap    - Student requests to swap a confirmed registration (SWAP-002)
 *   POST /:id/drop            - Parent directly drops a registration (SWAP-004)
 *   POST /:id/swap            - Parent directly swaps a registration (SWAP-004)
 *
 * changeRequestRoutes — mounted at /v1/change-requests:
 *   GET  /                    - List change requests (role-aware: student=own, parent=children)
 *   GET  /:id                 - Get a single change request
 *   PUT  /:id/approve         - Parent approves a pending request (SWAP-003)
 *   PUT  /:id/reject          - Parent rejects a pending request (SWAP-003)
 *
 * Authorization:
 * - Student routes use requireStudent()
 * - Parent routes use requireParent()
 * - List endpoint is role-aware (student or parent)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  RequestDrop,
  RequestSwap,
  DirectDrop,
  DirectSwap,
  ApproveChangeRequest,
  RejectChangeRequest,
  ChangeRequestId,
  RegistrationIdParam,
  ChangeRequestsQuery,
  ROLES,
} from '@repo/validations';
import { success, error } from '../lib/response';
import {
  requireAuth,
  requireStudent,
  requireParent,
  requireStudentOrParent,
} from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as swapService from '../services/swap.services';
import { logAction, extractAuditContext } from '../services/audit.services';

// ─── Registration-Scoped Routes (mounted at /v1/registrations) ────────────────

export const registrationSwapRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  /**
   * POST /registrations/:id/request-drop
   *
   * Student requests to drop a confirmed registration (SWAP-001).
   * Session must be active. Subject must not be core. No existing pending request.
   * Creates a pending change_request for parent approval.
   */
  .post('/:id/request-drop',
    requireStudent(),
    zValidator('param', RegistrationIdParam),
    zValidator('json', RequestDrop),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const data = c.req.valid('json');

      try {
        const request = await swapService.createDropRequest(id, data, user.id);
        return success(c, request, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create drop request';
        const status = message.includes('not found') ? 404 :
                       message.includes('Core subjects') ? 422 :
                       message.includes('closed') ? 422 :
                       message.includes('already') ? 409 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * POST /registrations/:id/request-swap
   *
   * Student requests to swap a confirmed registration (SWAP-002).
   * Calculates and stores the price difference for parent review.
   */
  .post('/:id/request-swap',
    requireStudent(),
    zValidator('param', RegistrationIdParam),
    zValidator('json', RequestSwap),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const data = c.req.valid('json');

      try {
        const request = await swapService.createSwapRequest(id, data, user.id);
        return success(c, request, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create swap request';
        const status = message.includes('not found') ? 404 :
                       message.includes('Core subjects') ? 422 :
                       message.includes('already') ? 409 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * POST /registrations/:id/drop
   *
   * Parent directly drops a confirmed registration for a linked child (SWAP-004).
   * No approval queue — financials processed immediately in a DB transaction.
   */
  .post('/:id/drop',
    requireParent(),
    zValidator('param', RegistrationIdParam),
    zValidator('json', DirectDrop),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const data = c.req.valid('json');

      try {
        const result = await swapService.executeDirectDrop(id, data, user.id);
        return success(c, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to drop registration';
        const status = message.includes('not found') ? 404 :
                       message.includes('not linked') ? 403 :
                       message.includes('Core subjects') || message.includes('closed') ? 422 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * POST /registrations/:id/swap
   *
   * Parent directly swaps a confirmed registration for a linked child (SWAP-004).
   * Drops the old subject and creates a new pending_payment registration.
   */
  .post('/:id/swap',
    requireParent(),
    zValidator('param', RegistrationIdParam),
    zValidator('json', DirectSwap),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const data = c.req.valid('json');

      try {
        const result = await swapService.executeDirectSwap(id, data, user.id);
        return success(c, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to swap registration';
        const status = message.includes('not found') ? 404 :
                       message.includes('not linked') ? 403 :
                       message.includes('Core subjects') || message.includes('closed') ? 422 :
                       message.includes('already registered') ? 409 : 400;
        return error(c, message, status);
      }
    }
  );

// ─── Change Request Routes (mounted at /v1/change-requests) ──────────────────

export const changeRequestRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  /**
   * GET /change-requests
   *
   * Role-aware listing of change requests:
   * - Students: own pending/rejected requests (SWAP-007)
   * - Parents: all pending requests from linked children
   */
  .get('/',
    requireStudentOrParent(),
    zValidator('query', ChangeRequestsQuery),
    async (c) => {
      const user = c.get('user')!;
      const filters = c.req.valid('query');

      if (user.role === ROLES.STUDENT) {
        const requests = await swapService.getPendingChangeRequests(user.id, filters);
        return success(c, requests);
      }

      if (user.role === ROLES.PARENT) {
        const requests = await swapService.getPendingChangeRequestsForParent(user.id);
        return success(c, requests);
      }

      return error(c, 'Forbidden', 403);
    }
  )

  /**
   * GET /change-requests/:id
   *
   * Get a single change request by ID.
   * Access validated by the service (checks ownership/parent link).
   */
  .get('/:id',
    requireStudentOrParent(),
    zValidator('param', ChangeRequestId),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');

      const cr = await swapService.getChangeRequestById(id);
      if (!cr) return error(c, 'Change request not found', 404);

      // Access check: student must own it, parent must be linked
      if (user.role === ROLES.STUDENT && cr.requestedBy !== user.id) {
        return error(c, 'Access denied', 403);
      }

      return success(c, cr);
    }
  )

  /**
   * PUT /change-requests/:id/approve
   *
   * Parent approves a pending change request (SWAP-003).
   * Runs inside a DB transaction: drops registration, credits escrow,
   * and (for swaps) creates a new pending_payment registration.
   */
  .put('/:id/approve',
    requireParent(),
    zValidator('param', ChangeRequestId),
    zValidator('json', ApproveChangeRequest),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const data = c.req.valid('json');

      try {
        const result = await swapService.approveChangeRequest(id, data, user.id);

        logAction(user.id, 'CHANGE_REQUEST_APPROVED', 'change_request', id, null, result as Record<string, unknown>, extractAuditContext(c))
          .catch((err) => console.error('[audit] CHANGE_REQUEST_APPROVED failed:', err));

        return success(c, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to approve change request';
        const status = message.includes('not found') ? 404 :
                       message.includes('not linked') ? 403 :
                       message.includes('closed') ? 422 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * PUT /change-requests/:id/reject
   *
   * Parent rejects a pending change request (SWAP-003).
   * No financial impact. Comments are required.
   */
  .put('/:id/reject',
    requireParent(),
    zValidator('param', ChangeRequestId),
    zValidator('json', RejectChangeRequest),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const data = c.req.valid('json');

      try {
        const result = await swapService.rejectChangeRequest(id, data, user.id);

        logAction(user.id, 'CHANGE_REQUEST_REJECTED', 'change_request', id, null, result as Record<string, unknown>, extractAuditContext(c))
          .catch((err) => console.error('[audit] CHANGE_REQUEST_REJECTED failed:', err));

        return success(c, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to reject change request';
        const status = message.includes('not found') ? 404 :
                       message.includes('not linked') ? 403 : 400;
        return error(c, message, status);
      }
    }
  );
