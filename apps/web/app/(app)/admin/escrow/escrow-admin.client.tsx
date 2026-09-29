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
import { useRouter } from 'next/navigation';
import { api } from '~/lib/hono';
import { invalidateFinancialState } from '~/lib/financial-cache';
import { apiResponse, gradeLabel, WITHDRAWAL_STATUS_LABELS } from '@repo/validations';
import { Button } from '~/components/ui/button';

// --- Types ---

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

// --- Styles ---

const STATUS_STYLES: Record<string, string> = {
  pending:             'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  partially_fulfilled: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  fulfilled:           'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  rejected:            'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export default function EscrowAdminClient() {
  const qc = useQueryClient();
  const router = useRouter();

  // Modal state
  const [fulfillTarget, setFulfillTarget]   = useState<WithdrawalRequest | null>(null);
  const [rejectTarget, setRejectTarget]     = useState<WithdrawalRequest | null>(null);
  const [fulfillAmount, setFulfillAmount]   = useState('');
  const [fulfillNotes, setFulfillNotes]     = useState('');
  const [rejectNotes, setRejectNotes]       = useState('');
  const [actionError, setActionError]       = useState('');

  const invalidate = (studentId?: string, escrowDelta?: number) => {
    invalidateFinancialState(qc, { studentId, escrowDelta });
    router.refresh();
  };

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

  // --- Mutations ---

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
      invalidate(fulfillTarget?.escrow.student.id);
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
      const target = rejectTarget;
      const refundAmount = target
        ? target.requestedAmount - (target.releasedAmount ?? 0)
        : undefined;
      setRejectTarget(null);
      setRejectNotes('');
      setActionError('');
      invalidate(target?.escrow.student.id, refundAmount);
    },
    onError: (err: Error) => setActionError(err.message),
  });

  // --- Render ---

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Withdrawal Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pending and partially-fulfilled escrow withdrawals — oldest first.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
        >
          Refresh
        </Button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" />
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-sm text-muted-foreground shadow-sm">
          No pending withdrawal requests.
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((req) => {
            const remaining = req.requestedAmount - (req.releasedAmount ?? 0);
            return (
              <div key={req.id} className="bg-card rounded-xl border border-border shadow-sm p-5">
                <div className="flex items-start justify-between flex-wrap gap-3">
                  {/* Student & Parent Info */}
                  <div>
                    <p className="font-semibold text-foreground">
                      {req.escrow.student.name}
                      {req.escrow.student.grade != null && (
                        <span className="text-xs text-muted-foreground font-normal ms-1">
                          {gradeLabel(req.escrow.student.grade)}
                        </span>
                      )}
                      {req.escrow.student.studentId && (
                        <span className="text-xs text-muted-foreground font-normal ml-1">
                          · ID: {req.escrow.student.studentId}
                        </span>
                      )}
                    </p>
                    {req.parent && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Parent: {req.parent.name} ({req.parent.email})
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Submitted {new Date(req.createdAt).toLocaleString()}
                    </p>
                  </div>

                  {/* Status badge */}
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[req.status] ?? 'bg-muted text-muted-foreground'}`}>
                    {WITHDRAWAL_STATUS_LABELS[req.status as keyof typeof WITHDRAWAL_STATUS_LABELS] ?? req.status}
                  </span>
                </div>

                {/* Amounts */}
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="bg-muted rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground">Requested</p>
                    <p className="text-base font-bold text-foreground">{req.requestedAmount.toFixed(2)} EGP</p>
                  </div>
                  <div className="bg-muted rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground">Released</p>
                    <p className="text-base font-bold text-emerald-700 dark:text-emerald-400">{(req.releasedAmount ?? 0).toFixed(2)} EGP</p>
                  </div>
                  <div className="bg-muted rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground">Escrow Balance</p>
                    <p className="text-base font-bold text-primary">{req.escrow.balance.toFixed(2)} EGP</p>
                  </div>
                </div>

                {req.adminNotes && (
                  <p className="mt-3 text-xs text-muted-foreground bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded p-2">
                    Previous note: {req.adminNotes}
                  </p>
                )}

                {/* Actions */}
                <div className="mt-4 flex gap-2">
                  <Button
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => { setFulfillTarget(req); setFulfillAmount(remaining.toFixed(2)); setActionError(''); }}
                  >
                    Fulfill
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                    onClick={() => { setRejectTarget(req); setActionError(''); }}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fulfill Modal */}
      {fulfillTarget && (
        <Modal
          title="Fulfill Withdrawal"
          onClose={() => { setFulfillTarget(null); setActionError(''); }}
        >
          <div className="space-y-4">
            <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Student</span>
                <span className="font-medium text-foreground">{fulfillTarget.escrow.student.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Requested</span>
                <span className="font-medium text-foreground">{fulfillTarget.requestedAmount.toFixed(2)} EGP</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already Released</span>
                <span className="font-medium text-emerald-700 dark:text-emerald-400">{(fulfillTarget.releasedAmount ?? 0).toFixed(2)} EGP</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Remaining</span>
                <span className="font-semibold text-foreground">{(fulfillTarget.requestedAmount - (fulfillTarget.releasedAmount ?? 0)).toFixed(2)} EGP</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current Escrow Balance</span>
                <span className="font-medium text-primary">{fulfillTarget.escrow.balance.toFixed(2)} EGP</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Amount to Release (EGP)
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={fulfillAmount}
                onChange={(e) => setFulfillAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border bg-background rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Notes <span className="text-muted-foreground">(optional)</span>
              </label>
              <textarea
                value={fulfillNotes}
                onChange={(e) => setFulfillNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-border bg-background rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                placeholder="Bank reference number, notes..."
              />
            </div>

            {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setFulfillTarget(null); setActionError(''); }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                onClick={() =>
                  fulfillMutation.mutate({
                    id: fulfillTarget.id,
                    amount: parseFloat(fulfillAmount),
                    notes: fulfillNotes || undefined,
                  })
                }
                disabled={!parseFloat(fulfillAmount) || fulfillMutation.isPending}
              >
                {fulfillMutation.isPending ? 'Processing...' : 'Confirm Release'}
              </Button>
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
            <p className="text-sm text-muted-foreground">
              Rejecting this request for{' '}
              <span className="font-semibold text-foreground">{rejectTarget.escrow.student.name}</span>{' '}
              ({rejectTarget.requestedAmount.toFixed(2)} EGP). The unreleased held amount will be returned to escrow.
            </p>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Reason <span className="text-destructive">*</span>
              </label>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-border bg-background rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                placeholder="Explain why this request is being rejected..."
              />
            </div>

            {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setRejectTarget(null); setActionError(''); }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1 font-semibold"
                onClick={() => rejectMutation.mutate({ id: rejectTarget.id, notes: rejectNotes })}
                disabled={!rejectNotes.trim() || rejectMutation.isPending}
              >
                {rejectMutation.isPending ? 'Rejecting...' : 'Reject Request'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Modal Helper ---

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
      <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground font-display">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
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
