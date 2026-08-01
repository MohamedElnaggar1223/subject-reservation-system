'use client';

import { useState, useMemo } from 'react';
import { useSuspenseQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '~/lib/hono';
import { formatPrice } from '~/lib/format';
import { invalidateFinancialState } from '~/lib/financial-cache';
import { apiResponse, REGISTRATION_STATUS_LABELS, COUNCIL_LABELS } from '@repo/validations';
import { Button } from '~/components/ui/button';

// ─── Types ────────────────────────────────────────────────────────────────────

type Subject = {
  id: string;
  name: string;
  code: string;
  council: string;
  isCore?: boolean;
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
  grade: number | null;
  studentId: string | null;
};

type Registration = {
  id: string;
  studentId: string;
  sessionId: string;
  subjectId: string;
  priceAtRegistration: number;
  // Snapshot of subject.isCore at registration time (URD CORE-002).
  // Older rows predating the column may be missing it; fall back to subject.isCore.
  wasCoreAtRegistration?: boolean;
  // Attached by the registrations endpoint (M-18). When true, the user
  // has an outstanding pending_approval change request against this
  // registration and cannot submit another one until it's resolved.
  hasPendingChangeRequest?: boolean;
  status: string;
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalComments: string | null;
  droppedAt: string | null;
  createdAt: string;
  subject: Subject;
  session: Session;
  student: Student;
};

type AvailableSubject = {
  id: string;
  name: string;
  code: string | null;
  council: string;
  priceInSchool: number | null;
  customPrice: number | null;
  isOfferedAtSchool: boolean | null;
};

// ─── Status Styling ───────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  pending_approval: 'bg-amber-50 text-amber-700',
  pending_payment:  'bg-brand-50 text-brand-700',
  confirmed:        'bg-emerald-50 text-emerald-700',
  dropped_pending_receipt: 'bg-amber-50 text-amber-700',
  dropped:          'bg-muted text-muted-foreground',
  rejected:         'bg-destructive/10 text-destructive',
};

// ─── Refund Preview (V3 §6.12) ───────────────────────────────────────────────
// Transparency rule: every drop/swap dialog shows the exact refund the
// windows allow BEFORE the user commits.

type RefundPreview = { percentage: number; amount: number; fullPrice: number };

function RefundPreviewNote({ registrationId }: { registrationId: string }) {
  const { data: preview } = useQuery<RefundPreview>({
    queryKey: ['refund-preview', registrationId],
    queryFn: async () =>
      (await apiResponse(
        api.v1.receipts['refund-preview'].$get({ query: { registrationId } })
      )) as RefundPreview,
    retry: false,
  });

  if (!preview) return null;
  return (
    <div className="bg-muted rounded-lg p-3 text-xs text-foreground">
      Refund policy: you will receive{' '}
      <span className="font-semibold">{preview.percentage}% = {formatPrice(preview.amount)}</span>{' '}
      back (of {formatPrice(preview.fullPrice)}), released to escrow once the subject&apos;s
      receipt is returned to the school.
    </div>
  );
}

function resolvePrice(sub: AvailableSubject): number {
  if (!sub.isOfferedAtSchool || sub.priceInSchool == null) return sub.customPrice ?? 0;
  return sub.priceInSchool;
}

function canRevertApproval(reg: Registration, userId: string): boolean {
  return (
    reg.status === 'pending_payment' &&
    reg.requestedBy === reg.studentId &&
    reg.approvedBy === userId &&
    !reg.approvalComments?.startsWith('Swap from registration') &&
    !reg.approvalComments?.startsWith('Direct swap') &&
    !reg.approvalComments?.startsWith('[ADMIN OVERRIDE]')
  );
}

// ─── Modal Wrapper ────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col border border-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground font-display">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ─── Registration Card ────────────────────────────────────────────────────────

function RegistrationCard({
  reg,
  userRole,
  userId,
  sessionActive,
  onRequestDrop,
  onRequestSwap,
  onDirectDrop,
  onDirectSwap,
  onRevertApproval,
  isRevertingApproval,
  paymentSelected,
  onTogglePaymentSelection,
}: {
  reg: Registration;
  userRole: string | null;
  userId: string;
  sessionActive: boolean;
  onRequestDrop: (reg: Registration) => void;
  onRequestSwap: (reg: Registration) => void;
  onDirectDrop: (reg: Registration) => void;
  onDirectSwap: (reg: Registration) => void;
  onRevertApproval: (reg: Registration) => void;
  isRevertingApproval: boolean;
  paymentSelected: boolean;
  onTogglePaymentSelection: (reg: Registration) => void;
}) {
  const statusLabel =
    REGISTRATION_STATUS_LABELS[reg.status as keyof typeof REGISTRATION_STATUS_LABELS] ?? reg.status;
  const councilLabel =
    COUNCIL_LABELS[reg.subject.council as keyof typeof COUNCIL_LABELS] ?? reg.subject.council;

  const canChange = reg.status === 'confirmed' && sessionActive;

  // Core subjects in Grade 10 June sessions cannot be dropped or swapped.
  // Prefer the registration-time snapshot (wasCoreAtRegistration) so the
  // lock stays stable even if an admin later clears subject.isCore
  // (URD CORE-002). Fall back to the live flag for legacy rows.
  const coreAtRegistration = reg.wasCoreAtRegistration ?? !!reg.subject.isCore;
  const isCoreProtected =
    coreAtRegistration &&
    reg.student.grade === 10 &&
    reg.session.sessionType === 'june';
  // M-18: A pending change request already exists against this registration —
  // disable the drop/swap buttons instead of letting the user click through
  // to a failed API call. The DB's partial unique index would reject it
  // anyway; this just surfaces the state clearly.
  const hasPendingChange = reg.hasPendingChangeRequest === true;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-start gap-3">
          {reg.status === 'pending_payment' && userRole === 'parent' && (
            <input
              type="checkbox"
              checked={paymentSelected}
              onChange={() => onTogglePaymentSelection(reg)}
              aria-label={`Select ${reg.subject.name} for payment`}
              className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
          )}
          <div className="min-w-0">
            <div className="font-medium text-foreground truncate">{reg.subject.name}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {reg.subject.code} · {councilLabel}
            </div>
            {reg.approvalComments && (
              <div className={`text-xs mt-2 rounded p-2 ${
                reg.status === 'rejected'
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-muted text-muted-foreground'
              }`}>
                &ldquo;{reg.approvalComments}&rdquo;
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap ${STATUS_STYLES[reg.status] ?? 'bg-muted text-muted-foreground'}`}>
            {statusLabel}
          </span>
          <span className="text-sm font-semibold text-foreground">
            {formatPrice(reg.priceAtRegistration)}
          </span>
        </div>
      </div>

      {/* Pending payment notice */}
      {reg.status === 'pending_payment' && userRole === 'student' && (
        <div className="mt-3 text-xs text-brand-700 bg-brand-50 rounded-lg p-2">
          Approved by parent — awaiting payment.
        </div>
      )}

      {reg.status === 'pending_payment' && userRole === 'parent' && (
        <>
          {canRevertApproval(reg, userId) && (
            <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRevertApproval(reg)}
              disabled={isRevertingApproval}
              className="w-full"
            >
              {isRevertingApproval ? 'Reverting...' : 'Revert Approval'}
            </Button>
            </div>
          )}
        </>
      )}

      {/* Core subject protection notice */}
      {canChange && isCoreProtected && (
        <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 dark:border-amber-700 rounded-lg p-2">
          Core subjects cannot be dropped or swapped (Grade 10 June requirement).
        </div>
      )}

      {/* Pending change request notice (M-18) */}
      {canChange && !isCoreProtected && hasPendingChange && (
        <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 dark:border-amber-700 rounded-lg p-2">
          A drop/swap request for this registration is already pending approval. Cancel it from the pending requests page before submitting a new one.
        </div>
      )}

      {/* Session closed notice (Task 11.4) */}
      {reg.status === 'confirmed' && !sessionActive && (
        <div className="mt-3 text-xs text-muted-foreground bg-muted border border-border rounded-lg p-2">
          Registration window is closed. Drop/swap operations are unavailable.
        </div>
      )}

      {/* Drop / Swap actions */}
      {canChange && !isCoreProtected && !hasPendingChange && (
        <div className="mt-3 flex gap-2">
          {userRole === 'student' && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRequestDrop(reg)}
                className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/5"
              >
                Request Drop
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRequestSwap(reg)}
                className="flex-1 text-primary border-primary/30 hover:bg-primary/5"
              >
                Request Swap
              </Button>
            </>
          )}
          {userRole === 'parent' && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDirectDrop(reg)}
                className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/5"
              >
                Drop
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDirectSwap(reg)}
                className="flex-1 text-primary border-primary/30 hover:bg-primary/5"
              >
                Swap
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Drop Modal (Student) ─────────────────────────────────────────────────────

function RequestDropModal({
  reg,
  onClose,
  onSuccess,
}: {
  reg: Registration;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.registrations[':id']['request-drop'].$post({
          param: { id: reg.id },
          json: { reason },
        })
      ),
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Modal title="Request Drop" onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-destructive/10 rounded-lg p-3 text-sm">
          <p className="font-medium text-destructive">Drop: {reg.subject.name}</p>
          <p className="text-destructive/80 text-xs mt-1">
            The refund below is credited after approval and receipt return.
          </p>
        </div>
        <RefundPreviewNote registrationId={reg.id} />
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Reason <span className="text-destructive">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            placeholder="Explain why you want to drop this subject..."
          />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={reason.length < 5 || mutation.isPending}
            className="flex-1"
          >
            {mutation.isPending ? 'Submitting...' : 'Submit Request'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Swap Modal (Student) ─────────────────────────────────────────────────────

function RequestSwapModal({
  reg,
  onClose,
  onSuccess,
}: {
  reg: Registration;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [newSubjectId, setNewSubjectId] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');

  const { data: available = [] } = useQuery<AvailableSubject[]>({
    queryKey: ['registrations', 'available', reg.sessionId, reg.studentId],
    queryFn: () =>
      apiResponse(
        api.v1.registrations.available.$get({
          query: { sessionId: reg.sessionId, studentId: reg.studentId },
        })
      ),
  });

  const selectedSub = available.find((s) => s.id === newSubjectId);
  const newPrice = selectedSub ? resolvePrice(selectedSub) : 0;
  const diff = newPrice - reg.priceAtRegistration;

  const mutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.registrations[':id']['request-swap'].$post({
          param: { id: reg.id },
          json: { newSubjectId, reason },
        })
      ),
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Modal title="Request Swap" onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-brand-50 dark:bg-brand-900/20 rounded-lg p-3 text-sm">
          <p className="font-medium text-brand-800 dark:text-brand-300">Swap from: {reg.subject.name}</p>
          <p className="text-brand-600 dark:text-brand-400 text-xs mt-1">Current price: {formatPrice(reg.priceAtRegistration)}</p>
        </div>
        <RefundPreviewNote registrationId={reg.id} />

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">New Subject</label>
          <select
            value={newSubjectId}
            onChange={(e) => setNewSubjectId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Select a subject to swap to</option>
            {available.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.name} — {formatPrice(resolvePrice(sub))}
              </option>
            ))}
          </select>
        </div>

        {selectedSub && (
          <div className={`text-sm rounded-lg p-3 ${diff > 0 ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
            <p className={`font-medium ${diff > 0 ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-800 dark:text-emerald-300'}`}>
              Financial impact
            </p>
            <p className={`text-xs mt-1 ${diff > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
              {diff > 0
                ? `Additional payment of ${formatPrice(diff)} will be required`
                : diff < 0
                ? `${formatPrice(Math.abs(diff))} will be credited to your escrow`
                : 'Same price — no financial impact'}
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Reason <span className="text-destructive">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            placeholder="Explain why you want to swap this subject..."
          />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!newSubjectId || reason.length < 5 || mutation.isPending}
            className="flex-1"
          >
            {mutation.isPending ? 'Submitting...' : 'Submit Request'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Direct Drop Modal (Parent) ───────────────────────────────────────────────

function DirectDropModal({
  reg,
  onClose,
  onSuccess,
}: {
  reg: Registration;
  onClose: () => void;
  onSuccess: (studentId: string, escrowDelta: number) => void;
}) {
  const [err, setErr] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.registrations[':id'].drop.$post({
          param: { id: reg.id },
          json: {},
        })
      ),
    onSuccess: () => { onSuccess(reg.studentId, reg.priceAtRegistration); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Modal title="Drop Subject" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          You are about to drop{' '}
          <span className="font-semibold">{reg.subject.name}</span> for{' '}
          <span className="font-semibold">{reg.student.name}</span>.
        </p>
        <RefundPreviewNote registrationId={reg.id} />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex-1"
          >
            {mutation.isPending ? 'Dropping...' : 'Confirm Drop'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Direct Swap Modal (Parent) ───────────────────────────────────────────────

function DirectSwapModal({
  reg,
  onClose,
  onSuccess,
}: {
  reg: Registration;
  onClose: () => void;
  onSuccess: (studentId: string, escrowDelta: number) => void;
}) {
  const [newSubjectId, setNewSubjectId] = useState('');
  const [err, setErr] = useState('');

  const { data: available = [] } = useQuery<AvailableSubject[]>({
    queryKey: ['registrations', 'available', reg.sessionId, reg.studentId],
    queryFn: () =>
      apiResponse(
        api.v1.registrations.available.$get({
          query: { sessionId: reg.sessionId, studentId: reg.studentId },
        })
      ),
  });

  const selectedSub = available.find((s) => s.id === newSubjectId);
  const newPrice = selectedSub ? resolvePrice(selectedSub) : 0;
  const diff = newPrice - reg.priceAtRegistration;

  const mutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.registrations[':id'].swap.$post({
          param: { id: reg.id },
          json: { newSubjectId },
        })
      ),
    onSuccess: () => { onSuccess(reg.studentId, reg.priceAtRegistration); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Modal title="Direct Swap" onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-brand-50 dark:bg-brand-900/20 rounded-lg p-3 text-sm">
          <p className="font-medium text-brand-800 dark:text-brand-300">Swapping from: {reg.subject.name}</p>
          <p className="text-brand-600 dark:text-brand-400 text-xs mt-1">
            {reg.student.name} · Current price: {formatPrice(reg.priceAtRegistration)}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">New Subject</label>
          <select
            value={newSubjectId}
            onChange={(e) => setNewSubjectId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Select a subject</option>
            {available.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.name} — {formatPrice(resolvePrice(sub))}
              </option>
            ))}
          </select>
        </div>

        {selectedSub && (
          <div className={`text-sm rounded-lg p-3 ${diff > 0 ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
            <p className={`font-medium ${diff > 0 ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-800 dark:text-emerald-300'}`}>
              Financial impact
            </p>
            <p className={`text-xs mt-1 ${diff > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
              Old subject refunded per the refund policy below.
              {diff > 0
                ? ` New registration (${formatPrice(newPrice)}) will require payment.`
                : diff < 0
                ? ` New registration is ${formatPrice(Math.abs(diff))} cheaper, leaving that amount available if escrow is applied at checkout.`
                : ' Same price — full escrow credit then payment of same amount required.'}
            </p>
          </div>
        )}
        <RefundPreviewNote registrationId={reg.id} />

        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!newSubjectId || mutation.isPending}
            className="flex-1"
          >
            {mutation.isPending ? 'Swapping...' : 'Confirm Swap'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  userRole: string | null;
  userId: string;
}

export default function RegistrationsClient({ userRole, userId }: Props): React.JSX.Element {
  const isParent = userRole === 'parent';
  const qc = useQueryClient();
  const router = useRouter();

  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  // Modal state
  const [dropTarget, setDropTarget]       = useState<Registration | null>(null);
  const [swapTarget, setSwapTarget]       = useState<Registration | null>(null);
  const [directDropTarget, setDirectDropTarget] = useState<Registration | null>(null);
  const [directSwapTarget, setDirectSwapTarget] = useState<Registration | null>(null);
  const [actionError, setActionError] = useState('');
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<Set<string>>(new Set());

  const invalidateRegistrations = () => {
    qc.invalidateQueries({ queryKey: ['registrations'] });
    qc.invalidateQueries({ queryKey: ['change-requests'] });
    router.refresh();
  };

  const invalidateAfterEscrowChange = (studentId: string, escrowDelta: number) => {
    invalidateFinancialState(qc, { studentId, escrowDelta });
    router.refresh();
  };

  const revertApprovalMutation = useMutation({
    mutationFn: (reg: Registration) =>
      apiResponse(
        api.v1.registrations['revert-approval'].$put({
          json: { registrationIds: [reg.id] },
        })
      ),
    onSuccess: (_data, reg) => {
      setActionError('');
      setSelectedPaymentIds((prev) => {
        const next = new Set(prev);
        next.delete(reg.id);
        return next;
      });
      invalidateFinancialState(qc);
      router.refresh();
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const handleRevertApproval = (reg: Registration) => {
    const ok = window.confirm(
      `Move ${reg.subject.name} back to pending parent approval? You can approve it again later, but it will not be included in payment right now.`
    );
    if (!ok) return;
    revertApprovalMutation.mutate(reg);
  };

  const togglePaymentSelection = (reg: Registration) => {
    if (reg.status !== 'pending_payment') return;
    setSelectedPaymentIds((prev) => {
      const next = new Set(prev);
      if (next.has(reg.id)) next.delete(reg.id);
      else next.add(reg.id);
      return next;
    });
  };

  const setGroupPaymentSelection = (ids: string[], selected: boolean) => {
    setSelectedPaymentIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const { data: registrations = [] } = useSuspenseQuery<Registration[]>({
    queryKey: ['registrations', 'list'],
    queryFn: () => apiResponse(api.v1.registrations.$get({ query: {} })),
  });

  const grouped = useMemo(() => {
    const filtered = registrations.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (selectedStudentId && r.studentId !== selectedStudentId) return false;
      return true;
    });

    const map = new Map<string, { session: Session; student: Student; regs: Registration[] }>();
    for (const reg of filtered) {
      const key = `${reg.session.id}__${reg.studentId}`;
      if (!map.has(key)) {
        map.set(key, { session: reg.session, student: reg.student, regs: [] });
      }
      map.get(key)!.regs.push(reg);
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        new Date(b.regs[0]?.createdAt ?? 0).getTime() -
        new Date(a.regs[0]?.createdAt ?? 0).getTime()
    );
  }, [registrations, statusFilter, selectedStudentId]);

  const uniqueStudents = useMemo(() => {
    const seen = new Map<string, Student>();
    for (const reg of registrations) {
      if (!seen.has(reg.studentId)) seen.set(reg.studentId, reg.student);
    }
    return Array.from(seen.values());
  }, [registrations]);

  if (registrations.length === 0) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
        <div className="bg-card rounded-xl border border-border shadow-sm p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-foreground font-display mb-2">No Registrations Yet</h2>
          <p className="text-muted-foreground text-sm mb-6">
            {isParent
              ? 'No subjects have been registered for your children yet.'
              : 'You have not registered for any subjects yet.'}
          </p>
          <Link href={"/register" as never}>
            <Button>Register Subjects</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="px-6 py-8 max-w-5xl mx-auto space-y-6 animate-fade-up">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">
              {isParent ? "Children's Registrations" : 'My Registrations'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {registrations.length} registration{registrations.length !== 1 ? 's' : ''} total
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!isParent && (
              <Link href={"/pending-requests" as never}>
                <Button variant="outline" size="sm" className="text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100">
                  My Requests
                </Button>
              </Link>
            )}
            <Link href={"/registrations/history" as never}>
              <Button variant="outline" size="sm">Full History</Button>
            </Link>
            <Link href={"/register" as never}>
              <Button size="sm">+ Register More</Button>
            </Link>
          </div>
        </div>

        {actionError && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {actionError}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            {['all', 'pending_approval', 'pending_payment', 'confirmed', 'dropped', 'rejected'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 transition-colors ${
                  statusFilter === s
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                {s === 'all' ? 'All' : REGISTRATION_STATUS_LABELS[s as keyof typeof REGISTRATION_STATUS_LABELS] ?? s}
              </button>
            ))}
          </div>
          {isParent && uniqueStudents.length > 1 && (
            <select
              value={selectedStudentId ?? ''}
              onChange={(e) => setSelectedStudentId(e.target.value || null)}
              className="rounded-lg border border-border bg-card text-foreground text-sm px-3 py-1.5"
            >
              <option value="">All Children</option>
              {uniqueStudents.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Registration Groups */}
        {grouped.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">No registrations match the selected filter.</div>
        ) : (
          <div className="space-y-6">
            {grouped.map(({ session, student, regs }) => {
              const sessionTotal = regs
                .filter((r) => !['dropped', 'rejected'].includes(r.status))
                .reduce((sum, r) => sum + r.priceAtRegistration, 0);

              return (
                <div key={`${session.id}__${student.id}`} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                  <div className="bg-muted px-5 py-3 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-foreground">{session.name}</span>
                      {isParent && (
                        <span className="ml-2 text-sm text-muted-foreground">
                          · {student.name}{student.grade ? ` (Grade ${student.grade})` : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        session.status === 'active' ? 'bg-brand-50 text-brand-700' :
                        session.status === 'draft' ? 'bg-muted text-muted-foreground' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {session.status}
                      </span>
                      <span className="text-sm font-semibold text-foreground">{formatPrice(sessionTotal)}</span>
                    </div>
                  </div>

                  {/* Pending payment selection for parents */}
                  {isParent && (() => {
                    const ppRegs = regs.filter((r) => r.status === 'pending_payment');
                    if (ppRegs.length === 0) return null;
                    const pendingIds = ppRegs.map((r) => r.id);
                    const selectedRegs = ppRegs.filter((r) => selectedPaymentIds.has(r.id));
                    const selectedTotal = selectedRegs.reduce((sum, r) => sum + r.priceAtRegistration, 0);
                    const allSelected = selectedRegs.length === ppRegs.length;
                    const checkoutIds = selectedRegs.map((r) => r.id).join(',');
                    return (
                      <div className="px-4 py-3 bg-brand-50 border-b border-border flex items-center justify-between gap-3 flex-wrap">
                        <div className="text-xs text-brand-700">
                          <span className="font-medium">{ppRegs.length}</span> awaiting payment
                          {selectedRegs.length > 0 && (
                            <span>
                              {' '}· {selectedRegs.length} selected · {formatPrice(selectedTotal)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setGroupPaymentSelection(pendingIds, !allSelected)}
                          >
                            {allSelected ? 'Clear' : 'Select All'}
                          </Button>
                          {selectedRegs.length > 0 ? (
                            <Link href={`/checkout?ids=${checkoutIds}` as never}>
                              <Button size="sm">
                                Pay Selected
                              </Button>
                            </Link>
                          ) : (
                            <Button size="sm" disabled>
                              Pay Selected
                            </Button>
                          )}
                          <Link href={`/checkout?ids=${pendingIds.join(',')}` as never}>
                            <Button size="sm" variant="outline">Pay All</Button>
                          </Link>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="p-4 space-y-3">
                    {regs.map((reg) => (
                      <RegistrationCard
                        key={reg.id}
                        reg={reg}
                        userRole={userRole}
                        userId={userId}
                        sessionActive={session.status === 'active'}
                        onRequestDrop={setDropTarget}
                        onRequestSwap={setSwapTarget}
                        onDirectDrop={setDirectDropTarget}
                        onDirectSwap={setDirectSwapTarget}
                        onRevertApproval={handleRevertApproval}
                        isRevertingApproval={revertApprovalMutation.isPending}
                        paymentSelected={selectedPaymentIds.has(reg.id)}
                        onTogglePaymentSelection={togglePaymentSelection}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!isParent && registrations.some((r) => r.status === 'pending_approval') && (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-4 text-sm text-amber-800 dark:text-amber-300">
            You have pending requests awaiting parent approval. Share the{' '}
            <Link href={"/approvals" as never} className="underline font-medium">approvals link</Link>{' '}
            with your parent.
          </div>
        )}
      </div>

      {/* Modals */}
      {dropTarget && (
        <RequestDropModal
          reg={dropTarget}
          onClose={() => setDropTarget(null)}
          onSuccess={invalidateRegistrations}
        />
      )}
      {swapTarget && (
        <RequestSwapModal
          reg={swapTarget}
          onClose={() => setSwapTarget(null)}
          onSuccess={invalidateRegistrations}
        />
      )}
      {directDropTarget && (
        <DirectDropModal
          reg={directDropTarget}
          onClose={() => setDirectDropTarget(null)}
          onSuccess={invalidateAfterEscrowChange}
        />
      )}
      {directSwapTarget && (
        <DirectSwapModal
          reg={directSwapTarget}
          onClose={() => setDirectSwapTarget(null)}
          onSuccess={invalidateAfterEscrowChange}
        />
      )}
    </>
  );
}
