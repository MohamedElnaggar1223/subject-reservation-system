'use client';

/**
 * Escrow Client Component
 *
 * Unified escrow view for students (read-only) and parents (full control).
 *
 * Student view (ESC-001):
 * - Current escrow balance (prominently displayed)
 * - Full transaction history with reason labels
 * - No action buttons — enforced at both API and UI levels
 *
 * Parent view (ESC-002):
 * - Children overview: each child's balance as a card
 * - Child selector to drill into a specific child's transaction history
 * - Quick-action links to Transfer and Withdraw pages
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '~/lib/hono';
import { apiResponse, WITHDRAWAL_STATUS_LABELS } from '@repo/validations';

// ─── Reason Labels ────────────────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  drop:           'Subject Drop Refund',
  swap_refund:    'Swap Refund',
  transfer_in:    'Transfer Received',
  transfer_out:   'Transfer Sent',
  withdrawal:     'Cash Withdrawal',
  payment:        'Payment Applied',
  payment_refund: 'Payment Refund',
};

const TRANSACTION_STYLES: Record<string, string> = {
  credit: 'text-green-600',
  debit:  'text-red-600',
};

// ─── Types ────────────────────────────────────────────────────────────────────

type EscrowBalance = {
  studentId: string;
  balance: number;
  escrowId: string | null;
};

type Transaction = {
  id: string;
  type: string;
  amount: number;
  reason: string;
  createdAt: string;
};

type ChildBalance = {
  id: string;
  name: string;
  grade: number | null;
  escrowBalance: number;
};

interface EscrowClientProps {
  userRole: string | null;
  userId: string;
}

export default function EscrowClient({ userRole, userId }: EscrowClientProps) {
  const isParent = userRole === 'parent';
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  const activeStudentId = isParent ? (selectedChildId ?? null) : userId;

  // Fetch own balance (student) or current child's balance (parent)
  const { data: balance } = useQuery<EscrowBalance>({
    queryKey: ['escrow', 'balance', activeStudentId ?? userId],
    queryFn: () =>
      apiResponse(
        api.v1.escrow.$get({
          query: activeStudentId ? { studentId: activeStudentId } : {},
        })
      ),
    enabled: !isParent || !!selectedChildId,
  });

  // Transaction history (auto-updates when child changes)
  const { data: transactions = [], isLoading: txLoading } = useQuery<Transaction[]>({
    queryKey: ['escrow', 'transactions', activeStudentId ?? userId],
    queryFn: () =>
      apiResponse(
        api.v1.escrow.transactions.$get({
          query: activeStudentId ? { studentId: activeStudentId } : {},
        })
      ),
    enabled: !isParent || !!selectedChildId,
  });

  // Parent: all children's balances
  const { data: children = [] } = useQuery<ChildBalance[]>({
    queryKey: ['escrow', 'children'],
    queryFn: () => apiResponse(api.v1.escrow.children.$get()),
    enabled: isParent,
  });

  // ─── Student View ───────────────────────────────────────────────────────────

  if (!isParent) {
    return (
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-2xl mx-auto px-4">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900">My Escrow Balance</h1>
            <p className="text-sm text-gray-500 mt-1">
              Read-only view. Contact your parent to request withdrawals or transfers.
            </p>
          </div>

          {/* Balance card */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">
            <p className="text-sm text-gray-500">Available Balance</p>
            <p className="text-4xl font-bold text-gray-900 mt-1">
              {(balance?.balance ?? 0).toFixed(2)}{' '}
              <span className="text-lg text-gray-400 font-normal">EGP</span>
            </p>
          </div>

          {/* Transaction history */}
          <TransactionList transactions={transactions} isLoading={txLoading} />
        </div>
      </div>
    );
  }

  // ─── Parent View ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-3xl mx-auto px-4">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Escrow Management</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage your children&apos;s escrow balances.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/escrow/transfer"
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Transfer Funds
            </Link>
            <Link
              href="/escrow/withdraw"
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Request Withdrawal
            </Link>
          </div>
        </div>

        {/* Children overview */}
        {children.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-500 mb-6">
            No linked children found.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            {children.map((child) => (
              <button
                key={child.id}
                onClick={() => setSelectedChildId(
                  selectedChildId === child.id ? null : child.id
                )}
                className={`p-5 rounded-xl border-2 text-left transition-all ${
                  selectedChildId === child.id
                    ? 'border-indigo-600 bg-indigo-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{child.name}</p>
                    {child.grade && (
                      <p className="text-xs text-gray-500 mt-0.5">Grade {child.grade}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900">
                      {child.escrowBalance.toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-400">EGP</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Selected child's transaction history */}
        {selectedChildId ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-800">
                Transaction History — {children.find((c) => c.id === selectedChildId)?.name}
              </h2>
              <div className="text-sm font-bold text-gray-900">
                Balance: {(balance?.balance ?? 0).toFixed(2)} EGP
              </div>
            </div>
            <TransactionList transactions={transactions} isLoading={txLoading} />
          </>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-400">
            Select a child above to view their transaction history.
          </div>
        )}

        {/* Withdrawal history link */}
        <div className="mt-6 text-center">
          <Link
            href="/escrow/withdraw"
            className="text-sm text-indigo-600 hover:text-indigo-800 underline"
          >
            View withdrawal request history →
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Shared: Transaction List ─────────────────────────────────────────────────

function TransactionList({
  transactions,
  isLoading,
}: {
  transactions: Transaction[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-400">
        No transactions yet.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700">Transaction History</h3>
      </div>
      <div className="divide-y divide-gray-50">
        {transactions.map((tx) => (
          <div key={tx.id} className="px-5 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">
                {REASON_LABELS[tx.reason] ?? tx.reason}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date(tx.createdAt).toLocaleString()}
              </p>
            </div>
            <span className={`text-sm font-bold ${TRANSACTION_STYLES[tx.type] ?? 'text-gray-700'}`}>
              {tx.type === 'credit' ? '+' : '−'} {tx.amount.toFixed(2)} EGP
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
