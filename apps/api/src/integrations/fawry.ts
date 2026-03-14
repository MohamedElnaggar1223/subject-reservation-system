/**
 * Fawry Payment Integration
 *
 * Stub implementation for Fawry payment gateway.
 * Returns structurally correct data for development and testing.
 *
 * TODO (Production): Replace stub functions with actual Fawry API calls:
 * - Authenticate with merchant credentials from env
 * - POST to https://www.atfawry.com/ECommerceWeb/Fawry/payments/charge
 * - Validate webhook signatures using SHA256(merchantCode + merchantRefNum + paymentAmount + sharedSecret)
 * - Handle payment status: PAID, UNPAID, EXPIRED, CANCELLED
 *
 * Required env vars (add when integrating):
 * - FAWRY_MERCHANT_CODE
 * - FAWRY_MERCHANT_SECRET
 * - FAWRY_API_URL
 */

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

/**
 * Validate a Fawry webhook notification signature.
 *
 * Stub: always returns true in development.
 * Production: validate SHA256(merchantCode + merchantRefNum + paymentAmount + sharedSecret)
 */
export function validateFawryWebhookSignature(
  _payload: Record<string, unknown>,
  _signature: string
): boolean {
  // TODO: Implement actual signature validation
  // const expected = sha256(merchantCode + payload.merchantRefNum + payload.paymentAmount + sharedSecret)
  // return expected === signature
  return true;
}
