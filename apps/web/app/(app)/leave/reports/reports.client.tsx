'use client';

/**
 * Campus-leave history and reports (FEATURES_PLAN.md F2): the desk, the
 * coordinator and the admin.
 *
 * The spreadsheet version: a pivot table rebuilt by hand each month from the
 * leave sheet, with the grade and the class typed in beside every row (and
 * wrong after September). Here the grade and the section are the student's
 * on the day of each leave; one range gives the totals, leave by reason,
 * grade, section, month and weekday, who started it, and the students who
 * leave most (each a link to their record); every leave in the range is
 * listed below with filters, and the whole range downloads as a spreadsheet.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { cn } from '~/lib/utils';
import { DateText, addDays } from '../../academic/calendar/academic-shared';
import { download } from '../../timetable/timetable-shared';
import { LEAVE_KEY, fetchReport, fetchLeaves, schoolNow, StatusBadge, TimesText, CollectorText, SELECT, STATUS, type LeaveReport } from '../leave-shared';
import { LeaveNav } from '../leave-nav';

function presets(today: string) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const ayStart = m >= 7 ? `${y}-07-01` : `${y - 1}-07-01`;
  return [
    { key: 'month', label: 'This month', from: monthStart, to: today },
    { key: 'last', label: 'Last month', from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd },
    { key: '30', label: 'Last 30 days', from: addDays(today, -29), to: today },
    { key: 'year', label: 'This academic year', from: ayStart, to: addDays(`${Number(ayStart.slice(0, 4)) + 1}-07-01`, -1) },
  ];
}

export default function ReportsClient({ academic }: { academic: boolean }): React.JSX.Element {
  const today = schoolNow().date;
  const ps = presets(today);
  const [from, setFrom] = useState(ps[3]!.from);
  const [to, setTo] = useState(ps[3]!.to);
  const report = useQuery({ queryKey: [...LEAVE_KEY, 'report', from, to], queryFn: () => fetchReport(from, to) });
  const [csvError, setCsvError] = useState('');
  const exportCsv = async () => {
    setCsvError('');
    try { await download(await api.v1.leave.reports.csv.$get({ query: { from, to } }), `campus-leave-${from}-${to}.csv`); } catch (e) { setCsvError((e as Error).message); }
  };
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 animate-fade-up">
      <LeaveNav academic={academic} />
      <header className="mb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Leave history and reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">Grades and sections are each student&apos;s on the day of the leave.</p>
      </header>
      <div className="mb-5 flex flex-wrap items-end gap-2">
        {ps.map((p) => (
          <Button key={p.key} variant={from === p.from && to === p.to ? 'default' : 'outline'} size="sm" onClick={() => { setFrom(p.from); setTo(p.to); }}>{p.label}</Button>
        ))}
        <div><Label htmlFor="rep-from" className="mb-1 text-xs text-muted-foreground">From</Label><Input id="rep-from" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-40" /></div>
        <div><Label htmlFor="rep-to" className="mb-1 text-xs text-muted-foreground">To</Label><Input id="rep-to" type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-40" /></div>
        <Button variant="outline" onClick={exportCsv}>Download for Excel</Button>
        {csvError && <span className="text-sm text-destructive">{csvError}</span>}
      </div>
      {report.isLoading ? <LoadingState label="Building the report…" /> : report.isError || !report.data ? <ErrorState message={report.error?.message} onRetry={() => report.refetch()} /> : (
        <Report r={report.data} />
      )}
    </div>
  );
}

function Report({ r }: { r: LeaveReport }) {
  const t = r.totals;
  return (
    <div className="space-y-6">
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Tile label="Requests" value={t.requests} />
        <Tile label="Approved" value={t.approved} />
        <Tile label="Waiting" value={t.pending} />
        <Tile label="Not approved" value={t.rejected} />
        <Tile label="Cancelled" value={t.cancelled} />
        <Tile label="Left school" value={t.taken} />
        <Tile label="Not collected" value={t.noShows} alert />
        <Tile label="Late back" value={t.lateReturns} alert />
      </section>
      <p className="text-sm text-muted-foreground">
        <span>{`Sent home by the school: ${t.school}`}</span>
        {t.averageMinutesOut !== null && <span>{` · Average time out when back the same day: ${t.averageMinutesOut} minutes`}</span>}
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Breakdown title="By reason" rows={r.byReason} />
        <Breakdown title="By grade" rows={r.byGrade} />
        <Breakdown title="By section" rows={r.bySection} />
        <Breakdown title="By month" rows={r.byMonth} />
        <Breakdown title="By weekday" rows={r.byWeekday} />
        <Breakdown title="Who started it" rows={r.byOrigin} />
      </div>
      <section aria-labelledby="top-title" className="rounded-xl border border-border bg-card p-4">
        <h2 id="top-title" className="mb-2 font-display text-base font-bold text-foreground">Students who leave most</h2>
        {r.topStudents.length === 0 ? <p className="text-sm text-muted-foreground">No leave in this range.</p> : (
          <ol className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {r.topStudents.map((s) => (
              <li key={s.studentId} className="flex justify-between gap-2 rounded-md px-2 py-1 hover:bg-accent">
                <Link href={`/leave/students/${s.studentId}` as Route} className="text-foreground hover:underline"><bdi>{s.name}</bdi> <span className="text-muted-foreground">{s.gradeLabel}{s.section ? ` · ${s.section}` : ''}</span></Link>
                <span className="font-semibold tabular-nums">{s.count}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <AllLeaves from={r.from} to={r.to} />
    </div>
  );
}

function Tile({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={cn('rounded-xl border bg-card p-3', alert && value > 0 ? 'border-red-200 dark:border-red-800' : 'border-border')}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-bold tabular-nums', alert && value > 0 ? 'text-red-700 dark:text-red-400' : 'text-foreground')}>{value}</p>
    </div>
  );
}

/** A count per key with a bar (the share of the largest), and how many were taken and not collected. */
function Breakdown({ title, rows }: { title: string; rows: { key: string; requests: number; taken: number; noShows: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.requests));
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label={title}>
      <h2 className="mb-2 font-display text-base font-bold text-foreground">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="text-start font-normal"></th><th className="text-end font-normal">Requests</th><th className="text-end font-normal">Left</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="py-1 pe-2">
                  <span className="block truncate text-foreground">{r.key}</span>
                  <span className="mt-0.5 block h-1.5 rounded-full bg-primary/20"><span className="block h-1.5 rounded-full bg-primary" style={{ width: `${(r.requests / max) * 100}%` }} /></span>
                </td>
                <td className="text-end tabular-nums">{r.requests}</td>
                <td className="text-end tabular-nums text-muted-foreground">{r.taken}{r.noShows > 0 && <span className="text-red-700 dark:text-red-400">{` · ${r.noShows}!`}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AllLeaves({ from, to }: { from: string; to: string }) {
  const list = useQuery({ queryKey: [...LEAVE_KEY, 'range', from, to], queryFn: () => fetchLeaves({ from, to }) });
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');
  const rows = useMemo(() => (list.data ?? []).filter((l) => (!status || l.status === status) && (!reason || l.reason.label === reason) && (!q || l.student.name.toLowerCase().includes(q.toLowerCase()))), [list.data, status, reason, q]);
  const reasons = [...new Set((list.data ?? []).map((l) => l.reason.label))].sort();
  return (
    <section aria-labelledby="all-title">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <h2 id="all-title" className="font-display text-lg font-bold text-foreground">Every leave in the range</h2>
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Find a student" placeholder="Find a student" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
          <select aria-label="Status" className={cn(SELECT, 'w-44')} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select aria-label="Reason" className={cn(SELECT, 'w-48')} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Any reason</option>
            {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>
      {list.isLoading ? <LoadingState /> : list.isError ? <ErrorState onRetry={() => list.refetch()} /> : rows.length === 0 ? <EmptyState title="No leave matches" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr><th className="px-3 py-2 text-start">Date</th><th className="px-3 py-2 text-start">Student</th><th className="px-3 py-2 text-start">Time</th><th className="px-3 py-2 text-start">Reason</th><th className="px-3 py-2 text-start">Collected by</th><th className="px-3 py-2 text-start">Status</th></tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-2"><DateText date={l.date} weekday /></td>
                  <td className="px-3 py-2"><Link href={`/leave/students/${l.student.id}` as Route} className="text-foreground hover:underline"><bdi>{l.student.name}</bdi></Link></td>
                  <td className="px-3 py-2"><TimesText leaveTime={l.leaveTime} returning={l.returning} returnTime={l.returnTime} /></td>
                  <td className="px-3 py-2">{l.reason.label}</td>
                  <td className="px-3 py-2"><CollectorText c={l.collector} /></td>
                  <td className="px-3 py-2"><StatusBadge status={l.status} noShow={!!l.noShowAt && !l.checkout} late={!!l.lateReturnAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
