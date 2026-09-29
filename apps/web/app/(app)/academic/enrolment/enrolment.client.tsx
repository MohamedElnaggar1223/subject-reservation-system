'use client';

/**
 * Course enrolment (FEATURES_PLAN.md F0b).
 *
 * The spreadsheet version: each September the coordinator copies last
 * year's class lists into new tabs, retypes who takes which subject with
 * which teacher, keeps a separate list of who studies a subject alone, and
 * finds out in February — when the June registrations come in — who is
 * registered for a subject nobody teaches them, or taught a subject they
 * never registered for.
 *
 * Here, four ways in, all on one year:
 * - Start of year: carry last year forward (a finished subject replaced by
 *   the one that follows it, in one rule for everyone), or take this year's
 *   registrations with the teacher each names; a preview first, one click
 *   to commit, and running it twice changes nothing. Or paste rows from a
 *   sheet: what does not resolve is listed, never guessed.
 * - By section: the class list as a grid, students by subjects, like the
 *   sheet — tick a cell to enrol, one teacher per column, "Enrol all".
 * - By student: one student's subjects, teachers and self-study, changed
 *   in place.
 * - Check: registrations against enrolments, each disagreement with the
 *   one-click fix beside it. Flagged, never blocked.
 */

import { useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { Route } from 'next';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { useAcademicYears, useChosenYear, YearPicker, NoYearYet } from '../calendar/academic-shared';
import { ByStudent } from './by-student.client';
import { BySection } from './by-section.client';
import { Bulk } from './bulk.client';
import { Check } from './check.client';

type Tab = 'bulk' | 'section' | 'student' | 'check';
const TABS: [Tab, string][] = [['bulk', 'Start of year'], ['section', 'By section'], ['student', 'By student'], ['check', 'Check against registrations']];

export default function EnrolmentClient(): React.JSX.Element {
  const years = useAcademicYears();
  const { year, choose } = useChosenYear(years.data);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (TABS.find(([t]) => t === params.get('tab'))?.[0] ?? 'section') as Tab;
  const [studentId, setStudentId] = useState<string | null>(params.get('student'));
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', t);
    router.replace(`${pathname}?${next.toString()}` as Route, { scroll: false });
  };
  const openStudent = (id: string) => {
    setStudentId(id);
    const next = new URLSearchParams(params.toString());
    next.set('tab', 'student');
    next.set('student', id);
    router.replace(`${pathname}?${next.toString()}` as Route, { scroll: false });
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-up">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Course enrolment</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            What each student is taught this year, by which teacher, in school or as self-study. Timetables build their groups from it and forecast grades come from its teachers; exam registrations are checked against it.
          </p>
        </div>
        {years.data && year && <YearPicker years={years.data} year={year} onChoose={choose} />}
      </header>

      {years.isLoading ? (
        <LoadingState label="Loading the academic years…" />
      ) : years.isError ? (
        <ErrorState title="The academic years did not load" onRetry={() => years.refetch()} />
      ) : !year ? (
        <NoYearYet what="Enrolment is kept per academic year: set this year up first, then come back to enrol students." />
      ) : (
        <>
          <div role="tablist" aria-label="Course enrolment" className="mb-5 flex flex-wrap gap-1 border-b border-border">
            {TABS.map(([t, label]) => (
              <button
                key={t}
                role="tab"
                type="button"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  '-mb-px h-10 border-b-2 px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'bulk' && <Bulk year={year} />}
          {tab === 'section' && <BySection year={year} onOpenStudent={openStudent} />}
          {tab === 'student' && <ByStudent year={year} studentId={studentId} onChoose={openStudent} />}
          {tab === 'check' && <Check year={year} onOpenStudent={openStudent} />}
        </>
      )}
    </div>
  );
}

/** A small "N enrolled" count. */
export function Count({ n, label }: { n: number; label: string }) {
  return <Badge tone={n > 0 ? 'info' : 'neutral'}><span className="tabular-nums">{n}</span>&nbsp;<span>{label}</span></Badge>;
}

