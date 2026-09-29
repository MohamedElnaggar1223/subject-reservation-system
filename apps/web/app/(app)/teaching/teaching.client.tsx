'use client';

/**
 * My teaching (FEATURES_PLAN.md F0a)
 *
 * The paper version: the homeroom teacher keeps a printed class list from
 * September, corrects it by hand when a student moves class or leaves, and
 * asks the office which subjects they are down to teach. Here the class
 * list is the section's live membership (a move or a leaving shows the
 * same day), the grade beside each name is today's, and the subjects come
 * from the same record the registration screens use. Coordinators and the
 * admin can open a student's page from a name; teachers read the list.
 */

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiResponse, academicYearShortLabel, academicYearStartOf, gradeLabel, ROLES } from '@repo/validations';
import { api } from '~/lib/hono';
import { Badge, Notice } from '~/components/ui/tone';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';

/** The account's teaching, or null when it is not linked to a teacher record (the API's 404). */
const fetchTeaching = async () => {
  const res = await api.v1.teaching.me.$get();
  if (res.status === 404) return null;
  return apiResponse(Promise.resolve(res));
};

const OPENS_STUDENTS: string[] = [ROLES.COORDINATOR, ROLES.ADMIN];

export default function TeachingClient({ viewerRole }: { viewerRole: string }): React.JSX.Element {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['teaching', 'me'],
    queryFn: fetchTeaching,
  });
  const opensStudents = OPENS_STUDENTS.includes(viewerRole);
  const year = academicYearShortLabel(academicYearStartOf());

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 animate-fade-up">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">My teaching</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The teacher record you teach as, your subjects, the classes you teach and the homeroom sections you lead this year.
        </p>
      </div>

      {isLoading ? (
        <LoadingState label="Loading your teaching…" />
      ) : isError ? (
        <ErrorState
          title="Could not load your teaching"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => refetch()}
        />
      ) : data === null || data === undefined ? (
        <Notice tone="warning" title="Your account is not linked to a teacher record">
          <p>The admin links it on the Team page: they pick your account and the teacher record you teach as, or create one.</p>
          {viewerRole === ROLES.ADMIN && (
            <p className="mt-2">
              <Link href="/admin/team" className="font-medium underline hover:no-underline">
                Open the Team page
              </Link>
            </p>
          )}
        </Notice>
      ) : (
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby="teaching-as">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="teaching-as" className="text-sm text-muted-foreground">
                You teach as
              </h2>
              <span className="font-display text-lg font-bold text-foreground">{data.teacher.name}</span>
              {!data.teacher.isActive && <Badge tone="warning">Inactive</Badge>}
            </div>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subjects</h3>
            {data.subjects.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                No subjects are assigned to you yet. The admin assigns teachers on the Subjects page.
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2">
                {data.subjects.map((s) => (
                  <li key={s.id} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm">
                    <span className="font-medium text-foreground">{s.name}</span>{' '}
                    <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="classes-heading">
            <h2 id="classes-heading" className="mb-3 font-display text-lg font-bold text-foreground">
              <span>My classes</span> <span className="text-sm font-normal text-muted-foreground" dir="ltr">{year}</span>
            </h2>
            {data.classes.length === 0 ? (
              <EmptyState
                title="No students are enrolled with you this year"
                message="The coordinator enrols students with their teachers on the Course enrolment page."
              />
            ) : (
              <div className="space-y-3">
                {data.classes.map((c) => (
                  <ClassList key={c.subjectId} subjectId={c.subjectId} name={c.name} code={c.code} count={c.students} opensStudents={opensStudents} />
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="homeroom-heading">
            <h2 id="homeroom-heading" className="mb-3 font-display text-lg font-bold text-foreground">
              <span>Homeroom sections</span> <span className="text-sm font-normal text-muted-foreground" dir="ltr">{year}</span>
            </h2>
            {data.homeroomSections.length === 0 ? (
              <EmptyState
                title="You do not lead a homeroom section this year"
                message="The coordinator names each section's homeroom teacher on the Sections page."
              />
            ) : (
              <div className="space-y-4">
                {data.homeroomSections.map((s) => (
                  <div key={s.id} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3">
                      <p className="font-display text-xl font-bold text-foreground">{s.name}</p>
                      <p className="text-sm text-muted-foreground">
                        <span>{gradeLabel(s.grade)}</span>
                        {s.room && (
                          <>
                            {' · '}
                            <span>Room</span> <span className="text-foreground">{s.room.name}</span>
                          </>
                        )}
                        {' · '}
                        <span className="text-foreground">{s.students.length}</span>{' '}
                        <span>{s.students.length === 1 ? 'student' : 'students'}</span>
                      </p>
                    </div>
                    {s.students.length === 0 ? (
                      <p className="px-5 py-4 text-sm text-muted-foreground">No students in this section yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] text-sm">
                          <thead className="bg-muted">
                            <tr>
                              <th scope="col" className="px-5 py-2.5 text-start font-semibold text-muted-foreground">Name</th>
                              <th scope="col" className="px-5 py-2.5 text-start font-semibold text-muted-foreground">Student ID</th>
                              <th scope="col" className="px-5 py-2.5 text-start font-semibold text-muted-foreground">Grade</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {s.students.map((st) => (
                              <tr key={st.id}>
                                <td className="px-5 py-2.5 font-medium text-foreground">
                                  {opensStudents ? (
                                    <Link href={`/students/${st.id}`} className="hover:underline">
                                      {st.name}
                                    </Link>
                                  ) : (
                                    st.name
                                  )}
                                  {st.leftOn && (
                                    <Badge tone="danger" className="ms-2">
                                      Left the school
                                    </Badge>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs text-foreground">{st.studentId ?? '—'}</td>
                                <td className="px-5 py-2.5 text-foreground">{gradeLabel(st.grade)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

const fetchClass = (subjectId: string) => apiResponse(api.v1.enrolments.class.$get({ query: { subjectId } }));

/** One class: the subject and its count; opened, the students taught it in school this year. */
function ClassList({ subjectId, name, code, count, opensStudents }: { subjectId: string; name: string; code: string; count: number; opensStudents: boolean }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['teaching', 'class', subjectId], queryFn: () => fetchClass(subjectId), enabled: open });
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-start outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span>
          <span className="font-display text-lg font-bold text-foreground">{name}</span>{' '}
          <span className="font-mono text-xs text-muted-foreground" dir="ltr">{code}</span>
        </span>
        <span className="text-sm text-muted-foreground">
          <span className="text-foreground">{count}</span> <span>{count === 1 ? 'student' : 'students'}</span>
        </span>
      </button>
      {open && (
        q.isLoading ? (
          <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground">Loading the class list…</p>
        ) : q.isError || !q.data ? (
          <p className="border-t border-border px-5 py-3 text-sm text-red-700 dark:text-red-400">{q.error instanceof Error ? q.error.message : 'The class list did not load'}</p>
        ) : (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-muted">
                <tr>
                  <th scope="col" className="px-5 py-2.5 text-start font-semibold text-muted-foreground">Name</th>
                  <th scope="col" className="px-5 py-2.5 text-start font-semibold text-muted-foreground">Section</th>
                  <th scope="col" className="px-5 py-2.5 text-start font-semibold text-muted-foreground">Grade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {q.data.students.map((st) => (
                  <tr key={st.enrolmentId}>
                    <td className="px-5 py-2.5 font-medium text-foreground">
                      {opensStudents ? <Link href={`/students/${st.studentId}`} className="hover:underline">{st.name}</Link> : st.name}
                    </td>
                    <td className="px-5 py-2.5 text-foreground">{st.section ?? '—'}</td>
                    <td className="px-5 py-2.5 text-foreground">{gradeLabel(st.grade)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
