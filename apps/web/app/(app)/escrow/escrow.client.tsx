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
import { apiResponse, gradeLabel, WITHDRAWAL_STATUS_LABELS } from '@repo/validations';
import { Button } from '~/components/ui/button';

// ─── Reason Labels ────────────────────────────────────────────────────────────

const REASON_LABELS: Record<string, string> = {
  drop:           'Subject Drop Refund',
  swap_refund:    'Swap Refund',
  transfer_in:    'Transfer Received',
  transfer_out:   'Transfer Sent',
  withdrawal:     'Cash Withdrawal',
  payment:        'Payment Applied',
  payment_refund: 'Payment Refund',
  late_transfer:  'Transfer Found After Closing',
  late_transfer_undone: 'Transfer Recorded by Mistake — Removed',
  withdrawal_hold:     'Cash Refund Requested',
  withdrawal_rejected: 'Refund Request Declined — Returned',
  prereg_hold:    'Held for a Preregistered Subject',
  prereg_capture: 'Held Money Applied to Subject',
  prereg_release: 'Preregistration Cancelled — Hold Released',
};

const TRANSACTION_STYLES: Record<string, string> = {
  credit: 'text-emerald-600 dark:text-emerald-400',
  debit:  'text-destructive',
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Transaction = {
  id: string;
  type: string;
  amount: number;
  reason: string;
  createdAt: string;
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
  const { data: balance } = useQuery({
    queryKey: ['escrow', 'balance', activeStudentId ?? userId],
    queryFn: () =>
      apiResponse(
        api.v1.escrow.$get({
          query: activeStudentId ? { studentId: activeStudentId } : {},
        })
      ),
    enabled: !isParent || !!selectedChildId,
  });
  // The balance endpoint answers with a bare `{ balance: 0, message }` when a
  // parent has not selected a child yet, and with the full account otherwise
  // (a student without an escrow row still gets heldBalance: 0). Only the
  // full shape carries a held balance.
  const heldBalance = balance && 'heldBalance' in balance ? balance.heldBalance : 0;

  // Transaction history (auto-updates when child changes)
  const { data: transactions = [], isLoading: txLoading } = useQuery({
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
  const { data: children = [] } = useQuery({
    queryKey: ['escrow', 'children'],
    queryFn: () => apiResponse(api.v1.escrow.children.$get()),
    enabled: isParent,
  });

  // ─── Student View ───────────────────────────────────────────────────────────

  if (!isParent) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">My Escrow Balance</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Read-only view. Contact your parent to request withdrawals or transfers.
          </p>
        </div>

        {/* Balance card */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-6 mb-6">
          <p className="text-sm text-muted-foreground">Available Balance</p>
          <p className="text-4xl font-bold text-foreground mt-1 font-display">
            {(balance?.balance ?? 0).toFixed(2)}{' '}
            <span className="text-lg text-muted-foreground font-normal font-sans">EGP</span>
          </p>
          {heldBalance > 0 && (
            <p className="text-sm text-violet-700 dark:text-violet-400 mt-2">
              + {heldBalance.toFixed(2)} EGP held for preregistered subjects
              (auto-applied when their session opens)
            </p>
          )}
        </div>

        {/* Transaction history */}
        <TransactionList transactions={transactions} isLoading={txLoading} />
      </div>
    );
  }

  // ─── Parent View ─────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Escrow Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your children&apos;s escrow balances.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={"/escrow/transfer" as never}>
            <Button>Transfer Funds</Button>
          </Link>
          <Link href={"/escrow/withdraw" as never}>
            <Button variant="outline">Request Withdrawal</Button>
          </Link>
        </div>
      </div>

      {/* Children overview */}
      {children.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-8 text-center text-sm text-muted-foreground mb-6">
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
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">{child.name}</p>
                  {child.grade != null && (
                    <p className="text-xs text-muted-foreground mt-0.5">{gradeLabel(child.grade)}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-foreground font-display">
                    {child.escrowBalance.toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground">EGP</p>
                  {(child.heldBalance ?? 0) > 0 && (
                    <p className="text-xs text-violet-700 dark:text-violet-400 mt-0.5">
                      + {(child.heldBalance ?? 0).toFixed(2)} held
                    </p>
                  )}
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
            <h2 className="text-base font-semibold text-foreground font-display">
              Transaction History — {children.find((c) => c.id === selectedChildId)?.name}
            </h2>
            <div className="text-sm font-bold text-foreground">
              Balance: {(balance?.balance ?? 0).toFixed(2)} EGP
              {heldBalance > 0 && (
                <span className="text-violet-700 dark:text-violet-400"> · Held: {heldBalance.toFixed(2)} EGP</span>
              )}
            </div>
          </div>
          <TransactionList transactions={transactions} isLoading={txLoading} />
        </>
      ) : (
        <div className="bg-card rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
          Select a child above to view their transaction history.
        </div>
      )}

      {/* Withdrawal history link */}
      <div className="mt-6 text-center">
        <Link
          href={"/escrow/withdraw" as never}
          className="text-sm text-primary hover:underline"
        >
          View withdrawal request history
        </Link>
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
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
        No transactions yet.
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Transaction History</h3>
      </div>
      <div className="divide-y divide-border">
        {transactions.map((tx) => (
          <div key={tx.id} className="px-5 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                {REASON_LABELS[tx.reason] ?? tx.reason}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(tx.createdAt).toLocaleString()}
              </p>
            </div>
            <span className={`text-sm font-bold ${TRANSACTION_STYLES[tx.type] ?? 'text-foreground'}`}>
              {tx.type === 'credit' ? '+' : '-'} {tx.amount.toFixed(2)} EGP
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
