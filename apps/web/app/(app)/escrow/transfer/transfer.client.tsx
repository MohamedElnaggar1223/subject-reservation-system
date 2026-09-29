'use client';

/**
 * Escrow Transfer Client — Parents Only (ESC-003)
 *
 * Parent transfers escrow funds from one linked child to another.
 * Shows current balances for both selected children.
 * Validates amount client-side before submitting.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '~/lib/hono';
import { invalidateFinancialState } from '~/lib/financial-cache';
import { apiResponse, gradeLabel } from '@repo/validations';
import { Button } from '~/components/ui/button';

type ChildBalance = {
  id: string;
  name: string;
  grade: number | null;
  escrowBalance: number;
};

export default function TransferClient() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [fromId, setFromId] = useState('');
  const [toId, setToId]     = useState('');
  const [amount, setAmount]  = useState('');
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess] = useState(false);

  const { data: children = [], isLoading } = useQuery<ChildBalance[]>({
    queryKey: ['escrow', 'children'],
    queryFn: () => apiResponse(api.v1.escrow.children.$get()),
  });

  const fromChild = children.find((c) => c.id === fromId);
  const toChild   = children.find((c) => c.id === toId);
  const parsedAmount = parseFloat(amount) || 0;

  const transferMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.escrow.transfer.$post({
          json: {
            fromStudentId: fromId,
            toStudentId:   toId,
            amount:        parsedAmount,
          },
        })
      ),
    onSuccess: () => {
      invalidateFinancialState(queryClient, {
        studentId: fromId,
        escrowDelta: -parsedAmount,
      });
      invalidateFinancialState(queryClient, {
        studentId: toId,
        escrowDelta: parsedAmount,
      });
      router.refresh();
      setSuccess(true);
      setSubmitError('');
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

  if (children.length < 2) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto">
        <div className="bg-card rounded-xl border border-border shadow-sm p-12 text-center">
          <p className="text-foreground font-medium">At least two linked children are required to transfer funds.</p>
          <Button
            variant="outline"
            onClick={() => router.push('/escrow' as never)}
            className="mt-4"
          >
            Back to Escrow
          </Button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
        <div className="max-w-md mx-auto text-center">
          <div className="w-14 h-14 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-brand-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-foreground font-display mb-2">Transfer Complete</h1>
          <p className="text-sm text-muted-foreground">
            {parsedAmount.toFixed(2)} EGP transferred from {fromChild?.name} to {toChild?.name}.
          </p>
          <Button
            onClick={() => router.push('/escrow' as never)}
            className="mt-6"
          >
            Back to Escrow
          </Button>
        </div>
      </div>
    );
  }

  const canSubmit = fromId && toId && fromId !== toId && parsedAmount > 0 &&
    parsedAmount <= (fromChild?.escrowBalance ?? 0);

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
      <div className="max-w-lg mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Transfer Escrow Funds</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Move funds between your linked children&apos;s escrow accounts.
          </p>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-5">
          {/* From */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">From</label>
            <select
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select child</option>
              {children.map((child) => (
                <option key={child.id} value={child.id} disabled={child.id === toId}>
                  {child.name} ({gradeLabel(child.grade)}) — {child.escrowBalance.toFixed(2)} EGP
                </option>
              ))}
            </select>
            {fromChild && (
              <p className="text-xs text-muted-foreground mt-1">
                Available balance: <span className="font-semibold text-foreground">{fromChild.escrowBalance.toFixed(2)} EGP</span>
              </p>
            )}
          </div>

          {/* To */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">To</label>
            <select
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select child</option>
              {children.map((child) => (
                <option key={child.id} value={child.id} disabled={child.id === fromId}>
                  {child.name} ({gradeLabel(child.grade)}) — {child.escrowBalance.toFixed(2)} EGP
                </option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Amount (EGP)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              max={fromChild?.escrowBalance ?? undefined}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {fromChild && parsedAmount > fromChild.escrowBalance && (
              <p className="text-xs text-destructive mt-1">Amount exceeds available balance</p>
            )}
          </div>

          {submitError && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
              {submitError}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => router.push('/escrow' as never)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={() => transferMutation.mutate()}
              disabled={!canSubmit || transferMutation.isPending}
              className="flex-1"
            >
              {transferMutation.isPending ? 'Transferring...' : 'Transfer Funds'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
