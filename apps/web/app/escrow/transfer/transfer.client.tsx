'use client';

/**
 * Escrow Transfer Client — Parents Only (ESC-003)
 *
 * Parent transfers escrow funds from one linked child to another.
 * Shows current balances for both selected children.
 * Validates amount client-side before submitting.
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';

type ChildBalance = {
  id: string;
  name: string;
  grade: number | null;
  escrowBalance: number;
};

export default function TransferClient() {
  const router = useRouter();

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
      setSuccess(true);
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

  if (children.length < 2) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-700 font-medium">At least two linked children are required to transfer funds.</p>
          <button onClick={() => router.push('/escrow')} className="mt-4 text-sm text-indigo-600 hover:underline">
            Back to Escrow
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 py-16">
        <div className="max-w-md mx-auto px-4 text-center">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Transfer Complete</h1>
          <p className="text-sm text-gray-500">
            {parsedAmount.toFixed(2)} EGP transferred from {fromChild?.name} to {toChild?.name}.
          </p>
          <button
            onClick={() => router.push('/escrow')}
            className="mt-6 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
          >
            Back to Escrow
          </button>
        </div>
      </div>
    );
  }

  const canSubmit = fromId && toId && fromId !== toId && parsedAmount > 0 &&
    parsedAmount <= (fromChild?.escrowBalance ?? 0);

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-lg mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Transfer Escrow Funds</h1>
          <p className="text-sm text-gray-500 mt-1">
            Move funds between your linked children&apos;s escrow accounts.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
          {/* From */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
            <select
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select child</option>
              {children.map((child) => (
                <option key={child.id} value={child.id} disabled={child.id === toId}>
                  {child.name} ({child.grade ? `Grade ${child.grade}` : 'N/A'}) — {child.escrowBalance.toFixed(2)} EGP
                </option>
              ))}
            </select>
            {fromChild && (
              <p className="text-xs text-gray-500 mt-1">
                Available balance: <span className="font-semibold">{fromChild.escrowBalance.toFixed(2)} EGP</span>
              </p>
            )}
          </div>

          {/* To */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
            <select
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select child</option>
              {children.map((child) => (
                <option key={child.id} value={child.id} disabled={child.id === fromId}>
                  {child.name} ({child.grade ? `Grade ${child.grade}` : 'N/A'}) — {child.escrowBalance.toFixed(2)} EGP
                </option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount (EGP)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              max={fromChild?.escrowBalance ?? undefined}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {fromChild && parsedAmount > fromChild.escrowBalance && (
              <p className="text-xs text-red-600 mt-1">Amount exceeds available balance</p>
            )}
          </div>

          {submitError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {submitError}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => router.push('/escrow')}
              className="flex-1 py-2.5 border border-gray-300 text-sm font-medium rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => transferMutation.mutate()}
              disabled={!canSubmit || transferMutation.isPending}
              className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {transferMutation.isPending ? 'Transferring...' : 'Transfer Funds'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
