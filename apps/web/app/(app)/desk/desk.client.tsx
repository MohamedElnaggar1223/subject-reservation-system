'use client';

/**
 * The Desk Client (UX_AUDIT G1/G2/G5)
 *
 * The staff answer to the Excel sheet: search a student → see
 * everything → act. Onboard a walk-in family, register subjects and
 * take the money in one motion, collect the school fee, hand over /
 * take back / print receipts.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse,
  gradeLabel,
  REGISTRATION_STATUS_LABELS,
  RECEIPT_STATUS_LABELS,
  IN_SCHOOL_INSTRUMENTS,
  IN_SCHOOL_INSTRUMENT_LABELS,
  EXCEPTION_TYPE_LABELS,
} from '@repo/validations';
import { formatPrice } from '~/lib/format';
import { Button } from '~/components/ui/button';
import { ReasonModal } from '~/components/ui/reason-modal';
import { Badge, StandingBadge } from '~/components/ui/tone';
import { StudentAcademicPanel } from '~/components/student-academic-panel';
import { StudentLeaveCard } from '~/components/student-leave-card';

// ─── Types, derived from their fetchers (CLAUDE.md: Hono RPC everywhere) ──────

const fetchHits = (search: string) =>
  apiResponse(api.v1.users.search.$get({ query: { role: 'student', search: search || undefined } }));
const fetchSummary = (id: string) => apiResponse(api.v1.users[':id'].summary.$get({ param: { id } }));
type Summary = Awaited<ReturnType<typeof fetchSummary>>;

type SessionRow = { id: string; name: string; status: string; qualificationLevel: string };
type AvailableSubject = {
  id: string; name: string; code: string; isCore: boolean; isRetake: boolean;
  teachers: { id: string; name: string }[];
  pricing: { total: number; isOutsideSchool: boolean };
  outsidePricing: { total: number } | null;
};

/** True when `a` falls in a calendar month before `b`'s (the takings' month rule, MO-11). */
function isEarlierMonth(a: Date, b: Date): boolean {
  return a.getFullYear() * 12 + a.getMonth() < b.getFullYear() * 12 + b.getMonth();
}

/**
 * F0b: money is taken per exam series with its own entry deadline — one
 * payment each, so the officer sees each, and any the close took before it
 * could be confirmed (that money goes back to the family).
 */
function paymentsLine(res: { payments: { series: string[]; collected: number }[]; notCollected: { series: string[]; amount: number; reason: string }[] }) {
  const parts: string[] = [];
  if (res.payments.length > 1) {
    parts.push(` In ${res.payments.length} payments, one per exam series: ${res.payments.map((p) => `${p.series.join(' and ')} ${formatPrice(p.collected)}`).join('; ')}.`);
  }
  if (res.notCollected.length) {
    parts.push(` Not collected — hand this money back: ${res.notCollected.map((n) => `${n.series.join(' and ')} ${formatPrice(n.amount)} (${n.reason})`).join('; ')}.`);
  }
  return parts.join('');
}

export default function DeskClient({ userRole }: { userRole: string }): React.JSX.Element {
  const isFinanceAdmin = userRole === 'finance_admin' || userRole === 'admin';
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState<string | null>(null);
  const [showOnboard, setShowOnboard] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [reverseTarget, setReverseTarget] = useState<{ id: string; label: string; confirmedAt: string | null } | null>(null);
  const [undoTransferTarget, setUndoTransferTarget] = useState<{ id: string; label: string } | null>(null);
  const [transferTarget, setTransferTarget] = useState<{ id: string; label: string; amount: number; reference: string | null } | null>(null);

  // ── Search ────────────────────────────────────────────────────────────────
  const { data: hits = [], isError: searchFailed, isFetching: searching } = useQuery({
    queryKey: ['users', 'search', 'desk', search],
    queryFn: () => fetchHits(search),
    enabled: search.trim().length >= 2 && !studentId,
    retry: false,
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  const { data: summary, isFetching: loadingSummary } = useQuery({
    queryKey: ['desk', 'summary', studentId],
    queryFn: () => fetchSummary(studentId!),
    enabled: !!studentId,
  });
  const [showAcademic, setShowAcademic] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['desk'] });
    qc.invalidateQueries({ queryKey: ['finance'] });
  };
  const done = (msg: string) => { setMessage(msg); setErrorMsg(''); refresh(); };
  const fail = (err: Error) => { setErrorMsg(err.message); setMessage(''); };

  // ── Desk actions ──────────────────────────────────────────────────────────
  const collectFeeMutation = useMutation({
    mutationFn: (instrumentUsed: 'cash' | 'card' | 'instapay' | 'other') =>
      apiResponse(
        api.v1['school-fees']['desk-pay'].$post({
          json: { studentId: studentId!, instrumentUsed },
        })
      ),
    onSuccess: (d) => done(`School fee collected (${formatPrice((d as unknown as { amount: number }).amount)}). Registration unlocked.`),
    onError: fail,
  });

  const collectMutation = useMutation({
    mutationFn: (v: { registrationIds: string[]; instrumentUsed: (typeof IN_SCHOOL_INSTRUMENTS)[number] }) =>
      apiResponse(api.v1.registrations.desk.collect.$post({ json: { studentId: studentId!, ...v, escrowAmountToApply: 0 } })),
    onSuccess: (d) =>
      done(
        `Collected ${formatPrice(d.collected)}. Receipts ready to hand over${d.receipts.length ? `: ${d.receipts.map((r) => r.receiptNumber).join(', ')}` : ''}.${paymentsLine(d)}`
      ),
    onError: fail,
  });

  const issueReceiptMutation = useMutation({
    mutationFn: (id: string) => apiResponse(api.v1.receipts[':id'].issue.$post({ param: { id } })),
    onSuccess: () => done('Receipt marked as handed to the parent.'),
    onError: fail,
  });

  const returnReceiptMutation = useMutation({
    mutationFn: (id: string) => apiResponse(api.v1.receipts[':id'].return.$post({ param: { id }, json: {} })),
    onSuccess: () => done('Receipt returned — any pending drop refund is released.'),
    onError: fail,
  });

  // A transfer found on the bank statement after its payment had closed goes to escrow.
  const transferMutation = useMutation({
    mutationFn: ({ id, notes, reference, amount }: { id: string; notes: string; reference: string; amount: number }) =>
      apiResponse(api.v1.payments[':id']['record-transfer'].$post({ param: { id }, json: { notes, reference, amount } })),
    onSuccess: (d) => {
      setTransferTarget(null);
      done(`Transfer ${d.reference} recorded — ${formatPrice(d.creditedToEscrow)} added to the student's escrow. The family has been told.`);
    },
    onError: fail,
  });

  // Same day only, while the escrow it added is unspent (MO-24).
  const undoTransferMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiResponse(api.v1.payments[':id']['undo-transfer'].$post({ param: { id }, json: { reason } })),
    onSuccess: (d) => {
      setUndoTransferTarget(null);
      done(`Transfer undone — ${formatPrice(d.debitedFromEscrow)} taken back from the student's escrow. The payment can be recorded again.`);
    },
    onError: fail,
  });

  const reverseMutation = useMutation({
    mutationFn: ({ id, reason, moneyReturned }: { id: string; reason: string; moneyReturned: boolean }) =>
      apiResponse(api.v1.payments[':id'].reverse.$post({ param: { id }, json: { reason, moneyReturned } })),
    onSuccess: (_d, v) => {
      setReverseTarget(null);
      done(
        v.moneyReturned
          ? 'Payment reversed — registrations back to pending payment, receipts voided. The money returned counts as money out today.'
          : 'Payment reversed — registrations back to pending payment, receipts voided. Recorded as a correction to the day it was confirmed; today’s drawer is unchanged.'
      );
    },
    onError: fail,
  });

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto animate-fade-up">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">The Desk</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Find a student — see everything, do everything, in one place.
          </p>
        </div>
        <Button variant="outline" onClick={() => { setShowOnboard((v) => !v); }}>
          {showOnboard ? 'Close Onboarding' : '+ New Family (Onboard)'}
        </Button>
      </div>

      {message && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400 flex justify-between">
          <span>{message}</span>
          <button className="text-xs underline" onClick={() => setMessage('')}>Dismiss</button>
        </div>
      )}
      {errorMsg && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive flex justify-between">
          <span>{errorMsg}</span>
          <button className="text-xs underline" onClick={() => setErrorMsg('')}>Dismiss</button>
        </div>
      )}

      {showOnboard && <OnboardCard onDone={(msg) => { setShowOnboard(false); done(msg); }} onError={fail} />}

      {/* Search */}
      <div className="mb-6">
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setStudentId(null); }}
          placeholder="Type a student's name, email, or ID…"
          className="w-full max-w-xl px-4 py-2.5 text-sm border border-border bg-background rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          autoFocus
        />
        {!studentId && search.trim().length >= 2 && searchFailed && (
          <p className="mt-2 max-w-xl text-sm text-destructive">
            Could not search right now. Check your connection and try again.
          </p>
        )}
        {!studentId && search.trim().length >= 2 && !searching && !searchFailed && hits.length === 0 && (
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            No student matches &ldquo;{search}&rdquo;. If they are new, use{' '}
            <button
              type="button"
              className="underline hover:no-underline"
              onClick={() => setShowOnboard(true)}
            >
              New Family (Onboard)
            </button>{' '}
            to create their accounts.
          </p>
        )}
        {!studentId && hits.length > 0 && (
          <div className="mt-2 max-w-xl bg-card border border-border rounded-xl shadow-sm divide-y divide-border overflow-hidden">
            {hits.slice(0, 8).map((h) => (
              <button
                key={h.id}
                onClick={() => { setStudentId(h.id); setMessage(''); setErrorMsg(''); }}
                className="w-full text-left px-4 py-2.5 hover:bg-muted transition-colors"
              >
                <span className="font-medium text-foreground text-sm">{h.name}</span>
                <span className="text-xs text-muted-foreground ms-2">
                  {gradeLabel(h.grade)} · {h.email}
                  {h.studentId && <> · <span className="font-mono">{h.studentId}</span></>}
                </span>
                {h.leftKind && <Badge tone="danger" className="ms-2">{h.leftKind === 'transferred' ? 'Transferred' : 'Withdrawn'}</Badge>}
              </button>
            ))}
          </div>
        )}
      </div>

      {studentId && loadingSummary && (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        </div>
      )}

      {summary && (
        <div className="space-y-6">
          {/* Header card */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-lg font-bold text-foreground font-display">
                  {summary.student.name}
                  <span className="text-sm font-normal text-muted-foreground ms-2">
                    {summary.academic.gradeLabel}
                    {summary.academic.section && <> · <span>{summary.academic.section.name}</span></>}
                    {summary.student.studentId && <> · <span className="font-mono">{summary.student.studentId}</span></>}
                  </span>
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <StandingBadge standing={summary.academic.standing} />
                  {summary.academic.cohortLabel && (
                    <span className="text-xs text-muted-foreground">
                      <span>Started grade 10 in</span> <span>{summary.academic.cohortLabel}</span>
                    </span>
                  )}
                  <button type="button" className="text-xs text-primary underline hover:no-underline" onClick={() => setShowAcademic((v) => !v)}>
                    {showAcademic ? 'Hide academic record' : 'Academic record'}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Parents:{' '}
                  {summary.parents.length === 0
                    ? 'none linked — onboard the family above'
                    : summary.parents.map((p) => `${p.name}${p.phone ? ` (${p.phone})` : ''}`).join(' · ')}
                </p>
              </div>
              <div className="flex gap-6 text-right">
                <div>
                  <p className="text-xs text-muted-foreground">Owes now</p>
                  <p className={`text-lg font-bold ${summary.owing > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                    {formatPrice(summary.owing)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Escrow</p>
                  <p className="text-lg font-bold text-foreground">{formatPrice(summary.escrow.freeBalance)}</p>
                  {summary.escrow.heldBalance > 0 && (
                    <p className="text-xs text-violet-700 dark:text-violet-400">+{formatPrice(summary.escrow.heldBalance)} held</p>
                  )}
                </div>
              </div>
            </div>

            {/* The academic record (F0a): grade, cohort, section, status and the
                actions the viewer's role allows — the same panel as /students. */}
            {showAcademic && (
              <div className="mt-4 border-t border-border pt-4">
                <StudentAcademicPanel studentId={summary.student.id} viewerRole={userRole} />
              </div>
            )}

            {/* School fee state + actions */}
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              {summary.schoolFee.required && !summary.schoolFee.paid ? (
                <>
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    {summary.schoolFee.academicYear} school fee due
                    {summary.schoolFee.amount != null && <> — {formatPrice(summary.schoolFee.amount)}</>}
                  </span>
                  {IN_SCHOOL_INSTRUMENTS.slice(0, 3).map((inst) => (
                    <Button
                      key={inst}
                      size="sm"
                      variant="outline"
                      disabled={collectFeeMutation.isPending}
                      onClick={() => collectFeeMutation.mutate(inst)}
                    >
                      Collect fee — {IN_SCHOOL_INSTRUMENT_LABELS[inst]}
                    </Button>
                  ))}
                </>
              ) : summary.schoolFee.required ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                  {summary.schoolFee.academicYear} school fee paid
                </span>
              ) : summary.schoolFee.waived ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                  {summary.schoolFee.academicYear} school fee waived — nothing to collect
                </span>
              ) : null}
              <Button size="sm" onClick={() => setShowRegister((v) => !v)}>
                {showRegister ? 'Close Registration' : '+ Register Subjects'}
              </Button>
            </div>

            {summary.exceptions.length > 0 && (
              <p className="mt-3 text-xs text-violet-700 dark:text-violet-400">
                Active exceptions:{' '}
                {summary.exceptions
                  .map((e) => EXCEPTION_TYPE_LABELS[e.type as keyof typeof EXCEPTION_TYPE_LABELS] ?? e.type)
                  .join(', ')}
              </p>
            )}
          </div>

          {showRegister && (
            <DeskRegisterCard
              studentId={summary.student.id}
              onDone={(msg) => { setShowRegister(false); done(msg); }}
              onError={fail}
            />
          )}

          {/* F2: campus leave for this student — what is coming up, and a request for the family made here. */}
          <StudentLeaveCard studentId={summary.student.id} viewerRole={userRole} />

          {/* Subjects registered and waiting for payment (MA-18): after a
              reversal, a rejected transfer, a cancelled checkout or a
              register-only visit, the money is taken here in one click. */}
          {(() => {
            const unpaid = summary.registrations.filter((r) => r.status === 'pending_payment');
            if (unpaid.length === 0) return null;
            const total = unpaid.reduce((s, r) => s + r.priceAtRegistration, 0);
            return (
              <div className="bg-card rounded-xl border border-border shadow-sm px-5 py-3.5 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {unpaid.length} subject{unpaid.length === 1 ? '' : 's'} waiting for payment — {formatPrice(total)}
                  </p>
                  <p className="text-xs text-muted-foreground">{unpaid.map((r) => r.subject.name).join(' · ')}</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {IN_SCHOOL_INSTRUMENTS.slice(0, 3).map((inst) => (
                    <Button
                      key={inst}
                      size="sm"
                      variant="outline"
                      disabled={collectMutation.isPending}
                      onClick={() => collectMutation.mutate({ registrationIds: unpaid.map((r) => r.id), instrumentUsed: inst })}
                    >
                      Collect — {IN_SCHOOL_INSTRUMENT_LABELS[inst]}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Registrations with receipts */}
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground font-display">Registrations</h3>
            </div>
            {summary.registrations.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No registrations yet.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <tbody className="divide-y divide-border">
                  {summary.registrations.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-2.5">
                        <div className="font-medium text-foreground">
                          {r.subject.name}
                          <span className="text-xs text-muted-foreground font-mono ml-1">{r.subject.code}</span>
                          {r.takenOutsideSchool && <span className="text-xs text-muted-foreground ml-1">(outside)</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {r.session.name}
                          {r.teacher && <> · {r.teacher.name}</>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {REGISTRATION_STATUS_LABELS[r.status as keyof typeof REGISTRATION_STATUS_LABELS] ?? r.status}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-foreground whitespace-nowrap">
                        {formatPrice(r.priceAtRegistration)}
                      </td>
                      <td className="px-5 py-2.5 text-right whitespace-nowrap">
                        {r.receipt ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {RECEIPT_STATUS_LABELS[r.receipt.status as keyof typeof RECEIPT_STATUS_LABELS] ?? r.receipt.status}
                            </span>
                            {r.receipt.status === 'pending_issue' && (
                              <Button size="sm" variant="outline" disabled={issueReceiptMutation.isPending}
                                onClick={() => issueReceiptMutation.mutate(r.receipt!.id)}>
                                Hand Over
                              </Button>
                            )}
                            {r.receipt.status === 'return_required' && (
                              <Button size="sm" variant="outline" disabled={returnReceiptMutation.isPending}
                                onClick={() => returnReceiptMutation.mutate(r.receipt!.id)}>
                                Take Back
                              </Button>
                            )}
                            <a
                              href={`/receipt-print/${r.receipt.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary underline"
                            >
                              Print
                            </a>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>

          {/* Recent payments */}
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground font-display">Recent payments</h3>
            </div>
            {summary.payments.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No payments yet.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <tbody className="divide-y divide-border">
                  {summary.payments.slice(0, 10).map((p) => (
                    <tr key={p.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-card-foreground capitalize">
                        {p.purpose.replace('_', ' ')}
                        {p.instrumentUsed && <> · {p.instrumentUsed}</>}
                        {p.externalReference && <span className="font-mono text-muted-foreground"> · {p.externalReference}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-xs capitalize">{p.status.replace('_', ' ')}</td>
                      <td className="px-5 py-2.5 text-right font-medium text-foreground whitespace-nowrap">
                        {formatPrice(p.amount + p.escrowAmountApplied)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {isFinanceAdmin && p.status === 'completed' &&
                          (p.purpose === 'registration' || p.purpose === 'school_fee') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-800 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                            disabled={reverseMutation.isPending}
                            onClick={() =>
                              setReverseTarget({
                                id: p.id,
                                label: `${formatPrice(p.amount + p.escrowAmountApplied)} · ${p.purpose.replace('_', ' ')}`,
                                confirmedAt: p.confirmedAt,
                              })
                            }
                          >
                            Reverse
                          </Button>
                        )}
                        {/* A closed InstaPay payment whose transfer turns up on the statement later (finance admin: nothing undoes it) */}
                        {isFinanceAdmin && p.status === 'failed' && p.paymentMethod === 'instapay' && p.amount > 0 && !p.lateTransferAt && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={transferMutation.isPending}
                            onClick={() =>
                              setTransferTarget({
                                id: p.id,
                                label: `${formatPrice(p.amount)} by InstaPay`,
                                amount: p.amount,
                                reference: p.verificationReference,
                              })
                            }
                          >
                            Transfer found
                          </Button>
                        )}
                        {p.lateTransferAt && (
                          <span className="text-xs text-muted-foreground">Transfer found — credited to escrow</span>
                        )}
                        {isFinanceAdmin && p.lateTransferAt && new Date(p.lateTransferAt).toDateString() === new Date().toDateString() && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={undoTransferMutation.isPending}
                            onClick={() => setUndoTransferTarget({ id: p.id, label: `The transfer recorded today against ${formatPrice(p.amount)} by InstaPay` })}
                          >
                            Undo
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </div>
      )}

      {reverseTarget && (
        <ReasonModal
          title="Reverse this payment?"
          description={`${reverseTarget.label}. The registrations go back to pending payment and their receipts are voided — only possible while the paper has not left the desk. This is recorded in the audit trail.`}
          label="Reason for the reversal"
          placeholder="e.g. Wrong student — money returned to the parent"
          confirmLabel="Reverse Payment"
          destructive
          isPending={reverseMutation.isPending}
          // Owner decision MO-11: the day's takings depend on the answer.
          choice={{
            legend: 'Was the money returned to the family?',
            options: [
              { value: 'returned', label: 'Yes — the money was given back', hint: 'Cash handed back, card refunded or transfer returned. Counts as money out today.' },
              {
                value: 'never',
                label: 'No — it was never received',
                // A closed month stays as printed; its correction is posted today (MO-11, 28 Sep).
                hint: reverseTarget.confirmedAt && isEarlierMonth(new Date(reverseTarget.confirmedAt), new Date())
                  ? `The confirmation was a mistake. It was confirmed in ${new Date(reverseTarget.confirmedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}, a month already closed: that month stays as printed and the correction appears on today’s report. Today’s drawer does not move.`
                  : `The confirmation was a mistake. It corrects the takings of the day it was confirmed${reverseTarget.confirmedAt ? ` (${new Date(reverseTarget.confirmedAt).toLocaleDateString()})` : ''}, even if that day was already reconciled; today’s drawer does not move.`,
              },
            ],
          }}
          onConfirm={(reason, choice) => reverseMutation.mutate({ id: reverseTarget.id, reason, moneyReturned: choice === 'returned' })}
          onClose={() => setReverseTarget(null)}
        />
      )}

      {undoTransferTarget && (
        <ReasonModal
          title="Undo this transfer found later?"
          description={`${undoTransferTarget.label}. Its amount is taken back from the student's escrow and it leaves today's takings; the payment can then be recorded again. Possible only today, and only while that escrow is unspent.`}
          label="Why it was recorded by mistake"
          placeholder="e.g. Wrong family — the transfer belongs to another student"
          confirmLabel="Undo Transfer"
          destructive
          minLength={5}
          isPending={undoTransferMutation.isPending}
          onConfirm={(reason) => undoTransferMutation.mutate({ id: undoTransferTarget.id, reason })}
          onClose={() => setUndoTransferTarget(null)}
        />
      )}

      {transferTarget && (
        <ReasonModal
          title="Record a transfer found later?"
          description={`${transferTarget.label}${transferTarget.reference ? ` (the family gave reference ${transferTarget.reference})` : ''}. The payment had already closed, so its subjects stay as they are; the amount that arrived is added to the student's escrow, to use on a later payment or take back as cash. This cannot be undone. Recorded in the audit trail and in today's takings.`}
          label="Where it was found"
          placeholder="e.g. On the 28 Sep bank statement, sent 27 Sep"
          confirmLabel="Add to Escrow"
          minLength={5}
          isPending={transferMutation.isPending}
          // Both from the statement: the family's reference may be the one that was not found.
          fields={[
            { label: 'Transfer reference on the bank statement', placeholder: 'e.g. FT-2026-000123', minLength: 4, mono: true },
            // Left empty: read off the statement, never assumed to be the amount due.
            { label: `Amount on the bank statement (EGP, at most ${formatPrice(transferTarget.amount)})`, placeholder: 'As printed on the statement', inputMode: 'decimal', minLength: 1 },
          ]}
          onConfirm={(notes, _choice, values) =>
            transferMutation.mutate({ id: transferTarget.id, notes, reference: values?.[0] ?? '', amount: Number((values?.[1] ?? '').replace(/[,\s]/g, '')) })
          }
          onClose={() => setTransferTarget(null)}
        />
      )}
    </div>
  );
}

// ─── Onboard a walk-in family (G5) ───────────────────────────────────────────

function OnboardCard({ onDone, onError }: { onDone: (msg: string) => void; onError: (e: Error) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    parentName: '', parentEmail: '', parentPassword: '', parentPhone: '',
    studentName: '', studentEmail: '', studentPassword: '', studentGrade: '' as '' | '9' | '10' | '11' | '12',
  });
  const [localError, setLocalError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.links['desk-onboard'].$post({
          json: {
            parent: {
              email: form.parentEmail.trim(),
              name: form.parentName.trim() || undefined,
              password: form.parentPassword || undefined,
              phone: form.parentPhone.trim() || undefined,
            },
            student: {
              email: form.studentEmail.trim(),
              name: form.studentName.trim() || undefined,
              password: form.studentPassword || undefined,
              // The grade this academic year; the API stores the cohort (F0a).
              grade: form.studentGrade ? (Number(form.studentGrade) as 9 | 10 | 11 | 12) : undefined,
            },
          },
        })
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      onDone('Family onboarded — accounts ready and linked. Share the temporary passwords with them.');
    },
    onError: (err: Error) => { setLocalError(err.message); onError(err); },
  });

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-5 mb-6">
      <h3 className="text-sm font-semibold text-foreground font-display mb-1">Onboard a walk-in family</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Enter emails. Existing accounts are reused; new ones need a name and temporary password.
        The link is approved on the spot — you&apos;re vouching for them in person.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Parent</p>
          <input type="email" placeholder="Parent email *" value={form.parentEmail}
            onChange={(e) => setForm({ ...form, parentEmail: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
          <input type="text" placeholder="Parent name (new account)" value={form.parentName}
            onChange={(e) => setForm({ ...form, parentName: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
          <input type="text" placeholder="Temp password (new account)" value={form.parentPassword}
            onChange={(e) => setForm({ ...form, parentPassword: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
          <input type="text" placeholder="Phone (optional)" value={form.parentPhone}
            onChange={(e) => setForm({ ...form, parentPhone: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Student</p>
          <input type="email" placeholder="Student email *" value={form.studentEmail}
            onChange={(e) => setForm({ ...form, studentEmail: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
          <input type="text" placeholder="Student name (new account)" value={form.studentName}
            onChange={(e) => setForm({ ...form, studentName: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
          <input type="text" placeholder="Temp password (new account)" value={form.studentPassword}
            onChange={(e) => setForm({ ...form, studentPassword: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
          <select value={form.studentGrade}
            onChange={(e) => setForm({ ...form, studentGrade: e.target.value as typeof form.studentGrade })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
            <option value="">Grade this year (new account)…</option>
            <option value="9">Grade 9 (starts grade 10 next year)</option>
            <option value="10">Grade 10</option>
            <option value="11">Grade 11</option>
            <option value="12">Grade 12</option>
          </select>
        </div>
      </div>
      {localError && <p className="mt-3 text-sm text-destructive">{localError}</p>}
      <div className="mt-4 flex justify-end">
        <Button
          disabled={mutation.isPending || !form.parentEmail.trim() || !form.studentEmail.trim()}
          onClick={() => { setLocalError(''); mutation.mutate(); }}
        >
          {mutation.isPending ? 'Onboarding…' : 'Create & Link Family'}
        </Button>
      </div>
    </div>
  );
}

// ─── Desk registration + take money (G1) ─────────────────────────────────────

function DeskRegisterCard({
  studentId,
  onDone,
  onError,
}: {
  studentId: string;
  onDone: (msg: string) => void;
  onError: (e: Error) => void;
}) {
  const [sessionId, setSessionId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Per-subject options — without these the desk charged FULL price for
  // outside-school retakes (the 50% rule lives behind subjectOptions)
  // and never recorded a teacher, making it strictly weaker than the
  // parent's own self-serve flow.
  const [choices, setChoices] = useState<Record<string, { teacherId?: string; takeOutsideSchool?: boolean }>>({});
  const [collect, setCollect] = useState(true);
  const [instrument, setInstrument] = useState<'cash' | 'card' | 'instapay' | 'other'>('cash');
  const [escrowApply, setEscrowApply] = useState('');
  const [localError, setLocalError] = useState('');

  const { data: sessions = [] } = useQuery<SessionRow[]>({
    queryKey: ['sessions', 'active'],
    queryFn: async () => (await apiResponse(api.v1.sessions.active.$get())) as SessionRow[],
  });

  const { data: available = [], isFetching } = useQuery<AvailableSubject[]>({
    queryKey: ['registrations', 'available', sessionId, studentId, 'desk'],
    queryFn: async () =>
      (await apiResponse(
        api.v1.registrations.available.$get({ query: { sessionId, studentId } })
      )) as AvailableSubject[],
    enabled: !!sessionId,
    retry: false,
  });

  const priceFor = (sub: AvailableSubject) =>
    choices[sub.id]?.takeOutsideSchool && sub.outsidePricing
      ? sub.outsidePricing.total
      : sub.pricing.total;

  const total = available
    .filter((s) => selected.has(s.id))
    .reduce((sum, s) => sum + priceFor(s), 0);

  const mutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.registrations.desk.$post({
          json: {
            studentId,
            sessionId,
            subjectIds: Array.from(selected),
            subjectOptions: Array.from(selected).reduce<
              Record<string, { teacherId?: string; takeOutsideSchool?: boolean }>
            >((acc, id) => {
              const choice = choices[id];
              if (choice && (choice.teacherId || choice.takeOutsideSchool)) acc[id] = choice;
              return acc;
            }, {}),
            collectNow: collect
              ? {
                  instrumentUsed: instrument,
                  escrowAmountToApply: parseFloat(escrowApply) > 0 ? parseFloat(escrowApply) : 0,
                }
              : undefined,
          },
        })
      ),
    onSuccess: (d) => {
      onDone(
        collect
          ? `Registered and collected ${formatPrice(d.collected)}. Receipts ready to hand over${d.receipts.length ? `: ${d.receipts.map((r) => r.receiptNumber).join(', ')}` : ''}.${paymentsLine(d)}`
          : 'Registered — the family can pay later (app or desk).'
      );
    },
    onError: (err: Error) => { setLocalError(err.message); onError(err); },
  });

  return (
    <div className="bg-card rounded-xl border border-primary/40 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-foreground font-display mb-3">Register subjects at the desk</h3>

      <div className="flex gap-3 flex-wrap mb-3">
        <select
          value={sessionId}
          onChange={(e) => { setSessionId(e.target.value); setSelected(new Set()); setChoices({}); }}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          <option value="">Pick an open session…</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {sessionId && (isFetching ? (
        <div className="py-4 text-sm text-muted-foreground">Loading subjects…</div>
      ) : available.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">Nothing available (already registered, or level mismatch).</p>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto mb-3">
          {available.map((s) => (
            <div key={s.id} className="py-1">
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(s.id);
                      else next.delete(s.id);
                      return next;
                    })
                  }
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <span className="flex-1">
                  {s.name} <span className="text-xs text-muted-foreground font-mono">{s.code}</span>
                  {s.isCore && <span className="text-xs text-amber-700 dark:text-amber-400 ml-1">core</span>}
                  {s.isRetake && <span className="text-xs text-violet-700 dark:text-violet-400 ml-1">retake</span>}
                </span>
                <span className="font-medium">{formatPrice(priceFor(s))}</span>
              </label>

              {selected.has(s.id) && (s.outsidePricing || s.teachers.length > 0) && (
                <div className="ml-6 mt-1 flex flex-wrap items-center gap-3">
                  {s.outsidePricing && (
                    <label className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={choices[s.id]?.takeOutsideSchool ?? false}
                        onChange={(e) =>
                          setChoices((prev) => ({
                            ...prev,
                            [s.id]: {
                              ...prev[s.id],
                              takeOutsideSchool: e.target.checked,
                              teacherId: e.target.checked ? undefined : prev[s.id]?.teacherId,
                            },
                          }))
                        }
                        className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary"
                      />
                      Outside school ({formatPrice(s.outsidePricing.total)})
                    </label>
                  )}
                  {s.teachers.length > 0 && !choices[s.id]?.takeOutsideSchool && (
                    <select
                      value={choices[s.id]?.teacherId ?? ''}
                      onChange={(e) =>
                        setChoices((prev) => ({
                          ...prev,
                          [s.id]: { ...prev[s.id], teacherId: e.target.value || undefined },
                        }))
                      }
                      className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground"
                    >
                      <option value="">Teacher: no preference</option>
                      {s.teachers.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {selected.size > 0 && (
        <>
          <div className="flex items-center justify-between text-sm font-semibold text-foreground border-t border-border pt-3 mb-3">
            <span>Total</span>
            <span>{formatPrice(total)}</span>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground mb-3 cursor-pointer">
            <input
              type="checkbox"
              checked={collect}
              onChange={(e) => setCollect(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
            Money received now (confirms immediately and creates the receipts)
          </label>

          {collect && (
            <div className="flex gap-3 flex-wrap items-end mb-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Paid with</label>
                <select
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value as typeof instrument)}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  {IN_SCHOOL_INSTRUMENTS.map((i) => (
                    <option key={i} value={i}>{IN_SCHOOL_INSTRUMENT_LABELS[i]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Apply escrow (EGP, optional)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={escrowApply}
                  onChange={(e) => setEscrowApply(e.target.value)}
                  className="w-36 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>
            </div>
          )}

          {localError && <p className="mb-3 text-sm text-destructive">{localError}</p>}

          <Button
            className="w-full"
            disabled={mutation.isPending}
            onClick={() => { setLocalError(''); mutation.mutate(); }}
          >
            {mutation.isPending
              ? 'Processing…'
              : collect
                ? `Register & Collect ${formatPrice(Math.max(0, total - (parseFloat(escrowApply) > 0 ? parseFloat(escrowApply) : 0)))}`
                : `Register ${selected.size} Subject${selected.size === 1 ? '' : 's'} (pay later)`}
          </Button>
        </>
      )}
    </div>
  );
}
