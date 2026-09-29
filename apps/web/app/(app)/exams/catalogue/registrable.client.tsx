'use client';

/**
 * The subjects families register for, and what each enters with its board
 * (F0b). One row per registrable subject: its board, the award it enters or
 * the units it is made of (each unit's own level), the awards those units
 * count toward, and how the school's level code reads for a grade-11
 * student and for a grade-12 student also sitting A2 units. Unmapped rows
 * (the AS and A Level subjects that existed before the catalogue) come first.
 * Mapping is one dialog: pick the board, then the award or the units.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { EmptyState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import {
  CATALOGUE_KEY, SERIES_KEY, levelLabel, unitLevelLabel, UNIT_LEVEL_TONE, LevelCodeBadge, SELECT_CLASS,
  type CatalogueData, type RegistrableRow,
} from '../exams-shared';

export function RegistrableTab({ data }: { data: CatalogueData }) {
  const [search, setSearch] = useState('');
  const [onlyUnmapped, setOnlyUnmapped] = useState(data.unmappedCount > 0);
  const [mapping, setMapping] = useState<RegistrableRow | null>(null);
  const boardName = new Map(data.boards.map((b) => [b.code, b.name]));
  const q = search.trim().toLowerCase();
  const rows = data.registrable
    .filter((r) => (!onlyUnmapped || !r.mapped) && (!q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)))
    .sort((a, b) => Number(a.mapped) - Number(b.mapped) || Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name));

  return (
    <div>
      {data.unmappedCount > 0 && (
        <Notice tone="warning" className="mb-4" title={`${data.unmappedCount} subjects are not mapped yet`}>
          These registrable subjects do not yet say what they enter with the board (the AS and A Level subjects that existed before the catalogue may be whole awards, single units or paper sets). Registration works either way; exam entries need the mapping.
        </Notice>
      )}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="registrable-search" className="mb-1 text-xs text-muted-foreground">Search</Label>
          <Input id="registrable-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Subject name or code" className="w-64" />
        </div>
        <label className="flex h-10 items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={onlyUnmapped} onChange={(e) => setOnlyUnmapped(e.target.checked)} className="size-4" />
          <span>Only subjects not mapped yet</span>
        </label>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={onlyUnmapped ? 'Every subject is mapped' : 'No subject matches'} message={onlyUnmapped ? 'Untick the box to see them all.' : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Subject</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Board</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Enters</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Counts toward</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">School&apos;s code</th>
                <th scope="col" className="px-3 py-2 text-end font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className={cn(!r.isActive && 'bg-muted/40 text-muted-foreground')}>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-foreground"><bdi>{r.name}</bdi></p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{r.code}</span> · <span>{levelLabel(r.qualificationLevel)}</span>
                      {!r.isActive && <> · <span>Not offered</span></>}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-foreground">{boardName.get(r.council) ?? r.council}</td>
                  <td className="px-3 py-2.5">
                    {!r.mapped ? (
                      <Badge tone="warning">Not mapped</Badge>
                    ) : (
                      <div className="space-y-1">
                        {r.qualification && (
                          <p>
                            <span className="font-mono text-xs text-foreground">{r.qualification.code}</span>{' '}
                            <bdi className="text-foreground">{r.qualification.title}</bdi>
                          </p>
                        )}
                        {r.units.length > 0 && (
                          <ul className="flex flex-wrap gap-1">
                            {r.units.map((u) => (
                              <li key={u.id}>
                                <Badge tone={UNIT_LEVEL_TONE[u.unitLevel] ?? 'neutral'}>
                                  <span className="font-mono">{u.shortCode ?? u.code}</span>&nbsp;<span>{unitLevelLabel(u.unitLevel)}</span>
                                </Badge>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.countsToward.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <ul className="space-y-0.5 text-xs">
                        {r.countsToward.map((a) => (
                          <li key={a.id}><span className="font-mono">{a.code}</span> <span className="text-muted-foreground">{levelLabel(a.level)}</span></li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1 text-xs">
                      <span className="inline-flex items-center gap-1"><span className="text-muted-foreground">Grade 11</span> <LevelCodeBadge code={r.levelCode.grade11} /></span>
                      {r.levelCode.grade12WithA2 !== r.levelCode.grade11 && (
                        <span className="inline-flex items-center gap-1"><span className="text-muted-foreground">Grade 12 sitting A2 units too</span> <LevelCodeBadge code={r.levelCode.grade12WithA2} /></span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-end">
                    <Button size="sm" variant={r.mapped ? 'outline' : 'default'} onClick={() => setMapping(r)}>{r.mapped ? 'Change' : 'Map it'}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mapping && <MapDialog row={mapping} data={data} onClose={() => setMapping(null)} />}
    </div>
  );
}

function MapDialog({ row, data, onClose }: { row: RegistrableRow; data: CatalogueData; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [boardCode, setBoardCode] = useState(row.council);
  const [qualificationId, setQualificationId] = useState<string>(row.qualification?.id ?? '');
  const [unitIds, setUnitIds] = useState<string[]>(row.units.map((u) => u.id));
  const [unitSearch, setUnitSearch] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<number | null>(null);
  const isIgcse = row.qualificationLevel === 'igcse';
  const quals = data.qualifications.filter((q) => q.boardCode === boardCode && q.level === row.qualificationLevel && q.isActive);
  const units = useMemo(() => data.units.filter((u) =>
    u.boardCode === boardCode && u.isActive
    && (isIgcse ? u.unitLevel === 'igcse' : u.unitLevel !== 'igcse' && (row.qualificationLevel === 'a_level' || u.unitLevel === 'as'))
    && (!unitSearch.trim() || `${u.code} ${u.shortCode ?? ''} ${u.title}`.toLowerCase().includes(unitSearch.trim().toLowerCase()))),
  [data.units, boardCode, isIgcse, row.qualificationLevel, unitSearch]);
  const boardChanges = boardCode !== row.council;

  const save = useMutation({
    mutationFn: () => apiResponse(api.v1.catalogue.registrable[':subjectId'].$put({
      param: { subjectId: row.id },
      json: { boardCode: boardCode as 'cambridge', qualificationId: qualificationId || null, unitIds, reason: reason.trim() || undefined },
    })),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY });
      queryClient.invalidateQueries({ queryKey: SERIES_KEY });
      setError('');
      setDone(r.registrationsMoved);
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="map-title">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl">
        <h2 id="map-title" className="font-display text-lg font-bold text-foreground">
          <span>What</span> <bdi>{row.name}</bdi> <span>enters</span>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <span>Registered at</span> <span>{levelLabel(row.qualificationLevel)}</span>. <span>Choose the board, then the award it enters, or the units or papers it is made of.</span>
        </p>

        {done !== null ? (
          <div className="mt-4 space-y-3">
            <Notice tone="success" title="Saved">
              {done > 0 ? (
                <p><strong>{done}</strong> <span>waiting or confirmed registrations moved to the window&apos;s series of the new board.</span></p>
              ) : (
                <p>No registration had to move.</p>
              )}
            </Notice>
            <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
          </div>
        ) : (
          <form className="mt-4 space-y-4" onSubmit={(e) => {
            e.preventDefault();
            if (!qualificationId && unitIds.length === 0) return setError('Choose the award it enters, or its units.');
            save.mutate();
          }}>
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-muted-foreground">Board it is entered with</legend>
              <div className="flex flex-wrap gap-1">
                {data.boards.map((b) => (
                  <button
                    key={b.code}
                    type="button"
                    aria-pressed={boardCode === b.code}
                    onClick={() => { setBoardCode(b.code); setQualificationId(''); setUnitIds([]); }}
                    className={cn(
                      'h-10 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      boardCode === b.code ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-accent',
                    )}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
              {boardChanges && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  Changing the board moves this subject&apos;s waiting and confirmed registrations to each window&apos;s series of the new board. If a window feeds none, or an entry&apos;s deadline has passed, nothing changes and you are told why.
                </p>
              )}
            </fieldset>

            <div>
              <Label htmlFor="map-qualification" className="mb-1 text-xs text-muted-foreground">
                {isIgcse ? 'The award it enters' : 'The award it enters (leave empty for units or papers only)'}
              </Label>
              <select id="map-qualification" value={qualificationId} onChange={(e) => setQualificationId(e.target.value)} className={SELECT_CLASS}>
                <option value="">None</option>
                {quals.map((q) => (
                  <option key={q.id} value={q.id}>{q.code} — {q.title}</option>
                ))}
              </select>
              {quals.length === 0 && <p className="mt-1 text-xs text-muted-foreground">This board has no award at this level yet: add it on the Qualifications tab.</p>}
            </div>

            <fieldset>
              <legend className="mb-1 text-xs font-medium text-muted-foreground">
                {isIgcse ? 'Components (optional)' : 'Units or papers it is made of'}
              </legend>
              <Input type="search" value={unitSearch} onChange={(e) => setUnitSearch(e.target.value)} placeholder="P1, WMA11, Paper 3…" aria-label="Find a unit" className="mb-2" />
              {units.length === 0 ? (
                <p className="text-xs text-muted-foreground">No unit of this board fits a subject at this level: add them on the Units tab.</p>
              ) : (
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                  {units.map((u) => {
                    const on = unitIds.includes(u.id);
                    return (
                      <li key={u.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-accent">
                          <input type="checkbox" checked={on} onChange={() => setUnitIds(on ? unitIds.filter((x) => x !== u.id) : [...unitIds, u.id])} className="size-4" />
                          <span className="font-mono text-xs">{u.code}</span>
                          {u.shortCode && <Badge tone="neutral">{u.shortCode}</Badge>}
                          <bdi className="text-foreground">{u.title}</bdi>
                          <Badge tone={UNIT_LEVEL_TONE[u.unitLevel] ?? 'neutral'}>{unitLevelLabel(u.unitLevel)}</Badge>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>

            <div>
              <Label htmlFor="map-reason" className="mb-1 text-xs text-muted-foreground">Note (optional, kept in the audit log)</Label>
              <Input id="map-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. coordinator: Biology is entered with Pearson IAL" />
            </div>

            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
