'use client';

/**
 * Sections (FEATURES_PLAN.md F0a): the homeroom sections of an academic
 * year by grade, each section's members, and the roll-over into the next
 * year.
 *
 * The spreadsheet version: a workbook per year with a tab per class (10A,
 * 10B, 11A …), the homeroom teacher and room typed at the top of each tab,
 * and the class lists retyped every September; "who has no class yet?" is
 * a comparison of the master list with every tab, by eye. Here the whole
 * year is one screen — every section with its teacher, room and fill —
 * each grade says how many of its students still have no section, a
 * section opens to a search that already shows exactly those students,
 * and September's retyping is the roll-over: a preview, then one click.
 * The year, the open section and the roll-over live in the address, so
 * Back works and a link can be shared.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueries, useQuery } from '@tanstack/react-query';
import { academicYearStartOf, gradeLabel } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { SectionForm } from './section-form.client';
import { SectionDetail } from './section-detail.client';
import { RollOver } from './roll-over.client';
import { fetchSections, fetchStudents, fetchYears, keys, type SectionRow } from './sections.data';

const GRADES = [10, 11, 12] as const;

export default function SectionsClient(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const [adding, setAdding] = useState<(typeof GRADES)[number] | null>(null);

  const yearsQ = useQuery({ queryKey: keys.years, queryFn: fetchYears });
  const years = yearsQ.data ?? [];
  const current = academicYearStartOf();
  const yearParam = params.get('year');
  const sectionParam = params.get('section');
  const rollOver = params.get('view') === 'roll-over';
  const year = years.find((y) => y.id === yearParam) ?? years.find((y) => y.startYear === current) ?? years[0];
  const nextYear = year ? years.find((y) => y.startYear === year.startYear + 1) : undefined;
  const prevYear = year ? years.find((y) => y.startYear === year.startYear - 1) : undefined;
  const isCurrentYear = year?.startYear === current;

  /** Move within the screen through the address (Back returns). */
  const go = (patch: Record<string, string | null>, push = true) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    const href = qs ? (`/academic/sections?${qs}` as const) : ('/academic/sections' as const);
    if (push) router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  };

  const sectionsQ = useQuery({
    queryKey: keys.sections(year?.id ?? ''),
    queryFn: () => fetchSections(year!.id),
    enabled: !!year,
  });
  const sections = sectionsQ.data ?? [];

  // Students of each grade still at school with no section this year (the students list reads this year only).
  const unplaced = useQueries({
    queries: GRADES.map((g) => ({
      queryKey: keys.unplaced(g),
      queryFn: () => fetchStudents({ grade: String(g), status: 'in_school', withoutSection: 'true', limit: '1', offset: '0' }),
      enabled: isCurrentYear,
    })),
  });
  const unplacedTotal = unplaced.every((q) => q.data) ? unplaced.reduce((n, q) => n + (q.data?.total ?? 0), 0) : null;

  if (yearsQ.isLoading) {
    return (
      <Shell>
        <LoadingState label="Loading the academic years…" />
      </Shell>
    );
  }
  if (yearsQ.isError) {
    return (
      <Shell>
        <ErrorState
          title="Could not load the academic years"
          message={yearsQ.error instanceof Error ? yearsQ.error.message : undefined}
          onRetry={() => yearsQ.refetch()}
        />
      </Shell>
    );
  }
  if (!year) {
    return (
      <Shell>
        <EmptyState
          title="No academic years yet"
          message="Sections belong to an academic year. Create this year, with its first and last day, then add its sections here."
          action={
            <Button asChild>
              <Link href="/academic/years">Open Academic years</Link>
            </Button>
          }
        />
      </Shell>
    );
  }

  if (sectionParam) {
    return (
      <Shell>
        <SectionDetail sectionId={sectionParam} onBack={() => go({ section: null })} />
      </Shell>
    );
  }

  if (rollOver) {
    return (
      <Shell>
        <RollOver
          from={year}
          to={nextYear}
          onClose={() => go({ view: null })}
          onOpenYear={(id) => go({ view: null, year: id })}
        />
      </Shell>
    );
  }

  const byGrade = (g: number) => sections.filter((s) => s.grade === g);

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Sections</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The homeroom sections of a year, their teachers, rooms and students.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="section-year" className="mb-1 block text-xs font-medium text-muted-foreground">
              Academic year
            </label>
            <div className="flex items-center gap-2">
              <select
                id="section-year"
                value={year.id}
                onChange={(e) => go({ year: e.target.value }, false)}
                className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.shortLabel}
                  </option>
                ))}
              </select>
              {isCurrentYear && <Badge tone="info">This year</Badge>}
            </div>
          </div>
          {sections.length > 0 && (
            <Button variant="outline" className="h-10" onClick={() => go({ view: 'roll-over' })}>
              <span>Roll over into</span> <span dir="ltr">{nextYear?.shortLabel ?? '…'}</span>
            </Button>
          )}
        </div>
      </div>

      {isCurrentYear && unplacedTotal !== null && (
        <Notice tone={unplacedTotal > 0 ? 'warning' : 'success'} className="mb-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <p className="font-medium">
              <span>Students not yet in a section this year:</span> <span className="font-bold">{unplacedTotal}</span>
            </p>
            {unplacedTotal > 0 ? (
              <Link href="/students?unplaced=1&status=in_school" className="underline hover:no-underline">
                See who
              </Link>
            ) : (
              <span>Every student at school has a section.</span>
            )}
          </div>
        </Notice>
      )}

      {sectionsQ.isLoading ? (
        <LoadingState label="Loading the sections…" />
      ) : sectionsQ.isError ? (
        <ErrorState
          title="Could not load the sections"
          message={sectionsQ.error instanceof Error ? sectionsQ.error.message : undefined}
          onRetry={() => sectionsQ.refetch()}
        />
      ) : sections.length === 0 ? (
        <EmptyState
          title="No sections in this year yet"
          message="Add a section for each class. If the year before has sections, roll them over instead: they move up a grade with their students."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button className="h-10" onClick={() => setAdding(10)}>
                Add a section
              </Button>
              {prevYear && prevYear.sectionCount > 0 && (
                <Button variant="outline" className="h-10" onClick={() => go({ year: prevYear.id, view: 'roll-over' })}>
                  <span>Roll over from</span> <span dir="ltr">{prevYear.shortLabel}</span>
                </Button>
              )}
            </div>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {GRADES.map((g, i) => {
            const list = byGrade(g);
            const waiting = isCurrentYear ? unplaced[i]?.data?.total : undefined;
            return (
              <section key={g} aria-labelledby={`grade-${g}`} className="min-w-0">
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <h2 id={`grade-${g}`} className="font-display text-lg font-bold text-foreground">
                    {gradeLabel(g)}
                  </h2>
                  {waiting !== undefined && waiting > 0 && (
                    <Link
                      href={`/students?grade=${g}&status=in_school&unplaced=1`}
                      className="rounded-full hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Badge tone="warning">
                        <span>Not in a section:</span>&nbsp;<span className="font-semibold">{waiting}</span>
                      </Badge>
                    </Link>
                  )}
                </div>
                <ul className="space-y-3">
                  {list.map((s) => (
                    <li key={s.id}>
                      <SectionCard section={s} onOpen={() => go({ section: s.id })} />
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      onClick={() => setAdding(g)}
                      className="flex min-h-12 w-full items-center justify-center gap-1 rounded-xl border border-dashed border-border text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span aria-hidden>+</span>
                      <span>Add a section</span>
                    </button>
                  </li>
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {adding !== null && (
        <SectionForm
          academicYearId={year.id}
          grade={adding}
          takenNames={sections.map((s) => s.name)}
          onClose={() => setAdding(null)}
          onSaved={(id) => {
            setAdding(null);
            go({ section: id });
          }}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 animate-fade-up">{children}</div>;
}

function SectionCard({ section: s, onOpen }: { section: SectionRow; onOpen: () => void }) {
  const fill = s.capacity ? Math.min(100, Math.round((s.memberCount / s.capacity) * 100)) : null;
  const full = s.capacity !== null && s.memberCount >= s.capacity;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-border bg-card p-4 text-start shadow-sm transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-2xl font-bold text-foreground">{s.name}</span>
        <span className="text-sm text-foreground">
          <span className="font-semibold">{s.memberCount}</span>
          {s.capacity !== null && (
            <>
              <span className="text-muted-foreground">{' / '}</span>
              <span className="text-muted-foreground">{s.capacity}</span>
            </>
          )}{' '}
          <span className="text-xs text-muted-foreground">{s.memberCount === 1 ? 'student' : 'students'}</span>
        </span>
      </div>
      {fill !== null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-primary" style={{ width: `${fill}%` }} />
        </div>
      )}
      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Homeroom teacher</dt>
          <dd className="font-medium text-foreground">{s.homeroomTeacher?.name ?? <span className="text-muted-foreground">Not named yet</span>}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Room</dt>
          <dd className="font-medium text-foreground">{s.room?.name ?? <span className="text-muted-foreground">No room yet</span>}</dd>
        </div>
      </dl>
      {full && (
        <Badge tone="warning" className="mt-2">
          Full
        </Badge>
      )}
    </button>
  );
}
