/**
 * Paymob Payment Integration (Card Payments)
 *
 * Uses the Paymob Intention API (v1) for creating payment sessions:
 * 1. Backend creates an intention via POST /v1/intention
 * 2. Response contains a client_secret
 * 3. Customer is redirected to the Unified Checkout with the client_secret
 * 4. Paymob sends a webhook callback on payment completion
 *
 * Required env vars for real payments:
 *   PAYMOB_SECRET_KEY  — from Dashboard → Developers → API Keys
 *   PAYMOB_PUBLIC_KEY  — from Dashboard → Developers → API Keys
 *   PAYMOB_INTEGRATION_ID — from Dashboard → Developers → Payment Integrations (card)
 *
 * If any are missing, falls back to a stub for local development.
 *
 * Webhook HMAC validation is always available (uses PAYMOB_HMAC_SECRET).
 */

import { randomUUID, createHmac, timingSafeEqual } from 'crypto';

const PAYMOB_SECRET_KEY = process.env.PAYMOB_SECRET_KEY ?? process.env.PAYMOB_API_KEY ?? '';
const PAYMOB_PUBLIC_KEY = process.env.PAYMOB_PUBLIC_KEY ?? '';
const PAYMOB_INTEGRATION_ID = process.env.PAYMOB_INTEGRATION_ID ?? '';
const PAYMOB_BASE_URL = process.env.PAYMOB_BASE_URL ?? 'https://accept.paymob.com';

const isConfigured = !!(PAYMOB_SECRET_KEY && PAYMOB_PUBLIC_KEY && PAYMOB_INTEGRATION_ID);

export type PaymobOrderParams = {
  amountCents: number;
  merchantOrderId: string;
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
};

export type PaymobOrderResult = {
  paymentUrl: string;
  orderId: string;
};

/**
 * Create a Paymob payment intention and return the checkout URL.
 *
 * When credentials are configured, calls the real Paymob Intention API.
 * Otherwise returns a stub URL for local development.
 */
export async function createPaymobOrder(
  params: PaymobOrderParams
): Promise<PaymobOrderResult> {
  if (!isConfigured) {
    console.warn('[paymob] Missing credentials (PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY, or PAYMOB_INTEGRATION_ID) — using stub');
    const orderId = `PMOB-${randomUUID().slice(0, 8).toUpperCase()}`;
    return {
      paymentUrl: `${PAYMOB_BASE_URL}/api/acceptance/iframes/stub?payment_token=dev_token_${orderId}`,
      orderId,
    };
  }

  const [firstName, ...rest] = params.customerName.split(' ');
  const lastName = rest.join(' ') || firstName;

  const body = {
    amount: params.amountCents,
    currency: 'EGP',
    payment_methods: [Number(PAYMOB_INTEGRATION_ID)],
    items: [
      {
        name: 'IGCSE Subject Registration',
        amount: params.amountCents,
        quantity: 1,
      },
    ],
    billing_data: {
      first_name: firstName,
      last_name: lastName,
      email: params.customerEmail,
      phone_number: params.customerPhone || '+20000000000',
      country: 'EG',
      apartment: 'NA',
      floor: 'NA',
      street: 'NA',
      building: 'NA',
      shipping_method: 'NA',
      postal_code: 'NA',
      city: 'NA',
      state: 'NA',
    },
    special_reference: params.merchantOrderId,
    redirection_url: process.env.PAYMOB_REDIRECT_URL || `${process.env.CORS_ORIGINS?.split(',')[0] || 'http://localhost:3000'}/registrations`,
  };

  const response = await fetch(`${PAYMOB_BASE_URL}/v1/intention/`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${PAYMOB_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[paymob] Intention API error:', response.status, errorBody);
    throw new Error(`Paymob payment creation failed: ${response.status}`);
  }

  const data = await response.json() as {
    client_secret: string;
    intention_order_id: number;
    id: string;
  };

  const clientSecret = data.client_secret;
  const orderId = data.id || String(data.intention_order_id);

  const paymentUrl = `${PAYMOB_BASE_URL}/unifiedcheckout/?publicKey=${PAYMOB_PUBLIC_KEY}&clientSecret=${clientSecret}`;

  console.log('[paymob] Intention created — orderId:', orderId, 'redirecting to unified checkout');

  return {
    paymentUrl,
    orderId,
  };
}

const PAYMOB_HMAC_SECRET = process.env.PAYMOB_HMAC_SECRET ?? '';

/**
 * Validate a Paymob webhook HMAC signature.
 *
 * Fail-closed: when HMAC secret is not configured, ALL webhooks are REJECTED.
 *
 * The transaction HMAC is HMAC-SHA512 over the concatenation (no separator)
 * of these Paymob transaction fields IN THIS EXACT ORDER:
 *
 *   amount_cents, created_at, currency, error_occured, has_parent_transaction,
 *   id, integration_id, is_3d_secure, is_auth, is_capture, is_refunded,
 *   is_standalone_payment, is_voided, order.id, owner, pending,
 *   source_data.pan, source_data.sub_type, source_data.type, success
 *
 * Four of the fields are nested (dot notation). Missing subfields are
 * coerced to empty string to match Paymob's server-side behaviour.
 *
 * Reference: https://docs.paymob.com/docs/hmac-calculation
 */
export function validatePaymobWebhookSignature(
  payload: Record<string, unknown>,
  hmac: string
): boolean {
  if (!PAYMOB_HMAC_SECRET) {
    console.error('[paymob] No HMAC secret configured — rejecting webhook (fail-closed)');
    return false;
  }
  if (!hmac) return false;

  const obj = (payload.obj ?? payload) as Record<string, unknown>;
  const fields = [
    'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction',
    'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
    'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending',
    'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
  ];

  const concatenated = fields
    .map((key) => {
      const val = key.includes('.')
        ? key.split('.').reduce<unknown>((o, k) => {
            if (o && typeof o === 'object' && k in (o as Record<string, unknown>)) {
              return (o as Record<string, unknown>)[k];
            }
            return undefined;
          }, obj)
        : obj[key];
      // Paymob stringifies booleans as 'true'/'false' and null/undefined as ''.
      // Numbers, strings, and booleans stringify naturally with String(); we
      // only need to guard against objects leaking through (which is what
      // caused the previous ordering bug — `order` used to be stringified as
      // "[object Object]" before we switched to `order.id`).
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return '';
      return String(val);
    })
    .join('');

  const expected = createHmac('sha512', PAYMOB_HMAC_SECRET)
    .update(concatenated)
    .digest('hex');

  try {
    const expectedBuf = Buffer.from(expected, 'utf8');
    const receivedBuf = Buffer.from(hmac, 'utf8');
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}
