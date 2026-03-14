/**
 * Paymob Payment Integration (Card Payments)
 *
 * Stub implementation for Paymob card payment gateway.
 * Returns structurally correct data for development and testing.
 *
 * TODO (Production): Replace with actual Paymob API flow:
 * 1. POST /api/auth/tokens → get auth token
 * 2. POST /api/ecommerce/orders → create order, get order ID
 * 3. POST /api/acceptance/payment_keys → get payment key for iframe
 * 4. Redirect user to: https://accept.paymob.com/api/acceptance/iframes/{iframeId}?payment_token={key}
 * 5. Validate webhook HMAC: SHA512 of sorted transaction fields + HMAC secret
 *
 * Required env vars (add when integrating):
 * - PAYMOB_API_KEY
 * - PAYMOB_INTEGRATION_ID (card)
 * - PAYMOB_IFRAME_ID
 * - PAYMOB_HMAC_SECRET
 */

import { randomUUID } from 'crypto';

export type PaymobOrderParams = {
  amountCents: number;       // Amount in EGP cents (amount * 100)
  merchantOrderId: string;   // Our payment ID
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
};

export type PaymobOrderResult = {
  paymentUrl: string;        // Redirect user to this URL to complete payment
  orderId: string;           // Paymob order ID (stored as externalReference)
};

/**
 * Create a Paymob card payment order and return the payment URL.
 *
 * Stub: returns a placeholder payment URL.
 * Production: executes the 3-step Paymob auth → order → payment key flow.
 */
export async function createPaymobOrder(
  params: PaymobOrderParams
): Promise<PaymobOrderResult> {
  // TODO: Replace with actual Paymob API flow (auth, order creation, payment key)
  const orderId = `PMOB-${randomUUID().slice(0, 8).toUpperCase()}`;

  return {
    paymentUrl: `https://accept.paymob.com/api/acceptance/iframes/stub?payment_token=dev_token_${orderId}`,
    orderId,
  };
}

/**
 * Validate a Paymob webhook HMAC signature.
 *
 * Stub: always returns true in development.
 * Production: SHA512(sorted_transaction_fields + HMAC_secret)
 */
export function validatePaymobWebhookSignature(
  _payload: Record<string, unknown>,
  _hmac: string
): boolean {
  // TODO: Implement HMAC validation
  return true;
}
