'use client';

/**
 * Admin Escrow Client (ESC-005, ESC-006)
 *
 * Admin reviews all pending and partially-fulfilled withdrawal requests.
 * Features:
 * - List of requests ordered oldest-first (highest priority first)
 * - Fulfill modal: enter amount to release (incremental, partial support)
 * - Reject modal: mandatory reason field
 * - Auto-refresh every 30 seconds
 * - Real-time balance status visible alongside each request
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, WITHDRAWAL_STATUS_LABELS } from '@repo/validations';

// ─── Types ────────────────────────────────────────────────────────────────────

type WithdrawalRequest = {
  id: string;
  requestedAmount: number;
  releasedAmount: number | null;
  status: string;
  adminNotes: string | null;
  createdAt: string;
  escrow: {
    balance: number;
    student: {
      id: string;
      name: string;
      grade: number | null;
      studentId: string | null;
    };
  };
  parent: {
    id: string;
    name: string;
    email: string;
  } | null;
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  pending:             'bg-amber-100 text-amber-800',
  partially_fulfilled: 'bg-blue-100 text-blue-800',
  fulfilled:           'bg-green-100 text-green-800',
  rejected:            'bg-red-100 text-red-800',
};

export default function EscrowAdminClient() {
  const qc = useQueryClient();

  // Modal state
  const [fulfillTarget, setFulfillTarget]   = useState<WithdrawalRequest | null>(null);
  const [rejectTarget, setRejectTarget]     = useState<WithdrawalRequest | null>(null);
  const [fulfillAmount, setFulfillAmount]   = useState('');
  const [fulfillNotes, setFulfillNotes]     = useState('');
  const [rejectNotes, setRejectNotes]       = useState('');
  const [actionError, setActionError]       = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'escrow', 'withdrawals'] });

  const { data: requests = [], isLoading, refetch } = useQuery<WithdrawalRequest[]>({
    queryKey: ['admin', 'escrow', 'withdrawals'],
    queryFn: () => apiResponse(api.v1.escrow.admin.withdrawals.$get()),
    refetchInterval: 30_000,
  });

  // Auto-refresh timer reset on manual refetch
  useEffect(() => {
    const id = setInterval(() => refetch(), 30_000);
    return () => clearInterval(id);
  }, [refetch]);

  // ─── Mutations ────────────────────────────────────────────────────────────────

  const fulfillMutation = useMutation({
    mutationFn: ({ id, amount, notes }: { id: string; amount: number; notes?: string }) =>
      apiResponse(
        api.v1.escrow.admin.withdrawals[':id'].fulfill.$post({
          param: { id },
          json: { releasedAmount: amount, notes },
        })
      ),
    onSuccess: () => {
      setFulfillTarget(null);
      setFulfillAmount('');
      setFulfillNotes('');
      setActionError('');
      invalidate();
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      apiResponse(
        api.v1.escrow.admin.withdrawals[':id'].reject.$post({
          param: { id },
          json: { notes },
        })
      ),
    onSuccess: () => {
      setRejectTarget(null);
      setRejectNotes('');
      setActionError('');
      invalidate();
    },
    onError: (err: Error) => setActionError(err.message),
  });

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Withdrawal Requests</h1>
            <p className="text-sm text-gray-500 mt-1">
              Pending and partially-fulfilled escrow withdrawals — oldest first.
            </p>
          </div>
          <button
            onClick={() => refetch()}
            className="text-sm text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-lg px-4 py-2 hover:bg-indigo-50 transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-600 border-t-transparent" />
          </div>
        ) : requests.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-sm text-gray-400">
            No pending withdrawal requests.
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((req) => {
              const remaining = req.requestedAmount - (req.releasedAmount ?? 0);
              return (
                <div key={req.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    {/* Student & Parent Info */}
                    <div>
                      <p className="font-semibold text-gray-900">
                        {req.escrow.student.name}
                        {req.escrow.student.grade && (
                          <span className="text-xs text-gray-400 font-normal ml-1">
                            Grade {req.escrow.student.grade}
                          </span>
                        )}
                        {req.escrow.student.studentId && (
                          <span className="text-xs text-gray-400 font-normal ml-1">
                            · ID: {req.escrow.student.studentId}
                          </span>
                        )}
                      </p>
                      {req.parent && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          Parent: {req.parent.name} ({req.parent.email})
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        Submitted {new Date(req.createdAt).toLocaleString()}
                      </p>
                    </div>

                    {/* Status badge */}
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[req.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {WITHDRAWAL_STATUS_LABELS[req.status as keyof typeof WITHDRAWAL_STATUS_LABELS] ?? req.status}
                    </span>
                  </div>

                  {/* Amounts */}
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">Requested</p>
                      <p className="text-base font-bold text-gray-900">{req.requestedAmount.toFixed(2)} EGP</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">Released</p>
                      <p className="text-base font-bold text-green-700">{(req.releasedAmount ?? 0).toFixed(2)} EGP</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">Escrow Balance</p>
                      <p className="text-base font-bold text-indigo-700">{req.escrow.balance.toFixed(2)} EGP</p>
                    </div>
                  </div>

                  {req.adminNotes && (
                    <p className="mt-3 text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded p-2">
                      Previous note: {req.adminNotes}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => { setFulfillTarget(req); setFulfillAmount(remaining.toFixed(2)); setActionError(''); }}
                      className="flex-1 py-2 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-700 transition-colors"
                    >
                      Fulfill
                    </button>
                    <button
                      onClick={() => { setRejectTarget(req); setActionError(''); }}
                      className="flex-1 py-2 bg-white border border-red-300 text-red-600 text-sm font-medium rounded-xl hover:bg-red-50 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Fulfill Modal */}
      {fulfillTarget && (
        <Modal
          title="Fulfill Withdrawal"
          onClose={() => { setFulfillTarget(null); setActionError(''); }}
        >
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Student</span>
                <span className="font-medium">{fulfillTarget.escrow.student.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total Requested</span>
                <span className="font-medium">{fulfillTarget.requestedAmount.toFixed(2)} EGP</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Already Released</span>
                <span className="font-medium text-green-700">{(fulfillTarget.releasedAmount ?? 0).toFixed(2)} EGP</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Remaining</span>
                <span className="font-semibold">{(fulfillTarget.requestedAmount - (fulfillTarget.releasedAmount ?? 0)).toFixed(2)} EGP</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Current Escrow Balance</span>
                <span className="font-medium text-indigo-700">{fulfillTarget.escrow.balance.toFixed(2)} EGP</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount to Release (EGP)
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={fulfillAmount}
                onChange={(e) => setFulfillAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={fulfillNotes}
                onChange={(e) => setFulfillNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                placeholder="Bank reference number, notes..."
              />
            </div>

            {actionError && <p className="text-sm text-red-600">{actionError}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => { setFulfillTarget(null); setActionError(''); }}
                className="flex-1 py-2.5 border border-gray-300 text-sm rounded-xl text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  fulfillMutation.mutate({
                    id: fulfillTarget.id,
                    amount: parseFloat(fulfillAmount),
                    notes: fulfillNotes || undefined,
                  })
                }
                disabled={!parseFloat(fulfillAmount) || fulfillMutation.isPending}
                className="flex-1 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {fulfillMutation.isPending ? 'Processing...' : 'Confirm Release'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Modal */}
      {rejectTarget && (
        <Modal
          title="Reject Withdrawal Request"
          onClose={() => { setRejectTarget(null); setActionError(''); }}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Rejecting this request for{' '}
              <span className="font-semibold">{rejectTarget.escrow.student.name}</span>{' '}
              ({rejectTarget.requestedAmount.toFixed(2)} EGP). No funds will be moved.
            </p>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                placeholder="Explain why this request is being rejected..."
              />
            </div>

            {actionError && <p className="text-sm text-red-600">{actionError}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => { setRejectTarget(null); setActionError(''); }}
                className="flex-1 py-2.5 border border-gray-300 text-sm rounded-xl text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => rejectMutation.mutate({ id: rejectTarget.id, notes: rejectNotes })}
                disabled={!rejectNotes.trim() || rejectMutation.isPending}
                className="flex-1 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {rejectMutation.isPending ? 'Rejecting...' : 'Reject Request'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Modal Helper ─────────────────────────────────────────────────────────────

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
