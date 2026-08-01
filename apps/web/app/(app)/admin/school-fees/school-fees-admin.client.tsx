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
    </div>
  );
}
