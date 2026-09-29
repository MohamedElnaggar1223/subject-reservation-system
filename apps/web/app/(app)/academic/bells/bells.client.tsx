'use client';

/**
 * Bell schedules (FEATURES_PLAN.md F0a).
 *
 * The spreadsheet version: a "Bell times" sheet, Period | Start | End, typed
 * cell by cell, with a second copy for the short day and a note saying
 * "Thursday ends early". Every start time is worked out by hand from the
 * end before it, an overlap or a gap goes unnoticed until the bell rings
 * wrong, and which rows apply on which day is in someone's head.
 *
 * Here: "Fill a day in one go" builds a whole day from the first bell, the
 * number of lessons, their length and where the breaks fall. Row by row,
 * Enter adds the next lesson starting when the one before ended, 45 minutes
 * long; times accept 815 or 8.15 and become 08:15. A new variant (the short
 * day) can start as a copy of the ordinary day. Overlaps and impossible
 * times are marked on the row as you type; "How each school day rings"
 * shows which rows every weekday uses (a weekday with its own rows uses
 * those instead of the every-day rows), and the whole grid saves at once,
 * with the API's sentence shown if it refuses.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, BELL_PERIOD_KINDS } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import {
  ACADEMIC_KEY, NoYearYet, PERIOD_KIND, SELECT_CLASS, WEEKDAYS, YearPicker, fromMinutes, isTime, normalizeTime, toMinutes,
  useAcademicYears, useBellSchedules, useChosenYear, useSchoolWeek,
  type AcademicYearRow, type BellScheduleRow,
} from '../calendar/academic-shared';

type PeriodKind = (typeof BELL_PERIOD_KINDS)[number];
type Row = { key: string; weekday: number | null; label: string; kind: PeriodKind; startsAt: string; endsAt: string };
type Problem = { text: string; other?: string; blocking: boolean };

const LESSON_MINUTES = 45;
const BREAK_MINUTES = 20;
let rowSeq = 0;
const newKey = () => `row-${++rowSeq}`;

const isPeriodKind = (k: string): k is PeriodKind => (BELL_PERIOD_KINDS as readonly string[]).includes(k);

function toRows(periods: BellScheduleRow['periods']): Row[] {
  return periods.map((p) => ({
    key: newKey(),
    weekday: p.weekday,
    label: p.label,
    kind: isPeriodKind(p.kind) ? p.kind : 'lesson',
    startsAt: p.startsAt,
    endsAt: p.endsAt,
  }));
}

const signature = (rows: Row[]) => JSON.stringify(rows.map(({ weekday, label, kind, startsAt, endsAt }) => [weekday, label.trim(), kind, startsAt, endsAt]));

const sortRows = (rows: Row[]) =>
  [...rows].sort((a, b) => (a.weekday ?? -1) - (b.weekday ?? -1) || a.startsAt.localeCompare(b.startsAt));

/** What is wrong with each row: the API refuses the blocking ones as input, and overlaps with its own sentence. */
function findProblems(rows: Row[]): Map<string, Problem[]> {
  const out = new Map<string, Problem[]>();
  const add = (key: string, p: Problem) => out.set(key, [...(out.get(key) ?? []), p]);
  for (const r of rows) {
    if (!r.label.trim()) add(r.key, { text: 'Name the period', blocking: true });
    if (!isTime(r.startsAt) || !isTime(r.endsAt)) add(r.key, { text: 'Use a time like 08:15', blocking: true });
    else if (r.endsAt <= r.startsAt) add(r.key, { text: 'It ends before it starts', blocking: true });
  }
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (!isTime(r.startsAt) || !isTime(r.endsAt)) continue;
    const k = String(r.weekday);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]!;
      const b = sorted[i]!;
      if (b.startsAt < a.endsAt) {
        add(a.key, { text: 'Overlaps', other: b.label || b.startsAt, blocking: false });
        add(b.key, { text: 'Overlaps', other: a.label || a.startsAt, blocking: false });
      }
    }
  }
  return out;
}

/** The next row of a day: it starts when the day's last period ends. */
function nextRow(rows: Row[], weekday: number | null, kind: PeriodKind, after?: Row): Row {
  const same = rows.filter((r) => r.weekday === weekday && isTime(r.endsAt));
  const start = after && isTime(after.endsAt) ? after.endsAt : same.length ? same.map((r) => r.endsAt).sort().at(-1)! : '08:00';
  const lessons = rows.filter((r) => r.weekday === weekday && r.kind === 'lesson').length;
  return {
    key: newKey(),
    weekday,
    label: kind === 'lesson' ? `Period ${lessons + 1}` : 'Break',
    kind,
    startsAt: start,
    endsAt: fromMinutes(toMinutes(start) + (kind === 'lesson' ? LESSON_MINUTES : BREAK_MINUTES)),
  };
}

function span(rows: Row[]): { first: string; last: string } | null {
  const ok = rows.filter((r) => isTime(r.startsAt) && isTime(r.endsAt));
  if (!ok.length) return null;
  return { first: ok.map((r) => r.startsAt).sort()[0]!, last: ok.map((r) => r.endsAt).sort().at(-1)! };
}

export default function BellsClient(): React.JSX.Element {
  const { data: years, isLoading, isError, refetch } = useAcademicYears();
  const { year, choose } = useChosenYear(years);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 animate-fade-up">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Bell schedules</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The ordinary day&apos;s bells, and variants such as a short day that a calendar day can run on.
          </p>
        </div>
        {years && year && <YearPicker years={years} year={year} onChoose={choose} />}
      </header>

      {isLoading ? (
        <LoadingState label="Loading the bell schedules…" />
      ) : isError ? (
        <ErrorState title="The bell schedules did not load" message="This is a connection problem, not an empty list." onRetry={() => refetch()} />
      ) : !year ? (
        <NoYearYet what="Bell schedules belong to an academic year. Create the year first." />
      ) : (
        <YearBells key={year.id} year={year} />
      )}
    </div>
  );
}

function YearBells({ year }: { year: AcademicYearRow }) {
  const { data: schedules, isLoading, isError, refetch } = useBellSchedules(year.id);
  const week = useSchoolWeek();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const selected = schedules?.find((s) => s.id === selectedId) ?? schedules?.find((s) => s.isDefault) ?? schedules?.[0];

  function select(id: string) {
    if (id === selected?.id) return;
    if (dirty && !confirm('Discard the unsaved changes to these bells?')) return;
    setDirty(false);
    setSelectedId(id);
  }

  if (isLoading) return <LoadingState label="Loading the bell schedules…" />;
  if (isError || !schedules) return <ErrorState title="The bell schedules did not load" onRetry={() => refetch()} />;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {schedules.map((s) => {
          const every = s.periods.filter((p) => p.weekday === null);
          const range = span(toRows(every.length ? every : s.periods));
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => select(s.id)}
              aria-pressed={s.id === selected?.id}
              className={cn(
                'self-start rounded-xl border bg-card p-4 text-start shadow-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                s.id === selected?.id ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/50',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{s.name}</span>
                {s.isDefault && <Badge tone="success">Ordinary day</Badge>}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                <span>{s.periods.length}</span> <span>{s.periods.length === 1 ? 'period' : 'periods'}</span>
                {range && (
                  <>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span dir="ltr">{range.first}–{range.last}</span>
                  </>
                )}
              </span>
            </button>
          );
        })}
        <NewScheduleForm year={year} schedules={schedules} onCreated={(id) => { setDirty(false); setSelectedId(id); }} />
      </div>

      {selected ? (
        <ScheduleEditor
          key={selected.id}
          schedule={selected}
          schoolWeekdays={week.weekdays ?? [0, 1, 2, 3, 4]}
          onDirtyChange={setDirty}
          onDeleted={() => { setDirty(false); setSelectedId(null); }}
        />
      ) : (
        <Notice tone="info" title="No bell schedule yet">
          Start with the ordinary day, then add a short day for early dismissals.
        </Notice>
      )}
    </div>
  );
}

// ─── A new schedule ──────────────────────────────────────────────────────────

function NewScheduleForm({ year, schedules, onCreated }: { year: AcademicYearRow; schedules: BellScheduleRow[]; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(schedules.length === 0);
  const [copyFrom, setCopyFrom] = useState(schedules.find((s) => s.isDefault)?.id ?? '');
  const [error, setError] = useState('');

  const count = schedules.length;
  const defaultId = schedules.find((s) => s.isDefault)?.id ?? '';
  useEffect(() => {
    setIsDefault(count === 0);
    setCopyFrom((c) => c || defaultId);
  }, [count, defaultId]);

  const create = useMutation({
    mutationFn: async () => {
      const created = await apiResponse(api.v1.academic['bell-schedules'].$post({ json: { academicYearId: year.id, name: name.trim(), isDefault } }));
      const source = schedules.find((s) => s.id === copyFrom);
      if (source && source.periods.length) {
        await apiResponse(
          api.v1.academic['bell-schedules'][':id'].periods.$put({
            param: { id: created.id },
            json: { periods: source.periods.map(({ weekday, label, kind, startsAt, endsAt }) => ({ weekday, label, kind: isPeriodKind(kind) ? kind : 'lesson', startsAt, endsAt })) },
          }),
        );
      }
      return created;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
      setName('');
      setError('');
      onCreated(created.id);
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
      setError(err.message);
    },
  });

  return (
    <form
      className="rounded-xl border border-dashed border-border p-4"
      aria-labelledby="new-schedule-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError('Name the schedule, e.g. Short day.');
        setError('');
        create.mutate();
      }}
    >
      <h2 id="new-schedule-title" className="text-sm font-semibold text-foreground">New schedule</h2>
      <Label htmlFor="new-schedule-name" className="sr-only">Schedule name</Label>
      <Input
        id="new-schedule-name"
        className="mt-2"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        placeholder={schedules.length === 0 ? 'e.g. Ordinary day' : 'e.g. Short day'}
      />
      {schedules.length > 0 && (
        <div className="mt-2">
          <Label htmlFor="new-schedule-copy" className="mb-1 text-xs text-muted-foreground">Start from</Label>
          <select id="new-schedule-copy" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className={SELECT_CLASS}>
            <option value="">An empty day</option>
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <label className="mt-2 flex min-h-8 items-center gap-2 text-xs text-card-foreground">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="size-4 accent-primary" />
        <span>The ordinary day (default)</span>
      </label>
      {error && <Notice tone="danger" className="mt-2">{error}</Notice>}
      <Button type="submit" size="sm" className="mt-2 w-full" disabled={create.isPending}>
        {create.isPending ? 'Creating…' : 'Create the schedule'}
      </Button>
    </form>
  );
}

// ─── One schedule ────────────────────────────────────────────────────────────

function ScheduleEditor({
  schedule, schoolWeekdays, onDirtyChange, onDeleted,
}: {
  schedule: BellScheduleRow;
  schoolWeekdays: number[];
  onDirtyChange: (dirty: boolean) => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(schedule.name);
  const [headError, setHeadError] = useState('');

  const update = useMutation({
    mutationFn: (json: { name?: string; isDefault?: boolean }) => apiResponse(api.v1.academic['bell-schedules'][':id'].$put({ param: { id: schedule.id }, json })),
    onSuccess: () => {
      setHeadError('');
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
    },
    onError: (err: Error) => setHeadError(err.message),
  });
  const remove = useMutation({
    mutationFn: () => apiResponse(api.v1.academic['bell-schedules'][':id'].$delete({ param: { id: schedule.id } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
      onDeleted();
    },
    onError: (err: Error) => setHeadError(err.message),
  });

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby="schedule-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== schedule.name) update.mutate({ name: name.trim() });
          }}
        >
          <div>
            <Label htmlFor="schedule-name" id="schedule-title" className="mb-1.5 text-xs text-muted-foreground">Schedule name</Label>
            <Input id="schedule-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="w-64 font-semibold" />
          </div>
          <Button type="submit" variant="outline" disabled={update.isPending || !name.trim() || name.trim() === schedule.name}>
            Rename
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          {schedule.isDefault ? (
            <Badge tone="success">Ordinary day</Badge>
          ) : (
            <Button variant="outline" disabled={update.isPending} onClick={() => update.mutate({ isDefault: true })}>
              Make it the ordinary day
            </Button>
          )}
          <Button
            variant="outline"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm("Delete this bell schedule? Calendar days that run on it go back to the ordinary day's bells.")) remove.mutate();
            }}
          >
            Delete the schedule
          </Button>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {schedule.isDefault
          ? 'The ordinary day: every school day rings these bells unless the calendar gives the day another schedule.'
          : 'A variant: a day in the calendar (an early dismissal, say) runs on it.'}
      </p>
      {headError && <Notice tone="danger" className="mt-3">{headError}</Notice>}

      <PeriodGrid schedule={schedule} schoolWeekdays={schoolWeekdays} onDirtyChange={onDirtyChange} />
    </section>
  );
}

// ─── The grid of periods ─────────────────────────────────────────────────────

function PeriodGrid({ schedule, schoolWeekdays, onDirtyChange }: { schedule: BellScheduleRow; schoolWeekdays: number[]; onDirtyChange: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  const [baseline, setBaseline] = useState(() => toRows(schedule.periods));
  const [rows, setRows] = useState<Row[]>(baseline);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [addDay, setAddDay] = useState<number | null>(() => rows.at(-1)?.weekday ?? null);
  const [copyDay, setCopyDay] = useState<number>(() => schoolWeekdays.at(-1) ?? 4);
  const [filling, setFilling] = useState(schedule.periods.length === 0);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const problems = useMemo(() => findProblems(rows), [rows]);
  const blocking = [...problems.values()].some((ps) => ps.some((p) => p.blocking));
  const dirty = signature(rows) !== signature(baseline);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.academic['bell-schedules'][':id'].periods.$put({
          param: { id: schedule.id },
          json: { periods: rows.map(({ weekday, label, kind, startsAt, endsAt }) => ({ weekday, label: label.trim(), kind, startsAt, endsAt })) },
        }),
      ),
    onSuccess: (periods) => {
      const next = toRows(periods);
      setBaseline(next);
      setRows(next);
      setError('');
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
    },
    onError: (err: Error) => {
      setSaved(false);
      setError(err.message);
    },
  });

  function trySave() {
    setSaved(false);
    if (blocking) return setError('Fix the rows marked in red first.');
    setError('');
    save.mutate();
  }

  function change(key: string, patch: Partial<Row>) {
    setSaved(false);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function insertAfterDay(rs: Row[], weekday: number | null, add: Row[]): Row[] {
    const lastIndex = rs.map((r) => r.weekday).lastIndexOf(weekday);
    if (lastIndex === -1) return [...rs, ...add];
    return [...rs.slice(0, lastIndex + 1), ...add, ...rs.slice(lastIndex + 1)];
  }

  function addRow(kind: PeriodKind, weekday: number | null = addDay, after?: Row) {
    setSaved(false);
    const row = nextRow(rows, weekday, kind, after);
    setFocusKey(row.key);
    setRows((rs) => {
      if (after) {
        const i = rs.findIndex((r) => r.key === after.key);
        return [...rs.slice(0, i + 1), row, ...rs.slice(i + 1)];
      }
      return insertAfterDay(rs, weekday, [row]);
    });
  }

  function copyEveryDayTo(weekday: number) {
    const every = rows.filter((r) => r.weekday === null);
    if (!every.length) return setError('There are no every-day rows to copy yet.');
    const own = rows.filter((r) => r.weekday === weekday);
    if (own.length && !confirm('Replace the rows this weekday already has?')) return;
    setError('');
    setSaved(false);
    const copies = every.map((r) => ({ ...r, key: newKey(), weekday }));
    setRows((rs) => sortRows([...rs.filter((r) => r.weekday !== weekday), ...copies]));
    setAddDay(weekday);
  }

  function replaceDay(weekday: number | null, generated: Row[]) {
    const own = rows.filter((r) => r.weekday === weekday);
    if (own.length && !confirm("Replace this day's rows with the ones you just described?")) return false;
    setSaved(false);
    setRows((rs) => sortRows([...rs.filter((r) => r.weekday !== weekday), ...generated]));
    setAddDay(weekday);
    return true;
  }

  const dayOptions = (
    <>
      <option value="every">Every school day</option>
      {WEEKDAYS.map((w, i) => (
        <option key={w} value={i}>
          {w}
        </option>
      ))}
    </>
  );

  return (
    <div
      ref={containerRef}
      className="mt-5 space-y-4"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          trySave();
        }
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="add-day" className="mb-1 text-xs text-muted-foreground">Add to</Label>
          <select
            id="add-day"
            value={addDay === null ? 'every' : addDay}
            onChange={(e) => setAddDay(e.target.value === 'every' ? null : Number(e.target.value))}
            className={cn(SELECT_CLASS, 'w-44')}
          >
            {dayOptions}
          </select>
        </div>
        <Button variant="outline" onClick={() => addRow('lesson')}>Add a lesson</Button>
        <Button variant="outline" onClick={() => addRow('break')}>Add a break</Button>
        <Button variant={filling ? 'secondary' : 'outline'} onClick={() => setFilling((f) => !f)} aria-expanded={filling}>
          Fill a day in one go
        </Button>
        <Button variant="ghost" onClick={() => setRows((rs) => sortRows(rs))} disabled={rows.length < 2}>
          Sort by day and time
        </Button>
      </div>

      {filling && (
        <QuickFill
          initialDay={addDay}
          dayOptions={dayOptions}
          onFill={(weekday, generated) => {
            if (replaceDay(weekday, generated)) setFilling(false);
          }}
          onClose={() => setFilling(false)}
        />
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No periods yet. Fill a day in one go, or add the first lesson and press Enter for each next one.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th scope="col" className="px-2 py-2 text-start font-semibold text-muted-foreground">Day</th>
                <th scope="col" className="px-2 py-2 text-start font-semibold text-muted-foreground">Period</th>
                <th scope="col" className="px-2 py-2 text-start font-semibold text-muted-foreground">Kind</th>
                <th scope="col" className="px-2 py-2 text-start font-semibold text-muted-foreground">Starts</th>
                <th scope="col" className="px-2 py-2 text-start font-semibold text-muted-foreground">Ends</th>
                <th scope="col" className="px-2 py-2 text-end font-semibold text-muted-foreground">Length</th>
                <th scope="col" className="px-2 py-2"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const ps = problems.get(r.key) ?? [];
                const newDay = i === 0 || rows[i - 1]!.weekday !== r.weekday;
                const minutes = isTime(r.startsAt) && isTime(r.endsAt) && r.endsAt > r.startsAt ? toMinutes(r.endsAt) - toMinutes(r.startsAt) : null;
                return (
                  <PeriodRowView
                    key={r.key}
                    row={r}
                    problems={ps}
                    newDay={newDay}
                    minutes={minutes}
                    autoFocus={r.key === focusKey}
                    dayOptions={dayOptions}
                    onChange={(patch) => change(r.key, patch)}
                    onRemove={() => { setSaved(false); setRows((rs) => rs.filter((x) => x.key !== r.key)); }}
                    onEnter={(patch) => addRow('lesson', r.weekday, { ...r, ...patch })}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Press Enter in a row to add the next lesson after it. Times take 815 or 8.15 as 08:15. Ctrl+S saves.
      </p>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button onClick={trySave} disabled={save.isPending || !dirty}>
          {save.isPending ? 'Saving…' : 'Save the bells'}
        </Button>
        {dirty && (
          <>
            <Badge tone="warning">Unsaved changes</Badge>
            <Button variant="ghost" onClick={() => { setRows(baseline); setError(''); }}>
              Discard changes
            </Button>
          </>
        )}
        {saved && !dirty && <Badge tone="success">Saved</Badge>}
      </div>
      {error && <Notice tone="danger">{error}</Notice>}

      <DaySummary rows={rows} schoolWeekdays={schoolWeekdays} onUseEveryDay={(w) => { setSaved(false); setRows((rs) => rs.filter((r) => r.weekday !== w)); }} />

      <div className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/50 p-3">
        <div>
          <Label htmlFor="copy-day" className="mb-1 text-xs text-muted-foreground">A weekday that rings differently</Label>
          <select id="copy-day" value={copyDay} onChange={(e) => setCopyDay(Number(e.target.value))} className={cn(SELECT_CLASS, 'w-44')}>
            {WEEKDAYS.map((w, i) => (
              <option key={w} value={i}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <Button variant="outline" onClick={() => copyEveryDayTo(copyDay)}>
          Copy the every-day rows to it
        </Button>
        <p className="basis-full text-xs text-muted-foreground">
          Then change that weekday&apos;s rows: a weekday with rows of its own rings those instead of the every-day rows.
        </p>
      </div>
    </div>
  );
}

function PeriodRowView({
  row, problems, newDay, minutes, autoFocus, dayOptions, onChange, onRemove, onEnter,
}: {
  row: Row;
  problems: Problem[];
  newDay: boolean;
  minutes: number | null;
  autoFocus: boolean;
  dayOptions: React.ReactNode;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
  onEnter: (patch?: Partial<Row>) => void;
}) {
  const bad = problems.length > 0;
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter();
    }
  };
  const timeInput = (field: 'startsAt' | 'endsAt', label: string) => (
    <Input
      aria-label={label}
      dir="ltr"
      inputMode="numeric"
      maxLength={5}
      value={row[field]}
      onChange={(e) => onChange({ [field]: e.target.value })}
      onBlur={(e) => onChange({ [field]: normalizeTime(e.target.value) })}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const patch = { [field]: normalizeTime(e.currentTarget.value) };
        onChange(patch);
        onEnter(patch);
      }}
      aria-invalid={!isTime(row[field]) || (field === 'endsAt' && isTime(row.startsAt) && row.endsAt <= row.startsAt) ? true : undefined}
      className="w-20 text-center tabular-nums"
      placeholder="08:00"
    />
  );
  return (
    <>
      {newDay && (
        <tr className="border-t-2 border-border bg-muted/50">
          <th scope="rowgroup" colSpan={7} className="px-3 py-1.5 text-start text-xs font-semibold text-muted-foreground">
            {row.weekday === null ? 'Every school day' : WEEKDAYS[row.weekday]}
          </th>
        </tr>
      )}
      <tr className={cn('border-t border-border', bad && 'bg-destructive/5')}>
        <td className="px-2 py-1.5">
          <select
            aria-label="Day"
            value={row.weekday === null ? 'every' : row.weekday}
            onChange={(e) => onChange({ weekday: e.target.value === 'every' ? null : Number(e.target.value) })}
            className={cn(SELECT_CLASS, 'w-40')}
          >
            {dayOptions}
          </select>
        </td>
        <td className="px-2 py-1.5">
          <Input aria-label="Period name" value={row.label} onChange={(e) => onChange({ label: e.target.value })} onKeyDown={onKeyDown} maxLength={30} autoFocus={autoFocus} className="min-w-32" />
        </td>
        <td className="px-2 py-1.5">
          <select aria-label="Kind" value={row.kind} onChange={(e) => onChange({ kind: e.target.value as PeriodKind })} className={cn(SELECT_CLASS, 'w-36')}>
            {BELL_PERIOD_KINDS.map((k) => (
              <option key={k} value={k}>
                {PERIOD_KIND[k]?.label ?? k}
              </option>
            ))}
          </select>
        </td>
        <td className="px-2 py-1.5">{timeInput('startsAt', 'Starts')}</td>
        <td className="px-2 py-1.5">{timeInput('endsAt', 'Ends')}</td>
        <td className="px-2 py-1.5 text-end tabular-nums text-muted-foreground">
          {minutes !== null ? (
            <>
              <span>{minutes}</span> <span>min</span>
            </>
          ) : (
            '—'
          )}
        </td>
        <td className="px-2 py-1.5 text-end">
          <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onRemove}>
            Remove
          </Button>
        </td>
      </tr>
      {bad && (
        <tr className="bg-destructive/5">
          <td colSpan={7} className="px-2 pb-1.5 text-xs text-destructive">
            {problems.map((p, i) => (
              <span key={i} className="me-3 inline-flex gap-1">
                <span>{p.text}</span>
                {p.other && <bdi className="font-semibold">{p.other}</bdi>}
              </span>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Fill a day in one go ────────────────────────────────────────────────────

function QuickFill({
  initialDay, dayOptions, onFill, onClose,
}: {
  initialDay: number | null;
  dayOptions: React.ReactNode;
  onFill: (weekday: number | null, rows: Row[]) => void;
  onClose: () => void;
}) {
  const [day, setDay] = useState<number | null>(initialDay);
  const [firstBell, setFirstBell] = useState('08:00');
  const [registration, setRegistration] = useState('10');
  const [lessons, setLessons] = useState('7');
  const [lessonMinutes, setLessonMinutes] = useState(String(LESSON_MINUTES));
  const [break1After, setBreak1After] = useState('3');
  const [break1Minutes, setBreak1Minutes] = useState(String(BREAK_MINUTES));
  const [break2After, setBreak2After] = useState('5');
  const [break2Minutes, setBreak2Minutes] = useState('30');
  const [error, setError] = useState('');

  const num = (s: string) => (s.trim() === '' ? 0 : Number(s));

  function build(): Row[] | string {
    const start = normalizeTime(firstBell);
    if (!isTime(start)) return 'Use a time like 08:00 for the first bell.';
    const n = num(lessons);
    const len = num(lessonMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 15) return 'Between 1 and 15 lessons.';
    if (!Number.isInteger(len) || len < 5 || len > 180) return 'A lesson lasts between 5 and 180 minutes.';
    const out: Row[] = [];
    let t = toMinutes(start);
    const push = (label: string, kind: PeriodKind, minutes: number) => {
      out.push({ key: newKey(), weekday: day, label, kind, startsAt: fromMinutes(t), endsAt: fromMinutes(t + minutes) });
      t += minutes;
    };
    if (num(registration) > 0) push('Roll call', 'registration', num(registration));
    for (let i = 1; i <= n; i++) {
      push(`Period ${i}`, 'lesson', len);
      if (i < n && i === num(break1After) && num(break1Minutes) > 0) push('Break', 'break', num(break1Minutes));
      if (i < n && i === num(break2After) && num(break2Minutes) > 0) push('Lunch', 'break', num(break2Minutes));
    }
    if (t > 23 * 60 + 59) return 'That day runs past midnight: fewer or shorter lessons.';
    return out;
  }

  const preview = build();
  const field = (id: string, label: string, value: string, set: (v: string) => void, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div>
      <Label htmlFor={id} className="mb-1 text-xs text-muted-foreground">{label}</Label>
      <Input id={id} value={value} onChange={(e) => set(e.target.value)} inputMode="numeric" className="w-24 tabular-nums" dir="ltr" {...extra} />
    </div>
  );

  return (
    <form
      className="rounded-lg border border-primary/30 bg-primary/5 p-4"
      aria-labelledby="quick-fill-title"
      onSubmit={(e) => {
        e.preventDefault();
        const built = build();
        if (typeof built === 'string') return setError(built);
        setError('');
        onFill(day, built);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 id="quick-fill-title" className="text-sm font-semibold text-foreground">Fill a day in one go</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="fill-day" className="mb-1 text-xs text-muted-foreground">Day</Label>
          <select id="fill-day" value={day === null ? 'every' : day} onChange={(e) => setDay(e.target.value === 'every' ? null : Number(e.target.value))} className={cn(SELECT_CLASS, 'w-44')}>
            {dayOptions}
          </select>
        </div>
        {field('fill-first', 'First bell', firstBell, setFirstBell, { onBlur: (e) => setFirstBell(normalizeTime(e.target.value)), maxLength: 5 })}
        {field('fill-registration', 'Roll call (min)', registration, setRegistration)}
        {field('fill-lessons', 'Lessons', lessons, setLessons)}
        {field('fill-length', 'Lesson (min)', lessonMinutes, setLessonMinutes)}
        {field('fill-break1-after', 'Break after lesson', break1After, setBreak1After)}
        {field('fill-break1-length', 'Break (min)', break1Minutes, setBreak1Minutes)}
        {field('fill-break2-after', 'Lunch after lesson', break2After, setBreak2After)}
        {field('fill-break2-length', 'Lunch (min)', break2Minutes, setBreak2Minutes)}
      </div>
      {typeof preview !== 'string' && preview.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          <span>{preview.length}</span> <span>rows,</span> <span dir="ltr">{preview[0]!.startsAt}–{preview.at(-1)!.endsAt}</span>
        </p>
      )}
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      <Button type="submit" className="mt-3">Fill the day</Button>
    </form>
  );
}

// ─── Which rows each school day rings ────────────────────────────────────────

function DaySummary({ rows, schoolWeekdays, onUseEveryDay }: { rows: Row[]; schoolWeekdays: number[]; onUseEveryDay: (weekday: number) => void }) {
  const every = rows.filter((r) => r.weekday === null);
  const extra = [...new Set(rows.map((r) => r.weekday).filter((w): w is number => w !== null && !schoolWeekdays.includes(w)))];
  const days = [...schoolWeekdays, ...extra].sort((a, b) => a - b);
  return (
    <section aria-labelledby="day-summary-title">
      <h3 id="day-summary-title" className="mb-2 text-sm font-semibold text-foreground">How each school day rings</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-border bg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Day</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Rows it uses</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold text-muted-foreground">Periods</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">First bell</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Last bell</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {days.map((w) => {
              const own = rows.filter((r) => r.weekday === w);
              const used = own.length ? own : every;
              const s = span(used);
              return (
                <tr key={w}>
                  <td className="px-3 py-2 font-medium text-foreground">
                    {WEEKDAYS[w]}
                    {!schoolWeekdays.includes(w) && <Badge tone="warning" className="ms-2">Not a school day</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    {own.length ? <Badge tone="info">Its own rows</Badge> : every.length ? <Badge tone="neutral">Every-day rows</Badge> : <Badge tone="warning">No bells</Badge>}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{used.length}</td>
                  <td className="px-3 py-2 tabular-nums"><span dir="ltr">{s?.first ?? '—'}</span></td>
                  <td className="px-3 py-2 tabular-nums"><span dir="ltr">{s?.last ?? '—'}</span></td>
                  <td className="px-3 py-2 text-end">
                    {own.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => onUseEveryDay(w)}>
                        Use the every-day rows
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
