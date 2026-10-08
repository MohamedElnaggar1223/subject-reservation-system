/**
 * Charge API Routes (RESERVATIONS_REWORK.md §3.6, §3.10, §5)
 *
 * GET  /charges              - Charges: staff any student's; a parent their children's; a student their own
 * POST /charges              - Add a charge (staff), or ask for a board service the board lets families request (a family: `requested`)
 * POST /charges/:id/accept   - Accept a family's request (the desk, finance, admin)
 * POST /charges/:id/cancel   - Cancel a charge nothing has paid (the desk, finance, admin)
 * POST /charges/:id/refund   - Refund a paid charge to escrow, at most its amount (finance admin, admin)
 *
 * A charge is paid through POST /payments/initiate { chargeIds } (a family) or the desk's
 * collection (POST /registrations/desk/collect { chargeIds }), in a payment of its own purpose.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { CreateCharge, ChargeId, ChargeDecision, RefundCharge, ListChargesQuery, ROLES } from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import { requireAuth, requireRole, requireFinance, requireFinanceAdmin } from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as chargeService from '../services/charge.services';
import { extractAuditContext } from '../services/audit.services';

const statusOf = (err: unknown) => (err instanceof chargeService.ChargeError ? err.status : 400);

export const charges = new Hono<HonoEnv>()
  .use('*', requireAuth())

  .get('/', requireRole(ROLES.ADMIN, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN, ROLES.PARENT, ROLES.STUDENT), zValidator('query', ListChargesQuery), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await chargeService.listCharges(c.req.valid('query'), { id: user.id, role: user.role }));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to list charges'), statusOf(err));
    }
  })

  .post('/', requireRole(ROLES.ADMIN, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN, ROLES.PARENT, ROLES.STUDENT), zValidator('json', CreateCharge), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await chargeService.createCharge(c.req.valid('json'), { id: user.id, role: user.role }, extractAuditContext(c)), 201);
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to add the charge'), statusOf(err));
    }
  })

  .post('/:id/accept', requireFinance(), zValidator('param', ChargeId), zValidator('json', ChargeDecision), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await chargeService.acceptCharge(c.req.valid('param').id, { id: user.id }, c.req.valid('json').reason, extractAuditContext(c)));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to accept the charge'), statusOf(err));
    }
  })

  .post('/:id/cancel', requireFinance(), zValidator('param', ChargeId), zValidator('json', ChargeDecision), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await chargeService.cancelCharge(c.req.valid('param').id, { id: user.id }, c.req.valid('json').reason, extractAuditContext(c)));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to cancel the charge'), statusOf(err));
    }
  })

  .post('/:id/refund', requireFinanceAdmin(), zValidator('param', ChargeId), zValidator('json', RefundCharge), async (c) => {
    const user = c.get('user')!;
    try {
      return success(c, await chargeService.refundCharge(c.req.valid('param').id, { id: user.id }, c.req.valid('json'), extractAuditContext(c)));
    } catch (err) {
      return error(c, clientMessage(err, 'Failed to refund the charge'), statusOf(err));
    }
  });

export type ChargesApi = typeof charges;
