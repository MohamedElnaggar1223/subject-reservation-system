/**
 * Payment Validation Schemas
 *
 * Zod schemas for the full payment workflow:
 * - Parent initiates payment for pending registrations (PAY-001 to PAY-005)
 * - Admin manually confirms bank transfer payments (PAY-007)
 * - Webhook payload validation for automated payment methods
 */

import { z } from 'zod';

// ─── Payment Method Enum ──────────────────────────────────────────────────────

export const PAYMENT_METHODS = [
  'fawry',
  'card',
  'mobile_wallet',
  'bank_transfer',
] as const;

export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PAYMENT_METHOD_LABELS: Record<typeof PAYMENT_METHODS[number], string> = {
  fawry:         'Fawry',
  card:          'Credit / Debit Card',
  mobile_wallet: 'Mobile Wallet',
  bank_transfer: 'Bank Transfer',
};

// ─── Payment Status Enum ──────────────────────────────────────────────────────

export const PAYMENT_STATUSES = [
  'pending',
  'completed',
  'failed',
  'refunded',
] as const;

export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PAYMENT_STATUS_LABELS: Record<typeof PAYMENT_STATUSES[number], string> = {
  pending:   'Pending',
  completed: 'Completed',
  failed:    'Failed',
  refunded:  'Refunded',
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
  id: z.string().uuid('Invalid payment ID'),
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
  registrationIds: z
    .array(z.string().uuid('Invalid registration ID'))
    .min(1, 'Select at least one registration to pay for'),
  paymentMethod: PaymentMethodSchema,
  escrowAmountToApply: z.number().min(0).default(0),
  walletProvider: WalletProviderSchema.optional(),
}).refine(
  (data) => data.paymentMethod !== 'mobile_wallet' || !!data.walletProvider,
  { message: 'walletProvider is required for mobile wallet payments', path: ['walletProvider'] }
);
export type InitiatePaymentType = z.infer<typeof InitiatePayment>;

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
  paymentAmount: z.number(),
  referenceNumber: z.string(),
});
export type FawryWebhookPayloadType = z.infer<typeof FawryWebhookPayload>;

// ─── Paymob Webhook Payload ───────────────────────────────────────────────────

/**
 * Paymob sends a transaction response via webhook.
 * In production, validate the HMAC hash before processing.
 * The obj.merchant_order_id maps to our payment ID.
 */
export const PaymobWebhookPayload = z.object({
  obj: z.object({
    merchant_order_id: z.string(),
    success: z.boolean(),
    amount_cents: z.number(),
    id: z.number(),
  }),
});
export type PaymobWebhookPayloadType = z.infer<typeof PaymobWebhookPayload>;

// ─── Query Filters ────────────────────────────────────────────────────────────

export const ListPaymentsQuery = z.object({
  studentId: z.string().uuid().optional(),
  status:    PaymentStatusSchema.optional(),
  method:    PaymentMethodSchema.optional(),
});
export type ListPaymentsQueryType = z.infer<typeof ListPaymentsQuery>;

// ─── Checkout Summary Query ───────────────────────────────────────────────────

export const CheckoutSummaryQuery = z.object({
  registrationIds: z.string().min(1, 'At least one registration ID required'),
});
export type CheckoutSummaryQueryType = z.infer<typeof CheckoutSummaryQuery>;
