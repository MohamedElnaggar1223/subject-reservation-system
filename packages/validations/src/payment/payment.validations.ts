/**
 * Payment Validation Schemas
 *
 * Zod schemas for the full payment workflow:
 * - Parent initiates payment for pending registrations (PAY-001 to PAY-005)
 * - Admin manually confirms bank transfer payments (PAY-007)
 * - Webhook payload validation for automated payment methods
 */

import { z } from 'zod';
import { isWholePiastres, PIASTRES_MESSAGE } from '../common.validations';
import { ReservationConsent } from '../registration/reservation.validations';

// ─── Payment Method Enum ──────────────────────────────────────────────────────

/**
 * Full method enum includes legacy values (fawry/card/mobile_wallet/
 * bank_transfer) so historical payment rows keep validating and
 * rendering. New payments may only use ACTIVE_PAYMENT_METHODS (V3:
 * in-school desk payment or InstaPay transfer — see V3_PLAN.md §5.2).
 */
export const PAYMENT_METHODS = [
  'in_school',
  'instapay',
  'fawry',
  'card',
  'mobile_wallet',
  'bank_transfer',
  // The reservations rework (§3.6): a plan line paid from its instalments in the held wallet —
  // the capture's own payment, made by the system (never chosen by a family).
  'held_deposits',
] as const;

export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const ACTIVE_PAYMENT_METHODS = ['in_school', 'instapay'] as const;
export const ActivePaymentMethodSchema = z.enum(ACTIVE_PAYMENT_METHODS);
export type ActivePaymentMethod = z.infer<typeof ActivePaymentMethodSchema>;

export const PAYMENT_METHOD_LABELS: Record<typeof PAYMENT_METHODS[number], string> = {
  in_school:     'Pay at School',
  instapay:      'InstaPay',
  fawry:         'Fawry',
  card:          'Credit / Debit Card',
  mobile_wallet: 'Mobile Wallet',
  bank_transfer: 'Bank Transfer',
  held_deposits: 'Paid from instalments',
};

// ─── Payment Purpose Enum ─────────────────────────────────────────────────────

/**
 * One payments pipeline for every kind of money-in (V3_PLAN.md §5.2).
 * Only 'registration' is used in Phase 1; the rest arrive with school
 * fees, preregistration, and remarks.
 */
export const PAYMENT_PURPOSES = [
  'registration',
  'school_fee',
  'preregistration',
  'remark',
  // The reservations rework (§3.10 item 1): charges, never mixed with lines (payment_charge).
  'charge',
] as const;

export const PaymentPurposeSchema = z.enum(PAYMENT_PURPOSES);
export type PaymentPurpose = z.infer<typeof PaymentPurposeSchema>;

export const PAYMENT_PURPOSE_LABELS: Record<typeof PAYMENT_PURPOSES[number], string> = {
  registration:    'Subject Registration',
  school_fee:      'School Fee',
  preregistration: 'Preregistration',
  remark:          'Remark Request',
  charge:          'Charges',
};

// ─── In-School Instrument Enum ────────────────────────────────────────────────

/**
 * What the parent actually handed over at the finance desk. Recorded
 * by the finance officer when confirming an in-school payment.
 */
export const IN_SCHOOL_INSTRUMENTS = [
  'cash',
  'card',
  'instapay',
  'other',
] as const;

export const InSchoolInstrumentSchema = z.enum(IN_SCHOOL_INSTRUMENTS);
export type InSchoolInstrument = z.infer<typeof InSchoolInstrumentSchema>;

export const IN_SCHOOL_INSTRUMENT_LABELS: Record<typeof IN_SCHOOL_INSTRUMENTS[number], string> = {
  cash:     'Cash',
  card:     'Credit / Debit Card',
  instapay: 'InstaPay (at desk)',
  other:    'Other',
};

// ─── Payment Status Enum ──────────────────────────────────────────────────────

/**
 * pending_verification: an InstaPay payment whose transfer reference has
 * been submitted by the parent and is awaiting finance verification
 * against the bank statement. Never auto-completed.
 */
export const PAYMENT_STATUSES = [
  'pending',
  'pending_verification',
  'completed',
  'failed',
  'refunded',
] as const;

export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PAYMENT_STATUS_LABELS: Record<typeof PAYMENT_STATUSES[number], string> = {
  pending:              'Pending',
  pending_verification: 'Awaiting Verification',
  completed:            'Completed',
  failed:               'Failed',
  refunded:             'Refunded',
};

// ─── Mobile Wallet Providers ──────────────────────────────────────────────────

export const WALLET_PROVIDERS = [
  'vodafone_cash',
  'orange_money',
  'etisalat_cash',
  'we_pay',
] as const;

export const WalletProviderSchema = z.enum(WALLET_PROVIDERS);
export type WalletProvider = z.infer<typeof WalletProviderSchema>;

export const WALLET_PROVIDER_LABELS: Record<typeof WALLET_PROVIDERS[number], string> = {
  vodafone_cash:  'Vodafone Cash',
  orange_money:   'Orange Money',
  etisalat_cash:  'Etisalat Cash',
  we_pay:         'WE Pay',
};

// ─── Param Validation ─────────────────────────────────────────────────────────

export const PaymentId = z.object({
  id: z.string().min(1, 'Invalid payment ID'),
});
export type PaymentIdType = z.infer<typeof PaymentId>;

// ─── Initiate Payment ─────────────────────────────────────────────────────────

/**
 * Parent initiates a payment for one or more registrations in 'pending_payment' status.
 * All registrations must belong to the same student.
 *
 * escrowAmountToApply: how much of the student's escrow balance to use.
 *   - 0 means no escrow applied
 *   - Must not exceed the student's available escrow balance
 *   - Must not exceed the total registration cost
 *
 * walletProvider: required when paymentMethod = 'mobile_wallet'
 */
export const InitiatePayment = z.object({
  registrationIds: z.array(z.string().min(1, 'Invalid registration ID')).max(50).default([]),
  // The reservations rework (§3.10 item 1): or charges — one purpose per payment, never both.
  chargeIds: z.array(z.string().min(1, 'Invalid charge ID')).max(50).default([]),
  // V3: only in_school / instapay accepted for new payments.
  paymentMethod: ActivePaymentMethodSchema,
  escrowAmountToApply: z.number().min(0).max(1_000_000, 'Amount exceeds maximum allowed').refine(isWholePiastres, PIASTRES_MESSAGE).default(0),
  // A line the school reserved (grade 10) carries the school's consent only: the family gives its
  // own pair at checkout (RESERVATIONS_REWORK.md §3.5).
  consent: ReservationConsent.optional(),
})
  .refine((d) => d.registrationIds.length > 0 || d.chargeIds.length > 0, { message: 'Select at least one registration to pay for', path: ['registrationIds'] })
  .refine((d) => !(d.registrationIds.length > 0 && d.chargeIds.length > 0), {
    message: 'Subjects and charges are paid in separate payments: pay one, then the other', path: ['chargeIds'],
  });
export type InitiatePaymentType = z.infer<typeof InitiatePayment>;

// ─── Parent: Submit InstaPay Transfer Reference ───────────────────────────────

/**
 * After transferring to the school's account via InstaPay, the parent
 * submits the transaction reference (opaque string — no published
 * format exists) and optionally a screenshot upload. This moves the
 * payment to 'pending_verification'; a finance officer verifies it
 * against the bank statement before completing. Never auto-confirmed.
 */
export const SubmitInstapayReference = z.object({
  reference: z
    .string()
    .trim()
    .min(4, 'Enter the transaction reference from your InstaPay receipt')
    .max(100, 'Reference is too long'),
  screenshotFileId: z.string().min(1).optional(),
});
export type SubmitInstapayReferenceType = z.infer<typeof SubmitInstapayReference>;

// ─── Finance: Confirm Manual Payment ──────────────────────────────────────────

/**
 * Finance officer confirms an in-school or InstaPay payment.
 * - in_school: instrumentUsed records what the parent handed over.
 * - instapay: instrument is implicitly 'instapay'; officer confirms after
 *   matching the reference against the bank statement.
 */
export const ConfirmManualPayment = z.object({
  instrumentUsed: InSchoolInstrumentSchema.optional(),
  notes: z.string().max(500).optional(),
});
export type ConfirmManualPaymentType = z.infer<typeof ConfirmManualPayment>;

// ─── Finance Admin: Reverse a Confirmation ───────────────────────────────────

/**
 * Reverse a completed payment. `moneyReturned` answers the question the
 * reversal must ask (owner decision MO-11): was the money given back to the
 * family? Yes: it is money out on today's takings. No — the confirmation
 * was a mistake and nothing had been received: the confirmation day's money
 * in is corrected instead, and today's drawer does not move.
 */
export const ReversePayment = z.object({
  reason: z.string().min(3, 'A reason is required').max(500),
  moneyReturned: z.boolean({ error: 'Say whether the money was returned to the family' }),
});
export type ReversePaymentType = z.infer<typeof ReversePayment>;

// ─── Finance: Reject Manual Payment ───────────────────────────────────────────

/**
 * Finance rejects an open manual payment: an InstaPay reference that is not
 * on the bank statement, or a checkout the family abandoned. The reason is
 * shown to the family, so it must say what finance found.
 */
export const RejectManualPayment = z.object({
  reason: z.string().trim().min(5, 'Say why the payment is rejected (min 5 characters)').max(500),
});
export type RejectManualPaymentType = z.infer<typeof RejectManualPayment>;

/**
 * Finance records a transfer found on the bank statement after its payment
 * had failed — lapsed after the close, rejected, or closed at the board's
 * entry deadline. The money is credited to the family's escrow; the
 * registrations stay as they are (money audit review of MO-10).
 */
export const RecordLateTransfer = z.object({
  notes: z.string().trim().min(5, 'Say where the transfer was found (min 5 characters)').max(500),
  // Always the reference on the bank statement — never the family's, which
  // may be the very one finance could not find (review of fc1a101, flag 1).
  reference: z.string().trim().min(4, 'Enter the transfer reference from the bank statement').max(100),
  // What actually arrived, which is what the family's escrow is credited.
  amount: z.number({ error: 'Enter the amount on the bank statement, in EGP' }).positive('Enter the amount on the bank statement')
    .max(1_000_000, 'Amount exceeds maximum allowed')
    .refine(isWholePiastres, PIASTRES_MESSAGE),
});
export type RecordLateTransferType = z.infer<typeof RecordLateTransfer>;

/** A finance admin undoes a "Transfer found" recorded by mistake, the same day (MO-24). */
export const UndoLateTransfer = z.object({
  reason: z.string().trim().min(5, 'Say why it was recorded by mistake (min 5 characters)').max(500),
});

// ─── Admin: Confirm Bank Transfer ─────────────────────────────────────────────

/**
 * Admin manually confirms a pending bank transfer payment (PAY-007).
 * Moves the payment to 'completed' and all linked registrations to 'confirmed'.
 * Admin notes are stored on the payment record for audit purposes.
 */
export const ConfirmBankTransfer = z.object({
  notes: z.string().max(500).optional(),
});
export type ConfirmBankTransferType = z.infer<typeof ConfirmBankTransfer>;

// ─── Fawry Webhook Payload ────────────────────────────────────────────────────

/**
 * Fawry sends a webhook notification when payment status changes.
 * In production, the signature must be validated before processing.
 * merchantRefNum maps to our payment's externalReference.
 */
export const FawryWebhookPayload = z.object({
  merchantRefNum: z.string(),
  orderStatus: z.string(), // 'PAID', 'UNPAID', 'EXPIRED', 'CANCELLED'
  paymentAmount: z.number().min(0, 'Payment amount cannot be negative').max(1_000_000, 'Amount exceeds maximum allowed'),
  referenceNumber: z.string(),
});
export type FawryWebhookPayloadType = z.infer<typeof FawryWebhookPayload>;

// ─── Paymob Webhook Payload ───────────────────────────────────────────────────

/**
 * Paymob sends a transaction response via webhook.
 * In production, validate the HMAC hash before processing.
 *
 * The payload structure varies between the legacy flow and the Intention API:
 * - Legacy: obj.merchant_order_id is our payment ID
 * - Intention API: obj.order.merchant_order_id holds our special_reference,
 *   while obj.merchant_order_id may be null
 *
 * We accept both formats with passthrough to avoid rejecting unknown fields.
 */
export const PaymobWebhookPayload = z.object({
  obj: z.object({
    merchant_order_id: z.union([z.string(), z.null()]).optional(),
    success: z.boolean(),
    amount_cents: z.number(),
    id: z.number(),
    order: z.object({
      merchant_order_id: z.union([z.string(), z.null()]).optional(),
    }).passthrough().optional(),
    pending: z.boolean().optional(),
  }).passthrough(),
}).passthrough();
export type PaymobWebhookPayloadType = z.infer<typeof PaymobWebhookPayload>;

// ─── Query Filters ────────────────────────────────────────────────────────────

export const ListPaymentsQuery = z.object({
  studentId: z.string().min(1).optional(),
  status:    PaymentStatusSchema.optional(),
  method:    PaymentMethodSchema.optional(),
});
export type ListPaymentsQueryType = z.infer<typeof ListPaymentsQuery>;

// ─── Checkout Summary Query ───────────────────────────────────────────────────

export const CheckoutSummaryQuery = z.object({
  registrationIds: z.string().min(1, 'At least one registration ID required'),
});
export type CheckoutSummaryQueryType = z.infer<typeof CheckoutSummaryQuery>;
