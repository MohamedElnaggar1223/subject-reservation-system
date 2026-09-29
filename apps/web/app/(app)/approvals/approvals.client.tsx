'use client';

import { useState, useMemo } from 'react';
import { useSuspenseQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '~/lib/hono';
import { formatPrice } from '~/lib/format';
import { invalidateFinancialState } from '~/lib/financial-cache';
import { apiResponse, gradeLabel, COUNCIL_LABELS, CHANGE_REQUEST_STATUS_LABELS } from '@repo/validations';
import { Button } from '~/components/ui/button';

// ─── Types ────────────────────────────────────────────────────────────────────

type Subject = {
  id: string;
  name: string;
  code: string;
  council: string;
  priceInSchool: number;
  isOfferedAtSchool: boolean;
  customPrice: number | null;
  isCore: boolean;
};

type Session = {
  id: string;
  name: string;
  sessionType: string;
  status: string;
};

type Student = {
  id: string;
  name: string;
  email: string;
  grade: number | null;
  studentId: string | null;
};

type PendingRegistration = {
  id: string;
  studentId: string;
  sessionId: string;
  priceAtRegistration: number;
  status: string;
  requestedBy: string;
  createdAt: string;
  subject: Subject;
  session: Session;
  student: Student;
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ApprovalsClient(): React.JSX.Element {
  const queryClient = useQueryClient();
  const router = useRouter();

  // ─── State ─────────────────────────────────────────────────────────────────

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterStudentId, setFilterStudentId] = useState<string | null>(null);

  // Approve modal state
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approveComment, setApproveComment] = useState('');

  // Reject modal state
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [rejectError, setRejectError] = useState('');

  const [actionError, setActionError] = useState('');
  const [approvedCheckoutIds, setApprovedCheckoutIds] = useState<string[] | null>(null);

  // ─── Query ─────────────────────────────────────────────────────────────────

  const { data: pending = [] } = useSuspenseQuery({
    queryKey: ['registrations', 'pending'],
    queryFn: () => apiResponse(api.v1.registrations.pending.$get()),
  });

  // ─── Derived ───────────────────────────────────────────────────────────────

  const uniqueStudents = useMemo(() => {
    const seen = new Map<string, Student>();
    for (const reg of pending) {
      if (!seen.has(reg.studentId)) seen.set(reg.studentId, reg.student);
    }
    return Array.from(seen.values());
  }, [pending]);

  const filteredPending = useMemo(
    () =>
      filterStudentId
        ? pending.filter((r) => r.studentId === filterStudentId)
        : pending,
    [pending, filterStudentId]
  );

  // Group filtered registrations by student → session
  const grouped = useMemo(() => {
    const map = new Map<
      string,
      { student: Student; session: Session; regs: PendingRegistration[] }
    >();
    for (const reg of filteredPending) {
      const key = `${reg.studentId}__${reg.sessionId}`;
      if (!map.has(key)) {
        map.set(key, { student: reg.student, session: reg.session, regs: [] });
      }
      map.get(key)!.regs.push(reg);
    }
    return Array.from(map.values());
  }, [filteredPending]);

  const selectedRegistrations = useMemo(
    () => pending.filter((r) => selectedIds.has(r.id)),
    [pending, selectedIds]
  );

  const selectedTotal = useMemo(
    () => selectedRegistrations.reduce((sum, r) => sum + r.priceAtRegistration, 0),
    [selectedRegistrations]
  );

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const approveMutation = useMutation({
    mutationFn: () => {
      const ids = Array.from(selectedIds);
      return apiResponse(
        api.v1.registrations.approve.$put({
          json: {
            registrationIds: ids,
            comments: approveComment || undefined,
          },
        })
      ).then(() => ids);
    },
    // The /approve endpoint is now atomic: it throws 422 if not every
    // requested ID was actually transitioned, so reaching onSuccess means
    // every `id` below was definitively flipped to 'pending_payment' and is
    // safe to forward into the checkout URL.
    onSuccess: (ids) => {
      setApprovedCheckoutIds(ids);
      setSelectedIds(new Set());
      setApproveComment('');
      setShowApproveModal(false);
      invalidateFinancialState(queryClient);
      router.refresh();
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.registrations.reject.$put({
          json: {
            registrationIds: Array.from(selectedIds),
            comments: rejectComment,
          },
        })
      ),
    onSuccess: () => {
      setSelectedIds(new Set());
      setRejectComment('');
      setShowRejectModal(false);
      queryClient.invalidateQueries({ queryKey: ['registrations'] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      router.refresh();
    },
    onError: (err: Error) => setActionError(err.message),
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll(ids: string[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }

  function deselectAll(ids: string[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }

  function openApproveModal() {
    if (selectedIds.size === 0) return;
    setActionError('');
    setShowApproveModal(true);
  }

  function openRejectModal() {
    if (selectedIds.size === 0) return;
    setRejectError('');
    setActionError('');
    setShowRejectModal(true);
  }

  function handleRejectSubmit() {
    if (!rejectComment.trim()) {
      setRejectError('A reason is required when rejecting a request.');
      return;
    }
    rejectMutation.mutate();
  }

  // ─── Empty State ──────────────────────────────────────────────────────────

  if (pending.length === 0) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up space-y-6">
        {approvedCheckoutIds && (
          <div className="rounded-xl border border-brand-200 bg-brand-50 dark:bg-brand-900/20 dark:border-brand-700 p-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-brand-600 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-brand-800 dark:text-brand-300 font-display">
                Registrations Approved
              </p>
              <p className="text-sm text-brand-700 dark:text-brand-400 mt-1">
                {approvedCheckoutIds.length} registration{approvedCheckoutIds.length !== 1 ? 's' : ''} approved successfully. Proceed to payment to finalize.
              </p>
              <div className="mt-3 flex gap-2">
                <Link href={`/checkout?ids=${approvedCheckoutIds.join(',')}` as never}>
                  <Button size="sm">Proceed to Payment</Button>
                </Link>
                <Button size="sm" variant="outline" onClick={() => setApprovedCheckoutIds(null)}>
                  Later
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-card rounded-xl border border-border shadow-sm p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-brand-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-brand-700" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground font-display mb-2">
            No subject requests
          </h2>
          <p className="text-muted-foreground text-sm">
            None of your children are waiting on a subject-registration approval.
          </p>
        </div>

        {/* Drop/swap requests live on this page too — omitting them here
            made a child's drop request invisible to the parent forever,
            under a banner claiming there was nothing to do. */}
        <ChangeRequestsSection />
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto space-y-6 animate-fade-up">
      {/* Post-approval checkout prompt */}
      {approvedCheckoutIds && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 dark:bg-brand-900/20 dark:border-brand-700 p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm text-brand-800 dark:text-brand-300">
              <strong>{approvedCheckoutIds.length} registration{approvedCheckoutIds.length !== 1 ? 's' : ''}</strong> approved — payment required to finalize.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Link href={`/checkout?ids=${approvedCheckoutIds.join(',')}` as never}>
              <Button size="sm">Pay Now</Button>
            </Link>
            <button onClick={() => setApprovedCheckoutIds(null)} className="text-xs text-brand-600 dark:text-brand-400 hover:underline">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">
          Pending Approvals
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pending.length} request{pending.length !== 1 ? 's' : ''} awaiting your decision
        </p>
      </div>

      {/* Global error */}
      {actionError && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* Action Bar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-4 z-10 bg-card rounded-xl border border-border shadow-lg p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-foreground">
            <span className="font-semibold">{selectedIds.size}</span> selected ·{' '}
            <span className="font-semibold">{formatPrice(selectedTotal)}</span> total
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openRejectModal}
              className="text-destructive border-destructive/30 hover:bg-destructive/5"
            >
              Reject Selected
            </Button>
            <Button
              size="sm"
              onClick={openApproveModal}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Approve Selected
            </Button>
          </div>
        </div>
      )}

      {/* Student filter */}
      {uniqueStudents.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterStudentId(null)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              !filterStudentId
                ? 'border-primary bg-primary text-primary-foreground font-medium'
                : 'border-border text-muted-foreground hover:border-primary/40'
            }`}
          >
            All Children
          </button>
          {uniqueStudents.map((s) => (
            <button
              key={s.id}
              onClick={() => setFilterStudentId(s.id)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                filterStudentId === s.id
                  ? 'border-primary bg-primary text-primary-foreground font-medium'
                  : 'border-border text-muted-foreground hover:border-primary/40'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Grouped Request Cards */}
      {grouped.map(({ student, session, regs }) => {
        const groupIds = regs.map((r) => r.id);
        const allSelected = groupIds.every((id) => selectedIds.has(id));
        const sessionTotal = regs.reduce((sum, r) => sum + r.priceAtRegistration, 0);

        return (
          <div
            key={`${student.id}__${session.id}`}
            className="bg-card rounded-xl border border-border shadow-sm overflow-hidden"
          >
            {/* Group header */}
            <div className="bg-muted px-5 py-3 flex items-center justify-between gap-3">
              <div>
                <span className="font-semibold text-foreground">
                  {student.name}
                </span>
                {student.grade != null && (
                  <span className="text-muted-foreground text-sm ms-1">
                    · {gradeLabel(student.grade)}
                  </span>
                )}
                <span className="text-muted-foreground text-sm ml-2">
                  / {session.name}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-foreground">
                  {formatPrice(sessionTotal)}
                </span>
                <button
                  onClick={() =>
                    allSelected ? deselectAll(groupIds) : selectAll(groupIds)
                  }
                  className="text-xs text-primary hover:underline"
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>
            </div>

            {/* Registration rows */}
            <div className="divide-y divide-border">
              {regs.map((reg) => {
                const isSelected = selectedIds.has(reg.id);
                const price = reg.priceAtRegistration;
                const councilLabel =
                  COUNCIL_LABELS[reg.subject.council as keyof typeof COUNCIL_LABELS] ??
                  reg.subject.council;

                return (
                  <div
                    key={reg.id}
                    onClick={() => toggleSelection(reg.id)}
                    className={`flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-primary/5'
                        : 'hover:bg-muted'
                    }`}
                  >
                    {/* Checkbox */}
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary'
                          : 'border-muted-foreground/30'
                      }`}
                    >
                      {isSelected && (
                        <svg
                          className="w-3 h-3 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>

                    {/* Subject info */}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground text-sm">
                        {reg.subject.name}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {reg.subject.code} · {councilLabel}
                        {reg.subject.isCore && (
                          <span className="ml-2 text-amber-600 dark:text-amber-400">Core</span>
                        )}
                        {!reg.subject.isOfferedAtSchool && (
                          <span className="ml-2 text-muted-foreground">(External)</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Requested{' '}
                        {new Date(reg.createdAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </div>
                    </div>

                    {/* Price */}
                    <div className="text-sm font-semibold text-foreground shrink-0">
                      {formatPrice(price)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ─── Approve Modal ──────────────────────────────────────────────────── */}
      {showApproveModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-foreground font-display">
              Approve {selectedIds.size} Registration{selectedIds.size !== 1 ? 's' : ''}
            </h3>

            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              Total: <strong>{formatPrice(selectedTotal)}</strong> — payment will be required to finalize these registrations.
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Comment (optional)
              </label>
              <textarea
                value={approveComment}
                onChange={(e) => setApproveComment(e.target.value)}
                placeholder="Add a note to your child..."
                rows={3}
                className="w-full rounded-lg border border-border bg-card text-foreground text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {approveMutation.isError && (
              <p className="text-sm text-destructive">
                {(approveMutation.error as Error).message}
              </p>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="outline"
                onClick={() => setShowApproveModal(false)}
                disabled={approveMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {approveMutation.isPending ? 'Approving...' : 'Confirm Approval'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Reject Modal ───────────────────────────────────────────────────── */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-foreground font-display">
              Reject {selectedIds.size} Registration{selectedIds.size !== 1 ? 's' : ''}
            </h3>

            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              This action is permanent. Rejected registrations cannot be un-rejected.
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Reason <span className="text-destructive">*</span>
              </label>
              <textarea
                value={rejectComment}
                onChange={(e) => {
                  setRejectComment(e.target.value);
                  setRejectError('');
                }}
                placeholder="Explain to your child why this request is being rejected..."
                rows={3}
                className={`w-full rounded-lg border text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 bg-card text-foreground ${
                  rejectError
                    ? 'border-destructive focus:ring-destructive/40'
                    : 'border-border focus:ring-primary'
                }`}
              />
              {rejectError && (
                <p className="text-xs text-destructive mt-1">{rejectError}</p>
              )}
            </div>

            {rejectMutation.isError && (
              <p className="text-sm text-destructive">
                {(rejectMutation.error as Error).message}
              </p>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectComment('');
                  setRejectError('');
                }}
                disabled={rejectMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleRejectSubmit}
                disabled={rejectMutation.isPending}
              >
                {rejectMutation.isPending ? 'Rejecting...' : 'Confirm Rejection'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Change Requests Section */}
      <ChangeRequestsSection />
    </div>
  );
}

// ─── Change Requests Section ─────────────────────────────────────────────────

// Typed by the API, never by hand (PATTERNS.md): extract the row type from the fetcher.
const fetchParentChangeRequests = () => apiResponse(api.v1['change-requests'].$get({ query: {} }));
type ChangeRequestEntry = Awaited<ReturnType<typeof fetchParentChangeRequests>>[number];

function ChangeRequestsSection() {
  const qc = useQueryClient();
  const router = useRouter();

  const [approveTarget, setApproveTarget] = useState<ChangeRequestEntry | null>(null);
  const [rejectTarget, setRejectTarget]   = useState<ChangeRequestEntry | null>(null);
  const [approveComment, setApproveComment] = useState('');
  const [rejectComment, setRejectComment]   = useState('');
  const [crError, setCrError] = useState('');

  const { data: changeRequests = [] } = useQuery({
    queryKey: ['change-requests', 'pending-for-parent'],
    queryFn: fetchParentChangeRequests,
  });

  const invalidate = (target?: ChangeRequestEntry | null, escrowDelta?: number) => {
    invalidateFinancialState(qc, {
      studentId: target?.registration.student.id,
      escrowDelta,
    });
    router.refresh();
  };

  const approveCrMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiResponse(
        api.v1['change-requests'][':id'].approve.$put({
          param: { id },
          json: { comments: approveComment || undefined },
        })
      ),
    onSuccess: () => {
      const target = approveTarget;
      setApproveTarget(null);
      setApproveComment('');
      setCrError('');
      invalidate(target, target?.registration.priceAtRegistration);
    },
    onError: (e: Error) => setCrError(e.message),
  });

  const rejectCrMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiResponse(
        api.v1['change-requests'][':id'].reject.$put({
          param: { id },
          json: { comments: rejectComment },
        })
      ),
    onSuccess: () => { setRejectTarget(null); setRejectComment(''); setCrError(''); invalidate(rejectTarget); },
    onError: (e: Error) => setCrError(e.message),
  });

  if (changeRequests.length === 0) return null;

  return (
    <div className="mt-10">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-foreground font-display">
          Drop &amp; Swap Requests
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          {changeRequests.length} pending change request{changeRequests.length !== 1 ? 's' : ''} from your children.
        </p>
      </div>

      <div className="space-y-4">
        {changeRequests.map((cr) => {
          const isCredit = cr.priceDifference <= 0;
          return (
            <div key={cr.id} className="bg-card rounded-xl border border-border shadow-sm p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                      cr.type === 'drop' ? 'bg-destructive/10 text-destructive' : 'bg-brand-50 text-brand-700'
                    }`}>
                      {cr.type}
                    </span>
                    <span className="text-sm font-semibold text-foreground">
                      {cr.registration.subject.name}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {cr.registration.student.name}
                    {cr.registration.student.grade != null ? ` (${gradeLabel(cr.registration.student.grade)})` : ''}
                    {' · '}{cr.registration.session.name}
                    {' · '}{new Date(cr.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                  {CHANGE_REQUEST_STATUS_LABELS[cr.status as keyof typeof CHANGE_REQUEST_STATUS_LABELS] ?? cr.status}
                </span>
              </div>

              {cr.type === 'swap' && cr.newSubject && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Swap to: <span className="font-medium text-foreground">{cr.newSubject.name}</span>
                  {cr.newSubject.code && ` (${cr.newSubject.code})`}
                </p>
              )}

              <div className="mt-3 grid grid-cols-3 gap-3">
                <div className="bg-muted rounded-lg p-2 text-center">
                  <p className="text-xs text-muted-foreground">Current Price</p>
                  <p className="text-sm font-bold text-foreground">
                    {formatPrice(cr.registration.priceAtRegistration)}
                  </p>
                </div>
                {cr.type === 'swap' && (
                  <div className="bg-muted rounded-lg p-2 text-center">
                    <p className="text-xs text-muted-foreground">New Price</p>
                    <p className="text-sm font-bold text-foreground">{formatPrice(cr.priceAtRequest)}</p>
                  </div>
                )}
                <div className="bg-muted rounded-lg p-2 text-center">
                  <p className="text-xs text-muted-foreground">Impact</p>
                  <p className={`text-sm font-bold ${isCredit ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                    {isCredit
                      ? `+${formatPrice(Math.abs(cr.priceDifference))} escrow`
                      : `${formatPrice(cr.priceDifference)} to pay`}
                  </p>
                </div>
              </div>

              <p className="mt-3 text-xs text-muted-foreground bg-muted rounded p-2">
                Reason: {cr.reason}
              </p>

              <div className="mt-4 flex gap-2">
                <Button
                  onClick={() => { setApproveTarget(cr); setCrError(''); }}
                  size="sm"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  Approve
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setRejectTarget(cr); setCrError(''); }}
                  className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/5"
                >
                  Reject
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Approve Change Request Modal */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-foreground font-display mb-4">Approve Change Request</h3>
            <p className="text-sm text-foreground mb-4">
              Approve{' '}
              <span className="font-semibold capitalize">{approveTarget.type}</span> for{' '}
              <span className="font-semibold">{approveTarget.registration.student.name}</span>{' '}
              — {approveTarget.registration.subject.name}
              {approveTarget.type === 'swap' && approveTarget.newSubject
                ? ` → ${approveTarget.newSubject.name}`
                : ''}
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-1">
                Comments <span className="text-muted-foreground">(optional)</span>
              </label>
              <textarea
                value={approveComment}
                onChange={(e) => setApproveComment(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                placeholder="Optional note to your child..."
              />
            </div>
            {crError && <p className="text-sm text-destructive mb-3">{crError}</p>}
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setApproveTarget(null)} className="flex-1">Cancel</Button>
              <Button
                onClick={() => approveCrMutation.mutate({ id: approveTarget.id })}
                disabled={approveCrMutation.isPending}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {approveCrMutation.isPending ? 'Approving...' : 'Confirm Approval'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Change Request Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-card rounded-xl shadow-xl border border-border w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-foreground font-display mb-4">Reject Change Request</h3>
            <p className="text-sm text-foreground mb-4">
              Rejecting{' '}
              <span className="font-semibold capitalize">{rejectTarget.type}</span> request for{' '}
              <span className="font-semibold">{rejectTarget.registration.student.name}</span>.
              No financial impact.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-1">
                Reason <span className="text-destructive">*</span>
              </label>
              <textarea
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                placeholder="Explain why you're rejecting this request..."
              />
            </div>
            {crError && <p className="text-sm text-destructive mb-3">{crError}</p>}
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setRejectTarget(null)} className="flex-1">Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => rejectCrMutation.mutate({ id: rejectTarget.id })}
                disabled={!rejectComment.trim() || rejectCrMutation.isPending}
                className="flex-1"
              >
                {rejectCrMutation.isPending ? 'Rejecting...' : 'Confirm Rejection'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
