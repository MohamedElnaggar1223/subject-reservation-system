'use client';

import { useState } from 'react';
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, SESSION_TYPE_LABELS, type CreateSessionType } from '@repo/validations';

type SessionEditEntry = {
  editedBy: string;
  editedAt: string;
  field: string;
  oldValue: string;
  newValue: string;
  reason?: string;
};

type Session = {
  id: string;
  name: string;
  sessionType: string;
  startDate: string;
  endDate: string;
  status: string;
  closedAt: string | null;
  closedBy: string | null;
  editHistory: SessionEditEntry[] | null;
  createdAt: string;
  updatedAt: string;
};

const SESSION_TYPE_OPTIONS = [
  { value: 'june', label: 'June' },
  { value: 'november', label: 'November' },
  { value: 'january', label: 'January' },
];

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  closed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const emptyCreateForm = {
  name: '',
  sessionType: 'june' as const,
  startDate: '',
  endDate: '',
};

export default function SessionsAdminClient(): React.JSX.Element {
  const queryClient = useQueryClient();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [createError, setCreateError] = useState('');

  // Deadline extension modal state
  const [extendingSession, setExtendingSession] = useState<Session | null>(null);
  const [newEndDate, setNewEndDate] = useState('');
  const [extendReason, setExtendReason] = useState('');
  const [extendError, setExtendError] = useState('');

  // Detail / history modal state
  const [historySession, setHistorySession] = useState<Session | null>(null);

  const [filterStatus, setFilterStatus] = useState('');

  const { data: sessions } = useSuspenseQuery({
    queryKey: ['sessions', 'admin'],
    queryFn: async () => apiResponse(api.v1.sessions.$get({ query: {} })),
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateSessionType) =>
      apiResponse(api.v1.sessions.$post({ json: data })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setShowCreateForm(false);
      setCreateForm(emptyCreateForm);
      setCreateError('');
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const activateMutation = useMutation({
    mutationFn: async (id: string) =>
      apiResponse(api.v1.sessions[':id'].activate.$post({ param: { id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    onError: (err: Error) => alert(err.message),
  });

  const closeMutation = useMutation({
    mutationFn: async (id: string) =>
      apiResponse(
        api.v1.sessions[':id'].close.$post({ param: { id }, json: {} })
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    onError: (err: Error) => alert(err.message),
  });

  const extendMutation = useMutation({
    mutationFn: async ({ id, endDate, reason }: { id: string; endDate: string; reason: string }) =>
      apiResponse(
        api.v1.sessions[':id'].$put({
          param: { id },
          json: { endDate: new Date(endDate), reason },
        })
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setExtendingSession(null);
      setNewEndDate('');
      setExtendReason('');
      setExtendError('');
    },
    onError: (err: Error) => setExtendError(err.message),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');

    if (!createForm.startDate || !createForm.endDate) {
      setCreateError('Both start and end dates are required.');
      return;
    }

    const start = new Date(createForm.startDate);
    const end = new Date(createForm.endDate);

    if (end <= start) {
      setCreateError('End date must be after start date.');
      return;
    }

    createMutation.mutate({
      name: createForm.name.trim(),
      sessionType: createForm.sessionType,
      startDate: start,
      endDate: end,
    });
  }

  function handleExtend(e: React.FormEvent) {
    e.preventDefault();
    setExtendError('');

    if (!extendingSession || !newEndDate) return;
    if (extendReason.trim().length < 5) {
      setExtendError('Please provide a reason (min 5 characters).');
      return;
    }

    extendMutation.mutate({
      id: extendingSession.id,
      endDate: newEndDate,
      reason: extendReason.trim(),
    });
  }

  const filtered = (sessions as Session[]).filter((s) =>
    filterStatus ? s.status === filterStatus : true
  );

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  function formatDateTime(d: string) {
    return new Date(d).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function toDatetimeLocal(iso: string) {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const activeCount = (sessions as Session[]).filter((s) => s.status === 'active').length;
  const draftCount = (sessions as Session[]).filter((s) => s.status === 'draft').length;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-8">

        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Registration Sessions
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {activeCount} active &nbsp;·&nbsp; {draftCount} draft &nbsp;·&nbsp; {(sessions as Session[]).length} total
            </p>
          </div>
          <button
            onClick={() => { setShowCreateForm(true); setCreateError(''); }}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Session
          </button>
        </div>

        {/* Active session summary cards */}
        {activeCount > 0 && (
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            {(sessions as Session[])
              .filter((s) => s.status === 'active')
              .map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800 dark:bg-green-900/20"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-green-700 dark:text-green-400">
                      {SESSION_TYPE_LABELS[s.sessionType as keyof typeof SESSION_TYPE_LABELS] ?? s.sessionType} — Open
                    </span>
                    <span className="inline-flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  </div>
                  <p className="mt-1 text-sm font-medium text-green-900 dark:text-green-200">{s.name}</p>
                  <p className="mt-0.5 text-xs text-green-700 dark:text-green-400">
                    Closes {formatDate(s.endDate)}
                  </p>
                </div>
              ))}
          </div>
        )}

        {/* Create Form Modal */}
        {showCreateForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-slate-800">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">New Registration Session</h2>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleCreate} className="space-y-4 px-6 py-5">
                {createError && (
                  <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    {createError}
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Session Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    placeholder="e.g. June 2026"
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-400"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Session Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={createForm.sessionType}
                    onChange={(e) => setCreateForm({ ...createForm, sessionType: e.target.value as typeof createForm.sessionType })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                  >
                    {SESSION_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Only one active session of each type is allowed at a time.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Start Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="datetime-local"
                      value={createForm.startDate}
                      onChange={(e) => setCreateForm({ ...createForm, startDate: e.target.value })}
                      required
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:scheme-dark"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                      End Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="datetime-local"
                      value={createForm.endDate}
                      onChange={(e) => setCreateForm({ ...createForm, endDate: e.target.value })}
                      required
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:scheme-dark"
                    />
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                  If start date is now or in the past, the session will open immediately as <strong>Active</strong>. Otherwise it starts as <strong>Draft</strong> and is activated when the start date arrives.
                </div>

                <div className="flex justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {createMutation.isPending ? 'Creating…' : 'Create Session'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Extend Deadline Modal */}
        {extendingSession && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-slate-800">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Extend Deadline</h2>
                <button
                  onClick={() => { setExtendingSession(null); setExtendError(''); }}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleExtend} className="space-y-4 px-6 py-5">
                {extendError && (
                  <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    {extendError}
                  </div>
                )}

                <div className="rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-700">
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    Session: <strong>{extendingSession.name}</strong>
                  </p>
                  <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                    Current deadline: <strong>{formatDate(extendingSession.endDate)}</strong>
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    New End Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={newEndDate}
                    min={toDatetimeLocal(extendingSession.endDate)}
                    onChange={(e) => setNewEndDate(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:scheme-dark"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Reason <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={extendReason}
                    onChange={(e) => setExtendReason(e.target.value)}
                    placeholder="Explain why the deadline is being extended…"
                    rows={3}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-400 resize-none"
                  />
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    This reason is recorded in the audit log.
                  </p>
                </div>

                <div className="flex justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => { setExtendingSession(null); setExtendError(''); }}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={extendMutation.isPending}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {extendMutation.isPending ? 'Saving…' : 'Extend Deadline'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit History Modal */}
        {historySession && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-slate-800">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Edit History — {historySession.name}
                </h2>
                <button
                  onClick={() => setHistorySession(null)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="px-6 py-5">
                {!historySession.editHistory || historySession.editHistory.length === 0 ? (
                  <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-4">
                    No edits recorded for this session.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {historySession.editHistory.map((entry, i) => (
                      <div key={i} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-900 dark:text-white capitalize">
                            {entry.field} changed
                          </span>
                          <span className="text-xs text-slate-400">{formatDateTime(entry.editedAt)}</span>
                        </div>
                        <div className="mt-1.5 space-y-0.5 text-slate-600 dark:text-slate-300">
                          <p className="text-xs">From: <span className="font-mono">{formatDate(entry.oldValue)}</span></p>
                          <p className="text-xs">To: <span className="font-mono">{formatDate(entry.newValue)}</span></p>
                          {entry.reason && (
                            <p className="mt-1 text-xs italic text-slate-500 dark:text-slate-400">
                              Reason: {entry.reason}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 px-6 py-4 dark:border-slate-700">
                <button
                  onClick={() => setHistorySession(null)}
                  className="w-full rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filter bar */}
        <div className="mb-4 flex gap-2">
          {['', 'draft', 'active', 'closed'].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filterStatus === status
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
              }`}
            >
              {status === '' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {/* Sessions List */}
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <p className="text-slate-500 dark:text-slate-400">No sessions found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(filtered as Session[]).map((s) => (
              <div
                key={s.id}
                className={`rounded-xl border bg-white shadow-sm dark:bg-slate-800 ${
                  s.status === 'active'
                    ? 'border-green-200 dark:border-green-800'
                    : s.status === 'draft'
                    ? 'border-slate-200 dark:border-slate-700'
                    : 'border-slate-100 dark:border-slate-800 opacity-70'
                }`}
              >
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-900 dark:text-white">{s.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[s.status] ?? ''}`}>
                          {s.status}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          {SESSION_TYPE_LABELS[s.sessionType as keyof typeof SESSION_TYPE_LABELS] ?? s.sessionType}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        {formatDate(s.startDate)} → {formatDate(s.endDate)}
                      </p>
                      {s.status === 'closed' && s.closedAt && (
                        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                          Closed {formatDate(s.closedAt)}
                        </p>
                      )}
                      {s.editHistory && s.editHistory.length > 0 && (
                        <button
                          onClick={() => setHistorySession(s)}
                          className="mt-1 text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400"
                        >
                          {s.editHistory.length} deadline edit{s.editHistory.length !== 1 ? 's' : ''} →
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-2">
                    {s.status === 'draft' && (
                      <button
                        onClick={() => {
                          if (confirm(`Activate "${s.name}"? Registration will open immediately.`)) {
                            activateMutation.mutate(s.id);
                          }
                        }}
                        disabled={activateMutation.isPending}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
                      >
                        Activate
                      </button>
                    )}

                    {s.status === 'active' && (
                      <>
                        <button
                          onClick={() => {
                            setExtendingSession(s);
                            setNewEndDate(toDatetimeLocal(s.endDate));
                            setExtendReason('');
                            setExtendError('');
                          }}
                          className="rounded-lg border border-indigo-300 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-900/20"
                        >
                          Extend Deadline
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Close "${s.name}" early? Students will no longer be able to register.`)) {
                              closeMutation.mutate(s.id);
                            }
                          }}
                          disabled={closeMutation.isPending}
                          className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          Close Early
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
