'use client';

/**
 * The board's entry list (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §3).
 *
 * The spreadsheet version: before the deadline the coordinator copies the
 * entry sheet into the board's template column by column (surname in
 * capitals, date of birth as DD/MM/YYYY, M or F), keys it into the portal,
 * and learns from the portal's rejection report — or a phone call from the
 * board — that a candidate has no UCI, a syllabus no option code, a
 * forecast grade is missing. Students whose registration was confirmed but
 * never typed into the sheet are found in results week.
 *
 * Here: the rows are already in the portal's columns and order (marked
 * assumed until checked against the board's own template), every row says
 * what the board would refuse and links to the screen that fixes it, the
 * problems are counted and filter the rows, and the file downloads with
 * only the rows that are ready. Confirmed registrations with no entry are
 * listed with the reason and the one-click fix. The board's rules the
 * check applies are on the same page, in plain words, and the coordinator
 * changes them with a reason when the board's handbook says otherwise.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ENTRY_PROBLEMS, ENTRY_PROBLEM_LABELS, type EntryProblem } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice, TONE_CLASSES } from '~/components/ui/tone';
import { downloadCsv, toCsv } from '~/lib/csv';
import { cn } from '~/lib/utils';
import {
  EXAMS_KEY, BoardText, Code, ProblemChips, SeriesSelect, fetchEntryList, useSeriesChoice, type BoardSeriesRow, type EntryListData,
} from '../exam-f4-shared';
import { InstantText } from '../exams-shared';
import { FlashNotice, SeriesDeadlineStatus, deriveEntries, type Flash } from '../entries/entries-shared';
import { BoardRulesPanel } from './board-rules.client';

type Fix = 'candidate' | 'entries' | 'forecasts' | 'settings';

/** Where each problem is fixed. */
const FIX_OF: Record<EntryProblem, Fix> = {
  missing_centre_number: 'settings',
  missing_candidate_number: 'candidate',
  missing_legal_name: 'candidate',
  missing_date_of_birth: 'candidate',
  missing_gender: 'candidate',
  missing_uci: 'candidate',
  access_arrangements_unapproved: 'candidate',
  missing_option_code: 'entries',
  missing_tier: 'entries',
  carry_forward_incomplete: 'entries',
  carry_forward_to_confirm: 'entries',
  registration_not_confirmed: 'entries',
  missing_forecast: 'forecasts',
};
const FIX_LABEL: Record<Fix, string> = {
  candidate: 'Candidate details',
  entries: 'Entries',
  forecasts: 'Forecast grades',
  settings: 'Settings',
};
const ROUTE_LABEL: Record<string, string> = { direct: 'Directly with the board', british_council: 'Through the British Council' };

type Filter = 'all' | 'ready' | EntryProblem;

export default function EntryListsClient(): React.JSX.Element {
  const { series, chosen, choose, isLoading } = useSeriesChoice();
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 animate-fade-up">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Entry lists</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Each series&apos; entries in the board portal&apos;s columns, with everything the board would refuse. Fix what is flagged, then download the rows that are ready.
          </p>
        </div>
        <SeriesSelect series={series} value={chosen?.id} onChange={choose} />
      </header>
      {isLoading ? (
        <LoadingState label="Loading the series…" />
      ) : !chosen ? (
        <EmptyState
          title="No board series yet"
          message="An entry list belongs to a board series. Add the boards' sittings on the Board series page first."
          action={<Button asChild variant="outline"><Link href="/exams/series">Board series</Link></Button>}
        />
      ) : (
        <SeriesList key={chosen.id} series={chosen} />
      )}
    </div>
  );
}

function SeriesList({ series }: { series: BoardSeriesRow }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...EXAMS_KEY, 'entry-list', series.id],
    queryFn: () => fetchEntryList(series.id),
  });
  return (
    <>
      <SeriesDeadlineStatus series={series} />
      {isLoading ? (
        <LoadingState label="Building the entry list…" />
      ) : isError || !data ? (
        <ErrorState
          title="The entry list did not load"
          message={error instanceof Error ? error.message : 'This is a connection problem, not an empty list. Try again.'}
          onRetry={() => refetch()}
        />
      ) : (
        <ListBody data={data} series={series} />
      )}
      <BoardRulesPanel boardCode={series.boardCode} />
    </>
  );
}

function ListBody({ data, series }: { data: EntryListData; series: BoardSeriesRow }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [which, setWhich] = useState<'ready' | 'all'>('ready');
  const rows = data.rows;
  const shown = useMemo(
    () => (filter === 'all' ? rows : filter === 'ready' ? rows.filter((r) => !r.problems.length) : rows.filter((r) => r.problems.includes(filter))),
    [rows, filter],
  );
  const problems = ENTRY_PROBLEMS.filter((p) => (data.summary[p] ?? 0) > 0);

  const download = () => {
    const out = which === 'ready' ? rows.filter((r) => !r.problems.length) : rows;
    const csv = toCsv(data.columns.map((c) => c.label), out.map((r) => data.columns.map((c) => r.values[c.key] ?? '')));
    const label = series.label ? `-${series.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : '';
    downloadCsv(`${data.series.boardCode}-${data.series.month}-${data.series.year}${label}-entry-list-${which === 'ready' ? 'ready-rows' : 'all-rows'}.csv`, csv);
  };

  const fixHref = (fix: Fix, studentId: string): Route => {
    if (fix === 'settings') return '/settings' as Route;
    if (fix === 'forecasts') return `/exams/forecasts?series=${series.id}` as Route;
    if (fix === 'entries') return `/exams/entries?series=${series.id}&student=${studentId}` as Route;
    return `/exams/candidates?series=${series.id}&student=${studentId}` as Route;
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start gap-x-8 gap-y-2 rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
        <div>
          <p className="text-xs text-muted-foreground">Centre number</p>
          {data.centre.centreNumber ? (
            <p className="mt-0.5 font-semibold text-foreground"><Code>{data.centre.centreNumber}</Code></p>
          ) : (
            <p className="mt-0.5"><Badge tone="danger">None recorded</Badge> <Link href="/settings" className="text-xs font-medium text-primary hover:underline">Settings</Link></p>
          )}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Entry route</p>
          <p className="mt-0.5 text-foreground">{ROUTE_LABEL[data.centre.route] ?? data.centre.route}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Rows</p>
          <p className="mt-0.5 text-foreground">
            <span className="font-semibold">{rows.length === 1 ? '1 entry' : `${rows.length} entries`}</span>
            {' · '}
            <span className="tabular-nums font-semibold">{data.ready}</span> <span>ready</span>
          </p>
        </div>
      </div>

      <Notice tone="warning" className="mb-4" title="The columns are assumed">
        The boards&apos; own templates are not in hand yet, so each column below is our reading of the board portal&apos;s fields, marked &ldquo;assumed&rdquo;. Check the columns and their order against the board&apos;s template before uploading the file. Column names stay as the board&apos;s portal writes them.
      </Notice>

      {rows.length === 0 ? (
        <EmptyState
          title="No entries in this series yet"
          message="The list is made from the series' entries. Derive them from the confirmed registrations on the Entries page."
          action={<Button asChild variant="outline"><Link href={`/exams/entries?series=${series.id}` as Route}>Entries</Link></Button>}
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Show">
            <FilterChip on={filter === 'all'} onClick={() => setFilter('all')} label="Every row" count={rows.length} />
            <FilterChip on={filter === 'ready'} onClick={() => setFilter('ready')} label="Ready" count={data.ready} tone="success" />
            {problems.map((p) => (
              <FilterChip key={p} on={filter === p} onClick={() => setFilter(filter === p ? 'all' : p)} label={ENTRY_PROBLEM_LABELS[p]} count={data.summary[p] ?? 0} tone="warning" />
            ))}
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
            <span className="text-sm font-medium text-foreground">Download for the board&apos;s portal</span>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="radio" name="csv-rows" checked={which === 'ready'} onChange={() => setWhich('ready')} className="size-4" />
              <span>Only ready rows</span> <span className="tabular-nums text-muted-foreground">({data.ready})</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="radio" name="csv-rows" checked={which === 'all'} onChange={() => setWhich('all')} className="size-4" />
              <span>All rows</span> <span className="tabular-nums text-muted-foreground">({rows.length})</span>
            </label>
            <Button type="button" onClick={download} disabled={which === 'ready' ? !data.ready : !rows.length}>Download CSV</Button>
          </div>

          <div className="mb-8 overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted">
                <tr>
                  <th scope="col" className="sticky start-0 z-10 bg-muted px-3 py-2 text-start align-bottom font-semibold text-muted-foreground">
                    Candidate <span className="block text-[11px] font-normal">(school record, not in the file)</span>
                  </th>
                  <th scope="col" className="min-w-72 px-3 py-2 text-start align-bottom font-semibold text-muted-foreground">What the board would refuse</th>
                  {data.columns.map((c) => (
                    <th key={c.key} scope="col" className="min-w-24 px-3 py-2 text-start align-bottom font-semibold text-muted-foreground">
                      <bdi data-i18n-skip="true" dir="ltr">{c.label}</bdi>
                      {c.assumed && <Badge tone="warning" className="ms-1 px-1.5 py-0 text-[10px]">assumed</Badge>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((r) => {
                  const fixes = [...new Set(r.problems.map((p) => FIX_OF[p as EntryProblem]).filter(Boolean))];
                  return (
                    <tr key={r.entryId} className={cn('align-top', r.problems.length > 0 && 'bg-amber-50/30 dark:bg-amber-900/10')}>
                      <td className="sticky start-0 bg-card px-3 py-2 font-medium text-foreground"><bdi data-i18n-skip="true">{r.studentName}</bdi></td>
                      <td className="min-w-72 px-3 py-2">
                        <ProblemChips problems={r.problems} />
                        {fixes.length > 0 && (
                          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                            <span className="text-muted-foreground">Fix on:</span>
                            {fixes.map((f) => (
                              <Link key={f} href={fixHref(f, r.studentId)} className="font-medium text-primary underline-offset-2 hover:underline">{FIX_LABEL[f]}</Link>
                            ))}
                          </p>
                        )}
                      </td>
                      {data.columns.map((c) => (
                        <td key={c.key} className="whitespace-nowrap px-3 py-2 font-mono text-xs text-foreground" data-i18n-skip="true" dir="ltr">
                          {r.values[c.key] || <span className="text-muted-foreground">—</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr><td colSpan={data.columns.length + 2} className="px-3 py-6 text-center text-muted-foreground">No row is flagged for this.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Unentered data={data} series={series} />
    </>
  );
}

function FilterChip({ on, onClick, label, count, tone }: { on: boolean; onClick: () => void; label: string; count: number; tone?: 'success' | 'warning' }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
        on ? 'border-primary bg-primary text-primary-foreground'
          : tone ? cn('border-transparent hover:opacity-80', TONE_CLASSES[tone])
            : 'border-border bg-background text-foreground hover:bg-accent',
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums font-semibold">{count}</span>
    </button>
  );
}

// ─── Confirmed registrations with no entry ───────────────────────────────────

function Unentered({ data, series }: { data: EntryListData; series: BoardSeriesRow }) {
  const queryClient = useQueryClient();
  const [flash, setFlash] = useState<Flash>(null);
  const derive = useMutation({
    mutationFn: (studentId: string) => deriveEntries({ boardSeriesId: series.id, studentId, commit: true }),
    onSuccess: (r, studentId) => {
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
      const name = data.unentered.find((u) => u.studentId === studentId)?.studentName ?? '';
      setFlash({
        tone: r.created ? 'success' : 'info',
        title: r.created === 1 ? 'Made 1 new entry.' : `Made ${r.created} new entries.`,
        lines: [<bdi key="n" data-i18n-skip="true">{name}</bdi>],
      });
    },
    onError: (err: Error) => setFlash({ tone: 'danger', title: 'Nothing was made.', lines: [err.message] }),
  });
  const passed = data.series.pastDeadline;
  return (
    <section className="mb-8" aria-labelledby="unentered-title">
      <h2 id="unentered-title" className="mb-1 font-display text-lg font-bold text-foreground">Confirmed registrations with no entry</h2>
      <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
        A family paid for these subjects, but nothing is entered with the board for them yet.
      </p>
      <FlashNotice flash={flash} onClose={() => setFlash(null)} />
      {data.unentered.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground shadow-sm">Every confirmed registration in this series has its entries.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Candidate</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Registered subject</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Why there is no entry</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold text-muted-foreground"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.unentered.map((u) => (
                <tr key={u.registrationId}>
                  <td className="px-3 py-2 font-medium text-foreground"><bdi data-i18n-skip="true">{u.studentName}</bdi></td>
                  <td className="px-3 py-2"><BoardText>{u.subjectName}</BoardText> <Code className="text-xs text-muted-foreground">{u.subjectCode}</Code></td>
                  <td className="px-3 py-2 text-foreground">
                    {!u.mapped ? (
                      <span>The subject is not mapped on the Catalogue</span>
                    ) : u.withdrawnAt ? (
                      <span><span>Its entry was withdrawn on</span> <InstantText iso={u.withdrawnAt} time={false} /><span>; the registration is still confirmed.</span></span>
                    ) : (
                      <span>Not derived yet</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-end">
                    {u.mapped && u.withdrawnAt ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/exams/entries?series=${series.id}&student=${u.studentId}` as never}>Enter it again by hand</Link>
                      </Button>
                    ) : u.mapped ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={passed || derive.isPending}
                        onClick={() => derive.mutate(u.studentId)}
                      >
                        {derive.isPending && derive.variables === u.studentId ? 'Working…' : 'Derive the entries'}
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="outline"><Link href="/exams/catalogue">Map it on the Catalogue</Link></Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {passed && <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">The entry deadline has passed: no new entry can be made for this series.</p>}
        </div>
      )}
    </section>
  );
}
