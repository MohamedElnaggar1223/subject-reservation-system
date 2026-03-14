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
import { api } from '~/lib/hono';
import { apiResponse, WITHDRAWAL_STATUS_LABELS } from '@repo/validations';

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
  pending:             'bg-amber-100 text-amber-800',
  partially_fulfilled: 'bg-blue-100 text-blue-800',
  fulfilled:           'bg-green-100 text-green-800',
  rejected:            'bg-red-100 text-red-800',
};

export default function WithdrawClient() {
  const qc = useQueryClient();

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
      qc.invalidateQueries({ queryKey: ['escrow', 'withdrawals'] });
    },
    onError: (err: Error) => setSubmitError(err.message),
  });

  const canSubmit =
    !!selectedChildId &&
    parsedAmount > 0 &&
    parsedAmount <= (selectedChild?.escrowBalance ?? 0);

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-2xl mx-auto px-4 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Request Withdrawal</h1>
          <p className="text-sm text-gray-500 mt-1">
            Withdraw cash from a child&apos;s escrow balance. Admin will process your request.
          </p>
        </div>

        {/* Request Form */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          {submitted ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <p className="font-medium text-gray-900">Request Submitted</p>
              <p className="text-sm text-gray-500 mt-1">
                Your withdrawal request has been sent to the admin for processing.
              </p>
              <button
                onClick={() => { setSubmitted(false); setAmount(''); setSelectedChildId(''); }}
                className="mt-4 text-sm text-indigo-600 hover:underline"
              >
                Submit another request
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Child</label>
                <select
                  value={selectedChildId}
                  onChange={(e) => setSelectedChildId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (EGP)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={selectedChild?.escrowBalance}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {selectedChild && parsedAmount > selectedChild.escrowBalance && (
                  <p className="text-xs text-red-600 mt-1">Amount exceeds available balance</p>
                )}
              </div>

              {submitError && (
                <p className="text-sm text-red-600">{submitError}</p>
              )}

              <button
                onClick={() => withdrawMutation.mutate()}
                disabled={!canSubmit || withdrawMutation.isPending}
                className="w-full py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {withdrawMutation.isPending ? 'Submitting...' : 'Submit Withdrawal Request'}
              </button>
            </div>
          )}
        </div>

        {/* Withdrawal History */}
        <div>
          <h2 className="text-base font-semibold text-gray-800 mb-3">Withdrawal History</h2>
          {withdrawals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-400">
              No withdrawal requests yet.
            </div>
          ) : (
            <div className="space-y-3">
              {withdrawals.map((req) => (
                <div
                  key={req.id}
                  className="bg-white rounded-xl border border-gray-200 p-4"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {req.escrow.student.name}
                        {req.escrow.student.grade && (
                          <span className="text-xs text-gray-400 ml-1">
                            (Grade {req.escrow.student.grade})
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {new Date(req.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[req.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {WITHDRAWAL_STATUS_LABELS[req.status as keyof typeof WITHDRAWAL_STATUS_LABELS] ?? req.status}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-gray-500">Requested</span>
                    <span className="font-semibold text-gray-900">{req.requestedAmount.toFixed(2)} EGP</span>
                  </div>
                  {req.releasedAmount != null && req.releasedAmount > 0 && (
                    <div className="flex items-center justify-between text-sm mt-1">
                      <span className="text-gray-500">Released</span>
                      <span className="font-semibold text-green-700">{req.releasedAmount.toFixed(2)} EGP</span>
                    </div>
                  )}
                  {req.adminNotes && (
                    <p className="mt-2 text-xs text-gray-500 bg-gray-50 rounded p-2">
                      Admin note: {req.adminNotes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
