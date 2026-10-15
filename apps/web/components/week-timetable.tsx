'use client';

/**
 * A week of someone's timetable as it will really run (FEATURES_PLAN.md F1,
 * "Views"): the student's, a parent's child's, a teacher's. Each column is a
 * date of the week — a holiday, a short day or an exam-only day shows as
 * such — and each lesson shows its time, room and teacher that day, with
 * cover and cancellations marked. On a phone the week is a list of days; on
 * a desktop or tablet, a grid. Printing gives the grid on one page.
 *
 * Also the calendar-feed card: a private link a phone's calendar subscribes
 * to (made once, copied, revoked at any time).
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { env } from '~/env';
import { apiResponse, WEEKDAY_NAMES } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';

const fetchWeekOf = (q: { studentId?: string; teacherId?: string; date?: string }) => apiResponse(api.v1.schedule.week.$get({ query: q }));
type Week = Awaited<ReturnType<typeof fetchWeekOf>>;
type Day = Week['days'][number];
type Lesson = Day['lessons'][number];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

const NOTE: Record<string, string> = {
  holiday: 'Holiday',
  weekend: 'Weekend',
  out_of_term: 'Between terms',
  no_academic_year: 'Outside the school year',
  exam_only: 'Exams only: no lessons',
  no_timetable: 'No timetable published yet',
  left: 'Has left the school',
  extra_day: 'Extra school day: the timetable has no lessons on this weekday',
};

const STATUS: Record<string, { label: string; tone: 'info' | 'warning' | 'danger' | 'neutral' }> = {
  covered: { label: 'Cover', tone: 'info' },
  uncovered: { label: 'Teacher away', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  covering: { label: 'You cover', tone: 'info' },
  covered_by_other: { label: 'Covered by a colleague', tone: 'neutral' },
};

export function schoolTodayDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export const shiftDate = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function WeekTimetable({
  week, date, onDate, onLesson, viewer = 'student', title,
}: {
  week: Week;
  date: string;
  onDate: (date: string) => void;
  /** A teacher opens a lesson (its class). */
  onLesson?: (lesson: Lesson, date: string) => void;
  viewer?: 'student' | 'teacher';
  title?: React.ReactNode;
}) {
  const today = schoolTodayDate();
  const days = week.days.filter((d) => week.grid.some((g) => g.weekday === d.weekday) || d.lessons.length > 0);
  const rows = Math.max(0, ...week.grid.map((g) => g.periods.length), ...days.map((d) => Math.max(0, ...d.lessons.map((l) => l.periods[l.periods.length - 1] ?? 0))));
  const firstGrid = week.grid[0];
  const hasAny = days.some((d) => d.lessons.length > 0);

  return (
    <section aria-label="Timetable" className="print-block rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          {title && <h2 className="font-display text-lg font-bold text-foreground">{title}</h2>}
          <p className="text-sm text-muted-foreground">
            <span>{`${dateLabel(week.from)} – ${dateLabel(week.to)} ${week.to.slice(0, 4)}`}</span>
          </p>
        </div>
        <div className="flex items-center gap-1 print:hidden">
          <Button variant="outline" size="sm" onClick={() => onDate(shiftDate(date, -7))} aria-label="The week before">‹</Button>
          <Button variant="outline" size="sm" onClick={() => onDate(today)}>This week</Button>
          <Button variant="outline" size="sm" onClick={() => onDate(shiftDate(date, 7))} aria-label="The week after">›</Button>
          <Button variant="ghost" size="sm" onClick={() => window.print()}>Print</Button>
        </div>
      </div>

      {!hasAny && (
        <p className="px-5 py-4 text-sm text-muted-foreground">
          {days.every((d) => !d.isSchoolDay) ? 'No school days this week.' : days.some((d) => d.note === 'no_timetable') ? 'No timetable is published for this week yet.' : 'No lessons this week.'}
        </p>
      )}

      {/* Phones: a list of days. */}
      <ol className="divide-y divide-border md:hidden print:hidden">
        {days.map((d) => (
          <li key={d.date} className={cn('px-5 py-3', d.date === today && 'bg-primary/5')}>
            <p className="text-sm font-semibold text-foreground">
              <span>{WEEKDAY_NAMES[d.weekday]}</span> <span className="font-normal text-muted-foreground">{dateLabel(d.date)}</span>
              {d.date === today && <Badge tone="success" className="ms-2">Today</Badge>}
            </p>
            {d.lessons.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">{d.entry ? <bdi>{d.entry.name}</bdi> : NOTE[d.note ?? ''] ?? 'No lessons'}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {d.lessons.map((l) => <LessonLine key={l.lessonId} l={l} viewer={viewer} onOpen={onLesson ? () => onLesson(l, d.date) : undefined} />)}
              </ul>
            )}
            {d.entry && d.lessons.length > 0 && <p className="mt-1 text-xs text-muted-foreground"><bdi>{d.entry.name}</bdi></p>}
          </li>
        ))}
      </ol>

      {/* Tablets, desktops and print: the grid. */}
      <div className="hidden overflow-x-auto md:block print:block">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className="w-24 px-3 py-2 text-start text-xs font-medium text-muted-foreground">Period</th>
              {days.map((d) => (
                <th key={d.date} scope="col" className={cn('border-s border-border px-2 py-2 text-start', d.date === today && 'bg-primary/5')}>
                  <span className="block text-sm font-semibold text-foreground">{WEEKDAY_NAMES[d.weekday]}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{dateLabel(d.date)}</span>
                  {(d.entry || (d.note && d.note !== 'weekend')) && <span className="mt-0.5 block text-[11px] font-medium text-amber-700 dark:text-amber-400">{d.entry ? d.entry.name : NOTE[d.note ?? '']}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, i) => i + 1).map((p) => {
              const label = firstGrid?.periods.find((x) => x.period === p);
              return (
                <tr key={p} className="border-t border-border">
                  <th scope="row" className="px-3 py-1.5 text-start align-top">
                    <span className="block font-semibold text-foreground">{label?.label ?? `P${p}`}</span>
                    {label && <span className="block text-[11px] tabular-nums text-muted-foreground" dir="ltr">{label.startsAt}–{label.endsAt}</span>}
                  </th>
                  {days.map((d) => {
                    const here = d.lessons.filter((l) => l.periods.includes(p));
                    return (
                      <td key={d.date} className={cn('h-16 border-s border-border p-1 align-top', !d.isSchoolDay && 'bg-muted/50', d.date === today && 'bg-primary/5')}>
                        {here.map((l) => (
                          <LessonCell key={l.lessonId} l={l} viewer={viewer} continued={l.period !== p} onOpen={onLesson ? () => onLesson(l, d.date) : undefined} />
                        ))}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LessonCell({ l, viewer, continued, onOpen }: { l: Lesson; viewer: 'student' | 'teacher'; continued: boolean; onOpen?: () => void }) {
  const s = STATUS[l.status];
  const body = (
    <>
      <span className={cn('block truncate font-semibold text-foreground', l.status === 'cancelled' && 'line-through')}><bdi>{l.groupName}</bdi></span>
      {!continued && (
        <>
          <span className="block truncate text-xs text-muted-foreground">
            {l.room ? <bdi>{l.room.name}</bdi> : l.delivery === 'online' && <span>Online</span>}
            {viewer === 'student' && l.teacher && <>{(l.room || l.delivery === 'online') && ' · '}<bdi>{l.teacher.name}</bdi></>}
          </span>
          {s && <Badge tone={s.tone} className="mt-0.5">{s.label}</Badge>}
        </>
      )}
      {continued && <span className="block text-[11px] text-muted-foreground">(continued)</span>}
    </>
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className="mb-1 block w-full rounded-md border border-border bg-background px-2 py-1 text-start hover:bg-accent">{body}</button>
  ) : (
    <div className="mb-1 rounded-md border border-border bg-background px-2 py-1">{body}</div>
  );
}

function LessonLine({ l, viewer, onOpen }: { l: Lesson; viewer: 'student' | 'teacher'; onOpen?: () => void }) {
  const s = STATUS[l.status];
  const inner = (
    <>
      <span className="w-24 shrink-0 text-sm tabular-nums text-muted-foreground" dir="ltr">{l.startsAt}–{l.endsAt}</span>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate font-medium text-foreground', l.status === 'cancelled' && 'line-through')}><bdi>{l.groupName}</bdi></span>
        <span className="block truncate text-xs text-muted-foreground">
          {l.room ? <bdi>{l.room.name}</bdi> : l.delivery === 'online' && <span>Online</span>}
          {viewer === 'student' && l.teacher && <>{(l.room || l.delivery === 'online') && ' · '}<bdi>{l.teacher.name}</bdi></>}
        </span>
      </span>
      {s && <Badge tone={s.tone}>{s.label}</Badge>}
    </>
  );
  return (
    <li>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-start hover:bg-accent">{inner}</button>
      ) : (
        <div className="flex items-center gap-3 px-1 py-1">{inner}</div>
      )}
    </li>
  );
}

// ─── The calendar feed ───────────────────────────────────────────────────────

const fetchFeedStatus = () => apiResponse(api.v1.schedule.feed.$get());

export function CalendarFeedCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['schedule', 'feed'], queryFn: fetchFeedStatus });
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const make = useMutation({
    mutationFn: async () => apiResponse(api.v1.schedule.feed.$post()),
    onSuccess: (r) => { setLink(`${env.apiUrl.replace(/\/$/, '')}${r.path}`); setCopied(false); qc.invalidateQueries({ queryKey: ['schedule', 'feed'] }); },
  });
  const revoke = useMutation({
    mutationFn: async () => apiResponse(api.v1.schedule.feed.$delete()),
    onSuccess: () => { setLink(null); qc.invalidateQueries({ queryKey: ['schedule', 'feed'] }); },
  });
  if (!status.data?.available) return null;
  return (
    <section aria-labelledby="feed-title" className="rounded-xl border border-border bg-card p-5 shadow-sm print:hidden">
      <h2 id="feed-title" className="font-display text-base font-bold text-foreground">In your phone's calendar</h2>
      <p className="mt-1 text-sm text-muted-foreground">A private link your calendar app subscribes to: lessons, cover and cancellations appear on their own. Anyone with the link sees this timetable, so keep it to yourself; you can end it here at any time.</p>
      {link ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs" dir="ltr">{link}</code>
            <Button size="sm" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}>{copied ? 'Copied' : 'Copy the link'}</Button>
          </div>
          <p className="text-xs text-muted-foreground">It is shown this once. In Google Calendar: Other calendars → From URL. On an iPhone: Settings → Calendar → Accounts → Add subscribed calendar.</p>
        </div>
      ) : status.data.active ? (
        <p className="mt-3 text-sm text-foreground">A link is active. For a new one (the old one stops working), make it again.</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant={link ? 'outline' : 'default'} onClick={() => make.mutate()} disabled={make.isPending}>{status.data.active ? 'Make a new link' : 'Make the link'}</Button>
        {status.data.active && <Button size="sm" variant="ghost" onClick={() => revoke.mutate()} disabled={revoke.isPending}>End the link</Button>}
      </div>
      {(make.isError || revoke.isError) && <Notice tone="danger" className="mt-2">That did not work — try again.</Notice>}
    </section>
  );
}
