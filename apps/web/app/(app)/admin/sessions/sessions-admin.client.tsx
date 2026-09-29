'use client';

import { useState } from 'react';
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse,
  academicYearShortLabel,
  academicYearStartOf,
  A_LEVEL_ONLY_MESSAGE,
  A_LEVEL_ONLY_SESSION_TYPES,
  SESSION_TYPE_LABELS,
  seriesAcademicYearStart,
  seriesLabel,
  seriesYearInAcademicYear,
  type CreateSessionType,
  type SessionType,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/tone';

// Typed by the API, never by hand (PATTERNS.md).
const fetchSessions = () => apiResponse(api.v1.sessions.$get({ query: {} }));
type Session = Awaited<ReturnType<typeof fetchSessions>>[number];

const SESSION_TYPE_OPTIONS: { value: SessionType; label: string }[] = [
  { value: 'june', label: 'June' },
  { value: 'october', label: 'October' },
  { value: 'november', label: 'November' },
  { value: 'january', label: 'January' },
];

/**
 * The exam series a window most likely registers for (F0a): the series of
 * this type in the academic year the window opens in — a June window opening
 * in March 2027 is for June 2027, a January window opening in October 2026
 * for January 2027. Only a suggestion: the admin can type another year.
 */
function suggestedSeriesYear(sessionType: string, startDate: string): number {
  const opens = startDate ? new Date(startDate) : new Date();
  return seriesYearInAcademicYear(sessionType, academicYearStartOf(Number.isNaN(opens.getTime()) ? new Date() : opens));
}

/** "June 2027 series · academic year 2026/27" — what a window's grade rules read. */
function seriesSummary(sessionType: string, seriesYear: number): string {
  return `${seriesLabel(sessionType, seriesYear)} series · academic year ${academicYearShortLabel(seriesAcademicYearStart(sessionType, seriesYear))}`;
}

const LEVEL_OPTIONS = [
  { value: 'igcse', label: 'IGCSE' },
  { value: 'as_level', label: 'AS Level' },
  { value: 'a_level', label: 'A Level' },
];

const LEVEL_LABELS: Record<string, string> = {
  igcse: 'IGCSE',
  as_level: 'AS Level',
  a_level: 'A Level',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  closed: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const emptyCreateForm = {
  name: '',
  sessionType: 'june' as SessionType,
  // Empty until the admin types a year: the suggestion is used.
  seriesYear: '',
  qualificationLevel: 'igcse' as 'igcse' | 'as_level' | 'a_level',
  startDate: '',
  endDate: '',
  entryDeadline: '',
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

  // Board entry deadline modal state (owner decision MO-10)
  const [deadlineSession, setDeadlineSession] = useState<Session | null>(null);
  const [deadlineValue, setDeadlineValue] = useState('');
  const [deadlineReason, setDeadlineReason] = useState('');
  const [deadlineError, setDeadlineError] = useState('');

  const [filterStatus, setFilterStatus] = useState('');
  const [filterSessionType, setFilterSessionType] = useState('');

  // Correct a window's exam series (F0a): PUT /sessions/:id/series
  const [seriesSession, setSeriesSession] = useState<Session | null>(null);
  const [seriesForm, setSeriesForm] = useState({ sessionType: 'june' as SessionType, seriesYear: '', reason: '' });
  const [seriesError, setSeriesError] = useState('');
  const [seriesResult, setSeriesResult] = useState<{ name: string; series: string; expired: number; closed: number } | null>(null);

  const { data: sessions } = useSuspenseQuery({
    queryKey: ['sessions', 'admin'],
    queryFn: fetchSessions,
  });

  const deadlineMutation = useMutation({
    mutationFn: async ({ id, entryDeadline, reason }: { id: string; entryDeadline: Date | null; reason: string }) =>
      apiResponse(api.v1.sessions[':id']['entry-deadline'].$put({ param: { id }, json: { entryDeadline, reason } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setDeadlineSession(null);
      setDeadlineError('');
    },
    onError: (err: Error) => setDeadlineError(err.message),
  });

  const seriesMutation = useMutation({
    mutationFn: async ({ id, sessionType, seriesYear, reason }: { id: string; sessionType: SessionType; seriesYear: number; reason: string }) =>
      apiResponse(api.v1.sessions[':id'].series.$put({ param: { id }, json: { sessionType, seriesYear, reason } })),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setSeriesSession(null);
      setSeriesError('');
      setSeriesResult({
        name: updated.name,
        series: seriesLabel(updated.sessionType, updated.seriesYear),
        expired: updated.registrationsExpired,
        closed: updated.paymentsClosed,
      });
    },
    onError: (err: Error) => setSeriesError(err.message),
  });

  function handleCorrectSeries(e: React.FormEvent) {
    e.preventDefault();
    setSeriesError('');
    if (!seriesSession) return;
    const year = Number(seriesForm.seriesYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      setSeriesError('Enter the series year, e.g. 2027.');
      return;
    }
    if (A_LEVEL_ONLY_SESSION_TYPES.includes(seriesForm.sessionType) && seriesSession.qualificationLevel === 'igcse') {
      setSeriesError(A_LEVEL_ONLY_MESSAGE);
      return;
    }
    if (seriesForm.reason.trim().length < 5) {
      setSeriesError('Please provide a reason (min 5 characters).');
      return;
    }
    seriesMutation.mutate({ id: seriesSession.id, sessionType: seriesForm.sessionType, seriesYear: year, reason: seriesForm.reason.trim() });
  }

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
          // @ts-expect-error — route reads json body manually without zValidator
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

    if (A_LEVEL_ONLY_SESSION_TYPES.includes(createForm.sessionType) && createForm.qualificationLevel === 'igcse') {
      setCreateError(A_LEVEL_ONLY_MESSAGE);
      return;
    }

    const seriesYear = createForm.seriesYear ? Number(createForm.seriesYear) : suggestedCreateSeriesYear;
    if (!Number.isInteger(seriesYear) || seriesYear < 2000 || seriesYear > 2100) {
      setCreateError('Enter the exam series year, e.g. 2027.');
      return;
    }

    const entryDeadline = createForm.entryDeadline ? new Date(createForm.entryDeadline) : null;
    if (entryDeadline && entryDeadline <= end) {
      setCreateError("The board's entry deadline must be after the registration window closes.");
      return;
    }

    createMutation.mutate({
      name: createForm.name.trim(),
      sessionType: createForm.sessionType,
      seriesYear,
      qualificationLevel: createForm.qualificationLevel,
      startDate: start,
      endDate: end,
      entryDeadline,
    });
  }

  const suggestedCreateSeriesYear = suggestedSeriesYear(createForm.sessionType, createForm.startDate);
  const createSeriesYear = createForm.seriesYear ? Number(createForm.seriesYear) : suggestedCreateSeriesYear;

  function handleSetDeadline(e: React.FormEvent) {
    e.preventDefault();
    setDeadlineError('');
    if (!deadlineSession) return;
    if (deadlineReason.trim().length < 5) {
      setDeadlineError('Please provide a reason (min 5 characters).');
      return;
    }
    deadlineMutation.mutate({
      id: deadlineSession.id,
      entryDeadline: deadlineValue ? new Date(deadlineValue) : null,
      reason: deadlineReason.trim(),
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

  const filtered = (sessions as Session[]).filter((s) => {
    if (filterStatus && s.status !== filterStatus) return false;
    if (filterSessionType && s.sessionType !== filterSessionType) return false;
    return true;
  });

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
    <div className="px-6 py-8 max-w-6xl mx-auto animate-fade-up">

      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">
            Registration Sessions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeCount} active &nbsp;·&nbsp; {draftCount} draft &nbsp;·&nbsp; {(sessions as Session[]).length} total
          </p>
        </div>
        <Button
          onClick={() => { setShowCreateForm(true); setCreateError(''); }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Session
        </Button>
      </div>

      {/* Active session summary cards */}
      {activeCount > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {(sessions as Session[])
            .filter((s) => s.status === 'active')
            .map((s) => (
              <div
                key={s.id}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800 dark:bg-emerald-900/20"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                    {SESSION_TYPE_LABELS[s.sessionType as keyof typeof SESSION_TYPE_LABELS] ?? s.sessionType} — Open
                  </span>
                  <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                <p className="mt-1 text-sm font-medium text-emerald-900 dark:text-emerald-200">{s.name}</p>
                <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-400">
                  <span>{seriesLabel(s.sessionType, s.seriesYear)}</span> · <span>Closes {formatDate(s.endDate)}</span>
                </p>
              </div>
            ))}
        </div>
      )}

      {/* Create Form Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-card shadow-xl border border-border">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground font-display">New Registration Session</h2>
              <button
                onClick={() => setShowCreateForm(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
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
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Session Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  placeholder="e.g. June 2026"
                  required
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Session Type <span className="text-destructive">*</span>
                </label>
                <select
                  value={createForm.sessionType}
                  onChange={(e) => setCreateForm({ ...createForm, sessionType: e.target.value as typeof createForm.sessionType })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {SESSION_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Only one active session per type and level is allowed at a time.
                </p>
              </div>

              <div>
                <label htmlFor="create-series-year" className="mb-1 block text-sm font-medium text-foreground">
                  Exam series year <span className="text-destructive">*</span>
                </label>
                <input
                  id="create-series-year"
                  type="number"
                  inputMode="numeric"
                  min={2000}
                  max={2100}
                  value={createForm.seriesYear}
                  placeholder={String(suggestedCreateSeriesYear)}
                  onChange={(e) => setCreateForm({ ...createForm, seriesYear: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {Number.isInteger(createSeriesYear) && createSeriesYear >= 2000 && createSeriesYear <= 2100
                    ? <><span>{seriesSummary(createForm.sessionType, createSeriesYear)}</span>{!createForm.seriesYear && <> <span>(suggested from the start date)</span></>}</>
                    : <span>Enter the exam series year, e.g. 2027.</span>}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Grades are read in this academic year: who is in grade 10, and who has graduated.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Qualification Level <span className="text-destructive">*</span>
                </label>
                <select
                  value={createForm.qualificationLevel}
                  onChange={(e) => setCreateForm({ ...createForm, qualificationLevel: e.target.value as typeof createForm.qualificationLevel })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {LEVEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  January and October series are A-Level only (no IGCSE sitting exists in Egypt).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Start Date <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={createForm.startDate}
                    onChange={(e) => setCreateForm({ ...createForm, startDate: e.target.value })}
                    required
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    End Date <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={createForm.endDate}
                    onChange={(e) => setCreateForm({ ...createForm, endDate: e.target.value })}
                    required
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Exam board entry deadline
                </label>
                <input
                  type="datetime-local"
                  value={createForm.entryDeadline}
                  onChange={(e) => setCreateForm({ ...createForm, entryDeadline: e.target.value })}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  From the board&apos;s calendar; you can set it later. After it, anything still unpaid for this series is closed automatically.
                </p>
              </div>

              <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                If start date is now or in the past, the session will open immediately as <strong>Active</strong>. Otherwise it starts as <strong>Draft</strong> and is activated when the start date arrives.
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Session'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Extend Deadline Modal */}
      {extendingSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-card shadow-xl border border-border">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground font-display">Extend Deadline</h2>
              <button
                onClick={() => { setExtendingSession(null); setExtendError(''); }}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
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

              <div className="rounded-lg bg-muted px-4 py-3">
                <p className="text-sm text-foreground">
                  Session: <strong>{extendingSession.name}</strong>
                </p>
                <p className="mt-0.5 text-sm text-foreground">
                  Current deadline: <strong>{formatDate(extendingSession.endDate)}</strong>
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  New End Date <span className="text-destructive">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={newEndDate}
                  min={toDatetimeLocal(extendingSession.endDate)}
                  onChange={(e) => setNewEndDate(e.target.value)}
                  required
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Reason <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={extendReason}
                  onChange={(e) => setExtendReason(e.target.value)}
                  placeholder="Explain why the deadline is being extended..."
                  rows={3}
                  required
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  This reason is recorded in the audit log.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setExtendingSession(null); setExtendError(''); }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={extendMutation.isPending}
                >
                  {extendMutation.isPending ? 'Saving...' : 'Extend Deadline'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Board Entry Deadline Modal (MO-10) */}
      {deadlineSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-card shadow-xl border border-border">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground font-display">Exam Board Entry Deadline</h2>
              <button
                onClick={() => { setDeadlineSession(null); setDeadlineError(''); }}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSetDeadline} className="space-y-4 px-6 py-5">
              {deadlineError && (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  {deadlineError}
                </div>
              )}

              <div className="rounded-lg bg-muted px-4 py-3 text-sm text-foreground">
                <p>Session: <strong>{deadlineSession.name}</strong></p>
                <p className="mt-0.5">Window closes: <strong>{formatDate(deadlineSession.endDate)}</strong></p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Deadline</label>
                <input
                  type="datetime-local"
                  value={deadlineValue}
                  min={toDatetimeLocal(deadlineSession.endDate)}
                  onChange={(e) => setDeadlineValue(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  After this moment, every payment still unconfirmed for this series is closed automatically (escrow returned, family told) and waiting registrations expire. Leave empty to remove the cut-off.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Reason <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={deadlineReason}
                  onChange={(e) => setDeadlineReason(e.target.value)}
                  placeholder="e.g. Cambridge June calendar published"
                  rows={2}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
                <p className="mt-1 text-xs text-muted-foreground">This reason is recorded in the audit log.</p>
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <Button type="button" variant="outline" onClick={() => { setDeadlineSession(null); setDeadlineError(''); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={deadlineMutation.isPending}>
                  {deadlineMutation.isPending ? 'Saving...' : 'Save Deadline'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Correct Series Modal (F0a) */}
      {seriesSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-card shadow-xl border border-border">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground font-display">Correct exam series</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => { setSeriesSession(null); setSeriesError(''); }}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleCorrectSeries} className="space-y-4 px-6 py-5">
              {seriesError && (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  {seriesError}
                </div>
              )}

              <div className="rounded-lg bg-muted px-4 py-3 text-sm text-foreground">
                <p><span>Session:</span> <strong>{seriesSession.name}</strong></p>
                <p className="mt-0.5"><span>Now:</span> <strong>{seriesSummary(seriesSession.sessionType, seriesSession.seriesYear)}</strong></p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="series-type" className="mb-1 block text-sm font-medium text-foreground">Series</label>
                  <select
                    id="series-type"
                    value={seriesForm.sessionType}
                    onChange={(e) => setSeriesForm({ ...seriesForm, sessionType: e.target.value as SessionType })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {SESSION_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="series-year" className="mb-1 block text-sm font-medium text-foreground">Year</label>
                  <input
                    id="series-year"
                    type="number"
                    inputMode="numeric"
                    min={2000}
                    max={2100}
                    value={seriesForm.seriesYear}
                    onChange={(e) => setSeriesForm({ ...seriesForm, seriesYear: e.target.value })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
              {Number.isInteger(Number(seriesForm.seriesYear)) && Number(seriesForm.seriesYear) >= 2000 && Number(seriesForm.seriesYear) <= 2100 && (
                <p className="text-xs text-muted-foreground">
                  <span>Becomes:</span> <span>{seriesSummary(seriesForm.sessionType, Number(seriesForm.seriesYear))}</span>
                </p>
              )}

              <Notice tone="warning">
                Waiting registrations the corrected series no longer allows (a student's grade in that year) expire now; their open checkouts are closed, any wallet money returned, and families told. Confirmed registrations are not touched.
              </Notice>

              <div>
                <label htmlFor="series-reason" className="mb-1 block text-sm font-medium text-foreground">
                  Reason <span className="text-destructive">*</span>
                </label>
                <textarea
                  id="series-reason"
                  value={seriesForm.reason}
                  onChange={(e) => setSeriesForm({ ...seriesForm, reason: e.target.value })}
                  placeholder="e.g. The window was entered as June 2026; it is for June 2027"
                  rows={2}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                />
                <p className="mt-1 text-xs text-muted-foreground">This reason is recorded in the audit log.</p>
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <Button type="button" variant="outline" onClick={() => { setSeriesSession(null); setSeriesError(''); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={seriesMutation.isPending}>
                  {seriesMutation.isPending ? 'Saving...' : 'Correct series'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit History Modal */}
      {historySession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-card shadow-xl border border-border">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground font-display">
                Edit History — {historySession.name}
              </h2>
              <button
                onClick={() => setHistorySession(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5">
              {!historySession.editHistory || historySession.editHistory.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-4">
                  No edits recorded for this session.
                </p>
              ) : (
                <div className="space-y-3">
                  {historySession.editHistory.map((entry, i) => (
                    <div key={i} className="rounded-lg border border-border p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground capitalize">
                          {entry.field} changed
                        </span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(entry.editedAt)}</span>
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-card-foreground">
                        <p className="text-xs">From: <span className="font-mono">{formatDate(entry.oldValue)}</span></p>
                        <p className="text-xs">To: <span className="font-mono">{formatDate(entry.newValue)}</span></p>
                        {entry.reason && (
                          <p className="mt-1 text-xs italic text-muted-foreground">
                            Reason: {entry.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-border px-6 py-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setHistorySession(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {seriesResult && (
        <Notice tone="success" className="mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p><span>Series corrected:</span> <strong>{seriesResult.name}</strong> → <span>{seriesResult.series}</span></p>
              <p className="mt-1">
                {seriesResult.expired > 0
                  ? <><span>Waiting registrations expired:</span> <span>{seriesResult.expired}</span> · <span>Open checkouts closed (families told):</span> <span>{seriesResult.closed}</span></>
                  : <span>No waiting registration was affected.</span>}
              </p>
            </div>
            <button type="button" className="text-xs underline hover:no-underline" onClick={() => setSeriesResult(null)}>Dismiss</button>
          </div>
        </Notice>
      )}

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap gap-4">
        {/* Status filter */}
        <div className="flex gap-2">
          <span className="self-center text-xs font-medium text-muted-foreground mr-1">Status:</span>
          {['', 'draft', 'active', 'closed'].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filterStatus === status
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-card-foreground border border-border hover:bg-muted'
              }`}
            >
              {status === '' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {/* Session type filter */}
        <div className="flex gap-2">
          <span className="self-center text-xs font-medium text-muted-foreground mr-1">Type:</span>
          {['', 'june', 'october', 'november', 'january'].map((type) => (
            <button
              key={type}
              onClick={() => setFilterSessionType(type)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filterSessionType === type
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-card-foreground border border-border hover:bg-muted'
              }`}
            >
              {type === '' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Sessions List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center shadow-sm">
          <p className="text-muted-foreground">No sessions found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(filtered as Session[]).map((s) => (
            <div
              key={s.id}
              className={`rounded-xl border bg-card shadow-sm ${
                s.status === 'active'
                  ? 'border-emerald-200 dark:border-emerald-800'
                  : s.status === 'draft'
                  ? 'border-border'
                  : 'border-border opacity-70'
              }`}
            >
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground">{s.name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[s.status] ?? ''}`}>
                        {s.status}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {SESSION_TYPE_LABELS[s.sessionType as keyof typeof SESSION_TYPE_LABELS] ?? s.sessionType}
                        <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground align-middle">
                          {LEVEL_LABELS[s.qualificationLevel] ?? s.qualificationLevel}
                        </span>
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {formatDate(s.startDate)} → {formatDate(s.endDate)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {seriesSummary(s.sessionType, s.seriesYear)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.entryDeadline
                        ? <>Board entry deadline {formatDateTime(s.entryDeadline)}</>
                        : <>No board entry deadline set</>}
                    </p>
                    {s.status === 'closed' && s.closedAt && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Closed {formatDate(s.closedAt)}
                      </p>
                    )}
                    {s.editHistory && s.editHistory.length > 0 && (
                      <button
                        onClick={() => setHistorySession(s)}
                        className="mt-1 text-xs text-primary hover:text-primary/80"
                      >
                        {s.editHistory.length} deadline edit{s.editHistory.length !== 1 ? 's' : ''} →
                      </button>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDeadlineSession(s);
                      setDeadlineValue(s.entryDeadline ? toDatetimeLocal(s.entryDeadline) : '');
                      setDeadlineReason('');
                      setDeadlineError('');
                    }}
                  >
                    {s.entryDeadline ? 'Board Deadline' : 'Set Board Deadline'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSeriesSession(s);
                      setSeriesForm({ sessionType: s.sessionType as SessionType, seriesYear: String(s.seriesYear), reason: '' });
                      setSeriesError('');
                      setSeriesResult(null);
                    }}
                  >
                    Correct Series
                  </Button>
                  {s.status === 'draft' && (
                    <Button
                      size="sm"
                      onClick={() => {
                        if (confirm(`Activate "${s.name}"? Registration will open immediately.`)) {
                          activateMutation.mutate(s.id);
                        }
                      }}
                      disabled={activateMutation.isPending}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      Activate
                    </Button>
                  )}

                  {s.status === 'active' && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setExtendingSession(s);
                          setNewEndDate(toDatetimeLocal(s.endDate));
                          setExtendReason('');
                          setExtendError('');
                        }}
                      >
                        Extend Deadline
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm(`Close "${s.name}" early? Students will no longer be able to register.`)) {
                            closeMutation.mutate(s.id);
                          }
                        }}
                        disabled={closeMutation.isPending}
                        className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                      >
                        Close Early
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
