/**
 * Mobile Wallet Integration
 *
 * Stub implementation for Egyptian mobile wallet providers:
 * Vodafone Cash, Orange Money, Etisalat Cash, WE Pay.
 *
 * All providers are integrated through Paymob's wallet APIs in production.
 *
 * TODO (Production): Use Paymob wallet integration:
 * 1. Same order creation flow as card
 * 2. Different integration ID per wallet provider
 * 3. POST /api/acceptance/payments/pay with { source: { identifier: walletNumber, subtype: 'WALLET' }}
 * 4. Redirects user to OTP flow on their mobile wallet app
 *
 * Required env vars (add when integrating):
 * - PAYMOB_WALLET_INTEGRATION_ID_VODAFONE
 * - PAYMOB_WALLET_INTEGRATION_ID_ORANGE
 * - PAYMOB_WALLET_INTEGRATION_ID_ETISALAT
 * - PAYMOB_WALLET_INTEGRATION_ID_WE
 */

import { randomUUID } from 'crypto';

export type WalletProvider = 'vodafone_cash' | 'orange_money' | 'etisalat_cash' | 'we_pay';

export type WalletPaymentParams = {
  amountCents: number;
  merchantOrderId: string;
  walletProvider: WalletProvider;
  customerEmail: string;
  customerName: string;
};

export type WalletPaymentResult = {
  redirectUrl: string;     // User opens this URL to authenticate with their wallet
  referenceCode: string;   // Reference code shown in confirmation SMS
};

// Static wallet numbers per provider (for display to the user in stub mode)
const STUB_WALLET_NUMBERS: Record<WalletProvider, string> = {
  vodafone_cash:  '01000000000',
  orange_money:   '01200000000',
  etisalat_cash:  '01100000000',
  we_pay:         '01500000000',
};

/**
 * Initiate a mobile wallet payment.
 *
 * Stub: returns a placeholder redirect URL and random reference code.
 * Production: creates a Paymob order with the appropriate wallet integration ID
 *             and redirects the user to the OTP authentication page.
 *
 * M-11: In production we log a loud error so ops knows wallet payments
 * are non-functional even though the validation accepts the method. The
 * stubbed return value is fine for local development but would confuse
 * real customers in production — this is a URD PAY-003 gap tracked
 * separately, not a runtime crash.
 */
export async function initiateWalletPayment(
  params: WalletPaymentParams
): Promise<WalletPaymentResult> {
  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[wallet] Mobile wallet integration is not yet implemented. Returning a stub redirect — customers will NOT be able to complete the payment. ' +
      `Provider: ${params.walletProvider}, merchantOrderId: ${params.merchantOrderId}`
    );
  } else {
    console.warn(
      `[wallet:stub] Simulating ${params.walletProvider} payment for order ${params.merchantOrderId}`
    );
  }

  const referenceCode = Math.floor(Math.random() * 900000 + 100000).toString();
  const walletNumber = STUB_WALLET_NUMBERS[params.walletProvider];

  return {
    redirectUrl: `https://stub-wallet.example.com/pay?ref=${referenceCode}&wallet=${walletNumber}`,
    referenceCode,
  };
}
