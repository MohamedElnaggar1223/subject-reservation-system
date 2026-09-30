'use client';

/**
 * A student's academic page (FEATURES_PLAN.md F0a)
 *
 * The spreadsheet version: find the student's row on the right class tab,
 * read the Grade cell (and hope it was updated this September), then look
 * for notes in the margin about a repeated year or a withdrawal, and ask
 * the coordinator whether the student may sit the series that is open.
 * Here one page answers all of it — the grade derived from the cohort, the
 * section and its history, each open series with the rule's own answer —
 * and the coordinator or admin acts from the same page. The coordinator
 * sees no money here; the desk and the admin have the Student 360 for it.
 */

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiResponse, ROLES } from '@repo/validations';
import { api } from '~/lib/hono';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { StudentAcademicPanel, studentRecordKey } from '~/components/student-academic-panel';
import { WeekTimetable, schoolTodayDate } from '~/components/week-timetable';
import { StudentLeaveCard } from '~/components/student-leave-card';

// The panel's own fetcher, under the panel's key: one request serves both.
const fetchStudentRecord = (id: string) => apiResponse(api.v1.students[':id'].$get({ param: { id } }));

const MONEY_ROLES: string[] = [ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN, ROLES.ADMIN];

// F1: the student's week, as the family sees it — the desk answers "what does she have now?".
const fetchStudentWeek = (studentId: string, date: string) => apiResponse(api.v1.schedule.week.$get({ query: { studentId, date } }));

export default function StudentClient({ studentId, viewerRole }: { studentId: string; viewerRole: string }): React.JSX.Element {
  const { data: r, isLoading, isError, error, refetch } = useQuery({
    queryKey: studentRecordKey(studentId),
    queryFn: () => fetchStudentRecord(studentId),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 animate-fade-up">
      <Link
        href="/students"
        className="mb-4 inline-flex min-h-10 items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span aria-hidden className="inline-block rtl:rotate-180">←</span>
        <span>All students</span>
      </Link>

      {isLoading ? (
        <LoadingState label="Loading the student…" />
      ) : isError || !r ? (
        <ErrorState
          title="Could not open this student"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{r.student.name}</h1>
              <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div className="flex gap-1.5">
                  <dt className="text-muted-foreground">Student ID</dt>
                  <dd className="font-mono text-foreground">{r.student.studentId ?? '—'}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="text-foreground" dir="ltr">{r.student.email}</dd>
                </div>
                {r.student.phone && (
                  <div className="flex gap-1.5">
                    <dt className="text-muted-foreground">Phone</dt>
                    <dd className="text-foreground" dir="ltr">{r.student.phone}</dd>
                  </div>
                )}
              </dl>
            </div>
            {MONEY_ROLES.includes(viewerRole) && (
              <Link
                href="/desk"
                className="inline-flex h-10 items-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Payments and receipts at the desk
              </Link>
            )}
          </header>

          <StudentAcademicPanel studentId={studentId} viewerRole={viewerRole} />
          <StudentWeek studentId={studentId} />
          {/* F2: campus leave — coming up, this term, and a request made here. */}
          <div className="mt-6"><StudentLeaveCard studentId={studentId} viewerRole={viewerRole} /></div>
        </>
      )}
    </div>
  );
}

/** The week this student has (cover, holidays and short days applied), a week at a time. */
function StudentWeek({ studentId }: { studentId: string }) {
  const [date, setDate] = useState(schoolTodayDate());
  const week = useQuery({ queryKey: ['schedule', 'week', studentId, date], queryFn: () => fetchStudentWeek(studentId, date) });
  return (
    <section aria-label="Timetable" className="mt-6">
      {week.isLoading ? (
        <LoadingState label="Loading the week…" />
      ) : week.isError || !week.data ? (
        <ErrorState title="The timetable did not load" message="This is a connection problem, not an empty week." onRetry={() => week.refetch()} />
      ) : (
        <WeekTimetable week={week.data} date={date} onDate={setDate} title="Timetable" />
      )}
    </section>
  );
}
