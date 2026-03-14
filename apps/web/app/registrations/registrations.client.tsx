'use client';

import { useState, useMemo } from 'react';
import { useSuspenseQuery, useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '~/lib/hono';
import { apiResponse, REGISTRATION_STATUS_LABELS, COUNCIL_LABELS } from '@repo/validations';

// ─── Types ────────────────────────────────────────────────────────────────────

type Subject = {
  id: string;
  name: string;
  code: string;
  council: string;
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
  subjectCode: string | null;
  council: string;
  priceInSchool: number | null;
  customPrice: number | null;
  isOfferedAtSchool: boolean | null;
};

// ─── Status Styling ───────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  pending_approval: 'bg-amber-100 text-amber-800',
  pending_payment:  'bg-blue-100 text-blue-800',
  confirmed:        'bg-green-100 text-green-800',
  dropped:          'bg-slate-100 text-slate-600',
  rejected:         'bg-red-100 text-red-700',
};

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
  }).format(price);
}

function resolvePrice(sub: AvailableSubject): number {
  if (!sub.isOfferedAtSchool || sub.priceInSchool == null) return sub.customPrice ?? 0;
  return sub.priceInSchool;
}

// ─── Modal Wrapper ────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
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
  sessionActive,
  onRequestDrop,
  onRequestSwap,
  onDirectDrop,
  onDirectSwap,
}: {
  reg: Registration;
  userRole: string | null;
  sessionActive: boolean;
  onRequestDrop: (reg: Registration) => void;
  onRequestSwap: (reg: Registration) => void;
  onDirectDrop: (reg: Registration) => void;
  onDirectSwap: (reg: Registration) => void;
}) {
  const statusLabel =
    REGISTRATION_STATUS_LABELS[reg.status as keyof typeof REGISTRATION_STATUS_LABELS] ?? reg.status;
  const councilLabel =
    COUNCIL_LABELS[reg.subject.council as keyof typeof COUNCIL_LABELS] ?? reg.subject.council;

  const canChange = reg.status === 'confirmed' && sessionActive;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-slate-800 truncate">{reg.subject.name}</div>
          <div className="text-xs text-slate-400 mt-0.5">
            {reg.subject.code} · {councilLabel}
          </div>
          {reg.approvalComments && (
            <div className={`text-xs mt-2 rounded p-2 ${
              reg.status === 'rejected'
                ? 'bg-red-50 text-red-600'
                : 'bg-slate-50 text-slate-500'
            }`}>
              &ldquo;{reg.approvalComments}&rdquo;
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${STATUS_STYLES[reg.status] ?? ''}`}>
            {statusLabel}
          </span>
          <span className="text-sm font-semibold text-slate-700">
            {formatPrice(reg.priceAtRegistration)}
          </span>
        </div>
      </div>

      {/* Pending payment notice */}
      {reg.status === 'pending_payment' && userRole === 'student' && (
        <div className="mt-3 text-xs text-blue-600 bg-blue-50 rounded p-2">
          Approved by parent — awaiting payment.
        </div>
      )}

      {/* Drop / Swap actions */}
      {canChange && (
        <div className="mt-3 flex gap-2">
          {userRole === 'student' && (
            <>
              <button
                onClick={() => onRequestDrop(reg)}
                className="flex-1 py-1.5 text-xs font-medium border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
              >
                Request Drop
              </button>
              <button
                onClick={() => onRequestSwap(reg)}
                className="flex-1 py-1.5 text-xs font-medium border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
              >
                Request Swap
              </button>
            </>
          )}
          {userRole === 'parent' && (
            <>
              <button
                onClick={() => onDirectDrop(reg)}
                className="flex-1 py-1.5 text-xs font-medium border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
              >
                Drop
              </button>
              <button
                onClick={() => onDirectSwap(reg)}
                className="flex-1 py-1.5 text-xs font-medium border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
              >
                Swap
              </button>
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
        <div className="bg-red-50 rounded-lg p-3 text-sm">
          <p className="font-medium text-red-800">Drop: {reg.subject.name}</p>
          <p className="text-red-600 text-xs mt-1">
            If approved, {formatPrice(reg.priceAtRegistration)} will be credited to your escrow.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
            placeholder="Explain why you want to drop this subject..."
          />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-300 text-sm rounded-xl text-gray-700 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={reason.length < 5 || mutation.isPending}
            className="flex-1 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Submitting...' : 'Submit Request'}
          </button>
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
        <div className="bg-blue-50 rounded-lg p-3 text-sm">
          <p className="font-medium text-blue-800">Swap from: {reg.subject.name}</p>
          <p className="text-blue-600 text-xs mt-1">Current price: {formatPrice(reg.priceAtRegistration)}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">New Subject</label>
          <select
            value={newSubjectId}
            onChange={(e) => setNewSubjectId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
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
          <div className={`text-sm rounded-lg p-3 ${diff > 0 ? 'bg-amber-50' : 'bg-green-50'}`}>
            <p className={`font-medium ${diff > 0 ? 'text-amber-800' : 'text-green-800'}`}>
              Financial impact
            </p>
            <p className={`text-xs mt-1 ${diff > 0 ? 'text-amber-700' : 'text-green-700'}`}>
              {diff > 0
                ? `Additional payment of ${formatPrice(diff)} will be required`
                : diff < 0
                ? `${formatPrice(Math.abs(diff))} will be credited to your escrow`
                : 'Same price — no financial impact'}
            </p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Reason <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            placeholder="Explain why you want to swap this subject..."
          />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-300 text-sm rounded-xl text-gray-700 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!newSubjectId || reason.length < 5 || mutation.isPending}
            className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Submitting...' : 'Submit Request'}
          </button>
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
  onSuccess: () => void;
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
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Modal title="Drop Subject" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          You are about to drop{' '}
          <span className="font-semibold">{reg.subject.name}</span> for{' '}
          <span className="font-semibold">{reg.student.name}</span>.
        </p>
        <div className="bg-green-50 rounded-lg p-3 text-sm">
          <p className="text-green-800 font-medium">
            {formatPrice(reg.priceAtRegistration)} will be credited to the student&apos;s escrow immediately.
          </p>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-300 text-sm rounded-xl text-gray-700 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex-1 py-2.5 bg-red-600 text-white text-sm font-semibold rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Dropping...' : 'Confirm Drop'}
          </button>
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
  onSuccess: () => void;
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
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Modal title="Direct Swap" onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-blue-50 rounded-lg p-3 text-sm">
          <p className="font-medium text-blue-800">Swapping from: {reg.subject.name}</p>
          <p className="text-blue-600 text-xs mt-1">
            {reg.student.name} · Current price: {formatPrice(reg.priceAtRegistration)}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">New Subject</label>
          <select
            value={newSubjectId}
            onChange={(e) => setNewSubjectId(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
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
          <div className={`text-sm rounded-lg p-3 ${diff > 0 ? 'bg-amber-50' : 'bg-green-50'}`}>
            <p className={`font-medium ${diff > 0 ? 'text-amber-800' : 'text-green-800'}`}>
              Financial impact
            </p>
            <p className={`text-xs mt-1 ${diff > 0 ? 'text-amber-700' : 'text-green-700'}`}>
              Old price ({formatPrice(reg.priceAtRegistration)}) credited to escrow.
              {diff > 0
                ? ` New registration (${formatPrice(newPrice)}) will require payment.`
                : diff < 0
                ? ` Difference of ${formatPrice(Math.abs(diff))} credited to escrow on top.`
                : ' Same price — full escrow credit then payment of same amount required.'}
            </p>
          </div>
        )}

        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-300 text-sm rounded-xl text-gray-700 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!newSubjectId || mutation.isPending}
            className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Swapping...' : 'Confirm Swap'}
          </button>
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

  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  // Modal state
  const [dropTarget, setDropTarget]       = useState<Registration | null>(null);
  const [swapTarget, setSwapTarget]       = useState<Registration | null>(null);
  const [directDropTarget, setDirectDropTarget] = useState<Registration | null>(null);
  const [directSwapTarget, setDirectSwapTarget] = useState<Registration | null>(null);

  const invalidateRegistrations = () => qc.invalidateQueries({ queryKey: ['registrations'] });

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
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <div className="rounded-xl border border-slate-200 bg-white p-12">
          <div className="text-4xl mb-4">📋</div>
          <h2 className="text-xl font-semibold text-slate-800 mb-2">No Registrations Yet</h2>
          <p className="text-slate-500 mb-6">
            {isParent
              ? 'No subjects have been registered for your children yet.'
              : 'You have not registered for any subjects yet.'}
          </p>
          <a href="/register" className="inline-block rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2 transition-colors">
            Register Subjects
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {isParent ? "Children's Registrations" : 'My Registrations'}
            </h1>
            <p className="text-slate-500 mt-1">
              {registrations.length} registration{registrations.length !== 1 ? 's' : ''} total
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!isParent && (
              <Link
                href="/pending-requests"
                className="rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 font-medium px-4 py-2 text-sm transition-colors"
              >
                My Requests
              </Link>
            )}
            <Link
              href="/registrations/history"
              className="rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-50 font-medium px-4 py-2 text-sm transition-colors"
            >
              Full History
            </Link>
            <a href="/register" className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 text-sm transition-colors">
              + Register More
            </a>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
            {['all', 'pending_approval', 'pending_payment', 'confirmed', 'dropped', 'rejected'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 transition-colors ${
                  statusFilter === s
                    ? 'bg-slate-800 text-white font-medium'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
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
              className="rounded-lg border border-slate-200 bg-white text-slate-800 text-sm px-3 py-1.5"
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
          <div className="text-center py-8 text-slate-400">No registrations match the selected filter.</div>
        ) : (
          <div className="space-y-6">
            {grouped.map(({ session, student, regs }) => {
              const sessionTotal = regs
                .filter((r) => !['dropped', 'rejected'].includes(r.status))
                .reduce((sum, r) => sum + r.priceAtRegistration, 0);

              return (
                <div key={`${session.id}__${student.id}`} className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-5 py-3 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-slate-800">{session.name}</span>
                      {isParent && (
                        <span className="ml-2 text-sm text-slate-500">
                          · {student.name}{student.grade ? ` (Grade ${student.grade})` : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        session.status === 'active' ? 'bg-green-100 text-green-700' :
                        session.status === 'draft' ? 'bg-slate-100 text-slate-600' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {session.status}
                      </span>
                      <span className="text-sm font-semibold text-slate-700">{formatPrice(sessionTotal)}</span>
                    </div>
                  </div>

                  {/* Pay Now for parents */}
                  {isParent && (() => {
                    const ppRegs = regs.filter((r) => r.status === 'pending_payment');
                    if (ppRegs.length === 0) return null;
                    const ids = ppRegs.map((r) => r.id).join(',');
                    return (
                      <div className="px-4 py-2 bg-blue-50 border-b border-slate-200 flex items-center justify-between">
                        <span className="text-xs text-blue-700">
                          {ppRegs.length} registration(s) awaiting payment
                        </span>
                        <Link href={`/checkout?ids=${ids}`} className="px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
                          Pay Now
                        </Link>
                      </div>
                    );
                  })()}

                  <div className="p-4 space-y-3">
                    {regs.map((reg) => (
                      <RegistrationCard
                        key={reg.id}
                        reg={reg}
                        userRole={userRole}
                        sessionActive={session.status === 'active'}
                        onRequestDrop={setDropTarget}
                        onRequestSwap={setSwapTarget}
                        onDirectDrop={setDirectDropTarget}
                        onDirectSwap={setDirectSwapTarget}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!isParent && registrations.some((r) => r.status === 'pending_approval') && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
            You have pending requests awaiting parent approval. Share the{' '}
            <a href="/approvals" className="underline font-medium">approvals link</a>{' '}
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
          onSuccess={invalidateRegistrations}
        />
      )}
      {directSwapTarget && (
        <DirectSwapModal
          reg={directSwapTarget}
          onClose={() => setDirectSwapTarget(null)}
          onSuccess={invalidateRegistrations}
        />
      )}
    </>
  );
}
