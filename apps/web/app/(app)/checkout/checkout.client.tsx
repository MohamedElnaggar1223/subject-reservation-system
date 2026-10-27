'use client';

/**
 * Checkout — parents (COORDINATOR_REWORK.md §5 "Families", §10; P3).
 *
 * One checkout over the subjects chosen, whatever their dates (no split per deadline): each subject with its words
 * (the family read's option wording), its price and its last day to pay; the checkout is paid by the earliest of
 * those. Pay at the school (a reference to quote at the desk, where cash, card or InstaPay is taken) or InstaPay
 * (the school's account, then the transfer's reference, checked by the finance office); the balance (escrow)
 * applied first if the family wants. A subject whose prices are not final yet is not paid here: it is said, and the
 * others can be paid. A refusal comes back with a code: its sentence is shown at the subject it concerns, with the
 * next step (take it off this payment, or read the new price).
 */

import { useState } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '~/lib/hono';
import type { InferRequestType } from 'hono/client';
import { apiResponse, formatEgp, refusalCodeOf, type RefusalCode } from '@repo/validations';
import { invalidateFinancialState } from '~/lib/financial-cache';
import {
  ACTIVE_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  DECLARATION_TEXT,
  refundConsentText,
  type ActivePaymentMethod,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/tone';
import { useI18n } from '~/lib/i18n';
import { familyWords } from '~/lib/i18n-reservations';
import { Money, Day } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import { InstantText } from '~/app/(app)/exams/exams-shared';
import { fetchReserveOffers, reserveOffersKey, optionOfLine, lineNamedBy } from '~/components/reservations/offers';
import { fetchStatement, statementKey } from '~/components/reservations/statement';

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
  // A refusal with a code, at the subject it concerns (null: the whole payment).
  const [refusal, setRefusal] = useState<{ sentence: string; code: RefusalCode | undefined; registrationId: string | null } | null>(null);
  const { language } = useI18n();

  const summaryKey = registrationIds.join(',');

  const { data: summary, isLoading, isError } = useQuery({
    queryKey: ['payments', 'checkout-summary', summaryKey],
    queryFn: () => fetchCheckoutSummary(summaryKey),
  });
  // Each subject's words, as the reservation page wrote them ("Retake · self study 50% · all papers").
  const sessionIds = [...new Set((summary?.registrations ?? []).map((r) => r.sessionId))];
  const reads = useQueries({
    queries: sessionIds.map((sessionId) => ({
      queryKey: reserveOffersKey(sessionId, summary?.student.id ?? ''),
      queryFn: () => fetchReserveOffers(sessionId, summary!.student.id),
      enabled: !!summary,
      retry: false,
    })),
  });
  const wordsOf = (r: { sessionId: string; offerItemId: string; attempt: string; mode: string }) =>
    optionOfLine(reads[sessionIds.indexOf(r.sessionId)]?.data, r)?.option?.label[language] ?? null;
  // The statement: until when a transfer being checked keeps its subjects (the earliest exam board date among them),
  // and each line's name as a refusal gives it ("Mathematics — Paper 1").
  const statementQuery = { studentId: summary?.student.id };
  const statement = useQuery({
    queryKey: statementKey(statementQuery),
    queryFn: () => fetchStatement(statementQuery),
    enabled: !!summary,
  });
  const keptUntil = (paymentId: string) =>
    statement.data?.students.flatMap((s) => s.payments).find((p) => p.id === paymentId)?.deadline ?? null;
  const refusalName = new Map(statement.data?.students.flatMap((s) => s.sessions.flatMap((x) => x.lines.map((l) => [l.id, l.label] as const))) ?? []);

  // Paid now: a line whose price is final and whose last day to pay has not passed (the sweep expires it within the
  // minute; until then it is shown apart, never sent to be refused).
  const [openedAt] = useState(() => Date.now());
  const pastLastDay = (id: string) => {
    const c = summary?.lineCutOffs.find((x) => x.registrationId === id)?.cutOff;
    return !!c && new Date(c).getTime() <= openedAt;
  };
  // Only a line still waiting for payment and not under an instalment plan (paid by its instalments): one the desk
  // collected while this page was open, or one under a plan, is shown apart, never sent to be refused.
  const waitingHere = (r: { id: string; status: string }) => r.status === 'pending_payment' && !(summary?.linesUnderPlan ?? []).includes(r.id);
  const payableIds = (summary?.registrations ?? []).filter((r) => waitingHere(r) && !r.priceProvisional && !pastLastDay(r.id)).map((r) => r.id);
  const initiateMutation = useMutation({
    mutationFn: async () => {
      const payableCost = (summary?.registrations ?? []).filter((r) => payableIds.includes(r.id)).reduce((a, r) => a + r.priceAtRegistration, 0);
      const escrowToApply = applyEscrow ? Math.min(escrowAmount, summary?.escrowBalance ?? 0, payableCost) : 0;

      return initiatePayment({
        registrationIds: payableIds,
        // The prices this page shows: a re-price landing since it was read is refused (PRICE_CHANGED), not charged.
        expectedPrices: (summary?.registrations ?? []).filter((r) => payableIds.includes(r.id)).map((r) => ({ registrationId: r.id, price: r.priceAtRegistration })),
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
      const code = refusalCodeOf(err);
      const sentence = familyWords(err.message);
      // The subject the sentence names (lineNamedBy: the longest name, never a guess between two alike).
      const named = lineNamedBy(sentence, summary?.registrations ?? [], (r) => refusalName.get(r.id) ?? r.subject.name);
      setRefusal({ sentence, code, registrationId: named?.id ?? null });
      // Paid or changed meanwhile (the desk, another tab), or under a plan: the re-read shows those apart, and the
      // others can be paid; the API's sentence names no subject.
      setSubmitError(named ? '' : code === 'NOT_WAITING' || code === 'UNDER_PLAN'
        ? 'Some of these subjects were paid or changed meanwhile: they are now shown apart. Pay for the others.'
        : sentence);
      if (code === 'PRICE_CHANGED' || code === 'NOT_WAITING' || code === 'UNDER_PLAN' || code === 'PRICES_NOT_FINAL' || code === 'CUT_OFF_PASSED' || code === 'BOARD_DEADLINE_PASSED') {
        queryClient.invalidateQueries({ queryKey: ['payments', 'checkout-summary', summaryKey] });
      }
    },
  });

  /** Take a subject off this payment: the checkout reopens on the others. */
  const takeOff = (id: string) => {
    const rest = registrationIds.filter((x) => x !== id);
    setRefusal(null);
    setSubmitError('');
    router.replace((rest.length ? `/checkout?ids=${rest.join(',')}` : '/registrations') as never);
  };

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
    onError: (err: Error) => setRefError(familyWords(err.message)),
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
        Only if you have not paid. What your balance paid toward it goes back to the balance.
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


  // A subject whose prices are not final yet is reserved, not paid (E6): said, and left out of this payment; so is one
  // past its last day to pay.
  const apart = summary.registrations.filter((r) => !waitingHere(r));
  const notFinal = summary.registrations.filter((r) => waitingHere(r) && r.priceProvisional);
  const past = summary.registrations.filter((r) => waitingHere(r) && !r.priceProvisional && pastLastDay(r.id));
  const payable = summary.registrations.filter((r) => payableIds.includes(r.id));
  const payableTotal = Math.round(payable.reduce((a, r) => a + r.priceAtRegistration, 0) * 100) / 100;
  const escrowToApply = applyEscrow
    ? Math.min(escrowAmount, summary.escrowBalance, payableTotal)
    : 0;
  const amountDue = Math.max(0, payableTotal - escrowToApply);
  const cutOffOf = (id: string) => summary.lineCutOffs.find((c) => c.registrationId === id)?.cutOff ?? null;
  const cutOffs = new Set(payable.map((r) => cutOffOf(r.id)).filter(Boolean).map(String));
  // Paid by the earliest last day to pay of the subjects in this payment (the API's endsAt counts a line past its own).
  const payBy = [...cutOffs].sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? (past.length ? null : summary.endsAt);

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
                  ? 'Your registrations have been confirmed — no payment was required because your balance covered the full amount.'
                  : 'Your payment is pending. Follow the instructions below to complete it.'}
              </p>
            </div>

            {/* Fully Escrow-Funded */}
            {completed && (
              <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl p-5 text-center">
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300 mb-1">
                  Paid from your balance
                </p>
                <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-200">
                  <Money amount={(result.escrowAmountApplied ?? 0)} />
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
                      ['Exact Amount', formatEgp(instapay?.amountDue ?? result.amount ?? 0)],
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
              {/* The server's amounts: the summary's balance was already lowered by this payment (onSuccess). */}
              <span className="font-semibold text-foreground">
                <Money amount={completed ? 0 : result.amount ?? 0} />
                {(result.escrowAmountApplied ?? 0) > 0 && (
                  <span className="text-xs font-normal text-emerald-600 dark:text-emerald-400 ml-1">
                    (+ <Money amount={result.escrowAmountApplied ?? 0} /> <span>from your balance</span>)
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
            <span>A payment of</span> <Money amount={open.amount + open.escrowAmountApplied} /> (<span>{methodLabel}</span>) <span>was started for</span>{' '}
            <bdi>{summary.student.name}</bdi> <span>on</span> <Day iso={String(open.createdAt)} />. <span>It covers:</span>
          </p>
          <ul className="mt-2 text-sm text-foreground list-disc ps-5">
            {open.paymentRegistrations.map((pr) => (
              <li key={pr.registrationId}>
                <bdi data-i18n-skip="true">{pr.registration.subject.name}</bdi>
              </li>
            ))}
          </ul>

          {/* C10: the last day to pay has passed while this InstaPay checkout waited for its reference: it has until then. */}
          {open.status === 'pending' && open.referenceDueAt && (
            <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-300">
              <span>The last day to pay has passed. Submit your transfer reference by</span>{' '}
              <strong><InstantText iso={String(open.referenceDueAt)} /></strong><span>: after that the payment is cancelled and the subjects are released.</span>
            </div>
          )}

          {open.status === 'pending_verification' ? (
            <div className="mt-5 p-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-xl text-sm text-violet-800 dark:text-violet-300">
              <p>
                <span>Your transfer is being checked by the finance office: reference</span>{' '}
                <span className="font-mono font-semibold" data-i18n-skip="true">{open.verificationReference}</span><span>.</span>{' '}
                <span>They confirm it against the bank statement, usually within one school day.</span>
              </p>
              {keptUntil(open.id) && (
                <p className="mt-1"><span>Your subjects are kept for it until</span> <Day iso={String(keptUntil(open.id))} /><span>.</span></p>
              )}
            </div>
          ) : open.paymentMethod === 'in_school' ? (
            <div className="mt-5 p-4 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 rounded-xl text-center">
              <p className="text-sm text-brand-800 dark:text-brand-300">Quote this reference at the finance desk</p>
              <p className="mt-1 text-2xl font-bold tracking-widest text-brand-900 dark:text-brand-200 font-mono">{open.externalReference}</p>
            </div>
          ) : (
            <div className="mt-5 p-4 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-xl">
              <p className="text-sm text-violet-800 dark:text-violet-300">
                <span>Transfer</span> <Money amount={openMeta.instapay?.amountDue ?? open.amount} /> <span>by InstaPay, then submit the reference.</span>
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
    <div className="px-4 py-6 sm:px-6 sm:py-8 max-w-5xl mx-auto animate-fade-up">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Checkout</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span>The subjects reserved for</span> <bdi data-i18n-skip="true">{summary.student.name}</bdi>
          </p>
        </div>

        <div className="space-y-6">
          {/* One checkout, whatever the subjects' dates: each with its words, its price and its last day to pay. */}
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground font-display">What you are paying for</h2>
            </div>
            <ul className="divide-y divide-border">
              {summary.registrations.map((reg) => {
                const cut = cutOffOf(reg.id);
                const here = refusal?.registrationId === reg.id ? refusal : null;
                const words = wordsOf(reg);
                return (
                  <li key={reg.id} className={`px-4 sm:px-6 py-3 ${here ? 'bg-destructive/5' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground"><bdi data-i18n-skip="true">{reg.subject.name}</bdi></p>
                        {words && <p className="text-xs text-muted-foreground" data-i18n-skip="true">{words}</p>}
                        <p className="text-xs text-muted-foreground">
                          <bdi data-i18n-skip="true">{reg.session.name}</bdi>
                          {!waitingHere(reg)
                            ? <> · <span>{reg.status === 'confirmed' ? 'already paid' : (summary.linesUnderPlan ?? []).includes(reg.id) ? 'paid by its instalments' : 'no longer waiting for payment'}</span></>
                            : reg.priceProvisional
                            ? <> · <span>prices not final yet: paid once the school confirms them</span></>
                            : pastLastDay(reg.id) ? <> · <span>its last day to pay has passed</span> (<Day iso={String(cut)} />)</>
                              : cut && <> · <span>last day to pay</span> <Day iso={String(cut)} /></>}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-foreground shrink-0">
                        <Money amount={reg.priceAtRegistration} />
                        {reg.priceProvisional && <span className="block text-end"><Badge tone="warning">not final yet</Badge></span>}
                      </span>
                    </div>
                    {here && (
                      <div role="alert" className="mt-2 text-sm text-destructive">
                        <p>{here.sentence}</p>
                        {here.code === 'PRICE_CHANGED'
                          ? <p className="mt-1">The price shown is now up to date: pay again.</p>
                          : summary.registrations.length > 1 && (
                            <button type="button" className="mt-1 font-medium underline underline-offset-4" onClick={() => takeOff(reg.id)}>Take it off this payment</button>
                          )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="px-4 sm:px-6 py-3 bg-muted flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">Total to pay now</span>
              <span className="text-base font-bold text-foreground">
                <Money amount={payableTotal} />
              </span>
            </div>
            {payBy && payable.length > 0 && (
              <p className="px-4 sm:px-6 py-2 text-xs text-muted-foreground border-t border-border">
                <span>Last day to pay</span> <Day iso={String(payBy)} />
                {cutOffs.size > 1 && <> <span>(the earliest of these subjects)</span></>}
              </p>
            )}
          </div>

          {apart.length > 0 && (
            <div className="rounded-xl border border-border bg-muted p-4 text-sm text-foreground">
              <p>
                <bdi data-i18n-skip="true">{apart.map((r) => r.subject.name).join(', ')}</bdi><span>:</span>{' '}
                <span>not in this payment (already paid, paid by instalments, or no longer waiting).</span>
              </p>
              {payable.length > 0 && <p className="mt-1 text-muted-foreground">This payment is for the others.</p>}
            </div>
          )}

          {past.length > 0 && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              <p>
                <bdi data-i18n-skip="true">{past.map((r) => r.subject.name).join(', ')}</bdi><span>:</span>{' '}
                <span>the last day to pay has passed, so it can no longer be paid. Reserve it again while it is offered.</span>
              </p>
              {payable.length > 0 && <p className="mt-1">This payment is for the others.</p>}
            </div>
          )}

          {notFinal.length > 0 && (
            <div className="rounded-xl border border-border bg-muted p-4 text-sm text-foreground">
              <p>
                <span>Prices are not final yet for</span> <bdi data-i18n-skip="true">{notFinal.map((r) => r.subject.name).join(', ')}</bdi><span>:</span>{' '}
                <span>they stay reserved, and you can pay them once the school confirms them.</span>
              </p>
              {payable.length > 0 && <p className="mt-1 text-muted-foreground">This payment is for the others.</p>}
            </div>
          )}

          {/* Escrow Balance */}
          {summary.escrowBalance > 0 && payable.length > 0 && (
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
              <div className="px-4 sm:px-6 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 id="checkout-balance" className="text-sm font-semibold text-foreground font-display">Use your balance</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span>Available:</span> <Money amount={summary.escrowBalance} />
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      aria-labelledby="checkout-balance"
                      checked={applyEscrow}
                      onChange={(e) => {
                        setApplyEscrow(e.target.checked);
                        if (e.target.checked) {
                          setEscrowAmount(Math.min(summary.escrowBalance, payableTotal));
                        }
                      }}
                    />
                    <div className="w-11 h-6 bg-muted peer-focus-visible:ring-2 peer-focus-visible:ring-ring rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600" />
                  </label>
                </div>

                {applyEscrow && (
                  <div className="mt-4">
                    <label htmlFor="checkout-escrow" className="block text-xs font-medium text-foreground mb-1">
                      Amount to apply (EGP)
                    </label>
                    <input
                      id="checkout-escrow"
                      type="number"
                      min="0"
                      max={Math.min(summary.escrowBalance, payableTotal)}
                      step="0.01"
                      inputMode="decimal"
                      value={escrowAmount}
                      onChange={(e) => setEscrowAmount(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>Remaining to pay via payment method:</span>
                      <span className="font-semibold text-foreground">
                        <Money amount={Math.max(0, payableTotal - escrowToApply)} />
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Payment Method */}
          {payable.length > 0 && (
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground font-display">Payment Method</h2>
            </div>
            <div className="p-4 grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label="Payment Method">
              {ACTIVE_PAYMENT_METHODS.map((method) => (
                <button
                  key={method}
                  type="button"
                  aria-pressed={selectedMethod === method}
                  onClick={() => setSelectedMethod(method)}
                  className={`min-h-11 p-4 rounded-xl border-2 text-sm font-medium text-start transition-all ${
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
          )}

          {/* Order Total */}
          {payable.length > 0 && (
          <div className="bg-card rounded-xl border border-border shadow-sm p-5">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span><Money amount={payableTotal} /></span>
              </div>
              {escrowToApply > 0 && (
                <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                  <span>From your balance</span>
                  <span>- <Money amount={escrowToApply} /></span>
                </div>
              )}
              <div className="flex justify-between font-bold text-foreground pt-2 border-t border-border">
                <span>Amount due</span>
                <span><Money amount={amountDue} /></span>
              </div>
            </div>
          </div>
          )}

          {summary.familyConsentNeeded.length > 0 && payable.length > 0 && (
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
            <div role="alert" className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive">
              {submitError}
              {refusal?.code === 'PRICE_CHANGED' && !refusal.registrationId && <p className="mt-1">The price shown is now up to date: pay again.</p>}
            </div>
          )}

          {payable.length > 0 && (
            <Button
              onClick={() => { setRefusal(null); setSubmitError(''); initiateMutation.mutate(); }}
              disabled={initiateMutation.isPending || (summary.familyConsentNeeded.length > 0 && !(refundTick && declTick))}
              className="w-full"
              size="lg"
            >
              {initiateMutation.isPending
                ? 'Processing...'
                : amountDue === 0 && escrowToApply > 0
                  ? <><span>Confirm</span> <Money amount={escrowToApply} /> <span>from your balance</span></>
                  // "Pay EGP 14,350 at the school desk" (F6: was "Pay 14350.00 EGP via Pay at School").
                  : <><span>Pay</span> <Money amount={amountDue} /> <span>{selectedMethod === 'instapay' ? 'by InstaPay' : 'at the school desk'}</span></>}
            </Button>
          )}

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
