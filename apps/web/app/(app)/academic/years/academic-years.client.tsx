'use client';

/**
 * Academic years and terms (FEATURES_PLAN.md F0a).
 *
 * The spreadsheet version: each summer someone copies last year's calendar
 * workbook, retypes the year in the title, the first and last school day in
 * two cells and a row per term. Nothing stops a term running past the last
 * day, two terms overlapping, or a 2025/26 title on a 2026/27 file, and
 * "which term are we in?" means finding the file and reading the rows.
 *
 * Here: every year on one screen. The label comes from the start year, the
 * picker offers only years not yet created, and the date pickers stay inside
 * 1 July – 30 June. Each year shows its terms as a timeline, so the gaps
 * between terms and today's place are visible without reading dates, and
 * links straight to that year's calendar and bells. A term is one row: its
 * name is suggested, the first term starts on the school's first day, and a
 * term that overlaps another or leaves the year is refused with the API's
 * sentence beside the row.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, academicYearShortLabel, academicYearStartOf, schoolDateString } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import {
  ACADEMIC_KEY, DateText, MONTHS_SHORT, SELECT_CLASS, addDays, dateParts, daysFrom, toDate, useAcademicYears, yearHref, yearStatus,
  type AcademicYearRow,
} from '../calendar/academic-shared';

type Term = AcademicYearRow['terms'][number];

export default function AcademicYearsClient(): React.JSX.Element {
  const { data: years, isLoading, isError, refetch } = useAcademicYears();
  const [creating, setCreating] = useState(false);
  const showCreate = !!years && (creating || years.length === 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 animate-fade-up">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Academic years and terms</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            An academic year runs from 1 July to 30 June. Set the school&apos;s first and last day, then its terms: the calendar, the bells and Today all read them.
          </p>
        </div>
        {years && years.length > 0 && !creating && (
          <Button onClick={() => setCreating(true)}>New academic year</Button>
        )}
      </header>

      {showCreate && (
        <CreateYearForm existing={years} onDone={() => setCreating(false)} canCancel={years.length > 0} />
      )}

      {isLoading ? (
        <LoadingState label="Loading the academic years…" />
      ) : isError ? (
        <ErrorState
          title="The academic years did not load"
          message="This is a connection problem, not an empty list. Try again before creating a year."
          onRetry={() => refetch()}
        />
      ) : (
        <div className="space-y-6">
          {years && inStaffOrder(years).map((y) => <YearCard key={y.id} year={y} />)}
        </div>
      )}
    </div>
  );
}

/** The current year first, then the years to come (nearest first), then past years (latest first). */
function inStaffOrder(years: AcademicYearRow[]): AcademicYearRow[] {
  const current = academicYearStartOf();
  const rank = (y: AcademicYearRow) => (y.startYear === current ? 0 : y.startYear > current ? 1 : 2);
  return [...years].sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? a.startYear - b.startYear : b.startYear - a.startYear));
}

// ─── Create a year ───────────────────────────────────────────────────────────

function CreateYearForm({ existing, onDone, canCancel }: { existing: AcademicYearRow[]; onDone: () => void; canCancel: boolean }) {
  const queryClient = useQueryClient();
  const current = academicYearStartOf();
  const taken = new Set(existing.map((y) => y.startYear));
  const options = [current - 1, current, current + 1, current + 2].filter((y) => !taken.has(y));
  const [startYear, setStartYear] = useState<number | undefined>(() =>
    options.includes(current) ? current : (options.find((y) => y > current) ?? options[0]),
  );
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: (json: { startYear: number; startsOn: string; endsOn: string }) => apiResponse(api.v1.academic.years.$post({ json })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
      setError('');
      onDone();
    },
    onError: (err: Error) => setError(err.message),
  });

  if (startYear === undefined) {
    return (
      <Notice tone="info" className="mb-6" title="Every nearby year already exists">
        Edit a year below instead.
      </Notice>
    );
  }

  const first = `${startYear}-07-01`;
  const last = `${startYear + 1}-06-30`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!startsOn || !endsOn) return setError('Pick the first and the last school day.');
    if (endsOn < startsOn) return setError('The last day must be on or after the first day.');
    setError('');
    create.mutate({ startYear: startYear!, startsOn, endsOn });
  }

  return (
    <form onSubmit={submit} className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby="create-year-title">
      <h2 id="create-year-title" className="font-display text-lg font-bold text-foreground">
        {existing.length === 0 ? 'Create the first academic year' : 'New academic year'}
      </h2>
      {existing.length === 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          Nothing on the Academic screens works until a year exists. Type the school&apos;s first and last day from the school&apos;s own calendar.
        </p>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="new-year-start" className="mb-1.5">Academic year</Label>
          <select
            id="new-year-start"
            value={startYear}
            onChange={(e) => {
              setStartYear(Number(e.target.value));
              setStartsOn('');
              setEndsOn('');
            }}
            className={SELECT_CLASS}
          >
            {options.map((y) => (
              <option key={y} value={y}>
                {academicYearShortLabel(y)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="new-year-first" className="mb-1.5">First school day</Label>
          <Input id="new-year-first" type="date" min={first} max={last} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="new-year-last" className="mb-1.5">Last school day</Label>
          <Input id="new-year-last" type="date" min={startsOn || first} max={last} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} required />
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        <span>Both days fall between</span> <DateText date={first} /> <span>and</span> <DateText date={last} />
      </p>
      {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {canCancel && (
          <Button type="button" variant="outline" onClick={onDone} disabled={create.isPending}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create the year'}
        </Button>
      </div>
    </form>
  );
}

// ─── One year ────────────────────────────────────────────────────────────────

function YearCard({ year }: { year: AcademicYearRow }) {
  const [editing, setEditing] = useState(false);
  const status = yearStatus(year);
  const terms = year.terms;

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby={`year-${year.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`year-${year.id}`} className="font-display text-xl font-bold text-foreground">{year.shortLabel}</h2>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">First day:</dt>
              <dd className="font-medium text-foreground"><DateText date={year.startsOn} weekday /></dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Last day:</dt>
              <dd className="font-medium text-foreground"><DateText date={year.endsOn} weekday /></dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Terms:</dt>
              <dd className="font-medium text-foreground">{terms.length}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">Sections:</dt>
              <dd className="font-medium text-foreground">{year.sectionCount}</dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-wrap gap-2">
          {!editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Change the days
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={yearHref('/academic/calendar', year.startYear)}>Calendar</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={yearHref('/academic/bells', year.startYear)}>Bells</Link>
          </Button>
        </div>
      </div>

      {editing && <EditYearDays year={year} onDone={() => setEditing(false)} />}

      <TermTimeline year={year} />

      {terms.length === 0 && (
        <Notice tone="warning" className="mt-4" title="No terms yet">
          Until a term covers a day, the calendar and Today read that day as out of term. Add the terms below.
        </Notice>
      )}

      <TermsTable year={year} />
    </section>
  );
}

function EditYearDays({ year, onDone }: { year: AcademicYearRow; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [startsOn, setStartsOn] = useState(year.startsOn);
  const [endsOn, setEndsOn] = useState(year.endsOn);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => apiResponse(api.v1.academic.years[':id'].$put({ param: { id: year.id }, json: { startsOn, endsOn } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
      onDone();
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!startsOn || !endsOn) return setError('Pick the first and the last school day.');
        setError('');
        save.mutate();
      }}
      className="mt-4 rounded-lg border border-border bg-muted/40 p-4"
      aria-label="Change the school days"
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <Label htmlFor={`year-first-${year.id}`} className="mb-1.5">First school day</Label>
          <Input id={`year-first-${year.id}`} type="date" min={`${year.startYear}-07-01`} max={`${year.startYear + 1}-06-30`} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`year-last-${year.id}`} className="mb-1.5">Last school day</Label>
          <Input id={`year-last-${year.id}`} type="date" min={`${year.startYear}-07-01`} max={`${year.startYear + 1}-06-30`} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
    </form>
  );
}

// ─── The terms as a timeline ─────────────────────────────────────────────────

function TermTimeline({ year }: { year: AcademicYearRow }) {
  const start = year.startsOn;
  const end = year.endsOn;
  const total = daysFrom(start, end) + 1;
  const pct = (d: string) => Math.max(0, Math.min(100, (daysFrom(start, d) / total) * 100));
  const today = schoolDateString(new Date());
  const todayIn = today >= start && today <= end;

  // A tick at the start of each month the school year touches.
  const ticks: { date: string; m: number }[] = [{ date: start, m: dateParts(start).m }];
  let { y, m } = dateParts(start);
  for (;;) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    const first = toDate(y, m, 1);
    if (first > end) break;
    ticks.push({ date: first, m });
  }

  return (
    <div className="mt-5" role="img" aria-label="The terms on a timeline of the school year">
      <div className="relative h-4 text-[11px] font-semibold text-foreground">
        {todayIn && (
          <span className="absolute whitespace-nowrap" style={{ insetInlineStart: `${pct(today)}%` }}>
            Today
          </span>
        )}
      </div>
      <div className="relative h-9 overflow-hidden rounded-lg bg-muted">
        {year.terms.map((t) => (
          <div
            key={t.id}
            title={t.name}
            className="absolute inset-y-0 flex items-center overflow-hidden rounded-md border-x-2 border-card bg-primary px-2 text-xs font-semibold text-primary-foreground"
            style={{ insetInlineStart: `${pct(t.startsOn)}%`, width: `${pct(addDays(t.endsOn, 1)) - pct(t.startsOn)}%` }}
          >
            <span className="truncate">{t.name}</span>
          </div>
        ))}
        {todayIn && <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ insetInlineStart: `${pct(today)}%` }} />}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-muted-foreground">
        {ticks.map((t) => (
          <span key={t.date} className="absolute border-s border-border ps-1 leading-4" style={{ insetInlineStart: `${pct(t.date)}%` }}>
            {MONTHS_SHORT[t.m - 1]}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── The terms as rows ───────────────────────────────────────────────────────

function weeks(t: { startsOn: string; endsOn: string }) {
  return Math.round((daysFrom(t.startsOn, t.endsOn) + 1) / 7);
}

function TermsTable({ year }: { year: AcademicYearRow }) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const remove = useMutation({
    mutationFn: (id: string) => apiResponse(api.v1.academic.terms[':id'].$delete({ param: { id } })),
    onSuccess: () => {
      setDeleteError('');
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
    },
    onError: (err: Error) => setDeleteError(err.message),
  });

  return (
    <div className="mt-5">
      {year.terms.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Term</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">First day</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Last day</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold text-muted-foreground">Weeks</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {year.terms.map((t) =>
                editingId === t.id ? (
                  <EditTermRow key={t.id} year={year} term={t} onDone={() => setEditingId(null)} />
                ) : (
                  <tr key={t.id}>
                    <td className="px-3 py-2 font-medium text-foreground">{t.name}</td>
                    <td className="px-3 py-2 text-card-foreground"><DateText date={t.startsOn} weekday /></td>
                    <td className="px-3 py-2 text-card-foreground"><DateText date={t.endsOn} weekday /></td>
                    <td className="px-3 py-2 text-end tabular-nums text-card-foreground">{weeks(t)}</td>
                    <td className="px-3 py-2 text-end">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditingId(t.id)}>Edit</Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (confirm('Delete this term? Its days read as out of term until another term covers them.')) remove.mutate(t.id);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {deleteError && <Notice tone="danger" className="mt-3">{deleteError}</Notice>}
      <AddTermForm year={year} />
    </div>
  );
}

function EditTermRow({ year, term, onDone }: { year: AcademicYearRow; term: Term; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(term.name);
  const [startsOn, setStartsOn] = useState(term.startsOn);
  const [endsOn, setEndsOn] = useState(term.endsOn);
  const [error, setError] = useState('');
  const formId = `edit-term-${term.id}`;
  const save = useMutation({
    mutationFn: () => apiResponse(api.v1.academic.terms[':id'].$put({ param: { id: term.id }, json: { name: name.trim(), startsOn, endsOn } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
      onDone();
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <>
      <tr className="bg-muted/40" onKeyDown={(e) => e.key === 'Escape' && onDone()}>
        <td className="px-3 py-2">
          <Input form={formId} aria-label="Term name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </td>
        <td className="px-3 py-2">
          <Input form={formId} aria-label="First day" type="date" min={year.startsOn} max={year.endsOn} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </td>
        <td className="px-3 py-2">
          <Input form={formId} aria-label="Last day" type="date" min={startsOn || year.startsOn} max={year.endsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </td>
        <td className="px-3 py-2 text-end tabular-nums text-muted-foreground">{startsOn && endsOn && endsOn >= startsOn ? weeks({ startsOn, endsOn }) : '—'}</td>
        <td className="px-3 py-2 text-end">
          <form
            id={formId}
            className="flex justify-end gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || !startsOn || !endsOn) return setError('A term needs a name, a first day and a last day.');
              setError('');
              save.mutate();
            }}
          >
            <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={save.isPending}>Cancel</Button>
            <Button type="submit" size="sm" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          </form>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={5} className="px-3 pb-3">
            <Notice tone="danger">{error}</Notice>
          </td>
        </tr>
      )}
    </>
  );
}

function AddTermForm({ year }: { year: AcademicYearRow }) {
  const queryClient = useQueryClient();
  const n = year.terms.length;
  const lastTerm = year.terms[n - 1];
  const suggestedName = `Term ${n + 1}`;
  const [name, setName] = useState(suggestedName);
  const [startsOn, setStartsOn] = useState(n === 0 ? year.startsOn : '');
  const [endsOn, setEndsOn] = useState('');
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const [justAdded, setJustAdded] = useState(false);
  // Open while the year has no terms; afterwards one button, so a finished year stays compact.
  const [open, setOpen] = useState(n === 0);

  // After a term is added the next one's name is suggested and the row is ready to type.
  useEffect(() => {
    setName(suggestedName);
    if (justAdded) nameRef.current?.select();
  }, [suggestedName, justAdded]);

  const create = useMutation({
    mutationFn: () => apiResponse(api.v1.academic.terms.$post({ json: { academicYearId: year.id, name: name.trim(), startsOn, endsOn } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
      setStartsOn('');
      setEndsOn('');
      setError('');
      setJustAdded(true);
    },
    onError: (err: Error) => setError(err.message),
  });

  if (!open) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => { setOpen(true); setJustAdded(true); }}>
          Add a term
        </Button>
        {lastTerm && (
          <p className="text-xs text-muted-foreground">
            <span>The term before ends on</span> <DateText date={lastTerm.endsOn} weekday />
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      className="mt-4 rounded-lg border border-dashed border-border p-4"
      aria-labelledby={`add-term-${year.id}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !startsOn || !endsOn) return setError('A term needs a name, a first day and a last day.');
        setError('');
        create.mutate();
      }}
    >
      <h3 id={`add-term-${year.id}`} className="text-sm font-semibold text-foreground">Add a term</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-end">
        <div>
          <Label htmlFor={`term-name-${year.id}`} className="mb-1.5">Name</Label>
          <Input id={`term-name-${year.id}`} ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </div>
        <div>
          <Label htmlFor={`term-first-${year.id}`} className="mb-1.5">First day</Label>
          <Input
            id={`term-first-${year.id}`}
            type="date"
            min={year.startsOn}
            max={year.endsOn}
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`term-last-${year.id}`} className="mb-1.5">Last day</Label>
          <Input id={`term-last-${year.id}`} type="date" min={startsOn || year.startsOn} max={year.endsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
        <div className="flex gap-2">
          {n > 0 && (
            <Button type="button" variant="outline" className="h-10" onClick={() => { setOpen(false); setError(''); }} disabled={create.isPending}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={create.isPending} className="h-10">
            {create.isPending ? 'Adding…' : 'Add the term'}
          </Button>
        </div>
      </div>
      {lastTerm && (
        <p className="mt-2 text-xs text-muted-foreground">
          <span>The term before ends on</span> <DateText date={lastTerm.endsOn} weekday />
        </p>
      )}
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
    </form>
  );
}
