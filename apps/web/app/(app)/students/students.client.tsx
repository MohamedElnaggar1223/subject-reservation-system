'use client';

/**
 * Students (FEATURES_PLAN.md F0a)
 *
 * The spreadsheet version: one sheet per class plus a master list, each row
 * a student with a Grade column someone retypes every September; finding a
 * student is Ctrl-F across tabs, and "who has no class yet?" means
 * comparing the master list with every class tab by eye. Here the grade and
 * standing are derived (never retyped), one search box matches name, email
 * or student ID as you type, and "Without a section this year" answers the
 * comparison in one tick. Enter opens the first match; the arrow keys move
 * through the rows; the filters live in the address, so Back returns to
 * the same list.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiResponse, academicYearShortLabel, academicYearStartFromLabel, gradeLabel, STUDENT_STATUSES } from '@repo/validations';
import { api } from '~/lib/hono';
import { Button } from '~/components/ui/button';
import { StandingBadge } from '~/components/ui/tone';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';

type StudentsQuery = Parameters<typeof api.v1.students.$get>[0]['query'];
const fetchStudents = (query: StudentsQuery) => apiResponse(api.v1.students.$get({ query }));
const fetchSectionsThisYear = () => apiResponse(api.v1.academic.sections.$get({ query: {} }));

const PAGE_SIZE = 50;

const shortYear = (label: string) => {
  const start = academicYearStartFromLabel(label);
  return start === null ? label : academicYearShortLabel(start);
};

/** The standing filter reads like the badge it filters on. */
const STANDING_LABELS: Record<(typeof STUDENT_STATUSES)[number], string> = {
  in_school: 'At school',
  upcoming: 'Starts next year',
  graduated: 'Graduated',
  withdrawn: 'Withdrawn',
  transferred: 'Transferred',
  unknown: 'Grade not recorded',
};

const selectClass =
  'h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary';

export default function StudentsClient(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  const [search, setSearch] = useState(params.get('q') ?? '');
  const grade = params.get('grade') ?? '';
  const status = (STUDENT_STATUSES as readonly string[]).includes(params.get('status') ?? '')
    ? (params.get('status') as (typeof STUDENT_STATUSES)[number])
    : undefined;
  const sectionId = params.get('section') ?? '';
  const unplaced = params.get('unplaced') === '1';
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
  const q = params.get('q') ?? '';

  /** Change the filters in the address; any change but the page goes back to page one. */
  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    const qs = next.toString();
    router.replace(qs ? `/students?${qs}` : '/students', { scroll: false });
  };

  // Back and Forward change the address: the box follows it (but never overwrites what is being typed).
  const pushedQ = useRef(q);
  useEffect(() => {
    if (q !== pushedQ.current) {
      pushedQ.current = q;
      setSearch(q);
    }
  }, [q]);

  // Typing filters as you type, a quarter of a second after the last key.
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === q) return;
    const t = setTimeout(() => {
      pushedQ.current = trimmed;
      setParams({ q: trimmed || null });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query: StudentsQuery = {
    search: q || undefined,
    grade: grade || undefined,
    status,
    sectionId: sectionId || undefined,
    withoutSection: unplaced ? 'true' : undefined,
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  };
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['students', 'list', query],
    queryFn: () => fetchStudents(query),
    placeholderData: keepPreviousData,
  });
  const { data: sections = [] } = useQuery({
    queryKey: ['academic', 'sections', 'current'],
    queryFn: fetchSectionsThisYear,
  });

  const rows = data?.students ?? [];
  const total = data?.total ?? 0;
  const filtered = !!(q || grade || status || sectionId || unplaced);
  const open = (id: string) => router.push(`/students/${id}`);

  const rowLinks = () => Array.from(tableRef.current?.querySelectorAll<HTMLAnchorElement>('a[data-row-link]') ?? []);
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && rows[0] && search.trim() === q) {
      e.preventDefault();
      open(rows[0].id);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      rowLinks()[0]?.focus();
    }
  };
  const onRowKey = (e: React.KeyboardEvent<HTMLAnchorElement>, i: number) => {
    const links = rowLinks();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      links[i + 1]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (i === 0 ? searchRef.current : links[i - 1])?.focus();
    } else if (e.key === 'Escape') {
      searchRef.current?.focus();
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 animate-fade-up">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Students</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every student with the grade they are in today, where they stand, and their section this year.
          </p>
        </div>
        {data && (
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{total}</span> <span>{total === 1 ? 'student' : 'students'}</span>
            {data.academicYear && (
              <>
                {' · '}
                <span>Academic year</span> <span dir="ltr">{shortYear(data.academicYear)}</span>
              </>
            )}
          </p>
        )}
      </div>

      {/* Search and filters */}
      <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        <label htmlFor="student-search" className="mb-1 block text-sm font-medium text-foreground">
          Search
        </label>
        <input
          id="student-search"
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="Name, email or student ID"
          autoComplete="off"
          autoFocus
          // The page translator records the placeholder on the element (data-i18n-original-placeholder) before hydration.
          suppressHydrationWarning
          className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <p className="mt-1 text-xs text-muted-foreground">Enter opens the first student; the arrow keys move through the list.</p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="filter-grade" className="mb-1 block text-xs font-medium text-muted-foreground">
              Grade today
            </label>
            <select id="filter-grade" value={grade} onChange={(e) => setParams({ grade: e.target.value || null })} className={selectClass}>
              <option value="">Any grade</option>
              {[9, 10, 11, 12].map((g) => (
                <option key={g} value={g}>
                  {g === 9 ? 'Grade 9' : gradeLabel(g)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-standing" className="mb-1 block text-xs font-medium text-muted-foreground">
              Standing
            </label>
            <select
              id="filter-standing"
              value={status ?? ''}
              onChange={(e) => setParams({ status: e.target.value || null })}
              className={selectClass}
            >
              <option value="">Any standing</option>
              {STUDENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STANDING_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          {sections.length > 0 && (
            <div>
              <label htmlFor="filter-section" className="mb-1 block text-xs font-medium text-muted-foreground">
                Section this year
              </label>
              <select
                id="filter-section"
                value={sectionId}
                onChange={(e) => setParams({ section: e.target.value || null, unplaced: null })}
                className={selectClass}
              >
                <option value="">Any section</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={unplaced}
              onChange={(e) => setParams({ unplaced: e.target.checked ? '1' : null, section: null })}
              className="size-4"
            />
            <span>Without a section this year</span>
          </label>
          {filtered && (
            <Button
              variant="ghost"
              className="h-10"
              onClick={() => {
                setSearch('');
                router.replace('/students', { scroll: false });
              }}
            >
              Clear filters
            </Button>
          )}
          {isFetching && !isLoading && (
            <span className="ms-auto text-xs text-muted-foreground" role="status">
              Updating…
            </span>
          )}
        </div>
      </div>

      {isLoading ? (
        <LoadingState label="Loading students…" />
      ) : isError ? (
        <ErrorState
          title="Could not load the students"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No student matches"
            message="Check the spelling, or clear the filters to see every student."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('');
                  router.replace('/students', { scroll: false });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No students yet"
            message="Students appear here when the desk onboards a family or a family signs up."
          />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border bg-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-semibold text-muted-foreground">Name</th>
                  <th scope="col" className="px-4 py-3 text-start font-semibold text-muted-foreground">Student ID</th>
                  <th scope="col" className="px-4 py-3 text-start font-semibold text-muted-foreground">Grade</th>
                  <th scope="col" className="px-4 py-3 text-start font-semibold text-muted-foreground">Standing</th>
                  <th scope="col" className="px-4 py-3 text-start font-semibold text-muted-foreground">Section this year</th>
                </tr>
              </thead>
              <tbody ref={tableRef} className="divide-y divide-border">
                {rows.map((s, i) => (
                  <tr key={s.id} onClick={() => open(s.id)} className="cursor-pointer transition-colors hover:bg-muted/50">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/students/${s.id}`}
                        data-row-link
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => onRowKey(e, i)}
                        className="rounded font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {s.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        <span dir="ltr">{s.email}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-foreground">{s.studentId ?? '—'}</td>
                    <td className="px-4 py-2.5 text-foreground">{s.gradeLabel}</td>
                    <td className="px-4 py-2.5">
                      <StandingBadge standing={s.standing} />
                    </td>
                    <td className="px-4 py-2.5 text-foreground">
                      {s.sectionName ?? <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > PAGE_SIZE && (
            <nav className="mt-4 flex flex-wrap items-center justify-between gap-3" aria-label="Pages">
              <p className="text-sm text-muted-foreground">
                <span>Showing</span> <span className="font-medium text-foreground">{page * PAGE_SIZE + 1}</span>–
                <span className="font-medium text-foreground">{Math.min(total, (page + 1) * PAGE_SIZE)}</span> <span>of</span>{' '}
                <span className="font-medium text-foreground">{total}</span>
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="h-10"
                  disabled={page === 0}
                  onClick={() => setParams({ page: page - 1 > 0 ? String(page - 1) : null })}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  className="h-10"
                  disabled={(page + 1) * PAGE_SIZE >= total}
                  onClick={() => setParams({ page: String(page + 1) })}
                >
                  Next
                </Button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
