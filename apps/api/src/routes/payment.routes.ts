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
          const isLinked = children.some((child) => child.studentId === filters.studentId);
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
        logAction(user.id, 'PAYMENT_INITIATED', 'payment', result.id ?? '', null, result as Record<string, unknown>, extractAuditContext(c))
          .catch((err) => console.error('[audit] PAYMENT_INITIATED failed:', err));
        return success(c, result, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to initiate payment';
        const status =
          message.includes('not linked') ? 403 :
          message.includes('insufficient') ||
          message.includes('already have') ||
          message.includes('window is closed') ? 422 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * GET /payments/:id/receipt
   *
   * Generates and returns a PDF receipt for a completed payment.
   * Parents can only download receipts for their own payments.
   * Admins can download any receipt.
   *
   * Returns: application/pdf binary stream
   *
   * TODO: Install pdfkit (`npm install pdfkit @types/pdfkit`) to enable full PDF generation.
   * Currently uses a plain-text fallback that produces a readable receipt.
   */
  .get('/:id/receipt',
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

      if (pay.status !== 'completed') {
        return error(c, 'Receipts are only available for completed payments', 400);
      }

      try {
        const pdfBuffer = await paymentService.generatePaymentReceipt(id);
        const uint8 = new Uint8Array(pdfBuffer);

        return new Response(uint8, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="receipt-${id.slice(0, 8)}.pdf"`,
            'Content-Length': String(uint8.byteLength),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate receipt';
        logger.error('[receipt] PDF generation failed:', err);
        return error(c, message, 500);
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
        const confirmed = await paymentService.confirmPayment(id, user.id, undefined, notes);

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
        try {
          logger.info(`[Fawry Webhook] Non-PAID status: ${payload.orderStatus} for ref ${payload.merchantRefNum}`);
          await paymentService.failPayment(payload.merchantRefNum);
          logAction(null, 'PAYMENT_FAILED', 'payment', payload.merchantRefNum, null, { provider: 'fawry', status: payload.orderStatus })
            .catch((err) => console.error('[audit] PAYMENT_FAILED (fawry) failed:', err));
        } catch (err) {
          logger.error('[Fawry Webhook] Error processing failed payment', err);
        }
        return c.json({ received: true }, 200);
      }

      // Amount verification — compare webhook amount against stored payment amount.
      // Accept webhook amount >= stored amount (in cents). Strict equality
      // rejected legitimate payments when Fawry returned slightly larger
      // values due to rounding or their fee structure. Under-payment is
      // still rejected since that would mean the student paid less than owed.
      const fawryPayment = await paymentService.getPaymentById(payload.merchantRefNum);
      if (!fawryPayment) {
        logger.warn(`[Fawry Webhook] Payment not found: ${payload.merchantRefNum}`);
        return error(c, 'Payment not found', 400);
      }
      const webhookCents = Math.round(Number(payload.paymentAmount) * 100);
      const storedCents  = Math.round(fawryPayment.amount * 100);
      if (webhookCents < storedCents) {
        logger.error(`[Fawry Webhook] Underpayment for ${payload.merchantRefNum}: webhook=${payload.paymentAmount}, stored=${fawryPayment.amount}`);
        return error(c, 'Payment amount is less than expected', 400);
      }
      if (webhookCents > storedCents) {
        logger.warn(`[Fawry Webhook] Overpayment detected for ${payload.merchantRefNum}: webhook=${payload.paymentAmount}, stored=${fawryPayment.amount} — proceeding.`);
      }

      // Payment confirmed
      try {
        await paymentService.confirmPayment(
          payload.merchantRefNum,
          undefined,
          payload.referenceNumber
        );
        logAction(null, 'PAYMENT_CONFIRMED', 'payment', payload.merchantRefNum, null, { provider: 'fawry', status: 'PAID' })
          .catch((err) => console.error('[audit] PAYMENT_CONFIRMED (fawry) failed:', err));
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
   * Validation is always run: validatePaymobWebhookSignature fail-closes
   * when PAYMOB_HMAC_SECRET is not configured, and rejects missing or
   * malformed HMAC headers. Never accept an unsigned Paymob webhook.
   */
  .post('/webhook/paymob',
    zValidator('json', PaymobWebhookPayload),
    async (c) => {
      const { obj } = c.req.valid('json');
      // Paymob transmits the HMAC as a `?hmac=` query parameter on the
      // callback URL itself (not as a header) — this is how their
      // "Transaction Processed Callback" works on both legacy and
      // Intention APIs. We still accept the header variants as a
      // fallback in case a proxy or gateway moves it upstream.
      const hmacQuery  = c.req.query('hmac');
      const hmacHeader = c.req.header('x-hmac-sha512') ?? c.req.header('hmac');
      const hmac = hmacQuery ?? hmacHeader ?? '';

      logger.info(`[Paymob Webhook] Received — success: ${obj.success}, id: ${obj.id}, merchant_order_id: ${obj.merchant_order_id}, order.merchant_order_id: ${obj.order?.merchant_order_id}`);

      if (!validatePaymobWebhookSignature(obj as unknown as Record<string, unknown>, hmac)) {
        // Log just enough context to distinguish "no signature sent" from
        // "signature sent but mismatched" so ops can tell a Paymob config
        // issue apart from a forgery attempt. The hmac itself is NOT
        // logged to avoid storing someone's forgery attempt verbatim.
        const where = hmacQuery ? 'query' : hmacHeader ? 'header' : 'none';
        logger.warn(
          `[Paymob Webhook] Rejected — reason: ${hmac ? 'signature mismatch' : 'missing hmac'}, source: ${where}, id: ${obj.id}`
        );
        return error(c, 'Invalid signature', 401);
      }

      // Resolve our payment ID from the callback.
      // Intention API: special_reference → obj.order.merchant_order_id
      // Legacy flow: obj.merchant_order_id
      const paymentId =
        obj.order?.merchant_order_id ||
        obj.merchant_order_id ||
        null;

      if (!paymentId) {
        logger.error('[Paymob Webhook] Cannot resolve payment ID from callback');
        return error(c, 'Missing merchant_order_id', 400);
      }

      if (!obj.success) {
        logger.info(`[Paymob Webhook] Failed transaction for order: ${paymentId}`);
        try {
          await paymentService.failPayment(paymentId);
          logAction(null, 'PAYMENT_FAILED', 'payment', paymentId, null, { provider: 'paymob', success: obj.success })
            .catch((err) => console.error('[audit] PAYMENT_FAILED (paymob) failed:', err));
        } catch (err) {
          logger.error('[Paymob Webhook] Error failing payment', err);
        }
        return c.json({ received: true }, 200);
      }

      const paymobPayment = await paymentService.getPaymentById(paymentId);
      if (!paymobPayment) {
        logger.warn(`[Paymob Webhook] Payment not found: ${paymentId}`);
        return error(c, 'Payment not found', 400);
      }
      if (obj.amount_cents !== Math.round(paymobPayment.amount * 100)) {
        logger.error(`[Paymob Webhook] Amount mismatch for ${paymentId}: webhook=${obj.amount_cents / 100}, stored=${paymobPayment.amount}`);
        return error(c, 'Amount mismatch', 400);
      }

      try {
        await paymentService.confirmPayment(
          paymentId,
          undefined,
          obj.id.toString()
        );
        logAction(null, 'PAYMENT_CONFIRMED', 'payment', paymentId, null, { provider: 'paymob', status: 'PAID' })
          .catch((err) => console.error('[audit] PAYMENT_CONFIRMED (paymob) failed:', err));
        logger.info(`[Paymob Webhook] Payment confirmed: ${paymentId}`);
      } catch (err) {
        logger.error('[Paymob Webhook] Error confirming payment', err);
      }

      return c.json({ received: true }, 200);
    }
  );

export type PaymentsApi = typeof payments;
