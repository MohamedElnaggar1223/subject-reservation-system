'use client';

/**
 * Timetables (FEATURES_PLAN.md F1, "Versions").
 *
 * The spreadsheet version: "Timetable FINAL v3 (use this one).xlsx" beside
 * v2 and "v3 Ahmed's changes", e-mailed to staff; nobody is sure which one is
 * in force this week, and last term's is overwritten the day term 2 starts.
 *
 * Here: each term's timetables in one place. A draft is edited and generated;
 * publishing gives it the date it takes effect and freezes it, and the one in
 * force is marked. A change after publishing is a new draft copied from the
 * published one, published from a later date — earlier versions stay, so what
 * was taught on any past day can be read back. A short list at the top says
 * what the timetable still needs (bells, groups, rules) with a link to each.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { DateText, NoYearYet, SELECT_CLASS, YearPicker, useAcademicYears, useBellSchedules, useChosenYear, type AcademicYearRow } from '../../academic/calendar/academic-shared';
import { TT_KEY, TimetableTabs, fetchGroups, fetchTimetables, schoolToday, type TimetableRow } from '../timetable-shared';

export default function VersionsClient(): React.JSX.Element {
  const { data: years, isLoading, isError, refetch } = useAcademicYears();
  const { year, choose } = useChosenYear(years);
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 animate-fade-up">
      <TimetableTabs year={year?.startYear} />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Timetables</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Each term's drafts and published versions. The one in force is marked; earlier versions stay on record, so any past day can be read back.
          </p>
        </div>
        {years && year && <YearPicker years={years} year={year} onChoose={choose} />}
      </header>
      {isLoading ? (
        <LoadingState label="Loading the academic years…" />
      ) : isError ? (
        <ErrorState title="The academic years did not load" onRetry={() => refetch()} />
      ) : !year ? (
        <NoYearYet what="A timetable belongs to a term of an academic year. Set up the year and its terms first." />
      ) : (
        <YearVersions year={year} />
      )}
    </div>
  );
}

function YearVersions({ year }: { year: AcademicYearRow }) {
  const versions = useQuery({ queryKey: [...TT_KEY, 'versions', year.id], queryFn: () => fetchTimetables(year.id) });
  const groups = useQuery({ queryKey: [...TT_KEY, 'groups', year.id], queryFn: () => fetchGroups(year.id) });
  const bells = useBellSchedules(year.id);
  const hasBells = !!bells.data?.some((b) => b.isDefault && b.periods.some((p) => p.kind === 'lesson'));
  const liveGroups = groups.data?.groups.filter((g) => !g.archived) ?? [];
  const noTeacher = liveGroups.filter((g) => !g.teacherId).length;

  return (
    <div className="space-y-6">
      <section aria-labelledby="ready-title" className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 id="ready-title" className="font-display text-base font-bold text-foreground">Before the first timetable</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Step done={year.terms.length > 0} href={`/academic/years?year=${year.startYear}`} label="Terms" detail={year.terms.length ? `${year.terms.length} set` : 'None yet'} />
          <Step done={hasBells} href={`/academic/bells?year=${year.startYear}`} label="Default bell schedule" detail={hasBells ? 'Lesson periods set' : 'No lesson periods yet'} />
          <Step done={liveGroups.length > 0} href={`/timetable/groups?year=${year.startYear}`} label="Teaching groups" detail={groups.isLoading ? 'Loading…' : `${liveGroups.length} groups${noTeacher ? `, ${noTeacher} without a teacher` : ''}`} />
          <Step done href={`/timetable/rules?year=${year.startYear}`} label="Rules (optional)" detail="When teachers and rooms cannot be used" />
        </ul>
      </section>

      {versions.isLoading ? (
        <LoadingState label="Loading the timetables…" />
      ) : versions.isError ? (
        <ErrorState title="The timetables did not load" onRetry={() => versions.refetch()} />
      ) : year.terms.length === 0 ? (
        <EmptyState title="No terms yet" message="Timetables are made per term. Add the year's terms on the Academic year screen." />
      ) : (
        year.terms.map((term) => (
          <TermVersions key={term.id} year={year} term={term} rows={(versions.data ?? []).filter((v) => v.termId === term.id)} all={versions.data ?? []} />
        ))
      )}
    </div>
  );
}

function Step({ done, href, label, detail }: { done: boolean; href: string; label: string; detail: string }) {
  return (
    <li>
      <Link href={href as Route} className={cn('flex items-start gap-3 rounded-lg border px-3 py-2 hover:bg-accent', done ? 'border-border' : 'border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-900/20')}>
        <span aria-hidden="true" className={cn('mt-0.5 text-base', done ? 'text-emerald-600' : 'text-amber-600')}>{done ? '✓' : '•'}</span>
        <span>
          <span className="block text-sm font-semibold text-foreground">{label}</span>
          <span className="block text-xs text-muted-foreground">{detail}</span>
        </span>
      </Link>
    </li>
  );
}

type Term = AcademicYearRow['terms'][number];

function versionState(v: TimetableRow, rows: TimetableRow[]): { label: string; tone: 'success' | 'info' | 'neutral' | 'warning' } {
  if (v.status === 'draft') return { label: 'Draft', tone: 'warning' };
  if (v.inForce) return { label: 'In force', tone: 'success' };
  const current = rows.find((r) => r.inForce);
  if (current && v.effectiveFrom! > current.effectiveFrom!) return { label: 'Scheduled', tone: 'info' };
  return { label: 'Replaced', tone: 'neutral' };
}

function TermVersions({ year, term, rows, all }: { year: AcademicYearRow; term: Term; rows: TimetableRow[]; all: TimetableRow[] }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [copyFrom, setCopyFrom] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const published = rows.filter((r) => r.status === 'published');
  const create = useMutation({
    mutationFn: async () => apiResponse(api.v1.timetables.$post({ json: { termId: term.id, name: name.trim(), copyFromId: copyFrom || null } })),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: TT_KEY });
      router.push(`/timetable/versions/${r.id}` as Route);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'The draft was not made'),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => apiResponse(api.v1.timetables[':id'].$delete({ param: { id } })),
    onSettled: () => qc.invalidateQueries({ queryKey: TT_KEY }),
  });
  const openCreate = (from?: TimetableRow) => {
    setCreating(true);
    setError(null);
    setCopyFrom(from?.id ?? (published.find((p) => p.inForce)?.id ?? ''));
    const n = rows.length + 1;
    setName(from ? `${term.name} — from ${from.name}` : `${term.name} — draft ${n}`);
  };
  const today = schoolToday();
  const running = term.startsOn <= today && today <= term.endsOn;

  return (
    <section aria-labelledby={`term-${term.id}`} className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 id={`term-${term.id}`} className="font-display text-lg font-bold text-foreground">
            <bdi>{term.name}</bdi>
            {running && <Badge tone="success" className="ms-2 align-middle">Now</Badge>}
          </h2>
          <p className="text-sm text-muted-foreground">
            <DateText date={term.startsOn} weekday /> <span>–</span> <DateText date={term.endsOn} weekday />
          </p>
        </div>
        <Button onClick={() => openCreate()}>New draft</Button>
      </div>
      {creating && (
        <form
          className="grid gap-3 border-b border-border bg-muted/40 px-5 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
        >
          <div>
            <Label htmlFor={`name-${term.id}`} className="mb-1 text-sm">Name</Label>
            <Input id={`name-${term.id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
          </div>
          <div>
            <Label htmlFor={`from-${term.id}`} className="mb-1 text-sm">Start from</Label>
            <select id={`from-${term.id}`} className={SELECT_CLASS} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">Nothing placed (every lesson off the grid)</option>
              {all.map((v) => (
                <option key={v.id} value={v.id}>{`A copy of ${v.name} (${v.term.name}${v.status === 'published' ? ', published' : ', draft'})`}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={!name.trim() || create.isPending}>{create.isPending ? 'Making…' : 'Make the draft'}</Button>
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
          {error && <Notice tone="danger" className="sm:col-span-3">{error}</Notice>}
        </form>
      )}
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">No timetable for this term yet. Make a draft, generate it, then publish it from the day it starts.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="px-5 py-2 text-start font-medium">Timetable</th>
                <th className="px-3 py-2 text-start font-medium">State</th>
                <th className="px-3 py-2 text-start font-medium">Takes effect</th>
                <th className="px-3 py-2 text-end font-medium">Placed</th>
                <th className="px-3 py-2 text-start font-medium">Published by</th>
                <th className="px-5 py-2 text-end font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const state = versionState(v, rows);
                return (
                  <tr key={v.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3">
                      <Link href={`/timetable/versions/${v.id}` as Route} className="font-semibold text-foreground hover:underline"><bdi>{v.name}</bdi></Link>
                      {v.publishNote && <span className="block text-xs text-muted-foreground"><bdi>{v.publishNote}</bdi></span>}
                    </td>
                    <td className="px-3 py-3"><Badge tone={state.tone}>{state.label}</Badge></td>
                    <td className="px-3 py-3">{v.effectiveFrom ? <DateText date={v.effectiveFrom} weekday /> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-3 text-end tabular-nums"><bdi>{v.placed}</bdi>/<bdi>{v.lessons}</bdi></td>
                    <td className="px-3 py-3 text-muted-foreground">{v.publishedByName ? <bdi>{v.publishedByName}</bdi> : '—'}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" asChild><Link href={`/timetable/versions/${v.id}` as Route}>{v.status === 'draft' ? 'Edit' : 'Open'}</Link></Button>
                        <Button size="sm" variant="outline" onClick={() => openCreate(v)}>Copy to a draft</Button>
                        {v.status === 'draft' && (
                          <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete the draft “${v.name}”? Its placements are lost; published versions are not touched.`)) remove.mutate(v.id); }}>
                            Delete
                          </Button>
                        )}
                      </div>
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

export { versionState };
