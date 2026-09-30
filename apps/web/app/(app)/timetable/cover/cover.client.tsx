'use client';

/**
 * Cover (FEATURES_PLAN.md F1).
 *
 * The paper version: a teacher phones in sick at 7am; the coordinator reads
 * the printed timetable to see which lessons that leaves, walks the staff
 * room asking who is free and who teaches the subject, writes names on the
 * whiteboard, and forgets to tell the class — at the end of term nobody knows
 * who covered how much.
 *
 * Here: choose the day, record the absence (a day, a range, or some periods),
 * and every lesson it leaves appears with its status. "Find cover" lists every
 * teacher: those free and linked to the subject first (fewest lessons that
 * day, then fewest covers this term), each other one with the reason they
 * cannot — busy, away, at their daily limit, not a teacher of the subject.
 * One click assigns; the cover teacher and the class are told. A lesson with
 * nobody free is cancelled in one click, and the class is told. The log and
 * the report (per teacher, CSV) keep the record.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, ABSENCE_REASONS } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { ReasonModal } from '~/components/ui/reason-modal';
import { toCsv, downloadCsv } from '~/lib/csv';
import { cn } from '~/lib/utils';
import { DateText, SELECT_CLASS, addDays, fetchSchoolDay } from '../../academic/calendar/academic-shared';
import { TT_KEY, TimetableTabs, fetchTeachers, schoolToday, StatusBadge, download } from '../timetable-shared';

const REASON_LABEL: Record<(typeof ABSENCE_REASONS)[number], string> = {
  sick: 'Sick',
  personal: 'Personal',
  training: 'Training',
  school_business: 'School business',
  other: 'Other',
};

const fetchAbsences = (from: string, to: string) => apiResponse(api.v1.cover.absences.$get({ query: { from, to } }));
const fetchAbsence = (id: string) => apiResponse(api.v1.cover.absences[':id'].$get({ param: { id } }));
const fetchSuggestions = (lessonId: string, date: string) => apiResponse(api.v1.cover.suggestions.$get({ query: { lessonId, date } }));
type AbsenceDetail = Awaited<ReturnType<typeof fetchAbsence>>;
type AffectedLesson = AbsenceDetail['lessons'][number];

export default function CoverClient(): React.JSX.Element {
  const [tab, setTab] = useState<'day' | 'log' | 'report'>('day');
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 animate-fade-up">
      <TimetableTabs />
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Cover</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Record who is away, see the lessons it leaves, and give each one a free teacher of the subject — or cancel it. The cover teacher and the class are told.</p>
      </header>
      <div role="tablist" aria-label="Cover" className="mb-6 flex w-fit rounded-lg border border-border bg-card p-1">
        {([['day', 'By day'], ['log', 'Log'], ['report', 'Report']] as const).map(([k, label]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn('rounded-md px-4 py-1.5 text-sm font-medium', tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'day' ? <ByDay /> : tab === 'log' ? <Log /> : <Report />}
    </div>
  );
}

// ─── By day ──────────────────────────────────────────────────────────────────

function ByDay() {
  const qc = useQueryClient();
  const [date, setDate] = useState(schoolToday());
  const day = useQuery({ queryKey: ['academic', 'day', date], queryFn: () => fetchSchoolDay(date) });
  const absences = useQuery({ queryKey: [...TT_KEY, 'absences', date], queryFn: () => fetchAbsences(date, addDays(date, 30)) });
  const today = absences.data?.absences.filter((a) => !a.cancelledAt && a.startsOn <= date && a.endsOn >= date) ?? [];
  const later = absences.data?.absences.filter((a) => !a.cancelledAt && a.startsOn > date) ?? [];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <Button variant="outline" size="icon" aria-label="The day before" onClick={() => setDate(addDays(date, -1))}>‹</Button>
          <div>
            <Label htmlFor="cover-date" className="mb-1 text-xs text-muted-foreground">Day</Label>
            <Input id="cover-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" />
          </div>
          <Button variant="outline" size="icon" aria-label="The day after" onClick={() => setDate(addDays(date, 1))}>›</Button>
          <Button variant="ghost" onClick={() => setDate(schoolToday())}>Today</Button>
          <p className="pb-2 text-sm text-muted-foreground"><DateText date={date} weekday long />{day.data && !day.data.isSchoolDay && <> · <span>no lessons</span></>}</p>
        </div>
        {absences.isLoading ? <LoadingState label="Loading who is away…" /> : absences.isError ? <ErrorState onRetry={() => absences.refetch()} /> : today.length === 0 ? (
          <EmptyState title="Nobody is recorded as away this day" message="Record an absence on the right: its lessons appear here to cover." />
        ) : (
          today.map((a) => <AbsenceLessons key={a.id} absenceId={a.id} date={date} onChanged={() => qc.invalidateQueries({ queryKey: TT_KEY })} />)
        )}
      </div>
      <aside className="space-y-4">
        <RecordAbsence date={date} periods={day.data?.periods.filter((p) => p.kind === 'lesson') ?? []} onDone={() => qc.invalidateQueries({ queryKey: TT_KEY })} />
        {later.length > 0 && (
          <section aria-labelledby="later-title" className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 id="later-title" className="font-display text-base font-bold text-foreground">Coming up</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {later.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => setDate(a.startsOn)} className="w-full rounded-lg border border-border px-3 py-2 text-start hover:bg-accent">
                    <span className="font-semibold text-foreground"><bdi>{a.teacherName}</bdi></span>
                    <span className="block text-xs text-muted-foreground"><DateText date={a.startsOn} weekday />{a.endsOn !== a.startsOn && <> – <DateText date={a.endsOn} weekday /></>}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <Badge tone="neutral">{`${a.lessons} lessons`}</Badge>
                      {a.uncovered > 0 && <Badge tone="warning">{`${a.uncovered} to cover`}</Badge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

function RecordAbsence({ date, periods, onDone }: { date: string; periods: { label: string }[]; onDone: () => void }) {
  const teachers = useQuery({ queryKey: ['teachers', 'active'], queryFn: fetchTeachers });
  const [teacherId, setTeacherId] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState<(typeof ABSENCE_REASONS)[number]>('sick');
  const [some, setSome] = useState<number[]>([]);
  const [note, setNote] = useState('');
  const record = useMutation({
    mutationFn: async () => apiResponse(api.v1.cover.absences.$post({
      json: { teacherId, startsOn: date, endsOn: to && to > date ? to : date, periods: some.length && (!to || to === date) ? some : null, reason, note: note.trim() || null },
    })),
    onSuccess: () => { setTeacherId(''); setSome([]); setNote(''); setTo(''); onDone(); },
  });
  return (
    <form className="rounded-xl border border-border bg-card p-4 shadow-sm" onSubmit={(e) => { e.preventDefault(); if (teacherId) record.mutate(); }}>
      <h2 className="font-display text-base font-bold text-foreground">Record an absence</h2>
      <div className="mt-3 space-y-3">
        <div>
          <Label htmlFor="abs-teacher" className="mb-1 text-xs text-muted-foreground">Teacher</Label>
          <select id="abs-teacher" className={SELECT_CLASS} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">Choose…</option>
            {(teachers.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <div><span className="mb-1 block text-xs text-muted-foreground">From</span><p className="h-10 py-2 text-sm"><DateText date={date} weekday /></p></div>
          <div>
            <Label htmlFor="abs-to" className="mb-1 text-xs text-muted-foreground">To (for several days)</Label>
            <Input id="abs-to" type="date" min={date} value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
        </div>
        {periods.length > 0 && (!to || to === date) && (
          <fieldset>
            <legend className="mb-1 text-xs text-muted-foreground">Only some periods (leave empty for the whole day)</legend>
            <div className="flex flex-wrap gap-1.5">
              {periods.map((p, i) => {
                const n = i + 1;
                const on = some.includes(n);
                return (
                  <button key={n} type="button" aria-pressed={on} onClick={() => setSome(on ? some.filter((x) => x !== n) : [...some, n].sort((a, b) => a - b))}
                    className={cn('rounded-full border px-2.5 py-0.5 text-xs', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent')}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        <div>
          <Label htmlFor="abs-reason" className="mb-1 text-xs text-muted-foreground">Reason</Label>
          <select id="abs-reason" className={SELECT_CLASS} value={reason} onChange={(e) => setReason(e.target.value as (typeof ABSENCE_REASONS)[number])}>
            {ABSENCE_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
          </select>
        </div>
        <div><Label htmlFor="abs-note" className="mb-1 text-xs text-muted-foreground">Note (optional)</Label><Input id="abs-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
        <Button type="submit" className="w-full" disabled={!teacherId || record.isPending}>{record.isPending ? 'Recording…' : 'Record the absence'}</Button>
        {record.isError && <Notice tone="danger">{record.error instanceof Error ? record.error.message : 'Not recorded'}</Notice>}
        {record.data && <Notice tone="success">{`Recorded: ${record.data.lessons.length} lessons to cover.`}</Notice>}
      </div>
    </form>
  );
}

function AbsenceLessons({ absenceId, date, onChanged }: { absenceId: string; date: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: [...TT_KEY, 'absence', absenceId], queryFn: () => fetchAbsence(absenceId) });
  const [withdraw, setWithdraw] = useState(false);
  const cancel = useMutation({
    mutationFn: async (reason: string) => apiResponse(api.v1.cover.absences[':id'].cancel.$post({ param: { id: absenceId }, json: { reason } })),
    onSuccess: () => { setWithdraw(false); onChanged(); },
  });
  if (isLoading) return <LoadingState label="Loading the lessons…" />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;
  const lessons = data.lessons.filter((l) => l.date === date);
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm" aria-labelledby={`abs-${absenceId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div>
          <h2 id={`abs-${absenceId}`} className="font-display text-base font-bold text-foreground"><bdi>{data.teacherName}</bdi> <span className="font-normal text-muted-foreground">is away</span></h2>
          <p className="text-xs text-muted-foreground">
            <span>{REASON_LABEL[data.reason as (typeof ABSENCE_REASONS)[number]] ?? data.reason}</span>
            {' · '}<DateText date={data.startsOn} weekday />{data.endsOn !== data.startsOn && <> – <DateText date={data.endsOn} weekday /></>}
            {data.periods && <> · <span>{`periods ${data.periods.join(', ')}`}</span></>}
            {data.note && <> · <bdi>{data.note}</bdi></>}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setWithdraw(true)}>Not away after all</Button>
      </div>
      {lessons.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">No lessons of theirs this day.</p>
      ) : (
        <ul className="divide-y divide-border">
          {lessons.map((l) => <CoverLine key={l.lesson.lessonId} item={l} onChanged={() => { qc.invalidateQueries({ queryKey: [...TT_KEY, 'absence', absenceId] }); onChanged(); }} />)}
        </ul>
      )}
      {withdraw && (
        <ReasonModal title={`${data.teacherName} is not away`} description="The absence is withdrawn and any cover arranged for it is removed (both stay in the log)." confirmLabel="Withdraw the absence"
          isPending={cancel.isPending} error={cancel.error instanceof Error ? cancel.error.message : undefined} onConfirm={(r) => cancel.mutate(r)} onClose={() => setWithdraw(false)} />
      )}
    </section>
  );
}

function CoverLine({ item, onChanged }: { item: AffectedLesson; onChanged: () => void }) {
  const l = item.lesson;
  const [finding, setFinding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suggestions = useQuery({ queryKey: [...TT_KEY, 'suggest', l.lessonId, item.date], queryFn: () => fetchSuggestions(l.lessonId, item.date), enabled: finding });
  const assign = useMutation({
    mutationFn: async (v: { coverTeacherId?: string; cancel?: boolean }) => apiResponse(api.v1.cover.assignments.$post({ json: { lessonId: l.lessonId, date: item.date, ...v } })),
    onSuccess: () => { setFinding(false); setError(null); onChanged(); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Not arranged'),
  });
  const remove = useMutation({
    mutationFn: async (reason: string) => apiResponse(api.v1.cover.assignments[':id'].remove.$post({ param: { id: l.cover!.assignmentId }, json: { reason } })),
    onSuccess: () => { setRemoving(false); onChanged(); },
  });
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-24 shrink-0 text-sm tabular-nums text-muted-foreground"><bdi>{l.label}</bdi> <span dir="ltr">{l.startsAt}</span></span>
        <span className="flex-1 font-semibold text-foreground"><bdi>{l.groupName}</bdi>{l.room && <span className="font-normal text-muted-foreground"> · <bdi>{l.room.name}</bdi></span>}</span>
        <StatusBadge status={l.status} />
        {l.status === 'covered' && l.cover?.teacher && <span className="text-sm"><span className="text-muted-foreground">Cover:</span> <bdi className="font-semibold">{l.cover.teacher.name}</bdi></span>}
        {l.status === 'uncovered' && !finding && <Button size="sm" onClick={() => setFinding(true)}>Find cover</Button>}
        {(l.status === 'covered' || l.status === 'cancelled') && <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>Change</Button>}
      </div>
      {finding && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
          {suggestions.isLoading ? <LoadingState label="Checking who is free…" /> : suggestions.isError || !suggestions.data ? <ErrorState onRetry={() => suggestions.refetch()} /> : (
            <>
              {suggestions.data.supervisionOnly && <p className="mb-2 text-xs text-muted-foreground">Not an exam subject: any free teacher may take it.</p>}
              <ul className="space-y-1">
                {suggestions.data.candidates.slice(0, 12).map((c) => (
                  <li key={c.teacherId} className="flex flex-wrap items-center gap-2 rounded-md bg-card px-3 py-1.5 text-sm">
                    <bdi className="font-medium text-foreground">{c.name}</bdi>
                    {c.qualified ? <Badge tone="success">Teaches it</Badge> : <Badge tone="neutral">Not their subject</Badge>}
                    {c.available ? <Badge tone="info">Free</Badge> : <span className="text-xs text-muted-foreground"><bdi>{c.reasons.filter((r) => !r.startsWith('does not teach')).join('; ')}</bdi></span>}
                    <span className="ms-auto text-xs text-muted-foreground">{`${c.lessonsThatDay} lessons that day · ${c.coversThisTerm} covers this term`}</span>
                    <Button size="sm" disabled={!c.available || !c.qualified || assign.isPending} onClick={() => assign.mutate({ coverTeacherId: c.teacherId })}>Assign</Button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={assign.isPending} onClick={() => { if (window.confirm(`Cancel ${l.groupName} (${l.label})? The class is told it does not take place.`)) assign.mutate({ cancel: true }); }}>Cancel the lesson</Button>
                <Button size="sm" variant="ghost" onClick={() => setFinding(false)}>Close</Button>
              </div>
            </>
          )}
          {error && <Notice tone="danger" className="mt-2">{error}</Notice>}
        </div>
      )}
      {removing && (
        <ReasonModal title="Change the cover" description="The cover (or cancellation) is removed and the lesson waits for cover again; the log keeps it." confirmLabel="Remove it"
          isPending={remove.isPending} error={remove.error instanceof Error ? remove.error.message : undefined} onConfirm={(r) => remove.mutate(r)} onClose={() => setRemoving(false)} />
      )}
    </li>
  );
}

// ─── The log and the report ──────────────────────────────────────────────────

function Range({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div><Label htmlFor="r-from" className="mb-1 text-xs text-muted-foreground">From</Label><Input id="r-from" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-44" /></div>
      <div><Label htmlFor="r-to" className="mb-1 text-xs text-muted-foreground">To</Label><Input id="r-to" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-44" /></div>
    </div>
  );
}

const STATUS_WORD: Record<string, string> = { assigned: 'Covered', cancelled: 'Cancelled', removed: 'Removed' };

function Log() {
  const [from, setFrom] = useState(addDays(schoolToday(), -30));
  const [to, setTo] = useState(schoolToday());
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: [...TT_KEY, 'log', from, to], queryFn: () => apiResponse(api.v1.cover.log.$get({ query: { from, to } })) });
  const exportCsv = () => downloadCsv(`cover-log-${from}-${to}.csv`, toCsv(
    ['Date', 'Period', 'Group', 'Teacher away', 'Cover', 'What happened', 'Arranged by', 'Note'],
    (data ?? []).map((r) => [r.date, r.period, r.groupName, r.originalTeacher ?? '', r.coverTeacher ?? '', STATUS_WORD[r.status] ?? r.status, r.assignedByName ?? '', r.note ?? '']),
  ));
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <Button variant="outline" onClick={exportCsv} disabled={!data?.length}>CSV</Button>
      </div>
      {isLoading ? <LoadingState /> : isError ? <ErrorState onRetry={() => refetch()} /> : !data?.length ? <EmptyState title="No cover in these dates" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-4 py-2 text-start font-medium">Date</th><th className="px-3 py-2 text-start font-medium">Period</th><th className="px-3 py-2 text-start font-medium">Group</th>
              <th className="px-3 py-2 text-start font-medium">Away</th><th className="px-3 py-2 text-start font-medium">Cover</th><th className="px-3 py-2 text-start font-medium">What happened</th><th className="px-4 py-2 text-start font-medium">Arranged by</th>
            </tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className={cn('border-b border-border last:border-0', r.status === 'removed' && 'text-muted-foreground line-through decoration-muted-foreground/50')}>
                  <td className="px-4 py-2"><DateText date={r.date} weekday /></td>
                  <td className="px-3 py-2 tabular-nums">{r.period}</td>
                  <td className="px-3 py-2"><bdi>{r.groupName}</bdi></td>
                  <td className="px-3 py-2"><bdi>{r.originalTeacher ?? '—'}</bdi></td>
                  <td className="px-3 py-2"><bdi>{r.coverTeacher ?? '—'}</bdi></td>
                  <td className="px-3 py-2">{STATUS_WORD[r.status] ?? r.status}</td>
                  <td className="px-4 py-2"><bdi>{r.assignedByName ?? '—'}</bdi></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Report() {
  const [from, setFrom] = useState(addDays(schoolToday(), -90));
  const [to, setTo] = useState(schoolToday());
  const [err, setErr] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: [...TT_KEY, 'report', from, to], queryFn: () => apiResponse(api.v1.cover.report.$get({ query: { from, to } })) });
  const rows = useMemo(() => data?.rows ?? [], [data]);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <Button variant="outline" onClick={async () => { setErr(null); try { await download(await api.v1.cover.report.csv.$get({ query: { from, to } }), 'cover-report.csv'); } catch (e) { setErr(e instanceof Error ? e.message : 'No file'); } }}>CSV</Button>
      </div>
      {err && <Notice tone="danger">{err}</Notice>}
      {isLoading ? <LoadingState /> : isError || !data ? <ErrorState onRetry={() => refetch()} /> : rows.length === 0 ? <EmptyState title="Nobody was away and nobody covered in these dates" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-4 py-2 text-start font-medium">Teacher</th><th className="px-3 py-2 text-end font-medium">Absences</th><th className="px-3 py-2 text-end font-medium">Days away</th>
              <th className="px-3 py-2 text-end font-medium">Lessons missed</th><th className="px-3 py-2 text-end font-medium">Covered</th><th className="px-3 py-2 text-end font-medium">Cancelled</th>
              <th className="px-3 py-2 text-end font-medium">Not covered</th><th className="px-4 py-2 text-end font-medium">Covers given</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.teacherId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-medium"><bdi>{r.name}</bdi></td>
                  <td className="px-3 py-2 text-end tabular-nums">{r.absences}</td><td className="px-3 py-2 text-end tabular-nums">{r.daysAway}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{r.lessonsMissed}</td><td className="px-3 py-2 text-end tabular-nums">{r.covered}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{r.cancelled}</td>
                  <td className={cn('px-3 py-2 text-end tabular-nums', r.uncovered > 0 && 'font-semibold text-destructive')}>{r.uncovered}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{r.coversGiven}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-border font-semibold">
              <td className="px-4 py-2">Total</td><td /><td />
              <td className="px-3 py-2 text-end tabular-nums">{data.totals.lessonsMissed}</td><td className="px-3 py-2 text-end tabular-nums">{data.totals.covered}</td>
              <td className="px-3 py-2 text-end tabular-nums">{data.totals.cancelled}</td><td className="px-3 py-2 text-end tabular-nums">{data.totals.uncovered}</td>
              <td className="px-4 py-2 text-end tabular-nums">{data.totals.coversGiven}</td>
            </tr></tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
