'use client';

/**
 * Admin Audit Log Viewer Client Component
 *
 * Interactive audit log viewer for admins (REP-006).
 *
 * Features:
 * - Paginated list of all audit log entries (newest first)
 * - Filter by: action type, entity type, date range
 * - Color-coded action badges (create=green, update=blue, delete=red, system=purple)
 * - Expandable row: shows previousData / newData JSON diff
 * - Entity history panel: click any entity ID to see its full chain of custody
 * - "Load more" pagination
 *
 * Chain-of-custody display (REP-006):
 *   "Requested by [Student A] -> Approved by [Parent B] -> Confirmed by [System]"
 */

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse,
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_TYPE_LABELS,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  type AuditAction,
  type AuditEntityType,
} from '@repo/validations';
import { Button } from '~/components/ui/button';

// --- Types ---

type AuditEntry = {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: { id: string; name: string; role: string; email: string } | null;
};

// --- Helpers ---

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatAbsoluteTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// Action category -> badge color
function actionColor(action: string): string {
  if (action.endsWith('_CREATED') || action.endsWith('_REQUESTED') || action.endsWith('_DIRECT') || action.endsWith('_TRANSFER')) {
    return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  }
  if (action.endsWith('_UPDATED') || action.endsWith('_EXTENDED') || action.endsWith('_ACTIVATED')) {
    return 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
  }
  if (action.endsWith('_DEACTIVATED') || action.endsWith('_CLOSED') || action.endsWith('_REJECTED') || action.endsWith('_FAILED')) {
    return 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  }
  if (action.endsWith('_APPROVED') || action.endsWith('_CONFIRMED') || action.endsWith('_FULFILLED') || action.endsWith('_OVERRIDE')) {
    return 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  }
  return 'bg-muted text-muted-foreground';
}

function truncateId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}...` : id;
}

// --- Filters Bar ---

type Filters = {
  action?: AuditAction;
  entityType?: AuditEntityType;
  dateFrom?: string;
  dateTo?: string;
};

function FiltersBar({
  filters,
  onChange,
  onReset,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  onReset: () => void;
}) {
  const hasActive = Object.values(filters).some(Boolean);

  return (
    <div className="flex flex-wrap gap-3 items-end">
      {/* Action filter */}
      <div className="flex flex-col gap-1 min-w-[180px]">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Action</label>
        <select
          value={filters.action ?? ''}
          onChange={(e) => onChange({ ...filters, action: (e.target.value as AuditAction) || undefined })}
          className="rounded-lg border border-border bg-background text-sm px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>{AUDIT_ACTION_LABELS[a]}</option>
          ))}
        </select>
      </div>

      {/* Entity type filter */}
      <div className="flex flex-col gap-1 min-w-[150px]">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Entity type</label>
        <select
          value={filters.entityType ?? ''}
          onChange={(e) => onChange({ ...filters, entityType: (e.target.value as AuditEntityType) || undefined })}
          className="rounded-lg border border-border bg-background text-sm px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All types</option>
          {AUDIT_ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>{AUDIT_ENTITY_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>

      {/* Date From */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">From</label>
        <input
          type="date"
          value={filters.dateFrom ?? ''}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value || undefined })}
          className="rounded-lg border border-border bg-background text-sm px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Date To */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</label>
        <input
          type="date"
          value={filters.dateTo ?? ''}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value || undefined })}
          className="rounded-lg border border-border bg-background text-sm px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {hasActive && (
        <Button
          variant="outline"
          size="sm"
          onClick={onReset}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}

// --- Entity History Panel ---

function EntityHistoryPanel({
  entityType,
  entityId,
  onClose,
}: {
  entityType: string;
  entityId: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit', 'entity', entityType, entityId],
    queryFn: () =>
      apiResponse(
        api.v1.audit.entity[':type'][':id'].$get({
          param: { type: entityType as AuditEntityType, id: entityId },
        })
      ),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground font-display">
              Chain of Custody
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {AUDIT_ENTITY_TYPE_LABELS[entityType as AuditEntityType] ?? entityType} · <span className="font-mono">{truncateId(entityId)}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Timeline */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">Loading history...</div>
          )}
          {isError && (
            <div className="py-8 text-center text-red-500 dark:text-red-400 text-sm">Failed to load entity history.</div>
          )}
          {data && data.length === 0 && (
            <div className="py-8 text-center text-muted-foreground text-sm">No history found for this entity.</div>
          )}
          {data && data.length > 0 && (
            <ol className="relative border-l border-border space-y-6 ml-3">
              {(data as AuditEntry[]).map((entry, idx) => (
                <li key={entry.id} className="ml-6">
                  <span className="absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-900 ring-4 ring-card">
                    <span className="text-[10px] font-bold text-brand-600 dark:text-brand-400">{idx + 1}</span>
                  </span>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${actionColor(entry.action)}`}>
                        {AUDIT_ACTION_LABELS[entry.action as AuditAction] ?? entry.action}
                      </span>
                      <p className="mt-1 text-sm text-card-foreground">
                        {entry.user
                          ? <><span className="font-medium">{entry.user.name}</span> <span className="text-muted-foreground">({entry.user.role})</span></>
                          : <span className="text-muted-foreground italic">System</span>
                        }
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5" title={formatAbsoluteTime(entry.createdAt)}>
                        {formatAbsoluteTime(entry.createdAt)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main Component ---

const PAGE_SIZE = 50;

export default function AuditLogClient() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>({});
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [entityPanel, setEntityPanel] = useState<{ type: string; id: string } | null>(null);

  const queryKey = ['audit', 'logs', filters, offset];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () =>
      apiResponse(
        api.v1.audit.logs.$get({
          query: {
            ...(filters.action     && { action:     filters.action }),
            ...(filters.entityType && { entityType: filters.entityType }),
            ...(filters.dateFrom   && { dateFrom:   filters.dateFrom }),
            ...(filters.dateTo     && { dateTo:     filters.dateTo }),
            limit:  String(PAGE_SIZE),
            offset: String(offset),
          },
        })
      ),
  });

  const handleFilterChange = useCallback((f: Filters) => {
    setFilters(f);
    setOffset(0);
  }, []);

  const handleReset = useCallback(() => {
    setFilters({});
    setOffset(0);
  }, []);

  // The API now returns `{ data: AuditEntry[], total: number }` so the UI
  // can render "showing X of TOTAL" and disable "Next" exactly when no
  // more pages exist. Fall back gracefully if the shape is unexpected.
  const payload = data as { data?: AuditEntry[]; total?: number } | AuditEntry[] | undefined;
  const entries: AuditEntry[] = Array.isArray(payload)
    ? payload
    : payload?.data ?? [];
  const total: number = Array.isArray(payload)
    ? entries.length
    : payload?.total ?? entries.length;

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto animate-fade-up">

      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">
          Audit Log
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Full chain-of-custody record of all system actions. Click any entity ID to view its complete history.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-5 mb-6">
        <FiltersBar
          filters={filters}
          onChange={handleFilterChange}
          onReset={handleReset}
        />
      </div>

      {/* Log Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">

        {/* Loading */}
        {isLoading && (
          <div className="py-16 text-center text-muted-foreground text-sm">Loading audit logs...</div>
        )}

        {/* Error */}
        {isError && (
          <div className="py-16 text-center text-red-500 dark:text-red-400 text-sm">Failed to load audit logs.</div>
        )}

        {/* Empty */}
        {!isLoading && !isError && entries.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-muted-foreground text-sm">No audit log entries match the current filters.</p>
          </div>
        )}

        {/* Table */}
        {!isLoading && entries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left bg-muted">
                  <th className="px-4 py-3 font-medium text-muted-foreground w-36">Time</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Action</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Entity</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Entity ID</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Performed by</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground w-24">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((entry) => (
                  <>
                    <tr
                      key={entry.id}
                      className="hover:bg-muted/50 transition-colors"
                    >
                      {/* Time */}
                      <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap" title={formatAbsoluteTime(entry.createdAt)}>
                        {formatRelativeTime(entry.createdAt)}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${actionColor(entry.action)}`}>
                          {AUDIT_ACTION_LABELS[entry.action as AuditAction] ?? entry.action}
                        </span>
                      </td>

                      {/* Entity type */}
                      <td className="px-4 py-3 text-card-foreground text-xs capitalize">
                        {AUDIT_ENTITY_TYPE_LABELS[entry.entityType as AuditEntityType] ?? entry.entityType}
                      </td>

                      {/* Entity ID -- clickable to open history panel */}
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setEntityPanel({ type: entry.entityType, id: entry.entityId })}
                          className="font-mono text-xs text-primary hover:underline"
                          title={entry.entityId}
                        >
                          {truncateId(entry.entityId)}
                        </button>
                      </td>

                      {/* Performed by */}
                      <td className="px-4 py-3">
                        {entry.user ? (
                          <div className="flex flex-col">
                            <span className="text-foreground font-medium text-xs">{entry.user.name}</span>
                            <span className="text-muted-foreground text-xs capitalize">{entry.user.role}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs italic">System</span>
                        )}
                      </td>

                      {/* Expand toggle */}
                      <td className="px-4 py-3">
                        {(entry.previousData || entry.newData) && (
                          <button
                            onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                            className="text-xs text-primary hover:underline"
                          >
                            {expanded === entry.id ? 'Hide' : 'Diff'}
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Expanded diff row */}
                    {expanded === entry.id && (
                      <tr key={`${entry.id}-diff`} className="bg-muted/50">
                        <td colSpan={6} className="px-4 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {entry.previousData && (
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Before</p>
                                <pre className="bg-background rounded-lg border border-border p-3 text-xs text-card-foreground overflow-x-auto max-h-48">
                                  {JSON.stringify(entry.previousData, null, 2)}
                                </pre>
                              </div>
                            )}
                            {entry.newData && (
                              <div>
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">After</p>
                                <pre className="bg-background rounded-lg border border-border p-3 text-xs text-card-foreground overflow-x-auto max-h-48">
                                  {JSON.stringify(entry.newData, null, 2)}
                                </pre>
                              </div>
                            )}
                            {entry.ipAddress && (
                              <div className="md:col-span-2 flex gap-4 text-xs text-muted-foreground">
                                <span>IP: <span className="font-mono">{entry.ipAddress}</span></span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!isLoading && entries.length > 0 && (
          <div className="flex items-center justify-between px-4 py-4 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Showing {offset + 1}–{offset + entries.length} of {total.toLocaleString('en-US')}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={offset + entries.length >= total}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Entity history panel modal */}
      {entityPanel && (
        <EntityHistoryPanel
          entityType={entityPanel.type}
          entityId={entityPanel.id}
          onClose={() => setEntityPanel(null)}
        />
      )}
    </div>
  );
}
