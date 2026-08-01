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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { invalidateFinancialState } from '~/lib/financial-cache';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  WALLET_PROVIDERS,
  WALLET_PROVIDER_LABELS,
  type PaymentMethod,
  type WalletProvider,
} from '@repo/validations';
import { Button } from '~/components/ui/button';

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
  status?: string;
};

export default function CheckoutClient({ registrationIds }: CheckoutClientProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

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
      const payment = data as PaymentResult;
      setResult(payment);
      setSubmitError('');

      const appliedEscrow = payment.escrowAmountApplied ?? 0;
      const studentId = summary?.student.id;

      if (studentId && appliedEscrow > 0) {
        queryClient.setQueryData<CheckoutSummary>(
          ['payments', 'checkout-summary', summaryKey],
          (current) =>
            current
              ? {
                  ...current,
                  escrowBalance: Math.max(0, current.escrowBalance - appliedEscrow),
                  registrations:
                    payment.status === 'completed' || payment.metadata?.fullyEscrowFunded === true
                      ? current.registrations.map((reg) => ({ ...reg, status: 'confirmed' }))
                      : current.registrations,
                }
              : current,
        );

        queryClient.setQueryData<Array<{ id: string; escrowBalance: number }>>(
          ['escrow', 'children'],
          (children) =>
            children?.map((child) =>
              child.id === studentId
                ? { ...child, escrowBalance: Math.max(0, child.escrowBalance - appliedEscrow) }
                : child,
            ),
        );

        queryClient.setQueryData<{ balance: number }>(
          ['escrow', 'balance', studentId],
          (balance) =>
            balance
              ? { ...balance, balance: Math.max(0, balance.balance - appliedEscrow) }
              : balance,
        );
      }

      invalidateFinancialState(queryClient, {
        studentId,
      });
      router.refresh();
    },
    onError: (err: Error) => {
      setSubmitError(err.message);
    },
  });

  if (isLoading) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isError || !summary) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto">
        <div className="bg-card rounded-xl border border-border shadow-sm p-12 text-center">
          <p className="text-destructive font-medium">Unable to load checkout details.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Verify the registrations belong to a linked child and are ready for payment.
          </p>
          <Button
            variant="outline"
            onClick={() => router.push('/registrations' as never)}
            className="mt-4"
          >
            Back to Registrations
          </Button>
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
    const completed = result.status === 'completed' || meta.fullyEscrowFunded === true;
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
        <div className="max-w-xl mx-auto">
          <div className="bg-card rounded-xl border border-border shadow-sm p-8">
            <div className="flex flex-col items-center gap-3 mb-8">
              <div className="w-14 h-14 bg-brand-50 rounded-full flex items-center justify-center">
                <svg className="w-7 h-7 text-brand-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-foreground font-display">
                {completed ? 'Payment Complete' : 'Payment Initiated'}
              </h1>
              <p className="text-sm text-muted-foreground text-center">
                {completed
                  ? 'Your registrations have been confirmed — no payment was required because escrow covered the full amount.'
                  : 'Your payment is pending. Follow the instructions below to complete it.'}
              </p>
            </div>

            {/* Fully Escrow-Funded */}
            {completed && (
              <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl p-5 text-center">
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300 mb-1">
                  Paid from escrow
                </p>
                <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-200">
                  {result.escrowAmountApplied.toFixed(2)} EGP
                </p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-2">
                  A receipt has been emailed to you. Your subjects are confirmed.
                </p>
              </div>
            )}

            {/* Fawry Code */}
            {!completed && result.paymentMethod === 'fawry' && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-5 text-center">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-2">Fawry Reference Code</p>
                <p className="text-3xl font-bold tracking-widest text-amber-900 dark:text-amber-200 font-mono">
                  {result.externalReference}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-3">
                  Pay this amount at any Fawry outlet within 24 hours.
                  Expires: {meta.fawryExpiresAt
                    ? new Date(meta.fawryExpiresAt as string).toLocaleString()
                    : '24h from now'}
                </p>
              </div>
            )}

            {/* Card Payment URL */}
            {!completed && result.paymentMethod === 'card' && !!meta.paymentUrl && (
              <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 rounded-xl p-5 text-center">
                <p className="text-sm font-medium text-brand-800 dark:text-brand-300 mb-4">Complete your card payment</p>
                <a
                  href={meta.paymentUrl as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block"
                >
                  <Button>Pay Now</Button>
                </a>
                <p className="text-xs text-brand-700 dark:text-brand-400 mt-3">Opens secure payment page in a new tab</p>
              </div>
            )}

            {/* Mobile Wallet */}
            {!completed && result.paymentMethod === 'mobile_wallet' && !!meta.redirectUrl && (
              <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-xl p-5 text-center">
                <p className="text-sm font-medium text-violet-800 dark:text-violet-300 mb-2">Mobile Wallet Payment</p>
                <p className="text-lg font-bold text-violet-900 dark:text-violet-200 font-mono mb-1">
                  Ref: {meta.referenceCode as string}
                </p>
                <a
                  href={meta.redirectUrl as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-3"
                >
                  <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white">Open Wallet</Button>
                </a>
              </div>
            )}

            {/* Bank Transfer Details */}
            {!completed && result.paymentMethod === 'bank_transfer' && !!meta.bankDetails && (() => {
              const bank = meta.bankDetails as {
                bankName: string; accountName: string; accountNumber: string;
                swiftCode: string; branch: string; referenceNumber: string;
              };
              return (
                <div className="bg-muted border border-border rounded-xl p-5">
                  <p className="text-sm font-medium text-foreground mb-4">Bank Transfer Details</p>
                  <dl className="space-y-2 text-sm">
                    {[
                      ['Bank Name', bank.bankName],
                      ['Account Name', bank.accountName],
                      ['Account Number', bank.accountNumber],
                      ['SWIFT Code', bank.swiftCode],
                      ['Branch', bank.branch],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-4">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="font-medium text-foreground font-mono text-right">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 p-3 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 rounded-lg text-center">
                    <p className="text-xs text-brand-700 dark:text-brand-400 mb-1">Payment Reference (required)</p>
                    <p className="text-lg font-bold text-brand-900 dark:text-brand-200 font-mono">{bank.referenceNumber}</p>
                    <p className="text-xs text-brand-700 dark:text-brand-400 mt-1">
                      Include this reference when making the transfer so it can be matched to your account.
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Summary footer */}
            <div className="mt-6 pt-6 border-t border-border flex justify-between text-sm text-muted-foreground">
              <span>Amount due</span>
              <span className="font-semibold text-foreground">
                {amountDue.toFixed(2)} EGP
                {escrowToApply > 0 && (
                  <span className="text-xs font-normal text-emerald-600 dark:text-emerald-400 ml-1">
                    (+ {escrowToApply.toFixed(2)} escrow)
                  </span>
                )}
              </span>
            </div>

            <Button
              variant="ghost"
              onClick={() => router.push('/registrations' as never)}
              className="mt-6 w-full"
            >
              Back to Registrations
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Checkout Form ────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Checkout</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Complete payment for {summary.student.name}&apos;s subject registration
          </p>
        </div>

        <div className="space-y-6">
          {/* Registration Summary */}
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground font-display">Registration Summary</h2>
            </div>
            <div className="divide-y divide-border">
              {summary.registrations.map((reg) => (
                <div key={reg.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {reg.subject.name}
                      <span className="ml-2 text-xs text-muted-foreground font-mono">{reg.subject.code}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{reg.session.name}</p>
                  </div>
                  <span className="text-sm font-semibold text-foreground shrink-0 ml-4">
                    {reg.priceAtRegistration.toFixed(2)} EGP
                  </span>
                </div>
              ))}
            </div>
            <div className="px-6 py-3 bg-muted flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Total</span>
              <span className="text-base font-bold text-foreground">
                {summary.totalCost.toFixed(2)} EGP
              </span>
            </div>
          </div>

          {/* Escrow Balance */}
          {summary.escrowBalance > 0 && (
            <div className="bg-card rounded-xl border border-emerald-200 dark:border-emerald-700 shadow-sm overflow-hidden">
              <div className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground font-display">Apply Escrow Balance</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
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
                    <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600" />
                  </label>
                </div>

                {applyEscrow && (
                  <div className="mt-4">
                    <label className="block text-xs font-medium text-foreground mb-1">
                      Amount to apply (EGP)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={Math.min(summary.escrowBalance, summary.totalCost)}
                      step="0.01"
                      value={escrowAmount}
                      onChange={(e) => setEscrowAmount(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Remaining to pay via payment method:</span>
                      <span className="font-semibold text-foreground">
                        {Math.max(0, summary.totalCost - escrowToApply).toFixed(2)} EGP
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Payment Method */}
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground font-display">Payment Method</h2>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              {PAYMENT_METHODS.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setSelectedMethod(method)}
                  className={`p-4 rounded-xl border-2 text-sm font-medium text-left transition-all ${
                    selectedMethod === method
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border text-muted-foreground hover:border-primary/40'
                  }`}
                >
                  {PAYMENT_METHOD_LABELS[method]}
                </button>
              ))}
            </div>

            {/* Wallet provider sub-selection */}
            {selectedMethod === 'mobile_wallet' && (
              <div className="px-4 pb-4">
                <label className="block text-xs font-medium text-foreground mb-2">
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
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border text-muted-foreground hover:border-primary/40'
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
              <div className="mx-4 mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg text-xs text-amber-700 dark:text-amber-400">
                Bank transfer requires manual verification by an admin and may take 1-2 business days.
                You will receive bank details and a reference number after submitting.
              </div>
            )}
          </div>

          {/* Order Total */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-5">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{summary.totalCost.toFixed(2)} EGP</span>
              </div>
              {escrowToApply > 0 && (
                <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                  <span>Escrow applied</span>
                  <span>- {escrowToApply.toFixed(2)} EGP</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-foreground pt-2 border-t border-border">
                <span>Amount due</span>
                <span>{amountDue.toFixed(2)} EGP</span>
              </div>
            </div>
          </div>

          {submitError && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive">
              {submitError}
            </div>
          )}

          <Button
            onClick={() => initiateMutation.mutate()}
            disabled={initiateMutation.isPending}
            className="w-full"
            size="lg"
          >
            {initiateMutation.isPending
              ? 'Processing...'
              : amountDue === 0 && escrowToApply > 0
                ? `Confirm ${escrowToApply.toFixed(2)} EGP from escrow`
                : `Pay ${amountDue.toFixed(2)} EGP via ${PAYMENT_METHOD_LABELS[selectedMethod]}`}
          </Button>

          <Button
            variant="ghost"
            onClick={() => router.back()}
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
