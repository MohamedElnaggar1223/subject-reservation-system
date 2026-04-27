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
import { formatPrice } from '~/lib/format';
import { apiResponse, COUNCIL_LABELS, REGISTRATION_STATUS_LABELS, CHANGE_REQUEST_STATUS_LABELS } from '@repo/validations';
import { Button } from '~/components/ui/button';

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
  newSubject: { id: string; name: string; code: string | null } | null;
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
    code: string | null;
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

const fetchChildren = () => apiResponse(api.v1.links.children.$get());
type LinkedChild = Awaited<ReturnType<typeof fetchChildren>>[number];

// ─── Style Maps ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  pending_approval: 'bg-amber-50 text-amber-700',
  pending_payment:  'bg-brand-50 text-brand-700',
  confirmed:        'bg-emerald-50 text-emerald-700',
  dropped:          'bg-muted text-muted-foreground',
  rejected:         'bg-destructive/10 text-destructive',
};

const CR_STATUS_STYLES: Record<string, string> = {
  pending_approval: 'bg-amber-50 text-amber-700',
  approved:         'bg-emerald-50 text-emerald-700',
  rejected:         'bg-destructive/10 text-destructive',
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
        ? 'border-destructive/20 bg-destructive/5'
        : cr.status === 'approved'
        ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20'
        : 'border-amber-200 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20'
    }`}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded font-semibold uppercase text-xs ${
            cr.type === 'drop' ? 'bg-destructive/10 text-destructive' : 'bg-brand-50 text-brand-700'
          }`}>
            {cr.type}
          </span>
          <span className="text-muted-foreground">Request</span>
          {cr.newSubject && (
            <span className="text-muted-foreground">→ {cr.newSubject.name}</span>
          )}
        </div>
        <span className={`px-2 py-0.5 rounded-full font-medium ${CR_STATUS_STYLES[cr.status] ?? 'bg-muted text-muted-foreground'}`}>
          {CHANGE_REQUEST_STATUS_LABELS[cr.status as keyof typeof CHANGE_REQUEST_STATUS_LABELS] ?? cr.status}
        </span>
      </div>

      <div className="space-y-1 text-muted-foreground">
        <p>Requested by <span className="font-medium text-foreground">{cr.requestedByUser?.name ?? 'Unknown'}</span> · {fmt(cr.createdAt)}</p>
        {cr.approvedByUser && cr.processedAt && (
          <p>
            {cr.status === 'approved' ? 'Approved' : 'Rejected'} by{' '}
            <span className="font-medium text-foreground">{cr.approvedByUser.name}</span>{' '}
            · {fmt(cr.processedAt)}
          </p>
        )}
        <p className="italic">Reason: {cr.reason}</p>
        {cr.comments && (
          <p className={cr.status === 'rejected' ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400'}>
            Parent note: &ldquo;{cr.comments}&rdquo;
          </p>
        )}
        {cr.status === 'approved' && (
          <p className={isCredit ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
            Financial impact:{' '}
            {isCredit
              ? `+${formatPrice(Math.abs(cr.priceDifference))} escrow credit`
              : `${formatPrice(cr.priceDifference)} additional payment`}
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
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* Card header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground">{reg.subject.name}</span>
              {reg.subject.code && (
                <span className="text-xs text-muted-foreground">{reg.subject.code}</span>
              )}
              {reg.subject.isCore && (
                <span className="px-1.5 py-0.5 text-xs bg-brand-50 text-brand-700 rounded font-medium">Core</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{councilLabel}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_STYLES[reg.status] ?? 'bg-muted text-muted-foreground'}`}>
              {REGISTRATION_STATUS_LABELS[reg.status as keyof typeof REGISTRATION_STATUS_LABELS] ?? reg.status}
            </span>
            <span className="text-sm font-bold text-foreground">{formatPrice(reg.priceAtRegistration)}</span>
          </div>
        </div>

        {/* Basic audit row */}
        <div className="mt-3 text-xs text-muted-foreground space-y-1">
          <p>
            Requested by{' '}
            <span className="font-medium text-foreground">{reg.requestedByUser?.name ?? 'Unknown'}</span>{' '}
            {roleBadge(reg.requestedByUser?.role)} · {fmt(reg.createdAt)}
          </p>
          {reg.approvedByUser && reg.approvedAt && (
            <p>
              {reg.status === 'rejected' ? 'Rejected' : 'Approved'} by{' '}
              <span className="font-medium text-foreground">{reg.approvedByUser.name}</span>{' '}
              {roleBadge(reg.approvedByUser.role)} · {fmt(reg.approvedAt)}
            </p>
          )}
          {reg.approvalComments && (
            <p className={`italic ${reg.status === 'rejected' ? 'text-destructive' : 'text-muted-foreground'}`}>
              &ldquo;{reg.approvalComments}&rdquo;
            </p>
          )}
          {reg.droppedAt && (
            <p>Dropped on {fmt(reg.droppedAt)}</p>
          )}
        </div>

        {/* Expand/collapse for change requests */}
        {hasTrail && reg.changeRequests.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-3 text-xs text-primary hover:text-primary/80 flex items-center gap-1"
          >
            {expanded ? 'Hide' : 'Show'} {reg.changeRequests.length} change request{reg.changeRequests.length !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Change request audit entries */}
      {expanded && reg.changeRequests.length > 0 && (
        <div className="border-t border-border px-4 pb-4 pt-3 bg-muted space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Change Request History</p>
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
  const { data: children = [] } = useQuery({
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
    <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Registration History</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Full audit trail across all sessions.
          </p>
        </div>
        <Link href={"/registrations" as never}>
          <Button variant="outline" size="sm">Back to Registrations</Button>
        </Link>
      </div>

      {/* Parent: child selector */}
      {isParent && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-foreground mb-1">
            Select Child
          </label>
          <select
            value={selectedChildId ?? ''}
            onChange={(e) => setSelectedChildId(e.target.value || null)}
            className="w-full sm:w-64 px-3 py-2 text-sm border border-border rounded-lg bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Select a child</option>
            {children.map((child) => (
              <option key={child.student.id} value={child.student.id}>
                {child.student.name}{child.student.grade ? ` (Grade ${child.student.grade})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* No child selected yet (parent) */}
      {isParent && !selectedChildId && (
        <div className="bg-card rounded-xl border border-border p-10 text-center text-sm text-muted-foreground">
          Select a child above to view their registration history.
        </div>
      )}

      {/* Loading */}
      {isLoading && targetStudentId && (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && targetStudentId && history.length === 0 && (
        <div className="bg-card rounded-xl border border-border p-10 text-center">
          <p className="text-muted-foreground text-sm">No registrations found.</p>
          <Link href={"/register" as never} className="mt-4 inline-block text-sm text-primary hover:underline">
            Register for subjects
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
                    <h2 className="text-base font-bold text-foreground font-display">
                      {session.name}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {SESSION_TYPE_LABELS[session.sessionType] ?? session.sessionType}
                      </span>
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fmt(session.startDate)} — {fmt(session.endDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                      session.status === 'active'
                        ? 'bg-brand-50 text-brand-700'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {session.status}
                    </span>
                    <div className="text-xs text-right">
                      {totalPaid > 0 && (
                        <p className="text-emerald-700 dark:text-emerald-400 font-semibold">Confirmed: {formatPrice(totalPaid)}</p>
                      )}
                      {totalDropped > 0 && (
                        <p className="text-muted-foreground">Dropped: {formatPrice(totalDropped)}</p>
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
                        {REGISTRATION_STATUS_LABELS[s]} x {count}
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
  );
}
