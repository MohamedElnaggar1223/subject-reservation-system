'use client';

/**
 * The exam catalogue (FEATURES_PLAN.md F0b).
 *
 * The spreadsheet version: a price list with one row per subject per level
 * ("Biology AS"), the boards' specifications as PDFs on the coordinator's
 * desk, which paper counts toward which award kept in their head, and the
 * school's level codes ("A.S./A.2.") typed by hand on every registration
 * row — thirteen spellings of five codes in the sheet (DISCOVERY.md §1).
 *
 * Here: the three boards and the months each sits; every award (a Pearson
 * cash-in, a Cambridge syllabus) with the units that count toward it, each
 * unit with its own level; Cambridge option codes; and, first, the subjects
 * families register for — each saying what it enters with the board and
 * how the school's code reads for it, computed, never typed. A subject not
 * yet mapped is flagged at the top with one button to map it. The research's
 * Pearson IAL Mathematics and Biology sets load in one click, and loading
 * twice changes nothing. Which board a subject is entered with is the
 * coordinator's answer (decision 3): changing it here moves the subject's
 * waiting registrations with it, or says why it cannot.
 */

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, LEVEL_CODE_READING_LABELS, STARTER_SET_LABELS, STARTER_SETS, type LevelCodeReading, type StarterSet } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { useCatalogue, CATALOGUE_KEY, MONTH_LABEL, type BoardRow } from '../exams-shared';
import { RegistrableTab } from './registrable.client';
import { QualificationsTab } from './qualifications.client';
import { UnitsTab } from './units.client';

type Tab = 'registrable' | 'qualifications' | 'units';

export default function CatalogueClient(): React.JSX.Element {
  const { data, isLoading, isError, refetch } = useCatalogue();
  const [tab, setTab] = useState<Tab>('registrable');

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-up">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Exam catalogue</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            The boards, the awards they issue, the units or papers that count toward each, and what every subject families register for enters with its board. The school&apos;s level codes are worked out from these, never typed.
          </p>
        </div>
        <StarterSets />
      </header>

      {isLoading ? (
        <LoadingState label="Loading the catalogue…" />
      ) : isError || !data ? (
        <ErrorState title="The catalogue did not load" message="This is a connection problem, not an empty catalogue. Try again." onRetry={() => refetch()} />
      ) : (
        <>
          <div className="mb-6 grid gap-3 md:grid-cols-3">
            {data.boards.map((b) => <BoardCard key={b.code} board={b} />)}
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            <span>&quot;A.S./A.2.&quot; on a single AS unit means:</span>{' '}
            <strong className="text-foreground">{LEVEL_CODE_READING_LABELS[data.reading as LevelCodeReading] ?? data.reading}</strong>.{' '}
            <Link href="/settings" className="font-medium text-primary underline-offset-4 hover:underline">Change it on the Settings page</Link>
            <span> when the coordinator confirms what the school means.</span>
          </p>

          <div role="tablist" aria-label="Catalogue" className="mb-4 flex flex-wrap gap-1 border-b border-border">
            {([
              ['registrable', 'Subjects families register', data.unmappedCount],
              ['qualifications', 'Qualifications', data.qualifications.length],
              ['units', 'Units and papers', data.units.length],
            ] as const).map(([key, label, n]) => (
              <button
                key={key}
                role="tab"
                type="button"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  '-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <span>{label}</span>
                {key === 'registrable'
                  ? n > 0 && <Badge tone="warning"><span>{n}</span>&nbsp;<span>to map</span></Badge>
                  : <Badge tone="neutral">{n}</Badge>}
              </button>
            ))}
          </div>

          {tab === 'registrable' && <RegistrableTab data={data} />}
          {tab === 'qualifications' && <QualificationsTab data={data} />}
          {tab === 'units' && <UnitsTab data={data} />}
        </>
      )}
    </div>
  );
}

// ─── Starter sets ────────────────────────────────────────────────────────────

function StarterSets() {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useMutation({
    mutationFn: (set: StarterSet) => apiResponse(api.v1.catalogue.starter.$post({ json: { set } })),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY });
      setError('');
      setResult(r.unitsAdded || r.awardsAdded ? `${r.unitsAdded}|${r.awardsAdded}` : 'none');
    },
    onError: (err: Error) => { setResult(null); setError(err.message); },
  });
  return (
    <div className="max-w-md rounded-xl border border-border bg-card p-3 shadow-sm">
      <p className="text-xs font-semibold text-foreground">Load a starter set from the research</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Adds what is missing; changes nothing already there. Check it against the board&apos;s current specification.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {STARTER_SETS.map((s) => (
          <Button key={s} size="sm" variant="outline" disabled={load.isPending} onClick={() => load.mutate(s)} title={STARTER_SET_LABELS[s]}>
            {s === 'pearson_ial_mathematics' ? 'Pearson IAL Mathematics' : 'Pearson IAL Biology'}
          </Button>
        ))}
      </div>
      {result && (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {result === 'none' ? (
            <span>Everything in that set is already in the catalogue.</span>
          ) : (
            <>
              <span>Added</span> <strong>{result.split('|')[0]}</strong> <span>units and</span> <strong>{result.split('|')[1]}</strong> <span>awards.</span>
            </>
          )}
        </p>
      )}
      {error && <Notice tone="danger" className="mt-2">{error}</Notice>}
    </div>
  );
}

// ─── A board ─────────────────────────────────────────────────────────────────

const ALL_MONTHS = ['october', 'november', 'january', 'june'] as const;

function BoardCard({ board }: { board: BoardRow }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [portal, setPortal] = useState(board.entryPortal ?? '');
  const [months, setMonths] = useState<string[]>(board.seriesMonths);
  const [notes, setNotes] = useState(board.notes ?? '');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => apiResponse(api.v1.catalogue.boards[':code'].$put({
      param: { code: board.code as 'cambridge' },
      json: { entryPortal: portal.trim() || null, seriesMonths: months as ('june' | 'october' | 'november' | 'january')[], notes: notes.trim() || null },
    })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY });
      setEditing(false);
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm" aria-label={board.name}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">{board.name}</h2>
          <p className="text-xs text-muted-foreground">{board.entryPortal ?? <span>No entry portal recorded</span>}</p>
        </div>
        {!editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>}
      </div>
      {!editing ? (
        <>
          <ul className="mt-3 flex flex-wrap gap-1" aria-label="Series months">
            {board.seriesMonths.map((m) => <li key={m}><Badge tone="info">{MONTH_LABEL[m] ?? m}</Badge></li>)}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            <span className="tabular-nums text-foreground">{board.qualificationCount}</span> <span>awards</span>
            {' · '}
            <span className="tabular-nums text-foreground">{board.unitCount}</span> <span>units</span>
            {' · '}
            <span className="tabular-nums text-foreground">{board.registrableCount}</span> <span>subjects</span>
          </p>
          {board.notes && <p className="mt-2 text-xs text-card-foreground">{board.notes}</p>}
        </>
      ) : (
        <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <div>
            <Label htmlFor={`portal-${board.code}`} className="mb-1 text-xs text-muted-foreground">Entry portal</Label>
            <Input id={`portal-${board.code}`} value={portal} onChange={(e) => setPortal(e.target.value)} maxLength={100} />
          </div>
          <fieldset>
            <legend className="mb-1 text-xs text-muted-foreground">Months it sits</legend>
            <div className="flex flex-wrap gap-1">
              {ALL_MONTHS.map((m) => {
                const on = months.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setMonths(on ? months.filter((x) => x !== m) : [...months, m])}
                    className={cn(
                      'h-9 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {MONTH_LABEL[m]}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div>
            <Label htmlFor={`notes-${board.code}`} className="mb-1 text-xs text-muted-foreground">Notes</Label>
            <Input id={`notes-${board.code}`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex justify-end gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={save.isPending}>Cancel</Button>
            <Button type="submit" size="sm" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      )}
    </section>
  );
}
