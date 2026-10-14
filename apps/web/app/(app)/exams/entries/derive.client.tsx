'use client';

/**
 * Deriving a series' entries from its confirmed reservation lines and paid cash-ins (F4,
 * docs/features/EXAM_ENTRIES.md §2, §2a). The sheet version: a registration list printed beside
 * the syllabus booklet, each line turned into an entry by hand — the syllabus and its option code
 * for Cambridge, each unit and the cash-in for Pearson — the retakes and carried-forward sittings
 * remembered from the forms' notes, the cash-ins found in the receipt book, and nothing to say
 * which lines were already typed. Here: a preview says, per line, what its item enters, whether
 * each entry is new or already made, the sitting it follows and whether the school has verified
 * it, and per cash-in whether it is paid; one click makes only the new ones. Each line is cut off
 * at its own deadline (a retake of the board's previous sitting at the retake deadline); past the
 * series' entry deadline with nothing still open the preview shows the school's refusal.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { EXAMS_KEY, BoardText, Code, type BoardSeriesRow } from '../exam-f4-shared';
import { LevelCodeBadge } from '../exams-shared';
import { DeriveNote, FlashNotice, deriveEntries, type DeriveResult, type DeriveRowData, type Flash } from './entries-shared';
import { SeriesWords } from '../candidates/series-words';

const STATE: Record<string, { tone: 'success' | 'neutral' | 'warning'; label: string }> = {
  new: { tone: 'success', label: 'New' },
  exists: { tone: 'neutral', label: 'Already entered' },
  elsewhere: { tone: 'warning', label: 'Entered from another registration' },
  // The coordinator withdrew it and the registration is still confirmed: a derivation never enters it again.
  withdrawn: { tone: 'warning', label: 'Withdrawn — not entered again' },
  // The review of 093dbd1: a draft its line's answer has changed since, and a cash-in's award already entered.
  refresh: { tone: 'warning', label: 'Draft brought up to date with the reservation' },
  link: { tone: 'success', label: 'Already entered: linked to this cash-in' },
};

/** A row's outcome when it is not simply made or already made (the reservations rework). */
const OUTCOME: Partial<Record<DeriveRowData['outcome'], { tone: 'warning' | 'danger' | 'neutral'; label: string }>> = {
  past_deadline: { tone: 'danger', label: 'Past its deadline' },
  held: { tone: 'warning', label: 'Held: sitting not verified' },
  awaiting_payment: { tone: 'warning', label: 'Cash-in awaiting payment' },
  choose_award: { tone: 'warning', label: 'Choose the award' },
  not_mapped: { tone: 'warning', label: 'Not mapped' },
};

export function DerivePanel({ series, studentId }: { series: BoardSeriesRow; studentId: string | null }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<DeriveResult | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [flash, setFlash] = useState<Flash>(null);
  const [error, setError] = useState('');
  const scope = { boardSeriesId: series.id, ...(studentId ? { studentId } : {}) };

  const look = useMutation({
    mutationFn: () => deriveEntries({ ...scope, commit: false }),
    onSuccess: (r) => { setPreview(r); setError(''); setFlash(null); },
    onError: (err: Error) => setError(err.message),
  });
  const commit = useMutation({
    mutationFn: () => deriveEntries({ ...scope, commit: true }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
      setPreview(null);
      setError('');
      setFlash({ tone: 'success', title: r.created === 1 ? 'Made 1 new entry.' : `Made ${r.created} new entries.`,
        ...(r.updated ? { lines: [r.updated === 1 ? '1 entry brought up to date.' : `${r.updated} entries brought up to date.`] } : {}) });
    },
    onError: (err: Error) => setError(err.message),
  });

  const rows = preview?.rows ?? [];
  const interesting = (r: DeriveRowData) => r.outcome !== 'entered' || !!r.note || r.entries.some((e) => e.state !== 'exists');
  const shown = onlyChanges ? rows.filter(interesting) : rows;

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm" aria-labelledby="derive-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 id="derive-title" className="text-sm font-semibold text-foreground">Derive entries from reservations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each paid reservation becomes what its item enters with the board: a Cambridge syllabus as the award with its option code, Pearson units one by one, a paid cash-in as its award. See what it would make first; nothing is made until you confirm.
          </p>
        </div>
        <div className="flex gap-2">
          {preview && <Button type="button" variant="ghost" onClick={() => setPreview(null)}>Close</Button>}
          <Button type="button" variant={preview ? 'outline' : 'default'} disabled={look.isPending} onClick={() => look.mutate()}>
            {look.isPending ? 'Working…' : preview ? 'Preview again' : 'Preview'}
          </Button>
        </div>
      </div>

      <FlashNotice flash={flash} onClose={() => setFlash(null)} className="mt-3 mb-0" />
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}

      {preview && (
        <div className="mt-4 space-y-3">
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-foreground">
            <span>{preview.summary.registrations === 1 ? '1 paid reservation' : `${preview.summary.registrations} paid reservations`}</span>
            <span className="font-semibold">{preview.summary.newEntries === 1 ? '1 new entry to make' : `${preview.summary.newEntries} new entries to make`}</span>
            {preview.summary.updates > 0 && (
              <span className="font-semibold">{preview.summary.updates === 1 ? '1 entry to bring up to date' : `${preview.summary.updates} entries to bring up to date`}</span>
            )}
            {preview.summary.notMapped > 0 && (
              <span className="text-amber-700 dark:text-amber-400">{preview.summary.notMapped === 1 ? '1 subject not mapped' : `${preview.summary.notMapped} subjects not mapped`}</span>
            )}
          </p>

          {preview.refusal ? (
            <Notice tone="danger" title="Nothing can be made">{preview.refusal}</Notice>
          ) : preview.summary.registrations === 0 ? (
            <Notice tone="info">No paid reservation in this series yet. Reservations become entries once they are paid.</Notice>
          ) : preview.summary.newEntries === 0 && preview.summary.updates === 0 ? (
            <Notice tone="success">Everything paid is already entered: there is nothing new to make.</Notice>
          ) : null}

          {rows.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} className="size-4" />
              <span>Show only what is new or needs a choice</span>
            </label>
          )}

          {shown.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-border bg-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Candidate</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Reserved</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">What it enters</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">To do</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((r) => (
                    <tr key={r.registrationId ?? r.chargeId ?? ''} className={cn((r.outcome === 'not_mapped' || r.outcome === 'held' || r.outcome === 'awaiting_payment' || r.outcome === 'choose_award') && 'bg-amber-50/40 dark:bg-amber-900/10', r.outcome === 'past_deadline' && 'bg-red-50/40 dark:bg-red-900/10')}>
                      <td className="px-3 py-2 align-top font-medium text-foreground"><bdi data-i18n-skip="true">{r.studentName}</bdi></td>
                      <td className="px-3 py-2 align-top">
                        {r.chargeId && !r.registrationId ? (
                          <span className="flex flex-wrap items-center gap-1.5"><Badge tone="info">Cash-in</Badge> <BoardText>{r.subject.name}</BoardText></span>
                        ) : (
                          <>
                            <BoardText>{r.subject.name}</BoardText> <Code className="text-xs text-muted-foreground">{r.subject.code}</Code>
                            {r.item && r.item.kind !== 'whole' && <span className="ms-1 text-xs text-muted-foreground">— <BoardText>{r.item.label}</BoardText></span>}
                            {r.chargeId && <Badge tone="info" className="ms-1">Cash-in</Badge>}
                          </>
                        )}
                        {r.levelCode && <div className="mt-1"><LevelCodeBadge code={r.levelCode} /></div>}
                        {r.priorSitting && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            <span>Follows</span> <SeriesWords name={r.priorSitting.name} />{' '}
                            {r.priorSitting.declared && !r.priorSitting.outcome && <Badge tone="warning">Declared, not verified</Badge>}
                            {r.priorSitting.outcome === 'verified' && <Badge tone="success">Verified</Badge>}
                            {r.priorSitting.outcome === 'rejected' && <Badge tone="danger">Not confirmed: entered as a first entry</Badge>}
                          </div>
                        )}
                        {OUTCOME[r.outcome] && <div className="mt-1"><Badge tone={OUTCOME[r.outcome]!.tone}>{OUTCOME[r.outcome]!.label}</Badge></div>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {r.entries.length === 0 ? (
                          <span className="text-muted-foreground">Nothing</span>
                        ) : (
                          <ul className="space-y-1">
                            {r.entries.map((e) => (
                              <li key={`${e.kind}-${e.unitId ?? e.qualificationId}`} className="flex flex-wrap items-center gap-1.5">
                                <Code className="font-semibold">{e.entryCode}</Code>
                                <BoardText className="text-foreground">{e.title}</BoardText>
                                <Badge tone="neutral">{e.kind === 'unit' ? 'Unit' : 'Award'}</Badge>
                                {e.optionCode && <span className="text-xs text-muted-foreground"><span>Option</span> <Code>{e.optionCode}</Code></span>}
                                <Badge tone={STATE[e.state]?.tone ?? 'neutral'}>{STATE[e.state]?.label ?? e.state}</Badge>
                                {e.state === 'withdrawn' && <span className="text-xs text-muted-foreground">To enter it again, add it by hand below.</span>}
                                {e.isRetake && <Badge tone="info">Retake</Badge>}
                                {e.carryForward === 'suggested' && <Badge tone="warning">Carry forward suggested</Badge>}
                                {e.carryForward === 'confirmed' && e.cfFromMonth && e.cfFromYear && (
                                  <Badge tone="info" className="gap-1"><span>Carried forward from</span> <SeriesWords name={`${e.cfFromMonth.charAt(0).toUpperCase()}${e.cfFromMonth.slice(1)} ${e.cfFromYear}`} /></Badge>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-sm text-foreground">
                        {r.note ? <DeriveNote note={r.note} /> : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : rows.length > 0 ? (
            <p className="text-sm text-muted-foreground">Nothing new and nothing to choose. Untick the box above to see every registration.</p>
          ) : null}

          {!preview.refusal && (preview.summary.newEntries > 0 || preview.summary.updates > 0) && (
            <div className="flex justify-end">
              <Button type="button" disabled={commit.isPending} onClick={() => commit.mutate()}>
                {commit.isPending ? 'Working…' : preview.summary.newEntries === 0 ? 'Bring them up to date' : preview.summary.newEntries === 1 ? 'Make the 1 new entry' : `Make the ${preview.summary.newEntries} new entries`}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
