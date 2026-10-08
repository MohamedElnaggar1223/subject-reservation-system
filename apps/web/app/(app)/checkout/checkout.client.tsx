'use client';

/**
 * Checkout Client Component — Parents Only
 *
 * Interactive payment flow for pending_payment registrations.
 *
 * Features (V3 — §6.6/§6.11):
 * - Displays registration summary (subjects, session, prices)
 * - Escrow balance display with apply-to-checkout option
 * - Payment method selection: Pay at School or InstaPay
 * - Real-time total calculation (total − escrow applied)
 * - Submission → POST /v1/payments/initiate
 * - Pay at School: shows the desk reference to quote at the finance desk
 * - InstaPay: shows the school account details + a transfer-reference
 *   submission form; finance verifies against the bank statement
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '~/lib/hono';
import type { InferRequestType } from 'hono/client';
import { apiResponse } from '@repo/validations';
import { invalidateFinancialState } from '~/lib/financial-cache';
import {
  ACTIVE_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  DECLARATION_TEXT,
  refundConsentText,
  type ActivePaymentMethod,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { InstantText } from '../exams/exams-shared';

interface CheckoutClientProps {
  registrationIds: string[];
}

// Typed by the API, never by hand (PATTERNS.md): both shapes are extracted
// from the RPC fetchers. The hand-written versions this replaces had drifted
// (grade typed as a string while the column is an integer).
const fetchCheckoutSummary = (registrationIds: string) =>
  apiResponse(api.v1.payments['checkout-summary'].$get({ query: { registrationIds } }));
type CheckoutSummary = Awaited<ReturnType<typeof fetchCheckoutSummary>>;

const initiatePayment = (json: InferRequestType<typeof api.v1.payments.initiate.$post>['json']) =>
  apiResponse(api.v1.payments.initiate.$post({ json }));
type PaymentResult = Awaited<ReturnType<typeof initiatePayment>>;

export default function CheckoutClient({ registrationIds }: CheckoutClientProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [selectedMethod, setSelectedMethod] = useState<ActivePaymentMethod>('in_school');
  const [applyEscrow, setApplyEscrow] = useState(false);
  const [escrowAmount, setEscrowAmount] = useState(0);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [instapayRef, setInstapayRef] = useState('');
  const [refSubmitted, setRefSubmitted] = useState(false);
  const [refError, setRefError] = useState('');
  // A subject the school reserved for the family (grade 10) carries the school's consent only: the
  // family gives its own here (RESERVATIONS_REWORK.md §3.5).
  const [refundTick, setRefundTick] = useState(false);
  const [declTick, setDeclTick] = useState(false);

  const summaryKey = registrationIds.join(',');

  const { data: summary, isLoading, isError } = useQuery({
    queryKey: ['payments', 'checkout-summary', summaryKey],
    queryFn: () => fetchCheckoutSummary(summaryKey),
  });

  const initiateMutation = useMutation({
    mutationFn: async () => {
      const escrowToApply = applyEscrow ? Math.min(escrowAmount, summary?.escrowBalance ?? 0, summary?.totalCost ?? 0) : 0;

      return initiatePayment({
        registrationIds,
        paymentMethod: selectedMethod,
        escrowAmountToApply: escrowToApply,
        ...(summary?.familyConsentNeeded.length ? { consent: { refundPolicy: true as const, declaration: true as const } } : {}),
      });
    },
    onSuccess: (payment) => {
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

  const submitRefMutation = useMutation({
    mutationFn: ({ paymentId, reference }: { paymentId: string; reference: string }) =>
      apiResponse(
        api.v1.payments[':id']['instapay-reference'].$post({
          param: { id: paymentId },
          json: { reference },
        })
      ),
    onSuccess: () => {
      setRefSubmitted(true);
      setRefError('');
      invalidateFinancialState(queryClient, { studentId: summary?.student.id });
      router.refresh();
    },
    onError: (err: Error) => setRefError(err.message),
  });

  // Money audit MA-02: an unpaid checkout can be cancelled — escrow applied
  // to it comes back and the subjects can be paid another way.
  const [cancelError, setCancelError] = useState('');
  const cancelMutation = useMutation({
    mutationFn: (paymentId: string) => apiResponse(api.v1.payments[':id'].cancel.$post({ param: { id: paymentId } })),
    onSuccess: () => {
      setResult(null);
      setRefSubmitted(false);
      setInstapayRef('');
      setCancelError('');
      queryClient.invalidateQueries({ queryKey: ['payments', 'checkout-summary', summaryKey] });
      invalidateFinancialState(queryClient, { studentId: summary?.student.id });
      router.refresh();
    },
    onError: (err: Error) => setCancelError(err.message),
  });

  const cancelButton = (paymentId: string) => (
    <>
      <Button
        variant="outline"
        className="mt-3 w-full"
        disabled={cancelMutation.isPending}
        onClick={() => cancelMutation.mutate(paymentId)}
      >
        {cancelMutation.isPending ? 'Cancelling…' : 'Cancel this checkout'}
      </Button>
      <p className="mt-1 text-xs text-muted-foreground text-center">
        Only if you have not paid. Escrow applied to it goes back to the balance.
      </p>
      {cancelError && <p className="mt-2 text-xs text-destructive text-center">{cancelError}</p>}
    </>
  );

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

  // F0b: subjects in exam board series with different entry deadlines are
  // paid for separately — one checkout per series (the school closes a
  // checkout at its series' deadline). The family chooses one to pay now.
  if (!result && !summary.openPayment && summary.deadlineGroups.length > 1) {
    return (
      <div className="px-6 py-8 max-w-3xl mx-auto animate-fade-up">
        <h1 className="text-2xl font-bold font-display text-foreground">Pay by exam series</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          These subjects are entered in exam board series with different entry deadlines, so each series is paid for on its own. Pay for one now; the others stay waiting for payment until their own deadline.
        </p>
        <ul className="mt-6 space-y-3">
          {summary.deadlineGroups.map((g) => (
            <li key={g.registrationIds.join(',')} className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">
                    {g.series.length ? g.series.map((x) => <bdi key={x.id} className="me-2">{x.name}</bdi>) : <span>No board series</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {g.entryDeadline ? <><span>Entry deadline</span> <InstantText iso={String(g.entryDeadline)} /></> : <span>No entry deadline yet</span>}
                  </p>
                  <p className="mt-2 text-sm text-foreground">
                    {g.subjects.map((name, i) => <span key={`${name}-${i}`}>{i > 0 && ', '}<bdi data-i18n-skip="true">{name}</bdi></span>)}
                  </p>
                </div>
                <div className="text-end">
                  <p className="text-lg font-bold text-foreground tabular-nums" dir="ltr">{g.total.toFixed(2)} EGP</p>
                  <Button className="mt-2" onClick={() => router.push(`/checkout?ids=${g.registrationIds.join(',')}` as never)}>
                    Pay for this series
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
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
                  {(result.escrowAmountApplied ?? 0).toFixed(2)} EGP
                </p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-2">
                  A receipt has been emailed to you. Your subjects are confirmed.
                </p>
              </div>
            )}

            {/* Pay at School */}
            {!completed && result.paymentMethod === 'in_school' && (
              <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 rounded-xl p-5 text-center">
                <p className="text-sm font-medium text-brand-800 dark:text-brand-300 mb-2">Pay at the School Finance Desk</p>
                <p className="text-3xl font-bold tracking-widest text-brand-900 dark:text-brand-200 font-mono">
                  {result.externalReference}
                </p>
                <p className="text-xs text-brand-700 dark:text-brand-400 mt-3">
                  Quote this reference (or the student&apos;s name) at the desk. Your registrations
                  are confirmed as soon as the finance officer records your payment.
                </p>
              </div>
            )}

            {/* InstaPay */}
            {!completed && result.paymentMethod === 'instapay' && (() => {
              const instapay = meta.instapay as {
                account: { bankName: string; accountName: string; accountNumber: string; iban: string | null };
                amountDue: number;
              } | undefined;
              return (
                <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-xl p-5">
                  <p className="text-sm font-medium text-violet-800 dark:text-violet-300 mb-3">
                    1 — Transfer via InstaPay to the school account
                  </p>
                  <dl className="space-y-2 text-sm">
                    {[
                      ['Bank', instapay?.account.bankName],
                      ['Account Name', instapay?.account.accountName],
                      ['Account Number', instapay?.account.accountNumber],
                      ...(instapay?.account.iban ? [['IBAN', instapay.account.iban]] : []),
                      ['Exact Amount', `${(instapay?.amountDue ?? result.amount ?? 0).toFixed(2)} EGP`],
                    ].map(([label, value]) => (
                      <div key={label as string} className="flex justify-between gap-4">
                        <dt className="text-violet-700 dark:text-violet-400">{label}</dt>
                        <dd className="font-medium text-violet-900 dark:text-violet-200 font-mono text-right">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <p className="text-sm font-medium text-violet-800 dark:text-violet-300 mt-5 mb-2">
                    2 — Submit your transaction reference
                  </p>
                  {refSubmitted ? (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-lg text-center text-sm text-emerald-700 dark:text-emerald-400">
                      Reference submitted. The finance team will verify your transfer against the
                      bank statement and confirm your registrations — usually within one school day.
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={instapayRef}
                        onChange={(e) => setInstapayRef(e.target.value)}
                        placeholder="Transaction reference from your InstaPay receipt"
                        className="w-full px-3 py-2 text-sm border border-violet-300 dark:border-violet-700 bg-background rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
                      />
                      {refError && <p className="mt-2 text-xs text-destructive">{refError}</p>}
                      <Button
                        size="sm"
                        className="mt-3 w-full bg-violet-600 hover:bg-violet-700 text-white"
                        disabled={submitRefMutation.isPending || instapayRef.trim().length < 4 || !result.id}
                        onClick={() =>
                          submitRefMutation.mutate({ paymentId: result.id ?? '', reference: instapayRef.trim() })
                        }
                      >
                        {submitRefMutation.isPending ? 'Submitting…' : 'Submit Reference'}
                      </Button>
                      <p className="text-xs text-violet-700 dark:text-violet-400 mt-2">
                        You can find the reference in your InstaPay app under the transfer&apos;s details.
                      </p>
                    </>
                  )}
                </div>
              );
            })()}

            {!completed && result.status === 'pending' && !refSubmitted && result.id && cancelButton(result.id)}

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

  // ─── A checkout already started on these subjects (MA-02) ───────────────

  const open = summary.openPayment;
  if (open) {
    const openMeta = (open.metadata ?? {}) as { instapay?: { amountDue?: number } };
    const methodLabel = PAYMENT_METHOD_LABELS[open.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] ?? open.paymentMethod;
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
        <div className="max-w-xl mx-auto bg-card rounded-xl border border-border shadow-sm p-8">
          <h1 className="text-xl font-bold text-foreground font-display">Payment already started</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A payment of {(open.amount + open.escrowAmountApplied).toFixed(2)} EGP ({methodLabel}) was started for{' '}
            {summary.student.name} on {new Date(open.createdAt).toLocaleDateString()}. It covers:
          </p>
          <ul className="mt-2 text-sm text-foreground list-disc ps-5">
            {open.paymentRegistrations.map((pr) => (
              <li key={pr.registrationId}>
                {pr.registration.subject.name} ({pr.registration.subject.code})
              </li>
            ))}
          </ul>

          {/* MO-10: the window closed while this checkout waited for its reference */}
          {open.status === 'pending' && open.referenceDueAt && (
            <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-300">
              The registration window has closed. Submit your transfer reference by{' '}
              <strong>{new Date(open.referenceDueAt).toLocaleString()}</strong>; after that the payment is cancelled and the subjects are released.
            </div>
          )}

          {open.status === 'pending_verification' ? (
            <div className="mt-5 p-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-xl text-sm text-violet-800 dark:text-violet-300">
              Your transfer reference <span className="font-mono font-semibold">{open.verificationReference}</span> is with
              the finance office. They confirm it against the bank statement, usually within one school day.
            </div>
          ) : open.paymentMethod === 'in_school' ? (
            <div className="mt-5 p-4 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 rounded-xl text-center">
              <p className="text-sm text-brand-800 dark:text-brand-300">Quote this reference at the finance desk</p>
              <p className="mt-1 text-2xl font-bold tracking-widest text-brand-900 dark:text-brand-200 font-mono">{open.externalReference}</p>
            </div>
          ) : (
            <div className="mt-5 p-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-xl">
              <p className="text-sm text-violet-800 dark:text-violet-300">
                Transfer {(openMeta.instapay?.amountDue ?? open.amount).toFixed(2)} EGP by InstaPay, then submit the reference.
              </p>
              {refSubmitted ? (
                <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">Reference submitted. The finance team will verify it.</p>
              ) : (
                <>
                  <input
                    type="text"
                    value={instapayRef}
                    onChange={(e) => setInstapayRef(e.target.value)}
                    placeholder="Transaction reference from your InstaPay receipt"
                    className="mt-3 w-full px-3 py-2 text-sm border border-violet-300 dark:border-violet-700 bg-background rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
                  />
                  {refError && <p className="mt-2 text-xs text-destructive">{refError}</p>}
                  <Button
                    size="sm"
                    className="mt-3 w-full bg-violet-600 hover:bg-violet-700 text-white"
                    disabled={submitRefMutation.isPending || instapayRef.trim().length < 4}
                    onClick={() => submitRefMutation.mutate({ paymentId: open.id, reference: instapayRef.trim() })}
                  >
                    {submitRefMutation.isPending ? 'Submitting…' : 'Submit Reference'}
                  </Button>
                </>
              )}
            </div>
          )}

          {open.status === 'pending' && !refSubmitted && cancelButton(open.id)}

          <Button variant="ghost" onClick={() => router.push('/registrations' as never)} className="mt-6 w-full">
            Back to Registrations
          </Button>
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
              {ACTIVE_PAYMENT_METHODS.map((method) => (
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

            {/* Method-specific notices */}
            {selectedMethod === 'in_school' && (
              <div className="mx-4 mb-4 p-3 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 rounded-lg text-xs text-brand-700 dark:text-brand-400">
                You&apos;ll get a payment reference to quote at the school finance desk. Pay by
                cash, card, or InstaPay at the desk — registrations confirm on the spot.
              </div>
            )}
            {selectedMethod === 'instapay' && (
              <div className="mx-4 mb-4 p-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-lg text-xs text-violet-700 dark:text-violet-400">
                You&apos;ll get the school&apos;s account details to transfer the exact amount via
                InstaPay, then submit your transaction reference. The finance team verifies the
                transfer before your registrations are confirmed.
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

          {summary.familyConsentNeeded.length > 0 && (
            <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-2 text-sm">
              <p className="font-semibold text-foreground">The school reserved these subjects for you: confirm before paying</p>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={refundTick} onChange={(e) => setRefundTick(e.target.checked)} />
                <span>{summary.familyConsentTerms.map((t) => refundConsentText(t.terms)).join(' ')}</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={declTick} onChange={(e) => setDeclTick(e.target.checked)} />
                <span>{DECLARATION_TEXT}</span>
              </label>
            </div>
          )}

          {submitError && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive">
              {submitError}
            </div>
          )}

          <Button
            onClick={() => initiateMutation.mutate()}
            disabled={initiateMutation.isPending || (summary.familyConsentNeeded.length > 0 && !(refundTick && declTick))}
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
