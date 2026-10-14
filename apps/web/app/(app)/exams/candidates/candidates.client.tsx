'use client';

/**
 * The candidate register (FEATURES_PLAN.md F4, "Candidates";
 * docs/features/EXAM_ENTRIES.md §1).
 *
 * The spreadsheet version: a "candidates" sheet beside the registrations
 * sheet — a row per student with the name retyped from a photocopied passport
 * or national ID, the date of birth, the gender, Pearson's UCI copied from
 * last year's statement of entry, one column of candidate numbers per series,
 * the access arrangements in an email from learning support, and the national
 * ID numbers in a column anyone who opens the file can read. Before each
 * board's entries the coordinator filters every column for blanks one at a
 * time, and numbers a new series by scanning last series' column for each
 * candidate's old number, then counting up for the next free one.
 *
 * Here: one table, searched by name, student ID, UCI, email or legal name as
 * you type (Enter opens the first match); every gap a board would refuse is
 * one click with its count beside it ("No UCI 2"), so nobody has to remember
 * which columns to check. A row opens in place to fix it and saving says what
 * was saved. A recorded UCI changes only with a reason. The ID document shows
 * its type and last four characters; the number itself shows for 30 seconds
 * when asked for, and each look is recorded. For a chosen series, "Assign
 * candidate numbers" keeps each candidate's number from the board's last
 * series where it is free and gives the rest the lowest free ones — shown
 * before anything is saved. The filters live in the address, so Back, a link
 * from the deadlines dashboard or a bookmark lands on the same list.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACCESS_ARRANGEMENT_LABELS, CANDIDATE_MISSING, GENDER_LABELS, ID_DOCUMENT_TYPE_LABELS, schoolDateString,
  type AccessArrangement, type IdDocumentType,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge } from '~/components/ui/tone';
import { downloadCsv, toCsv } from '~/lib/csv';
import { cn } from '~/lib/utils';
import { DateText } from '../../academic/calendar/academic-shared';
import { SELECT_CLASS } from '../exams-shared';
import { EXAMS_KEY, fetchCandidates, Code, useSeriesChoice, type CandidateRow } from '../exam-f4-shared';
import { CandidatePanel } from './candidate-panel.client';
import { AssignNumbers } from './assign-numbers.client';
import { SeriesWords } from './series-words';

type Missing = (typeof CANDIDATE_MISSING)[number];
type ListQuery = { search?: string; boardSeriesId?: string };

/** The chips' words: what the boards would still refuse. */
const MISSING_LABELS: Record<Missing, string> = {
  legal_name: 'No legal name',
  date_of_birth: 'No date of birth',
  gender: 'No gender',
  uci: 'No UCI',
  candidate_number: 'No candidate number',
  national_id: 'No ID document',
};

const listKey = (q: ListQuery) => [...EXAMS_KEY, 'candidates', q] as const;

export default function CandidatesClient(): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);
  const { series } = useSeriesChoice();

  const q = params.get('q') ?? '';
  const seriesId = params.get('series') ?? '';
  const missingParam = params.get('missing') ?? '';
  const missing = (CANDIDATE_MISSING as readonly string[]).includes(missingParam) ? (missingParam as Missing) : null;
  const openId = params.get('student');
  const [search, setSearch] = useState(q);

  /** Change the filters in the address (null removes one). */
  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, { scroll: false });
  };

  // Back and Forward change the address: the box follows it (never overwriting what is being typed).
  const pushedQ = useRef(q);
  useEffect(() => {
    if (q !== pushedQ.current) {
      pushedQ.current = q;
      setSearch(q);
    }
  }, [q]);

  // Typing filters as you type, a quarter of a second after the last key.
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === q) return;
    const t = setTimeout(() => {
      // Enter got there first (it pushes the search with the candidate it opens).
      if (pushedQ.current === trimmed) return;
      pushedQ.current = trimmed;
      setParams({ q: trimmed || null });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query: ListQuery = { search: q || undefined, boardSeriesId: seriesId || undefined };
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: listKey(query),
    queryFn: () => fetchCandidates(query),
    placeholderData: keepPreviousData,
  });

  const all = useMemo(() => data?.candidates ?? [], [data]);
  const counts = useMemo(
    () => Object.fromEntries(CANDIDATE_MISSING.map((m) => [m, all.filter((c) => c.missing.includes(m)).length])) as Record<Missing, number>,
    [all],
  );
  const rows = useMemo(() => (missing ? all.filter((c) => c.missing.includes(missing)) : all), [all, missing]);
  const chips = CANDIDATE_MISSING.filter((m) => m !== 'candidate_number' || !!seriesId);
  const chosenSeries = series.find((s) => s.id === seriesId) ?? null;
  const openRow = openId ? all.find((c) => c.studentId === openId) ?? null : null;

  const open = (id: string | null) => setParams({ student: id });

  const rowButtons = () => Array.from(tableRef.current?.querySelectorAll<HTMLButtonElement>('button[data-row-button]') ?? []);
  const onSearchKey = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      rowButtons()[0]?.focus();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const term = search.trim();
    let list: CandidateRow[] = rows;
    if (term !== q) {
      // The address has not caught up with the box yet: ask for exactly this search, then open its first match.
      pushedQ.current = term;
      const answer = await queryClient.fetchQuery({
        queryKey: listKey({ search: term || undefined, boardSeriesId: seriesId || undefined }),
        queryFn: () => fetchCandidates({ search: term || undefined, boardSeriesId: seriesId || undefined }),
      });
      list = missing ? answer.candidates.filter((c) => c.missing.includes(missing)) : answer.candidates;
    }
    setParams({ q: term || null, student: list[0]?.studentId ?? null });
  };
  const onRowKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const buttons = rowButtons();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[i + 1]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (i === 0 ? searchRef.current : buttons[i - 1])?.focus();
    } else if (e.key === 'Escape') {
      searchRef.current?.focus();
    }
  };

  const download = () => {
    const headers = [
      'Name', 'Student ID', 'Surname (as on ID)', 'Forenames (as on ID)', 'Date of birth', 'Gender', 'UCI',
      'Access arrangements', 'Approval reference', 'Approval expires', 'ID document recorded',
      ...(chosenSeries ? ['Candidate number'] : []), 'Still needed',
    ];
    const lines = rows.map((c) => [
      c.name, c.studentCode ?? '', c.legalSurname ?? '', c.legalForenames ?? '', c.dateOfBirth ?? '',
      c.gender ? GENDER_LABELS[c.gender as keyof typeof GENDER_LABELS] ?? c.gender : '', c.uci ?? '',
      c.accessArrangements.map((a) => ACCESS_ARRANGEMENT_LABELS[a as AccessArrangement] ?? a).join('; '),
      c.accessArrangementsRef ?? '', c.accessArrangementsUntil ?? '', c.hasIdDocument ? 'Y' : 'N',
      ...(chosenSeries ? [c.candidateNumber ?? ''] : []),
      c.missing.map((m) => MISSING_LABELS[m as Missing] ?? m).join('; '),
    ]);
    const tag = chosenSeries ? chosenSeries.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() : 'all';
    downloadCsv(`candidates-${tag}-${schoolDateString(new Date())}.csv`, toCsv(headers, lines));
  };

  const columns = seriesId ? 9 : 8;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 animate-fade-up">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Candidates</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            What the exam boards ask of each candidate: the name exactly as on the ID, date of birth, gender, Pearson&apos;s UCI, access arrangements, the ID document and a candidate number in each series. Fix the gaps before the entry deadline.
          </p>
        </div>
        {data && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            <span className="font-semibold tabular-nums text-foreground">{rows.length}</span> <span>{rows.length === 1 ? 'candidate' : 'candidates'}</span>
            {isFetching && <span className="ms-2">…</span>}
          </p>
        )}
      </header>

      {/* Search and filters */}
      <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Label htmlFor="candidate-search" className="mb-1 text-xs text-muted-foreground">Search</Label>
            <input
              id="candidate-search"
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Name, student ID, UCI, email or legal name"
              autoComplete="off"
              autoFocus
              // The page translator records the placeholder on the element before hydration.
              suppressHydrationWarning
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <Label htmlFor="candidate-series" className="mb-1 text-xs text-muted-foreground">Board series</Label>
            <select
              id="candidate-series"
              value={seriesId}
              onChange={(e) => setParams({ series: e.target.value || null, missing: !e.target.value && missing === 'candidate_number' ? null : missing })}
              className={cn(SELECT_CLASS, 'min-w-72 font-semibold')}
            >
              <option value="">All candidates</option>
              {series.map((s) => (
                <option key={s.id} value={s.id} data-i18n-skip="true">{s.name}</option>
              ))}
            </select>
          </div>
          <Button type="button" variant="outline" onClick={download} disabled={!rows.length}>Download CSV</Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Enter opens the first candidate; the arrow keys move through the list.</p>

        <div role="group" aria-label="What the boards still need" className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Still needed:</span>
          <Chip active={!missing} onClick={() => setParams({ missing: null })} label="Everyone" count={all.length} tone="neutral" />
          {chips.map((m) => (
            <Chip
              key={m}
              active={missing === m}
              onClick={() => setParams({ missing: missing === m ? null : m })}
              label={MISSING_LABELS[m]}
              count={counts[m] ?? 0}
              tone={(counts[m] ?? 0) > 0 ? 'warning' : 'success'}
            />
          ))}
        </div>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        {chosenSeries ? (
          <>
            <span>Candidates entered in this series or with a confirmed registration in it, with their candidate number there:</span>{' '}
            <SeriesWords name={chosenSeries.name} className="font-semibold text-foreground" />
          </>
        ) : (
          <span>Every student in grades 10 to 12 today, and anyone else with an exam entry. Choose a series to see and assign candidate numbers.</span>
        )}
      </p>

      {chosenSeries && <AssignNumbers key={chosenSeries.id} seriesId={chosenSeries.id} seriesName={chosenSeries.name} />}

      {openId && data && !openRow && (
        <div className="mb-4">
          <CandidatePanel studentId={openId} row={null} series={series} chosenSeriesId={seriesId || null} onClose={() => open(null)} />
        </div>
      )}

      {isLoading ? (
        <LoadingState label="Loading the candidates…" />
      ) : isError ? (
        <ErrorState title="The candidates did not load" message={error instanceof Error ? error.message : 'This is a connection problem, not an empty list. Try again.'} onRetry={() => refetch()} />
      ) : !rows.length ? (
        <EmptyState
          title={q || missing ? 'No candidate matches' : 'No candidates yet'}
          message={
            q || missing
              ? 'Clear the search or the filter to see everyone.'
              : chosenSeries
                ? 'Nobody is entered in this series or has a confirmed registration in it yet. Confirmed registrations appear here; so do entries added on the Entries screen.'
                : 'Students in grades 10 to 12 appear here once their grade is recorded on the Students screen.'
          }
          action={q || missing ? (
            <Button variant="outline" onClick={() => { setSearch(''); pushedQ.current = ''; setParams({ q: null, missing: null }); }}>Clear the filters</Button>
          ) : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Candidate</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Student ID</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Legal name as on ID</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Date of birth</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Gender</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">UCI</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Access arrangements</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">ID document</th>
                {seriesId && <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Candidate number</th>}
              </tr>
            </thead>
            <tbody ref={tableRef} className="divide-y divide-border">
              {rows.map((c, i) => (
                <CandidateTableRow
                  key={c.studentId}
                  c={c}
                  withNumber={!!seriesId}
                  columns={columns}
                  isOpen={openId === c.studentId}
                  onToggle={() => open(openId === c.studentId ? null : c.studentId)}
                  onKeyDown={(e) => onRowKey(e, i)}
                  panel={openId === c.studentId ? (
                    <CandidatePanel studentId={c.studentId} row={c} series={series} chosenSeriesId={seriesId || null} onClose={() => open(null)} />
                  ) : null}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function Chip({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count: number; tone: 'neutral' | 'warning' | 'success' }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-accent',
      )}
    >
      <span>{label}</span>
      <Badge tone={active ? 'neutral' : tone} className="px-2 tabular-nums">{count}</Badge>
    </button>
  );
}

function MissingBadge() {
  return <Badge tone="warning">Missing</Badge>;
}

function CandidateTableRow({
  c, withNumber, columns, isOpen, onToggle, onKeyDown, panel,
}: {
  c: CandidateRow; withNumber: boolean; columns: number; isOpen: boolean; onToggle: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void; panel: React.ReactNode;
}) {
  const today = schoolDateString(new Date());
  const hasLegal = !!(c.legalSurname || c.legalForenames);
  const expired = !!c.accessArrangementsUntil && c.accessArrangementsUntil < today;
  return (
    <>
      <tr onClick={onToggle} className={cn('cursor-pointer align-top hover:bg-muted/40', isOpen && 'bg-muted/40')}>
        <td className="px-3 py-2.5">
          <button
            type="button"
            data-row-button
            aria-expanded={isOpen}
            onKeyDown={onKeyDown}
            className="rounded text-start font-medium text-foreground outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <bdi data-i18n-skip="true">{c.name}</bdi>
          </button>
          <p className="text-xs text-muted-foreground">
            {c.grade !== null && <span>{`Grade ${c.grade}`}</span>}
            {c.leftOn && <> · <span>Left the school</span></>}
            {c.entryCount > 0 && (
              <> · <span className="tabular-nums">{c.entryCount}</span> <span>{c.entryCount === 1 ? 'exam entry' : 'exam entries'}</span></>
            )}
          </p>
        </td>
        <td className="px-3 py-2.5 text-muted-foreground">{c.studentCode ? <Code className="text-xs">{c.studentCode}</Code> : '—'}</td>
        <td className="px-3 py-2.5 text-foreground">
          {hasLegal ? (
            <span className="flex flex-wrap items-center gap-1">
              <bdi data-i18n-skip="true">{[c.legalSurname?.toUpperCase(), c.legalForenames].filter(Boolean).join(', ')}</bdi>
              {c.missing.includes('legal_name') && <MissingBadge />}
            </span>
          ) : <MissingBadge />}
        </td>
        <td className="px-3 py-2.5 text-foreground">{c.dateOfBirth ? <DateText date={c.dateOfBirth} /> : <MissingBadge />}</td>
        <td className="px-3 py-2.5 text-foreground">
          {c.gender ? <span>{GENDER_LABELS[c.gender as keyof typeof GENDER_LABELS] ?? c.gender}</span> : <MissingBadge />}
        </td>
        <td className="px-3 py-2.5 text-foreground">
          {c.uci ? <Code className="text-xs">{c.uci}</Code> : c.missing.includes('uci') ? <MissingBadge /> : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-3 py-2.5">
          {c.accessArrangements.length === 0 ? (
            <span className="text-muted-foreground">None</span>
          ) : (
            <div className="space-y-1">
              <span className="flex flex-wrap gap-1">
                {c.accessArrangements.map((a) => <Badge key={a} tone="info">{ACCESS_ARRANGEMENT_LABELS[a as AccessArrangement] ?? a}</Badge>)}
              </span>
              {!c.accessArrangementsRef ? (
                <Badge tone="warning">No board approval</Badge>
              ) : expired ? (
                <Badge tone="danger">Approval expired</Badge>
              ) : (
                <p className="text-xs text-muted-foreground"><span>Approved</span> <Code>{c.accessArrangementsRef}</Code></p>
              )}
            </div>
          )}
        </td>
        <td className="px-3 py-2.5">
          {c.hasIdDocument ? (
            <Badge tone="success">{ID_DOCUMENT_TYPE_LABELS[c.idDocumentType as IdDocumentType] ?? 'Recorded'}</Badge>
          ) : (
            <Badge tone="warning">Not recorded</Badge>
          )}
        </td>
        {withNumber && (
          <td className="px-3 py-2.5">{c.candidateNumber ? <Code className="font-semibold">{c.candidateNumber}</Code> : <MissingBadge />}</td>
        )}
      </tr>
      {isOpen && (
        <tr className="bg-muted/30">
          <td colSpan={columns} className="px-3 py-4">{panel}</td>
        </tr>
      )}
    </>
  );
}
