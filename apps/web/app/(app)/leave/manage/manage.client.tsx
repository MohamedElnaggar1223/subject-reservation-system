'use client';

/**
 * Campus leave for staff (FEATURES_PLAN.md F2): the approval queue, the day's
 * leave, the collectors waiting for approval, and a request made at the desk
 * or on the school's own decision.
 *
 * The spreadsheet version: requests arrive by phone, note and email; the
 * coordinator writes them in a sheet, opens the timetable to see which
 * lessons each one misses, scrolls back through the sheet for how often the
 * student has left this term, phones the family, then walks a list to the
 * gate — and nobody tells the teachers. Here the queue is ordered by leave
 * time; one request fills the right-hand side with everything the decision
 * needs (the lessons and teachers it touches, exams that day, the student's
 * leave this term, the collector's photo and ID, custody notes, the school's
 * rules it breaks); Approve or Refuse is one key (A, R; J and K move); the
 * family, the student, the teachers and the gate list follow by themselves.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { ReasonModal } from '~/components/ui/reason-modal';
import { cn } from '~/lib/utils';
import { DateText, addDays } from '../../academic/calendar/academic-shared';
import {
  LEAVE_KEY, fetchQueue, fetchLeaves, fileUrl, schoolNow, searchStudents, fetchStudentLeave, StatusBadge, TimesText, CollectorText, Photo,
  RequestLeaveForm, type QueueItem, type PendingCollector,
} from '../leave-shared';
import { LeaveNav } from '../leave-nav';

type Tab = 'queue' | 'day' | 'collectors' | 'new';

export default function ManageClient({ role }: { role: string }): React.JSX.Element {
  const academic = role === 'coordinator' || role === 'admin';
  const [tab, setTab] = useState<Tab>(academic ? 'queue' : 'day');
  const queue = useQuery({ queryKey: [...LEAVE_KEY, 'queue'], queryFn: fetchQueue, enabled: academic, refetchInterval: 30_000 });
  const tabs: [Tab, string, number | null][] = [
    ...(academic ? [['queue', 'To approve', queue.data?.requests.length ?? null] as [Tab, string, number | null]] : []),
    ['day', 'The day', null],
    ...(academic ? [['collectors', 'Collectors', queue.data?.collectors.length ?? null] as [Tab, string, number | null]] : []),
    ['new', 'New request', null],
  ];
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 animate-fade-up">
      <LeaveNav academic={academic} />
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Campus leave</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {academic
              ? 'Decide requests with everything the decision needs; approve the people families trust to collect; record a request for a family or send a student home.'
              : "Record a family's request at the desk, and see who leaves on any day."}
          </p>
        </div>
      </header>
      <div role="tablist" aria-label="Campus leave" className="mb-5 flex w-fit flex-wrap rounded-lg border border-border bg-card p-1">
        {tabs.map(([k, label, n]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn('flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium', tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}>
            {label}
            {n !== null && n > 0 && <span className={cn('rounded-full px-1.5 text-xs tabular-nums', tab === k ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground')}>{n}</span>}
          </button>
        ))}
      </div>
      {tab === 'queue' && academic ? (
        queue.isLoading ? <LoadingState label="Loading the requests…" /> : queue.isError || !queue.data ? <ErrorState onRetry={() => queue.refetch()} /> : (
          <Queue items={queue.data.requests} canDecide={queue.data.canDecide} />
        )
      ) : tab === 'collectors' && academic ? (
        queue.data ? <PendingCollectors items={queue.data.collectors} canDecide={queue.data.canDecide} /> : <LoadingState />
      ) : tab === 'new' ? (
        <NewRequest academic={academic} />
      ) : (
        <Day />
      )}
    </div>
  );
}

// ─── The queue ───────────────────────────────────────────────────────────────

function groupOf(item: QueueItem, today: string): string {
  if (item.past) return 'Too late to decide';
  if (item.date === today) return 'Today';
  if (item.date === addDays(today, 1)) return 'Tomorrow';
  return 'Later';
}

function Queue({ items, canDecide }: { items: QueueItem[]; canDecide: boolean }) {
  const qc = useQueryClient();
  const today = schoolNow().date;
  const [selected, setSelected] = useState<string | null>(items[0]?.id ?? null);
  const [refusing, setRefusing] = useState<QueueItem | null>(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const current = items.find((i) => i.id === selected) ?? items[0] ?? null;
  const index = current ? items.indexOf(current) : -1;
  const next = () => items[index + 1]?.id ?? items[index - 1]?.id ?? null;

  const decide = useMutation({
    mutationFn: async (a: { kind: 'approve' | 'reject'; item: QueueItem; reason?: string; series: boolean }) => a.kind === 'approve'
      ? apiResponse(api.v1.leave.requests[':id'].approve.$post({ param: { id: a.item.id }, json: { note: note.trim() || null, series: a.series } }))
      : apiResponse(api.v1.leave.requests[':id'].reject.$post({ param: { id: a.item.id }, json: { reason: a.reason!, series: a.series } })),
    onSuccess: (_r, a) => {
      setDone(`${a.kind === 'approve' ? 'Approved' : 'Refused'}: ${a.item.student.name}`);
      setRefusing(null);
      setNote('');
      setSelected(next());
      qc.invalidateQueries({ queryKey: LEAVE_KEY });
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (refusing || !current) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setSelected(items[Math.min(index + 1, items.length - 1)]!.id); }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setSelected(items[Math.max(index - 1, 0)]!.id); }
      if (canDecide && e.key === 'a' && !current.past) decide.mutate({ kind: 'approve', item: current, series: current.seriesDates.length > 1 });
      if (canDecide && e.key === 'r') setRefusing(current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (items.length === 0) {
    return <EmptyState title="Nothing waits for a decision" message={done ? `${done}. The family and the teachers were told.` : 'New requests appear here, the earliest leave first.'} />;
  }
  const groups = ['Today', 'Tomorrow', 'Later', 'Too late to decide'];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <div className="space-y-4">
        {done && <Notice tone="success">{done}</Notice>}
        {!canDecide && <Notice tone="info">The school has set the admin to decide leave; you see the requests read-only.</Notice>}
        {groups.map((g) => {
          const list = items.filter((i) => groupOf(i, today) === g);
          if (list.length === 0) return null;
          return (
            <section key={g} aria-label={g}>
              <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g}</h2>
              <ul className="space-y-1.5">
                {list.map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => setSelected(i.id)} aria-current={current?.id === i.id}
                      className={cn('w-full rounded-xl border px-3 py-2 text-start', current?.id === i.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:bg-accent')}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground"><bdi>{i.student.name}</bdi></span>
                        <span className="text-sm tabular-nums text-foreground" dir="ltr">{i.leaveTime}</span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {g === 'Later' || g === 'Too late to decide' ? <><DateText date={i.date} weekday /><span>·</span></> : null}
                        <span>{i.gradeLabel}</span>{i.section && <span>· {i.section}</span>}<span>· {i.reason.label}</span>
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {i.seriesDates.length > 1 && <Badge tone="info">{`${i.seriesDates.length} dates`}</Badge>}
                        {i.warnings.length > 0 && <Badge tone="warning">{`${i.warnings.length} to check`}</Badge>}
                        {i.custody.length > 0 && <Badge tone="danger">Custody note</Badge>}
                        {i.lessons.length > 0 && <Badge tone="neutral">{i.lessons.length === 1 ? '1 lesson missed' : `${i.lessons.length} lessons missed`}</Badge>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <p className="text-xs text-muted-foreground">Keys: J / K move · A approves · R refuses.</p>
      </div>
      {current && (
        <article className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm" aria-label={`Request of ${current.student.name}`}>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-foreground">
                <Link href={`/leave/students/${current.student.id}` as Route} className="hover:underline"><bdi>{current.student.name}</bdi></Link>
              </h2>
              <p className="text-sm text-muted-foreground">
                <span>{current.gradeLabel}</span>{current.section && <> · <span>{current.section}</span></>}{current.studentCode && <> · <span className="font-mono">{current.studentCode}</span></>}
              </p>
            </div>
            <div className="text-end">
              <p className="font-semibold text-foreground"><DateText date={current.date} weekday long /></p>
              <p className="text-2xl font-bold text-foreground"><TimesText leaveTime={current.leaveTime} returning={current.returning} returnTime={current.returnTime} /></p>
            </div>
          </header>

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Reason</dt><dd className="font-medium text-foreground">{current.reason.label}</dd></div>
            <div><dt className="text-muted-foreground">Asked by</dt><dd className="text-foreground"><bdi>{current.createdBy}</bdi>{current.onBehalfOf && <> <span>for</span> <bdi>{current.onBehalfOf}</bdi></>} · <span>{current.originLabel}</span></dd></div>
            {current.note && <div className="sm:col-span-2"><dt className="text-muted-foreground">The family&apos;s note</dt><dd className="text-foreground"><bdi>{current.note}</bdi></dd></div>}
            {current.document && <div className="sm:col-span-2"><dt className="text-muted-foreground">Document</dt><dd><a className="text-primary underline" href={fileUrl(current.document.id)} target="_blank" rel="noreferrer"><bdi>{current.document.name}</bdi></a></dd></div>}
          </dl>

          <section aria-label="Who collects" className="flex items-center gap-3 rounded-xl border border-border p-3">
            <Photo fileId={current.collectorDetail?.photoFileId ?? null} name={current.collector.name} size="lg" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-muted-foreground">Collected by</p>
              <p className="font-semibold text-foreground"><CollectorText c={current.collector} /></p>
              {current.collectorDetail && (
                <p className="text-muted-foreground"><span dir="ltr">{current.collectorDetail.phone}</span> · <span>ID</span> <span dir="ltr" className="font-mono">{current.collectorDetail.idNumber}</span></p>
              )}
              {current.collectorDetail?.status === 'pending' && canDecide && <ApproveCollectorInline id={current.collectorDetail.id} />}
            </div>
          </section>

          {current.custody.length > 0 && (
            <Notice tone="danger" title="Custody note on file">
              <span>May not collect:</span> {current.custody.map((c, i) => <span key={c.id}>{i > 0 && ', '}<bdi>{c.personName}</bdi>{c.relation && <> (<span>{c.relation}</span>)</>}</span>)}
            </Notice>
          )}
          {current.warnings.filter((w) => w.code !== 'custody_on_file').length > 0 && (
            <Notice tone="warning" title="Check before approving">
              <ul className="list-disc ps-5">{current.warnings.filter((w) => w.code !== 'custody_on_file').map((w) => <li key={w.code}>{w.message}</li>)}</ul>
            </Notice>
          )}

          <section aria-labelledby="lessons-title">
            <h3 id="lessons-title" className="mb-1.5 text-sm font-semibold text-foreground">Lessons missed</h3>
            {current.lessons.length === 0 ? (
              <p className="text-sm text-muted-foreground">{current.dayNote === 'no_timetable' || current.dayNote === 'no_academic_year' ? 'No published timetable for that day.' : 'No lessons in that time.'}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-start text-xs text-muted-foreground"><tr><th className="py-1 text-start">Period</th><th className="text-start">Time</th><th className="text-start">Lesson</th><th className="text-start">Teacher</th></tr></thead>
                <tbody>
                  {current.lessons.map((l) => (
                    <tr key={l.lessonId} className="border-t border-border">
                      <td className="py-1.5">{l.label}</td><td className="tabular-nums" dir="ltr">{l.startsAt}–{l.endsAt}</td>
                      <td><bdi>{l.subject}</bdi></td><td>{l.teacher ? <bdi>{l.teacher}</bdi> : <span className="text-muted-foreground">No teacher</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {current.exams.length > 0 && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">{current.exams.map((e) => e.title).join(' · ')}</p>}
          </section>

          <section aria-labelledby="history-title" className="text-sm">
            <h3 id="history-title" className="mb-1.5 font-semibold text-foreground">
              {current.history.term ? <span>{`Leave in ${current.history.term.name}: ${current.history.thisTerm}`}</span> : <span>Leave so far</span>}
            </h3>
            <p className="flex flex-wrap gap-1">
              {current.history.byReason.map((r) => <Badge key={r.label} tone="neutral">{`${r.label}: ${r.count}`}</Badge>)}
              {current.history.noShows > 0 && <Badge tone="danger">{`${current.history.noShows} not collected`}</Badge>}
              {current.history.lateReturns > 0 && <Badge tone="warning">{`${current.history.lateReturns} late back`}</Badge>}
            </p>
            {current.history.recent.length > 0 && (
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {current.history.recent.map((r) => <li key={r.id}><DateText date={r.date} weekday /> · <span dir="ltr">{r.leaveTime}</span> · <span>{r.reason}</span> · <StatusBadge status={r.status} /></li>)}
              </ul>
            )}
          </section>

          {current.seriesDates.length > 1 && (
            <p className="text-sm text-muted-foreground"><span>Every week, on:</span> {current.seriesDates.map((d, i) => <span key={d.id}>{i > 0 && ', '}<DateText date={d.date} weekday /></span>)}</p>
          )}

          {canDecide && (
            <footer className="space-y-3 border-t border-border pt-4">
              <Input aria-label="A note for the family (optional)" placeholder="A note for the family (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              {decide.error && <p className="text-sm text-destructive" role="alert">{decide.error.message}</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="lg" disabled={decide.isPending || current.past} onClick={() => decide.mutate({ kind: 'approve', item: current, series: current.seriesDates.length > 1 })}>
                  {current.seriesDates.length > 1 ? `Approve all ${current.seriesDates.length} dates` : 'Approve'}
                </Button>
                <Button size="lg" variant="outline" disabled={decide.isPending} onClick={() => setRefusing(current)}>Refuse…</Button>
              </div>
            </footer>
          )}
        </article>
      )}
      {refusing && (
        <ReasonModal title={`Refuse ${refusing.student.name}'s request?`} description="The family and the student are told the reason." label="Reason" confirmLabel="Refuse" destructive
          isPending={decide.isPending} error={decide.error?.message}
          choice={refusing.seriesDates.length > 1 ? { legend: 'This is a weekly request', options: [{ value: 'all', label: 'Every date' }, { value: 'one', label: 'This date only' }] } : undefined}
          onConfirm={(reason, choice) => decide.mutate({ kind: 'reject', item: refusing, reason, series: refusing.seriesDates.length > 1 && choice !== 'one' })}
          onClose={() => setRefusing(null)} />
      )}
    </div>
  );
}

function ApproveCollectorInline({ id }: { id: string }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async () => apiResponse(api.v1.leave.collectors[':id'].approve.$post({ param: { id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: LEAVE_KEY }),
  });
  return (
    <div className="mt-2">
      <Badge tone="warning">This collector waits for approval</Badge>{' '}
      <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate()}>Approve the collector</Button>
      {m.error && <p className="text-xs text-destructive">{m.error.message}</p>}
    </div>
  );
}

// ─── Collectors waiting ──────────────────────────────────────────────────────

function PendingCollectors({ items, canDecide }: { items: PendingCollector[]; canDecide: boolean }) {
  const qc = useQueryClient();
  const [refusing, setRefusing] = useState<PendingCollector | null>(null);
  const approve = useMutation({
    mutationFn: async (id: string) => apiResponse(api.v1.leave.collectors[':id'].approve.$post({ param: { id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: LEAVE_KEY }),
  });
  const reject = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => apiResponse(api.v1.leave.collectors[':id'].reject.$post({ param: { id }, json: { reason } })),
    onSuccess: () => { setRefusing(null); qc.invalidateQueries({ queryKey: LEAVE_KEY }); },
  });
  if (items.length === 0) return <EmptyState title="No collector waits for approval" message="When a family adds a grandparent, a driver or another adult, they appear here with their photo and ID." />;
  return (
    <div className="space-y-3">
      {approve.error && <Notice tone="danger">{approve.error.message}</Notice>}
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((c) => (
          <li key={c.id} className="flex gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <Photo fileId={c.photoFileId} name={c.name} size="lg" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-foreground"><bdi>{c.name}</bdi> <span className="font-normal text-muted-foreground">· {c.relation}</span></p>
              <p className="text-muted-foreground"><span dir="ltr">{c.phone}</span> · <span>ID</span> <span dir="ltr" className="font-mono">{c.idNumber}</span></p>
              <p className="mt-1 flex flex-wrap gap-1">{c.students.map((s) => <Link key={s.id} href={`/leave/students/${s.id}` as Route}><Badge tone="neutral"><bdi>{s.name}</bdi></Badge></Link>)}</p>
              <p className="mt-1 text-xs text-muted-foreground"><span>Added by</span> <bdi>{c.addedBy}</bdi></p>
              {c.matchesRestriction && <Notice tone="danger" className="mt-2 p-2">Matches a custody restriction — refuse this collector.</Notice>}
              {canDecide && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" disabled={approve.isPending || c.matchesRestriction} onClick={() => approve.mutate(c.id)}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => setRefusing(c)}>Refuse…</Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {refusing && (
        <ReasonModal title={`Refuse ${refusing.name}?`} description="The family is told the reason; leaves naming them need someone else." label="Reason" confirmLabel="Refuse" destructive
          isPending={reject.isPending} error={reject.error?.message} onConfirm={(reason) => reject.mutate({ id: refusing.id, reason })} onClose={() => setRefusing(null)} />
      )}
    </div>
  );
}

// ─── The day ─────────────────────────────────────────────────────────────────

function Day() {
  const [date, setDate] = useState(schoolNow().date);
  const leaves = useQuery({ queryKey: [...LEAVE_KEY, 'day', date], queryFn: () => fetchLeaves({ date }), refetchInterval: 30_000 });
  const rows = useMemo(() => [...(leaves.data ?? [])].sort((a, b) => a.leaveTime.localeCompare(b.leaveTime)), [leaves.data]);
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="outline" size="icon" aria-label="The day before" onClick={() => setDate(addDays(date, -1))}>‹</Button>
        <div><Label htmlFor="day-date" className="mb-1 text-xs text-muted-foreground">Day</Label><Input id="day-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" /></div>
        <Button variant="outline" size="icon" aria-label="The day after" onClick={() => setDate(addDays(date, 1))}>›</Button>
        <Button variant="ghost" onClick={() => setDate(schoolNow().date)}>Today</Button>
        <p className="pb-2 text-sm text-muted-foreground"><DateText date={date} weekday long /></p>
      </div>
      <p className="flex flex-wrap gap-2 text-sm">
        <Badge tone="warning">{`${count('pending')} waiting`}</Badge>
        <Badge tone="info">{`${count('approved')} to leave`}</Badge>
        <Badge tone="success">{`${count('checked_out')} out`}</Badge>
        <Badge tone="success">{`${count('returned')} back`}</Badge>
      </p>
      {leaves.isLoading ? <LoadingState /> : leaves.isError ? <ErrorState onRetry={() => leaves.refetch()} /> : rows.length === 0 ? (
        <EmptyState title="No leave that day" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr><th className="px-3 py-2 text-start">Time</th><th className="px-3 py-2 text-start">Student</th><th className="px-3 py-2 text-start">Reason</th><th className="px-3 py-2 text-start">Collected by</th><th className="px-3 py-2 text-start">Status</th><th className="px-3 py-2 text-start">At the gate</th></tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-2"><TimesText leaveTime={l.leaveTime} returning={l.returning} returnTime={l.returnTime} /></td>
                  <td className="px-3 py-2"><Link className="font-medium text-foreground hover:underline" href={`/leave/students/${l.student.id}` as Route}><bdi>{l.student.name}</bdi></Link></td>
                  <td className="px-3 py-2">{l.reason.label}{l.origin === 'school' && <Badge tone="info" className="ms-1">School</Badge>}</td>
                  <td className="px-3 py-2"><CollectorText c={l.collector} /></td>
                  <td className="px-3 py-2"><StatusBadge status={l.status} noShow={!!l.noShowAt && !l.checkout} late={!!l.lateReturnAt} /></td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {l.checkout ? <span><span>Left</span> <span dir="ltr">{l.checkout.time}</span>{l.checkout.name && <> <span>with</span> <bdi>{l.checkout.name}</bdi></>}{l.returnedTime && <> · <span>back</span> <span dir="ltr">{l.returnedTime}</span></>}</span> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── A new request (desk, coordinator, admin) ────────────────────────────────

export function StudentSearch({ onPick, autoFocus = true }: { onPick: (s: { id: string; name: string }) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const found = useQuery({ queryKey: ['students', 'search', q], queryFn: () => searchStudents(q), enabled: q.trim().length >= 2 });
  const list = found.data?.students ?? [];
  return (
    <div>
      <Label htmlFor="lv-search" className="mb-1.5">Student</Label>
      <Input id="lv-search" autoFocus={autoFocus} placeholder="Name, email or student ID" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { e.preventDefault(); onPick({ id: list[0].id, name: list[0].name }); } }} />
      {q.trim().length >= 2 && (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
          {list.length === 0 && !found.isLoading && <li className="px-3 py-2 text-sm text-muted-foreground">No student found</li>}
          {list.map((s) => (
            <li key={s.id}>
              <button type="button" className="w-full px-3 py-2 text-start text-sm hover:bg-accent" onClick={() => onPick({ id: s.id, name: s.name })}>
                <span className="font-medium text-foreground"><bdi>{s.name}</bdi></span> <span className="text-muted-foreground">{s.gradeLabel}{s.sectionName ? ` · ${s.sectionName}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StaffRequest({ studentId, academic, onDone }: { studentId: string; academic: boolean; onDone?: () => void }) {
  const rec = useQuery({ queryKey: [...LEAVE_KEY, 'student', studentId], queryFn: () => fetchStudentLeave(studentId) });
  if (rec.isLoading) return <LoadingState />;
  if (rec.isError || !rec.data) return <ErrorState onRetry={() => rec.refetch()} />;
  const r = rec.data;
  return (
    <RequestLeaveForm
      mode="staff"
      canApprove={academic && r.canDecide}
      today={r.today}
      policy={r.policy}
      students={[{ id: r.student.id, name: r.student.name, mayLeaveAlone: r.mayLeaveAlone, parents: r.parents, collectors: r.collectors.map((c) => ({ id: c.id, name: c.name, relation: c.relation, status: c.status })) }]}
      onDone={() => onDone?.()}
    />
  );
}

function NewRequest({ academic }: { academic: boolean }) {
  const [student, setStudent] = useState<{ id: string; name: string } | null>(null);
  return (
    <section className="max-w-3xl space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="font-display text-lg font-bold text-foreground">A request for a family, or the school&apos;s own</h2>
      <p className="text-sm text-muted-foreground">A parent at the desk or on the phone, or a student the school sends home. The family is told either way.</p>
      {student ? (
        <>
          <p className="flex items-center gap-2 text-sm"><span className="font-semibold text-foreground"><bdi>{student.name}</bdi></span><Button variant="link" size="sm" onClick={() => setStudent(null)}>Change</Button></p>
          <StaffRequest key={student.id} studentId={student.id} academic={academic} />
        </>
      ) : (
        <StudentSearch onPick={setStudent} />
      )}
    </section>
  );
}
