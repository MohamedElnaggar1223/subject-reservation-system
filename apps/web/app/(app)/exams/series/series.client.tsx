'use client';

/**
 * Board series and their dates (FEATURES_PLAN.md F0b).
 *
 * The spreadsheet version: the boards' key-dates PDFs are printed and
 * pinned by the coordinator's desk; the entry deadlines are copied by hand
 * into a sheet (and once into the registration window's settings); the
 * late-fee dates live in someone's memory; nobody can see which families
 * still owe money for a series whose deadline is next week.
 *
 * Here: every sitting of every board in one academic year, ordered by its
 * entry deadline, with the days left, the late-fee tiers beside it (shown,
 * never enforced), the windows that feed it and what its deadline will
 * close today (registrations still waiting, payments still open). A series
 * is one line to add (board, month; the year follows from the academic
 * year). Dates are typed once, in one form, per series. The entry deadline
 * is the admin's: past it the school closes every unconfirmed payment on
 * the series (MO-10), so it asks for a reason and says what it will do.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse, academicYearShortLabel, academicYearStartOf, seriesYearInAcademicYear, BOARD_SERIES_DATE_FIELDS,
  BOARD_SERIES_DATE_LABELS, ROLES, type BoardSeriesDateField, type UpdateBoardSeriesType,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import {
  fetchBoardSeries, useCatalogue, SERIES_KEY, MONTH_LABEL, SeriesName, InstantText, DeadlineBadge, MaybeDate, SELECT_CLASS,
  type BoardSeriesRow,
} from '../exams-shared';
import { InferredCheck } from './inferred.client';

const MONTHS = ['october', 'november', 'january', 'june'] as const;
type Month = (typeof MONTHS)[number];

/** A datetime-local value in the browser's clock, from an instant. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SeriesClient({ viewerRole }: { viewerRole: string }): React.JSX.Element {
  const isAdmin = viewerRole === ROLES.ADMIN;
  const [year, setYear] = useState(academicYearStartOf());
  const { data: series, isLoading, isError, refetch } = useQuery({ queryKey: [...SERIES_KEY, year], queryFn: () => fetchBoardSeries(year) });
  const [openId, setOpenId] = useState<string | null>(null);

  const next = useMemo(() => (series ?? []).find((s) => s.entryDeadline && !s.entryDeadlinePassed), [series]);
  const years = [year - 1, year, year + 1].filter((y, i, a) => a.indexOf(y) === i);
  const current = academicYearStartOf();

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-up">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Board series</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Every sitting of every board this academic year, with the dates the boards set. The entry deadline is the school&apos;s hard stop: past it, nothing more is entered, paid or confirmed for that series. Late-fee dates are shown for information.
          </p>
        </div>
        <div>
          <Label htmlFor="series-year" className="mb-1 text-xs text-muted-foreground">Academic year</Label>
          <select id="series-year" value={year} onChange={(e) => setYear(Number(e.target.value))} className={cn(SELECT_CLASS, 'w-36 font-semibold')}>
            {[...new Set([current - 1, current, current + 1, ...years])].sort().map((y) => (
              <option key={y} value={y}>{academicYearShortLabel(y)}</option>
            ))}
          </select>
        </div>
      </header>

      {next && (
        <Notice tone="warning" className="mb-6" title="Next entry deadline">
          <p>
            <SeriesName boardName={next.boardName} month={next.month} year={next.year} label={next.label} />
            {' · '}
            <InstantText iso={next.entryDeadline!} />
            {' · '}
            <DeadlineBadge iso={next.entryDeadline} />
          </p>
          <p className="mt-1">
            <span>It will close</span> <strong>{next.registrations.waiting}</strong> <span>registrations still waiting</span>
            {' · '}
            <strong>{next.openPayments}</strong> <span>payments still open</span>
          </p>
        </Notice>
      )}

      <InferredCheck />

      <AddSeriesRow year={year} />

      {isLoading ? (
        <LoadingState label="Loading the series…" />
      ) : isError ? (
        <ErrorState title="The series did not load" message="This is a connection problem, not an empty list. Try again." onRetry={() => refetch()} />
      ) : !series?.length ? (
        <EmptyState
          title="No board series this academic year yet"
          message="Add each board's sittings above — IAL October, International GCSE November, IAL January, June — then give each window the series it feeds on the Sessions page."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Series</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Entry deadline</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Late fee from</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">High late fee from</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Windows feeding it</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Registrations</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {series.map((s) => (
                <SeriesRow key={s.id} s={s} open={openId === s.id} onToggle={() => setOpenId(openId === s.id ? null : s.id)} isAdmin={isAdmin} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Adding a series ─────────────────────────────────────────────────────────

function AddSeriesRow({ year }: { year: number }) {
  const queryClient = useQueryClient();
  const { data: catalogue } = useCatalogue();
  const boards = catalogue?.boards ?? [];
  const [boardCode, setBoardCode] = useState('');
  const [month, setMonth] = useState<Month | ''>('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  const board = boards.find((b) => b.code === boardCode);
  const months = MONTHS.filter((m) => !board || board.seriesMonths.includes(m));
  const seriesYear = month ? seriesYearInAcademicYear(month, year) : null;

  const create = useMutation({
    mutationFn: () => apiResponse(api.v1['board-series'].$post({ json: { boardCode: boardCode as 'cambridge', month: month as Month, year: seriesYear!, label: label.trim() } })),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: SERIES_KEY });
      setAdded(`${board?.name ?? ''} ${MONTH_LABEL[s.month]} ${s.year}`);
      setMonth('');
      setLabel('');
      setError('');
    },
    onError: (err: Error) => { setAdded(null); setError(err.message); },
  });

  return (
    <form
      className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (!boardCode || !month) return setError('Choose the board and the month.');
        create.mutate();
      }}
    >
      <p className="mb-3 text-sm font-semibold text-foreground">Add a series</p>
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Board" className="flex flex-wrap gap-1">
          {boards.map((b) => (
            <button
              key={b.code}
              type="button"
              aria-pressed={boardCode === b.code}
              onClick={() => { setBoardCode(b.code); setMonth(''); }}
              className={cn(
                'h-10 rounded-lg border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                boardCode === b.code ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-accent',
              )}
            >
              {b.name}
            </button>
          ))}
        </div>
        <div>
          <Label htmlFor="add-series-month" className="mb-1 text-xs text-muted-foreground">Month</Label>
          <select id="add-series-month" value={month} onChange={(e) => setMonth(e.target.value as Month)} className={cn(SELECT_CLASS, 'w-40')} disabled={!boardCode}>
            <option value="">Choose…</option>
            {months.map((m) => (
              <option key={m} value={m}>{MONTH_LABEL[m]} {seriesYearInAcademicYear(m, year)}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="add-series-label" className="mb-1 text-xs text-muted-foreground">Label (only if the board runs two calendars that month)</Label>
          <Input id="add-series-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="e.g. IAL" className="w-56" />
        </div>
        <Button type="submit" disabled={create.isPending || !boardCode || !month}>{create.isPending ? 'Adding…' : 'Add the series'}</Button>
      </div>
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      {added && !error && (
        <p className="mt-3 text-xs text-muted-foreground">
          <span>Added</span> <bdi className="font-semibold text-foreground">{added}</bdi><span>. Open it below to type the board&apos;s dates.</span>
        </p>
      )}
    </form>
  );
}

// ─── One series ──────────────────────────────────────────────────────────────

function SeriesRow({ s, open, onToggle, isAdmin }: { s: BoardSeriesRow; open: boolean; onToggle: () => void; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const remove = useMutation({
    mutationFn: () => apiResponse(api.v1['board-series'][':id'].$delete({ param: { id: s.id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SERIES_KEY }),
    onError: (err: Error) => setError(err.message),
  });
  return (
    <>
      <tr className={cn(s.entryDeadlinePassed && 'bg-muted/40')}>
        <td className="px-3 py-2.5 font-medium text-foreground">
          <SeriesName boardName={s.boardName} month={s.month} year={s.year} label={s.label} />
          <p className="text-xs font-normal text-muted-foreground"><span>Academic year</span> <span dir="ltr">{s.academicYear}</span></p>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex flex-col items-start gap-1">
            {s.entryDeadline && <InstantText iso={s.entryDeadline} />}
            <DeadlineBadge iso={s.entryDeadline} />
          </div>
        </td>
        <td className="px-3 py-2.5 text-foreground"><MaybeDate date={s.lateFeeFrom} /></td>
        <td className="px-3 py-2.5 text-foreground"><MaybeDate date={s.highLateFeeFrom} /></td>
        <td className="px-3 py-2.5">
          {s.windows.length === 0 ? (
            <span className="text-muted-foreground">No window yet</span>
          ) : (
            <ul className="space-y-0.5">
              {s.windows.map((w) => (
                <li key={w.sessionId} className="flex flex-wrap items-center gap-1">
                  <bdi className="text-foreground">{w.name}</bdi>
                  {w.isDefault && <Badge tone="neutral">Default</Badge>}
                </li>
              ))}
            </ul>
          )}
        </td>
        <td className="px-3 py-2.5 text-foreground">
          <span className="tabular-nums">{s.registrations.confirmed}</span> <span className="text-muted-foreground">confirmed</span>
          {s.registrations.waiting > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400"><span className="tabular-nums">{s.registrations.waiting}</span> <span>waiting</span></p>
          )}
          {s.openPayments > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400"><span className="tabular-nums">{s.openPayments}</span> <span>payments open</span></p>
          )}
        </td>
        <td className="px-3 py-2.5 text-end">
          <div className="flex justify-end gap-1">
            <Button variant="outline" size="sm" onClick={onToggle} aria-expanded={open}>{open ? 'Close' : 'Dates'}</Button>
            {s.windows.length === 0 && (
              <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>
            )}
          </div>
        </td>
      </tr>
      {error && (
        <tr><td colSpan={7} className="px-3 pb-3"><Notice tone="danger">{error}</Notice></td></tr>
      )}
      {open && (
        <tr className="bg-muted/30">
          <td colSpan={7} className="px-3 py-4"><DatesForm s={s} isAdmin={isAdmin} onDone={onToggle} /></td>
        </tr>
      )}
    </>
  );
}

function DatesForm({ s, isAdmin, onDone }: { s: BoardSeriesRow; isAdmin: boolean; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [dates, setDates] = useState<Record<BoardSeriesDateField, string>>(
    () => Object.fromEntries(BOARD_SERIES_DATE_FIELDS.map((f) => [f, (s[f] as string | null) ?? ''])) as Record<BoardSeriesDateField, string>,
  );
  const [deadline, setDeadline] = useState(toLocalInput(s.entryDeadline));
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState(s.notes ?? '');
  const [error, setError] = useState('');
  const deadlineChanged = deadline !== toLocalInput(s.entryDeadline);

  const save = useMutation({
    mutationFn: () => {
      const json: UpdateBoardSeriesType = { notes: notes.trim() || null };
      for (const f of BOARD_SERIES_DATE_FIELDS) if ((dates[f] || null) !== (s[f] ?? null)) json[f] = dates[f] || null;
      if (isAdmin && deadlineChanged) {
        json.entryDeadline = deadline ? new Date(deadline) : null;
        json.reason = reason.trim();
      }
      return apiResponse(api.v1['board-series'][':id'].$put({ param: { id: s.id }, json }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SERIES_KEY });
      onDone();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (isAdmin && deadlineChanged && reason.trim().length < 5) return setError('Say why the deadline changes (at least 5 characters) — it is recorded.');
        setError('');
        save.mutate();
      }}
      className="space-y-4"
    >
      <fieldset className="rounded-lg border border-border bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">Entry deadline — the school&apos;s hard stop</legend>
        {isAdmin ? (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor={`deadline-${s.id}`} className="mb-1 text-xs text-muted-foreground">Deadline (your clock)</Label>
              <Input id={`deadline-${s.id}`} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-60" />
            </div>
            {deadlineChanged && (
              <div className="min-w-72 flex-1">
                <Label htmlFor={`reason-${s.id}`} className="mb-1 text-xs text-muted-foreground">Why it changes</Label>
                <Input id={`reason-${s.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Pearson key dates 2026/27 published" maxLength={500} />
              </div>
            )}
            <p className="basis-full text-xs text-muted-foreground">
              Past it, every payment still unconfirmed for this series closes on its own (wallet money returned, families told) and every registration still waiting expires. It must fall after every window feeding the series closes. Leave it empty for no automatic cut-off.
            </p>
          </div>
        ) : (
          <p className="text-sm text-foreground">
            {s.entryDeadline ? <InstantText iso={s.entryDeadline} /> : <span>Not set yet.</span>}{' '}
            <span className="text-muted-foreground">Only an admin sets it: past it the school closes every unconfirmed payment on the series.</span>
          </p>
        )}
      </fieldset>

      <fieldset className="rounded-lg border border-border bg-card p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">The board&apos;s other dates (information)</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BOARD_SERIES_DATE_FIELDS.map((f) => (
            <div key={f}>
              <Label htmlFor={`${f}-${s.id}`} className="mb-1 text-xs text-muted-foreground">{BOARD_SERIES_DATE_LABELS[f]}</Label>
              <Input id={`${f}-${s.id}`} type="date" value={dates[f]} onChange={(e) => setDates({ ...dates, [f]: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="mt-3">
          <Label htmlFor={`notes-${s.id}`} className="mb-1 text-xs text-muted-foreground">Notes</Label>
          <Input id={`notes-${s.id}`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="e.g. the fee doubles at the late date and trebles at the high-late date" />
        </div>
      </fieldset>

      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone} disabled={save.isPending}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save the dates'}</Button>
      </div>
    </form>
  );
}
