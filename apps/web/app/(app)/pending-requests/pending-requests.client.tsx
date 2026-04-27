'use client';

/**
 * Pending Requests Client — Students Only (SWAP-007)
 *
 * Student dashboard showing all drop and swap requests with:
 * - Current status with color-coded badges
 * - Subject details (dropping from → swapping to)
 * - Financial impact (credit or additional cost)
 * - Parent comments when approved or rejected
 * - Session information
 */

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '~/lib/hono';
import { apiResponse, CHANGE_REQUEST_STATUS_LABELS } from '@repo/validations';
import { Button } from '~/components/ui/button';

// ─── Types ────────────────────────────────────────────────────────────────────

type ChangeRequest = {
  id: string;
  type: 'drop' | 'swap';
  status: string;
  reason: string;
  priceAtRequest: number;
  priceDifference: number;
  comments: string | null;
  createdAt: string;
  processedAt: string | null;
  registration: {
    priceAtRegistration: number;
    subject: { id: string; name: string; code: string | null };
    session: { id: string; name: string; sessionType: string };
  };
  newSubject: { id: string; name: string; code: string | null } | null;
};

// ─── Style Maps ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  pending_approval: 'bg-amber-50 text-amber-700',
  approved:         'bg-brand-50 text-brand-700',
  rejected:         'bg-destructive/10 text-destructive',
};

const TYPE_STYLES: Record<string, string> = {
  drop: 'bg-destructive/10 text-destructive',
  swap: 'bg-brand-50 text-brand-700',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function PendingRequestsClient() {
  const { data: requests = [], isLoading } = useQuery<ChangeRequest[]>({
    queryKey: ['change-requests', 'mine'],
    queryFn: () => apiResponse(api.v1['change-requests'].$get({ query: {} })),
  });

  if (isLoading) {
    return (
      <div className="px-6 py-8 max-w-5xl mx-auto flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const pending  = requests.filter((r) => r.status === 'pending_approval');
  const resolved = requests.filter((r) => r.status !== 'pending_approval');

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">My Pending Requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop and swap requests waiting for parent approval.
          </p>
        </div>
        <Link href={"/registrations" as never}>
          <Button variant="outline" size="sm">Back to Registrations</Button>
        </Link>
      </div>

      {/* Awaiting Approval */}
      <section className="mb-8">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Awaiting Approval ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
            No pending requests.
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((req) => (
              <ChangeRequestCard key={req.id} request={req} />
            ))}
          </div>
        )}
      </section>

      {/* Resolved */}
      {resolved.length > 0 && (
        <section>
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Processed ({resolved.length})
          </h2>
          <div className="space-y-3">
            {resolved.map((req) => (
              <ChangeRequestCard key={req.id} request={req} />
            ))}
          </div>
        </section>
      )}

      {requests.length === 0 && (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <p className="text-muted-foreground text-sm">No change requests submitted yet.</p>
          <p className="text-muted-foreground text-xs mt-1">
            Visit your registrations to request a drop or swap.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Change Request Card ──────────────────────────────────────────────────────

function ChangeRequestCard({ request }: { request: ChangeRequest }) {
  const isCredit    = request.priceDifference <= 0;
  const absImpact   = Math.abs(request.priceDifference);

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-5">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${TYPE_STYLES[request.type] ?? 'bg-muted text-muted-foreground'}`}>
              {request.type}
            </span>
            <span className="text-sm font-semibold text-foreground">
              {request.registration.subject.name}
            </span>
            {request.registration.subject.code && (
              <span className="text-xs text-muted-foreground">{request.registration.subject.code}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {request.registration.session.name} · Submitted {new Date(request.createdAt).toLocaleDateString()}
          </p>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[request.status] ?? 'bg-muted text-muted-foreground'}`}>
          {CHANGE_REQUEST_STATUS_LABELS[request.status as keyof typeof CHANGE_REQUEST_STATUS_LABELS] ?? request.status}
        </span>
      </div>

      {/* Swap target */}
      {request.type === 'swap' && request.newSubject && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Swap to:</span>
          <span className="font-medium text-foreground">{request.newSubject.name}</span>
          {request.newSubject.code && (
            <span className="text-xs text-muted-foreground">{request.newSubject.code}</span>
          )}
        </div>
      )}

      {/* Financial impact */}
      <div className="mt-3 flex items-center gap-4 text-sm">
        <div>
          <span className="text-muted-foreground text-xs">Original price</span>
          <p className="font-medium text-foreground">{request.registration.priceAtRegistration.toFixed(2)} EGP</p>
        </div>
        {request.type === 'swap' && (
          <div>
            <span className="text-muted-foreground text-xs">New subject price</span>
            <p className="font-medium text-foreground">{request.priceAtRequest.toFixed(2)} EGP</p>
          </div>
        )}
        <div>
          <span className="text-muted-foreground text-xs">Financial impact</span>
          <p className={`font-semibold ${isCredit ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
            {isCredit
              ? `+${absImpact.toFixed(2)} EGP escrow credit`
              : `-${absImpact.toFixed(2)} EGP additional payment needed`}
          </p>
        </div>
      </div>

      {/* Reason */}
      <p className="mt-3 text-xs text-muted-foreground bg-muted rounded-lg p-2">
        Reason: {request.reason}
      </p>

      {/* Parent comments */}
      {request.comments && (
        <div className={`mt-2 text-xs rounded-lg p-2 ${
          request.status === 'rejected'
            ? 'bg-destructive/10 text-destructive'
            : 'bg-brand-50 text-brand-700'
        }`}>
          Parent note: {request.comments}
        </div>
      )}

      {/* Processed timestamp */}
      {request.processedAt && (
        <p className="mt-2 text-xs text-muted-foreground">
          Processed: {new Date(request.processedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
