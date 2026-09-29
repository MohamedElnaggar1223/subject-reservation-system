'use client';

/**
 * Qualifications — the awards the boards issue — with the units that count
 * toward each (the unit-to-award map) and, for Cambridge, the option codes
 * that name the components an entry sits (F0b). One card per award,
 * grouped by board; the units of an award are edited in one go (required,
 * or one of a choice group such as "Applied: one of M1, S1, D1").
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, ENTRY_METHODS, ENTRY_METHOD_LABELS, QUALIFICATION_LEVELS, type EntryMethod, type QualificationLevel } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { CATALOGUE_KEY, levelLabel, unitLevelLabel, UNIT_LEVEL_TONE, SELECT_CLASS, type CatalogueData, type QualificationRow } from '../exams-shared';

const SUITES: Record<string, string[]> = {
  pearson_edexcel: ['International A Level', 'International GCSE'],
  cambridge: ['Cambridge International AS & A Level', 'Cambridge IGCSE', 'Cambridge O Level'],
  oxford: ['OxfordAQA International AS & A Level', 'OxfordAQA International GCSE'],
};

export function QualificationsTab({ data }: { data: CatalogueData }) {
  return (
    <div className="space-y-6">
      <AddQualification data={data} />
      {data.boards.map((b) => {
        const quals = data.qualifications.filter((q) => q.boardCode === b.code);
        return (
          <section key={b.code} aria-label={b.name}>
            <h2 className="mb-2 font-display text-lg font-bold text-foreground">{b.name}</h2>
            {quals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No award of this board yet.</p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {quals.map((q) => <QualificationCard key={q.id} q={q} data={data} />)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function AddQualification({ data }: { data: CatalogueData }) {
  const queryClient = useQueryClient();
  const [boardCode, setBoardCode] = useState(data.boards[0]?.code ?? 'pearson_edexcel');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [level, setLevel] = useState<QualificationLevel>('as_level');
  const [suite, setSuite] = useState('');
  const [subjectArea, setSubjectArea] = useState('');
  const [entryMethod, setEntryMethod] = useState<EntryMethod>('units_cash_in');
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => apiResponse(api.v1.catalogue.qualifications.$post({
      json: { boardCode: boardCode as 'cambridge', code, title, level, suite, subjectArea: subjectArea || title, entryMethod },
    })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY });
      setCode('');
      setTitle('');
      setSubjectArea('');
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <form className="rounded-xl border border-border bg-card p-4 shadow-sm" onSubmit={(e) => { e.preventDefault(); if (!code.trim() || !title.trim()) return setError('Give the award its code and title.'); create.mutate(); }}>
      <p className="mb-3 text-sm font-semibold text-foreground">Add an award</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="q-board" className="mb-1 text-xs text-muted-foreground">Board</Label>
          <select id="q-board" value={boardCode} onChange={(e) => { setBoardCode(e.target.value); setSuite(''); setEntryMethod(e.target.value === 'cambridge' ? 'syllabus_option' : e.target.value === 'pearson_edexcel' ? 'units_cash_in' : 'qualification'); }} className={SELECT_CLASS}>
            {data.boards.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="q-code" className="mb-1 text-xs text-muted-foreground">Code (cash-in or syllabus)</Label>
          <Input id="q-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} placeholder="XMA01, 9700, 4BI1" className="font-mono" />
        </div>
        <div>
          <Label htmlFor="q-title" className="mb-1 text-xs text-muted-foreground">Title</Label>
          <Input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Mathematics (AS)" />
        </div>
        <div>
          <Label htmlFor="q-level" className="mb-1 text-xs text-muted-foreground">Level</Label>
          <select id="q-level" value={level} onChange={(e) => setLevel(e.target.value as QualificationLevel)} className={SELECT_CLASS}>
            {Object.values(QUALIFICATION_LEVELS).map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="q-suite" className="mb-1 text-xs text-muted-foreground">Suite</Label>
          <select id="q-suite" value={suite} onChange={(e) => setSuite(e.target.value)} className={SELECT_CLASS}>
            <option value="">—</option>
            {(SUITES[boardCode] ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="q-area" className="mb-1 text-xs text-muted-foreground">Subject (AS and A Level share it)</Label>
          <Input id="q-area" value={subjectArea} onChange={(e) => setSubjectArea(e.target.value)} maxLength={100} placeholder="Mathematics" />
        </div>
        <div className="lg:col-span-2">
          <Label htmlFor="q-method" className="mb-1 text-xs text-muted-foreground">How the board takes the entry</Label>
          <select id="q-method" value={entryMethod} onChange={(e) => setEntryMethod(e.target.value as EntryMethod)} className={SELECT_CLASS}>
            {ENTRY_METHODS.map((m) => <option key={m} value={m}>{ENTRY_METHOD_LABELS[m]}</option>)}
          </select>
        </div>
      </div>
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      <div className="mt-3 flex justify-end"><Button type="submit" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add the award'}</Button></div>
    </form>
  );
}

type Draft = { unitId: string; requirement: 'required' | 'optional'; choiceGroup: string };

function QualificationCard({ q, data }: { q: QualificationRow; data: CatalogueData }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [error, setError] = useState('');
  const [addingOption, setAddingOption] = useState(false);
  const boardUnits = data.units.filter((u) => u.boardCode === q.boardCode && u.isActive
    && (q.level === 'igcse' ? u.unitLevel === 'igcse' : u.unitLevel !== 'igcse' && (q.level === 'a_level' || u.unitLevel === 'as')));
  const save = useMutation({
    mutationFn: () => apiResponse(api.v1.catalogue.qualifications[':id'].units.$put({
      param: { id: q.id }, json: { units: draft.map((d) => ({ unitId: d.unitId, requirement: d.requirement, choiceGroup: d.choiceGroup.trim() || null })) },
    })),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY }); setEditing(false); setError(''); },
    onError: (err: Error) => setError(err.message),
  });
  const active = useMutation({
    mutationFn: () => apiResponse(api.v1.catalogue.qualifications[':id'].$put({ param: { id: q.id }, json: { isActive: !q.isActive } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY }),
    onError: (err: Error) => setError(err.message),
  });
  const startEdit = () => {
    setDraft(q.units.map((u) => ({ unitId: u.unitId, requirement: u.requirement as 'required' | 'optional', choiceGroup: u.choiceGroup ?? '' })));
    setEditing(true);
  };

  return (
    <article className={cn('rounded-xl border border-border bg-card p-4 shadow-sm', !q.isActive && 'opacity-70')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-foreground">
            <span className="font-mono">{q.code}</span> <bdi>{q.title}</bdi>
          </p>
          <p className="text-xs text-muted-foreground">
            <span>{levelLabel(q.level)}</span>
            {q.suite && <> · <span>{q.suite}</span></>}
            {' · '}<span>{ENTRY_METHOD_LABELS[q.entryMethod as EntryMethod] ?? q.entryMethod}</span>
            {' · '}<span className="tabular-nums">{q.registrableCount}</span> <span>subjects enter it</span>
          </p>
        </div>
        <div className="flex gap-1">
          {!editing && <Button size="sm" variant="outline" onClick={startEdit}>Edit units</Button>}
          <Button size="sm" variant="ghost" onClick={() => active.mutate()} disabled={active.isPending}>{q.isActive ? 'Retire' : 'Bring back'}</Button>
        </div>
      </div>

      {!editing ? (
        q.units.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No units counted yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="py-1 text-start font-medium">Unit</th>
                <th scope="col" className="py-1 text-start font-medium">Own level</th>
                <th scope="col" className="py-1 text-start font-medium">Counts as</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.units.map((u) => (
                <tr key={u.unitId}>
                  <td className="py-1.5">
                    <span className="font-mono text-xs">{u.code}</span>{u.shortCode && <> <Badge tone="neutral">{u.shortCode}</Badge></>} <bdi className="text-foreground">{u.title}</bdi>
                  </td>
                  <td className="py-1.5"><Badge tone={UNIT_LEVEL_TONE[u.unitLevel] ?? 'neutral'}>{unitLevelLabel(u.unitLevel)}</Badge></td>
                  <td className="py-1.5 text-xs text-foreground">
                    {u.requirement === 'required' ? <span>Required</span> : <><span>Optional</span>{u.choiceGroup && <>: <bdi className="text-muted-foreground">{u.choiceGroup}</bdi></>}</>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {boardUnits.map((u) => {
              const d = draft.find((x) => x.unitId === u.id);
              return (
                <li key={u.id} className="flex flex-wrap items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
                  <label className="flex min-w-56 flex-1 cursor-pointer items-center gap-2">
                    <input type="checkbox" className="size-4" checked={!!d} onChange={() => setDraft(d ? draft.filter((x) => x.unitId !== u.id) : [...draft, { unitId: u.id, requirement: 'required', choiceGroup: '' }])} />
                    <span className="font-mono text-xs">{u.code}</span>{u.shortCode && <Badge tone="neutral">{u.shortCode}</Badge>}
                    <bdi className="text-foreground">{u.title}</bdi>
                    <Badge tone={UNIT_LEVEL_TONE[u.unitLevel] ?? 'neutral'}>{unitLevelLabel(u.unitLevel)}</Badge>
                  </label>
                  {d && (
                    <>
                      <select aria-label={`How ${u.code} counts`} value={d.requirement} onChange={(e) => setDraft(draft.map((x) => (x.unitId === u.id ? { ...x, requirement: e.target.value as Draft['requirement'] } : x)))} className={cn(SELECT_CLASS, 'h-9 w-32')}>
                        <option value="required">Required</option>
                        <option value="optional">Optional</option>
                      </select>
                      {d.requirement === 'optional' && (
                        <Input aria-label={`Choice group of ${u.code}`} value={d.choiceGroup} onChange={(e) => setDraft(draft.map((x) => (x.unitId === u.id ? { ...x, choiceGroup: e.target.value } : x)))} placeholder="Applied: one of M1, S1, D1" className="h-9 w-64" />
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {boardUnits.length === 0 && <p className="text-sm text-muted-foreground">This board has no unit at this level yet: add them on the Units tab.</p>}
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="flex justify-end gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={save.isPending}>Cancel</Button>
            <Button type="submit" size="sm" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save the units'}</Button>
          </div>
        </form>
      )}

      {(q.entryMethod === 'syllabus_option' || q.options.length > 0) && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Option codes</p>
            {!addingOption && <Button size="sm" variant="ghost" onClick={() => setAddingOption(true)}>Add an option</Button>}
          </div>
          {q.options.length === 0 && !addingOption && <p className="mt-1 text-sm text-muted-foreground">No option code yet.</p>}
          <ul className="mt-2 space-y-1">
            {q.options.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="info" className="font-mono">{o.code}</Badge>
                <bdi className="text-foreground">{o.label}</bdi>
                {o.carryForward && <Badge tone="warning">Carry forward</Badge>}
                <span className="text-xs text-muted-foreground">{o.units.map((u) => u.shortCode ?? u.code).join(', ')}</span>
              </li>
            ))}
          </ul>
          {addingOption && <AddOption q={q} onDone={() => setAddingOption(false)} />}
        </div>
      )}
      {error && !editing && <Notice tone="danger" className="mt-2">{error}</Notice>}
    </article>
  );
}

function AddOption({ q, onDone }: { q: QualificationRow; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [carryForward, setCarryForward] = useState(false);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => apiResponse(api.v1.catalogue.qualifications[':id'].options.$post({ param: { id: q.id }, json: { code, label, unitIds, carryForward } })),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY }); onDone(); },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <form className="mt-3 space-y-2 rounded-lg border border-border p-3" onSubmit={(e) => { e.preventDefault(); if (!code.trim() || !label.trim()) return setError('Give the option its code and say what it enters.'); create.mutate(); }}>
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Option code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={10} placeholder="AX" className="w-24 font-mono" />
        <Input aria-label="What it enters" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} placeholder="AS Level: Papers 1, 2 and 3" className="min-w-64 flex-1" />
      </div>
      <fieldset>
        <legend className="mb-1 text-xs text-muted-foreground">Components it enters</legend>
        <div className="flex flex-wrap gap-2">
          {q.units.map((u) => {
            const on = unitIds.includes(u.unitId);
            return (
              <label key={u.unitId} className="flex items-center gap-1 text-sm">
                <input type="checkbox" className="size-4" checked={on} onChange={() => setUnitIds(on ? unitIds.filter((x) => x !== u.unitId) : [...unitIds, u.unitId])} />
                <span>{u.shortCode ?? u.code}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={carryForward} onChange={(e) => setCarryForward(e.target.checked)} />
        <span>Carries forward marks from an earlier series</span>
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex justify-end gap-1">
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={create.isPending}>Cancel</Button>
        <Button type="submit" size="sm" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add the option'}</Button>
      </div>
    </form>
  );
}

