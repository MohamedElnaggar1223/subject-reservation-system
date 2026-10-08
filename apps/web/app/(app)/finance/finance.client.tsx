'use client';

/**
 * Finance Workbench Client
 *
 * Design contract (V3_PLAN §1 "Beat Excel"): one search box, everything
 * pending for the matched student/reference, one click to resolve.
 *
 * Queues:
 * 1. Payments — in-school desk payments and InstaPay transfers awaiting
 *    verification (plus any legacy bank transfers). Confirming an
 *    in-school payment requires recording the instrument handed over.
 * 2. Cash refunds — escrow withdrawal requests to fulfill (partial or
 *    full) or reject with a reason.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '~/lib/hono';
import { invalidateFinancialState } from '~/lib/financial-cache';
import {
  apiResponse,
  gradeLabel,
  IN_SCHOOL_INSTRUMENTS,
  IN_SCHOOL_INSTRUMENT_LABELS,
  PAYMENT_METHOD_LABELS,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { ReasonModal } from '~/components/ui/reason-modal';

const fetchPendingManual = () => apiResponse(api.v1.payments['pending-manual'].$get());
type PendingPayment = Awaited<ReturnType<typeof fetchPendingManual>>[number];

const fetchWithdrawals = () => apiResponse(api.v1.escrow.admin.withdrawals.$get());
type WithdrawalRequest = Awaited<ReturnType<typeof fetchWithdrawals>>[number];

// Explicit type — this endpoint's RPC inference degrades in the web
// compile (same pre-existing quirk as checkout-summary)
type ReceiptRow = {
  id: string;
  receiptNumber: string;
  status: string;
  refundAmountOnReturn: number | null;
  // A line's receipt, or (the reservations rework, §3.10 item 2) a charge's.
  registration: {
    id: string;
    status: string;
    priceAtRegistration: number;
    student: { id: string; name: string; email: string; grade: number | null };
    subject: { id: string; name: string; code: string };
    session: { id: string; name: string };
  } | null;
  charge: { id: string; description: string; amount: number; student: { id: string; name: string; email: string } } | null;
};

/** Whose receipt, and for what: the line's student and subject, or the charge's student and description. */
function receiptOwner(r: ReceiptRow) {
  if (r.registration) {
    return { student: r.registration.student, what: `${r.registration.subject.name} (${r.registration.subject.code})`, where: r.registration.session.name };
  }
  return { student: r.charge?.student ?? { id: '', name: '—', email: '' }, what: r.charge?.description ?? '—', where: null };
}
const fetchReceipts = async () =>
  (await apiResponse(api.v1.receipts.queue.$get())) as ReceiptRow[];

const METHOD_BADGE: Record<string, string> = {
  in_school: 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400',
  instapay: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  bank_transfer: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

function matchesSearch(term: string, ...fields: (string | null | undefined)[]): boolean {
  if (!term) return true;
  const q = term.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(q));
}

export default function FinanceWorkbenchClient({ userRole }: { userRole: string }) {
  const isFinanceAdmin = userRole === 'finance_admin' || userRole === 'admin';
  const queryClient = useQueryClient();
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<PendingPayment | null>(null);
  const [instrument, setInstrument] = useState('');
  const [notes, setNotes] = useState('');
  const [actionError, setActionError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [lostTarget, setLostTarget] = useState<ReceiptRow | null>(null);
  const [rejectPaymentTarget, setRejectPaymentTarget] = useState<PendingPayment | null>(null);
  const [fulfillTarget, setFulfillTarget] = useState<WithdrawalRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<WithdrawalRequest | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [withdrawalNotes, setWithdrawalNotes] = useState('');

  const { data: payments = [], isLoading: paymentsLoading } = useQuery({
    queryKey: ['finance', 'pending-manual'],
    queryFn: fetchPendingManual,
    refetchInterval: 30_000,
  });

  const { data: withdrawals = [], isLoading: withdrawalsLoading } = useQuery({
    queryKey: ['finance', 'withdrawals'],
    queryFn: fetchWithdrawals,
    refetchInterval: 30_000,
  });

  const { data: receiptRows = [] } = useQuery({
    queryKey: ['finance', 'receipts'],
    queryFn: fetchReceipts,
    refetchInterval: 30_000,
  });

  const filteredPayments = useMemo(
    () =>
      payments.filter((p) =>
        matchesSearch(
          search,
          p.student.name,
          p.student.email,
          p.student.studentId,
          p.parent.name,
          p.parent.email,
          p.externalReference,
          p.verificationReference,
        )
      ),
    [payments, search]
  );

  const filteredReceipts = useMemo(
    () =>
      receiptRows.filter((r) =>
        matchesSearch(
          search,
          r.receiptNumber,
          receiptOwner(r).student.name,
          receiptOwner(r).student.email,
          receiptOwner(r).what,
        )
      ),
    [receiptRows, search]
  );

  const filteredWithdrawals = useMemo(
    () =>
      withdrawals.filter((w) =>
        matchesSearch(
          search,
          w.escrow.student?.name,
          w.escrow.student?.email,
          w.parent?.name,
          w.parent?.email,
        )
      ),
    [withdrawals, search]
  );

  const afterAction = (message: string, studentId?: string) => {
    setSuccessMsg(message);
    setActionError('');
    queryClient.invalidateQueries({ queryKey: ['finance'] });
    invalidateFinancialState(queryClient, { studentId });
    router.refresh();
  };

  const confirmMutation = useMutation({
    mutationFn: ({ id, instrumentUsed, confirmNotes }: { id: string; instrumentUsed?: string; confirmNotes?: string }) =>
      apiResponse(
        api.v1.payments[':id'].confirm.$post({
          param: { id },
          json: {
            instrumentUsed: instrumentUsed as (typeof IN_SCHOOL_INSTRUMENTS)[number] | undefined,
            notes: confirmNotes,
          },
        })
      ),
    onSuccess: () => {
      const student = confirmTarget?.student;
      setConfirmTarget(null);
      setInstrument('');
      setNotes('');
      afterAction(`Payment confirmed for ${student?.name ?? 'student'}. Registrations released.`, student?.id);
    },
    onError: (err: Error) => setActionError(err.message),
  });

  // Money audit MA-03: a reference that is not on the bank statement (or a
  // checkout the family abandoned) is rejected with a reason the family reads.
  const rejectPaymentMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiResponse(api.v1.payments[':id'].reject.$post({ param: { id }, json: { reason } })),
    onSuccess: (r) => {
      const student = rejectPaymentTarget?.student;
      setRejectPaymentTarget(null);
      afterAction(
        `Payment rejected for ${student?.name ?? 'student'}; the family has been told.` +
          (r.escrowReturned > 0 ? ` ${r.escrowReturned.toFixed(2)} EGP returned to escrow.` : '') +
          (r.registrationsExpired > 0 ? ' The window has closed, so the subjects are released.' : ''),
        student?.id
      );
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const fulfillMutation = useMutation({
    mutationFn: ({ id, releasedAmount, fulfillNotes }: { id: string; releasedAmount: number; fulfillNotes?: string }) =>
      apiResponse(
        api.v1.escrow.admin.withdrawals[':id'].fulfill.$post({
          param: { id },
          json: { releasedAmount, notes: fulfillNotes },
        })
      ),
    onSuccess: () => {
      const w = fulfillTarget;
      setFulfillTarget(null);
      setAmountInput('');
      setWithdrawalNotes('');
      afterAction(`Cash released to ${w?.parent?.name ?? 'parent'}.`, w?.escrow.studentId);
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, rejectNotes }: { id: string; rejectNotes: string }) =>
      apiResponse(
        api.v1.escrow.admin.withdrawals[':id'].reject.$post({
          param: { id },
          json: { notes: rejectNotes },
        })
      ),
    onSuccess: () => {
      const w = rejectTarget;
      setRejectTarget(null);
      setWithdrawalNotes('');
      afterAction('Withdrawal rejected — unreleased amount returned to escrow.', w?.escrow.studentId);
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const issueReceiptMutation = useMutation({
    mutationFn: (id: string) =>
      apiResponse(api.v1.receipts[':id'].issue.$post({ param: { id } })),
    onSuccess: () => afterAction('Receipt handed to parent.'),
    onError: (err: Error) => setActionError(err.message),
  });

  const returnReceiptMutation = useMutation({
    mutationFn: (id: string) =>
      apiResponse(api.v1.receipts[':id'].return.$post({ param: { id }, json: {} })),
    onSuccess: () => afterAction('Receipt returned — any pending drop refund has been released to escrow.'),
    onError: (err: Error) => setActionError(err.message),
  });

  const lostReceiptMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiResponse(api.v1.receipts[':id'].lost.$post({ param: { id }, json: { reason } })),
    onSuccess: () => {
      setLostTarget(null);
      afterAction('Receipt written off as lost — pending drop completed.');
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const approveWithdrawalMutation = useMutation({
    mutationFn: (id: string) =>
      apiResponse(api.v1.escrow.admin.withdrawals[':id'].approve.$post({ param: { id } })),
    // A partly paid request stays open after approval; each later hand-over
    // needs approving again (MA-17).
    onSuccess: (w) =>
      afterAction(
        w.status === 'fulfilled'
          ? 'Withdrawal approved and closed.'
          : w.status === 'rejected'
            ? 'Cash handed over is approved; the rest was declined, so the request is closed.'
            : 'Cash handed over so far is approved; the rest of the request is still open.'
      ),
    onError: (err: Error) => setActionError(err.message),
  });

  const loading = paymentsLoading || withdrawalsLoading;

  if (loading) {
    return (
      <div className="px-6 py-8 max-w-6xl mx-auto flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto animate-fade-up">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Finance Workbench</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everything waiting on the finance desk. Search a student, parent, or payment reference.
        </p>
      </div>

      {/* Search-first entry point */}
      <div className="mb-6">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by student, parent, email, or reference…"
          className="w-full max-w-xl px-4 py-2.5 text-sm border border-border bg-background rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          autoFocus
        />
      </div>

      {successMsg && (
        <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400 flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg('')} className="text-xs underline">Dismiss</button>
        </div>
      )}
      {actionError && !confirmTarget && !fulfillTarget && !rejectTarget && !rejectPaymentTarget && (
        <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* ── Payments queue ─────────────────────────────────────────────── */}
      <h2 className="text-lg font-semibold text-foreground mb-3">
        Payments to confirm{' '}
        <span className="text-sm font-normal text-muted-foreground">({filteredPayments.length})</span>
      </h2>

      {filteredPayments.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-8 text-center shadow-sm mb-8">
          <p className="text-sm text-muted-foreground">
            {search ? 'No pending payments match your search.' : 'No payments waiting. All caught up.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {filteredPayments.map((pay) => {
            const totalAmount = pay.amount + pay.escrowAmountApplied;
            const methodLabel =
              PAYMENT_METHOD_LABELS[pay.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] ?? pay.paymentMethod;
            const awaitingReference = pay.paymentMethod === 'instapay' && !pay.verificationReference;

            return (
              <div key={pay.id} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground">{pay.student.name}</p>
                      {pay.student.grade != null && (
                        <span className="px-2 py-0.5 bg-muted rounded text-xs">{gradeLabel(pay.student.grade)}</span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${METHOD_BADGE[pay.paymentMethod] ?? 'bg-muted'}`}>
                        {methodLabel}
                      </span>
                      {pay.status === 'pending_verification' && (
                        <span className="px-2 py-0.5 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 rounded text-xs font-medium">
                          Reference submitted
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Parent: {pay.parent.name} · {new Date(pay.createdAt).toLocaleString()}
                    </p>
                    <p className="text-xs mt-1">
                      {pay.paymentMethod === 'instapay' ? (
                        pay.verificationReference ? (
                          <span className="font-mono font-semibold text-primary">Ref: {pay.verificationReference}</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">Parent has not submitted a transfer reference yet</span>
                        )
                      ) : (
                        <span className="font-mono text-muted-foreground">{pay.externalReference ?? ''}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {[
                        ...pay.paymentRegistrations.map((pr) => `${pr.registration.subject.name} (${pr.registration.subject.code})`),
                        // A charge payment's charges (an instalment, a board service, an adjustment).
                        ...pay.paymentCharges.map((pc) => pc.charge.description),
                      ].join(' · ')}
                    </p>
                    {/* MO-10: what is due once the window has closed */}
                    {pay.status === 'pending' && pay.referenceDueAt && (
                      <p className="text-xs mt-1 text-amber-600 dark:text-amber-400">
                        Window closed — the family has until {new Date(pay.referenceDueAt).toLocaleString()} to submit the reference; then it lapses on its own.
                      </p>
                    )}
                    {(() => {
                      // F0b: each subject's own board series carries the deadline; the earliest one closes this payment.
                      const deadlines = pay.paymentRegistrations
                        .filter((pr) => pr.registration.session.status === 'closed' && pr.registration.boardSeries?.entryDeadline)
                        .map((pr) => pr.registration.boardSeries!.entryDeadline!)
                        .sort();
                      return deadlines[0] ? (
                        <p className="text-xs mt-1 text-amber-600 dark:text-amber-400">
                          Confirm or reject before the board deadline, {new Date(deadlines[0]).toLocaleDateString()} — after it this payment is closed automatically.
                        </p>
                      ) : null;
                    })()}
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-2">
                    <div>
                      <p className="text-lg font-bold text-foreground">{totalAmount.toFixed(2)} EGP</p>
                      {pay.escrowAmountApplied > 0 && (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400">
                          Incl. {pay.escrowAmountApplied.toFixed(2)} escrow
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRejectPaymentTarget(pay);
                          setActionError('');
                        }}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setConfirmTarget(pay);
                          setInstrument(pay.paymentMethod === 'in_school' ? '' : 'instapay');
                          setNotes('');
                          setActionError('');
                        }}
                        disabled={awaitingReference}
                        title={awaitingReference ? 'Waiting for the parent to submit their InstaPay reference' : undefined}
                      >
                        Confirm
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Receipts queue (V3 §6.5) ───────────────────────────────────── */}
      <h2 className="text-lg font-semibold text-foreground mb-3">
        Receipts{' '}
        <span className="text-sm font-normal text-muted-foreground">({filteredReceipts.length})</span>
      </h2>

      {filteredReceipts.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-8 text-center shadow-sm mb-8">
          <p className="text-sm text-muted-foreground">
            {search ? 'No receipts match your search.' : 'No receipts waiting for the desk.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {filteredReceipts.map((r) => (
            <div key={r.id} className="bg-card rounded-xl border border-border shadow-sm px-5 py-3.5 flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-foreground font-mono">{r.receiptNumber}</p>
                  {r.status === 'pending_issue' ? (
                    <span className="px-2 py-0.5 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400 rounded text-xs font-medium">
                      Hand to parent
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded text-xs font-medium">
                      Must be returned
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {receiptOwner(r).student.name} · {receiptOwner(r).what}{receiptOwner(r).where ? <> · {receiptOwner(r).where}</> : null}
                </p>
                {r.status === 'return_required' && r.refundAmountOnReturn != null && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                    Releases {r.refundAmountOnReturn.toFixed(2)} EGP to escrow on return
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {r.status === 'pending_issue' ? (
                  <Button size="sm" disabled={issueReceiptMutation.isPending} onClick={() => issueReceiptMutation.mutate(r.id)}>
                    Mark Handed Over
                  </Button>
                ) : (
                  <>
                    <Button size="sm" disabled={returnReceiptMutation.isPending} onClick={() => returnReceiptMutation.mutate(r.id)}>
                      Mark Returned
                    </Button>
                    {isFinanceAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={lostReceiptMutation.isPending}
                        onClick={() => setLostTarget(r)}
                      >
                        Lost
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Cash refunds queue ─────────────────────────────────────────── */}
      <h2 className="text-lg font-semibold text-foreground mb-3">
        Cash refunds to hand out{' '}
        <span className="text-sm font-normal text-muted-foreground">({filteredWithdrawals.length})</span>
      </h2>

      {filteredWithdrawals.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            {search ? 'No withdrawal requests match your search.' : 'No withdrawal requests waiting.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredWithdrawals.map((w) => {
            const released = w.releasedAmount ?? 0;
            const remaining = w.requestedAmount - released;
            return (
              <div key={w.id} className="bg-card rounded-xl border border-border shadow-sm px-5 py-3.5 flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground">{w.escrow.student?.name ?? 'Student'}</p>
                    {w.status === 'partially_fulfilled' && (
                      <span className="px-2 py-0.5 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded text-xs font-medium">
                        Partially released
                      </span>
                    )}
                    {w.status === 'fulfilled' && (
                      <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 rounded text-xs font-medium">
                        Cash released — approval pending
                      </span>
                    )}
                    {w.status === 'rejected' && (
                      <span className="px-2 py-0.5 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded text-xs font-medium">
                        Rest declined — cash released needs approval
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Parent: {w.parent?.name ?? '—'} · Requested {new Date(w.createdAt).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Requested {w.requestedAmount.toFixed(2)} EGP
                    {released > 0 && ` · Released ${released.toFixed(2)} EGP`}
                    {w.status !== 'rejected' && ` · Remaining ${remaining.toFixed(2)} EGP`}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {(w.status === 'pending' || w.status === 'partially_fulfilled') && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => {
                          setFulfillTarget(w);
                          setAmountInput(remaining.toFixed(2));
                          setWithdrawalNotes('');
                          setActionError('');
                        }}
                      >
                        Release Cash
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRejectTarget(w);
                          setWithdrawalNotes('');
                          setActionError('');
                        }}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  {(w.status === 'fulfilled' || w.status === 'partially_fulfilled' || (w.status === 'rejected' && (w.releasedAmount ?? 0) > 0)) && !w.approvedBy && (
                    isFinanceAdmin ? (
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        disabled={approveWithdrawalMutation.isPending}
                        onClick={() => approveWithdrawalMutation.mutate(w.id)}
                      >
                        Approve
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground self-center">Awaiting finance-admin approval</span>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {lostTarget && (
        <ReasonModal
          title="Write this receipt off as lost?"
          description={`Receipt ${lostTarget.receiptNumber} — ${receiptOwner(lostTarget).what} for ${receiptOwner(lostTarget).student.name}. The family cannot produce the paper, so the school accepts the loss: any pending drop completes and its refund is released${lostTarget.refundAmountOnReturn != null ? ` (${lostTarget.refundAmountOnReturn.toFixed(2)} EGP)` : ''}. Recorded in the audit trail.`}
          label="Reason"
          placeholder="e.g. Parent confirms the receipt was lost in a move"
          confirmLabel="Mark Lost"
          destructive
          isPending={lostReceiptMutation.isPending}
          onConfirm={(reason) => lostReceiptMutation.mutate({ id: lostTarget.id, reason })}
          onClose={() => setLostTarget(null)}
        />
      )}

      {rejectPaymentTarget && (
        <ReasonModal
          title="Reject this payment?"
          description={`${rejectPaymentTarget.paymentMethod === 'instapay' && !rejectPaymentTarget.verificationReference ? `The parent has not submitted a transfer reference yet and may be transferring right now — reject only a checkout they abandoned (started ${new Date(rejectPaymentTarget.createdAt).toLocaleString()}). ` : ''}${rejectPaymentTarget.student.name} — ${(rejectPaymentTarget.amount + rejectPaymentTarget.escrowAmountApplied).toFixed(2)} EGP by ${PAYMENT_METHOD_LABELS[rejectPaymentTarget.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] ?? rejectPaymentTarget.paymentMethod}${rejectPaymentTarget.verificationReference ? `, reference ${rejectPaymentTarget.verificationReference}` : ''}. The payment is marked not received${rejectPaymentTarget.escrowAmountApplied > 0 ? ` and the ${rejectPaymentTarget.escrowAmountApplied.toFixed(2)} EGP applied from escrow goes back` : ''}. The subjects stay open to pay while the window is open, and are released if it has closed. The family receives your reason.`}
          label="Reason (sent to the family)"
          placeholder="e.g. No transfer with this reference on the bank statement"
          confirmLabel="Reject Payment"
          destructive
          minLength={5}
          isPending={rejectPaymentMutation.isPending}
          error={actionError}
          onConfirm={(reason) => rejectPaymentMutation.mutate({ id: rejectPaymentTarget.id, reason })}
          onClose={() => {
            setRejectPaymentTarget(null);
            setActionError('');
          }}
        />
      )}

      {/* ── Confirm payment modal ──────────────────────────────────────── */}
      {confirmTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-xl shadow-xl border border-border max-w-md w-full p-6">
            <h2 className="text-lg font-bold text-foreground font-display mb-1">Confirm Payment</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {confirmTarget.paymentMethod === 'instapay' ? (
                <>
                  Confirm the InstaPay transfer of{' '}
                  <span className="font-medium text-foreground">{confirmTarget.amount.toFixed(2)} EGP</span>{' '}
                  (ref{' '}
                  <span className="font-mono font-medium text-foreground">
                    {confirmTarget.verificationReference}
                  </span>
                  ) is visible in the school bank account.
                </>
              ) : (
                <>
                  Confirm you received{' '}
                  <span className="font-medium text-foreground">{confirmTarget.amount.toFixed(2)} EGP</span>{' '}
                  from <span className="font-medium text-foreground">{confirmTarget.parent.name}</span> at the desk.
                </>
              )}{' '}
              This releases {confirmTarget.paymentRegistrations.length} registration(s).
            </p>

            {confirmTarget.paymentMethod === 'in_school' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-foreground mb-2">How did they pay?</label>
                <div className="grid grid-cols-2 gap-2">
                  {IN_SCHOOL_INSTRUMENTS.map((inst) => (
                    <button
                      key={inst}
                      type="button"
                      onClick={() => setInstrument(inst)}
                      className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                        instrument === inst
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'border-border bg-background text-foreground hover:bg-muted'
                      }`}
                    >
                      {IN_SCHOOL_INSTRUMENT_LABELS[inst]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-1">Notes (optional)</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., Verified on bank statement"
                className="w-full px-3 py-2 text-sm border border-border bg-background rounded-lg resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {actionError && <p className="mb-4 text-sm text-destructive">{actionError}</p>}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setConfirmTarget(null); setActionError(''); }}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                disabled={
                  confirmMutation.isPending ||
                  (confirmTarget.paymentMethod === 'in_school' && !instrument)
                }
                onClick={() =>
                  confirmMutation.mutate({
                    id: confirmTarget.id,
                    instrumentUsed: instrument || undefined,
                    confirmNotes: notes || undefined,
                  })
                }
              >
                {confirmMutation.isPending ? 'Confirming…' : 'Confirm Payment'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Fulfill withdrawal modal ───────────────────────────────────── */}
      {fulfillTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-xl shadow-xl border border-border max-w-md w-full p-6">
            <h2 className="text-lg font-bold text-foreground font-display mb-1">Release Cash</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Hand the cash to <span className="font-medium text-foreground">{fulfillTarget.parent?.name ?? 'the parent'}</span>{' '}
              at the desk, then record the released amount. Partial amounts are allowed.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-1">Amount released (EGP)</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border bg-background rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-1">Notes (optional)</label>
              <textarea
                rows={2}
                value={withdrawalNotes}
                onChange={(e) => setWithdrawalNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border bg-background rounded-lg resize-none text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {actionError && <p className="mb-4 text-sm text-destructive">{actionError}</p>}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setFulfillTarget(null); setActionError(''); }}>
                Cancel
              </Button>
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                disabled={fulfillMutation.isPending || !(parseFloat(amountInput) > 0)}
                onClick={() =>
                  fulfillMutation.mutate({
                    id: fulfillTarget.id,
                    releasedAmount: parseFloat(amountInput),
                    fulfillNotes: withdrawalNotes || undefined,
                  })
                }
              >
                {fulfillMutation.isPending ? 'Recording…' : 'Record Release'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject withdrawal modal ────────────────────────────────────── */}
      {rejectTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-xl shadow-xl border border-border max-w-md w-full p-6">
            <h2 className="text-lg font-bold text-foreground font-display mb-1">Reject Withdrawal</h2>
            <p className="text-sm text-muted-foreground mb-4">
              The unreleased held amount will be returned to the student&apos;s escrow. A reason is required.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-1">Reason</label>
              <textarea
                rows={2}
                value={withdrawalNotes}
                onChange={(e) => setWithdrawalNotes(e.target.value)}
                placeholder="Why is this request being rejected?"
                className="w-full px-3 py-2 text-sm border border-border bg-background rounded-lg resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {actionError && <p className="mb-4 text-sm text-destructive">{actionError}</p>}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setRejectTarget(null); setActionError(''); }}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={rejectMutation.isPending || !withdrawalNotes.trim()}
                onClick={() =>
                  rejectMutation.mutate({ id: rejectTarget.id, rejectNotes: withdrawalNotes.trim() })
                }
              >
                {rejectMutation.isPending ? 'Rejecting…' : 'Reject Request'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
