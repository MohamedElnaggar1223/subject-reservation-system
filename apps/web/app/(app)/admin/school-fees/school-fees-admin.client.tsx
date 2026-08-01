'use client';

/**
 * Admin School Fees Client (V3 §6.2)
 *
 * Spreadsheet-shaped: one grid of schedule rows (year, grade, amount,
 * opens, due), inline delete, and a single add-row form.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { formatPrice } from '~/lib/format';
import { Button } from '~/components/ui/button';

type RefundWindowRow = {
  id: string;
  sessionId: string | null;
  academicYear: string | null;
  startsAt: string;
  endsAt: string;
  percentage: number;
  label: string | null;
};

type SessionOption = { id: string; name: string };

type ScheduleRow = {
  id: string;
  academicYear: string;
  grade: number | null;
  amount: number;
  opensAt: string;
  dueAt: string | null;
};

const emptyForm = {
  academicYear: '',
  grade: '' as '' | '10' | '11' | '12',
  amount: '',
  opensAt: '',
  dueAt: '',
};

export default function SchoolFeesAdminClient(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');

  const { data: schedules = [], isLoading } = useQuery<ScheduleRow[]>({
    queryKey: ['school-fees', 'schedules'],
    queryFn: async () => (await apiResponse(api.v1['school-fees'].schedules.$get())) as ScheduleRow[],
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1['school-fees'].schedules.$post({
          json: {
            academicYear: form.academicYear.trim(),
            grade: form.grade ? (Number(form.grade) as 10 | 11 | 12) : null,
            amount: parseFloat(form.amount),
            opensAt: new Date(form.opensAt),
            dueAt: form.dueAt ? new Date(form.dueAt) : null,
          },
        })
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['school-fees'] });
      setForm(emptyForm);
      setFormError('');
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiResponse(api.v1['school-fees'].schedules[':id'].$delete({ param: { id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['school-fees'] }),
  });

  // ── Refund windows (V3 §6.12) ──────────────────────────────────────────────

  const [rwForm, setRwForm] = useState({
    scope: 'year' as 'year' | 'session',
    sessionId: '',
    academicYear: '',
    startsAt: '',
    endsAt: '',
    percentage: '',
    label: '',
  });
  const [rwError, setRwError] = useState('');

  const { data: refundWindows = [] } = useQuery<RefundWindowRow[]>({
    queryKey: ['refund-windows'],
    queryFn: async () => (await apiResponse(api.v1.receipts['refund-windows'].$get())) as RefundWindowRow[],
  });

  const { data: allSessions = [] } = useQuery<SessionOption[]>({
    queryKey: ['sessions', 'all-admin'],
    queryFn: async () => (await apiResponse(api.v1.sessions.$get({ query: {} }))) as SessionOption[],
  });

  const createWindowMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.receipts['refund-windows'].$post({
          json: {
            sessionId: rwForm.scope === 'session' ? rwForm.sessionId : null,
            academicYear: rwForm.scope === 'year' ? rwForm.academicYear.trim() : null,
            startsAt: new Date(rwForm.startsAt),
            endsAt: new Date(rwForm.endsAt),
            percentage: parseFloat(rwForm.percentage),
            label: rwForm.label.trim() || null,
          },
        })
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['refund-windows'] });
      setRwForm({ scope: 'year', sessionId: '', academicYear: '', startsAt: '', endsAt: '', percentage: '', label: '' });
      setRwError('');
    },
    onError: (err: Error) => setRwError(err.message),
  });

  const deleteWindowMutation = useMutation({
    mutationFn: (id: string) =>
      apiResponse(api.v1.receipts['refund-windows'][':id'].$delete({ param: { id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['refund-windows'] }),
  });

  const sessionName = (id: string | null) => allSessions.find((x) => x.id === id)?.name ?? id ?? '—';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    const amount = parseFloat(form.amount);
    if (!/^\d{4}-\d{4}$/.test(form.academicYear.trim())) {
      setFormError('Academic year must look like 2026-2027.');
      return;
    }
    if (isNaN(amount) || amount < 0) {
      setFormError('Enter a valid amount.');
      return;
    }
    if (!form.opensAt) {
      setFormError('Set the opening date.');
      return;
    }
    createMutation.mutate();
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">School Fees</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Annual school-year access fees. Leave grade empty for a uniform amount; add per-grade
          rows to override. Unpaid fees block subject registration for that year.
        </p>
      </div>

      {/* Add row */}
      <form onSubmit={handleSubmit} className="bg-card rounded-xl border border-border shadow-sm p-5 mb-6">
        <div className="grid gap-3 sm:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Academic Year</label>
            <input
              type="text"
              value={form.academicYear}
              onChange={(e) => setForm({ ...form, academicYear: e.target.value })}
              placeholder="2026-2027"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Grade</label>
            <select
              value={form.grade}
              onChange={(e) => setForm({ ...form, grade: e.target.value as typeof form.grade })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All grades (uniform)</option>
              <option value="10">Grade 10</option>
              <option value="11">Grade 11</option>
              <option value="12">Grade 12</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Amount (EGP)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Opens</label>
            <input
              type="date"
              value={form.opensAt}
              onChange={(e) => setForm({ ...form, opensAt: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Due (optional)</label>
            <input
              type="date"
              value={form.dueAt}
              onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        {formError && <p className="mt-3 text-sm text-destructive">{formError}</p>}
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Adding…' : 'Add Fee Row'}
          </Button>
        </div>
      </form>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        </div>
      ) : schedules.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center shadow-sm">
          <p className="text-muted-foreground">No fee schedules yet — the registration gate is off.</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Academic Year</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Grade</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Amount</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Opens</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Due</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {schedules.map((row) => (
                <tr key={row.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{row.academicYear}</td>
                  <td className="px-4 py-3 text-card-foreground">
                    {row.grade ? `Grade ${row.grade}` : 'All grades'}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">{formatPrice(row.amount)}</td>
                  <td className="px-4 py-3 text-card-foreground">
                    {new Date(row.opensAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-card-foreground">
                    {row.dueAt ? new Date(row.dueAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-800 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (confirm(`Delete the ${row.academicYear} fee row?`)) {
                          deleteMutation.mutate(row.id);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Refund Windows (V3 §6.12) ─────────────────────────────────── */}
      <div className="mt-12 mb-6">
        <h2 className="text-xl font-bold text-foreground font-display tracking-tight">Refund Windows</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Time-scaled drop refunds. While a scope has windows, gaps between them refund 0%; a
          scope with no windows refunds 100%. Session windows override academic-year windows.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setRwError('');
          const pct = parseFloat(rwForm.percentage);
          if (isNaN(pct) || pct < 0 || pct > 100) { setRwError('Percentage must be 0–100.'); return; }
          if (rwForm.scope === 'session' && !rwForm.sessionId) { setRwError('Pick a session.'); return; }
          if (rwForm.scope === 'year' && !/^\d{4}-\d{4}$/.test(rwForm.academicYear.trim())) { setRwError('Academic year must look like 2026-2027.'); return; }
          if (!rwForm.startsAt || !rwForm.endsAt) { setRwError('Set both dates.'); return; }
          createWindowMutation.mutate();
        }}
        className="bg-card rounded-xl border border-border shadow-sm p-5 mb-6"
      >
        <div className="grid gap-3 sm:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Scope</label>
            <select
              value={rwForm.scope}
              onChange={(e) => setRwForm({ ...rwForm, scope: e.target.value as 'year' | 'session' })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="year">Academic year</option>
              <option value="session">Session</option>
            </select>
          </div>
          {rwForm.scope === 'session' ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Session</label>
              <select
                value={rwForm.sessionId}
                onChange={(e) => setRwForm({ ...rwForm, sessionId: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">Pick…</option>
                {allSessions.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Academic Year</label>
              <input
                type="text"
                value={rwForm.academicYear}
                onChange={(e) => setRwForm({ ...rwForm, academicYear: e.target.value })}
                placeholder="2026-2027"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">From</label>
            <input type="date" value={rwForm.startsAt} onChange={(e) => setRwForm({ ...rwForm, startsAt: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">To</label>
            <input type="date" value={rwForm.endsAt} onChange={(e) => setRwForm({ ...rwForm, endsAt: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Refund %</label>
            <input type="number" min="0" max="100" value={rwForm.percentage} onChange={(e) => setRwForm({ ...rwForm, percentage: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Label</label>
            <input type="text" value={rwForm.label} onChange={(e) => setRwForm({ ...rwForm, label: e.target.value })}
              placeholder="Before entry deadline" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground" />
          </div>
        </div>
        {rwError && <p className="mt-3 text-sm text-destructive">{rwError}</p>}
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={createWindowMutation.isPending}>
            {createWindowMutation.isPending ? 'Adding…' : 'Add Window'}
          </Button>
        </div>
      </form>

      {refundWindows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <p className="text-muted-foreground text-sm">No refund windows — drops refund 100% until configured.</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Scope</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Label</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">From</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">To</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Refund</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {refundWindows.map((w) => (
                <tr key={w.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-4 py-3 text-card-foreground">
                    {w.sessionId ? sessionName(w.sessionId) : w.academicYear}
                  </td>
                  <td className="px-4 py-3 text-card-foreground">{w.label ?? '—'}</td>
                  <td className="px-4 py-3 text-card-foreground">{new Date(w.startsAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-card-foreground">{new Date(w.endsAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">{w.percentage}%</td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-800 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                      disabled={deleteWindowMutation.isPending}
                      onClick={() => { if (confirm('Delete this refund window?')) deleteWindowMutation.mutate(w.id); }}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
