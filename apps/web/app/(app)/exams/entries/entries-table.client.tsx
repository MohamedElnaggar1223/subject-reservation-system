'use client';

/**
 * The entries of a series, grouped by candidate (F4,
 * docs/features/EXAM_ENTRIES.md §2). The sheet version: one row per student
 * per subject, the option code typed from the syllabus PDF, a "sent?" tick,
 * a strike-through for a withdrawal with the fee looked up in the handbook,
 * and a comment for every change after the entries went. Here: the option
 * is a choice of the syllabus's own codes and saves as it changes; each row
 * shows what the board would refuse today; rows are ticked (one, a
 * candidate's, all) and marked as sent or withdrawn together; a withdrawal
 * shows the board's fee before and after, and a change to a sent entry asks
 * why and says what it costs.
 */

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FEE_TIER_LABELS, TIER_LABELS, type FeeTier, type Tier, type UpdateEntryType } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { ReasonModal } from '~/components/ui/reason-modal';
import { Badge, Notice, type Tone } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { InstantText, MONTH_LABEL, SELECT_CLASS, useCatalogue, type CatalogueData } from '../exams-shared';
import {
  EXAMS_KEY, BoardText, Code, EntryStatusBadge, ProblemChips, fetchEntries, type BoardSeriesRow, type EntryRow,
} from '../exam-f4-shared';
import {
  Dialog, EntryLine, FlashNotice, isSent, submitEntries, toLocalInput, updateEntry, withdrawEntry, type Flash,
} from './entries-shared';

const RETAKE_SOURCE: Record<string, string> = {
  registration: 'Marked at registration',
  history: 'Sat before',
  staff: 'Set by staff',
};

const CARRY_FORWARD: Record<string, { tone: Tone; label: string }> = {
  none: { tone: 'neutral', label: 'No' },
  suggested: { tone: 'warning', label: 'Suggested — confirm it' },
  confirmed: { tone: 'success', label: 'Confirmed' },
};

type RowNote = { tone: Tone; title?: string; text: string };
type Change = { entry: EntryRow; patch: UpdateEntryType };

export function EntriesTable({ series, studentId }: { series: BoardSeriesRow; studentId: string | null }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const query = { boardSeriesId: series.id, ...(studentId ? { studentId } : {}), includeWithdrawn: showWithdrawn ? 'true' as const : 'false' as const };
  const { data: entries, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: [...EXAMS_KEY, 'entries', query],
    queryFn: () => fetchEntries(query),
  });
  const { data: catalogue } = useCatalogue();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, RowNote>>({});
  const [flash, setFlash] = useState<Flash>(null);
  const [dialog, setDialog] = useState<null | { kind: 'send' } | { kind: 'withdraw'; ids: string[] }>(null);
  const [amending, setAmending] = useState<Change | null>(null);

  const rows = useMemo(() => entries ?? [], [entries]);
  const live = rows.filter((r) => r.status !== 'withdrawn');
  const groups = useMemo(() => {
    const m = new Map<string, EntryRow[]>();
    for (const r of rows) m.set(r.studentId, [...(m.get(r.studentId) ?? []), r]);
    return [...m.values()];
  }, [rows]);
  const chosen = live.filter((r) => selected.has(r.id));

  const noteFor = (id: string, note: RowNote | null) => setNotes((n) => {
    const next = { ...n };
    if (note) next[id] = note; else delete next[id];
    return next;
  });

  const update = useMutation({
    mutationFn: ({ entry, patch }: Change) => updateEntry(entry.id, patch),
    onSuccess: (res, { entry }) => {
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
      setAmending(null);
      noteFor(entry.id, res.amendment
        ? { tone: res.amendment.feeDue ? 'warning' : 'success', title: 'Amendment recorded.', text: res.amendment.sentence }
        : null);
    },
    onError: (err: Error, { entry }) => {
      setAmending(null);
      noteFor(entry.id, { tone: 'danger', title: 'Not saved.', text: err.message });
    },
  });

  /** A draft changes at once; on a sent entry a change to what the board sees is an amendment, and asks why. */
  const change = (entry: EntryRow, patch: UpdateEntryType) => {
    noteFor(entry.id, null);
    if (isSent(entry.status)) setAmending({ entry, patch });
    else update.mutate({ entry, patch });
  };
  const saveNote = (entry: EntryRow, text: string) => {
    noteFor(entry.id, null);
    update.mutate({ entry, patch: { notes: text.trim() || null } });
  };

  const toggle = (ids: string[], on: boolean) => setSelected((s) => {
    const next = new Set(s);
    for (const id of ids) if (on) next.add(id); else next.delete(id);
    return next;
  });
  const allIds = live.map((r) => r.id);
  const allOn = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someOn = allIds.some((id) => selected.has(id));

  if (isLoading) return <LoadingState label="Loading the entries…" />;
  if (isError) {
    return <ErrorState title="The entries did not load" message={loadError instanceof Error ? loadError.message : undefined} onRetry={() => refetch()} />;
  }

  return (
    <section aria-labelledby="entries-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="entries-title" className="font-display text-lg font-bold text-foreground">Entries</h2>
          <p className="text-sm text-muted-foreground">
            <span>{live.length === 1 ? '1 entry' : `${live.length} entries`}</span>
            {' · '}
            <span className="tabular-nums">{live.filter((r) => r.problems.length === 0).length}</span> <span>ready for the board</span>
            {' · '}
            <span className="tabular-nums">{live.filter((r) => r.status === 'draft').length}</span> <span>not sent yet</span>
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={showWithdrawn} onChange={(e) => setShowWithdrawn(e.target.checked)} className="size-4" />
          <span>Show withdrawn entries</span>
        </label>
      </div>

      <FlashNotice flash={flash} onClose={() => setFlash(null)} />

      {rows.length === 0 ? (
        <EmptyState
          title={studentId ? 'This candidate has no entry in this series' : 'No entries in this series yet'}
          message="Entries are made from confirmed registrations: use Preview above to see what the registrations enter, then make them. An entry the registrations cannot make is added by hand."
        />
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-t-xl border-b border-border bg-card px-3 py-2">
            <span className="text-sm text-foreground">
              <span className="tabular-nums font-semibold">{chosen.length}</span> <span>ticked</span>
            </span>
            <Button type="button" size="sm" disabled={!chosen.length} onClick={() => setDialog({ kind: 'send' })}>Mark as sent</Button>
            <Button type="button" size="sm" variant="outline" disabled={!chosen.length} onClick={() => setDialog({ kind: 'withdraw', ids: chosen.map((c) => c.id) })}>Withdraw</Button>
            {chosen.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="border-b border-border bg-muted">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2 text-start">
                    <input
                      type="checkbox"
                      aria-label="Tick every entry"
                      className="size-4"
                      checked={allOn}
                      ref={(el) => { if (el) el.indeterminate = someOn && !allOn; }}
                      onChange={(e) => toggle(allIds, e.target.checked)}
                    />
                  </th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Entry</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Option and tier</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Retake and carry forward</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Forecast grade</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Status</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">What the board would refuse</th>
                  <th scope="col" className="px-3 py-2 text-end font-semibold text-muted-foreground"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const first = g[0]!;
                  const ids = g.filter((r) => r.status !== 'withdrawn').map((r) => r.id);
                  const gAll = ids.length > 0 && ids.every((id) => selected.has(id));
                  const gSome = ids.some((id) => selected.has(id));
                  return (
                    <Fragment key={first.studentId}>
                      <tr className="border-t border-border bg-muted/50">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Tick every entry of ${first.studentName}`}
                            className="size-4"
                            disabled={!ids.length}
                            checked={gAll}
                            ref={(el) => { if (el) el.indeterminate = gSome && !gAll; }}
                            onChange={(e) => toggle(ids, e.target.checked)}
                          />
                        </td>
                        <td colSpan={7} className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {first.candidateNumber ? <Code className="font-semibold text-foreground">{first.candidateNumber}</Code> : <Badge tone="warning">No candidate number</Badge>}
                            <bdi data-i18n-skip="true" className="font-semibold text-foreground">{first.studentName}</bdi>
                            <span className="text-xs text-muted-foreground">{g.length === 1 ? '1 entry' : `${g.length} entries`}</span>
                            {!studentId && (
                              <Link href={`/exams/entries?series=${series.id}&student=${first.studentId}` as Route} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                                Only this candidate
                              </Link>
                            )}
                            <Link href={`/exams/candidates?series=${series.id}&student=${first.studentId}` as Route} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                              Candidate details
                            </Link>
                          </div>
                        </td>
                      </tr>
                      {g.map((e) => (
                        <EntryRowView
                          key={e.id}
                          e={e}
                          catalogue={catalogue}
                          selected={selected.has(e.id)}
                          onSelect={(on) => toggle([e.id], on)}
                          open={open.has(e.id)}
                          onOpen={() => setOpen((s) => { const n = new Set(s); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; })}
                          busy={update.isPending && update.variables?.entry.id === e.id}
                          note={notes[e.id]}
                          onDismissNote={() => noteFor(e.id, null)}
                          onChange={(patch) => change(e, patch)}
                          onSaveNote={(t) => saveNote(e, t)}
                          onWithdraw={() => setDialog({ kind: 'withdraw', ids: [e.id] })}
                        />
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dialog?.kind === 'send' && (
        <SendDialog
          series={series}
          entries={chosen}
          onClose={() => setDialog(null)}
          onDone={(f) => { setDialog(null); setSelected(new Set()); setFlash(f); }}
        />
      )}
      {dialog?.kind === 'withdraw' && (
        <WithdrawDialog
          entries={live.filter((r) => dialog.ids.includes(r.id))}
          onClose={() => setDialog(null)}
          onDone={(f) => { setDialog(null); setSelected(new Set()); setFlash(f); }}
        />
      )}
      {amending && (
        <ReasonModal
          title="Amend an entry sent to the board"
          description="This entry has gone to the board, so the change is an amendment the board is told about. Say why it changes; the board's rules say whether it costs a fee, and the answer is shown on the row."
          label="Why it changes"
          placeholder="e.g. the teacher moved the candidate to the Extended tier"
          confirmLabel="Save the amendment"
          isPending={update.isPending}
          onConfirm={(reason) => update.mutate({ entry: amending.entry, patch: { ...amending.patch, reason } })}
          onClose={() => setAmending(null)}
        />
      )}
    </section>
  );
}

// ─── One entry ───────────────────────────────────────────────────────────────

function EntryRowView({
  e, catalogue, selected, onSelect, open, onOpen, busy, note, onDismissNote, onChange, onSaveNote, onWithdraw,
}: {
  e: EntryRow;
  catalogue: CatalogueData | undefined;
  selected: boolean;
  onSelect: (on: boolean) => void;
  open: boolean;
  onOpen: () => void;
  busy: boolean;
  note: RowNote | undefined;
  onDismissNote: () => void;
  onChange: (patch: UpdateEntryType) => void;
  onSaveNote: (text: string) => void;
  onWithdraw: () => void;
}) {
  const withdrawn = e.status === 'withdrawn';
  const q = e.qualificationId ? catalogue?.qualifications.find((x) => x.id === e.qualificationId) : undefined;
  const options = (q?.options ?? []).filter((o) => o.isActive || o.code === e.optionCode);
  const optionCodes = options.map((o) => o.code);
  const tiers = q && !q.tier ? [...new Set(q.units.map((u) => u.tier).filter((t): t is Tier => !!t))] : [];
  const cf = CARRY_FORWARD[e.carryForward] ?? CARRY_FORWARD.none!;

  return (
    <>
      <tr className={cn('border-t border-border/60 align-top', withdrawn && 'bg-muted/30 text-muted-foreground', selected && 'bg-primary/5')}>
        <td className="px-3 py-2.5">
          {!withdrawn && (
            <input type="checkbox" aria-label={`Tick ${e.entryCode}`} className="size-4" checked={selected} onChange={(ev) => onSelect(ev.target.checked)} />
          )}
        </td>
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Code className="font-semibold text-foreground">{e.entryCode}</Code>
            <BoardText className={cn('text-foreground', withdrawn && 'line-through')}>{e.title}</BoardText>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span>{e.kind === 'unit' ? 'Unit' : 'Award'}</span>
            {!e.registrationId && <> · <span>Added by hand</span></>}
          </p>
        </td>
        <td className="px-3 py-2.5">
          {e.kind === 'award' && optionCodes.length > 0 && !withdrawn ? (
            <select
              aria-label={`Option code of ${e.entryCode}`}
              value={e.optionCode ?? ''}
              disabled={busy}
              onChange={(ev) => onChange({ optionCode: ev.target.value || null })}
              className={cn(SELECT_CLASS, 'h-9 w-32 font-mono', !e.optionCode && 'border-amber-400')}
            >
              <option value="">Choose…</option>
              {options.map((o) => <option key={o.id} value={o.code} data-i18n-skip="true">{o.code}</option>)}
            </select>
          ) : e.optionCode ? (
            <Code>{e.optionCode}</Code>
          ) : e.kind === 'award' && q && !optionCodes.length && !withdrawn ? (
            <Link href={'/exams/catalogue?tab=qualifications' as Route} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
              No option codes on the Catalogue: add them there
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          <div className="mt-1.5">
            {tiers.length > 0 && !withdrawn ? (
              <select
                aria-label={`Tier of ${e.entryCode}`}
                value={e.tier ?? ''}
                disabled={busy}
                onChange={(ev) => onChange({ tier: (ev.target.value || null) as Tier | null })}
                className={cn(SELECT_CLASS, 'h-9 w-32', !e.tier && 'border-amber-400')}
              >
                <option value="">Tier…</option>
                {tiers.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
              </select>
            ) : e.tier ? (
              <span className="text-xs text-foreground">{TIER_LABELS[e.tier as Tier] ?? e.tier}</span>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2.5">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" className="size-4" checked={e.isRetake} disabled={busy || withdrawn} onChange={(ev) => onChange({ isRetake: ev.target.checked })} />
            <span>Retake</span>
          </label>
          {e.isRetake && e.retakeSource && <p className="text-xs text-muted-foreground">{RETAKE_SOURCE[e.retakeSource] ?? e.retakeSource}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs">
            <span className="text-muted-foreground">Carry forward:</span>
            <Badge tone={cf.tone}>{cf.label}</Badge>
          </div>
        </td>
        <td className="px-3 py-2.5">
          {e.forecastGrade ? (
            <div>
              <span className="font-mono text-base font-semibold text-foreground" data-i18n-skip="true">{e.forecastGrade}</span>
              {e.forecastByName && <p className="text-xs text-muted-foreground"><span>by</span> <bdi data-i18n-skip="true">{e.forecastByName}</bdi></p>}
              {e.forecastLockedAt && <Badge tone="info" className="mt-1">Sent to the board</Badge>}
            </div>
          ) : !e.forecastRequired ? (
            <span className="text-xs text-muted-foreground">Not asked for</span>
          ) : withdrawn ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Missing</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <EntryStatusBadge status={e.status} />
          <p className="mt-1 text-xs text-muted-foreground">
            {e.status === 'draft' && e.pastDeadline ? (
              <span className="text-red-700 dark:text-red-400">Not sent by the deadline</span>
            ) : e.status === 'draft' ? (
              <><span>If sent today:</span> <span>{FEE_TIER_LABELS[e.feeTierToday as FeeTier] ?? e.feeTierToday}</span></>
            ) : e.status === 'withdrawn' && e.withdrawnAt ? (
              <InstantText iso={e.withdrawnAt} time={false} />
            ) : e.status === 'amended' && e.amendedAt ? (
              <InstantText iso={e.amendedAt} time={false} />
            ) : e.submittedAt ? (
              <InstantText iso={e.submittedAt} time={false} />
            ) : null}
          </p>
        </td>
        <td className="px-3 py-2.5">
          {withdrawn ? <span className="text-muted-foreground">—</span> : <ProblemChips problems={e.problems} />}
        </td>
        <td className="px-3 py-2.5 text-end">
          <div className="flex flex-wrap justify-end gap-1">
            <Button type="button" variant="outline" size="sm" onClick={onOpen} aria-expanded={open}>{open ? 'Close' : 'Details'}</Button>
            {!withdrawn && <Button type="button" variant="ghost" size="sm" onClick={onWithdraw}>Withdraw</Button>}
          </div>
        </td>
      </tr>
      {note && (
        <tr>
          <td />
          <td colSpan={7} className="px-3 pb-3">
            <Notice tone={note.tone} title={
              <span className="flex items-start justify-between gap-3">
                <span>{note.title}</span>
                <button type="button" onClick={onDismissNote} className="text-xs font-medium underline-offset-2 hover:underline">Dismiss</button>
              </span>
            }>
              {note.text}
            </Notice>
          </td>
        </tr>
      )}
      {open && (
        <tr className="bg-muted/30">
          <td />
          <td colSpan={7} className="px-3 py-4">
            <EntryDetails e={e} busy={busy} onChange={onChange} onSaveNote={onSaveNote} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Details: carry forward, the facts, the note ─────────────────────────────

const REGISTRATION_STATUS: Record<string, string> = {
  confirmed: 'Confirmed',
  dropped: 'Dropped',
  expired: 'Expired',
  cancelled: 'Cancelled',
};

function EntryDetails({ e, busy, onChange, onSaveNote }: { e: EntryRow; busy: boolean; onChange: (patch: UpdateEntryType) => void; onSaveNote: (t: string) => void }) {
  const withdrawn = e.status === 'withdrawn';
  const [cf, setCf] = useState({
    carryForward: e.carryForward as 'none' | 'suggested' | 'confirmed',
    cfFromMonth: e.cfFromMonth ?? '',
    cfFromYear: e.cfFromYear ? String(e.cfFromYear) : '',
    cfCentreNumber: e.cfCentreNumber ?? '',
    cfCandidateNumber: e.cfCandidateNumber ?? '',
    cfOption: e.cfOption ?? '',
  });
  const [noteText, setNoteText] = useState(e.notes ?? '');
  const [cfError, setCfError] = useState('');

  const cfPatch = (): UpdateEntryType => {
    const p: UpdateEntryType = {};
    if (cf.carryForward !== e.carryForward) p.carryForward = cf.carryForward;
    const month = (cf.cfFromMonth || null) as UpdateEntryType['cfFromMonth'];
    if ((month ?? null) !== (e.cfFromMonth ?? null)) p.cfFromMonth = month;
    const year = cf.cfFromYear ? Number(cf.cfFromYear) : null;
    if (year !== (e.cfFromYear ?? null)) p.cfFromYear = year;
    for (const k of ['cfCentreNumber', 'cfCandidateNumber', 'cfOption'] as const) {
      const v = cf[k].trim() || null;
      if (v !== (e[k] ?? null)) p[k] = v;
    }
    return p;
  };

  return (
    <div className={cn('grid gap-4', !withdrawn && 'lg:grid-cols-[3fr_2fr]')}>
      {!withdrawn && <form
        className="rounded-lg border border-border bg-card p-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          const p = cfPatch();
          if (cf.cfFromYear && !/^\d{4}$/.test(cf.cfFromYear)) return setCfError('The year is four digits, such as 2026.');
          if (!Object.keys(p).length) return setCfError('Nothing changed.');
          setCfError('');
          onChange(p);
        }}
      >
        <fieldset disabled={withdrawn || busy} className="space-y-3">
          <legend className="text-sm font-semibold text-foreground">Carry forward</legend>
          <p className="text-xs text-muted-foreground">
            Marks from an earlier series count towards this entry. The board needs the series they come from and the centre and candidate number they were sat under.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor={`cf-state-${e.id}`} className="mb-1 text-xs text-muted-foreground">Carried forward</Label>
              <select id={`cf-state-${e.id}`} value={cf.carryForward} onChange={(ev) => setCf({ ...cf, carryForward: ev.target.value as typeof cf.carryForward })} className={SELECT_CLASS}>
                <option value="none">No</option>
                <option value="suggested">Suggested (to confirm)</option>
                <option value="confirmed">Confirmed</option>
              </select>
            </div>
            <div>
              <Label htmlFor={`cf-month-${e.id}`} className="mb-1 text-xs text-muted-foreground">From the series of</Label>
              <select id={`cf-month-${e.id}`} value={cf.cfFromMonth} onChange={(ev) => setCf({ ...cf, cfFromMonth: ev.target.value })} className={SELECT_CLASS}>
                <option value="">—</option>
                {Object.entries(MONTH_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor={`cf-year-${e.id}`} className="mb-1 text-xs text-muted-foreground">Year</Label>
              <Input id={`cf-year-${e.id}`} inputMode="numeric" maxLength={4} value={cf.cfFromYear} onChange={(ev) => setCf({ ...cf, cfFromYear: ev.target.value })} placeholder="2026" dir="ltr" />
            </div>
            <div>
              <Label htmlFor={`cf-centre-${e.id}`} className="mb-1 text-xs text-muted-foreground">Previous centre number</Label>
              <Input id={`cf-centre-${e.id}`} maxLength={10} value={cf.cfCentreNumber} onChange={(ev) => setCf({ ...cf, cfCentreNumber: ev.target.value })} className="font-mono" dir="ltr" />
            </div>
            <div>
              <Label htmlFor={`cf-cand-${e.id}`} className="mb-1 text-xs text-muted-foreground">Previous candidate number</Label>
              <Input id={`cf-cand-${e.id}`} maxLength={10} value={cf.cfCandidateNumber} onChange={(ev) => setCf({ ...cf, cfCandidateNumber: ev.target.value })} className="font-mono" dir="ltr" />
            </div>
            <div>
              <Label htmlFor={`cf-option-${e.id}`} className="mb-1 text-xs text-muted-foreground">Carry-forward option</Label>
              <Input id={`cf-option-${e.id}`} maxLength={40} value={cf.cfOption} onChange={(ev) => setCf({ ...cf, cfOption: ev.target.value })} className="font-mono" dir="ltr" />
            </div>
          </div>
          {cfError && <p className="text-xs text-destructive">{cfError}</p>}
          {!withdrawn && (
            <div className="flex flex-wrap justify-end gap-2">
              {e.carryForward === 'suggested' && (
                <Button type="button" variant="outline" size="sm" onClick={() => onChange({ carryForward: 'confirmed' })}>Confirm the suggestion</Button>
              )}
              <Button type="submit" size="sm">Save carry forward</Button>
            </div>
          )}
        </fieldset>
      </form>}

      <div className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">Registered subject</dt>
          <dd>{e.subjectName ? <BoardText>{e.subjectName}</BoardText> : <span>No registration (added by hand)</span>}</dd>
          {e.registrationId && (
            <>
              <dt className="text-muted-foreground">Registration</dt>
              <dd>{e.registrationStatus === 'confirmed' ? <span>{REGISTRATION_STATUS.confirmed}</span> : <Badge tone="danger">{REGISTRATION_STATUS[e.registrationStatus ?? ''] ?? e.registrationStatus ?? '—'}</Badge>}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Teacher</dt>
          <dd>{e.selfStudy ? <span>Self-study</span> : e.teacherName ? <bdi data-i18n-skip="true">{e.teacherName}</bdi> : <span className="text-muted-foreground">No teacher yet</span>}</dd>
          {e.submittedAt && (
            <>
              <dt className="text-muted-foreground">Sent to the board</dt>
              <dd>
                <InstantText iso={e.submittedAt} />
                {e.feeTierAtSubmission && <> · <span>{FEE_TIER_LABELS[e.feeTierAtSubmission as FeeTier] ?? e.feeTierAtSubmission}</span></>}
              </dd>
            </>
          )}
          {e.amendedAt && (
            <>
              <dt className="text-muted-foreground">Last amended</dt>
              <dd><InstantText iso={e.amendedAt} /> · <span>{e.amendmentCount === 1 ? '1 amendment' : `${e.amendmentCount} amendments`}</span></dd>
            </>
          )}
          {e.withdrawnAt && (
            <>
              <dt className="text-muted-foreground">Withdrawn</dt>
              <dd>
                <InstantText iso={e.withdrawnAt} />
                {e.withdrawalReason && <p className="text-muted-foreground"><bdi data-i18n-skip="true">{e.withdrawalReason}</bdi></p>}
                {e.withdrawalCharge && <p className="mt-1 text-foreground">{e.withdrawalCharge}</p>}
              </dd>
            </>
          )}
          {!withdrawn && e.ifWithdrawnNow && (
            <>
              <dt className="text-muted-foreground">If withdrawn now</dt>
              <dd>{e.ifWithdrawnNow}</dd>
            </>
          )}
        </dl>
        <form
          className="flex items-end gap-2"
          onSubmit={(ev) => { ev.preventDefault(); onSaveNote(noteText); }}
        >
          <div className="flex-1">
            <Label htmlFor={`note-${e.id}`} className="mb-1 text-xs text-muted-foreground">Note</Label>
            <Input id={`note-${e.id}`} value={noteText} onChange={(ev) => setNoteText(ev.target.value)} maxLength={1000} disabled={withdrawn || busy} />
          </div>
          {!withdrawn && <Button type="submit" size="sm" variant="outline" disabled={busy || noteText === (e.notes ?? '')}>Save the note</Button>}
        </form>
      </div>
    </div>
  );
}

// ─── Mark as sent ────────────────────────────────────────────────────────────

function SendDialog({ series, entries, onClose, onDone }: { series: BoardSeriesRow; entries: EntryRow[]; onClose: () => void; onDone: (f: Flash) => void }) {
  const queryClient = useQueryClient();
  const drafts = entries.filter((e) => e.status === 'draft');
  const already = entries.length - drafts.length;
  // Past the deadline only a time before it is taken: entries that went on time and are recorded late.
  const passed = series.entryDeadlinePassed;
  const [when, setWhen] = useState<'now' | 'earlier'>(passed ? 'earlier' : 'now');
  const [at, setAt] = useState(() => (passed ? '' : toLocalInput(new Date())));
  const [error, setError] = useState('');
  const send = useMutation({
    mutationFn: () => submitEntries(drafts.map((d) => d.id), when === 'earlier' ? new Date(at).toISOString() : undefined),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
      const lines = [r.submitted === 1 ? '1 entry is recorded as sent to the board.' : `${r.submitted} entries are recorded as sent to the board.`];
      if (already) lines.push(already === 1 ? '1 had gone already and was left as it was.' : `${already} had gone already and were left as they were.`);
      onDone({ tone: 'success', title: 'Marked as sent.', lines });
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <Dialog title="Mark as sent to the board" onClose={onClose} busy={send.isPending}>
      <div className="space-y-3 text-sm">
        <p className="text-foreground">
          {drafts.length === 1 ? '1 draft will be recorded as sent to the board.' : `${drafts.length} drafts will be recorded as sent to the board.`}
        </p>
        {already > 0 && (
          <p className="text-muted-foreground">
            {already === 1 ? '1 of the ticked entries has gone to the board already and stays as it is.' : `${already} of the ticked entries have gone to the board already and stay as they are.`}
          </p>
        )}
        {drafts.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium text-foreground">When did they go?</legend>
            {passed && (
              <Notice tone="warning">The entry deadline has passed: record only entries that went to the board before it, with the time they went.</Notice>
            )}
            <label className={cn('flex items-center gap-2', passed && 'opacity-50')}>
              <input type="radio" name="sent-when" checked={when === 'now'} onChange={() => setWhen('now')} disabled={passed} className="size-4" />
              <span>Now</span>
            </label>
            <label className="flex flex-wrap items-center gap-2">
              <input type="radio" name="sent-when" checked={when === 'earlier'} onChange={() => setWhen('earlier')} className="size-4" />
              <span>Earlier, on</span>
              <Input type="datetime-local" aria-label="Sent on" value={at} onChange={(e) => { setAt(e.target.value); setWhen('earlier'); }} className="w-56" />
            </label>
            {series.entryDeadline && (
              <p className="text-xs text-muted-foreground">
                <span>The entry deadline is</span> <InstantText iso={series.entryDeadline} /><span>: a time after it is refused.</span>
              </p>
            )}
          </fieldset>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={send.isPending}>Cancel</Button>
          <Button
            type="button"
            className="flex-1"
            disabled={send.isPending || !drafts.length || (when === 'earlier' && !at)}
            onClick={() => { setError(''); send.mutate(); }}
          >
            {send.isPending ? 'Working…' : 'Mark as sent'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// ─── Withdraw ────────────────────────────────────────────────────────────────

function WithdrawDialog({ entries, onClose, onDone }: { entries: EntryRow[]; onClose: () => void; onDone: (f: Flash) => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const tooShort = reason.trim().length < 3;

  const run = async () => {
    setBusy(true);
    const lines: React.ReactNode[] = [];
    let failed = 0;
    for (const [i, e] of entries.entries()) {
      setProgress(i + 1);
      try {
        const r = await withdrawEntry(e.id, reason.trim());
        lines.push(<EntryLine key={e.id} code={e.entryCode} title={e.title} name={e.studentName}><span>{r.charge.sentence}</span></EntryLine>);
      } catch (err) {
        failed += 1;
        lines.push(<EntryLine key={e.id} code={e.entryCode} title={e.title} name={e.studentName}><span className="text-destructive">{err instanceof Error ? err.message : String(err)}</span></EntryLine>);
      }
    }
    queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
    setBusy(false);
    onDone({
      tone: failed ? 'warning' : 'success',
      title: failed ? 'Some entries were not withdrawn.' : entries.length === 1 ? 'Entry withdrawn.' : 'Entries withdrawn.',
      lines,
    });
  };

  return (
    <Dialog title={entries.length === 1 ? 'Withdraw an entry' : 'Withdraw entries'} onClose={onClose} busy={busy} wide>
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">What the board does with the fee if withdrawn now:</p>
        <ul className="max-h-60 space-y-2 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3">
          {entries.map((e) => (
            <li key={e.id}>
              <EntryLine code={e.entryCode} title={e.title} name={e.studentName} />
              <p className="mt-0.5 text-foreground">{e.ifWithdrawnNow}</p>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">A family whose entry had gone to the board is told it was withdrawn, with your reason.</p>
        <div>
          <label className="mb-1 block font-medium text-foreground" htmlFor="withdraw-reason">Why they are withdrawn</label>
          <textarea
            id="withdraw-reason"
            rows={3}
            value={reason}
            onChange={(ev) => setReason(ev.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="e.g. the family dropped the subject"
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {touched && tooShort && <p className="mt-1 text-xs text-destructive">Please write a short reason — it is stored in the audit trail.</p>}
        </div>
        {busy && <p className="text-muted-foreground" aria-live="polite">{`Withdrawing ${progress} of ${entries.length}…`}</p>}
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" variant="destructive" className="flex-1" disabled={busy || tooShort} onClick={run}>
            {busy ? 'Working…' : entries.length === 1 ? 'Withdraw the entry' : `Withdraw ${entries.length} entries`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
