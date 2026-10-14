'use client';

/**
 * The exam deadlines dashboard (FEATURES_PLAN.md F4, "A deadlines dashboard
 * across all series"; DISCOVERY.md A-08, the hard stop).
 *
 * The spreadsheet version: each board's key-dates PDF printed and pinned by
 * the coordinator's desk, the dates copied into a wall calendar or a sheet
 * with a tab per board, and the entry deadline's time of day nowhere at all.
 * To know what is still to do before a date, the coordinator opens the
 * registrations sheet and counts who has no entry, scans the forecast column
 * for blanks, asks finance who has not paid, and checks the learning-support
 * emails for approvals — for every series, every time.
 *
 * Here: every date of every board's series on one page, in date order, grouped
 * by month, today marked, with the days left or how long ago it passed. The
 * entry deadline carries its time: it is the school's hard stop, after which
 * nothing more is entered, paid or confirmed. Each date says what is still
 * outstanding, counted live (drafts not sent, registrations with no entry,
 * forecasts missing, arrangements without approval, the timetable, results,
 * certificates), with a link to the screen that fixes it. The next 30 days sit
 * on top; passed dates are dimmed; one click narrows it to one board; and a
 * series with no entry deadline — nothing stops entries for it — is called out.
 */

import Link from 'next/link';
import type { Route } from 'next';
import { Fragment, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { DateText, MONTHS } from '../../academic/calendar/academic-shared';
import { EXAMS_KEY, fetchDeadlines, BoardText, PrintButton, type DeadlinesData } from '../exam-f4-shared';
import { SeriesWords } from '../candidates/series-words';

type Item = DeadlinesData['items'][number];
type Field = Item['field'];

const FOCUS_DAYS = 30;

/** The screen that fixes what a date still needs. */
const ENTRIES = { path: '/exams/entries', label: 'Open entries' };
const TIMETABLE = { path: '/exams/timetable', label: 'Open the timetable' };
const FIX: Partial<Record<Field, { path: string; label: string }>> = {
  entryDeadline: ENTRIES,
  estimatedEntriesDue: ENTRIES,
  retakeDeadline: ENTRIES,
  lateFeeFrom: ENTRIES,
  highLateFeeFrom: ENTRIES,
  lateEntriesClose: ENTRIES,
  forecastGradesDue: { path: '/exams/forecasts', label: 'Open forecasts' },
  accessArrangementsDue: { path: '/exams/candidates', label: 'Open candidates' },
  examsStart: TIMETABLE,
  examsEnd: TIMETABLE,
  resultsOn: { path: '/exams/results', label: 'Open results' },
  certificatesOn: { path: '/exams/certificates', label: 'Open certificates' },
};

const itemKey = (i: Item) => `${i.boardSeriesId}-${i.field}`;

/** The hard stop's time of day, as the school reads it (Cairo). */
function cairoTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Cairo' });
}

export default function DeadlinesClient(): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const board = params.get('board') ?? '';
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...EXAMS_KEY, 'deadlines'],
    queryFn: fetchDeadlines,
  });

  const setBoard = (code: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (code) next.set('board', code);
    else next.delete('board');
    const qs = next.toString();
    router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, { scroll: false });
  };

  const boards = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of data?.items ?? []) m.set(i.boardCode, i.boardName);
    return [...m.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const boardName = boards.find((b) => b.code === board)?.name ?? null;
  const items = useMemo(() => (data?.items ?? []).filter((i) => !board || i.boardCode === board), [data, board]);
  const focus = items.filter((i) => !i.passed && i.daysLeft <= FOCUS_DAYS);
  const focusWithWork = focus.filter((i) => i.outstanding.length > 0).length;
  const withoutDeadline = (data?.seriesWithoutDeadline ?? []).filter((s) => !boardName || s.name.startsWith(boardName));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 animate-fade-up">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Exam deadlines</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Every date the boards set for every series, in date order, with what the school still has to do for it. The entry deadline is the school&apos;s hard stop: after it, nothing more is entered, paid or confirmed for that series.
          </p>
        </div>
        <PrintButton />
      </header>

      {data && boards.length > 1 && (
        <div role="group" aria-label="Board" className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
          <BoardChip active={!board} onClick={() => setBoard(null)}><span>All boards</span></BoardChip>
          {boards.map((b) => (
            <BoardChip key={b.code} active={board === b.code} onClick={() => setBoard(b.code)}><BoardText>{b.name}</BoardText></BoardChip>
          ))}
        </div>
      )}

      {withoutDeadline.length > 0 && (
        <Notice tone="warning" className="mb-6" title="Series without an entry deadline">
          <p>Nothing stops entries or payments for these series until the admin sets their entry deadline:</p>
          <ul className="mt-1 list-disc ps-5">
            {withoutDeadline.map((s) => <li key={s.id}><SeriesWords name={s.name} /></li>)}
          </ul>
          <Link href="/exams/series" className="mt-2 inline-block font-semibold underline underline-offset-2 print:hidden">Open Board series</Link>
        </Notice>
      )}

      {isLoading ? (
        <LoadingState label="Loading the deadlines…" />
      ) : isError || !data ? (
        <ErrorState title="The deadlines did not load" message={error instanceof Error ? error.message : 'This is a connection problem, not an empty calendar. Try again.'} onRetry={() => refetch()} />
      ) : !data.items.length ? (
        <EmptyState
          title="No board dates from the last 30 days on"
          message="Type each series' dates from the board's key-dates document on the Board series page; they appear here with what is still to do."
          action={<Link href="/exams/series" className="font-semibold text-primary underline-offset-4 hover:underline">Open Board series</Link>}
        />
      ) : (
        <>
          <section className="mb-8" aria-labelledby="focus-title">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="focus-title" className="font-display text-lg font-bold text-foreground">Next 30 days</h2>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">{focus.length}</span> <span>{focus.length === 1 ? 'date' : 'dates'}</span>
                {' · '}
                <span className={cn('font-semibold tabular-nums', focusWithWork ? 'text-amber-700 dark:text-amber-400' : 'text-foreground')}>{focusWithWork}</span>{' '}
                <span>with something still to do</span>
              </p>
            </div>
            {focus.length === 0 ? (
              <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">Nothing is due in the next 30 days.</p>
            ) : (
              <DeadlineTable items={focus} today={data.today} />
            )}
          </section>

          <section aria-labelledby="all-title">
            <h2 id="all-title" className="mb-2 font-display text-lg font-bold text-foreground">Every date, by month</h2>
            <p className="mb-3 text-sm text-muted-foreground">From 30 days ago on. Passed dates are dimmed.</p>
            {items.length === 0 ? (
              <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground shadow-sm">No dates for this board.</p>
            ) : (
              <DeadlineTable items={items} today={data.today} byMonth />
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function BoardChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-9 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

/** Days left, today, or how long ago — the passed ones quiet, the near ones loud. */
function When({ item }: { item: Item }) {
  const d = item.daysLeft;
  if (item.passed) {
    if (d >= 0) return <Badge tone="danger">Passed today</Badge>;
    return <Badge tone="neutral">{d === -1 ? 'Yesterday' : `${-d} days ago`}</Badge>;
  }
  if (d <= 0) return <Badge tone="danger">Today</Badge>;
  if (d === 1) return <Badge tone={item.hardStop ? 'danger' : 'warning'}>Tomorrow</Badge>;
  return <Badge tone={d <= 14 ? (item.hardStop ? 'danger' : 'warning') : 'neutral'}>{`In ${d} days`}</Badge>;
}

function DeadlineTable({ items, today, byMonth = false }: { items: Item[]; today: string; byMonth?: boolean }) {
  // Where today falls in the list: before the first date not yet behind us.
  const todayAt = byMonth ? items.findIndex((i) => i.date >= today) : -1;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
      <table className="w-full min-w-[960px] text-sm">
        <thead className="border-b border-border bg-muted">
          <tr>
            <th scope="col" className="w-44 px-3 py-2 text-start font-semibold text-muted-foreground">Date</th>
            <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">What the date is</th>
            <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Series</th>
            <th scope="col" className="w-32 px-3 py-2 text-start font-semibold text-muted-foreground">When</th>
            <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Still to do</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item, i) => {
            const month = item.date.slice(0, 7);
            const newMonth = byMonth && (i === 0 || items[i - 1]!.date.slice(0, 7) !== month);
            const [y, m] = month.split('-').map(Number);
            return (
              <Fragment key={itemKey(item)}>
                {newMonth && (
                  <tr className="bg-muted/60">
                    <th scope="colgroup" colSpan={5} className="px-3 py-2 text-start font-display text-sm font-bold text-foreground">
                      <span>{MONTHS[(m ?? 1) - 1]}</span> <span dir="ltr">{y}</span>
                    </th>
                  </tr>
                )}
                {i === todayAt && <TodayMarker today={today} />}
                <DeadlineRow item={item} />
              </Fragment>
            );
          })}
          {byMonth && todayAt === -1 && <TodayMarker today={today} />}
        </tbody>
      </table>
    </div>
  );
}

function TodayMarker({ today }: { today: string }) {
  return (
    <tr aria-label="Today">
      <td colSpan={5} className="border-y-2 border-primary bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary">
        <span>Today</span> · <DateText date={today} weekday />
      </td>
    </tr>
  );
}

function DeadlineRow({ item }: { item: Item }) {
  const fix = FIX[item.field];
  const isToday = item.daysLeft === 0;
  return (
    <tr id={itemKey(item)} className={cn('align-top', item.passed && 'opacity-60', !item.passed && isToday && 'bg-primary/5')}>
      <td className="px-3 py-2.5 text-foreground">
        <DateText date={item.date} weekday className="font-medium" />
        {item.hardStop && item.at && (
          <p className="mt-1 flex flex-wrap items-center gap-1">
            <Badge tone="danger">Hard stop</Badge>
            <span className="text-xs font-semibold tabular-nums" dir="ltr">{cairoTime(item.at)}</span>
          </p>
        )}
      </td>
      <td className="px-3 py-2.5">
        <p className={cn('text-foreground', item.hardStop && 'font-semibold')}>{item.label}</p>
        {item.hardStop && <p className="text-xs text-muted-foreground">After this time nothing more is entered, paid or confirmed for the series.</p>}
      </td>
      <td className="px-3 py-2.5 text-foreground"><SeriesWords name={item.seriesName} /></td>
      <td className="px-3 py-2.5"><When item={item} /></td>
      <td className="px-3 py-2.5">
        {item.outstanding.length > 0 ? (
          <ul className="space-y-0.5">
            {item.outstanding.map((o) => <li key={o} className="text-amber-700 dark:text-amber-400">{o}</li>)}
          </ul>
        ) : item.passed ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Badge tone="success">Nothing outstanding</Badge>
        )}
        {fix && (item.outstanding.length > 0 || !item.passed) && (
          <Link
            href={`${fix.path}?series=${encodeURIComponent(item.boardSeriesId)}` as Route}
            className="mt-1 block w-fit text-xs font-semibold text-primary underline-offset-4 hover:underline print:hidden"
          >
            {fix.label}
          </Link>
        )}
      </td>
    </tr>
  );
}
