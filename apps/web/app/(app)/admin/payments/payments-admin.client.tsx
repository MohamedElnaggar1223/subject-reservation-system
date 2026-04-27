'use client';

/**
 * Admin Payments Client Component
 *
 * Displays all pending bank transfer payments for admin confirmation (PAY-007).
 *
 * Features:
 * - Pending transfers listed oldest-first (longest waiting first)
 * - Shows student info, parent info, amount, bank reference, and registration list
 * - Confirm button opens a modal for optional admin notes before confirming
 * - On confirmation: payment -> 'completed', all linked registrations -> 'confirmed'
 * - Real-time list refresh after each confirmation
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';

const fetchPendingPayments = () => apiResponse(api.v1.payments['pending-bank'].$get());
type PendingPayment = Awaited<ReturnType<typeof fetchPendingPayments>>[number];

export default function AdminPaymentsClient() {
  const queryClient = useQueryClient();

  const [selectedPayment, setSelectedPayment] = useState<PendingPayment | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [confirmedId, setConfirmedId] = useState<string | null>(null);

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ['payments', 'pending-bank'],
    queryFn: fetchPendingPayments,
    refetchInterval: 30_000,
  });

  const confirmMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      return apiResponse(
        api.v1.payments[':id'].confirm.$post({
          param: { id },
          json: { notes },
        })
      );
    },
    onSuccess: (_, vars) => {
      setConfirmedId(vars.id);
      setSelectedPayment(null);
      setAdminNotes('');
      setConfirmError('');
      queryClient.invalidateQueries({ queryKey: ['payments', 'pending-bank'] });
    },
    onError: (err: Error) => {
      setConfirmError(err.message);
    },
  });

  if (isLoading) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto animate-fade-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Bank Transfer Confirmations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review and confirm pending bank transfers to release registrations.
        </p>
      </div>

      {confirmedId && (
        <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>Payment confirmed successfully. Registrations moved to Confirmed.</span>
            <a
              href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/v1/payments/${confirmedId}/receipt`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
            >
              Download Receipt
            </a>
          </div>
          <button
            onClick={() => setConfirmedId(null)}
            className="text-emerald-600 hover:text-emerald-800 text-xs underline dark:text-emerald-400"
          >
            Dismiss
          </button>
        </div>
      )}

      {pending.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-16 text-center shadow-sm">
          <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <p className="text-foreground font-medium">No pending bank transfers</p>
          <p className="text-sm text-muted-foreground mt-1">All transfers have been confirmed.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((pay) => {
            const bankDetails = pay.metadata?.bankDetails as {
              bankName?: string;
              accountNumber?: string;
              referenceNumber?: string;
            } | undefined;

            const totalAmount = pay.amount + pay.escrowAmountApplied;
            const waitingHours = Math.floor(
              (Date.now() - new Date(pay.createdAt).getTime()) / (1000 * 60 * 60)
            );

            return (
              <div
                key={pay.id}
                className="bg-card rounded-xl border border-border shadow-sm overflow-hidden"
              >
                <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground">{pay.student.name}</p>
                      {pay.student.grade && (
                        <span className="px-2 py-0.5 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400 rounded text-xs font-medium">
                          Grade {pay.student.grade}
                        </span>
                      )}
                      {waitingHours >= 24 && (
                        <span className="px-2 py-0.5 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded text-xs font-medium">
                          Waiting {waitingHours}h
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Parent: {pay.parent.name} ({pay.parent.email})
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Submitted: {new Date(pay.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold text-foreground">{totalAmount.toFixed(2)} EGP</p>
                    {pay.escrowAmountApplied > 0 && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        Incl. {pay.escrowAmountApplied.toFixed(2)} escrow
                      </p>
                    )}
                  </div>
                </div>

                {/* Bank reference + subjects */}
                <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Bank Reference</p>
                    <p className="text-sm font-mono font-bold text-primary">
                      {bankDetails?.referenceNumber ?? pay.externalReference ?? '---'}
                    </p>
                    {bankDetails?.bankName && (
                      <p className="text-xs text-muted-foreground mt-0.5">{bankDetails.bankName}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Subjects ({pay.paymentRegistrations.length})
                    </p>
                    <ul className="space-y-0.5">
                      {pay.paymentRegistrations.map((pr) => (
                        <li key={pr.registrationId} className="text-xs text-card-foreground flex justify-between">
                          <span>
                            {pr.registration.subject.name}
                            <span className="text-muted-foreground ml-1 font-mono text-xs">
                              ({pr.registration.subject.code})
                            </span>
                          </span>
                          <span className="text-muted-foreground shrink-0 ml-2">
                            {pr.registration.priceAtRegistration.toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Actions */}
                <div className="px-6 py-3 bg-muted border-t border-border flex justify-end">
                  <Button
                    onClick={() => {
                      setSelectedPayment(pay);
                      setAdminNotes('');
                      setConfirmError('');
                    }}
                  >
                    Confirm Transfer
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal */}
      {selectedPayment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-xl shadow-xl border border-border max-w-md w-full p-6">
            <h2 className="text-lg font-bold text-foreground font-display mb-1">Confirm Bank Transfer</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Confirm that you have received the bank transfer from{' '}
              <span className="font-medium text-foreground">{selectedPayment.parent.name}</span>{' '}
              for{' '}
              <span className="font-medium text-foreground">
                {(selectedPayment.amount + selectedPayment.escrowAmountApplied).toFixed(2)} EGP
              </span>.
              This will move {selectedPayment.paymentRegistrations.length} registration(s) to Confirmed.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-1">
                Admin Notes (optional)
              </label>
              <textarea
                rows={3}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="e.g., Verified via bank statement ref #12345678"
                className="w-full px-3 py-2 text-sm border border-border bg-background rounded-lg resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {confirmError && (
              <p className="mb-4 text-sm text-red-600 dark:text-red-400">{confirmError}</p>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setSelectedPayment(null);
                  setConfirmError('');
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                onClick={() =>
                  confirmMutation.mutate({
                    id: selectedPayment.id,
                    notes: adminNotes || undefined,
                  })
                }
                disabled={confirmMutation.isPending}
              >
                {confirmMutation.isPending ? 'Confirming...' : 'Yes, Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
