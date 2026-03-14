'use client';

import { useState, useMemo } from 'react';
import { useSuspenseQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, COUNCIL_LABELS, CHANGE_REQUEST_STATUS_LABELS } from '@repo/validations';

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

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
  }).format(price);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ApprovalsClient(): React.JSX.Element {
  const queryClient = useQueryClient();

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

  // ─── Query ─────────────────────────────────────────────────────────────────

  const { data: pending = [] } = useSuspenseQuery<PendingRegistration[]>({
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
    mutationFn: () =>
      apiResponse(
        api.v1.registrations.approve.$put({
          json: {
            registrationIds: Array.from(selectedIds),
            comments: approveComment || undefined,
          },
        })
      ),
    onSuccess: () => {
      setSelectedIds(new Set());
      setApproveComment('');
      setShowApproveModal(false);
      queryClient.invalidateQueries({ queryKey: ['registrations'] });
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
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-12">
          <div className="text-4xl mb-4">✅</div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100 mb-2">
            All Caught Up
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            No pending registration requests from your children at this time.
          </p>
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
          Pending Approvals
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          {pending.length} request{pending.length !== 1 ? 's' : ''} awaiting your decision
        </p>
      </div>

      {/* Global error */}
      {actionError && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-400">
          {actionError}
        </div>
      )}

      {/* Action Bar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-4 z-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="text-sm text-slate-700 dark:text-slate-300">
            <span className="font-semibold">{selectedIds.size}</span> selected ·{' '}
            <span className="font-semibold">{formatPrice(selectedTotal)}</span> total
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-3 py-1.5 rounded"
            >
              Clear
            </button>
            <button
              onClick={openRejectModal}
              className="text-sm font-medium rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 px-4 py-1.5 transition-colors"
            >
              Reject Selected
            </button>
            <button
              onClick={openApproveModal}
              className="text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 transition-colors"
            >
              Approve Selected
            </button>
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
                ? 'border-slate-800 dark:border-slate-200 bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 font-medium'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400'
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
                  ? 'border-slate-800 dark:border-slate-200 bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 font-medium'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-400'
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
            className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden"
          >
            {/* Group header */}
            <div className="bg-slate-50 dark:bg-slate-700/50 px-5 py-3 flex items-center justify-between gap-3">
              <div>
                <span className="font-semibold text-slate-800 dark:text-slate-100">
                  {student.name}
                </span>
                {student.grade && (
                  <span className="text-slate-500 dark:text-slate-400 text-sm ml-1">
                    · Grade {student.grade}
                  </span>
                )}
                <span className="text-slate-400 dark:text-slate-500 text-sm ml-2">
                  / {session.name}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {formatPrice(sessionTotal)}
                </span>
                <button
                  onClick={() =>
                    allSelected ? deselectAll(groupIds) : selectAll(groupIds)
                  }
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>
            </div>

            {/* Registration rows */}
            <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
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
                        ? 'bg-blue-50 dark:bg-blue-900/10'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'
                    }`}
                  >
                    {/* Checkbox */}
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'border-blue-500 bg-blue-500'
                          : 'border-slate-300 dark:border-slate-500'
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
                      <div className="font-medium text-slate-800 dark:text-slate-100 text-sm">
                        {reg.subject.name}
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        {reg.subject.code} · {councilLabel}
                        {reg.subject.isCore && (
                          <span className="ml-2 text-amber-600 dark:text-amber-400">★ Core</span>
                        )}
                        {!reg.subject.isOfferedAtSchool && (
                          <span className="ml-2 text-slate-400">(External)</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                        Requested{' '}
                        {new Date(reg.createdAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </div>
                    </div>

                    {/* Price */}
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 shrink-0">
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
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50">
              Approve {selectedIds.size} Registration{selectedIds.size !== 1 ? 's' : ''}
            </h3>

            <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 p-3 text-sm text-green-700 dark:text-green-300">
              Total: <strong>{formatPrice(selectedTotal)}</strong> — payment will be required to finalize these registrations.
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Comment (optional)
              </label>
              <textarea
                value={approveComment}
                onChange={(e) => setApproveComment(e.target.value)}
                placeholder="Add a note to your child…"
                rows={3}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-green-400"
              />
            </div>

            {approveMutation.isError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {(approveMutation.error as Error).message}
              </p>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setShowApproveModal(false)}
                disabled={approveMutation.isPending}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {approveMutation.isPending ? 'Approving…' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Reject Modal ───────────────────────────────────────────────────── */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50">
              Reject {selectedIds.size} Registration{selectedIds.size !== 1 ? 's' : ''}
            </h3>

            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400">
              This action is permanent. Rejected registrations cannot be un-rejected.
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                value={rejectComment}
                onChange={(e) => {
                  setRejectComment(e.target.value);
                  setRejectError('');
                }}
                placeholder="Explain to your child why this request is being rejected…"
                rows={3}
                className={`w-full rounded-lg border text-sm px-3 py-2 resize-none focus:outline-none focus:ring-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 ${
                  rejectError
                    ? 'border-red-400 focus:ring-red-400'
                    : 'border-slate-300 dark:border-slate-600 focus:ring-red-400'
                }`}
              />
              {rejectError && (
                <p className="text-xs text-red-500 mt-1">{rejectError}</p>
              )}
            </div>

            {rejectMutation.isError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {(rejectMutation.error as Error).message}
              </p>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectComment('');
                  setRejectError('');
                }}
                disabled={rejectMutation.isPending}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectSubmit}
                disabled={rejectMutation.isPending}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {rejectMutation.isPending ? 'Rejecting…' : 'Confirm Rejection'}
              </button>
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

type ChangeRequestEntry = {
  id: string;
  type: 'drop' | 'swap';
  status: string;
  reason: string;
  priceAtRequest: number;
  priceDifference: number;
  createdAt: string;
  registration: {
    priceAtRegistration: number;
    subject: { name: string; subjectCode: string | null };
    session: { name: string };
    student: { id: string; name: string; grade: number | null };
  };
  newSubject: { name: string; subjectCode: string | null } | null;
};

function ChangeRequestsSection() {
  const qc = useQueryClient();

  const [approveTarget, setApproveTarget] = useState<ChangeRequestEntry | null>(null);
  const [rejectTarget, setRejectTarget]   = useState<ChangeRequestEntry | null>(null);
  const [approveComment, setApproveComment] = useState('');
  const [rejectComment, setRejectComment]   = useState('');
  const [crError, setCrError] = useState('');

  const { data: changeRequests = [] } = useQuery<ChangeRequestEntry[]>({
    queryKey: ['change-requests', 'pending-for-parent'],
    queryFn: () => apiResponse(api.v1['change-requests'].$get({ query: {} })),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['change-requests'] });
    qc.invalidateQueries({ queryKey: ['registrations'] });
  };

  const approveCrMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiResponse(
        api.v1['change-requests'][':id'].approve.$put({
          param: { id },
          json: { comments: approveComment || undefined },
        })
      ),
    onSuccess: () => { setApproveTarget(null); setApproveComment(''); setCrError(''); invalidate(); },
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
    onSuccess: () => { setRejectTarget(null); setRejectComment(''); setCrError(''); invalidate(); },
    onError: (e: Error) => setCrError(e.message),
  });

  if (changeRequests.length === 0) return null;

  return (
    <div className="mt-10">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-slate-900">
          Drop &amp; Swap Requests
        </h2>
        <p className="text-slate-500 mt-1">
          {changeRequests.length} pending change request{changeRequests.length !== 1 ? 's' : ''} from your children.
        </p>
      </div>

      <div className="space-y-4">
        {changeRequests.map((cr) => {
          const isCredit = cr.priceDifference <= 0;
          return (
            <div key={cr.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                      cr.type === 'drop' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'
                    }`}>
                      {cr.type}
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {cr.registration.subject.name}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {cr.registration.student.name}
                    {cr.registration.student.grade ? ` (Grade ${cr.registration.student.grade})` : ''}
                    {' · '}{cr.registration.session.name}
                    {' · '}{new Date(cr.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                  {CHANGE_REQUEST_STATUS_LABELS[cr.status as keyof typeof CHANGE_REQUEST_STATUS_LABELS] ?? cr.status}
                </span>
              </div>

              {cr.type === 'swap' && cr.newSubject && (
                <p className="mt-2 text-sm text-slate-600">
                  → Swap to: <span className="font-medium">{cr.newSubject.name}</span>
                  {cr.newSubject.subjectCode && ` (${cr.newSubject.subjectCode})`}
                </p>
              )}

              <div className="mt-3 grid grid-cols-3 gap-3">
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-xs text-slate-500">Current Price</p>
                  <p className="text-sm font-bold text-slate-700">
                    {formatPrice(cr.registration.priceAtRegistration)}
                  </p>
                </div>
                {cr.type === 'swap' && (
                  <div className="bg-slate-50 rounded-lg p-2 text-center">
                    <p className="text-xs text-slate-500">New Price</p>
                    <p className="text-sm font-bold text-slate-700">{formatPrice(cr.priceAtRequest)}</p>
                  </div>
                )}
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-xs text-slate-500">Impact</p>
                  <p className={`text-sm font-bold ${isCredit ? 'text-green-700' : 'text-amber-700'}`}>
                    {isCredit
                      ? `+${formatPrice(Math.abs(cr.priceDifference))} escrow`
                      : `${formatPrice(cr.priceDifference)} to pay`}
                  </p>
                </div>
              </div>

              <p className="mt-3 text-xs text-slate-500 bg-slate-50 rounded p-2">
                Reason: {cr.reason}
              </p>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => { setApproveTarget(cr); setCrError(''); }}
                  className="flex-1 py-2 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-700 transition-colors"
                >
                  Approve
                </button>
                <button
                  onClick={() => { setRejectTarget(cr); setCrError(''); }}
                  className="flex-1 py-2 border border-red-300 text-red-600 text-sm font-medium rounded-xl hover:bg-red-50 transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Approve Change Request Modal */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Approve Change Request</h3>
            <p className="text-sm text-gray-700 mb-4">
              Approve{' '}
              <span className="font-semibold capitalize">{approveTarget.type}</span> for{' '}
              <span className="font-semibold">{approveTarget.registration.student.name}</span>{' '}
              — {approveTarget.registration.subject.name}
              {approveTarget.type === 'swap' && approveTarget.newSubject
                ? ` → ${approveTarget.newSubject.name}`
                : ''}
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Comments <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={approveComment}
                onChange={(e) => setApproveComment(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                placeholder="Optional note to your child..."
              />
            </div>
            {crError && <p className="text-sm text-red-600 mb-3">{crError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setApproveTarget(null)} className="flex-1 py-2.5 border border-gray-300 text-sm rounded-xl text-gray-700 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => approveCrMutation.mutate({ id: approveTarget.id })}
                disabled={approveCrMutation.isPending}
                className="flex-1 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50"
              >
                {approveCrMutation.isPending ? 'Approving...' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Change Request Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Reject Change Request</h3>
            <p className="text-sm text-gray-700 mb-4">
              Rejecting{' '}
              <span className="font-semibold capitalize">{rejectTarget.type}</span> request for{' '}
              <span className="font-semibold">{rejectTarget.registration.student.name}</span>.
              No financial impact.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                placeholder="Explain why you're rejecting this request..."
              />
            </div>
            {crError && <p className="text-sm text-red-600 mb-3">{crError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setRejectTarget(null)} className="flex-1 py-2.5 border border-gray-300 text-sm rounded-xl text-gray-700 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => rejectCrMutation.mutate({ id: rejectTarget.id })}
                disabled={!rejectComment.trim() || rejectCrMutation.isPending}
                className="flex-1 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 disabled:opacity-50"
              >
                {rejectCrMutation.isPending ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
  }).format(price);
}
