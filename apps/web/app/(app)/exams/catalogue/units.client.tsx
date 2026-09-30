'use client';

/**
 * Units and papers (F0b): every Pearson W unit and Cambridge component, with
 * its own level (AS, A2, or IGCSE) kept apart from the awards it counts
 * toward, which are listed beside it. The add row keeps the board, level and
 * kind, so a board's run of units is a code, a short name, a title and Enter
 * each.
 */

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, UNIT_LEVELS, UNIT_KINDS, TIERS, TIER_LABELS, type UnitLevel, type UnitKind, type Tier } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { CATALOGUE_KEY, levelLabel, unitLevelLabel, UNIT_LEVEL_TONE, SELECT_CLASS, type CatalogueData, type UnitRow } from '../exams-shared';

const KIND_LABEL: Record<UnitKind, string> = { unit: 'Unit', component: 'Component (paper)' };

export function UnitsTab({ data }: { data: CatalogueData }) {
  const [boardFilter, setBoardFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const boardName = new Map(data.boards.map((b) => [b.code, b.name]));
  const q = search.trim().toLowerCase();
  const rows = data.units.filter((u) => (boardFilter === 'all' || u.boardCode === boardFilter)
    && (!q || `${u.code} ${u.shortCode ?? ''} ${u.title}`.toLowerCase().includes(q)));
  return (
    <div>
      <AddUnit data={data} />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="units-board" className="mb-1 text-xs text-muted-foreground">Board</Label>
          <select id="units-board" value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)} className={cn(SELECT_CLASS, 'w-56')}>
            <option value="all">All boards</option>
            {data.boards.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="units-search" className="mb-1 text-xs text-muted-foreground">Search</Label>
          <Input id="units-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="WMA11, P1, Mechanics" className="w-64" />
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b border-border bg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Code</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Title</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Board</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Own level</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Counts toward</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Subjects made of it</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No unit yet. Load a starter set above, or add them with the row at the top.</td></tr>
            ) : rows.map((u) => <UnitLine key={u.id} u={u} boardName={boardName.get(u.boardCode) ?? u.boardCode} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UnitLine({ u, boardName }: { u: UnitRow; boardName: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const toggle = useMutation({
    mutationFn: () => apiResponse(api.v1.catalogue.units[':id'].$put({ param: { id: u.id }, json: { isActive: !u.isActive } })),
    onSuccess: () => { setError(''); queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY }); },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <>
      <tr className={cn(!u.isActive && 'bg-muted/40 text-muted-foreground')}>
        <td className="px-3 py-2.5">
          <span className="font-mono text-xs text-foreground">{u.code}</span>
          {u.shortCode && <> <Badge tone="neutral">{u.shortCode}</Badge></>}
        </td>
        <td className="px-3 py-2.5 text-foreground"><bdi data-i18n-skip="true">{u.title}</bdi><p className="text-xs text-muted-foreground">{KIND_LABEL[u.kind as UnitKind] ?? u.kind}</p></td>
        <td className="px-3 py-2.5 text-foreground"><bdi data-i18n-skip="true">{boardName}</bdi></td>
        <td className="px-3 py-2.5">
          <Badge tone={UNIT_LEVEL_TONE[u.unitLevel] ?? 'neutral'}>{unitLevelLabel(u.unitLevel)}</Badge>
          {u.tier && <> <Badge tone="info">{TIER_LABELS[u.tier as Tier] ?? u.tier}</Badge></>}
        </td>
        <td className="px-3 py-2.5">
          {u.countsToward.length === 0 ? <span className="text-muted-foreground">—</span> : (
            <ul className="space-y-0.5 text-xs">
              {u.countsToward.map((a) => (
                <li key={a.id}>
                  <span className="font-mono">{a.code}</span> <span className="text-muted-foreground">{levelLabel(a.level)}</span>
                  {' · '}<span className="text-muted-foreground">{a.requirement === 'required' ? 'Required' : 'Optional'}</span>
                </li>
              ))}
            </ul>
          )}
        </td>
        <td className="px-3 py-2.5 tabular-nums text-foreground">{u.registrableCount}</td>
        <td className="px-3 py-2.5 text-end">
          <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate()}>{u.isActive ? 'Retire' : 'Bring back'}</Button>
        </td>
      </tr>
      {error && <tr><td colSpan={7} className="px-3 pb-3"><Notice tone="danger">{error}</Notice></td></tr>}
    </>
  );
}

function AddUnit({ data }: { data: CatalogueData }) {
  const queryClient = useQueryClient();
  const [boardCode, setBoardCode] = useState(data.boards[0]?.code ?? 'pearson_edexcel');
  const [code, setCode] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [title, setTitle] = useState('');
  const [unitLevel, setUnitLevel] = useState<UnitLevel>('as');
  const [kind, setKind] = useState<UnitKind>('unit');
  const [tier, setTier] = useState<Tier | ''>('');
  const [error, setError] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const create = useMutation({
    mutationFn: () => apiResponse(api.v1.catalogue.units.$post({
      json: { boardCode: boardCode as 'cambridge', code, shortCode: shortCode.trim() || null, title, unitLevel, kind, tier: unitLevel === 'igcse' && tier ? tier : null },
    })),
    onSuccess: (u) => {
      queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY });
      // The next unit is usually like this one: keep the board, level and kind.
      setCode('');
      setShortCode('');
      setTitle('');
      setError('');
      setAdded(u.code);
      codeRef.current?.focus();
    },
    onError: (err: Error) => { setAdded(null); setError(err.message); },
  });
  return (
    <form className="mb-4 rounded-xl border border-border bg-primary/5 p-4" onSubmit={(e) => { e.preventDefault(); if (!code.trim() || !title.trim()) return setError('Give the unit its code and title.'); create.mutate(); }}>
      <p className="mb-3 text-sm font-semibold text-foreground">Add a unit or paper</p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="u-board" className="mb-1 text-xs text-muted-foreground">Board</Label>
          <select id="u-board" value={boardCode} onChange={(e) => { setBoardCode(e.target.value); setKind(e.target.value === 'cambridge' ? 'component' : 'unit'); }} className={cn(SELECT_CLASS, 'w-52')}>
            {data.boards.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="u-code" className="mb-1 text-xs text-muted-foreground">Code</Label>
          <Input id="u-code" ref={codeRef} value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} placeholder="WMA13, 9700/4" className="w-36 font-mono" />
        </div>
        <div>
          <Label htmlFor="u-short" className="mb-1 text-xs text-muted-foreground">School&apos;s name</Label>
          <Input id="u-short" value={shortCode} onChange={(e) => setShortCode(e.target.value)} maxLength={20} placeholder="P3, Paper 4" className="w-28" />
        </div>
        <div className="min-w-56 flex-1">
          <Label htmlFor="u-title" className="mb-1 text-xs text-muted-foreground">Title</Label>
          <Input id="u-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Pure Mathematics 3" />
        </div>
        <div>
          <Label htmlFor="u-level" className="mb-1 text-xs text-muted-foreground">Its own level</Label>
          <select id="u-level" value={unitLevel} onChange={(e) => setUnitLevel(e.target.value as UnitLevel)} className={cn(SELECT_CLASS, 'w-40')}>
            {UNIT_LEVELS.map((l) => <option key={l} value={l}>{unitLevelLabel(l)}</option>)}
          </select>
        </div>
        {unitLevel === 'igcse' && (
          <div>
            <Label htmlFor="u-tier" className="mb-1 text-xs text-muted-foreground">Tier (where the syllabus fixes it)</Label>
            <select id="u-tier" value={tier} onChange={(e) => setTier(e.target.value as Tier | '')} className={cn(SELECT_CLASS, 'w-40')}>
              <option value="">None</option>
              {TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
            </select>
          </div>
        )}
        <div>
          <Label htmlFor="u-kind" className="mb-1 text-xs text-muted-foreground">Kind</Label>
          <select id="u-kind" value={kind} onChange={(e) => setKind(e.target.value as UnitKind)} className={cn(SELECT_CLASS, 'w-44')}>
            {UNIT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add the unit'}</Button>
      </div>
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      {added && !error && (
        <p className="mt-2 text-xs text-muted-foreground"><span>Added</span> <bdi className="font-semibold text-foreground">{added}</bdi><span>. Type the next unit&apos;s code and press Enter.</span></p>
      )}
    </form>
  );
}
