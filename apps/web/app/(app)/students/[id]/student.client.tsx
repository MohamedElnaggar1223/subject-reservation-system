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
import { useQuery } from '@tanstack/react-query';
import { apiResponse, ROLES } from '@repo/validations';
import { api } from '~/lib/hono';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { StudentAcademicPanel, studentRecordKey } from '~/components/student-academic-panel';

// The panel's own fetcher, under the panel's key: one request serves both.
const fetchStudentRecord = (id: string) => apiResponse(api.v1.students[':id'].$get({ param: { id } }));

const MONEY_ROLES: string[] = [ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN, ROLES.ADMIN];

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
            {/* F4: the student's exams — statement of entry, timetable, results. */}
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/exams/my?student=${studentId}` as never}
                className="inline-flex h-10 items-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Exams: entries, timetable, results
              </Link>
              {(viewerRole === ROLES.COORDINATOR || viewerRole === ROLES.ADMIN) && (
                <Link
                  href={`/exams/candidates?student=${studentId}&q=${encodeURIComponent(r.student.name)}` as never}
                  className="inline-flex h-10 items-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Candidate details
                </Link>
              )}
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
        </>
      )}
    </div>
  );
}
