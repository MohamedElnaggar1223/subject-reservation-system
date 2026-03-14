'use client';

/**
 * Checkout Client Component — Parents Only
 *
 * Interactive payment flow for pending_payment registrations.
 *
 * Features:
 * - Displays registration summary (subjects, session, prices)
 * - Escrow balance display with apply-to-checkout option
 * - Payment method selection: Fawry, Card, Mobile Wallet, Bank Transfer
 * - Mobile wallet provider sub-selection
 * - Real-time total calculation (total − escrow applied)
 * - Submission → POST /v1/payments/initiate
 * - Post-payment display of provider-specific instructions
 *   (Fawry code, payment URL, bank transfer details)
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  WALLET_PROVIDERS,
  WALLET_PROVIDER_LABELS,
  type PaymentMethod,
  type WalletProvider,
} from '@repo/validations';

interface CheckoutClientProps {
  registrationIds: string[];
}

type CheckoutSummary = {
  registrations: Array<{
    id: string;
    priceAtRegistration: number;
    status: string;
    subject: { name: string; code: string };
    session: { name: string; sessionType: string };
    student: { id: string; name: string; grade: string | null };
  }>;
  totalCost: number;
  escrowBalance: number;
  student: { id: string; name: string; grade: string | null };
};

type PaymentResult = {
  id: string;
  paymentMethod: string;
  amount: number;
  escrowAmountApplied: number;
  externalReference: string | null;
  metadata: Record<string, unknown>;
};

export default function CheckoutClient({ registrationIds }: CheckoutClientProps) {
  const router = useRouter();

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('fawry');
  const [selectedWallet, setSelectedWallet] = useState<WalletProvider>('vodafone_cash');
  const [applyEscrow, setApplyEscrow] = useState(false);
  const [escrowAmount, setEscrowAmount] = useState(0);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [submitError, setSubmitError] = useState('');

  const summaryKey = registrationIds.join(',');

  const { data: summary, isLoading, isError } = useQuery<CheckoutSummary>({
    queryKey: ['payments', 'checkout-summary', summaryKey],
    queryFn: () =>
      apiResponse(
        api.v1.payments['checkout-summary'].$get({
          query: { registrationIds: summaryKey },
        })
      ),
  });

  const initiateMutation = useMutation({
    mutationFn: async () => {
      const escrowToApply = applyEscrow ? Math.min(escrowAmount, summary?.escrowBalance ?? 0, summary?.totalCost ?? 0) : 0;

      return apiResponse(
        api.v1.payments.initiate.$post({
          json: {
            registrationIds,
            paymentMethod: selectedMethod,
            escrowAmountToApply: escrowToApply,
            walletProvider: selectedMethod === 'mobile_wallet' ? selectedWallet : undefined,
          },
        })
      );
    },
    onSuccess: (data) => {
      setResult(data as PaymentResult);
      setSubmitError('');
    },
    onError: (err: Error) => {
      setSubmitError(err.message);
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (isError || !summary) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 font-medium">Unable to load checkout details.</p>
          <p className="text-sm text-gray-500 mt-1">
            Verify the registrations belong to a linked child and are ready for payment.
          </p>
          <button
            onClick={() => router.push('/registrations')}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors"
          >
            Back to Registrations
          </button>
        </div>
      </div>
    );
  }

  const escrowToApply = applyEscrow
    ? Math.min(escrowAmount, summary.escrowBalance, summary.totalCost)
    : 0;
  const amountDue = Math.max(0, summary.totalCost - escrowToApply);

  // ─── Post-payment Result View ────────────────────────────────────────────

  if (result) {
    const meta = result.metadata as Record<string, unknown>;
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-xl mx-auto px-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <div className="flex flex-col items-center gap-3 mb-8">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-gray-900">Payment Initiated</h1>
              <p className="text-sm text-gray-500 text-center">
                Your payment is pending. Follow the instructions below to complete it.
              </p>
            </div>

            {/* Fawry Code */}
            {result.paymentMethod === 'fawry' && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5 text-center">
                <p className="text-sm font-medium text-yellow-800 mb-2">Fawry Reference Code</p>
                <p className="text-3xl font-bold tracking-widest text-yellow-900 font-mono">
                  {result.externalReference}
                </p>
                <p className="text-xs text-yellow-700 mt-3">
                  Pay this amount at any Fawry outlet within 24 hours.
                  Expires: {meta.fawryExpiresAt
                    ? new Date(meta.fawryExpiresAt as string).toLocaleString()
                    : '24h from now'}
                </p>
              </div>
            )}

            {/* Card Payment URL */}
            {result.paymentMethod === 'card' && meta.paymentUrl && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-center">
                <p className="text-sm font-medium text-blue-800 mb-4">Complete your card payment</p>
                <a
                  href={meta.paymentUrl as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Pay Now
                </a>
                <p className="text-xs text-blue-700 mt-3">Opens secure payment page in a new tab</p>
              </div>
            )}

            {/* Mobile Wallet */}
            {result.paymentMethod === 'mobile_wallet' && meta.redirectUrl && (
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 text-center">
                <p className="text-sm font-medium text-purple-800 mb-2">Mobile Wallet Payment</p>
                <p className="text-lg font-bold text-purple-900 font-mono mb-1">
                  Ref: {meta.referenceCode as string}
                </p>
                <a
                  href={meta.redirectUrl as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-3 px-5 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors"
                >
                  Open Wallet
                </a>
              </div>
            )}

            {/* Bank Transfer Details */}
            {result.paymentMethod === 'bank_transfer' && meta.bankDetails && (() => {
              const bank = meta.bankDetails as {
                bankName: string; accountName: string; accountNumber: string;
                swiftCode: string; branch: string; referenceNumber: string;
              };
              return (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
                  <p className="text-sm font-medium text-gray-700 mb-4">Bank Transfer Details</p>
                  <dl className="space-y-2 text-sm">
                    {[
                      ['Bank Name', bank.bankName],
                      ['Account Name', bank.accountName],
                      ['Account Number', bank.accountNumber],
                      ['SWIFT Code', bank.swiftCode],
                      ['Branch', bank.branch],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-4">
                        <dt className="text-gray-500">{label}</dt>
                        <dd className="font-medium text-gray-900 font-mono text-right">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-center">
                    <p className="text-xs text-indigo-700 mb-1">Payment Reference (required)</p>
                    <p className="text-lg font-bold text-indigo-900 font-mono">{bank.referenceNumber}</p>
                    <p className="text-xs text-indigo-700 mt-1">
                      Include this reference when making the transfer so it can be matched to your account.
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Summary footer */}
            <div className="mt-6 pt-6 border-t border-gray-100 flex justify-between text-sm text-gray-600">
              <span>Amount due</span>
              <span className="font-semibold text-gray-900">
                {amountDue.toFixed(2)} EGP
                {escrowToApply > 0 && (
                  <span className="text-xs font-normal text-green-600 ml-1">
                    (+ {escrowToApply.toFixed(2)} escrow)
                  </span>
                )}
              </span>
            </div>

            <button
              onClick={() => router.push('/registrations')}
              className="mt-6 w-full py-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
            >
              Back to Registrations
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Checkout Form ────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-2xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Checkout</h1>
          <p className="text-sm text-gray-500 mt-1">
            Complete payment for {summary.student.name}&apos;s subject registration
          </p>
        </div>

        <div className="space-y-6">
          {/* Registration Summary */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Registration Summary</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {summary.registrations.map((reg) => (
                <div key={reg.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {reg.subject.name}
                      <span className="ml-2 text-xs text-gray-400 font-mono">{reg.subject.code}</span>
                    </p>
                    <p className="text-xs text-gray-500">{reg.session.name}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-900 shrink-0 ml-4">
                    {reg.priceAtRegistration.toFixed(2)} EGP
                  </span>
                </div>
              ))}
            </div>
            <div className="px-6 py-3 bg-gray-50 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">Total</span>
              <span className="text-base font-bold text-gray-900">
                {summary.totalCost.toFixed(2)} EGP
              </span>
            </div>
          </div>

          {/* Escrow Balance */}
          {summary.escrowBalance > 0 && (
            <div className="bg-white rounded-2xl border border-green-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Apply Escrow Balance</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Available: {summary.escrowBalance.toFixed(2)} EGP
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={applyEscrow}
                      onChange={(e) => {
                        setApplyEscrow(e.target.checked);
                        if (e.target.checked) {
                          setEscrowAmount(Math.min(summary.escrowBalance, summary.totalCost));
                        }
                      }}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600" />
                  </label>
                </div>

                {applyEscrow && (
                  <div className="mt-4">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Amount to apply (EGP)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={Math.min(summary.escrowBalance, summary.totalCost)}
                      step="0.01"
                      value={escrowAmount}
                      onChange={(e) => setEscrowAmount(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                      <span>Remaining to pay via payment method:</span>
                      <span className="font-semibold text-gray-900">
                        {Math.max(0, summary.totalCost - escrowToApply).toFixed(2)} EGP
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Payment Method */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Payment Method</h2>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              {PAYMENT_METHODS.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setSelectedMethod(method)}
                  className={`p-4 rounded-xl border-2 text-sm font-medium text-left transition-all ${
                    selectedMethod === method
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-900'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {PAYMENT_METHOD_LABELS[method]}
                </button>
              ))}
            </div>

            {/* Wallet provider sub-selection */}
            {selectedMethod === 'mobile_wallet' && (
              <div className="px-4 pb-4">
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  Select Wallet Provider
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {WALLET_PROVIDERS.map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => setSelectedWallet(provider)}
                      className={`px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                        selectedWallet === provider
                          ? 'border-purple-600 bg-purple-50 text-purple-900'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {WALLET_PROVIDER_LABELS[provider]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Bank transfer info notice */}
            {selectedMethod === 'bank_transfer' && (
              <div className="mx-4 mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                Bank transfer requires manual verification by an admin and may take 1–2 business days.
                You will receive bank details and a reference number after submitting.
              </div>
            )}
          </div>

          {/* Order Total */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{summary.totalCost.toFixed(2)} EGP</span>
              </div>
              {escrowToApply > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>Escrow applied</span>
                  <span>− {escrowToApply.toFixed(2)} EGP</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-100">
                <span>Amount due</span>
                <span>{amountDue.toFixed(2)} EGP</span>
              </div>
            </div>
          </div>

          {submitError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              {submitError}
            </div>
          )}

          <button
            onClick={() => initiateMutation.mutate()}
            disabled={initiateMutation.isPending}
            className="w-full py-3.5 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {initiateMutation.isPending
              ? 'Processing...'
              : `Pay ${amountDue.toFixed(2)} EGP via ${PAYMENT_METHOD_LABELS[selectedMethod]}`}
          </button>

          <button
            onClick={() => router.back()}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
