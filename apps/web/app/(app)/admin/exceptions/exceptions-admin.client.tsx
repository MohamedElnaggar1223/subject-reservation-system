'use client';

/**
 * Admin Exceptions Client (V3 §6.3)
 *
 * One grant form + one grid. The four enforcement hooks (pricing,
 * window checks, school-fee gate, refund %) pick these up automatically.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, EXCEPTION_TYPES, EXCEPTION_TYPE_LABELS } from '@repo/validations';
import { Button } from '~/components/ui/button';

type ExceptionRow = {
  id: string;
  type: string;
  value: number | null;
  reason: string;
  status: string;
  validUntil: string | null;
  createdAt: string;
  student: { id: string; name: string; email: string; grade: number | null } | null;
  session: { id: string; name: string } | null;
  subject: { id: string; name: string; code: string } | null;
};

type StudentRow = { id: string; name: string; email: string; grade: number | null };
type SessionRow = { id: string; name: string };
type SubjectRow = { id: string; name: string; code: string };

const VALUE_TYPES = ['discount_percent', 'discount_fixed', 'custom_price', 'custom_refund_percent'];
const DEADLINE_TYPES = ['deadline_extension', 'late_registration'];

const emptyForm = {
  type: 'discount_percent' as (typeof EXCEPTION_TYPES)[number],
  studentId: '',
  sessionId: '',
  subjectId: '',
  value: '',
  reason: '',
  validUntil: '',
};

export default function ExceptionsAdminClient(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [studentSearch, setStudentSearch] = useState('');

  const { data: exceptions = [], isLoading } = useQuery<ExceptionRow[]>({
    queryKey: ['exceptions'],
    queryFn: async () => (await apiResponse(api.v1.exceptions.$get({ query: {} }))) as ExceptionRow[],
  });

  const { data: students = [] } = useQuery<StudentRow[]>({
    queryKey: ['users', 'students', studentSearch],
    queryFn: async () =>
      (await apiResponse(
        api.v1.users.$get({ query: { role: 'student', search: studentSearch || undefined } })
      )) as StudentRow[],
  });

  const { data: sessions = [] } = useQuery<SessionRow[]>({
    queryKey: ['sessions', 'all-admin'],
    queryFn: async () => (await apiResponse(api.v1.sessions.$get({ query: {} }))) as SessionRow[],
  });

  const { data: subjects = [] } = useQuery<SubjectRow[]>({
    queryKey: ['subjects', 'admin'],
    queryFn: async () => (await apiResponse(api.v1.subjects.$get({ query: {} }))) as SubjectRow[],
  });

  const grantMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.exceptions.$post({
          json: {
            type: form.type,
            studentId: form.studentId,
            sessionId: form.sessionId || null,
            subjectId: form.subjectId || null,
            value: form.value ? parseFloat(form.value) : null,
            reason: form.reason.trim(),
            validUntil: form.validUntil ? new Date(form.validUntil) : null,
          },
        })
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
      setForm(emptyForm);
      setFormError('');
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) =>
      apiResponse(api.v1.exceptions[':id'].revoke.$post({ param: { id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exceptions'] }),
  });

  const needsValue = VALUE_TYPES.includes(form.type);
  const needsExpiry = DEADLINE_TYPES.includes(form.type);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!form.studentId) { setFormError('Pick a student.'); return; }
    if (needsValue && !(parseFloat(form.value) >= 0)) { setFormError('This exception type needs a value.'); return; }
    if (needsExpiry && !form.validUntil) { setFormError('Deadline extensions need an expiry date.'); return; }
    if (form.reason.trim().length < 3) { setFormError('A reason is required.'); return; }
    grantMutation.mutate();
  }

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto animate-fade-up">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Exceptions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Per-student overrides — discounts, custom prices, fee waivers, deadline extensions,
          custom refund percentages. Everything is audited.
        </p>
      </div>

      {/* Grant form */}
      <form onSubmit={handleSubmit} className="bg-card rounded-xl border border-border shadow-sm p-5 mb-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {EXCEPTION_TYPES.map((t) => (
                <option key={t} value={t}>{EXCEPTION_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Student</label>
            <input
              type="text"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="Search students…"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground mb-1"
            />
            <select
              value={form.studentId}
              onChange={(e) => setForm({ ...form, studentId: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Pick a student…</option>
              {students.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}{st.grade ? ` (G${st.grade})` : ''}
                </option>
              ))}
            </select>
          </div>

          {needsValue && (
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                {form.type === 'discount_fixed' || form.type === 'custom_price' ? 'Value (EGP)' : 'Value (%)'}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Session (optional scope)</label>
            <select
              value={form.sessionId}
              onChange={(e) => setForm({ ...form, sessionId: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">All sessions</option>
              {sessions.map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Subject (optional scope)</label>
            <select
              value={form.subjectId}
              onChange={(e) => setForm({ ...form, subjectId: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">All subjects</option>
              {subjects.map((x) => (
                <option key={x.id} value={x.id}>{x.name} ({x.code})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">
              Valid until {needsExpiry ? '' : '(optional)'}
            </label>
            <input
              type="date"
              value={form.validUntil}
              onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>

          <div className="sm:col-span-3">
            <label className="mb-1 block text-xs font-medium text-foreground">Reason</label>
            <input
              type="text"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="e.g. Sibling discount approved by headmistress"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>
        {formError && <p className="mt-3 text-sm text-destructive">{formError}</p>}
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={grantMutation.isPending}>
            {grantMutation.isPending ? 'Granting…' : 'Grant Exception'}
          </Button>
        </div>
      </form>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        </div>
      ) : exceptions.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center shadow-sm">
          <p className="text-muted-foreground">No exceptions granted.</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Student</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Type</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Scope</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Value</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Reason</th>
                <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {exceptions.map((e) => (
                <tr key={e.id} className={`hover:bg-muted/50 transition-colors ${e.status === 'revoked' ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{e.student?.name ?? '—'}</div>
                    {e.student?.grade && <div className="text-xs text-muted-foreground">Grade {e.student.grade}</div>}
                  </td>
                  <td className="px-4 py-3 text-card-foreground">
                    {EXCEPTION_TYPE_LABELS[e.type as keyof typeof EXCEPTION_TYPE_LABELS] ?? e.type}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {e.session?.name ?? 'All sessions'}
                    {e.subject && <> · {e.subject.name}</>}
                    {e.validUntil && <> · until {new Date(e.validUntil).toLocaleDateString()}</>}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">
                    {e.value != null
                      ? ['discount_percent', 'custom_refund_percent'].includes(e.type)
                        ? `${e.value}%`
                        : `EGP ${e.value.toLocaleString()}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-card-foreground max-w-[220px] truncate" title={e.reason}>
                    {e.reason}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      e.status === 'active'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {e.status === 'active' ? 'Active' : 'Revoked'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {e.status === 'active' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-800 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                        disabled={revokeMutation.isPending}
                        onClick={() => {
                          if (confirm(`Revoke this exception for ${e.student?.name ?? 'student'}?`)) {
                            revokeMutation.mutate(e.id);
                          }
                        }}
                      >
                        Revoke
                      </Button>
                    )}
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
