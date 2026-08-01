'use client';

/**
 * Escrow Withdrawal Client — Parents Only (ESC-004, ESC-007)
 *
 * Two panels:
 * 1. Withdrawal request form — select child, enter amount, submit to admin queue
 * 2. Withdrawal history — past requests with status badges
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '~/lib/hono';
import { invalidateFinancialState } from '~/lib/financial-cache';
import { apiResponse, WITHDRAWAL_STATUS_LABELS } from '@repo/validations';
import { Button } from '~/components/ui/button';

type ChildBalance = {
  id: string;
  name: string;
  grade: number | null;
  escrowBalance: number;
};

type WithdrawalRequest = {
  id: string;
  requestedAmount: number;
  releasedAmount: number | null;
  status: string;
  adminNotes: string | null;
  createdAt: string;
  escrow: {
    student: { id: string; name: string; grade: number | null };
  };
};

const STATUS_STYLES: Record<string, string> = {
  pending:             'bg-amber-50 text-amber-700',
  partially_fulfilled: 'bg-brand-50 text-brand-700',
  fulfilled:           'bg-emerald-50 text-emerald-700',
  rejected:            'bg-destructive/10 text-destructive',
};

export default function WithdrawClient() {
  const qc = useQueryClient();
  const router = useRouter();

  const [selectedChildId, setSelectedChildId] = useState('');
  const [amount, setAmount] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const { data: children = [] } = useQuery<ChildBalance[]>({
    queryKey: ['escrow', 'children'],
    queryFn: () => apiResponse(api.v1.escrow.children.$get()),
  });

  const { data: withdrawals = [] } = useQuery<WithdrawalRequest[]>({
    queryKey: ['escrow', 'withdrawals'],
    queryFn: () => apiResponse(api.v1.escrow.withdrawals.$get({ query: {} })),
  });

  const selectedChild = children.find((c) => c.id === selectedChildId);
  const parsedAmount = parseFloat(amount) || 0;

  const withdrawMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.escrow.withdraw.$post({
          json: { studentId: selectedChildId, amount: parsedAmount },
        })
      ),
    onSuccess: () => {
      setSubmitted(true);
      setSubmitError('');
      invalidateFinancialState(qc, {
        studentId: selectedChildId,
        escrowDelta: -parsedAmount,
      });
      router.refresh();
    },
    onError: (err: Error) => setSubmitError(err.message),
  });

  const canSubmit =
    !!selectedChildId &&
    parsedAmount > 0 &&
    parsedAmount <= (selectedChild?.escrowBalance ?? 0);

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto space-y-8 animate-fade-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Request Withdrawal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Withdraw cash from a child&apos;s escrow balance. Admin will process your request.
        </p>
      </div>

      {/* Request Form */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        {submitted ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-brand-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <p className="font-medium text-foreground">Request Submitted</p>
            <p className="text-sm text-muted-foreground mt-1">
              Your withdrawal request has been sent to the admin for processing.
            </p>
            <button
              onClick={() => { setSubmitted(false); setAmount(''); setSelectedChildId(''); }}
              className="mt-4 text-sm text-primary hover:underline"
            >
              Submit another request
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Child</label>
              <select
                value={selectedChildId}
                onChange={(e) => setSelectedChildId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select a child</option>
                {children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.name} — {child.escrowBalance.toFixed(2)} EGP available
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Amount (EGP)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                max={selectedChild?.escrowBalance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {selectedChild && parsedAmount > selectedChild.escrowBalance && (
                <p className="text-xs text-destructive mt-1">Amount exceeds available balance</p>
              )}
            </div>

            {submitError && (
              <p className="text-sm text-destructive">{submitError}</p>
            )}

            <Button
              onClick={() => withdrawMutation.mutate()}
              disabled={!canSubmit || withdrawMutation.isPending}
              className="w-full"
            >
              {withdrawMutation.isPending ? 'Submitting...' : 'Submit Withdrawal Request'}
            </Button>
          </div>
        )}
      </div>

      {/* Withdrawal History */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Withdrawal History</h2>
        {withdrawals.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
            No withdrawal requests yet.
          </div>
        ) : (
          <div className="space-y-3">
            {withdrawals.map((req) => (
              <div
                key={req.id}
                className="bg-card rounded-xl border border-border shadow-sm p-4"
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {req.escrow.student.name}
                      {req.escrow.student.grade && (
                        <span className="text-xs text-muted-foreground ml-1">
                          (Grade {req.escrow.student.grade})
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[req.status] ?? 'bg-muted text-muted-foreground'}`}>
                    {WITHDRAWAL_STATUS_LABELS[req.status as keyof typeof WITHDRAWAL_STATUS_LABELS] ?? req.status}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Requested</span>
                  <span className="font-semibold text-foreground">{req.requestedAmount.toFixed(2)} EGP</span>
                </div>
                {req.releasedAmount != null && req.releasedAmount > 0 && (
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-muted-foreground">Released</span>
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">{req.releasedAmount.toFixed(2)} EGP</span>
                  </div>
                )}
                {req.adminNotes && (
                  <p className="mt-2 text-xs text-muted-foreground bg-muted rounded-lg p-2">
                    Admin note: {req.adminNotes}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
