'use client';

/**
 * A teacher's timetable (FEATURES_PLAN.md F1): today's lessons for the Today
 * screen — made for a tablet carried between rooms: one column, large rows,
 * the lesson now highlighted — and the week for My teaching. A lesson opens to
 * its class that day (the students in the group then, with their section),
 * which a cover teacher reaches for the covered lesson on its date only. The
 * paper version is the printed timetable and a class list per group, neither
 * showing who is covering what today.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { CalendarFeedCard, WeekTimetable, schoolTodayDate } from '~/components/week-timetable';

/** The account's own timetable, or null when it is not linked to a teacher record (the API's 404). */
const fetchMyDay = async (date: string) => {
  const res = await api.v1.schedule.me.day.$get({ query: { date } });
  if (res.status === 404) return null;
  return apiResponse(Promise.resolve(res));
};
const fetchMyWeek = async (date: string) => {
  const res = await api.v1.schedule.me.week.$get({ query: { date } });
  if (res.status === 404) return null;
  return apiResponse(Promise.resolve(res));
};
const fetchClass = (lessonId: string, date: string) => apiResponse(api.v1.schedule.lesson.$get({ query: { lessonId, date } }));

const STATUS: Record<string, { label: string; tone: 'info' | 'warning' | 'danger' | 'neutral' }> = {
  covering: { label: 'You cover', tone: 'info' },
  covered_by_other: { label: 'Covered by a colleague', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  uncovered: { label: 'You are away', tone: 'warning' },
};

function useCairoClock() {
  const [hhmm, setHhmm] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setHhmm(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);
  return hhmm;
}

/** Today's lessons for a teacher (nothing at all for an account not linked to a teacher record). */
export function MyLessonsToday() {
  const date = schoolTodayDate();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['schedule', 'me', 'day', date], queryFn: () => fetchMyDay(date), refetchInterval: 5 * 60_000 });
  const now = useCairoClock();
  const [open, setOpen] = useState<string | null>(null);
  if (isLoading) return <LoadingState label="Loading your lessons…" />;
  if (isError) return <ErrorState title="Your lessons did not load" onRetry={() => refetch()} />;
  if (!data || !('teacherId' in data.target)) return null;
  const lessons = data.lessons;
  return (
    <section aria-labelledby="my-lessons" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="my-lessons" className="font-display text-lg font-bold text-foreground">My lessons today</h2>
        <span className="text-sm text-muted-foreground">{lessons.filter((l) => l.status !== 'covered_by_other' && l.status !== 'cancelled').length} <span>to teach</span></span>
      </div>
      {lessons.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{data.note === 'no_timetable' ? 'No timetable is published for today yet.' : data.note === 'extra_day' ? 'An extra school day: the timetable has no lessons on this weekday.' : data.isSchoolDay ? 'No lessons for you today.' : 'No lessons today.'}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {lessons.map((l) => {
            const isNow = !!now && l.startsAt <= now && now < l.endsAt;
            const past = !!now && l.endsAt <= now;
            const s = STATUS[l.status];
            const teaches = l.status !== 'covered_by_other' && l.status !== 'cancelled' && l.status !== 'uncovered';
            return (
              <li key={l.lessonId}>
                <button type="button" onClick={() => teaches && setOpen(open === l.lessonId ? null : l.lessonId)} aria-expanded={open === l.lessonId} disabled={!teaches}
                  className={cn('flex min-h-16 w-full items-center gap-4 rounded-xl border px-4 py-3 text-start', isNow ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border', past && 'opacity-60', teaches && 'hover:bg-accent')}>
                  <span className="w-28 shrink-0 tabular-nums">
                    <span className="block text-base font-semibold text-foreground"><bdi>{l.label}</bdi></span>
                    <span className="block text-sm text-muted-foreground" dir="ltr">{l.startsAt}–{l.endsAt}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold text-foreground"><bdi>{l.groupName}</bdi></span>
                    <span className="block truncate text-sm text-muted-foreground">{l.room ? <bdi>{l.room.name}</bdi> : 'No room'}{l.status === 'covering' && l.scheduledTeacher && <> · <span>for</span> <bdi>{l.scheduledTeacher.name}</bdi></>}</span>
                  </span>
                  {isNow && <Badge tone="success">Now</Badge>}
                  {s && <Badge tone={s.tone}>{s.label}</Badge>}
                </button>
                {open === l.lessonId && <ClassPanel lessonId={l.lessonId} date={date} />}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** The class of a lesson on a date. */
export function ClassPanel({ lessonId, date }: { lessonId: string; date: string }) {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['schedule', 'class', lessonId, date], queryFn: () => fetchClass(lessonId, date) });
  if (isLoading) return <LoadingState label="Loading the class…" />;
  if (isError || !data) return <ErrorState title="The class did not load" onRetry={() => refetch()} />;
  return (
    <div className="mt-2 rounded-xl border border-border bg-muted/30 p-4">
      <p className="text-sm text-muted-foreground">
        <bdi className="font-semibold text-foreground">{data.lesson.groupName}</bdi> · <bdi>{data.lesson.label}</bdi>{data.lesson.room && <> · <bdi>{data.lesson.room.name}</bdi></>} · <span className="tabular-nums">{data.students.length}</span> <span>students</span>
        {data.access === 'cover' && <Badge tone="info" className="ms-2">Cover</Badge>}
      </p>
      <ol className="mt-2 grid gap-1 sm:grid-cols-2">
        {data.students.map((s, i) => (
          <li key={s.id} className="flex items-center gap-3 rounded-lg bg-card px-3 py-2 text-base">
            <span className="w-6 text-end text-sm tabular-nums text-muted-foreground">{i + 1}</span>
            <bdi className="flex-1 text-foreground">{s.name}</bdi>
            {s.section && <span className="text-sm text-muted-foreground"><bdi>{s.section}</bdi></span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A teacher's week, each lesson opening its class. */
export function MyTeachingWeek() {
  const [date, setDate] = useState(schoolTodayDate());
  const [open, setOpen] = useState<{ lessonId: string; date: string } | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['schedule', 'me', 'week', date], queryFn: () => fetchMyWeek(date) });
  if (isLoading) return <LoadingState label="Loading your timetable…" />;
  if (isError) return <ErrorState title="Your timetable did not load" onRetry={() => refetch()} />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <WeekTimetable week={data} date={date} onDate={setDate} viewer="teacher" title="My timetable"
        onLesson={(l, d) => (l.status === 'covered_by_other' || l.status === 'cancelled' ? undefined : setOpen(open?.lessonId === l.lessonId && open.date === d ? null : { lessonId: l.lessonId, date: d }))} />
      {open && (
        <div>
          <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Close the class</Button></div>
          <ClassPanel lessonId={open.lessonId} date={open.date} />
        </div>
      )}
      <CalendarFeedCard />
    </div>
  );
}
