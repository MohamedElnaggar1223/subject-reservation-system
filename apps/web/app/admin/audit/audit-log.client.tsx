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
 *   "Requested by [Student A] → Approved by [Parent B] → Confirmed by [System]"
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

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// Action category → badge color
function actionColor(action: string): string {
  if (action.endsWith('_CREATED') || action.endsWith('_REQUESTED') || action.endsWith('_DIRECT') || action.endsWith('_TRANSFER')) {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
  }
  if (action.endsWith('_UPDATED') || action.endsWith('_EXTENDED') || action.endsWith('_ACTIVATED')) {
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
  }
  if (action.endsWith('_DEACTIVATED') || action.endsWith('_CLOSED') || action.endsWith('_REJECTED') || action.endsWith('_FAILED')) {
    return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
  }
  if (action.endsWith('_APPROVED') || action.endsWith('_CONFIRMED') || action.endsWith('_FULFILLED') || action.endsWith('_OVERRIDE')) {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
  }
  return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
}

function truncateId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

// ─── Filters Bar ──────────────────────────────────────────────────────────────

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
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Action</label>
        <select
          value={filters.action ?? ''}
          onChange={(e) => onChange({ ...filters, action: (e.target.value as AuditAction) || undefined })}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => (
            <option key={a} value={a}>{AUDIT_ACTION_LABELS[a]}</option>
          ))}
        </select>
      </div>

      {/* Entity type filter */}
      <div className="flex flex-col gap-1 min-w-[150px]">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Entity type</label>
        <select
          value={filters.entityType ?? ''}
          onChange={(e) => onChange({ ...filters, entityType: (e.target.value as AuditEntityType) || undefined })}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All types</option>
          {AUDIT_ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>{AUDIT_ENTITY_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>

      {/* Date From */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">From</label>
        <input
          type="date"
          value={filters.dateFrom ?? ''}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value || undefined })}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Date To */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">To</label>
        <input
          type="date"
          value={filters.dateTo ?? ''}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value || undefined })}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {hasActive && (
        <button
          onClick={onReset}
          className="self-end px-4 py-2 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

// ─── Entity History Panel ─────────────────────────────────────────────────────

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
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Chain of Custody
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {AUDIT_ENTITY_TYPE_LABELS[entityType as AuditEntityType] ?? entityType} · <span className="font-mono">{truncateId(entityId)}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Timeline */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-gray-400 text-sm">Loading history…</div>
          )}
          {isError && (
            <div className="py-8 text-center text-red-500 text-sm">Failed to load entity history.</div>
          )}
          {data && data.length === 0 && (
            <div className="py-8 text-center text-gray-400 text-sm">No history found for this entity.</div>
          )}
          {data && data.length > 0 && (
            <ol className="relative border-l border-gray-200 dark:border-gray-700 space-y-6 ml-3">
              {(data as AuditEntry[]).map((entry, idx) => (
                <li key={entry.id} className="ml-6">
                  <span className="absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900 ring-4 ring-white dark:ring-gray-900">
                    <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">{idx + 1}</span>
                  </span>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${actionColor(entry.action)}`}>
                        {AUDIT_ACTION_LABELS[entry.action as AuditAction] ?? entry.action}
                      </span>
                      <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                        {entry.user
                          ? <><span className="font-medium">{entry.user.name}</span> <span className="text-gray-400">({entry.user.role})</span></>
                          : <span className="text-gray-400 italic">System</span>
                        }
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5" title={formatAbsoluteTime(entry.createdAt)}>
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

// ─── Main Component ───────────────────────────────────────────────────────────

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

  const entries = (data as AuditEntry[] | undefined) ?? [];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">

        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
            Audit Log
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Full chain-of-custody record of all system actions. Click any entity ID to view its complete history.
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5 mb-6">
          <FiltersBar
            filters={filters}
            onChange={handleFilterChange}
            onReset={handleReset}
          />
        </div>

        {/* Log Table */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">

          {/* Loading */}
          {isLoading && (
            <div className="py-16 text-center text-gray-400 text-sm">Loading audit logs…</div>
          )}

          {/* Error */}
          {isError && (
            <div className="py-16 text-center text-red-500 text-sm">Failed to load audit logs.</div>
          )}

          {/* Empty */}
          {!isLoading && !isError && entries.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-gray-400 text-sm">No audit log entries match the current filters.</p>
            </div>
          )}

          {/* Table */}
          {!isLoading && entries.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 text-left">
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-36">Time</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Action</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Entity</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Entity ID</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Performed by</th>
                    <th className="px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-24">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {entries.map((entry) => (
                    <>
                      <tr
                        key={entry.id}
                        className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                      >
                        {/* Time */}
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap" title={formatAbsoluteTime(entry.createdAt)}>
                          {formatRelativeTime(entry.createdAt)}
                        </td>

                        {/* Action */}
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${actionColor(entry.action)}`}>
                            {AUDIT_ACTION_LABELS[entry.action as AuditAction] ?? entry.action}
                          </span>
                        </td>

                        {/* Entity type */}
                        <td className="px-4 py-3 text-gray-700 dark:text-gray-300 text-xs capitalize">
                          {AUDIT_ENTITY_TYPE_LABELS[entry.entityType as AuditEntityType] ?? entry.entityType}
                        </td>

                        {/* Entity ID — clickable to open history panel */}
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setEntityPanel({ type: entry.entityType, id: entry.entityId })}
                            className="font-mono text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                            title={entry.entityId}
                          >
                            {truncateId(entry.entityId)}
                          </button>
                        </td>

                        {/* Performed by */}
                        <td className="px-4 py-3">
                          {entry.user ? (
                            <div className="flex flex-col">
                              <span className="text-gray-800 dark:text-gray-200 font-medium text-xs">{entry.user.name}</span>
                              <span className="text-gray-400 text-xs capitalize">{entry.user.role}</span>
                            </div>
                          ) : (
                            <span className="text-gray-400 text-xs italic">System</span>
                          )}
                        </td>

                        {/* Expand toggle */}
                        <td className="px-4 py-3">
                          {(entry.previousData || entry.newData) && (
                            <button
                              onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                              {expanded === entry.id ? 'Hide' : 'Diff'}
                            </button>
                          )}
                        </td>
                      </tr>

                      {/* Expanded diff row */}
                      {expanded === entry.id && (
                        <tr key={`${entry.id}-diff`} className="bg-gray-50 dark:bg-gray-800/30">
                          <td colSpan={6} className="px-4 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {entry.previousData && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Before</p>
                                  <pre className="bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 p-3 text-xs text-gray-700 dark:text-gray-300 overflow-x-auto max-h-48">
                                    {JSON.stringify(entry.previousData, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {entry.newData && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">After</p>
                                  <pre className="bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 p-3 text-xs text-gray-700 dark:text-gray-300 overflow-x-auto max-h-48">
                                    {JSON.stringify(entry.newData, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {entry.ipAddress && (
                                <div className="md:col-span-2 flex gap-4 text-xs text-gray-400">
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
            <div className="flex items-center justify-between px-4 py-4 border-t border-gray-100 dark:border-gray-800">
              <p className="text-xs text-gray-500">
                Showing {offset + 1}–{offset + entries.length}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  disabled={offset === 0}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                  disabled={entries.length < PAGE_SIZE}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
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
