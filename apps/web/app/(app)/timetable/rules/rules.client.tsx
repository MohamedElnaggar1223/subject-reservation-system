'use client';

/**
 * The timetable's rules (FEATURES_PLAN.md F1, "Constraints").
 *
 * The spreadsheet version: a note on the staff-room board — "Ms Hoda does
 * not teach Thursdays", "the hall is for assembly on Sunday first period",
 * "no more than six periods a day" — that whoever builds the timetable has to
 * remember, and a clash found on the first Thursday.
 *
 * Here: each teacher's week as a grid of periods; a click marks one period
 * unavailable, a click on the day marks the whole day; the most periods a day
 * and a week beside it, with how many they are timetabled for, so a teacher
 * who cannot fit shows before generating. Rooms the same. Groups whose
 * lessons must fall on different days (practicals, the same group twice) are
 * one line each. The generator and every move in the grid obey all of it.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, WEEKDAY_NAMES } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice, TONE_CLASSES } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { NoYearYet, SELECT_CLASS, YearPicker, useAcademicYears, useChosenYear, type AcademicYearRow } from '../../academic/calendar/academic-shared';
import { TT_KEY, TimetableTabs, fetchRules, ROOM_TYPE_LABEL, type Rules } from '../timetable-shared';

type Off = { weekday: number; period: number | null };

export default function RulesClient(): React.JSX.Element {
  const { data: years, isLoading, isError, refetch } = useAcademicYears();
  const { year, choose } = useChosenYear(years);
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 animate-fade-up">
      <TimetableTabs year={year?.startYear} />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Timetable rules</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            When a teacher or a room cannot be used, a teacher's most periods a day and a week, and lessons kept on different days. The generator and every move obey them.
          </p>
        </div>
        {years && year && <YearPicker years={years} year={year} onChoose={choose} />}
      </header>
      {isLoading ? <LoadingState label="Loading…" /> : isError ? <ErrorState onRetry={() => refetch()} /> : !year ? <NoYearYet what="Rules belong to an academic year." /> : <YearRules year={year} />}
    </div>
  );
}

function YearRules({ year }: { year: AcademicYearRow }) {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: [...TT_KEY, 'rules', year.id], queryFn: () => fetchRules(year.id) });
  const [open, setOpen] = useState<string | null>(null);
  if (isLoading) return <LoadingState label="Loading the rules…" />;
  if (isError || !data) return <ErrorState title="The rules did not load" onRetry={() => refetch()} />;
  if (!data.days.length) return <Notice tone="warning">This year has no lesson periods yet: set up its default bell schedule first, then mark who cannot come when.</Notice>;
  return (
    <div className="space-y-6">
      <section aria-labelledby="teachers-title" className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4">
          <h2 id="teachers-title" className="font-display text-lg font-bold text-foreground">Teachers</h2>
          <p className="text-sm text-muted-foreground">
            <span>The week has</span> <bdi className="tabular-nums">{data.periodsInWeek}</bdi> <span>lesson periods.</span>
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-5 py-2 text-start font-medium">Teacher</th>
              <th className="px-3 py-2 text-end font-medium">Timetabled</th>
              <th className="px-3 py-2 text-end font-medium">Available</th>
              <th className="px-3 py-2 text-end font-medium">Most a day</th>
              <th className="px-3 py-2 text-end font-medium">Most a week</th>
              <th className="px-5 py-2"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {data.teachers.map((t) => {
              const off = countOff(t.unavailable, data);
              const available = data.periodsInWeek - off;
              const over = t.load > available || (t.maxPerWeek !== null && t.load > t.maxPerWeek);
              return (
                <TeacherRow key={t.id} t={t} data={data} year={year} available={available} over={over} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="rooms-title" className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4">
          <h2 id="rooms-title" className="font-display text-lg font-bold text-foreground">Rooms</h2>
          <p className="text-sm text-muted-foreground">Mark the periods a room is used for something else (assembly, exams).</p>
        </div>
        <ul className="divide-y divide-border">
          {data.rooms.filter((r) => r.isActive).map((r) => (
            <RoomRow key={r.id} r={r} data={data} year={year} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
          ))}
        </ul>
      </section>

      <DayRules data={data} year={year} />
    </div>
  );
}

function countOff(off: Off[], data: Rules) {
  let n = 0;
  for (const d of data.days) {
    if (off.some((o) => o.weekday === d.weekday && o.period === null)) n += d.periods.length;
    else n += d.periods.filter((p) => off.some((o) => o.weekday === d.weekday && o.period === p.period)).length;
  }
  return n;
}

/** A week of periods to tick: a period, or a whole day by its name. */
function WeekTicks({ data, off, onChange, label }: { data: Rules; off: Off[]; onChange: (next: Off[]) => void; label: string }) {
  const maxP = Math.max(...data.days.map((d) => d.periods.length));
  const wholeDay = (w: number) => off.some((o) => o.weekday === w && o.period === null);
  const isOff = (w: number, p: number) => wholeDay(w) || off.some((o) => o.weekday === w && o.period === p);
  const toggleDay = (w: number) => onChange(wholeDay(w) ? off.filter((o) => o.weekday !== w) : [...off.filter((o) => o.weekday !== w), { weekday: w, period: null }]);
  const togglePeriod = (w: number, p: number) => {
    if (wholeDay(w)) {
      const day = data.days.find((d) => d.weekday === w)!;
      onChange([...off.filter((o) => o.weekday !== w), ...day.periods.filter((x) => x.period !== p).map((x) => ({ weekday: w, period: x.period }))]);
    } else if (off.some((o) => o.weekday === w && o.period === p)) onChange(off.filter((o) => !(o.weekday === w && o.period === p)));
    else onChange([...off, { weekday: w, period: p }]);
  };
  return (
    <table className="text-xs" aria-label={label}>
      <thead>
        <tr>
          <th />
          {data.days.map((d) => (
            <th key={d.weekday} className="px-1 pb-1">
              <button type="button" onClick={() => toggleDay(d.weekday)} aria-pressed={wholeDay(d.weekday)} className={cn('w-full rounded px-2 py-1 font-semibold', wholeDay(d.weekday) ? TONE_CLASSES.danger : 'hover:bg-accent')}>
                {WEEKDAY_NAMES[d.weekday]}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => (
          <tr key={p}>
            <th className="pe-2 text-end font-medium text-muted-foreground">{data.days[0]!.periods.find((x) => x.period === p)?.label ?? `P${p}`}</th>
            {data.days.map((d) => {
              const exists = d.periods.some((x) => x.period === p);
              const o = exists && isOff(d.weekday, p);
              return (
                <td key={d.weekday} className="p-0.5">
                  {exists ? (
                    <button type="button" aria-pressed={o} aria-label={`${WEEKDAY_NAMES[d.weekday]} ${p}: ${o ? 'unavailable' : 'available'}`} onClick={() => togglePeriod(d.weekday, p)}
                      className={cn('h-7 w-full min-w-12 rounded border text-[11px]', o ? cn(TONE_CLASSES.danger, 'border-red-200') : 'border-border hover:bg-accent')}>
                      {o ? 'Not here' : ''}
                    </button>
                  ) : <span className="block h-7 rounded bg-muted" />}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type TeacherRules = Rules['teachers'][number];

function TeacherRow({ t, data, year, available, over, open, onToggle }: { t: TeacherRules; data: Rules; year: AcademicYearRow; available: number; over: boolean; open: boolean; onToggle: () => void }) {
  const qc = useQueryClient();
  const [off, setOff] = useState<Off[]>(t.unavailable.map((o) => ({ weekday: o.weekday, period: o.period })));
  const [perDay, setPerDay] = useState(t.maxPerDay === null ? '' : String(t.maxPerDay));
  const [perWeek, setPerWeek] = useState(t.maxPerWeek === null ? '' : String(t.maxPerWeek));
  const save = useMutation({
    mutationFn: async () => apiResponse(api.v1.scheduling.rules.teachers[':teacherId'].$put({
      param: { teacherId: t.id },
      json: { academicYearId: year.id, maxPerDay: perDay.trim() ? Number(perDay) : null, maxPerWeek: perWeek.trim() ? Number(perWeek) : null, unavailable: off.map((o) => ({ ...o, note: null })) },
    })),
    onSuccess: () => qc.invalidateQueries({ queryKey: TT_KEY }),
  });
  return (
    <>
      <tr className="border-b border-border">
        <td className="px-5 py-2">
          <button type="button" onClick={onToggle} aria-expanded={open} className="text-start font-semibold text-foreground hover:underline"><bdi>{t.name}</bdi></button>
          {over && <Badge tone="warning" className="ms-2">More lessons than time</Badge>}
          {t.unavailable.length > 0 && <span className="ms-2 text-xs text-muted-foreground">{t.unavailable.some((u) => u.period === null) ? t.unavailable.filter((u) => u.period === null).map((u) => `Not on ${WEEKDAY_NAMES[u.weekday]}`).join(', ') : `${t.unavailable.length} periods off`}</span>}
        </td>
        <td className="px-3 py-2 text-end tabular-nums">{t.load}</td>
        <td className="px-3 py-2 text-end tabular-nums">{available}</td>
        <td className="px-3 py-2 text-end tabular-nums">{t.maxPerDay ?? '—'}</td>
        <td className="px-3 py-2 text-end tabular-nums">{t.maxPerWeek ?? '—'}</td>
        <td className="px-5 py-2 text-end"><Button size="sm" variant="ghost" onClick={onToggle}>{open ? 'Close' : 'Change'}</Button></td>
      </tr>
      {open && (
        <tr className="border-b border-border bg-muted/30">
          <td colSpan={6} className="px-5 py-4">
            <div className="flex flex-wrap items-start gap-8">
              <WeekTicks data={data} off={off} onChange={setOff} label={`${t.name}: periods they cannot teach`} />
              <div className="space-y-3">
                <div><Label htmlFor={`pd-${t.id}`} className="mb-1 text-xs text-muted-foreground">Most periods a day</Label><Input id={`pd-${t.id}`} type="number" min={1} max={20} value={perDay} onChange={(e) => setPerDay(e.target.value)} placeholder="No limit" className="w-32" /></div>
                <div><Label htmlFor={`pw-${t.id}`} className="mb-1 text-xs text-muted-foreground">Most periods a week</Label><Input id={`pw-${t.id}`} type="number" min={1} max={100} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} placeholder="No limit" className="w-32" /></div>
                {t.groups.length > 0 && (
                  <p className="max-w-xs text-xs text-muted-foreground"><span>Teaches:</span> <bdi>{t.groups.map((g) => `${g.name} (${g.weeklyPeriods})`).join(', ')}</bdi></p>
                )}
                <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
                {save.isSuccess && <p className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</p>}
                {save.isError && <Notice tone="danger">{save.error instanceof Error ? save.error.message : 'Not saved'}</Notice>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

type RoomRules = Rules['rooms'][number];

function RoomRow({ r, data, year, open, onToggle }: { r: RoomRules; data: Rules; year: AcademicYearRow; open: boolean; onToggle: () => void }) {
  const qc = useQueryClient();
  const [off, setOff] = useState<Off[]>(r.unavailable.map((o) => ({ weekday: o.weekday, period: o.period })));
  const save = useMutation({
    mutationFn: async () => apiResponse(api.v1.scheduling.rules.rooms[':roomId'].$put({ param: { roomId: r.id }, json: { academicYearId: year.id, unavailable: off.map((o) => ({ ...o, note: null })) } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: TT_KEY }),
  });
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onToggle} aria-expanded={open} className="text-start">
          <span className="font-semibold text-foreground hover:underline"><bdi>{r.name}</bdi></span>{' '}
          <span className="text-xs text-muted-foreground">{`${ROOM_TYPE_LABEL[r.type] ?? r.type}${r.capacity ? ` · ${r.capacity} seats` : ''}`}</span>
          {r.unavailable.length > 0 && <Badge tone="warning" className="ms-2">{`${countOff(r.unavailable, data)} periods off`}</Badge>}
        </button>
        <Button size="sm" variant="ghost" onClick={onToggle}>{open ? 'Close' : 'Change'}</Button>
      </div>
      {open && (
        <div className="mt-3 flex flex-wrap items-end gap-6">
          <WeekTicks data={data} off={off} onChange={setOff} label={`${r.name}: periods it cannot be used`} />
          <div className="space-y-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
            {save.isSuccess && <p className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</p>}
          </div>
        </div>
      )}
    </li>
  );
}

function DayRules({ data, year }: { data: Rules; year: AcademicYearRow }) {
  const qc = useQueryClient();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [note, setNote] = useState('');
  const add = useMutation({
    mutationFn: async () => apiResponse(api.v1.scheduling.rules['day-rules'].$post({ json: { academicYearId: year.id, groupAId: a, groupBId: b || a, note: note.trim() || null } })),
    onSuccess: () => { setA(''); setB(''); setNote(''); qc.invalidateQueries({ queryKey: TT_KEY }); },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => apiResponse(api.v1.scheduling.rules['day-rules'][':id'].$delete({ param: { id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: TT_KEY }),
  });
  return (
    <section aria-labelledby="dayrules-title" className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h2 id="dayrules-title" className="font-display text-lg font-bold text-foreground">Kept on different days</h2>
      <p className="mt-1 text-sm text-muted-foreground">Two groups whose lessons must never share a day (two practicals), or one group whose own lessons must each be on a different day.</p>
      {data.dayRules.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {data.dayRules.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                {r.groupAId === r.groupBId
                  ? <><bdi className="font-semibold">{r.groupA}</bdi>: <span>its lessons on different days</span></>
                  : <><bdi className="font-semibold">{r.groupA}</bdi> <span>and</span> <bdi className="font-semibold">{r.groupB}</bdi>: <span>never on the same day</span></>}
                {r.note && <span className="text-muted-foreground"> · <bdi>{r.note}</bdi></span>}
              </span>
              <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(r.id)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (a) add.mutate(); }}>
        <div>
          <Label htmlFor="dr-a" className="mb-1 text-xs text-muted-foreground">Group</Label>
          <select id="dr-a" className={cn(SELECT_CLASS, 'w-56')} value={a} onChange={(e) => setA(e.target.value)}>
            <option value="">Choose…</option>
            {data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="dr-b" className="mb-1 text-xs text-muted-foreground">and</Label>
          <select id="dr-b" className={cn(SELECT_CLASS, 'w-56')} value={b} onChange={(e) => setB(e.target.value)}>
            <option value="">Itself (its own lessons)</option>
            {data.groups.filter((g) => g.id !== a).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div><Label htmlFor="dr-note" className="mb-1 text-xs text-muted-foreground">Why (optional)</Label><Input id="dr-note" value={note} onChange={(e) => setNote(e.target.value)} className="w-56" maxLength={200} /></div>
        <Button type="submit" disabled={!a || add.isPending}>Add the rule</Button>
        {add.isError && <span className="text-sm text-destructive">{add.error instanceof Error ? add.error.message : 'Not added'}</span>}
      </form>
    </section>
  );
}
