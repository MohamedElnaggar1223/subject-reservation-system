'use client';

import { useState } from 'react';
import { useSuspenseQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { COUNCIL_LABELS, QUALIFICATION_LEVEL_LABELS, type CreateSubjectType, type UpdateSubjectType } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { toCsv, downloadCsv } from '~/lib/csv';

type Subject = {
  id: string;
  name: string;
  code: string;
  council: string;
  qualificationLevel: string;
  courseFee: number;
  registrationFee: number;
  priceInSchool: number;
  isOfferedAtSchool: boolean;
  isActive: boolean;
  isCore: boolean;
  createdAt: string;
  updatedAt: string;
};

const LEVEL_OPTIONS = [
  { value: 'igcse', label: 'IGCSE' },
  { value: 'as_level', label: 'AS Level' },
  { value: 'a_level', label: 'A Level' },
];

const COUNCIL_OPTIONS = [
  { value: 'pearson_edexcel', label: 'Pearson Edexcel' },
  { value: 'cambridge', label: 'Cambridge International' },
  { value: 'oxford', label: 'OxfordAQA' },
];

const emptyForm = {
  name: '',
  code: '',
  council: 'cambridge' as const,
  qualificationLevel: 'igcse' as const,
  courseFee: '',
  registrationFee: '',
  isOfferedAtSchool: true,
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

  // CSV import (UX_AUDIT G10): paste straight from the Excel price list
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importReport, setImportReport] = useState('');

  // Teacher-linking modal state (V3 §6.7)
  type TeacherRow = { id: string; name: string; isActive: boolean };
  const [teacherTarget, setTeacherTarget] = useState<Subject | null>(null);
  const [linkedTeacherIds, setLinkedTeacherIds] = useState<Set<string>>(new Set());
  const [newTeacherName, setNewTeacherName] = useState('');
  const [teacherError, setTeacherError] = useState('');

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

  // ── Teachers (V3 §6.7) ──────────────────────────────────────────────────────

  const { data: allTeachers = [] } = useQuery<TeacherRow[]>({
    queryKey: ['teachers', 'admin'],
    queryFn: async () => (await apiResponse(api.v1.teachers.$get({ query: {} }))) as TeacherRow[],
    enabled: !!teacherTarget,
  });

  const { isFetching: loadingLinked } = useQuery({
    queryKey: ['subjects', 'teachers', teacherTarget?.id],
    queryFn: async () => {
      // Explicit cast: this endpoint's RPC inference degrades to never in
      // the web compile (pre-existing quirk shared by e.g. checkout-summary)
      const linked = (await apiResponse(
        api.v1.subjects[':id'].teachers.$get({ param: { id: teacherTarget!.id } })
      )) as TeacherRow[];
      setLinkedTeacherIds(new Set(linked.map((t) => t.id)));
      return linked;
    },
    enabled: !!teacherTarget,
  });

  const saveTeachersMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.subjects[':id'].teachers.$put({
          param: { id: teacherTarget!.id },
          json: { teacherIds: Array.from(linkedTeacherIds) },
        })
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] });
      queryClient.invalidateQueries({ queryKey: ['teachers'] });
      setTeacherTarget(null);
      setTeacherError('');
    },
    onError: (err: Error) => setTeacherError(err.message),
  });

  const createTeacherMutation = useMutation({
    mutationFn: (name: string) =>
      apiResponse(api.v1.teachers.$post({ json: { name } })),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['teachers'] });
      setLinkedTeacherIds((prev) => new Set(prev).add((created as unknown as { id: string }).id));
      setNewTeacherName('');
      setTeacherError('');
    },
    onError: (err: Error) => setTeacherError(err.message),
  });

  async function runImport() {
    setImportReport('');
    const lines = importText.split('\n').map((l) => l.trim()).filter(Boolean);
    let ok = 0;
    const errors: string[] = [];

    // Excel's clipboard is TAB-separated but keeps display formatting, so
    // a price of 15,000 arrives as literal "15,000". Splitting on comma
    // as well shattered that into two cells, shifted every later column,
    // and imported the subject at 15 EGP with no error — the first
    // symptom was a parent paying 15 EGP. Prefer tabs when present, and
    // strip thousands separators from numbers.
    const splitCells = (line: string) =>
      (line.includes('\t') ? line.split('\t') : line.split(/[,;]/)).map((c) => c.trim());
    const parseMoney = (raw: string | undefined) =>
      parseFloat((raw ?? '').replace(/[,\s]/g, '').replace(/[^\d.\-]/g, ''));

    for (const [i, line] of lines.entries()) {
      const cells = splitCells(line);
      // Header row: tolerate "Subject"/"Name" and any casing
      if (i === 0 && /^(name|subject)$/i.test(cells[0] ?? '') ) continue;
      if (cells.length < 5 || cells.length > 7) {
        errors.push(
          `Line ${i + 1}: found ${cells.length} columns, expected 5-7 (name, code, council, level, courseFee, registrationFee, core). If you pasted from Excel, paste the cells directly rather than a comma-formatted copy.`
        );
        continue;
      }
      const [name, code, councilRaw, levelRaw, courseFeeRaw, regFeeRaw, coreRaw] = cells;
      const council = (councilRaw ?? '').toLowerCase().replace(/\s+/g, '_');
      const level = (levelRaw ?? 'igcse').toLowerCase().replace(/\s+/g, '_');
      const courseFee = parseMoney(courseFeeRaw);
      const registrationFee = regFeeRaw ? parseMoney(regFeeRaw) : 0;
      if (!name || !code || isNaN(courseFee)) {
        errors.push(`Line ${i + 1}: needs a name, a code, and a numeric course fee`);
        continue;
      }
      if (!['pearson_edexcel', 'cambridge', 'oxford'].includes(council)) {
        errors.push(`Line ${i + 1}: council must be Pearson Edexcel, Cambridge, or Oxford`);
        continue;
      }
      try {
        await apiResponse(
          api.v1.subjects.$post({
            json: {
              name,
              code: code.toUpperCase(),
              council: council as 'cambridge',
              qualificationLevel: (['igcse', 'as_level', 'a_level'].includes(level) ? level : 'igcse') as 'igcse',
              courseFee,
              registrationFee: isNaN(registrationFee) ? 0 : registrationFee,
              isOfferedAtSchool: true,
              isCore: /^(yes|true|core|1)$/i.test(coreRaw ?? ''),
            },
          })
        );
        ok++;
      } catch (e) {
        errors.push(`Line ${i + 1} (${code}): ${e instanceof Error ? e.message : 'failed'}`);
      }
    }
    queryClient.invalidateQueries({ queryKey: ['subjects'] });
    setImportReport(`Imported ${ok} subject(s).${errors.length ? ` Problems:\n${errors.join('\n')}` : ''}`);
    if (errors.length === 0) setImportText('');
  }

  function exportCsv() {
    // Escaped + formula-guarded (subject names/codes are user-authored)
    const csv = toCsv(
      ['name', 'code', 'council', 'level', 'courseFee', 'registrationFee', 'core'],
      (subjects as Subject[]).map((x) => [
        x.name,
        x.code,
        x.council,
        x.qualificationLevel,
        x.courseFee,
        x.registrationFee,
        x.isCore ? 'yes' : 'no',
      ])
    );
    downloadCsv('subjects.csv', csv);
  }

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
      qualificationLevel: s.qualificationLevel as typeof emptyForm['qualificationLevel'],
      courseFee: String(s.courseFee),
      registrationFee: String(s.registrationFee),
      isOfferedAtSchool: s.isOfferedAtSchool,
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

    const courseFee = parseFloat(form.courseFee);
    const registrationFee = parseFloat(form.registrationFee);
    if (isNaN(courseFee) || courseFee < 0) {
      setFormError('Please enter a valid course fee (0 or more).');
      return;
    }
    if (isNaN(registrationFee) || registrationFee < 0) {
      setFormError('Please enter a valid registration fee (0 or more).');
      return;
    }

    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      council: form.council,
      qualificationLevel: form.qualificationLevel,
      courseFee,
      registrationFee,
      isOfferedAtSchool: form.isOfferedAtSchool,
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
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
          <Button variant="outline" onClick={() => { setShowImport((v) => !v); setImportReport(''); }}>
            {showImport ? 'Close Import' : 'Import CSV'}
          </Button>
          <Button onClick={openCreateForm}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Subject
          </Button>
        </div>
      </div>

      {/* CSV import (UX_AUDIT G10) — paste straight from the Excel price list */}
      {showImport && (
        <div className="mb-6 bg-card rounded-xl border border-border shadow-sm p-5">
          <h2 className="text-sm font-semibold text-foreground font-display mb-1">Import subjects from Excel</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Paste rows as: <span className="font-mono">name, code, council, level, courseFee, registrationFee, core</span>{' '}
            Paste cells straight from Excel (tab separated), or use commas. Prices may include
            thousands separators. Council: Pearson Edexcel, Cambridge, or Oxford. Level: IGCSE,
            AS Level, or A Level. Core: yes/no. Every row is reported back — nothing imports silently.
          </p>
          <textarea
            rows={6}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'Mathematics B,4MB1,Pearson Edexcel,IGCSE,5000,7000,yes\nBiology,0610,Cambridge,IGCSE,4500,7100,no'}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground font-mono"
          />
          {importReport && (
            <pre className="mt-3 text-xs text-foreground whitespace-pre-wrap bg-muted rounded-lg p-3">{importReport}</pre>
          )}
          <div className="mt-3 flex justify-end">
            <Button disabled={!importText.trim()} onClick={runImport}>Import</Button>
          </div>
        </div>
      )}

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
                    Qualification Level <span className="text-destructive">*</span>
                  </label>
                  <select
                    value={form.qualificationLevel}
                    onChange={(e) => setForm({ ...form, qualificationLevel: e.target.value as typeof form.qualificationLevel })}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {LEVEL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Course Fee <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">EGP</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.courseFee}
                      onChange={(e) => setForm({ ...form, courseFee: e.target.value })}
                      required
                      className="w-full rounded-lg border border-border bg-background py-2 pl-12 pr-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Teaching fee.</p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Registration Fee <span className="text-destructive">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">EGP</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.registrationFee}
                      onChange={(e) => setForm({ ...form, registrationFee: e.target.value })}
                      required
                      className="w-full rounded-lg border border-border bg-background py-2 pl-12 pr-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Exam board entry fee.</p>
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
                    onChange={(e) => setForm({ ...form, isOfferedAtSchool: e.target.checked })}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <label htmlFor="isOfferedAtSchool" className="text-sm font-medium text-foreground">
                    Offered at school
                  </label>
                </div>

                {!form.isOfferedAtSchool && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    Not offered at school — students automatically pay 50% of the
                    combined course + registration fee.
                  </p>
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
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Subject</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Council</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Level</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Fees</th>
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
                  <td className="px-4 py-3 text-card-foreground">
                    {QUALIFICATION_LEVEL_LABELS[s.qualificationLevel as keyof typeof QUALIFICATION_LEVEL_LABELS] ?? s.qualificationLevel}
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">
                    <div>EGP {(s.courseFee + s.registrationFee).toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.courseFee.toLocaleString()} + {s.registrationFee.toLocaleString()} reg
                    </div>
                    {!s.isOfferedAtSchool && (
                      <div className="text-xs text-amber-600 dark:text-amber-400">Outside school · 50%</div>
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setTeacherTarget(s); setTeacherError(''); }}
                        className="text-primary"
                      >
                        Teachers
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

      {/* Teachers modal (V3 §6.7) */}
      {teacherTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-xl shadow-xl border border-border max-w-md w-full p-6">
            <h2 className="text-lg font-bold text-foreground font-display mb-1">
              Teachers — {teacherTarget.name}
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Students pick from these teachers (optionally) when registering this subject.
            </p>

            {loadingLinked ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1 mb-4">
                {allTeachers.length === 0 && (
                  <p className="text-sm text-muted-foreground py-2">No teachers yet — add one below.</p>
                )}
                {allTeachers.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm text-foreground py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={linkedTeacherIds.has(t.id)}
                      onChange={(e) =>
                        setLinkedTeacherIds((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(t.id);
                          else next.delete(t.id);
                          return next;
                        })
                      }
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    {t.name}
                    {!t.isActive && <span className="text-xs text-muted-foreground">(inactive)</span>}
                  </label>
                ))}
              </div>
            )}

            <div className="flex gap-2 mb-4">
              <textarea
                rows={1}
                value={newTeacherName}
                onChange={(e) => setNewTeacherName(e.target.value)}
                placeholder="Teacher name — or paste several, one per line"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={createTeacherMutation.isPending || newTeacherName.trim().length === 0}
                onClick={async () => {
                  // Bulk paste (UX_AUDIT G10): one name per line
                  const names = newTeacherName.split('\n').map((n) => n.trim()).filter(Boolean);
                  for (const n of names) {
                    await createTeacherMutation.mutateAsync(n).catch(() => undefined);
                  }
                  setNewTeacherName('');
                }}
              >
                {createTeacherMutation.isPending ? 'Adding…' : 'Add'}
              </Button>
            </div>

            {teacherError && <p className="mb-4 text-sm text-destructive">{teacherError}</p>}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setTeacherTarget(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={saveTeachersMutation.isPending}
                onClick={() => saveTeachersMutation.mutate()}
              >
                {saveTeachersMutation.isPending ? 'Saving…' : 'Save Teachers'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
