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
 * - On confirmation: payment → 'completed', all linked registrations → 'confirmed'
 * - Real-time list refresh after each confirmation
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';

type PendingPayment = {
  id: string;
  amount: number;
  escrowAmountApplied: number;
  paymentMethod: string;
  status: string;
  externalReference: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  student: { id: string; name: string; email: string; grade: string | null; studentId: string | null };
  parent: { id: string; name: string; email: string };
  paymentRegistrations: Array<{
    registrationId: string;
    registration: {
      id: string;
      priceAtRegistration: number;
      subject: { id: string; name: string; code: string };
    };
  }>;
};

export default function AdminPaymentsClient() {
  const queryClient = useQueryClient();

  const [selectedPayment, setSelectedPayment] = useState<PendingPayment | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [confirmedId, setConfirmedId] = useState<string | null>(null);

  const { data: pending = [], isLoading } = useQuery<PendingPayment[]>({
    queryKey: ['payments', 'pending-bank'],
    queryFn: () => apiResponse(api.v1.payments['pending-bank'].$get()),
    refetchInterval: 30_000, // auto-refresh every 30 seconds
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-5xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Bank Transfer Confirmations</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review and confirm pending bank transfers to release registrations.
          </p>
        </div>

        {confirmedId && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 flex items-center justify-between">
            <span>Payment confirmed successfully. Registrations moved to Confirmed.</span>
            <button
              onClick={() => setConfirmedId(null)}
              className="text-green-600 hover:text-green-800 text-xs underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {pending.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-16 text-center">
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-gray-700 font-medium">No pending bank transfers</p>
            <p className="text-sm text-gray-400 mt-1">All transfers have been confirmed.</p>
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
                  className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
                >
                  <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">{pay.student.name}</p>
                        {pay.student.grade && (
                          <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">
                            Grade {pay.student.grade}
                          </span>
                        )}
                        {waitingHours >= 24 && (
                          <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">
                            Waiting {waitingHours}h
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Parent: {pay.parent.name} ({pay.parent.email})
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Submitted: {new Date(pay.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold text-gray-900">{totalAmount.toFixed(2)} EGP</p>
                      {pay.escrowAmountApplied > 0 && (
                        <p className="text-xs text-green-600">
                          Incl. {pay.escrowAmountApplied.toFixed(2)} escrow
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Bank reference + subjects */}
                  <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">Bank Reference</p>
                      <p className="text-sm font-mono font-bold text-indigo-700">
                        {bankDetails?.referenceNumber ?? pay.externalReference ?? '—'}
                      </p>
                      {bankDetails?.bankName && (
                        <p className="text-xs text-gray-400 mt-0.5">{bankDetails.bankName}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">
                        Subjects ({pay.paymentRegistrations.length})
                      </p>
                      <ul className="space-y-0.5">
                        {pay.paymentRegistrations.map((pr) => (
                          <li key={pr.registrationId} className="text-xs text-gray-700 flex justify-between">
                            <span>
                              {pr.registration.subject.name}
                              <span className="text-gray-400 ml-1 font-mono text-xs">
                                ({pr.registration.subject.code})
                              </span>
                            </span>
                            <span className="text-gray-500 shrink-0 ml-2">
                              {pr.registration.priceAtRegistration.toFixed(2)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex justify-end">
                    <button
                      onClick={() => {
                        setSelectedPayment(pay);
                        setAdminNotes('');
                        setConfirmError('');
                      }}
                      className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      Confirm Transfer
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {selectedPayment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Confirm Bank Transfer</h2>
            <p className="text-sm text-gray-500 mb-6">
              Confirm that you have received the bank transfer from{' '}
              <span className="font-medium text-gray-700">{selectedPayment.parent.name}</span>{' '}
              for{' '}
              <span className="font-medium text-gray-700">
                {(selectedPayment.amount + selectedPayment.escrowAmountApplied).toFixed(2)} EGP
              </span>.
              This will move {selectedPayment.paymentRegistrations.length} registration(s) to Confirmed.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Admin Notes (optional)
              </label>
              <textarea
                rows={3}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="e.g., Verified via bank statement ref #12345678"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {confirmError && (
              <p className="mb-4 text-sm text-red-600">{confirmError}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setSelectedPayment(null);
                  setConfirmError('');
                }}
                className="flex-1 py-2.5 border border-gray-300 text-sm font-medium rounded-xl text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  confirmMutation.mutate({
                    id: selectedPayment.id,
                    notes: adminNotes || undefined,
                  })
                }
                disabled={confirmMutation.isPending}
                className="flex-1 py-2.5 bg-green-600 text-white text-sm font-bold rounded-xl hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {confirmMutation.isPending ? 'Confirming...' : 'Yes, Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
