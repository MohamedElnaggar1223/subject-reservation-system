'use client';

/**
 * My timetable (FEATURES_PLAN.md F1, "Views"): a student's own week, or a
 * parent's children's, one tab each. The paper version is the printed
 * timetable stuck on the fridge, out of date the day a teacher is off sick or
 * a lesson moves. Here each week shows the real days — holidays, short days,
 * exam-only days — with cover and cancellations as they are arranged, prints
 * on one page, and can follow the phone's calendar through a private link.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { cn } from '~/lib/utils';
import { CalendarFeedCard, WeekTimetable, schoolTodayDate } from '~/components/week-timetable';

const fetchChildren = () => apiResponse(api.v1.links.children.$get());
const fetchWeek = (studentId: string, date: string) => apiResponse(api.v1.schedule.week.$get({ query: { studentId, date } }));

export default function MyTimetableClient({ role, userId }: { role: string; userId: string }): React.JSX.Element {
  const children = useQuery({ queryKey: ['links', 'children'], queryFn: fetchChildren, enabled: role === 'parent' });
  const kids = (children.data ?? []).map((c) => c.student);
  const [chosen, setChosen] = useState<string | null>(null);
  const studentId = role === 'student' ? userId : chosen ?? kids[0]?.id ?? null;
  const [date, setDate] = useState(schoolTodayDate());
  const week = useQuery({ queryKey: ['schedule', 'week', studentId, date], queryFn: () => fetchWeek(studentId!, date), enabled: !!studentId });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 animate-fade-up">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{role === 'parent' ? 'Timetables' : 'My timetable'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">The week as it will run: holidays, short days and cover included.</p>
      </header>
      {role === 'parent' && (
        children.isLoading ? <LoadingState label="Loading your children…" /> : children.isError ? <ErrorState onRetry={() => children.refetch()} /> : kids.length === 0 ? (
          <EmptyState title="No linked children yet" message="Link your child's account on the Linked children page to see their timetable here." />
        ) : kids.length > 1 ? (
          <div role="tablist" aria-label="Child" className="mb-4 flex w-fit rounded-lg border border-border bg-card p-1 print:hidden">
            {kids.map((k) => (
              <button key={k.id} role="tab" type="button" aria-selected={studentId === k.id} onClick={() => setChosen(k.id)}
                className={cn('rounded-md px-4 py-1.5 text-sm font-medium', studentId === k.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}>
                <bdi>{k.name}</bdi>
              </button>
            ))}
          </div>
        ) : null
      )}
      {studentId && (
        <div className="space-y-6">
          {week.isLoading ? <LoadingState label="Loading the week…" /> : week.isError || !week.data ? (
            <ErrorState title="The timetable did not load" message="This is a connection problem, not an empty week." onRetry={() => week.refetch()} />
          ) : (
            <WeekTimetable week={week.data} date={date} onDate={setDate} title={role === 'parent' ? <bdi>{week.data.target.name}</bdi> : undefined} />
          )}
          <CalendarFeedCard />
        </div>
      )}
    </div>
  );
}
