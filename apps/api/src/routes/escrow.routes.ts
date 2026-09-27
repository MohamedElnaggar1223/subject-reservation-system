/**
 * Escrow API Routes
 *
 * Student routes (read-only — OI-010 resolved at API level):
 * GET  /escrow                          - Own balance + escrow ID
 * GET  /escrow/transactions             - Own transaction history
 *
 * Parent routes (full transactional control):
 * GET  /escrow/children                 - All linked children with balances
 * GET  /escrow/transactions             - Transactions for a specific linked child (studentId query)
 * POST /escrow/transfer                 - Transfer funds between linked children
 * POST /escrow/withdraw                 - Request cash withdrawal for a linked child
 * GET  /escrow/withdrawals              - Withdrawal request history for linked children
 *
 * Admin routes:
 * GET  /escrow/admin/withdrawals        - All pending/partially-fulfilled withdrawal requests
 * POST /escrow/admin/withdrawals/:id/fulfill - Fulfill (partial or full) a withdrawal request
 * POST /escrow/admin/withdrawals/:id/reject  - Reject a withdrawal request
 *
 * Authorization:
 * - All routes require authentication
 * - Students: read-only (balance, transactions for own account)
 * - Parents: transactional control over linked children's escrow
 * - Admins: withdrawal management only
 *
 * OI-010 resolved: student access enforced at route level (not just frontend).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  TransferEscrow,
  RequestWithdrawal,
  FulfillWithdrawal,
  RejectWithdrawal,
  WithdrawalRequestId,
  EscrowQuery,
  WithdrawalsQuery,
  ROLES,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import {
  requireAuth,
  requireFinanceAdmin,
  requireParent,
  requireFinance,
  requireStudentOrParent,
} from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import { logAction, extractAuditContext } from '../services/audit.services';
import * as escrowService from '../services/escrow.services';
import * as linkService from '../services/link.services';

export const escrowRoutes = new Hono<HonoEnv>()
  .use('*', requireAuth())

  /**
   * GET /escrow
   *
   * Returns the caller's own escrow balance (students and parents).
   * - Students: own balance (read-only access enforced — OI-010)
   * - Parents: may provide ?studentId= to view a specific linked child's balance
   * - Admins: must provide ?studentId=
   *
   * Students cannot perform any transactions — only read their balance.
   */
  .get('/',
    zValidator('query', EscrowQuery),
    async (c) => {
      const user = c.get('user')!;
      const { studentId: queryStudentId } = c.req.valid('query');

      let targetStudentId: string;

      if (user.role === ROLES.STUDENT) {
        // Students always see their own escrow — cannot query other students
        targetStudentId = user.id;
      } else if (user.role === ROLES.PARENT) {
        if (queryStudentId) {
          const children = await linkService.getLinkedChildren(user.id);
          const isLinked = children.some((child) => child.studentId === queryStudentId);
          if (!isLinked) return error(c, 'You are not linked to this student', 403);
          targetStudentId = queryStudentId;
        } else {
          // No specific child — return parent's own escrow (parents may not have one; return 0)
          return success(c, { studentId: user.id, balance: 0, message: 'Parents manage children\'s escrow' });
        }
      } else if (user.role === ROLES.ADMIN) {
        if (!queryStudentId) return error(c, 'studentId is required for admin queries', 400);
        targetStudentId = queryStudentId;
      } else {
        return error(c, 'Forbidden', 403);
      }

      const balance = await escrowService.getEscrowBalance(targetStudentId);
      const account = await escrowService.getEscrowForStudent(targetStudentId);

      return success(c, {
        studentId: targetStudentId,
        balance,
        heldBalance: account?.heldBalance ?? 0,
        escrowId: account?.id ?? null,
      });
    }
  )

  /**
   * GET /escrow/children
   *
   * Parent-only: returns all linked children with their current escrow balances.
   * Used as the overview for the parent escrow dashboard (ESC-002).
   */
  .get('/children',
    requireParent(),
    async (c) => {
      const user = c.get('user')!;
      const children = await escrowService.getChildrenEscrowBalances(user.id);
      return success(c, children);
    }
  )

  /**
   * GET /escrow/transactions
   *
   * Returns escrow transaction history.
   * - Students: own transactions (read-only — OI-010)
   * - Parents: must provide ?studentId= for a linked child
   */
  .get('/transactions',
    zValidator('query', EscrowQuery),
    async (c) => {
      const user = c.get('user')!;
      const { studentId: queryStudentId } = c.req.valid('query');

      let targetStudentId: string;

      if (user.role === ROLES.STUDENT) {
        targetStudentId = user.id;
      } else if (user.role === ROLES.PARENT) {
        if (!queryStudentId) return error(c, 'studentId is required', 400);
        const children = await linkService.getLinkedChildren(user.id);
        const isLinked = children.some((child) => child.studentId === queryStudentId);
        if (!isLinked) return error(c, 'You are not linked to this student', 403);
        targetStudentId = queryStudentId;
      } else if (user.role === ROLES.ADMIN) {
        if (!queryStudentId) return error(c, 'studentId is required', 400);
        targetStudentId = queryStudentId;
      } else {
        return error(c, 'Forbidden', 403);
      }

      const transactions = await escrowService.getEscrowTransactions(targetStudentId);
      return success(c, transactions);
    }
  )

  /**
   * GET /escrow/withdrawals
   *
   * Parent: view withdrawal request history for all linked children.
   * Optional ?studentId= to filter by a specific child.
   * Optional ?status= to filter by request status.
   */
  .get('/withdrawals',
    requireParent(),
    zValidator('query', WithdrawalsQuery),
    async (c) => {
      const user = c.get('user')!;
      const { studentId, status } = c.req.valid('query');

      try {
        const requests = await escrowService.getWithdrawalRequestsForParent(
          user.id,
          { studentId, status }
        );
        return success(c, requests);
      } catch (err) {
        const message = clientMessage(err, 'Failed to fetch withdrawals');
        return error(c, message, message.includes('not linked') ? 403 : 400);
      }
    }
  )

  /**
   * POST /escrow/transfer
   *
   * Parent transfers escrow funds between two of their linked children (ESC-003).
   * Both children must be linked. Source balance must be sufficient.
   */
  .post('/transfer',
    requireParent(),
    zValidator('json', TransferEscrow),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');

      try {
        const result = await escrowService.transferEscrow(data, user.id);
        await logAction(user.id, 'ESCROW_TRANSFER', 'escrow', '', null, result as Record<string, unknown>, extractAuditContext(c))
          .catch(err => console.error('[audit] ESCROW_TRANSFER failed:', err));
        return success(c, result);
      } catch (err) {
        const message = clientMessage(err, 'Transfer failed');
        const status = message.includes('not linked') ? 403 :
                       message.includes('Insufficient') ? 422 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * POST /escrow/withdraw
   *
   * Parent requests a cash withdrawal from a linked child's escrow (ESC-004).
   * Creates a pending withdrawal_request for admin to process.
   */
  .post('/withdraw',
    requireParent(),
    zValidator('json', RequestWithdrawal),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');

      try {
        const result = await escrowService.createWithdrawalRequest(data, user.id);
        await logAction(user.id, 'WITHDRAWAL_REQUESTED', 'escrow', result.id, null, result as Record<string, unknown>, extractAuditContext(c))
          .catch(err => console.error('[audit] WITHDRAWAL_REQUESTED failed:', err));
        return success(c, result, 201);
      } catch (err) {
        const message = clientMessage(err, 'Failed to create withdrawal request');
        const status = message.includes('not linked') ? 403 :
                       message.includes('exceeds') ? 422 : 400;
        return error(c, message, status);
      }
    }
  )

  // ─── Admin Sub-Routes ───────────────────────────────────────────────────────

  /**
   * GET /escrow/admin/withdrawals
   *
   * Finance view of all pending and partially-fulfilled withdrawal requests.
   * Includes student and parent info. Ordered oldest-first (ESC-005).
   */
  .get('/admin/withdrawals',
    requireFinance(),
    async (c) => {
      const requests = await escrowService.getPendingWithdrawalRequests();
      return success(c, requests);
    }
  )

  /**
   * POST /escrow/admin/withdrawals/:id/fulfill
   *
   * Finance staff release funds from a withdrawal request (ESC-006).
   * releasedAmount is incremental — can be called multiple times for partial fulfillment.
   * Escrow is debited immediately; parent and student notified (Phase 4 notifications).
   */
  .post('/admin/withdrawals/:id/fulfill',
    requireFinance(),
    zValidator('param', WithdrawalRequestId),
    zValidator('json', FulfillWithdrawal),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const data = c.req.valid('json');

      try {
        // WITHDRAWAL_FULFILLED is written inside the hand-over's transaction (O-7).
        const result = await escrowService.fulfillWithdrawalRequest(id, data, user.id, extractAuditContext(c));
        return success(c, result);
      } catch (err) {
        const message = clientMessage(err, 'Failed to fulfill withdrawal');
        const status = message.includes('not found') ? 404 :
                       message.includes('Insufficient') || message.includes('Cannot release') ? 422 :
                       message.includes('already') || message.includes('has been rejected') ? 409 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * POST /escrow/admin/withdrawals/:id/reject
   *
   * Finance staff reject the unpaid remainder of a withdrawal request: the
   * part not yet handed over goes back to escrow. A mandatory reason is
   * stored in adminNotes.
   */
  .post('/admin/withdrawals/:id/reject',
    requireFinance(),
    zValidator('param', WithdrawalRequestId),
    zValidator('json', RejectWithdrawal),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const data = c.req.valid('json');

      try {
        // WITHDRAWAL_REJECTED is written inside the rejection's transaction (O-7).
        const result = await escrowService.rejectWithdrawalRequest(id, data, user.id, extractAuditContext(c));
        return success(c, result);
      } catch (err) {
        const message = clientMessage(err, 'Failed to reject withdrawal');
        const status = message.includes('not found') ? 404 :
                       message.includes('Cannot reject') || message.includes('already') ? 409 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * POST /escrow/admin/withdrawals/:id/approve
   *
   * Finance-admin approval closing a fulfilled withdrawal (V3 D-C
   * maker-checker). Never blocks the officer's cash disbursement.
   */
  .post('/admin/withdrawals/:id/approve',
    requireFinanceAdmin(),
    zValidator('param', WithdrawalRequestId),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');

      try {
        const result = await escrowService.approveWithdrawalRequest(id, user.id);
        await logAction(user.id, 'WITHDRAWAL_APPROVED', 'escrow', id, null, result as Record<string, unknown>, extractAuditContext(c))
          .catch(err => console.error('[audit] WITHDRAWAL_APPROVED failed:', err));
        return success(c, result);
      } catch (err) {
        const message = clientMessage(err, 'Failed to approve withdrawal');
        return error(c, message, message.includes('not awaiting') ? 409 : 400);
      }
    }
  );

export type EscrowApi = typeof escrowRoutes;
