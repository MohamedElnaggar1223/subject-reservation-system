/**
 * Fawry Payment Integration
 *
 * Stub implementation for Fawry payment gateway.
 * Returns structurally correct data for development and testing.
 *
 * TODO (Production): Replace generateFawryPayment stub with actual Fawry API calls.
 *
 * Webhook signature validation is implemented below using SHA-256.
 * Confirm the exact concatenation order against official Fawry docs before going live —
 * gateway specifications can change between API versions.
 */

import { createHash, timingSafeEqual } from 'crypto';

export type FawryPaymentParams = {
  amount: number;           // Amount in EGP
  merchantRefNum: string;  // Our payment ID (stored as externalReference)
  customerName: string;
  customerEmail: string;
  description: string;
};

export type FawryPaymentResult = {
  referenceNumber: string; // 12-digit code the customer uses at a Fawry outlet
  expiresAt: string;       // ISO timestamp — code expires after 24 hours
  merchantRefNum: string;
};

/**
 * Generate a Fawry payment reference number.
 *
 * Stub: returns a random 12-digit reference number valid for 24 hours.
 * Production: calls the Fawry charge API and returns the provider-issued reference.
 */
export async function generateFawryPayment(
  params: FawryPaymentParams
): Promise<FawryPaymentResult> {
  // TODO: Replace with actual Fawry API call
  const referenceNumber = Math.floor(
    Math.random() * 900000000000 + 100000000000
  ).toString();

  return {
    referenceNumber,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    merchantRefNum: params.merchantRefNum,
  };
}

const FAWRY_MERCHANT_CODE = process.env.FAWRY_MERCHANT_CODE ?? '';
const FAWRY_SECURE_KEY = process.env.FAWRY_SECURE_KEY ?? '';

/**
 * Validate a Fawry webhook notification signature.
 *
 * Fail-closed: when credentials are not configured, ALL webhooks are REJECTED.
 * When configured: validates SHA-256(merchantCode + merchantRefNum + orderAmount +
 *   orderStatus + paymentMethod + fawryFees + statusDescription + shippingFees + secureKey).
 *
 * NOTE: Confirm the exact field concatenation order against official Fawry API docs before production deployment.
 */
export function validateFawryWebhookSignature(
  payload: Record<string, unknown>,
  signature: string
): boolean {
  if (!FAWRY_MERCHANT_CODE || !FAWRY_SECURE_KEY) {
    console.error('[fawry] No merchant credentials configured — rejecting webhook (fail-closed)');
    return false;
  }

  const raw = [
    FAWRY_MERCHANT_CODE,
    String(payload.merchantRefNum ?? ''),
    String(payload.paymentAmount ?? ''),
    String(payload.orderStatus ?? ''),
    String(payload.paymentMethod ?? ''),
    String(payload.fawryFees ?? ''),
    String(payload.statusDescription ?? ''),
    String(payload.shippingFees ?? ''),
    FAWRY_SECURE_KEY,
  ].join('');

  const expected = createHash('sha256').update(raw).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
