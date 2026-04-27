'use client';

import { useState } from 'react';
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { COUNCIL_LABELS, type CreateSubjectType, type UpdateSubjectType } from '@repo/validations';
import { Button } from '~/components/ui/button';

type Subject = {
  id: string;
  name: string;
  code: string;
  council: string;
  priceInSchool: number;
  isOfferedAtSchool: boolean;
  customPrice: number | null;
  isActive: boolean;
  isCore: boolean;
  createdAt: string;
  updatedAt: string;
};

const COUNCIL_OPTIONS = [
  { value: 'pearson_edexcel', label: 'Pearson Edexcel' },
  { value: 'cambridge', label: 'Cambridge' },
  { value: 'oxford', label: 'Oxford' },
];

const emptyForm = {
  name: '',
  code: '',
  council: 'cambridge' as const,
  priceInSchool: '',
  isOfferedAtSchool: true,
  customPrice: '',
  isCore: false,
};

export default function SubjectsAdminClient(): React.JSX.Element {
  const queryClient = useQueryClient();

  // UI state
  const [showForm, setShowForm] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [filterCouncil, setFilterCouncil] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [formError, setFormError] = useState('');

  // Form state
  const [form, setForm] = useState(emptyForm);

  const { data: subjects } = useSuspenseQuery({
    queryKey: ['subjects', 'admin'],
    queryFn: async () => apiResponse(api.v1.subjects.$get({ query: {} })),
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateSubjectType) =>
      apiResponse(api.v1.subjects.$post({ json: data })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] });
      closeForm();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateSubjectType }) =>
      apiResponse(api.v1.subjects[':id'].$put({ param: { id }, json: data })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] });
      closeForm();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) =>
      apiResponse(api.v1.subjects[':id'].$delete({ param: { id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subjects'] }),
  });

  const activateMutation = useMutation({
    mutationFn: async (id: string) =>
      apiResponse(api.v1.subjects[':id'].activate.$put({ param: { id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subjects'] }),
  });

  const setCoreMutation = useMutation({
    mutationFn: async ({ id, isCore }: { id: string; isCore: boolean }) =>
      apiResponse(api.v1.subjects[':id'].core.$put({ param: { id }, json: { isCore } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subjects'] }),
  });

  function openCreateForm() {
    setEditingSubject(null);
    setForm(emptyForm);
    setFormError('');
    setShowForm(true);
  }

  function openEditForm(s: Subject) {
    setEditingSubject(s);
    setForm({
      name: s.name,
      code: s.code,
      council: s.council as typeof emptyForm['council'],
      priceInSchool: String(s.priceInSchool),
      isOfferedAtSchool: s.isOfferedAtSchool,
      customPrice: s.customPrice !== null ? String(s.customPrice) : '',
      isCore: s.isCore,
    });
    setFormError('');
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingSubject(null);
    setForm(emptyForm);
    setFormError('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    const priceInSchool = parseFloat(form.priceInSchool);
    if (isNaN(priceInSchool) || priceInSchool <= 0) {
      setFormError('Please enter a valid price in school.');
      return;
    }

    const customPrice =
      !form.isOfferedAtSchool && form.customPrice
        ? parseFloat(form.customPrice)
        : null;

    if (!form.isOfferedAtSchool && (customPrice === null || isNaN(customPrice!) || customPrice! <= 0)) {
      setFormError('Custom price is required when subject is not offered at school.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      council: form.council,
      priceInSchool,
      isOfferedAtSchool: form.isOfferedAtSchool,
      customPrice: customPrice ?? undefined,
      isCore: form.isCore,
    };

    if (editingSubject) {
      updateMutation.mutate({ id: editingSubject.id, data: payload });
    } else {
      createMutation.mutate(payload as CreateSubjectType);
    }
  }

  // Client-side filtering
  const filtered = (subjects as Subject[]).filter((s) => {
    if (filterCouncil && s.council !== filterCouncil) return false;
    if (filterStatus === 'active' && !s.isActive) return false;
    if (filterStatus === 'inactive' && s.isActive) return false;
    if (filterSearch) {
      const term = filterSearch.toLowerCase();
      return (
        s.name.toLowerCase().includes(term) ||
        s.code.toLowerCase().includes(term)
      );
    }
    return true;
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="px-6 py-8 max-w-6xl mx-auto animate-fade-up">

      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">
            Subject Management
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {(subjects as Subject[]).length} subject{(subjects as Subject[]).length !== 1 ? 's' : ''} total
            &nbsp;·&nbsp;
            {(subjects as Subject[]).filter((s) => s.isActive).length} active
          </p>
        </div>
        <Button onClick={openCreateForm}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Subject
        </Button>
      </div>

      {/* Create / Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-card shadow-xl border border-border">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground font-display">
                {editingSubject ? 'Edit Subject' : 'New Subject'}
              </h2>
              <button
                onClick={closeForm}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
              {formError && (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Subject Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Mathematics"
                    required
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Subject Code <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    placeholder="e.g. MATH-4MB1"
                    required
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Council <span className="text-destructive">*</span>
                  </label>
                  <select
                    value={form.council}
                    onChange={(e) => setForm({ ...form, council: e.target.value as typeof form.council })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {COUNCIL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Price (In-School) <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">EGP</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.priceInSchool}
                      onChange={(e) => setForm({ ...form, priceInSchool: e.target.value })}
                      required
                      className="w-full rounded-lg border border-border bg-background py-2 pl-12 pr-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-5">
                  <input
                    id="isCore"
                    type="checkbox"
                    checked={form.isCore}
                    onChange={(e) => setForm({ ...form, isCore: e.target.checked })}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <label htmlFor="isCore" className="text-sm font-medium text-foreground">
                    Core (Grade 10)
                  </label>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4">
                <div className="flex items-center gap-3">
                  <input
                    id="isOfferedAtSchool"
                    type="checkbox"
                    checked={form.isOfferedAtSchool}
                    onChange={(e) => setForm({ ...form, isOfferedAtSchool: e.target.checked, customPrice: '' })}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <label htmlFor="isOfferedAtSchool" className="text-sm font-medium text-foreground">
                    Offered at school
                  </label>
                </div>

                {!form.isOfferedAtSchool && (
                  <div className="mt-3">
                    <label className="mb-1 block text-sm font-medium text-foreground">
                      Custom Price (External) <span className="text-destructive">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">EGP</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.customPrice}
                        onChange={(e) => setForm({ ...form, customPrice: e.target.value })}
                        required={!form.isOfferedAtSchool}
                        className="w-full rounded-lg border border-border bg-background py-2 pl-12 pr-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Applies when the school does not teach this subject.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeForm}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isPending}
                >
                  {isPending
                    ? editingSubject ? 'Saving...' : 'Creating...'
                    : editingSubject ? 'Save Changes' : 'Create Subject'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          placeholder="Search by name or code..."
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={filterCouncil}
          onChange={(e) => setFilterCouncil(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Councils</option>
          {COUNCIL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Subject Table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center shadow-sm">
          <p className="text-muted-foreground">No subjects found.</p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Subject</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Council</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Price</th>
                <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Core</th>
                <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className={`transition-colors hover:bg-muted/50 ${!s.isActive ? 'opacity-60' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{s.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{s.code}</div>
                  </td>
                  <td className="px-4 py-3 text-card-foreground">
                    {COUNCIL_LABELS[s.council as keyof typeof COUNCIL_LABELS] ?? s.council}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">
                    <div>EGP {s.priceInSchool.toLocaleString()}</div>
                    {!s.isOfferedAtSchool && s.customPrice !== null && (
                      <div className="text-xs text-amber-600 dark:text-amber-400">
                        External: EGP {s.customPrice.toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => setCoreMutation.mutate({ id: s.id, isCore: !s.isCore })}
                      disabled={setCoreMutation.isPending}
                      title={s.isCore ? 'Remove core designation' : 'Mark as core'}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors ${
                        s.isCore
                          ? 'bg-brand-100 text-brand-700 hover:bg-brand-200 dark:bg-brand-900/40 dark:text-brand-300'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      {s.isCore ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3.5 w-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        s.isActive
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditForm(s)}
                        className="text-primary"
                      >
                        Edit
                      </Button>
                      {s.isActive ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Deactivate "${s.name}"? It will no longer appear in registration.`)) {
                              deactivateMutation.mutate(s.id);
                            }
                          }}
                          disabled={deactivateMutation.isPending}
                          className="text-red-600 hover:text-red-800 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => activateMutation.mutate(s.id)}
                          disabled={activateMutation.isPending}
                          className="text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                        >
                          Activate
                        </Button>
                      )}
                    </div>
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
