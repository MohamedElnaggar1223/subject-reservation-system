'use client';

/**
 * Registration History Client
 *
 * Full audit trail view for a student's registrations across all sessions.
 *
 * Student view: sees own history immediately (no child selector).
 * Parent view: child selector dropdown; switches history when a child is chosen.
 *
 * Each registration card shows:
 * - Subject name, code, council
 * - Registration status with badge
 * - Price at registration (price snapshot)
 * - Session name and status (active / closed)
 * - Audit trail timeline:
 *   1. Requested by (student or parent) + timestamp
 *   2. Approved / Rejected by (parent or admin) + timestamp + comments
 *   3. Dropped at (if applicable)
 *   4. Change requests (drop/swap requests made after confirmation)
 *      - Type (drop / swap), status, requester, approver, financial impact, comments
 *
 * Grouped by session (most recent session first).
 * Full-width layout — designed for information density.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '~/lib/hono';
import { apiResponse, COUNCIL_LABELS, REGISTRATION_STATUS_LABELS, CHANGE_REQUEST_STATUS_LABELS } from '@repo/validations';

// ─── Types ────────────────────────────────────────────────────────────────────

type AuditUser = { id: string; name: string; role: string | null } | null;

type ChangeRequestAudit = {
  id: string;
  type: 'drop' | 'swap';
  status: string;
  reason: string;
  priceAtRequest: number;
  priceDifference: number;
  comments: string | null;
  createdAt: string;
  processedAt: string | null;
  newSubject: { id: string; name: string; subjectCode: string | null } | null;
  requestedByUser: { id: string; name: string } | null;
  approvedByUser:  { id: string; name: string } | null;
};

type HistoryRegistration = {
  id: string;
  studentId: string;
  priceAtRegistration: number;
  status: string;
  approvalComments: string | null;
  droppedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  subject: {
    id: string;
    name: string;
    subjectCode: string | null;
    council: string;
    isCore: boolean | null;
  };
  session: {
    id: string;
    name: string;
    sessionType: string;
    status: string;
    startDate: string;
    endDate: string;
  };
  requestedByUser: AuditUser;
  approvedByUser:  AuditUser;
  changeRequests:  ChangeRequestAudit[];
};

type LinkedChild = {
  id: string;
  name: string;
  grade: number | null;
};

// ─── Style Maps ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  pending_approval: 'bg-amber-100 text-amber-800',
  pending_payment:  'bg-blue-100 text-blue-800',
  confirmed:        'bg-green-100 text-green-800',
  dropped:          'bg-slate-200 text-slate-600',
  rejected:         'bg-red-100 text-red-700',
};

const CR_STATUS_STYLES: Record<string, string> = {
  pending_approval: 'bg-amber-50 text-amber-700',
  approved:         'bg-green-50 text-green-700',
  rejected:         'bg-red-50 text-red-700',
};

const SESSION_TYPE_LABELS: Record<string, string> = {
  june:     'June',
  november: 'November',
  january:  'January',
};

function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtPrice(n: number) {
  return new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 }).format(n);
}

function roleBadge(role: string | null | undefined) {
  if (role === 'parent') return '(Parent)';
  if (role === 'admin')  return '(Admin)';
  return '(Student)';
}

// ─── Change Request Timeline Entry ───────────────────────────────────────────

function ChangeRequestEntry({ cr }: { cr: ChangeRequestAudit }) {
  const isCredit = cr.priceDifference <= 0;
  return (
    <div className={`mt-2 rounded-lg border px-4 py-3 text-xs ${
      cr.status === 'rejected'
        ? 'border-red-100 bg-red-50'
        : cr.status === 'approved'
        ? 'border-green-100 bg-green-50'
        : 'border-amber-100 bg-amber-50'
    }`}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded font-semibold uppercase text-xs ${
            cr.type === 'drop' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
          }`}>
            {cr.type}
          </span>
          <span className="text-gray-600">Request</span>
          {cr.newSubject && (
            <span className="text-gray-500">→ {cr.newSubject.name}</span>
          )}
        </div>
        <span className={`px-2 py-0.5 rounded-full font-medium ${CR_STATUS_STYLES[cr.status] ?? 'bg-gray-50 text-gray-600'}`}>
          {CHANGE_REQUEST_STATUS_LABELS[cr.status as keyof typeof CHANGE_REQUEST_STATUS_LABELS] ?? cr.status}
        </span>
      </div>

      <div className="space-y-1 text-gray-600">
        <p>Requested by <span className="font-medium text-gray-800">{cr.requestedByUser?.name ?? 'Unknown'}</span> · {fmt(cr.createdAt)}</p>
        {cr.approvedByUser && cr.processedAt && (
          <p>
            {cr.status === 'approved' ? 'Approved' : 'Rejected'} by{' '}
            <span className="font-medium text-gray-800">{cr.approvedByUser.name}</span>{' '}
            · {fmt(cr.processedAt)}
          </p>
        )}
        <p className="text-gray-500 italic">Reason: {cr.reason}</p>
        {cr.comments && (
          <p className={cr.status === 'rejected' ? 'text-red-600' : 'text-green-700'}>
            Parent note: &ldquo;{cr.comments}&rdquo;
          </p>
        )}
        {cr.status === 'approved' && (
          <p className={isCredit ? 'text-green-700' : 'text-amber-700'}>
            Financial impact:{' '}
            {isCredit
              ? `+${fmtPrice(Math.abs(cr.priceDifference))} escrow credit`
              : `${fmtPrice(cr.priceDifference)} additional payment`}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Registration History Card ────────────────────────────────────────────────

function HistoryCard({ reg }: { reg: HistoryRegistration }) {
  const [expanded, setExpanded] = useState(false);
  const hasTrail = !!(reg.approvedByUser || reg.droppedAt || reg.changeRequests.length > 0);
  const councilLabel = COUNCIL_LABELS[reg.subject.council as keyof typeof COUNCIL_LABELS] ?? reg.subject.council;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Card header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900">{reg.subject.name}</span>
              {reg.subject.subjectCode && (
                <span className="text-xs text-gray-400">{reg.subject.subjectCode}</span>
              )}
              {reg.subject.isCore && (
                <span className="px-1.5 py-0.5 text-xs bg-indigo-50 text-indigo-700 rounded font-medium">Core</span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{councilLabel}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_STYLES[reg.status] ?? 'bg-gray-100 text-gray-600'}`}>
              {REGISTRATION_STATUS_LABELS[reg.status as keyof typeof REGISTRATION_STATUS_LABELS] ?? reg.status}
            </span>
            <span className="text-sm font-bold text-gray-700">{fmtPrice(reg.priceAtRegistration)}</span>
          </div>
        </div>

        {/* Basic audit row */}
        <div className="mt-3 text-xs text-gray-500 space-y-1">
          <p>
            Requested by{' '}
            <span className="font-medium text-gray-700">{reg.requestedByUser?.name ?? 'Unknown'}</span>{' '}
            {roleBadge(reg.requestedByUser?.role)} · {fmt(reg.createdAt)}
          </p>
          {reg.approvedByUser && reg.approvedAt && (
            <p>
              {reg.status === 'rejected' ? 'Rejected' : 'Approved'} by{' '}
              <span className="font-medium text-gray-700">{reg.approvedByUser.name}</span>{' '}
              {roleBadge(reg.approvedByUser.role)} · {fmt(reg.approvedAt)}
            </p>
          )}
          {reg.approvalComments && (
            <p className={`italic ${reg.status === 'rejected' ? 'text-red-600' : 'text-gray-500'}`}>
              &ldquo;{reg.approvalComments}&rdquo;
            </p>
          )}
          {reg.droppedAt && (
            <p className="text-slate-500">Dropped on {fmt(reg.droppedAt)}</p>
          )}
        </div>

        {/* Expand/collapse for change requests */}
        {hasTrail && reg.changeRequests.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-3 text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
          >
            {expanded ? '▲ Hide' : '▼ Show'} {reg.changeRequests.length} change request{reg.changeRequests.length !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Change request audit entries */}
      {expanded && reg.changeRequests.length > 0 && (
        <div className="border-t border-gray-100 px-4 pb-4 pt-3 bg-gray-50 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Change Request History</p>
          {reg.changeRequests.map((cr) => (
            <ChangeRequestEntry key={cr.id} cr={cr} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface HistoryClientProps {
  userRole: string | null;
  userId: string;
  initialStudentId: string | null;
}

export default function HistoryClient({ userRole, userId, initialStudentId }: HistoryClientProps) {
  const isParent = userRole === 'parent';
  const [selectedChildId, setSelectedChildId] = useState<string | null>(initialStudentId);

  const targetStudentId = isParent ? selectedChildId : userId;

  // Children list for parent selector
  const { data: children = [] } = useQuery<LinkedChild[]>({
    queryKey: ['links', 'children'],
    queryFn: () => apiResponse(api.v1.links.children.$get()),
    enabled: isParent,
  });

  // History data
  const { data: history = [], isLoading } = useQuery<HistoryRegistration[]>({
    queryKey: ['registrations', 'history', targetStudentId],
    queryFn: () =>
      apiResponse(
        api.v1.registrations.history.$get({
          query: isParent && targetStudentId ? { studentId: targetStudentId } : {},
        })
      ),
    enabled: !!targetStudentId,
  });

  // Group by session
  const grouped = (() => {
    const map = new Map<string, { session: HistoryRegistration['session']; regs: HistoryRegistration[] }>();
    for (const reg of history) {
      const sid = reg.session.id;
      if (!map.has(sid)) map.set(sid, { session: reg.session, regs: [] });
      map.get(sid)!.regs.push(reg);
    }
    // Sort sessions newest-first
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.session.endDate).getTime() - new Date(a.session.endDate).getTime()
    );
  })();

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-3xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Registration History</h1>
            <p className="text-sm text-gray-500 mt-1">
              Full audit trail across all sessions.
            </p>
          </div>
          <Link
            href="/registrations"
            className="text-sm text-indigo-600 hover:text-indigo-800 underline"
          >
            ← Back to Registrations
          </Link>
        </div>

        {/* Parent: child selector */}
        {isParent && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select Child
            </label>
            <select
              value={selectedChildId ?? ''}
              onChange={(e) => setSelectedChildId(e.target.value || null)}
              className="w-full sm:w-64 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select a child</option>
              {children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.name}{child.grade ? ` (Grade ${child.grade})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* No child selected yet (parent) */}
        {isParent && !selectedChildId && (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-sm text-gray-400">
            Select a child above to view their registration history.
          </div>
        )}

        {/* Loading */}
        {isLoading && targetStudentId && (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-600 border-t-transparent" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && targetStudentId && history.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
            <p className="text-gray-400 text-sm">No registrations found.</p>
            <Link href="/register" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
              Register for subjects →
            </Link>
          </div>
        )}

        {/* History grouped by session */}
        {!isLoading && grouped.length > 0 && (
          <div className="space-y-8">
            {grouped.map(({ session, regs }) => {
              const totalPaid = regs
                .filter((r) => r.status === 'confirmed')
                .reduce((s, r) => s + r.priceAtRegistration, 0);
              const totalDropped = regs
                .filter((r) => r.status === 'dropped')
                .reduce((s, r) => s + r.priceAtRegistration, 0);

              return (
                <div key={session.id}>
                  {/* Session header */}
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                    <div>
                      <h2 className="text-base font-bold text-gray-800">
                        {session.name}
                        <span className="ml-2 text-xs font-normal text-gray-400">
                          {SESSION_TYPE_LABELS[session.sessionType] ?? session.sessionType}
                        </span>
                      </h2>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {fmt(session.startDate)} — {fmt(session.endDate)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        session.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {session.status}
                      </span>
                      <div className="text-xs text-right">
                        {totalPaid > 0 && (
                          <p className="text-green-700 font-semibold">Confirmed: {fmtPrice(totalPaid)}</p>
                        )}
                        {totalDropped > 0 && (
                          <p className="text-slate-500">Dropped: {fmtPrice(totalDropped)}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Stats bar */}
                  <div className="flex gap-2 flex-wrap mb-3 text-xs">
                    {(['confirmed', 'pending_payment', 'pending_approval', 'dropped', 'rejected'] as const).map((s) => {
                      const count = regs.filter((r) => r.status === s).length;
                      if (count === 0) return null;
                      return (
                        <span key={s} className={`px-2 py-0.5 rounded-full ${STATUS_STYLES[s]}`}>
                          {REGISTRATION_STATUS_LABELS[s]} × {count}
                        </span>
                      );
                    })}
                  </div>

                  {/* Registration cards */}
                  <div className="space-y-3">
                    {regs.map((reg) => (
                      <HistoryCard key={reg.id} reg={reg} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
