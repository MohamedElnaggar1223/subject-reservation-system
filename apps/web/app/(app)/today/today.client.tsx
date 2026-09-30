'use client';

/**
 * Today (FEATURES_PLAN.md F0a): the first screen of every member of staff.
 *
 * The paper version: the bell sheet taped by the gate, the printed calendar
 * on the staff-room wall, and a phone call to the office on any day that
 * might be different ("is today the short day?", "are we closed for the
 * holiday?"). Knowing which period is on means reading the sheet against a
 * watch.
 *
 * Here: one headline says what today is at the school — a school day, the
 * weekend, a named holiday, an early dismissal, an exam-only day, out of
 * term — straight from the API's answer for today in Cairo time, with the
 * term and the bells that ring. The bells are a timeline with the current
 * period highlighted from the browser's clock, the minutes left, and what
 * comes next. With no academic year set up it says who fixes that, and
 * links there for the coordinator and admin.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { academicYearShortLabel } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice, TONE_CLASSES } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { MyLessonsToday } from '~/components/teacher-day';
import { LeaveInMyLessons } from '~/components/leave-in-my-lessons';
import {
  DAY_KIND, DateText, fetchSchoolDay, periodBadge, schoolClock, toMinutes,
  type DayKind, type SchoolDay,
} from '../academic/calendar/academic-shared';

const LINE: Record<DayKind, string> = {
  school_day: 'Lessons run on the bells below.',
  extra_school_day: 'A make-up day: lessons run on the bells below.',
  early_dismissal: 'School ends early today: the bells below are the short day.',
  exam_only: 'No lessons today: students come in for their exams.',
  holiday: 'The school is closed today.',
  weekend: 'The school is closed today.',
  out_of_term: 'No lessons today: it falls between terms.',
  no_academic_year: 'An admin or the coordinator sets up the academic year.',
};

/** The school's clock, from the browser's, every 15 seconds (null until mounted, so the server render matches). */
function useSchoolClock() {
  const [now, setNow] = useState<{ hhmm: string; seconds: number } | null>(null);
  useEffect(() => {
    const tick = () => setNow(schoolClock(new Date()));
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export default function TodayClient({ manages, teaches = false }: { manages: boolean; teaches?: boolean }): React.JSX.Element {
  const { data: day, isLoading, isError, refetch } = useQuery({
    queryKey: ['academic', 'day', 'today'],
    queryFn: () => fetchSchoolDay(),
    // A screen left open at the gate rolls over to the next day by itself.
    refetchInterval: 5 * 60_000,
  });
  const now = useSchoolClock();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 animate-fade-up">
      <h1 className="sr-only">Today</h1>
      {isLoading ? (
        <LoadingState label="Loading today…" />
      ) : isError || !day ? (
        <ErrorState title="Today did not load" message="This is a connection problem: it does not mean the school is closed." onRetry={() => refetch()} />
      ) : (
        <div className="space-y-6">
          <Headline day={day} now={now} manages={manages} />
          {/* F1: a teacher's lessons today (nothing for an account that does not teach). */}
          {teaches && <MyLessonsToday />}
          {/* F2: the students leaving during those lessons. */}
          {teaches && <LeaveInMyLessons />}
          {day.isSchoolDay && <Bells day={day} now={now} manages={manages} />}
        </div>
      )}
    </div>
  );
}

function Headline({ day, now, manages }: { day: SchoolDay; now: { hhmm: string } | null; manages: boolean }) {
  const kind = DAY_KIND[day.kind];
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-labelledby="today-headline">
      <div className={cn('flex flex-wrap items-start justify-between gap-4 px-6 py-5', TONE_CLASSES[kind.tone])}>
        <div>
          <p className="text-sm font-medium opacity-90">
            <DateText date={day.date} weekday long />
          </p>
          <h2 id="today-headline" className="mt-1 font-display text-3xl font-bold tracking-tight">
            {kind.label}
            {day.entry && (
              <>
                {': '}
                <bdi>{day.entry.name}</bdi>
              </>
            )}
          </h2>
          <p className="mt-1 text-sm opacity-90">{LINE[day.kind]}</p>
        </div>
        {now && (
          <div className="text-end">
            <p className="text-xs font-medium opacity-80">School time</p>
            <p className="font-display text-3xl font-bold tabular-nums" dir="ltr">{now.hhmm}</p>
          </div>
        )}
      </div>
      {day.academicYear ? (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 px-6 py-4 text-sm">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Academic year:</dt>
            <dd className="font-semibold text-foreground">{academicYearShortLabel(day.academicYear.startYear)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Term:</dt>
            <dd className="font-semibold text-foreground">{day.term ? day.term.name : <span className="font-normal text-muted-foreground">Between terms</span>}</dd>
          </div>
          {day.bellSchedule && (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Bells:</dt>
              <dd className="font-semibold text-foreground">{day.bellSchedule.name}</dd>
            </div>
          )}
        </dl>
      ) : (
        <div className="px-6 py-4 text-sm text-muted-foreground">
          <p>Until an academic year with its terms exists, no screen can tell a school day from a holiday.</p>
          {manages && (
            <Button asChild className="mt-3">
              <Link href="/academic/years">Set up the academic year</Link>
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function Bells({ day, now, manages }: { day: SchoolDay; now: { hhmm: string; seconds: number } | null; manages: boolean }) {
  const periods = [...day.periods].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (periods.length === 0) {
    return (
      <Notice tone="warning" title="No bells are set for today">
        <span>{day.bellSchedule ? 'The schedule has no periods for this weekday yet.' : 'This year has no ordinary-day bell schedule yet.'}</span>
        {manages && (
          <>
            {' '}
            <Link href="/academic/bells" className="font-semibold underline underline-offset-2">
              Set up the bells
            </Link>
          </>
        )}
      </Notice>
    );
  }

  const nowSec = now?.seconds ?? null;
  const at = (t: string) => toMinutes(t) * 60;
  const currentIndex = nowSec === null ? -1 : periods.findIndex((p) => at(p.startsAt) <= nowSec && nowSec < at(p.endsAt));
  const nextIndex = nowSec === null ? -1 : periods.findIndex((p) => at(p.startsAt) > nowSec);
  const current = periods[currentIndex];
  const next = periods[nextIndex];
  const first = periods[0]!;
  const last = periods[periods.length - 1]!;
  const minutesUntil = (t: string) => (nowSec === null ? 0 : Math.max(0, Math.ceil((at(t) - nowSec) / 60)));

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm" aria-labelledby="bells-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="bells-title" className="font-display text-lg font-bold text-foreground">Today&apos;s bells</h2>
        <p className="text-sm text-muted-foreground">
          <span dir="ltr">{first.startsAt}–{last.endsAt}</span>
        </p>
      </div>

      {nowSec !== null && (
        <p className="mt-3 rounded-lg bg-muted px-4 py-3 text-sm text-foreground" aria-live="polite">
          {current ? (
            <>
              <span className="font-semibold">Now:</span> <bdi>{current.label}</bdi>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <bdi className="tabular-nums">{minutesUntil(current.endsAt)}</bdi> <span>min left</span>
              {next && (
                <>
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  <span className="font-semibold">Next:</span> <bdi>{next.label}</bdi>
                </>
              )}
            </>
          ) : nowSec < at(first.startsAt) ? (
            <>
              <span className="font-semibold">First bell at</span> <bdi dir="ltr">{first.startsAt}</bdi>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span>in</span> <bdi className="tabular-nums">{minutesUntil(first.startsAt)}</bdi> <span>min</span>
            </>
          ) : next ? (
            <>
              <span className="font-semibold">Next:</span> <bdi>{next.label}</bdi> <span>at</span> <bdi dir="ltr">{next.startsAt}</bdi>
            </>
          ) : (
            <span>The school day has ended.</span>
          )}
        </p>
      )}

      <ol className="mt-4 space-y-1.5">
        {periods.map((p, i) => {
          const isNow = i === currentIndex;
          const isNext = i === nextIndex && !isNow;
          const isPast = nowSec !== null && at(p.endsAt) <= nowSec;
          const progress = isNow && nowSec !== null ? ((nowSec - at(p.startsAt)) / (at(p.endsAt) - at(p.startsAt))) * 100 : 0;
          const kind = periodBadge(p);
          return (
            <li
              key={`${p.startsAt}-${p.label}`}
              aria-current={isNow ? 'time' : undefined}
              className={cn(
                'relative flex items-center gap-4 overflow-hidden rounded-lg border px-4 py-2.5',
                isNow ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border',
                isPast && 'opacity-60',
                p.kind === 'break' && !isNow && 'bg-muted/60',
              )}
            >
              <span className="w-28 shrink-0 text-start text-sm tabular-nums text-muted-foreground">
                <span dir="ltr">{p.startsAt}–{p.endsAt}</span>
              </span>
              <span className={cn('flex-1 font-medium text-foreground', isNow && 'font-bold')}>{p.label}</span>
              {kind && <Badge tone={kind.tone}>{kind.label}</Badge>}
              {isNow && <Badge tone="success">Now</Badge>}
              {isNext && <Badge tone="info">Next</Badge>}
              {isPast && <span className="text-xs text-muted-foreground">Done</span>}
              {isNow && (
                <span className="absolute inset-x-0 bottom-0 h-1 bg-primary/15" aria-hidden="true">
                  <span className="block h-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
