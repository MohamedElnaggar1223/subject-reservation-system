/**
 * Payment API Routes
 *
 * GET  /payments/checkout-summary       - Checkout summary for registrations (parent)
 * GET  /payments/pending-manual         - Payments awaiting finance action (finance)
 * GET  /payments/pending-bank           - Pending bank transfer list (admin, legacy)
 * GET  /payments                        - Payment history (role-aware)
 * GET  /payments/:id                    - Single payment with registrations
 * POST /payments/initiate               - Initiate payment (parent only)
 * POST /payments/:id/instapay-reference - Parent submits InstaPay transfer reference
 * POST /payments/:id/confirm            - Finance confirms a manual payment
 * POST /payments/:id/reject             - Finance rejects an open manual payment
 * POST /payments/:id/cancel             - Parent cancels an unpaid checkout
 * POST /payments/:id/reverse            - Finance admin reverses a confirmation
 *
 * V3: Fawry/Paymob webhooks are commented out along with their provider
 * integrations — active methods are in_school and instapay only, both
 * manually verified by finance staff (V3_PLAN §6.11).
 *
 * Authorization:
 * - Payment initiation + reference submission: parent only (OI-008)
 * - Manual confirmation + pending queue: finance roles (officer/finance-admin/admin)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  InitiatePayment,
  SubmitInstapayReference,
  ConfirmManualPayment,
  RejectManualPayment,
  ReversePayment,
  RecordLateTransfer,
  ListPaymentsQuery,
  CheckoutSummaryQuery,
  PaymentId,
  ROLES,
  FINANCE_ROLES,
  hasRole,
} from '@repo/validations';
import { success, error, clientMessage } from '../lib/response';
import {
  requireAuth,
  requireParent,
  requireAdmin,
  requireFinance,
  requireFinanceAdmin,
} from '../middleware/access-control.middleware';
import type { HonoEnv } from '../lib/types';
import * as paymentService from '../services/payment.services';
import * as linkService from '../services/link.services';
// V3: provider webhook validators disabled with the webhook routes below.
// import { validateFawryWebhookSignature } from '../integrations/fawry';
// import { validatePaymobWebhookSignature } from '../integrations/paymob';
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
   * GET /payments/pending-manual
   *
   * Finance Workbench queue: in-school and InstaPay payments awaiting
   * confirmation (plus any legacy pending bank transfers), oldest first.
   * Finance roles (officer / finance-admin / admin).
   */
  .get('/pending-manual',
    requireAuth(),
    requireFinance(),
    async (c) => {
      const pending = await paymentService.getPendingManualPayments();
      return success(c, pending);
    }
  )

  /**
   * GET /payments/pending-bank
   *
   * Returns all pending bank transfer payments awaiting admin confirmation.
   * Ordered oldest-first so longest-waiting transfers are prioritised.
   * Admin only. Legacy — superseded by /pending-manual for finance staff.
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
   * GET /payments/daily-takings?date=YYYY-MM-DD  (UX_AUDIT G4)
   *
   * Everything confirmed on one day with per-instrument totals — the
   * end-of-day cash-drawer reconciliation. Finance roles + admin.
   */
  .get('/daily-takings',
    requireAuth(),
    requireFinance(),
    zValidator('query', z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD') })),
    async (c) => {
      const { date } = c.req.valid('query');
      return success(c, await paymentService.getDailyTakings(date));
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

      // Admin and finance staff see all payments (workbench + admin screens)
      if (hasRole(user.role, ...FINANCE_ROLES)) {
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
        await logAction(user.id, 'PAYMENT_INITIATED', 'payment', result.id ?? '', null, result as Record<string, unknown>, extractAuditContext(c))
          .catch((err) => console.error('[audit] PAYMENT_INITIATED failed:', err));
        return success(c, result, 201);
      } catch (err) {
        const message = clientMessage(err, 'Failed to initiate payment');
        const status =
          message.includes('not linked') ? 403 :
          message.includes('insufficient') ||
          message.includes('already have') ||
          message.includes('window is closed') ||
          message.includes('window is not open') ? 422 : 400;
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
        const message = clientMessage(err, 'Failed to generate receipt');
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
   * POST /payments/:id/instapay-reference
   *
   * Parent submits the InstaPay transaction reference (and optional
   * screenshot file ID) after transferring to the school account.
   * Moves the payment to 'pending_verification' for finance review.
   *
   * Parent only — must be the payment's initiator.
   */
  .post('/:id/instapay-reference',
    requireAuth(),
    requireParent(),
    zValidator('param', PaymentId),
    zValidator('json', SubmitInstapayReference),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const data = c.req.valid('json');

      try {
        const updated = await paymentService.submitInstapayReference(id, user.id, data);
        await logAction(user.id, 'PAYMENT_REFERENCE_SUBMITTED', 'payment', id, null, { reference: data.reference }, extractAuditContext(c))
          .catch((err) => console.error('[audit] PAYMENT_REFERENCE_SUBMITTED failed:', err));
        return success(c, updated);
      } catch (err) {
        const message = clientMessage(err, 'Failed to submit reference');
        const status =
          message.includes('not authorized') ? 403 :
          message.includes('already been submitted') ? 409 :
          message.includes('not found') ? 404 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * POST /payments/:id/confirm
   *
   * Finance staff confirms a manual payment (in-school desk payment,
   * InstaPay after bank-statement verification, or legacy bank transfer).
   * Marks the payment 'completed' and all linked registrations 'confirmed'.
   *
   * - in_school: instrumentUsed (cash/card/instapay/other) is required —
   *   it records what the parent actually handed over at the desk.
   * - instapay: instrument is implicitly 'instapay'.
   *
   * Finance roles (officer / finance-admin / admin).
   */
  .post('/:id/confirm',
    requireAuth(),
    requireFinance(),
    zValidator('param', PaymentId),
    zValidator('json', ConfirmManualPayment),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const { notes, instrumentUsed } = c.req.valid('json');

      const pay = await paymentService.getPaymentById(id);
      if (!pay) return error(c, 'Payment not found', 404);

      const manualMethods = ['in_school', 'instapay', 'bank_transfer'];
      if (!manualMethods.includes(pay.paymentMethod)) {
        return error(c, 'Only in-school, InstaPay, and bank transfer payments are confirmed manually', 400);
      }

      if (pay.paymentMethod === 'in_school' && !instrumentUsed) {
        return error(c, 'Record the instrument used (cash, card, InstaPay, other) to confirm an in-school payment', 400);
      }

      const instrument = pay.paymentMethod === 'instapay' ? 'instapay' : instrumentUsed;

      try {
        // PAYMENT_CONFIRMED is written inside the confirmation's transaction,
        // and only by the caller that actually confirmed (MA-07).
        const confirmed = await paymentService.confirmPayment(id, user.id, undefined, notes, instrument, extractAuditContext(c));
        if (!confirmed) return error(c, 'This payment was already confirmed by someone else', 409);
        return success(c, confirmed);
      } catch (err) {
        const message = clientMessage(err, 'Failed to confirm payment');
        // A click that lands after another confirmation (or a rejection) has
        // committed is a conflict, the same answer as one that lost the race.
        return error(c, message, message.includes('already in') ? 409 : 400);
      }
    }
  )

  /**
   * POST /payments/:id/reverse  (UX_AUDIT G6)
   *
   * Finance admin reverses a mistaken confirmation — payment refunded,
   * registrations back to pending_payment, receipts voided (only while
   * still at the desk), escrow re-credited. Reason required; audited.
   */
  .post('/:id/reverse',
    requireAuth(),
    requireFinanceAdmin(),
    zValidator('param', PaymentId),
    zValidator('json', ReversePayment),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const { reason, moneyReturned } = c.req.valid('json');
      try {
        // PAYMENT_REVERSED is written inside the reversal's transaction (O-7).
        const result = await paymentService.reversePayment(id, user.id, reason, moneyReturned, extractAuditContext(c));
        return success(c, result);
      } catch (err) {
        const message = clientMessage(err, 'Failed to reverse payment');
        const status =
          message.includes('handed out') || message.includes('concurrently') || message.includes('already been dropped') ? 409 :
          message.includes('not found') ? 404 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * POST /payments/:id/record-transfer  (money audit review of MO-10)
   *
   * Finance records an InstaPay transfer found on the bank statement after
   * its payment had failed (lapsed, closed at the board deadline, or
   * rejected): the amount is credited to the family's escrow. The reference
   * is required only if the family never submitted one. Finance roles.
   */
  .post('/:id/record-transfer',
    requireAuth(),
    requireFinance(),
    zValidator('param', PaymentId),
    zValidator('json', RecordLateTransfer),
    async (c) => {
      const { id } = c.req.valid('param');
      try {
        return success(c, await paymentService.recordLateTransfer(id, c.get('user')!.id, c.req.valid('json'), extractAuditContext(c)));
      } catch (err) {
        const message = clientMessage(err, 'Failed to record the transfer');
        const status =
          message.includes('not found') ? 404 :
          message.includes('already') ? 409 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * POST /payments/:id/cancel  (money audit MA-02)
   *
   * A parent cancels a checkout they have not paid: escrow applied at
   * checkout comes back and the subjects are payable again by any method.
   * Refused once a transfer reference is in — finance decides then.
   *
   * Parent only — linked to the payment's student.
   */
  .post('/:id/cancel',
    requireAuth(),
    requireParent(),
    zValidator('param', PaymentId),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      try {
        return success(c, await paymentService.cancelPayment(id, user.id, extractAuditContext(c)));
      } catch (err) {
        const message = clientMessage(err, 'Failed to cancel payment');
        const status =
          message.includes('not authorized') ? 403 :
          message.includes('not found') ? 404 :
          message.includes('already in') || message.includes('reference has been submitted') ? 409 : 400;
        return error(c, message, status);
      }
    }
  )

  /**
   * POST /payments/:id/reject  (money audit MA-03)
   *
   * Finance rejects an open manual payment with a reason the family reads:
   * an InstaPay reference not on the bank statement, or an abandoned
   * checkout. Escrow applied comes back; the subjects are payable again
   * while the window is open for the student, and expire after it.
   *
   * Finance roles (officer / finance-admin / admin), as for confirmation.
   */
  .post('/:id/reject',
    requireAuth(),
    requireFinance(),
    zValidator('param', PaymentId),
    zValidator('json', RejectManualPayment),
    async (c) => {
      const user = c.get('user')!;
      const { id } = c.req.valid('param');
      const { reason } = c.req.valid('json');
      try {
        return success(c, await paymentService.rejectPayment(id, user.id, reason, extractAuditContext(c)));
      } catch (err) {
        const message = clientMessage(err, 'Failed to reject payment');
        const status =
          message.includes('not found') ? 404 :
          message.includes('already in') || message.includes('concurrently') ? 409 : 400;
        return error(c, message, status);
      }
    }
  );

/*
 * ──────────────────────────────────────────────────────────────────────────
 * V3: Provider webhooks DISABLED (V3_PLAN §6.11)
 * ──────────────────────────────────────────────────────────────────────────
 * The Fawry and Paymob webhook routes that previously lived here are
 * intentionally commented out — the school accepts only in-school and
 * InstaPay (manually verified) payments now. The full implementations
 * remain in git history (see commit d779fef and earlier) and the
 * integration adapters are kept under src/integrations/ for the day a
 * PSP ships a real InstaPay API (Paymob lists it "Coming Soon").
 *
 * To re-enable: restore the `.post('/webhook/fawry', ...)` and
 * `.post('/webhook/paymob', ...)` handlers from git history, re-import
 * FawryWebhookPayload / PaymobWebhookPayload and the signature
 * validators, and move the chain-terminating semicolon back here.
 */

export type PaymentsApi = typeof payments;
