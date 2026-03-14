'use client';

import { useState } from 'react';
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { COUNCIL_LABELS, type CreateSubjectType, type UpdateSubjectType } from '@repo/validations';

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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-8">

        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Subject Management
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {(subjects as Subject[]).length} subject{(subjects as Subject[]).length !== 1 ? 's' : ''} total
              &nbsp;·&nbsp;
              {(subjects as Subject[]).filter((s) => s.isActive).length} active
            </p>
          </div>
          <button
            onClick={openCreateForm}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Subject
          </button>
        </div>

        {/* Create / Edit Form Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-slate-800">
              <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {editingSubject ? 'Edit Subject' : 'New Subject'}
                </h2>
                <button
                  onClick={closeForm}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
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
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Subject Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. Mathematics"
                      required
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-400"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Subject Code <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                      placeholder="e.g. MATH-4MB1"
                      required
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:placeholder-slate-400"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Council <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={form.council}
                      onChange={(e) => setForm({ ...form, council: e.target.value as typeof form.council })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                    >
                      {COUNCIL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Price (In-School) <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">EGP</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.priceInSchool}
                        onChange={(e) => setForm({ ...form, priceInSchool: e.target.value })}
                        required
                        className="w-full rounded-lg border border-slate-300 py-2 pl-12 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-5">
                    <input
                      id="isCore"
                      type="checkbox"
                      checked={form.isCore}
                      onChange={(e) => setForm({ ...form, isCore: e.target.checked })}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="isCore" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Core (Grade 10)
                    </label>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-600">
                  <div className="flex items-center gap-3">
                    <input
                      id="isOfferedAtSchool"
                      type="checkbox"
                      checked={form.isOfferedAtSchool}
                      onChange={(e) => setForm({ ...form, isOfferedAtSchool: e.target.checked, customPrice: '' })}
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="isOfferedAtSchool" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Offered at school
                    </label>
                  </div>

                  {!form.isOfferedAtSchool && (
                    <div className="mt-3">
                      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                        Custom Price (External) <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-3 flex items-center text-sm text-slate-400">EGP</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.customPrice}
                          onChange={(e) => setForm({ ...form, customPrice: e.target.value })}
                          required={!form.isOfferedAtSchool}
                          className="w-full rounded-lg border border-slate-300 py-2 pl-12 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Applies when the school does not teach this subject.
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeForm}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isPending
                      ? editingSubject ? 'Saving…' : 'Creating…'
                      : editingSubject ? 'Save Changes' : 'Create Subject'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            placeholder="Search by name or code…"
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder-slate-400"
          />
          <select
            value={filterCouncil}
            onChange={(e) => setFilterCouncil(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          >
            <option value="">All Councils</option>
            {COUNCIL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {/* Subject Table */}
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <p className="text-slate-500 dark:text-slate-400">No subjects found.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">Subject</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-600 dark:text-slate-300">Council</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">Price</th>
                  <th className="px-4 py-3 text-center font-semibold text-slate-600 dark:text-slate-300">Core</th>
                  <th className="px-4 py-3 text-center font-semibold text-slate-600 dark:text-slate-300">Status</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-600 dark:text-slate-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50 ${!s.isActive ? 'opacity-60' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{s.name}</div>
                      <div className="font-mono text-xs text-slate-400">{s.code}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {COUNCIL_LABELS[s.council as keyof typeof COUNCIL_LABELS] ?? s.council}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-200">
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
                            ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300'
                            : 'bg-slate-100 text-slate-400 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-500'
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
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                        }`}
                      >
                        {s.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditForm(s)}
                          className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-900/20"
                        >
                          Edit
                        </button>
                        {s.isActive ? (
                          <button
                            onClick={() => {
                              if (confirm(`Deactivate "${s.name}"? It will no longer appear in registration.`)) {
                                deactivateMutation.mutate(s.id);
                              }
                            }}
                            disabled={deactivateMutation.isPending}
                            className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => activateMutation.mutate(s.id)}
                            disabled={activateMutation.isPending}
                            className="rounded px-2 py-1 text-xs font-medium text-green-600 hover:bg-green-50 hover:text-green-800 dark:text-green-400 dark:hover:bg-green-900/20"
                          >
                            Activate
                          </button>
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
    </div>
  );
}
