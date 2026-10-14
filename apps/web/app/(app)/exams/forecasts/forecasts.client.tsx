'use client';

/**
 * Forecast grades (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §2).
 *
 * The spreadsheet version: the coordinator emails each teacher a list of
 * their candidates a fortnight before the board's date, the teachers reply
 * with grades in the body of an email (or on paper), the coordinator types
 * them into the board's portal, and chases whoever has not answered — while
 * a grade typed as "a" or "A" or "7" is whatever the reader thinks it is.
 *
 * Here: each teacher opens one page listing only the candidates they teach,
 * grouped by series and subject, with the board's due date and the days
 * left; they type a grade and move on (it saves as they leave the box or
 * press Enter, and a grade the boards do not use is refused on the spot).
 * The coordinator sees every entry, who gave each grade and how many are
 * still missing, and marks a series' forecasts as sent in one step; what the
 * board fixes from then on is shown fixed. Large inputs and one column on a
 * narrow screen, for a teacher on a tablet.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACADEMIC_ROLES, hasRole } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { MaybeDate } from '../exams-shared';
import { EXAMS_KEY, BoardText, Code, fetchBoardRules, fetchEntries, fetchForecasts, type ForecastRow } from '../exam-f4-shared';
import { DaysLeftBadge, Dialog, FlashNotice, setForecast, submitForecasts, type Flash } from '../entries/entries-shared';

export default function ForecastsClient({ viewerRole }: { viewerRole: string }): React.JSX.Element {
  const academic = hasRole(viewerRole, ...ACADEMIC_ROLES);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const seriesParam = params.get('series');
  const [missingOnly, setMissingOnly] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...EXAMS_KEY, 'forecasts', seriesParam ?? 'current'],
    queryFn: () => fetchForecasts(seriesParam ?? undefined),
    // A refusal (no teacher record) says what to do at once; "Try again" is on the error state.
    retry: false,
  });
  const rows = useMemo(() => data ?? [], [data]);

  // Who gave each grade: the entries say, for the coordinator and the admin (a teacher cannot read them).
  const seriesIds = useMemo(() => [...new Set(rows.map((r) => r.boardSeriesId))], [rows]);
  const entryQueries = useQueries({
    queries: seriesIds.map((id) => ({
      queryKey: [...EXAMS_KEY, 'entries', { boardSeriesId: id, includeWithdrawn: 'false' as const }],
      queryFn: () => fetchEntries({ boardSeriesId: id, includeWithdrawn: 'false' }),
      enabled: academic,
    })),
  });
  const givenBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const q of entryQueries) for (const e of q.data ?? []) if (e.forecastByName) m.set(e.id, e.forecastByName);
    return m;
  }, [entryQueries]);

  const groups = useMemo(() => {
    const bySeries = new Map<string, ForecastRow[]>();
    for (const r of rows) bySeries.set(r.boardSeriesId, [...(bySeries.get(r.boardSeriesId) ?? []), r]);
    return [...bySeries.values()].map((list) => {
      const bySubject = new Map<string, ForecastRow[]>();
      for (const r of list) bySubject.set(r.subjectName ?? '', [...(bySubject.get(r.subjectName ?? '') ?? []), r]);
      return { first: list[0]!, all: list, subjects: [...bySubject.entries()] };
    });
  }, [rows]);

  const everySeries = () => {
    const next = new URLSearchParams(params.toString());
    next.delete('series');
    router.replace(`${pathname}${next.size ? `?${next.toString()}` : ''}` as Route, { scroll: false });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 animate-fade-up">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Forecast grades</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {academic
              ? 'Every entry whose board asks for a forecast grade, by series and subject. Teachers give their own candidates\' grades; you can give any of them.'
              : 'The forecast grades the boards ask for, for the candidates you teach. Type a grade and move on: it is saved when you leave the box or press Enter.'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">A*–G or U; a–e for a Cambridge AS Level; 9–1 for a numbered IGCSE.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} className="size-5" />
          <span>Only the missing ones</span>
        </label>
      </header>

      {seriesParam && (
        <p className="mb-4 text-sm">
          <button type="button" onClick={everySeries} className="font-medium text-primary underline-offset-2 hover:underline">Show every series still to sit</button>
        </p>
      )}

      <FlashNotice flash={flash} onClose={() => setFlash(null)} />

      {isLoading ? (
        <LoadingState label="Loading the forecast grades…" />
      ) : isError ? (
        <ErrorState title="The forecast grades did not load" message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={academic ? 'No entry asks for a forecast grade' : 'No forecast grades to give'}
          message={academic
            ? 'Entries with a board that requires forecast grades (Cambridge) appear here once they are made on the Entries page.'
            : 'None of your candidates is entered with a board that asks for forecast grades yet. They appear here once the coordinator has made the entries.'}
          action={academic ? <Button asChild variant="outline"><Link href="/exams/entries">Entries</Link></Button> : undefined}
        />
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <SeriesGroup key={g.first.boardSeriesId} group={g} academic={academic} missingOnly={missingOnly} givenBy={givenBy} onFlash={setFlash} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── One series ──────────────────────────────────────────────────────────────

function SeriesGroup({
  group, academic, missingOnly, givenBy, onFlash,
}: {
  group: { first: ForecastRow; all: ForecastRow[]; subjects: [string, ForecastRow[]][] };
  academic: boolean;
  missingOnly: boolean;
  givenBy: Map<string, string>;
  onFlash: (f: Flash) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { first, all } = group;
  const given = all.filter((r) => r.forecastGrade).length;
  const missing = all.filter((r) => r.required && !r.forecastGrade && !r.locked).length;
  const fixed = all.filter((r) => r.locked).length;
  const isMissing = (r: ForecastRow) => r.required && !r.forecastGrade && !r.locked;

  return (
    <section aria-label={first.seriesName}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-border pb-2">
        <div>
          <h2 className="font-display text-lg font-bold text-foreground"><BoardText>{first.seriesName}</BoardText></h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span>Due to the board</span>
              {first.forecastGradesDue ? <><MaybeDate date={first.forecastGradesDue} /> <DaysLeftBadge date={first.forecastGradesDue} /></> : <span>— date not recorded</span>}
            </span>
            <span>
              <span className="tabular-nums font-semibold text-foreground">{given}</span> <span>given</span>
              {' · '}
              <span className={cn('tabular-nums font-semibold', missing ? 'text-amber-700 dark:text-amber-400' : 'text-foreground')}>{missing}</span> <span>missing</span>
              {fixed > 0 && <>{' · '}<span className="tabular-nums font-semibold text-foreground">{fixed}</span> <span>sent to the board</span></>}
            </span>
          </p>
        </div>
        {academic && (
          <Button type="button" variant="outline" onClick={() => setConfirming(true)} disabled={!given || given === fixed}>
            Mark forecasts as sent to the board
          </Button>
        )}
      </div>

      <div className="space-y-5">
        {group.subjects.map(([subject, list]) => {
          const shown = missingOnly ? list.filter(isMissing) : list;
          if (!shown.length) return null;
          const teachers = [...new Set(list.map((r) => r.teacherName).filter(Boolean))];
          return (
            <div key={subject || 'none'} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-muted px-4 py-2">
                <h3 className="font-semibold text-foreground">{subject ? <BoardText>{subject}</BoardText> : <span>Added by hand</span>}</h3>
                {academic && teachers.length > 0 && (
                  <p className="text-xs text-muted-foreground"><span>Teacher:</span> <bdi data-i18n-skip="true">{teachers.join(', ')}</bdi></p>
                )}
              </div>
              <ul className="divide-y divide-border">
                {shown.map((r) => (
                  <Fragment key={r.entryId}>
                    <ForecastLine row={r} givenBy={givenBy.get(r.entryId) ?? null} />
                  </Fragment>
                ))}
              </ul>
            </div>
          );
        })}
        {missingOnly && missing === 0 && (
          <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground shadow-sm">Every forecast grade in this series is given.</p>
        )}
      </div>

      {confirming && (
        <SubmitDialog
          boardSeriesId={first.boardSeriesId}
          boardCode={first.boardCode}
          seriesName={first.seriesName}
          given={given - fixed}
          missing={missing}
          onClose={() => setConfirming(false)}
          onDone={(f) => { setConfirming(false); onFlash(f); }}
        />
      )}
    </section>
  );
}

// ─── One forecast ────────────────────────────────────────────────────────────

function ForecastLine({ row, givenBy }: { row: ForecastRow; givenBy: string | null }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(row.forecastGrade ?? '');
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string }>({ kind: 'idle' });

  const inputId = `forecast-${row.entryId}`;
  // Someone else's change shows here, unless this box is being typed in; a refused grade stays for the teacher to see.
  useEffect(() => {
    if (document.activeElement?.id !== inputId) setValue(row.forecastGrade ?? '');
  }, [row.forecastGrade, inputId]);

  const save = useMutation({
    mutationFn: (grade: string | null) => setForecast(row.entryId, grade),
    onSuccess: (entry) => {
      setValue(entry.forecastGrade ?? '');
      setState({ kind: 'saved' });
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
    },
    onError: (err: Error) => setState({ kind: 'error', message: err.message }),
  });

  const commit = () => {
    const next = value.trim();
    if (next === (row.forecastGrade ?? '') && state.kind !== 'error') return;
    if (!next && !row.forecastGrade) { setState({ kind: 'idle' }); return; }
    save.mutate(next || null);
  };

  return (
    <li className="grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(11rem,auto)]">
      <div className="min-w-0">
        <label htmlFor={inputId} className="block font-medium text-foreground"><bdi data-i18n-skip="true">{row.studentName}</bdi></label>
        <p className="text-xs text-muted-foreground">
          <Code>{row.entryCode}</Code> <BoardText>{row.title}</BoardText>
          {row.selfStudy && <> · <span>Self-study</span></>}
        </p>
      </div>
      <div>
        {row.locked ? (
          <span className="inline-flex h-12 min-w-20 items-center justify-center rounded-lg border border-border bg-muted px-3 font-mono text-lg font-semibold text-foreground" data-i18n-skip="true">
            {row.forecastGrade ?? '—'}
          </span>
        ) : (
          <Input
            id={inputId}
            data-forecast-input="true"
            value={value}
            onChange={(e) => { setValue(e.target.value); if (state.kind !== 'idle') setState({ kind: 'idle' }); }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const inputs = [...document.querySelectorAll<HTMLInputElement>('[data-forecast-input="true"]')];
              const next = inputs[inputs.indexOf(e.currentTarget) + 1];
              if (next) next.focus(); else e.currentTarget.blur();
            }}
            maxLength={2}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
            placeholder="—"
            aria-invalid={state.kind === 'error' || undefined}
            aria-describedby={`${inputId}-state`}
            disabled={save.isPending}
            className="h-12 w-20 text-center font-mono text-lg font-semibold"
            dir="ltr"
          />
        )}
      </div>
      <div id={`${inputId}-state`} className="text-sm" aria-live="polite">
        {row.locked ? (
          <Badge tone="info">Sent to the board: fixed</Badge>
        ) : save.isPending ? (
          <span className="text-muted-foreground">Saving…</span>
        ) : state.kind === 'error' ? (
          <span className="text-destructive">{state.message}</span>
        ) : state.kind === 'saved' ? (
          <span className="text-emerald-700 dark:text-emerald-400">Saved</span>
        ) : row.forecastGrade ? (
          givenBy ? <span className="text-muted-foreground"><span>Given by</span> <bdi data-i18n-skip="true">{givenBy}</bdi></span> : <span className="text-muted-foreground">Given</span>
        ) : !row.required ? (
          <span className="text-muted-foreground">Not asked for (self-study)</span>
        ) : (
          <Badge tone="warning">Missing</Badge>
        )}
      </div>
    </li>
  );
}

// ─── Marking a series' forecasts as sent ─────────────────────────────────────

function SubmitDialog({
  boardSeriesId, boardCode, seriesName, given, missing, onClose, onDone,
}: { boardSeriesId: string; boardCode: string; seriesName: string; given: number; missing: number; onClose: () => void; onDone: (f: Flash) => void }) {
  const queryClient = useQueryClient();
  const { data: rules } = useQuery({ queryKey: [...EXAMS_KEY, 'board-rules'], queryFn: fetchBoardRules });
  const rule = rules?.find((r) => r.boardCode === boardCode);
  const [error, setError] = useState('');
  const send = useMutation({
    mutationFn: () => submitForecasts(boardSeriesId),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
      const lines = [r.locked === 1 ? '1 forecast grade is recorded as sent.' : `${r.locked} forecast grades are recorded as sent.`];
      if (r.missing) lines.push(r.missing === 1 ? '1 is still missing and stays flagged on the entry list.' : `${r.missing} are still missing and stay flagged on the entry list.`);
      onDone({ tone: r.missing ? 'warning' : 'success', title: 'Forecasts marked as sent to the board.', lines });
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <Dialog title="Mark the forecasts as sent to the board" onClose={onClose} busy={send.isPending}>
      <div className="space-y-3 text-sm">
        <p className="font-medium text-foreground"><BoardText>{seriesName}</BoardText></p>
        <p className="text-foreground">{given === 1 ? '1 forecast grade will be recorded as sent.' : `${given} forecast grades will be recorded as sent.`}</p>
        {rule?.forecastLockedOnSubmit ? (
          <Notice tone="warning">
            <BoardText>{rule.boardName}</BoardText> <span>fixes each forecast grade from then on: a change after it is refused, here and at the board.</span>
          </Notice>
        ) : rule ? (
          <p className="text-muted-foreground">This board still takes a change to a forecast grade after it is sent.</p>
        ) : null}
        {missing > 0 && (
          <p className="text-amber-700 dark:text-amber-400">
            {missing === 1 ? '1 forecast grade is still missing: it stays flagged on the entry list.' : `${missing} forecast grades are still missing: they stay flagged on the entry list.`}
          </p>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={send.isPending}>Cancel</Button>
          <Button type="button" className="flex-1" disabled={send.isPending} onClick={() => { setError(''); send.mutate(); }}>
            {send.isPending ? 'Working…' : 'Mark as sent'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
