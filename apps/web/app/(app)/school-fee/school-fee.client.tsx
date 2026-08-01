'use client';

/**
 * School Fee Client — Parents (V3 §6.2)
 *
 * Pick a child → see the year's fee status → pay in school or via
 * InstaPay (reference submission, finance verifies). Mirrors the
 * checkout result views so the flow feels identical everywhere.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { invalidateFinancialState } from '~/lib/financial-cache';
import { formatPrice } from '~/lib/format';
import { Button } from '~/components/ui/button';

const fetchChildren = () => apiResponse(api.v1.links.children.$get());

type PaymentResult = {
  id: string;
  paymentMethod: string;
  amount: number;
  externalReference: string | null;
  metadata: unknown;
};

type SchoolFeeStatus = {
  academicYear: string;
  student: { id: string; name: string; grade: number | null };
  amount: number | null;
  dueAt: string | null;
  required: boolean;
  paid: boolean;
  pendingPayment: { id: string; externalReference: string | null } | null;
};

export default function SchoolFeeClient({ initialStudentId }: { initialStudentId: string | null }) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const [studentId, setStudentId] = useState<string | null>(initialStudentId);
  const [method, setMethod] = useState<'in_school' | 'instapay'>('in_school');
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [instapayRef, setInstapayRef] = useState('');
  const [refSubmitted, setRefSubmitted] = useState(false);
  const [refError, setRefError] = useState('');

  const { data: children = [] } = useQuery({
    queryKey: ['links', 'children'],
    queryFn: fetchChildren,
  });

  useEffect(() => {
    if (!studentId && children.length === 1) setStudentId(children[0]!.student.id);
  }, [children, studentId]);

  const { data: status, isLoading } = useQuery<SchoolFeeStatus>({
    queryKey: ['school-fees', 'status', studentId],
    queryFn: async () =>
      (await apiResponse(api.v1['school-fees'].status.$get({ query: { studentId: studentId! } }))) as SchoolFeeStatus,
    enabled: !!studentId,
    retry: false,
  });

  const payMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1['school-fees'].pay.$post({
          json: { studentId: studentId!, paymentMethod: method },
        })
      ),
    onSuccess: (data) => {
      setResult(data as unknown as PaymentResult);
      setSubmitError('');
      invalidateFinancialState(queryClient, {});
      queryClient.invalidateQueries({ queryKey: ['school-fees'] });
      router.refresh();
    },
    onError: (err: Error) => setSubmitError(err.message),
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
      queryClient.invalidateQueries({ queryKey: ['school-fees'] });
      router.refresh();
    },
    onError: (err: Error) => setRefError(err.message),
  });

  const selectedChild = children.find((c) => c.student.id === studentId);
  const meta = (result?.metadata ?? {}) as {
    inSchool?: { referenceNumber: string };
    instapay?: {
      account: { bankName: string; accountName: string; accountNumber: string; iban: string | null };
      amountDue: number;
    };
  };

  return (
    <div className="px-6 py-8 max-w-2xl mx-auto animate-fade-up space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">School Fee</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The annual school fee unlocks subject registration for the school year.
        </p>
      </div>

      {/* Child picker */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-5">
        <h2 className="font-semibold text-foreground font-display mb-3">Child</h2>
        {children.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No linked children. Go to <a href="/links" className="text-primary underline">Manage Links</a> first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {children.map((child) => (
              <button
                key={child.id}
                onClick={() => { setStudentId(child.student.id); setResult(null); setSubmitError(''); }}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  studentId === child.student.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:border-primary/40 text-foreground'
                }`}
              >
                {child.student.name}
                {child.student.grade && <span className="ml-1 text-muted-foreground">· Grade {child.student.grade}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {studentId && isLoading && (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* Status + pay */}
      {status && !result && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-foreground font-display">
                {status.academicYear} school year
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedChild?.student.name ?? status.student.name}
              </p>
            </div>
            {status.paid ? (
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                Paid
              </span>
            ) : status.required ? (
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Due{status.amount != null && ` — ${formatPrice(status.amount)}`}
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                Not open yet
              </span>
            )}
          </div>

          {status.pendingPayment && (
            <div className="rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 p-3 text-sm text-brand-700 dark:text-brand-400">
              A school-fee payment is already pending
              {status.pendingPayment.externalReference && (
                <> (reference <span className="font-mono font-semibold">{status.pendingPayment.externalReference}</span>)</>
              )}
              . Complete it at the finance desk or wait for verification.
            </div>
          )}

          {status.required && !status.paid && !status.pendingPayment && (
            <>
              <div>
                <p className="text-sm font-medium text-foreground mb-2">Payment method</p>
                <div className="grid grid-cols-2 gap-3">
                  {(['in_school', 'instapay'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={`p-3 rounded-xl border-2 text-sm font-medium text-left transition-all ${
                        method === m
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border text-muted-foreground hover:border-primary/40'
                      }`}
                    >
                      {m === 'in_school' ? 'Pay at School' : 'InstaPay'}
                    </button>
                  ))}
                </div>
              </div>

              {submitError && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  {submitError}
                </div>
              )}

              <Button
                className="w-full"
                size="lg"
                disabled={payMutation.isPending}
                onClick={() => payMutation.mutate()}
              >
                {payMutation.isPending
                  ? 'Processing…'
                  : `Pay ${status.amount != null ? formatPrice(status.amount) : ''} school fee`}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Result views */}
      {result && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-4">
          <h2 className="font-semibold text-foreground font-display">Payment initiated</h2>

          {result.paymentMethod === 'in_school' && (
            <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 rounded-xl p-5 text-center">
              <p className="text-sm font-medium text-brand-800 dark:text-brand-300 mb-2">Pay at the School Finance Desk</p>
              <p className="text-3xl font-bold tracking-widest text-brand-900 dark:text-brand-200 font-mono">
                {result.externalReference ?? meta.inSchool?.referenceNumber}
              </p>
              <p className="text-xs text-brand-700 dark:text-brand-400 mt-3">
                Quote this reference at the desk. Registration unlocks once the fee is recorded.
              </p>
            </div>
          )}

          {result.paymentMethod === 'instapay' && meta.instapay && (
            <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-xl p-5">
              <p className="text-sm font-medium text-violet-800 dark:text-violet-300 mb-3">
                1 — Transfer via InstaPay
              </p>
              <dl className="space-y-2 text-sm">
                {[
                  ['Bank', meta.instapay.account.bankName],
                  ['Account Name', meta.instapay.account.accountName],
                  ['Account Number', meta.instapay.account.accountNumber],
                  ...(meta.instapay.account.iban ? [['IBAN', meta.instapay.account.iban]] : []),
                  ['Exact Amount', formatPrice(meta.instapay.amountDue)],
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
                  Reference submitted. Finance will verify and the school year unlocks automatically.
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
                    disabled={submitRefMutation.isPending || instapayRef.trim().length < 4}
                    onClick={() => submitRefMutation.mutate({ paymentId: result.id, reference: instapayRef.trim() })}
                  >
                    {submitRefMutation.isPending ? 'Submitting…' : 'Submit Reference'}
                  </Button>
                </>
              )}
            </div>
          )}

          <Button variant="ghost" className="w-full" onClick={() => router.push('/register' as never)}>
            Go to Registration
          </Button>
        </div>
      )}
    </div>
  );
}
