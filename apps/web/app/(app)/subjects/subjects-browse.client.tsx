'use client';

import { useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '~/lib/hono';
import { apiResponse, COUNCIL_LABELS } from '@repo/validations';
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
  { value: '', label: 'All Councils' },
  { value: 'pearson_edexcel', label: 'Pearson Edexcel' },
  { value: 'cambridge', label: 'Cambridge' },
  { value: 'oxford', label: 'Oxford' },
];

interface Props {
  userRole: string | null;
}

export default function SubjectsBrowseClient({ userRole }: Props): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [council, setCouncil] = useState('');
  const [showCoreOnly, setShowCoreOnly] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);

  const { data: subjects } = useSuspenseQuery({
    queryKey: ['subjects', 'browse'],
    queryFn: async () => apiResponse(api.v1.subjects.$get({ query: {} })),
  });

  const filtered = (subjects as Subject[]).filter((s) => {
    if (!s.isActive) return false;
    if (council && s.council !== council) return false;
    if (showCoreOnly && !s.isCore) return false;
    if (search) {
      const term = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(term) ||
        s.code.toLowerCase().includes(term)
      );
    }
    return true;
  });

  const subjectsByCouncil = COUNCIL_OPTIONS.slice(1).reduce<Record<string, Subject[]>>(
    (acc, opt) => {
      acc[opt.value] = filtered.filter((s) => s.council === opt.value);
      return acc;
    },
    {}
  );

  const groupByCouncil = !council && !search && !showCoreOnly;

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">
              Available Subjects
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Browse all IGCSE subjects available for registration
            </p>
          </div>
          {userRole === 'admin' && (
            <Link href={"/admin/subjects" as never}>
              <Button variant="outline" size="sm">Manage Subjects</Button>
            </Link>
          )}
        </div>

        {/* Stats */}
        <div className="mt-4 flex flex-wrap gap-4">
          <div className="rounded-lg bg-card border border-border px-4 py-2 shadow-sm">
            <span className="text-2xl font-bold text-primary">
              {(subjects as Subject[]).filter((s) => s.isActive).length}
            </span>
            <span className="ml-2 text-sm text-muted-foreground">Total subjects</span>
          </div>
          <div className="rounded-lg bg-card border border-border px-4 py-2 shadow-sm">
            <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {(subjects as Subject[]).filter((s) => s.isActive && s.isCore).length}
            </span>
            <span className="ml-2 text-sm text-muted-foreground">Core (Grade 10)</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          placeholder="Search by name or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={council}
          onChange={(e) => setCouncil(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {COUNCIL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={() => setShowCoreOnly((prev) => !prev)}
          className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            showCoreOnly
              ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          Core only
        </button>
      </div>

      {/* Subjects List */}
      {filtered.length === 0 ? (
        <div className="bg-card rounded-xl border border-border shadow-sm p-12 text-center">
          <p className="text-muted-foreground">
            {search || council || showCoreOnly
              ? 'No subjects match your search.'
              : 'No subjects are available at this time.'}
          </p>
        </div>
      ) : groupByCouncil ? (
        // Grouped by council when no filter is active
        <div className="space-y-8">
          {COUNCIL_OPTIONS.slice(1).map((opt) => {
            const group = subjectsByCouncil[opt.value];
            if (!group || group.length === 0) return null;
            return (
              <div key={opt.value}>
                <h2 className="mb-3 text-base font-semibold text-foreground font-display">
                  {opt.label}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">({group.length})</span>
                </h2>
                <SubjectGrid subjects={group} onSelect={setSelectedSubject} />
              </div>
            );
          })}
        </div>
      ) : (
        // Flat list when filtering
        <SubjectGrid subjects={filtered} onSelect={setSelectedSubject} />
      )}

      {/* Subject Detail Drawer */}
      {selectedSubject && (
        <SubjectDetailModal subject={selectedSubject} onClose={() => setSelectedSubject(null)} />
      )}
    </div>
  );
}

function SubjectGrid({
  subjects,
  onSelect,
}: {
  subjects: Subject[];
  onSelect: (s: Subject) => void;
}): React.JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {subjects.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelect(s)}
          className="bg-card rounded-xl border border-border p-4 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-foreground">{s.name}</p>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">{s.code}</p>
            </div>
            {s.isCore && (
              <span className="shrink-0 rounded-full bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                Core
              </span>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {COUNCIL_LABELS[s.council as keyof typeof COUNCIL_LABELS] ?? s.council}
            </span>
            <span className="font-semibold text-primary">
              EGP {(s.isOfferedAtSchool ? s.priceInSchool : (s.customPrice ?? s.priceInSchool)).toLocaleString()}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function SubjectDetailModal({
  subject,
  onClose,
}: {
  subject: Subject;
  onClose: () => void;
}): React.JSX.Element {
  const effectivePrice = subject.isOfferedAtSchool
    ? subject.priceInSchool
    : (subject.customPrice ?? subject.priceInSchool);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-card border border-border p-6 shadow-xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground font-display">{subject.name}</h2>
            <p className="mt-1 font-mono text-sm text-muted-foreground">{subject.code}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
            <span className="text-sm text-muted-foreground">Examination Council</span>
            <span className="font-medium text-foreground">
              {COUNCIL_LABELS[subject.council as keyof typeof COUNCIL_LABELS] ?? subject.council}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-brand-50 dark:bg-brand-900/20 px-4 py-3">
            <span className="text-sm text-brand-700 dark:text-brand-400">Registration Price</span>
            <span className="text-lg font-bold text-brand-700 dark:text-brand-400">
              EGP {effectivePrice.toLocaleString()}
            </span>
          </div>

          {!subject.isOfferedAtSchool && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
              <p className="text-sm text-amber-800 dark:text-amber-300">
                This subject is not taught at school. Students register as external candidates.
              </p>
            </div>
          )}

          {subject.isOfferedAtSchool && (
            <div className="rounded-lg border border-border bg-muted px-4 py-3">
              <p className="text-sm text-muted-foreground">
                Students taking school subjects with external teachers pay the full school price.
              </p>
            </div>
          )}

          {subject.isCore && (
            <div className="rounded-lg border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-900/20 px-4 py-3">
              <p className="text-sm font-medium text-brand-800 dark:text-brand-300">
                Core Subject
              </p>
              <p className="mt-0.5 text-sm text-brand-700 dark:text-brand-400">
                Grade 10 students are required to register for this subject in the June session.
              </p>
            </div>
          )}
        </div>

        <Button
          variant="outline"
          onClick={onClose}
          className="mt-5 w-full"
        >
          Close
        </Button>
      </div>
    </div>
  );
}
