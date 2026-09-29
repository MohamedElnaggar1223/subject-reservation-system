'use client';

/**
 * A window's board series (FEATURES_PLAN.md F0b; IS-14).
 *
 * The spreadsheet version: one "November" tab collects rows for IAL October,
 * Cambridge November and IAL January; which row goes to which board's
 * sitting is decided later, by hand, from memory, and the one entry deadline
 * written on the tab is wrong for two of the three.
 *
 * Here: the window lists the series it feeds (only series of its academic
 * year and kind can be added — the rule that keeps a student's eligibility
 * one answer), one default per board, and where each subject is entered
 * when it is not the default ("Biology sits in January"). Every
 * registration is entered in its series the moment it is made, so each
 * series' own deadline applies to it. The window's entries are listed with
 * their series and the school's level code, and any can be moved to another
 * series of its board, with a reason, until a deadline passes.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, seriesYearInAcademicYear, A_LEVEL_ONLY_SESSION_TYPES } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { SERIES_KEY, CATALOGUE_KEY, DeadlineBadge, InstantText, LevelCodeBadge, MONTH_LABEL, SELECT_CLASS, useCatalogue } from '../../exams/exams-shared';

const fetchWindowSeries = (id: string) => apiResponse(api.v1.sessions[':id']['board-series'].$get({ param: { id } }));
const fetchEntries = (sessionId: string) => apiResponse(api.v1.catalogue.entries.$get({ query: { sessionId } }));

type Link = { boardSeriesId: string; isDefault: boolean };

export function WindowSeriesPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['sessions', 'board-series', sessionId], queryFn: () => fetchWindowSeries(sessionId) });
  const data = q.data;
  const [links, setLinks] = useState<Link[] | null>(null);
  const [routes, setRoutes] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  // The edit starts from the saved state once, and again after each save —
  // not on every refetch (a series made in the panel refetches it, and must
  // not wipe what is being edited).
  useEffect(() => {
    if (!data || links !== null) return;
    setLinks(data.series.map((s) => ({ boardSeriesId: s.boardSeriesId, isDefault: s.isDefault })));
    setRoutes(Object.fromEntries(data.subjects.filter((s) => s.routedTo).map((s) => [s.id, s.routedTo!])));
  }, [data, links]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const allSeries = useMemo(() => {
    const m = new Map<string, { id: string; name: string; boardCode: string; boardName: string; entryDeadline: string | null; registrations: number }>();
    for (const s of data?.series ?? []) m.set(s.boardSeriesId, { id: s.boardSeriesId, name: s.name, boardCode: s.boardCode, boardName: s.boardName, entryDeadline: s.entryDeadline, registrations: s.allRegistrations });
    for (const c of data?.candidates ?? []) if (!m.has(c.id)) m.set(c.id, { id: c.id, name: c.name, boardCode: c.boardCode, boardName: c.boardName, entryDeadline: c.entryDeadline, registrations: 0 });
    return m;
  }, [data]);

  const save = useMutation({
    mutationFn: () => apiResponse(api.v1.sessions[':id']['board-series'].$put({
      param: { id: sessionId },
      json: {
        series: links ?? [],
        routes: Object.entries(routes).map(([subjectId, boardSeriesId]) => ({ subjectId, boardSeriesId })),
        reason: reason.trim() || undefined,
      },
    })),
    onSuccess: async (r) => {
      setError('');
      setSaved(r.registrationsRouted > 0 ? `routed:${r.registrationsRouted}` : 'saved');
      queryClient.invalidateQueries({ queryKey: SERIES_KEY });
      queryClient.invalidateQueries({ queryKey: ['catalogue', 'entries', sessionId] });
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setLinks(null);
    },
    onError: (err: Error) => { setSaved(null); setError(err.message); },
  });

  const boardsLinked = [...new Set((links ?? []).map((l) => allSeries.get(l.boardSeriesId)?.boardCode).filter(Boolean))] as string[];
  const toggleDefault = (id: string) => {
    const board = allSeries.get(id)?.boardCode;
    setLinks((ls) => (ls ?? []).map((l) => (allSeries.get(l.boardSeriesId)?.boardCode === board ? { ...l, isDefault: l.boardSeriesId === id } : l)));
  };
  const addLink = (id: string) => {
    const board = allSeries.get(id)?.boardCode;
    setLinks((ls) => [...(ls ?? []), { boardSeriesId: id, isDefault: !(ls ?? []).some((l) => allSeries.get(l.boardSeriesId)?.boardCode === board) }]);
  };
  const removeLink = (id: string) => {
    setLinks((ls) => {
      const rest = (ls ?? []).filter((l) => l.boardSeriesId !== id);
      const board = allSeries.get(id)?.boardCode;
      const ofBoard = rest.filter((l) => allSeries.get(l.boardSeriesId)?.boardCode === board);
      // The board's remaining series becomes its default.
      if (ofBoard.length && !ofBoard.some((l) => l.isDefault)) {
        const first = ofBoard[0]!.boardSeriesId;
        return rest.map((l) => (l.boardSeriesId === first ? { ...l, isDefault: true } : l));
      }
      return rest;
    });
    setRoutes((r) => Object.fromEntries(Object.entries(r).filter(([, s]) => s !== id)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="window-series-title">
      <div className="my-8 w-full max-w-4xl rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <h2 id="window-series-title" className="font-display text-lg font-bold text-foreground">
              <span>Board series of</span> <bdi>{data?.session.name ?? '…'}</bdi>
            </h2>
            {data && (
              <p className="text-sm text-muted-foreground">
                <span>{data.session.series}</span> · <span>Academic year</span> <span dir="ltr">{data.session.academicYear}</span>
                {' · '}<span>Only series of this academic year, and</span>{' '}
                <span>{data.session.sessionType === 'june' ? 'June series only' : data.session.qualificationLevel === 'igcse' ? 'November series only (October and January are A-level only)' : 'October, November or January series'}</span>
                <span>, can feed it.</span>
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">Close</Button>
        </div>

        {q.isLoading || !links ? (
          <div className="p-6"><LoadingState label="Loading the window's series…" /></div>
        ) : q.isError || !data ? (
          <div className="p-6"><ErrorState title="The window's series did not load" onRetry={() => q.refetch()} /></div>
        ) : (
          <div className="space-y-6 px-6 py-5">
            {data.unrouted > 0 && (
              <Notice tone="warning">
                <span>This window has</span> <strong>{data.unrouted}</strong> <span>registrations in no series yet (made before it fed one). Saving enters them in their board&apos;s default series.</span>
              </Notice>
            )}

            <section aria-labelledby="fed-series">
              <h3 id="fed-series" className="mb-2 text-sm font-semibold text-foreground">Series this window feeds</h3>
              {links.length === 0 ? (
                <Notice tone="warning">This window feeds no board series yet: its registrations have no entry deadline and are entered nowhere. Add the series below.</Notice>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {links.map((l) => {
                    const s = allSeries.get(l.boardSeriesId);
                    if (!s) return null;
                    const siblings = links.filter((x) => allSeries.get(x.boardSeriesId)?.boardCode === s.boardCode).length;
                    return (
                      <li key={l.boardSeriesId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                        <div className="min-w-56 flex-1">
                          <p className="font-medium text-foreground"><bdi>{s.name}</bdi></p>
                          <p className="text-xs text-muted-foreground">
                            {s.entryDeadline ? <><span>Entry deadline</span> <InstantText iso={s.entryDeadline} /></> : <span>No entry deadline yet</span>}
                            {' · '}<span className="tabular-nums">{s.registrations}</span> <span>registrations in it</span>
                          </p>
                        </div>
                        <DeadlineBadge iso={s.entryDeadline} />
                        {siblings > 1 ? (
                          <label className="flex items-center gap-1 text-sm">
                            <input type="radio" name={`default-${s.boardCode}`} checked={l.isDefault} onChange={() => toggleDefault(l.boardSeriesId)} className="size-4" />
                            <span>Default for {s.boardName}</span>
                          </label>
                        ) : (
                          <Badge tone="neutral">Default for {s.boardName}</Badge>
                        )}
                        <Button variant="ghost" size="sm" disabled={s.registrations > 0} title={s.registrations > 0 ? 'It holds registrations: move them first' : undefined} onClick={() => removeLink(l.boardSeriesId)}>
                          Remove
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <AddSeries
                sessionId={sessionId}
                session={data.session}
                candidates={data.candidates.filter((c) => !links.some((l) => l.boardSeriesId === c.id))}
                onAdd={addLink}
              />
            </section>

            <section aria-labelledby="subject-routes">
              <h3 id="subject-routes" className="mb-1 text-sm font-semibold text-foreground">Where each subject is entered</h3>
              <p className="mb-2 text-xs text-muted-foreground">Each subject goes to its board&apos;s default series unless you choose another here. Existing registrations stay where they are; move them below.</p>
              <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Subject</th>
                      <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Board</th>
                      <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Entered in</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.subjects.map((s) => {
                      const options = links.map((l) => allSeries.get(l.boardSeriesId)!).filter((x) => x && x.boardCode === s.council);
                      const def = links.find((l) => l.isDefault && allSeries.get(l.boardSeriesId)?.boardCode === s.council);
                      return (
                        <tr key={s.id}>
                          <td className="px-3 py-1.5">
                            <bdi className="text-foreground">{s.name}</bdi> <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                            {s.registrations > 0 && <span className="text-xs text-muted-foreground"> · <span className="tabular-nums">{s.registrations}</span> <span>registered</span></span>}
                          </td>
                          <td className="px-3 py-1.5 text-foreground">{s.boardName}</td>
                          <td className="px-3 py-1.5">
                            {options.length === 0 ? (
                              <span className="text-xs text-amber-700 dark:text-amber-400">{boardsLinked.length ? 'Not offered here — this window feeds no series of its board' : 'Add a series first'}</span>
                            ) : (
                              <select
                                aria-label={`Series for ${s.name}`}
                                value={routes[s.id] ?? def?.boardSeriesId ?? ''}
                                onChange={(e) => setRoutes((r) => {
                                  const next = { ...r };
                                  if (e.target.value === def?.boardSeriesId) delete next[s.id];
                                  else next[s.id] = e.target.value;
                                  return next;
                                })}
                                className={cn(SELECT_CLASS, 'h-9')}
                              >
                                {options.map((o) => (
                                  <option key={o.id} value={o.id}>{o.name}{o.id === def?.boardSeriesId ? ' (default)' : ''}</option>
                                ))}
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="flex flex-wrap items-end justify-end gap-2">
              <div className="min-w-72 flex-1">
                <Label htmlFor="window-series-reason" className="mb-1 text-xs text-muted-foreground">Note (optional, kept in the audit log)</Label>
                <Input id="window-series-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. IAL January added for Biology" />
              </div>
              <Button onClick={() => { setError(''); save.mutate(); }} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save the series'}</Button>
            </div>
            {error && <Notice tone="danger">{error}</Notice>}
            {saved && (
              <Notice tone="success">
                {saved.startsWith('routed:')
                  ? <><span>Saved.</span> <strong>{saved.split(':')[1]}</strong> <span>registrations were entered in their series.</span></>
                  : <span>Saved.</span>}
              </Notice>
            )}

            <Entries sessionId={sessionId} links={data.series.map((s) => ({ id: s.boardSeriesId, name: s.name, boardCode: s.boardCode, passed: s.entryDeadlinePassed }))} />
          </div>
        )}
      </div>
    </div>
  );
}

function AddSeries({
  sessionId, session, candidates, onAdd,
}: {
  sessionId: string;
  session: { sessionType: string; qualificationLevel: string; academicYearStart: number };
  candidates: { id: string; name: string; boardCode: string; entryDeadline: string | null; entryDeadlinePassed: boolean }[];
  onAdd: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: catalogue } = useCatalogue();
  const [pick, setPick] = useState('');
  const [board, setBoard] = useState('');
  const [month, setMonth] = useState('');
  const [error, setError] = useState('');
  // The window's kind: June feeds June; otherwise October, November or January — November only for IGCSE.
  const months = session.sessionType === 'june'
    ? ['june']
    : ['october', 'november', 'january'].filter((m) => session.qualificationLevel !== 'igcse' || !(A_LEVEL_ONLY_SESSION_TYPES as readonly string[]).includes(m));
  const boardMonths = catalogue?.boards.find((b) => b.code === board)?.seriesMonths ?? months;
  const create = useMutation({
    mutationFn: () => apiResponse(api.v1['board-series'].$post({
      json: { boardCode: board as 'cambridge', month: month as 'june', year: seriesYearInAcademicYear(month, session.academicYearStart), label: '' },
    })),
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', 'board-series', sessionId] });
      queryClient.invalidateQueries({ queryKey: SERIES_KEY });
      queryClient.invalidateQueries({ queryKey: CATALOGUE_KEY });
      onAdd(s.id);
      setBoard('');
      setMonth('');
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-muted/40 p-3">
      <div>
        <Label htmlFor="add-fed-series" className="mb-1 text-xs text-muted-foreground">Add a series of this year</Label>
        <select id="add-fed-series" value={pick} onChange={(e) => setPick(e.target.value)} className={cn(SELECT_CLASS, 'w-80')}>
          <option value="">{candidates.length ? 'Choose…' : 'None left to add'}</option>
          {candidates.map((c) => <option key={c.id} value={c.id} disabled={c.entryDeadlinePassed}>{c.name}</option>)}
        </select>
      </div>
      <Button variant="outline" disabled={!pick} onClick={() => { onAdd(pick); setPick(''); }}>Add</Button>
      <span className="self-center text-xs text-muted-foreground">or make one:</span>
      <div>
        <Label htmlFor="new-series-board" className="mb-1 text-xs text-muted-foreground">Board</Label>
        <select id="new-series-board" value={board} onChange={(e) => { setBoard(e.target.value); setMonth(''); }} className={cn(SELECT_CLASS, 'w-48')}>
          <option value="">Choose…</option>
          {(catalogue?.boards ?? []).map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor="new-series-month" className="mb-1 text-xs text-muted-foreground">Month</Label>
        <select id="new-series-month" value={month} onChange={(e) => setMonth(e.target.value)} className={cn(SELECT_CLASS, 'w-40')} disabled={!board}>
          <option value="">Choose…</option>
          {months.filter((m) => boardMonths.includes(m)).map((m) => <option key={m} value={m}>{MONTH_LABEL[m]} {seriesYearInAcademicYear(m, session.academicYearStart)}</option>)}
        </select>
      </div>
      <Button variant="outline" disabled={!board || !month || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Making…' : 'Make and add'}</Button>
      <Link href="/exams/series" className="self-center text-xs font-medium text-primary underline-offset-4 hover:underline">Set its dates on the Board series page</Link>
      {error && <Notice tone="danger" className="basis-full">{error}</Notice>}
    </div>
  );
}

function Entries({ sessionId, links }: { sessionId: string; links: { id: string; name: string; boardCode: string; passed: boolean }[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['catalogue', 'entries', sessionId], queryFn: () => fetchEntries(sessionId), enabled: open });
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [moved, setMoved] = useState<number | null>(null);
  const selectedBoards = new Set((q.data ?? []).filter((e) => selected.includes(e.registrationId)).map((e) => e.boardCode));
  const targets = links.filter((l) => !l.passed && (selectedBoards.size === 0 || (selectedBoards.size === 1 && selectedBoards.has(l.boardCode))));
  const move = useMutation({
    mutationFn: () => apiResponse(api.v1.sessions[':id']['board-series'].move.$post({ param: { id: sessionId }, json: { registrationIds: selected, boardSeriesId: target, reason: reason.trim() } })),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['catalogue', 'entries', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: SERIES_KEY });
      setMoved(r.moved);
      setSelected([]);
      setReason('');
      setError('');
    },
    onError: (err: Error) => { setMoved(null); setError(err.message); },
  });
  return (
    <section aria-labelledby="window-entries" className="border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <h3 id="window-entries" className="text-sm font-semibold text-foreground">Registrations and their series</h3>
        <Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide' : 'Show'}</Button>
      </div>
      {open && (
        q.isLoading ? <LoadingState label="Loading the registrations…" /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : !q.data?.length ? (
          <p className="mt-2 text-sm text-muted-foreground">No registration in this window yet.</p>
        ) : (
          <>
            <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">Choose</span></th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Student</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Subject</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Series</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">School&apos;s code</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {q.data.map((e) => {
                    const on = selected.includes(e.registrationId);
                    return (
                      <tr key={e.registrationId}>
                        <td className="px-2 py-1.5">
                          <input type="checkbox" className="size-4" aria-label={`Choose ${e.studentName} ${e.subject.name}`} checked={on} onChange={() => setSelected(on ? selected.filter((x) => x !== e.registrationId) : [...selected, e.registrationId])} />
                        </td>
                        <td className="px-3 py-1.5 text-foreground"><bdi>{e.studentName}</bdi></td>
                        <td className="px-3 py-1.5 text-foreground"><bdi>{e.subject.name}</bdi></td>
                        <td className="px-3 py-1.5 text-foreground">{e.boardSeries ? <bdi>{e.boardSeries.name}</bdi> : <Badge tone="warning">None</Badge>}</td>
                        <td className="px-3 py-1.5"><LevelCodeBadge code={e.levelCode} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="move-target" className="mb-1 text-xs text-muted-foreground">Move the chosen to</Label>
                <select id="move-target" value={target} onChange={(e) => setTarget(e.target.value)} className={cn(SELECT_CLASS, 'w-72')} disabled={selected.length === 0 || selectedBoards.size > 1}>
                  <option value="">{selectedBoards.size > 1 ? 'Choose one board at a time' : 'Choose…'}</option>
                  {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="min-w-64 flex-1">
                <Label htmlFor="move-reason" className="mb-1 text-xs text-muted-foreground">Why</Label>
                <Input id="move-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. sits Unit 1 in January instead" />
              </div>
              <Button disabled={!target || selected.length === 0 || reason.trim().length < 5 || move.isPending} onClick={() => move.mutate()}>
                {move.isPending ? 'Moving…' : 'Move'}
              </Button>
            </div>
            {error && <Notice tone="danger" className="mt-2">{error}</Notice>}
            {moved !== null && !error && <p className="mt-2 text-xs text-muted-foreground" role="status"><span>Moved:</span> <strong>{moved}</strong></p>}
          </>
        )
      )}
    </section>
  );
}
