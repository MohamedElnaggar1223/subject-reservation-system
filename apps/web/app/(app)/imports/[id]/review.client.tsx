'use client';

/**
 * The staged review of an import (FEATURES_PLAN.md F7).
 *
 * The spreadsheet version (UX_AUDIT.md §4): the coordinator scrolls 400
 * rows looking for what is wrong — a missing email, two children under one
 * address, the same child twice, a phone that lost its 0, a January row in
 * the November tab, a note in the wrong column — remembers each, and fixes it
 * later at the desk, family by family, retyping everything.
 *
 * Here the file has been read already and every problem the spike found is
 * listed by kind, with how many rows it touches and what it means (Problems);
 * a click opens those rows with the line as the sheet has it and the fields
 * as read, to fix in place (Rows); the people the rows name — shared emails,
 * look-alikes, name spellings, existing accounts — are merged, split or kept
 * apart in one click (People); the coordinator's pending answers and the
 * catalogue, teachers, sections and series are one screen of choices
 * (Mapping). Nothing is made until Commit, which makes every family that has
 * nothing left to fix, one at a time, and says what it made (Result).
 */

import { useMemo, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { Route } from 'next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, schoolDateString } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Notice, Badge } from '~/components/ui/tone';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { cn } from '~/lib/utils';
import { DateText } from '../../academic/calendar/academic-shared';
import { useImport, IMPORTS_KEY, StatusBadge, kindLabel, noteTitle, noteMeaning, type ImportView } from '../import-shared';
import { ProblemsTab } from './review-problems';
import { RowsTab, RowEditor } from './review-rows';
import { PeopleTab } from './review-people';
import { MappingTab } from './review-mapping';
import { ResultTab } from './review-result';

type Tab = 'problems' | 'rows' | 'people' | 'mapping' | 'result';

export function useReviewMutation<T>(id: string, fn: (arg: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const m = useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      setError('');
      await queryClient.invalidateQueries({ queryKey: [...IMPORTS_KEY] });
    },
    onError: (err: Error) => setError(err.message),
  });
  return { ...m, error, clearError: () => setError('') };
}

export default function ReviewClient({ id, isAdmin }: { id: string; isAdmin: boolean }): React.JSX.Element {
  const q = useImport(id);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'commit' | 'discard' | null>(null);
  const v = q.data;

  const tabs: [Tab, string, number | null][] = useMemo(() => {
    if (!v) return [];
    const conflicts = v.people.filter((p) => !p.mergedInto && p.problems.some((x) => x.severity !== 'info')).length;
    return [
      ['problems', 'Problems', v.summary.rowsWithErrors],
      ['rows', 'Rows', v.summary.rows],
      ['people', v.kind === 'money_record' ? 'Students' : 'People and conflicts', conflicts],
      ...(v.kind === 'school_sheet' || v.kind === 'scl_roster' ? [['mapping', 'Mapping', null] as [Tab, string, null]] : []),
      ...(v.batch.result ? [['result', 'Result', null] as [Tab, string, null]] : []),
    ];
  }, [v]);
  const tab = (tabs.find(([t]) => t === params.get('tab'))?.[0] ?? 'problems') as Tab;
  const go = (t: Tab, extra: Record<string, string | null> = {}) => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', t);
    for (const [k, val] of Object.entries(extra)) { if (val === null) next.delete(k); else next.set(k, val); }
    router.replace(`${pathname}?${next.toString()}` as Route, { scroll: false });
  };

  const commit = useReviewMutation(id, () => apiResponse(api.v1.imports[':id'].commit.$post({ param: { id } })));
  const discard = useReviewMutation(id, () => apiResponse(api.v1.imports[':id'].discard.$post({ param: { id } })));

  if (q.isLoading) return <div className="px-6 py-8"><LoadingState label="Reading the import…" /></div>;
  if (q.isError || !v) return <div className="px-6 py-8"><ErrorState title="The import did not load" message={q.error?.message} onRetry={() => q.refetch()} /></div>;

  const editable = v.batch.status === 'staged' || v.batch.status === 'partial';
  const ready = v.summary.readyFamilies;
  const editingRow = editing ? v.rows.find((r) => r.id === editing) ?? null : null;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-up">
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <a href="/imports" className="text-muted-foreground hover:text-foreground hover:underline">Day-one import</a>
      </nav>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            <bdi data-i18n-skip="true">{v.batch.fileName}</bdi>
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{kindLabel(v.kind)}</span>
            <StatusBadge status={v.batch.status} />
            <span>·</span>
            <span>Staged</span> <DateText date={schoolDateString(new Date(v.batch.createdAt))} />
            {v.batch.createdByName && <><span>by</span> <bdi data-i18n-skip="true">{v.batch.createdByName}</bdi></>}
            {v.batch.committedAt && (
              <><span>·</span><span>committed</span> <DateText date={schoolDateString(new Date(v.batch.committedAt))} />
                {v.batch.committedByName && <><span>by</span> <bdi data-i18n-skip="true">{v.batch.committedByName}</bdi></>}</>
            )}
          </p>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setConfirm('discard')}>Put this file aside</Button>
            <Button disabled={ready === 0 || commit.isPending} onClick={() => setConfirm('commit')}>
              {commit.isPending ? 'Committing…' : ready === 1 ? 'Commit 1 family' : <><span>Commit</span> <span className="tabular-nums">{ready}</span> <span>families</span></>}
            </Button>
          </div>
        )}
      </header>

      {v.batch.status === 'committing' && (
        <Notice tone="warning" className="mb-4" title="Being committed now">
          <span>Someone started committing this file</span>{v.batch.commitStartedByName && <> (<bdi data-i18n-skip="true">{v.batch.commitStartedByName}</bdi>)</>}<span>. Look again in a minute.</span>
        </Notice>
      )}
      {commit.error && <Notice tone="danger" className="mb-4">{commit.error}</Notice>}
      {discard.error && <Notice tone="danger" className="mb-4">{discard.error}</Notice>}

      <SummaryPanel v={v} />

      <div className="mb-5 space-y-2">
        {v.batch.sameFileBefore.length > 0 && (
          <Notice tone="info" title="This file was staged before">
            <span>Its review — fixes, merges, skips and the mapping — was carried over. Anything already committed is found and left as it is: committing again changes nothing.</span>
          </Notice>
        )}
        {v.notes.map((n, i) => (
          <details key={`${n.code}-${i}`} className="rounded-xl border border-border bg-card px-4 py-2 text-sm">
            <summary className="cursor-pointer font-medium text-foreground">
              <span>{noteTitle(n.code)}</span>
              {n.detail && <> <span className="text-muted-foreground">—</span> <bdi data-i18n-skip="true" className="text-muted-foreground">{n.detail}</bdi></>}
            </summary>
            <p className="mt-1 text-muted-foreground">{noteMeaning(n.code)}</p>
          </details>
        ))}
      </div>

      <div role="tablist" aria-label="Review" className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {tabs.map(([t, label, n]) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => go(t)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold',
              tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <span>{label}</span>
            {n !== null && n > 0 && <Badge tone={t === 'problems' ? 'danger' : t === 'people' ? 'warning' : 'neutral'}><span className="tabular-nums">{n}</span></Badge>}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'problems' && <ProblemsTab v={v} onOpenRows={(code) => go('rows', { problem: code, show: null })} onEdit={setEditing} />}
        {tab === 'rows' && <RowsTab id={id} v={v} editable={editable} onEdit={setEditing} />}
        {tab === 'people' && <PeopleTab id={id} v={v} editable={editable} onEdit={setEditing} />}
        {tab === 'mapping' && <MappingTab id={id} v={v} editable={editable} isAdmin={isAdmin} />}
        {tab === 'result' && <ResultTab v={v} onOpenRows={(show) => go('rows', { show, problem: null })} />}
      </div>

      {editingRow && <RowEditor id={id} v={v} row={editingRow} editable={editable && editingRow.status !== 'committed'} onClose={() => setEditing(null)} />}

      {confirm === 'commit' && (
        <Dialog
          title={ready === 1 ? 'Commit 1 family?' : `Commit ${ready} families?`}
          confirmLabel={commit.isPending ? 'Committing…' : 'Commit'}
          pending={commit.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() => commit.mutate(undefined, { onSuccess: () => { setConfirm(null); go('result'); } })}
        >
          <p>Each family is made in one go: if anything in it is refused, nothing of it is made and its rows say why.</p>
          <PlanList v={v} />
          {v.summary.heldFamilies > 0 && (
            <p className="mt-2 text-amber-700 dark:text-amber-400">
              <span className="tabular-nums">{v.summary.heldFamilies}</span> <span>families with problems to fix wait; commit again once they are fixed.</span>
            </p>
          )}
        </Dialog>
      )}
      {confirm === 'discard' && (
        <Dialog
          title="Put this file aside?"
          confirmLabel="Put aside"
          destructive
          pending={discard.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() => discard.mutate(undefined, { onSuccess: () => setConfirm(null) })}
        >
          <p>Nothing it would make is made, and its review can no longer change. What it already committed stays. You can stage the file again later.</p>
        </Dialog>
      )}
    </div>
  );
}

/** What a commit would do now, in the school's words. */
function SummaryPanel({ v }: { v: ImportView }) {
  const s = v.summary;
  return (
    <section aria-label="What a commit would do" className="mb-5 grid gap-3 md:grid-cols-4">
      <Stat label="Rows" value={s.rows} hint={<><span className="tabular-nums">{s.importing}</span> <span>to import</span> · <span className="tabular-nums">{s.skipped}</span> <span>left out</span></>} />
      <Stat label="Families ready" value={s.readyFamilies} tone="info" hint={<><span className="tabular-nums">{s.committedFamilies}</span> <span>committed</span></>} />
      <Stat label="Families held back" value={s.heldFamilies} tone={s.heldFamilies ? 'danger' : 'neutral'} hint={<><span className="tabular-nums">{s.rowsWithErrors}</span> <span>rows to fix</span></>} />
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">A commit would make</p>
        <PlanList v={v} compact />
      </div>
    </section>
  );
}

function Stat({ label, value, hint, tone = 'neutral' }: { label: string; value: number; hint: React.ReactNode; tone?: 'neutral' | 'info' | 'danger' }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-display text-2xl font-bold tabular-nums', tone === 'danger' && value ? 'text-red-600 dark:text-red-400' : tone === 'info' ? 'text-primary' : 'text-foreground')}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function PlanList({ v, compact = false }: { v: ImportView; compact?: boolean }) {
  const p = v.summary.plan;
  const items: [number, string][] = [
    [p.students.create, 'new student accounts'],
    [p.parents.create, 'new parent accounts'],
    [p.links, 'parent–child links'],
    [p.sectionPlacements, 'students placed in sections'],
    [p.newSections, 'new sections'],
    [p.newTeachers, 'new teacher records'],
    [p.enrolments, 'course enrolments'],
    [p.history, 'registrations kept as history'],
    [p.registrations, 'registrations awaiting payment'],
    [p.money, 'money history notes'],
  ];
  const shown = items.filter(([n]) => n > 0);
  const matched = p.students.match + p.parents.match;
  return (
    <ul className={cn('mt-1 text-sm', compact ? 'space-y-0' : 'space-y-0.5')}>
      {shown.length === 0 && <li className="text-muted-foreground">Nothing new</li>}
      {shown.map(([n, label]) => (
        <li key={label}><span className="font-semibold tabular-nums text-foreground">{n}</span> <span className="text-muted-foreground">{label}</span></li>
      ))}
      {matched > 0 && <li><span className="font-semibold tabular-nums text-foreground">{matched}</span> <span className="text-muted-foreground">accounts found already</span></li>}
    </ul>
  );
}

export function Dialog({
  title, children, confirmLabel, onConfirm, onClose, pending = false, destructive = false,
}: {
  title: string; children: React.ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void; pending?: boolean; destructive?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title"
      onKeyDown={(e) => { if (e.key === 'Escape' && !pending) onClose(); }}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl">
        <h2 id="import-dialog-title" className="mb-2 font-display text-lg font-bold text-foreground">{title}</h2>
        <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
        <div className="mt-5 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending} autoFocus>Cancel</Button>
          <Button variant={destructive ? 'destructive' : 'default'} className="flex-1" onClick={onConfirm} disabled={pending}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}
