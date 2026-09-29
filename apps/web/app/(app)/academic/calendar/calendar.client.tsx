'use client';

/**
 * The school calendar (FEATURES_PLAN.md F0a).
 *
 * The spreadsheet version: a sheet of twelve month blocks where holidays are
 * coloured by hand, a legend in a corner, a separate list of holidays, and
 * the short-day bell times on another sheet. To answer "is 6 October a
 * school day, and which bells ring?" staff remember what each colour means,
 * whether the day falls in term, and which sheet has the bells. Counting the
 * school days in a month means counting cells.
 *
 * Here: pick the year and the month; every day already shows what it is,
 * worked out from the school week, the terms and the entries (weekends,
 * out-of-term days and the days outside the year need no colouring by hand).
 * Clicking a day asks the API what that day is (term, kind, bells and every
 * period) and fills the "Add to the calendar" form with that date;
 * Shift-click another day selects the days between, so a week-long break is
 * two clicks, a name and Enter. An early dismissal picks its short-day
 * schedule from a list. The school days in the month and the year are
 * counted for you, and a clash with an existing entry is refused with the
 * API's sentence beside the form.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, schoolDateString } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice, TONE_CLASSES } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import {
  ACADEMIC_KEY, DAY_KIND, DateRange, DateText, ENTRY_KIND, MONTHS, MONTHS_SHORT, NoYearYet, SELECT_CLASS, periodBadge,
  WEEKDAYS, WEEKDAYS_SHORT, YearPicker, addDays, dateParts, daysFrom, daysInMonth, fetchSchoolDay, monthOf, toDate,
  useAcademicYears, useBellSchedules, useChosenYear, useSchoolWeek, weekdayOf, yearHref,
  type AcademicYearRow, type BellScheduleRow, type DayKind,
} from './academic-shared';

const fetchCalendar = (academicYearId: string) => apiResponse(api.v1.academic.calendar.$get({ query: { academicYearId } }));
type Entry = Awaited<ReturnType<typeof fetchCalendar>>[number];
type EntryKind = keyof typeof ENTRY_KIND;
const ENTRY_KINDS = Object.keys(ENTRY_KIND) as EntryKind[];

/** How each kind of day looks in the month grid: an ordinary school day stays plain, so the exceptions stand out. */
const CELL: Record<DayKind, string> = {
  school_day: 'bg-card border-border text-foreground',
  extra_school_day: cn(TONE_CLASSES.success, 'border-transparent'),
  early_dismissal: cn(TONE_CLASSES.warning, 'border-transparent'),
  exam_only: cn(TONE_CLASSES.info, 'border-transparent'),
  holiday: cn(TONE_CLASSES.danger, 'border-transparent'),
  weekend: 'bg-muted text-muted-foreground border-transparent',
  out_of_term: 'bg-background text-muted-foreground border-dashed border-border',
  no_academic_year: 'bg-background text-muted-foreground/60 border-dashed border-border/60',
};

const GRID_LABEL: Record<DayKind, string> = { ...Object.fromEntries(Object.entries(DAY_KIND).map(([k, v]) => [k, v.label])), no_academic_year: 'Outside the school year' } as Record<DayKind, string>;

const LEGEND: DayKind[] = ['school_day', 'weekend', 'holiday', 'early_dismissal', 'exam_only', 'extra_school_day', 'out_of_term', 'no_academic_year'];

const SCHOOL_KINDS: DayKind[] = ['school_day', 'extra_school_day', 'early_dismissal', 'exam_only'];

/**
 * What a date is, for colouring the grid: the same rules, in the same order,
 * as the API's getSchoolDay (apps/api/src/services/academic.services.ts). The
 * day panel asks the API itself, so a difference would show there.
 */
function kindOf(date: string, year: AcademicYearRow, entries: Entry[], schoolWeekdays: number[]): { kind: DayKind; entry?: Entry } {
  if (date < year.startsOn || date > year.endsOn) return { kind: 'no_academic_year' };
  const term = year.terms.find((t) => t.startsOn <= date && t.endsOn >= date);
  const entry = entries.find((e) => e.startsOn <= date && e.endsOn >= date);
  const usualDay = schoolWeekdays.includes(weekdayOf(date));
  let kind: DayKind;
  if (entry?.kind === 'holiday') kind = 'holiday';
  else if (entry?.kind === 'school_day') kind = usualDay ? 'school_day' : 'extra_school_day';
  else if (!term) kind = 'out_of_term';
  else if (!usualDay) kind = 'weekend';
  else if (entry?.kind === 'early_dismissal') kind = 'early_dismissal';
  else if (entry?.kind === 'exam_only') kind = 'exam_only';
  else kind = 'school_day';
  return { kind, entry };
}

export default function CalendarClient(): React.JSX.Element {
  const { data: years, isLoading, isError, refetch } = useAcademicYears();
  const { year, choose } = useChosenYear(years);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-up">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">School calendar</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            What every day of the year is. Click a day to see it; Shift-click a second day to select the days between, then add them to the calendar.
          </p>
        </div>
        {years && year && <YearPicker years={years} year={year} onChoose={choose} />}
      </header>

      {isLoading ? (
        <LoadingState label="Loading the calendar…" />
      ) : isError ? (
        <ErrorState title="The calendar did not load" message="This is a connection problem, not an empty calendar." onRetry={() => refetch()} />
      ) : !year ? (
        <NoYearYet what="The calendar belongs to an academic year. Create the year and its terms first." />
      ) : (
        <YearCalendar key={year.id} year={year} />
      )}
    </div>
  );
}

function YearCalendar({ year }: { year: AcademicYearRow }) {
  const entriesQ = useQuery({ queryKey: ['academic', 'calendar', year.id], queryFn: () => fetchCalendar(year.id) });
  const week = useSchoolWeek();
  const bells = useBellSchedules(year.id);
  const today = schoolDateString(new Date());
  const initial = today >= year.startsOn && today <= year.endsOn ? today : year.startsOn;
  const [month, setMonth] = useState(monthOf(initial));
  const [selected, setSelected] = useState(initial);
  const [range, setRange] = useState({ from: initial, to: initial });

  const months: string[] = [];
  for (let m = monthOf(year.startsOn); m <= monthOf(year.endsOn); ) {
    months.push(m);
    const { y, m: mm } = dateParts(`${m}-01`);
    m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
  }
  const monthIndex = months.indexOf(month);

  function pick(date: string, extend: boolean) {
    if (extend) {
      setRange(selected <= date ? { from: selected, to: date } : { from: date, to: selected });
    } else {
      setSelected(date);
      setRange({ from: date, to: date });
    }
  }

  function jumpTo(date: string) {
    setMonth(monthOf(date));
    setSelected(date);
  }

  const entries = entriesQ.data ?? [];
  const schoolWeekdays = week.weekdays;

  // School days in the year (what the ministry and the timetable count).
  let yearSchoolDays = 0;
  if (schoolWeekdays && entriesQ.data) {
    for (let d = year.startsOn; d <= year.endsOn; d = addDays(d, 1)) {
      if (SCHOOL_KINDS.includes(kindOf(d, year, entries, schoolWeekdays).kind)) yearSchoolDays++;
    }
  }

  return (
    <div className="space-y-6">
      <SchoolWeek weekdays={schoolWeekdays} canEdit={week.canEdit} isError={week.isError} />

      {year.terms.length === 0 && (
        <Notice tone="warning" title="This year has no terms yet">
          <span>Every day reads as out of term until a term covers it.</span>{' '}
          <Link href={yearHref('/academic/years', year.startYear)} className="font-semibold underline underline-offset-2">
            Add the terms
          </Link>
        </Notice>
      )}

      {/* On a tablet the day and the form follow the month directly; on a wide screen they sit beside it. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] lg:items-start">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm" aria-labelledby="month-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={monthIndex <= 0} onClick={() => setMonth(months[monthIndex - 1]!)}>
                  <span aria-hidden="true">‹</span>
                  <span>Previous</span>
                </Button>
                <h2 id="month-title" className="min-w-40 text-center font-display text-lg font-bold text-foreground">
                  {MONTHS[dateParts(`${month}-01`).m - 1]} {dateParts(`${month}-01`).y}
                </h2>
                <Button variant="outline" size="sm" disabled={monthIndex >= months.length - 1} onClick={() => setMonth(months[monthIndex + 1]!)}>
                  <span>Next</span>
                  <span aria-hidden="true">›</span>
                </Button>
              </div>
              {schoolWeekdays && entriesQ.data && (
                <p className="text-sm text-muted-foreground">
                  <span>School days this month:</span>{' '}
                  <span className="font-semibold text-foreground">{countSchoolDays(month, year, entries, schoolWeekdays)}</span>
                  <span className="mx-2" aria-hidden="true">·</span>
                  <span>In the year:</span> <span className="font-semibold text-foreground">{yearSchoolDays}</span>
                </p>
              )}
            </div>

            <nav className="mt-3 flex flex-wrap gap-1" aria-label="Months of the year">
              {months.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMonth(m)}
                  aria-current={m === month ? 'true' : undefined}
                  className={cn(
                    'h-9 min-w-12 rounded-md px-2 text-xs font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    m === month ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {MONTHS_SHORT[dateParts(`${m}-01`).m - 1]}
                </button>
              ))}
            </nav>

            {entriesQ.isLoading || week.isLoading ? (
              <LoadingState label="Loading the days…" />
            ) : entriesQ.isError ? (
              <ErrorState title="The calendar entries did not load" message="The days would look ordinary without them. Try again." onRetry={() => entriesQ.refetch()} />
            ) : !schoolWeekdays ? (
              <ErrorState title="The school week did not load" message="Without it the grid cannot tell a weekend from a school day." onRetry={() => week.refetch()} />
            ) : (
              <MonthGrid
                month={month}
                year={year}
                entries={entries}
                schoolWeekdays={schoolWeekdays}
                today={today}
                selected={selected}
                range={range}
                onPick={pick}
              />
            )}

            <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="What the colours mean">
              {LEGEND.map((k) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span className={cn('inline-block size-4 rounded border', CELL[k])} aria-hidden="true" />
                  <span>{GRID_LABEL[k]}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="space-y-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <DayPanel date={selected} />
          <AddEntryForm year={year} range={range} setRange={setRange} schedules={bells.data ?? []} bellsLoading={bells.isLoading} />
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <EntriesTable entries={entries} isLoading={entriesQ.isLoading} onJump={jumpTo} />
        </div>
      </div>
    </div>
  );
}

function countSchoolDays(month: string, year: AcademicYearRow, entries: Entry[], schoolWeekdays: number[]) {
  const { y, m } = dateParts(`${month}-01`);
  let n = 0;
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    if (SCHOOL_KINDS.includes(kindOf(toDate(y, m, d), year, entries, schoolWeekdays).kind)) n++;
  }
  return n;
}

function SchoolWeek({ weekdays, canEdit, isError }: { weekdays: number[] | null; canEdit: boolean; isError: boolean }) {
  return (
    <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-sm" aria-labelledby="school-week-title">
      <h2 id="school-week-title" className="font-semibold text-foreground">School week:</h2>
      {isError || !weekdays ? (
        <span className="text-muted-foreground">Not loaded</span>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((w, i) => (
            <li key={w}>
              <Badge tone={weekdays.includes(i) ? 'success' : 'neutral'} className={cn(!weekdays.includes(i) && 'line-through')}>
                {w}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <span className="ms-auto text-xs text-muted-foreground">
        {canEdit ? (
          <Link href={'/settings' as Route} className="font-semibold text-primary underline-offset-2 hover:underline">
            Change the school week in Settings
          </Link>
        ) : (
          'The school week is set in Settings by an admin or the coordinator.'
        )}
      </span>
    </section>
  );
}

function MonthGrid({
  month, year, entries, schoolWeekdays, today, selected, range, onPick,
}: {
  month: string;
  year: AcademicYearRow;
  entries: Entry[];
  schoolWeekdays: number[];
  today: string;
  selected: string;
  range: { from: string; to: string };
  onPick: (date: string, extend: boolean) => void;
}) {
  const { y, m } = dateParts(`${month}-01`);
  const lead = weekdayOf(`${month}-01`);
  const n = daysInMonth(y, m);

  return (
    <div className="mt-4">
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS_SHORT.map((w, i) => (
          <div key={w} className={cn('pb-1 text-center text-xs font-semibold', schoolWeekdays.includes(i) ? 'text-foreground' : 'text-muted-foreground')}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: lead }, (_, i) => <div key={`lead-${i}`} aria-hidden="true" />)}
        {Array.from({ length: n }, (_, i) => {
          const date = toDate(y, m, i + 1);
          const { kind, entry } = kindOf(date, year, entries, schoolWeekdays);
          const inRange = range.from !== range.to && date >= range.from && date <= range.to;
          const isSelected = date === selected;
          return (
            <button
              key={date}
              type="button"
              onClick={(e) => onPick(date, e.shiftKey)}
              aria-pressed={isSelected}
              className={cn(
                'flex min-h-20 flex-col items-stretch gap-1 rounded-lg border p-1.5 text-start text-xs outline-none transition-shadow hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/60',
                CELL[kind],
                inRange && 'ring-2 ring-primary/50',
                isSelected && 'ring-2 ring-primary',
              )}
            >
              <span className="flex items-center justify-between gap-1">
                <span className={cn('text-sm font-semibold tabular-nums', date === today && 'rounded bg-primary px-1.5 text-primary-foreground')}>{i + 1}</span>
                {date === today && <span className="text-[10px] font-semibold uppercase text-primary">Today</span>}
              </span>
              {entry ? <span className="line-clamp-2 font-medium leading-tight">{entry.name}</span> : null}
              <span className="sr-only">{GRID_LABEL[kind]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── The day panel: what the API says the day is ─────────────────────────────

function DayPanel({ date }: { date: string }) {
  const queryClient = useQueryClient();
  const { data: day, isLoading, isError, refetch } = useQuery({ queryKey: ['academic', 'day', date], queryFn: () => fetchSchoolDay(date) });
  const [error, setError] = useState('');
  const removeEntry = useMutation({
    mutationFn: (id: string) => apiResponse(api.v1.academic.calendar[':id'].$delete({ param: { id } })),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm" aria-labelledby="day-panel-title" aria-live="polite">
      <h2 id="day-panel-title" className="font-display text-base font-bold text-foreground">
        <DateText date={date} weekday long />
      </h2>
      {isLoading ? (
        <LoadingState label="Asking what this day is…" />
      ) : isError || !day ? (
        <ErrorState title="This day did not load" onRetry={() => refetch()} />
      ) : (
        <div className="mt-2 space-y-3 text-sm">
          <Badge tone={DAY_KIND[day.kind].tone} className="text-sm">
            {day.kind === 'no_academic_year' ? 'Outside the school year' : DAY_KIND[day.kind].label}
          </Badge>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Term:</dt>
            <dd className="font-medium text-foreground">{day.term ? day.term.name : <span className="text-muted-foreground">No term</span>}</dd>
            {day.entry && (
              <>
                <dt className="text-muted-foreground">In the calendar:</dt>
                <dd className="font-medium text-foreground">{day.entry.name}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Bells:</dt>
            <dd className="font-medium text-foreground">
              {day.bellSchedule ? day.bellSchedule.name : <span className="text-muted-foreground">{day.isSchoolDay ? 'No bell schedule yet' : 'None: no school'}</span>}
            </dd>
          </dl>
          {day.periods.length > 0 && (
            <ol className="divide-y divide-border rounded-lg border border-border">
              {day.periods.map((p) => {
                const badge = periodBadge(p);
                return (
                  <li key={`${p.startsAt}-${p.label}`} className="flex items-center gap-2 px-2.5 py-1.5">
                    <span className="w-24 shrink-0 text-start tabular-nums text-muted-foreground">
                      <span dir="ltr">{p.startsAt}–{p.endsAt}</span>
                    </span>
                    <span className="flex-1 font-medium text-foreground">{p.label}</span>
                    {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
                  </li>
                );
              })}
            </ol>
          )}
          {day.entry && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={removeEntry.isPending}
              onClick={() => {
                if (confirm('Remove this entry from the calendar? Every day it covers goes back to what the school week and terms make it.')) removeEntry.mutate(day.entry!.id);
              }}
            >
              Remove this entry
            </Button>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
        </div>
      )}
    </section>
  );
}

// ─── Add days to the calendar ────────────────────────────────────────────────

function AddEntryForm({
  year, range, setRange, schedules, bellsLoading,
}: {
  year: AcademicYearRow;
  range: { from: string; to: string };
  setRange: (r: { from: string; to: string }) => void;
  schedules: BellScheduleRow[];
  bellsLoading: boolean;
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<EntryKind>('holiday');
  const [name, setName] = useState('');
  const [bellScheduleId, setBellScheduleId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [added, setAdded] = useState(false);

  const variants = schedules.filter((s) => !s.isDefault);
  const needsBells = kind === 'early_dismissal';
  const offersBells = kind !== 'holiday';
  // An early dismissal defaults to the first short-day schedule.
  const chosenBells = bellScheduleId || (needsBells ? (variants[0]?.id ?? '') : '');
  const dayCount = range.from && range.to && range.to >= range.from ? daysFrom(range.from, range.to) + 1 : 0;

  const create = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.academic.calendar.$post({
          json: {
            academicYearId: year.id,
            kind,
            name: name.trim(),
            startsOn: range.from,
            endsOn: range.to,
            bellScheduleId: offersBells && chosenBells ? chosenBells : null,
            notes: notes.trim() || null,
          },
        }),
      ),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
      // Clear only what was sent: the next name may already be typed.
      setName((n) => (n.trim() === created.name ? '' : n));
      setNotes((n) => (n.trim() === (created.notes ?? '') ? '' : n));
      setBellScheduleId('');
      setError('');
      setAdded(true);
    },
    onError: (err: Error) => {
      setAdded(false);
      setError(err.message);
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setAdded(false);
    if (!name.trim()) return setError('Give the day a name, e.g. Mid-term break.');
    if (!range.from || !range.to) return setError('Pick the first and the last day.');
    if (range.to < range.from) return setError('The last day must be on or after the first day.');
    if (needsBells && !chosenBells) return setError('An early dismissal needs the bell schedule it runs on.');
    setError('');
    create.mutate();
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-card p-4 shadow-sm" aria-labelledby="add-entry-title">
      <h2 id="add-entry-title" className="font-display text-base font-bold text-foreground">Add to the calendar</h2>
      <div className="mt-3 space-y-3">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-foreground">What is it?</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {ENTRY_KINDS.map((k) => (
              <label
                key={k}
                className={cn(
                  'flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                  kind === k ? 'border-primary bg-primary/5 font-semibold text-foreground' : 'border-border text-card-foreground',
                )}
              >
                <input
                  type="radio"
                  name="entry-kind"
                  value={k}
                  checked={kind === k}
                  onChange={() => {
                    // A bell choice belongs to the kind it was made for: an exam-only day
                    // must not silently inherit the short day picked for an early dismissal.
                    setKind(k);
                    setBellScheduleId('');
                  }}
                  className="accent-primary"
                />
                <span>{ENTRY_KIND[k].label}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{ENTRY_KIND[kind].hint}</p>
        </fieldset>

        <div>
          <Label htmlFor="entry-name" className="mb-1.5">Name</Label>
          <Input id="entry-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Mid-term break" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="entry-from" className="mb-1.5">From</Label>
            <Input
              id="entry-from"
              type="date"
              min={year.startsOn}
              max={year.endsOn}
              value={range.from}
              onChange={(e) => setRange({ from: e.target.value, to: range.to < e.target.value ? e.target.value : range.to })}
            />
          </div>
          <div>
            <Label htmlFor="entry-to" className="mb-1.5">To</Label>
            <Input id="entry-to" type="date" min={range.from || year.startsOn} max={year.endsOn} value={range.to} onChange={(e) => setRange({ from: range.from, to: e.target.value })} />
          </div>
        </div>
        {dayCount > 0 && (
          <p className="-mt-1 text-xs text-muted-foreground">
            <DateRange from={range.from} to={range.to} weekday /> <span aria-hidden="true">·</span> <span>{dayCount}</span>{' '}
            <span>{dayCount === 1 ? 'day' : 'days'}</span>
          </p>
        )}

        {offersBells && (
          <div>
            <Label htmlFor="entry-bells" className="mb-1.5">
              {needsBells ? 'Bell schedule that day' : 'Bell schedule that day (optional)'}
            </Label>
            {needsBells && !bellsLoading && schedules.length === 0 ? (
              <Notice tone="warning">
                <span>An early dismissal runs on a short-day bell schedule, and this year has none yet.</span>{' '}
                <Link href={yearHref('/academic/bells', year.startYear)} className="font-semibold underline underline-offset-2">
                  Create it on the Bells screen
                </Link>
              </Notice>
            ) : (
              <select id="entry-bells" value={chosenBells} onChange={(e) => setBellScheduleId(e.target.value)} className={SELECT_CLASS}>
                {!needsBells && <option value="">The ordinary day&apos;s bells</option>}
                {needsBells && !chosenBells && <option value="">Pick a schedule</option>}
                {[...variants, ...schedules.filter((s) => s.isDefault)].map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div>
          <Label htmlFor="entry-notes" className="mb-1.5">Notes (optional)</Label>
          <Input id="entry-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </div>

        {error && <Notice tone="danger">{error}</Notice>}
        {added && !error && <Notice tone="success">Added to the calendar.</Notice>}

        <Button type="submit" className="w-full" disabled={create.isPending}>
          {create.isPending ? 'Adding…' : 'Add to the calendar'}
        </Button>
      </div>
    </form>
  );
}

// ─── Every entry of the year ─────────────────────────────────────────────────

function EntriesTable({ entries, isLoading, onJump }: { entries: Entry[]; isLoading: boolean; onJump: (date: string) => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const remove = useMutation({
    mutationFn: (id: string) => apiResponse(api.v1.academic.calendar[':id'].$delete({ param: { id } })),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (isLoading) return null;
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm" aria-labelledby="entries-title">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h2 id="entries-title" className="font-display text-base font-bold text-foreground">Holidays and special days</h2>
        <span className="text-xs text-muted-foreground">
          <span>{entries.length}</span> <span>{entries.length === 1 ? 'entry' : 'entries'}</span>
        </span>
      </div>
      {error && <Notice tone="danger" className="m-3">{error}</Notice>}
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Nothing added yet: every day follows the school week and the terms. Add the holidays first.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Dates</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold text-muted-foreground">Days</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Kind</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Name</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Bells</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((e) => {
                const k = ENTRY_KIND[e.kind as EntryKind];
                return (
                  <tr key={e.id} className="align-top">
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => onJump(e.startsOn)} className="inline-flex min-h-9 items-center rounded text-start font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                        <DateRange from={e.startsOn} to={e.endsOn} weekday />
                      </button>
                    </td>
                    <td className="px-3 py-2 text-end tabular-nums text-card-foreground">{daysFrom(e.startsOn, e.endsOn) + 1}</td>
                    <td className="px-3 py-2">{k ? <Badge tone={k.tone} className="whitespace-nowrap">{k.label}</Badge> : e.kind}</td>
                    <td className="px-3 py-2 text-foreground">
                      <span className="font-medium">{e.name}</span>
                      {e.notes && <span className="block text-xs text-muted-foreground">{e.notes}</span>}
                    </td>
                    <td className="px-3 py-2 text-card-foreground">{e.bellSchedule?.name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2 text-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (confirm('Remove this entry from the calendar? Every day it covers goes back to what the school week and terms make it.')) remove.mutate(e.id);
                        }}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
