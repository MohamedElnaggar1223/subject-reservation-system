/**
 * Payment API Routes
 *
 * GET  /payments/checkout-summary    - Checkout summary for registrations (parent)
 * GET  /payments/pending-bank        - Pending bank transfer list (admin)
 * GET  /payments                     - Payment history (role-aware)
 * GET  /payments/:id                 - Single payment with registrations
 * POST /payments/initiate            - Initiate payment (parent only)
 * POST /payments/:id/confirm         - Admin confirms bank transfer (admin only)
 * POST /payments/webhook/fawry       - Fawry payment confirmation webhook
 * POST /payments/webhook/paymob      - Paymob card/wallet confirmation webhook
 *
 * Authorization:
 * - All routes except webhooks require authentication
 * - Payment initiation: parent only (parent-only financial control — OI-008)
 * - Bank transfer confirmation: admin only
 * - Webhooks: no auth — validated by provider signature instead
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  InitiatePayment,
  ConfirmBankTransfer,
  FawryWebhookPayload,
  PaymobWebhookPayload,
  ListPaymentsQuery,
  CheckoutSummaryQuery,
  PaymentId,
  ROLES,
} from '@repo/validations';
import { success, error } from '../lib/response';
import {
  requireAuth,
  requireParent,
  requireAdmin,
} from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as paymentService from '../services/payment.services';
import * as linkService from '../services/link.services';
import { validateFawryWebhookSignature } from '../integrations/fawry';
import { validatePaymobWebhookSignature } from '../integrations/paymob';
import { logger } from '../lib/logger';
import { logAction, extractAuditContext } from '../services/audit.services';

export const payments = new Hono<HonoEnv>()

  /**
   * GET /payments/checkout-summary
   *
   * Returns a summary of registrations for the checkout page, including:
   * - Registration details (subject, session, price)
   * - Total cost
   * - Student's available escrow balance
   *
   * Parent only — parent must be linked to the student.
   * Accepts comma-separated registrationIds as a query string.
   */
  .get('/checkout-summary',
    requireAuth(),
    requireParent(),
    zValidator('query', CheckoutSummaryQuery),
    async (c) => {
      const user = c.get('user')!;
      const { registrationIds: rawIds } = c.req.valid('query');

      const registrationIds = rawIds.split(',').map((id) => id.trim()).filter(Boolean);
      if (registrationIds.length === 0) {
        return error(c, 'At least one registration ID is required', 400);
      }

      const summary = await paymentService.getCheckoutSummary(registrationIds, user.id);
      if (!summary) {
        return error(c, 'Could not load checkout summary. Verify registrations belong to a linked child.', 400);
      }

      return success(c, summary);
    }
  )

  /**
   * GET /payments/pending-bank
   *
   * Returns all pending bank transfer payments awaiting admin confirmation.
   * Ordered oldest-first so longest-waiting transfers are prioritised.
   * Admin only.
   */
  .get('/pending-bank',
    requireAuth(),
    requireAdmin(),
    async (c) => {
      const pending = await paymentService.getPendingBankTransfers();
      return success(c, pending);
    }
  )

  /**
   * GET /payments
   *
   * Role-aware payment history:
   * - Parents: own payments (for their children)
   * - Admins: all payments with optional filters
   */
  .get('/',
    requireAuth(),
    zValidator('query', ListPaymentsQuery),
    async (c) => {
      const user = c.get('user')!;
      const filters = c.req.valid('query');

      if (user.role === ROLES.PARENT) {
        if (filters.studentId) {
          // Validate parent-child link before filtering by student
          const children = await linkService.getLinkedChildren(user.id);
          const isLinked = children.some((child) => child.id === filters.studentId);
          if (!isLinked) return error(c, 'You are not linked to this student', 403);
          const data = await paymentService.getPayments({ ...filters, parentId: user.id });
          return success(c, data);
        }
        const data = await paymentService.getPayments({ ...filters, parentId: user.id });
        return success(c, data);
      }

      if (user.role === ROLES.ADMIN) {
        const data = await paymentService.getPayments(filters);
        return success(c, data);
      }

      return error(c, 'Forbidden', 403);
    }
  )

  /**
   * POST /payments/initiate
   *
   * Parent initiates a payment for one or more registrations.
   * Returns payment record with provider-specific metadata
   * (Fawry code, payment URL, bank details, etc.).
   *
   * Parent only — enforces parent-only financial control (OI-008 resolved).
   */
  .post('/initiate',
    requireAuth(),
    requireParent(),
    zValidator('json', InitiatePayment),
    async (c) => {
      const user = c.get('user')!;
      const data = c.req.valid('json');

      try {
        const result = await paymentService.initiatePayment(user.id, data);
        return success(c, result, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to initiate payment';
        const status =
          message.includes('not linked') ? 403 :
          message.includes('insufficient') || message.includes('already have') ? 422 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * GET /payments/:id
   *
   * Get a single payment with all linked registrations.
   * Parents can only view payments they initiated.
   * Admins can view any payment.
   */
  .get('/:id',
    requireAuth(),
    zValidator('param', PaymentId),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');

      const pay = await paymentService.getPaymentById(id);
      if (!pay) return error(c, 'Payment not found', 404);

      if (user.role === ROLES.PARENT && pay.parentId !== user.id) {
        return error(c, 'Access denied', 403);
      }

      if (user.role === ROLES.STUDENT) {
        return error(c, 'Forbidden — payments are managed by parents', 403);
      }

      return success(c, pay);
    }
  )

  /**
   * POST /payments/:id/confirm
   *
   * Admin manually confirms a bank transfer payment (PAY-007).
   * Marks the payment as 'completed' and all linked registrations as 'confirmed'.
   * Optional admin notes are stored on the payment record.
   *
   * Admin only.
   */
  .post('/:id/confirm',
    requireAuth(),
    requireAdmin(),
    zValidator('param', PaymentId),
    zValidator('json', ConfirmBankTransfer),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const { notes } = c.req.valid('json');

      const pay = await paymentService.getPaymentById(id);
      if (!pay) return error(c, 'Payment not found', 404);

      if (pay.paymentMethod !== 'bank_transfer') {
        return error(c, 'Only bank transfer payments require manual confirmation', 400);
      }

      try {
        const confirmed = await paymentService.confirmPayment(id, user.id, notes);

        logAction(user.id, 'PAYMENT_CONFIRMED', 'payment', id, pay as Record<string, unknown>, confirmed as Record<string, unknown>, extractAuditContext(c))
          .catch((err) => console.error('[audit] PAYMENT_CONFIRMED (admin) failed:', err));

        return success(c, confirmed);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to confirm payment';
        return error(c, message, 400);
      }
    }
  )

  /**
   * POST /payments/webhook/fawry
   *
   * Fawry payment status notification.
   * No authentication — validated by Fawry signature header.
   *
   * TODO (Production): Enable signature validation by calling
   *   validateFawryWebhookSignature(payload, signatureHeader)
   */
  .post('/webhook/fawry',
    zValidator('json', FawryWebhookPayload),
    async (c) => {
      const payload = c.req.valid('json');
      const signature = c.req.header('x-fawry-signature') ?? '';

      if (!validateFawryWebhookSignature(payload as unknown as Record<string, unknown>, signature)) {
        logger.warn('[Fawry Webhook] Invalid signature rejected');
        return error(c, 'Invalid signature', 401);
      }

      if (payload.orderStatus !== 'PAID') {
        // Non-PAID statuses (EXPIRED, CANCELLED, UNPAID) fail the payment
        try {
          // Find payment by merchantRefNum (stored as our paymentId in metadata)
          // We search by externalReference (Fawry reference number)
          logger.info(`[Fawry Webhook] Non-PAID status: ${payload.orderStatus} for ref ${payload.merchantRefNum}`);
          // In the stub: just log; in production, look up by merchantRefNum and fail
        } catch (err) {
          logger.error('[Fawry Webhook] Error processing failed payment', err);
        }
        return c.json({ received: true }, 200);
      }

      // Payment confirmed
      try {
        await paymentService.confirmPayment(
          payload.merchantRefNum,
          undefined,
          payload.referenceNumber
        );
        logger.info(`[Fawry Webhook] Payment confirmed: ${payload.merchantRefNum}`);
      } catch (err) {
        logger.error('[Fawry Webhook] Error confirming payment', err);
      }

      return c.json({ received: true }, 200);
    }
  )

  /**
   * POST /payments/webhook/paymob
   *
   * Paymob transaction response for card and wallet payments.
   * No authentication — validated by Paymob HMAC header.
   *
   * TODO (Production): Enable HMAC validation by calling
   *   validatePaymobWebhookSignature(payload, hmacHeader)
   */
  .post('/webhook/paymob',
    zValidator('json', PaymobWebhookPayload),
    async (c) => {
      const { obj } = c.req.valid('json');
      const hmac = c.req.header('x-hmac-sha512') ?? '';

      if (!validatePaymobWebhookSignature(obj as unknown as Record<string, unknown>, hmac)) {
        logger.warn('[Paymob Webhook] Invalid HMAC rejected');
        return error(c, 'Invalid signature', 401);
      }

      if (!obj.success) {
        logger.info(`[Paymob Webhook] Failed transaction for order: ${obj.merchant_order_id}`);
        try {
          await paymentService.failPayment(obj.merchant_order_id);
        } catch (err) {
          logger.error('[Paymob Webhook] Error failing payment', err);
        }
        return c.json({ received: true }, 200);
      }

      try {
        await paymentService.confirmPayment(
          obj.merchant_order_id,
          undefined,
          obj.id.toString()
        );
        logger.info(`[Paymob Webhook] Payment confirmed: ${obj.merchant_order_id}`);
      } catch (err) {
        logger.error('[Paymob Webhook] Error confirming payment', err);
      }

      return c.json({ received: true }, 200);
    }
  );

export type PaymentsApi = typeof payments;
