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
import { api } from '~/lib/hono';
import { apiResponse, CHANGE_REQUEST_STATUS_LABELS } from '@repo/validations';

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
    subject: { id: string; name: string; subjectCode: string | null };
    session: { id: string; name: string; sessionType: string };
  };
  newSubject: { id: string; name: string; subjectCode: string | null } | null;
};

// ─── Style Maps ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  pending_approval: 'bg-amber-100 text-amber-800',
  approved:         'bg-green-100 text-green-800',
  rejected:         'bg-red-100 text-red-800',
};

const TYPE_STYLES: Record<string, string> = {
  drop: 'bg-red-50 text-red-700',
  swap: 'bg-blue-50 text-blue-700',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function PendingRequestsClient() {
  const { data: requests = [], isLoading } = useQuery<ChangeRequest[]>({
    queryKey: ['change-requests', 'mine'],
    queryFn: () => apiResponse(api.v1['change-requests'].$get({ query: {} })),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  const pending  = requests.filter((r) => r.status === 'pending_approval');
  const resolved = requests.filter((r) => r.status !== 'pending_approval');

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-2xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">My Pending Requests</h1>
          <p className="text-sm text-gray-500 mt-1">
            Drop and swap requests waiting for parent approval.
          </p>
        </div>

        {/* Awaiting Approval */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Awaiting Approval ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-400">
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
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
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
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
            <p className="text-gray-400 text-sm">No change requests submitted yet.</p>
            <p className="text-gray-400 text-xs mt-1">
              Visit your registrations to request a drop or swap.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Change Request Card ──────────────────────────────────────────────────────

function ChangeRequestCard({ request }: { request: ChangeRequest }) {
  const isCredit    = request.priceDifference <= 0;
  const absImpact   = Math.abs(request.priceDifference);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${TYPE_STYLES[request.type] ?? 'bg-gray-50 text-gray-600'}`}>
              {request.type}
            </span>
            <span className="text-sm font-semibold text-gray-900">
              {request.registration.subject.name}
            </span>
            {request.registration.subject.subjectCode && (
              <span className="text-xs text-gray-400">{request.registration.subject.subjectCode}</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {request.registration.session.name} · Submitted {new Date(request.createdAt).toLocaleDateString()}
          </p>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[request.status] ?? 'bg-gray-100 text-gray-700'}`}>
          {CHANGE_REQUEST_STATUS_LABELS[request.status as keyof typeof CHANGE_REQUEST_STATUS_LABELS] ?? request.status}
        </span>
      </div>

      {/* Swap target */}
      {request.type === 'swap' && request.newSubject && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-gray-400">→ Swap to:</span>
          <span className="font-medium text-gray-800">{request.newSubject.name}</span>
          {request.newSubject.subjectCode && (
            <span className="text-xs text-gray-400">{request.newSubject.subjectCode}</span>
          )}
        </div>
      )}

      {/* Financial impact */}
      <div className="mt-3 flex items-center gap-4 text-sm">
        <div>
          <span className="text-gray-400 text-xs">Original price</span>
          <p className="font-medium text-gray-700">{request.registration.priceAtRegistration.toFixed(2)} EGP</p>
        </div>
        {request.type === 'swap' && (
          <div>
            <span className="text-gray-400 text-xs">New subject price</span>
            <p className="font-medium text-gray-700">{request.priceAtRequest.toFixed(2)} EGP</p>
          </div>
        )}
        <div>
          <span className="text-gray-400 text-xs">Financial impact</span>
          <p className={`font-semibold ${isCredit ? 'text-green-700' : 'text-amber-700'}`}>
            {isCredit
              ? `+${absImpact.toFixed(2)} EGP escrow credit`
              : `-${absImpact.toFixed(2)} EGP additional payment needed`}
          </p>
        </div>
      </div>

      {/* Reason */}
      <p className="mt-3 text-xs text-gray-500 bg-gray-50 rounded p-2">
        Reason: {request.reason}
      </p>

      {/* Parent comments */}
      {request.comments && (
        <div className={`mt-2 text-xs rounded p-2 ${
          request.status === 'rejected'
            ? 'bg-red-50 text-red-700'
            : 'bg-green-50 text-green-700'
        }`}>
          Parent note: {request.comments}
        </div>
      )}

      {/* Processed timestamp */}
      {request.processedAt && (
        <p className="mt-2 text-xs text-gray-400">
          Processed: {new Date(request.processedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
