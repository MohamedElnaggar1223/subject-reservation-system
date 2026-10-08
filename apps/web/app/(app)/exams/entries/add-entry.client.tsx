'use client';

/**
 * Adding an entry by hand (F4, docs/features/EXAM_ENTRIES.md §2): a cash-in
 * with no unit sat this series, the unit of a choice group the derivation
 * could not choose, an award the catalogue cannot say. The sheet version:
 * a new row typed at the bottom, the code copied from the board's PDF, and a
 * typo found when the board rejects the file. Here the code is a choice of
 * the series' board's own units and awards (so another board's code cannot
 * be entered), the option a choice of the syllabus's codes, and past the
 * entry deadline the form is closed with the reason.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TIER_LABELS, type Tier } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { SELECT_CLASS, useCatalogue } from '../exams-shared';
import { EXAMS_KEY, fetchCandidates, fetchEntryList, type BoardSeriesRow } from '../exam-f4-shared';
import { EntryLine, FlashNotice, createEntry, entriesClosed, type Flash } from './entries-shared';

export function AddEntryPanel({ series, studentId }: { series: BoardSeriesRow; studentId: string | null }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const passed = entriesClosed(series);
  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm" aria-labelledby="add-entry-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 id="add-entry-title" className="text-sm font-semibold text-foreground">Add an entry by hand</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            For what the reservations cannot make: a paid cash-in whose line does not say the award, a cash-in with no unit sat this series, or the unit of a choice (&ldquo;one of M1, S1, D1&rdquo;).
          </p>
        </div>
        {!open && (
          <Button type="button" variant="outline" disabled={passed} onClick={() => { setOpen(true); setFlash(null); }}>Add an entry</Button>
        )}
      </div>
      {passed && <p className="mt-2 text-sm text-muted-foreground">The entry deadline has passed: no new entry can be made for this series.</p>}
      <FlashNotice flash={flash} onClose={() => setFlash(null)} className="mt-3 mb-0" />
      {open && !passed && <AddEntryForm series={series} studentId={studentId} onDone={(f) => { setFlash(f); setOpen(false); }} onCancel={() => setOpen(false)} />}
    </section>
  );
}

function AddEntryForm({ series, studentId, onDone, onCancel }: { series: BoardSeriesRow; studentId: string | null; onDone: (f: Flash) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const { data: catalogue, isLoading: catalogueLoading } = useCatalogue();
  const { data: candidates, isLoading: candidatesLoading } = useQuery({
    queryKey: [...EXAMS_KEY, 'candidates', { boardSeriesId: series.id }],
    queryFn: () => fetchCandidates({ boardSeriesId: series.id }),
  });
  const [candidate, setCandidate] = useState(studentId ?? '');
  const [kind, setKind] = useState<'award' | 'unit'>('award');
  const [itemId, setItemId] = useState('');
  const [optionCode, setOptionCode] = useState('');
  const [tier, setTier] = useState<Tier | ''>('');
  const [notes, setNotes] = useState('');
  const [chargeId, setChargeId] = useState('');
  const [error, setError] = useState('');
  // The candidate's paid cash-ins in this series with no entry (the reservations rework, §3.6): the award entry carries one.
  const { data: list } = useQuery({ queryKey: [...EXAMS_KEY, 'entry-list', series.id], queryFn: () => fetchEntryList(series.id) });
  const cashIns = (list?.cashInsToEnter ?? []).filter((c) => c.studentId === candidate);

  const awards = useMemo(() => (catalogue?.qualifications ?? []).filter((q) => q.boardCode === series.boardCode && q.isActive).sort((a, b) => a.code.localeCompare(b.code)), [catalogue, series.boardCode]);
  const units = useMemo(() => (catalogue?.units ?? []).filter((u) => u.boardCode === series.boardCode && u.isActive).sort((a, b) => a.code.localeCompare(b.code)), [catalogue, series.boardCode]);
  const award = kind === 'award' ? awards.find((q) => q.id === itemId) : undefined;
  const options = (award?.options ?? []).filter((o) => o.isActive);
  const tiers = award && !award.tier ? [...new Set(award.units.map((u) => u.tier).filter((t): t is Tier => !!t))] : [];
  const people = candidates?.candidates ?? [];
  const chosenPerson = people.find((p) => p.studentId === candidate);

  const create = useMutation({
    mutationFn: () => createEntry({
      studentId: candidate,
      boardSeriesId: series.id,
      ...(kind === 'award' ? { qualificationId: itemId } : { unitId: itemId }),
      optionCode: optionCode || null,
      ...(tier ? { tier } : {}),
      ...(kind === 'award' && chargeId ? { chargeId } : {}),
      notes: notes.trim() || null,
    }),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
      onDone({ tone: 'success', title: 'Entry added as a draft.', lines: [<EntryLine key="e" code={row.entryCode} title={row.title} name={chosenPerson?.name} />] });
    },
    onError: (err: Error) => setError(err.message),
  });

  if (catalogueLoading || candidatesLoading) return <p className="mt-3 text-sm text-muted-foreground">Loading the candidates and the catalogue…</p>;

  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!candidate) return setError('Choose the candidate.');
        if (!itemId) return setError(kind === 'award' ? 'Choose the award.' : 'Choose the unit.');
        setError('');
        create.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="add-candidate" className="mb-1 text-xs text-muted-foreground">Candidate</Label>
          <select id="add-candidate" value={candidate} onChange={(e) => setCandidate(e.target.value)} className={SELECT_CLASS} disabled={!!studentId}>
            <option value="">Choose…</option>
            {studentId && !people.some((p) => p.studentId === studentId) && <option value={studentId}>The candidate above</option>}
            {people.map((p) => (
              <option key={p.studentId} value={p.studentId} data-i18n-skip="true">
                {p.name}{p.candidateNumber ? ` (${p.candidateNumber})` : ''}
              </option>
            ))}
          </select>
          {!studentId && people.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">Nobody is registered or entered in this series yet.</p>
          )}
        </div>
        <fieldset>
          <legend className="mb-1 text-xs text-muted-foreground">What</legend>
          <div role="group" className="flex gap-1">
            {(['award', 'unit'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => { setKind(k); setItemId(''); setOptionCode(''); setTier(''); }}
                className={cn(
                  'h-10 flex-1 rounded-lg border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  kind === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-accent',
                )}
              >
                {k === 'award' ? 'An award or cash-in' : 'A unit'}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="lg:col-span-2">
          <Label htmlFor="add-item" className="mb-1 text-xs text-muted-foreground">{kind === 'award' ? 'Award (the board\'s code)' : 'Unit (the board\'s code)'}</Label>
          <select id="add-item" value={itemId} onChange={(e) => { setItemId(e.target.value); setOptionCode(''); setTier(''); }} className={cn(SELECT_CLASS, 'font-mono')}>
            <option value="">Choose…</option>
            {(kind === 'award' ? awards : units).map((x) => (
              <option key={x.id} value={x.id} data-i18n-skip="true">{x.code} — {x.title}</option>
            ))}
          </select>
          {(kind === 'award' ? awards : units).length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">This board has none on the Catalogue yet.</p>
          )}
        </div>
        {kind === 'award' && options.length > 0 && (
          <div>
            <Label htmlFor="add-option" className="mb-1 text-xs text-muted-foreground">Option code</Label>
            <select id="add-option" value={optionCode} onChange={(e) => setOptionCode(e.target.value)} className={cn(SELECT_CLASS, 'font-mono')}>
              <option value="">Choose later</option>
              {options.map((o) => (
                <option key={o.id} value={o.code} data-i18n-skip="true">{o.code}{o.label ? ` — ${o.label}` : ''}</option>
              ))}
            </select>
          </div>
        )}
        {kind === 'award' && cashIns.length > 0 && (
          <div className="lg:col-span-2">
            <Label htmlFor="add-charge" className="mb-1 text-xs text-muted-foreground">The paid cash-in it comes from</Label>
            <select id="add-charge" value={chargeId} onChange={(e) => setChargeId(e.target.value)} className={SELECT_CLASS}>
              <option value="">None</option>
              {cashIns.map((c) => <option key={c.chargeId} value={c.chargeId}>{c.description}</option>)}
            </select>
          </div>
        )}
        {tiers.length > 0 && (
          <div>
            <Label htmlFor="add-tier" className="mb-1 text-xs text-muted-foreground">Tier</Label>
            <select id="add-tier" value={tier} onChange={(e) => setTier(e.target.value as Tier | '')} className={SELECT_CLASS}>
              <option value="">Choose later</option>
              {tiers.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
            </select>
          </div>
        )}
        <div className="sm:col-span-2">
          <Label htmlFor="add-notes" className="mb-1 text-xs text-muted-foreground">Note (optional)</Label>
          <Input id="add-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="e.g. cash-in: units banked in June" />
        </div>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={create.isPending}>Cancel</Button>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add the entry'}</Button>
      </div>
    </form>
  );
}
