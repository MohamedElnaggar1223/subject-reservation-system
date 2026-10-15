'use client';

/**
 * The roll-over (FEATURES_PLAN.md F0a): the sections of one academic year
 * move into the next, one grade up, with the students who are in that
 * grade then; grade 12 graduates.
 *
 * The spreadsheet version: every September, copy last year's workbook,
 * rename each tab (10A → 11A), delete the grade-12 tabs, then go through
 * every row to take out the students who repeat the year or left, and
 * retype the grade column. A day's work, and a missed row is a student in
 * the wrong class. Here the preview shows each section's new name (which
 * can be changed), who moves, who stays and why, and who graduates; one
 * click commits it, and running it again changes nothing.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { gradeLabel } from '@repo/validations';
import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { AsWritten } from '~/components/student-academic-panel';
import { LoadingState } from '~/components/ui/query-state';
import { PublishedClashNotice, isPublishedClash, clashMessage, goAheadWith } from '~/components/published-clash';
import { rollOverSections, type RollOverPlan, type Year } from './sections.data';

export function RollOver({
  from,
  to,
  onClose,
  onOpenYear,
}: {
  from: Year;
  to: Year | undefined;
  onClose: () => void;
  onOpenYear: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [plan, setPlan] = useState<RollOverPlan | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [previewedNames, setPreviewedNames] = useState<Record<string, string>>({});
  const [committed, setCommitted] = useState<RollOverPlan | null>(null);
  const [error, setError] = useState('');
  // F1: students rolled into a section of a year whose timetable is published take its lessons — a
  // clash is refused with its code, and the coordinator may go ahead with exactly those clashes.
  const [clash, setClash] = useState<{ message: string; goAhead: { anyway: true; clashToken: string | null }; names: Record<string, string> } | null>(null);

  /** Only the names the coordinator typed are sent; the rest keep the API's default (the grade digits bumped). */
  const typedNames = (p: RollOverPlan | null, n: Record<string, string>) => {
    const out: Record<string, string> = {};
    for (const row of p?.sections ?? []) {
      const v = n[row.from.id]?.trim();
      if (!row.to.exists && v) out[row.from.id] = v;
    }
    return out;
  };

  const preview = useMutation({
    mutationFn: (n: Record<string, string>) =>
      rollOverSections({
        fromAcademicYearId: from.id,
        toAcademicYearId: to!.id,
        commit: false,
        ...(Object.keys(n).length ? { names: n } : {}),
      }),
    onSuccess: (p, n) => {
      setPlan(p);
      setPreviewedNames(n);
      setError('');
    },
    onError: (err: Error) => setError(err.message),
  });

  const commit = useMutation({
    mutationFn: (v: { names: Record<string, string>; goAhead?: { anyway: true; clashToken: string | null } }) =>
      rollOverSections({
        fromAcademicYearId: from.id,
        toAcademicYearId: to!.id,
        commit: true,
        ...(Object.keys(v.names).length ? { names: v.names } : {}),
        ...(v.goAhead ?? {}),
      }),
    onSuccess: (p) => {
      setCommitted(p);
      setError('');
      setClash(null);
      qc.invalidateQueries({ queryKey: ['academic'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      // Show what is left to do now (nothing, unless something changed meanwhile).
      preview.mutate({});
      setNames({});
    },
    onError: (err: Error, v) => {
      if (isPublishedClash(err)) { setClash({ message: clashMessage(err), goAhead: goAheadWith(err), names: v.names }); return; }
      setError(err.message);
    },
  });

  // The preview is the first step: run it on opening.
  useEffect(() => {
    if (to) preview.mutate({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.id, to?.id]);

  const toCreate = plan?.sections.filter((r) => !r.to.exists).length ?? 0;
  const toMove = plan?.sections.reduce((n, r) => n + r.moving.length, 0) ?? 0;
  const nothingToDo = !!plan && toCreate === 0 && toMove === 0;
  const pending = typedNames(plan, names);
  const namesDirty = JSON.stringify(pending) !== JSON.stringify(previewedNames);

  return (
    <section aria-labelledby="rollover-heading" className="space-y-4">
      <button
        type="button"
        onClick={onClose}
        className="inline-flex min-h-10 items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span aria-hidden className="inline-block rtl:rotate-180">←</span>
        <span>All sections</span>
      </button>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 id="rollover-heading" className="font-display text-xl font-bold text-foreground">
          Roll the sections over
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each grade 10 and grade 11 section becomes a section one grade up in the next year, with its homeroom teacher, room and capacity, and the students who are in that grade then. Grade 12 sections stay in their year: those students finish school.
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">From</span>
          <span className="font-semibold text-foreground" dir="ltr">{from.shortLabel}</span>
          <span aria-hidden className="inline-block text-muted-foreground rtl:rotate-180">→</span>
          <span className="text-muted-foreground">Into</span>
          <span className="font-semibold text-foreground" dir="ltr">{to?.shortLabel ?? '—'}</span>
        </p>
      </div>

      {!to ? (
        <Notice tone="warning" title="The next academic year does not exist yet">
          <p>Create it on the Academic years page, with its first and last day, then come back to roll the sections over.</p>
          <p className="mt-2">
            <Link href="/academic/years" className="font-medium underline hover:no-underline">
              Open Academic years
            </Link>
          </p>
        </Notice>
      ) : from.sectionCount === 0 ? (
        <Notice tone="info" title="Nothing to roll over">
          <p>This year has no sections. Add them on the Sections page, or roll over the year before.</p>
        </Notice>
      ) : (
        <>
          {committed && (
            <Notice tone="success" title="The roll-over is done">
              <ul className="space-y-0.5">
                <li>
                  <span>Sections created:</span> <span className="font-semibold">{committed.sectionsCreated}</span>
                </li>
                <li>
                  <span>Students moved:</span> <span className="font-semibold">{committed.studentsMoved}</span>
                </li>
                {(committed.clashesAccepted?.length ?? 0) > 0 && (
                  <li>
                    <span>Clashes in the published timetable, gone ahead with:</span> <span className="font-semibold">{committed.clashesAccepted!.length}</span>
                  </li>
                )}
              </ul>
              <Button variant="outline" className="mt-3 h-10" onClick={() => onOpenYear(to.id)}>
                <span>Go to</span> <span dir="ltr">{to.shortLabel}</span>
              </Button>
            </Notice>
          )}
          {error && (
            <Notice tone="danger">
              <AsWritten>{error}</AsWritten>
            </Notice>
          )}
          {clash && (
            <PublishedClashNotice message={clash.message} pending={commit.isPending}
              onAnyway={() => commit.mutate({ names: clash.names, goAhead: clash.goAhead })} onCancel={() => setClash(null)} />
          )}

          {!plan ? (
            preview.isPending ? <LoadingState label="Working out the roll-over…" /> : null
          ) : (
            <>
              {nothingToDo ? (
                <Notice tone="info" title="Nothing to do">
                  <p>Every section is already in the next year, and every student who moves up is placed.</p>
                </Notice>
              ) : (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
                  <p>
                    <span className="text-muted-foreground">Sections to create:</span>{' '}
                    <span className="font-semibold text-foreground">{toCreate}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Students to move:</span>{' '}
                    <span className="font-semibold text-foreground">{toMove}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Graduating:</span>{' '}
                    <span className="font-semibold text-foreground">{plan.graduating.length}</span>
                  </p>
                </div>
              )}

              <div className="space-y-3">
                {plan.sections.map((row) => (
                  <div key={row.from.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-24">
                        <p className="font-display text-lg font-bold text-foreground">{row.from.name}</p>
                        <p className="text-xs text-muted-foreground">{gradeLabel(row.from.grade)}</p>
                      </div>
                      <span aria-hidden className="inline-block text-muted-foreground rtl:rotate-180">→</span>
                      <div className="min-w-40">
                        {row.to.exists ? (
                          <div className="flex items-center gap-2">
                            <p className="font-display text-lg font-bold text-foreground">{row.to.name}</p>
                            <Badge tone="neutral">Already there</Badge>
                          </div>
                        ) : (
                          <>
                            <label htmlFor={`name-${row.from.id}`} className="sr-only">
                              Name in the new year
                            </label>
                            <input
                              id={`name-${row.from.id}`}
                              value={names[row.from.id] ?? row.to.name}
                              maxLength={20}
                              onChange={(e) => setNames((prev) => ({ ...prev, [row.from.id]: e.target.value }))}
                              className="h-10 w-32 rounded-lg border border-border bg-background px-3 font-display text-base font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                            />
                          </>
                        )}
                        <p className="text-xs text-muted-foreground">{gradeLabel(row.to.grade)}</p>
                      </div>
                      <div className="ms-auto flex flex-wrap gap-2 text-sm">
                        <Badge tone={row.moving.length ? 'success' : 'neutral'}>
                          <span>Moving:</span>&nbsp;<span>{row.moving.length}</span>
                        </Badge>
                        {row.staying.length > 0 && (
                          <Badge tone="warning">
                            <span>Staying:</span>&nbsp;<span>{row.staying.length}</span>
                          </Badge>
                        )}
                        {row.alreadyPlaced > 0 && (
                          <Badge tone="neutral">
                            <span>Already placed:</span>&nbsp;<span>{row.alreadyPlaced}</span>
                          </Badge>
                        )}
                      </div>
                    </div>
                    {(row.moving.length > 0 || row.staying.length > 0) && (
                      <div className="mt-3 grid gap-3 border-t border-border pt-3 text-sm md:grid-cols-2">
                        {row.moving.length > 0 && (
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Moving up</p>
                            <ul className="flex flex-wrap gap-1.5">
                              {row.moving.map((m) => (
                                <li key={m.id} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground">
                                  {m.name}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {row.staying.length > 0 && (
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Staying for you to place
                            </p>
                            <ul className="space-y-0.5">
                              {row.staying.map((m) => (
                                <li key={m.id} className="text-xs">
                                  <span className="font-medium text-foreground">{m.name}</span>
                                  <span className="text-muted-foreground">: </span>
                                  <span className="text-muted-foreground">
                                    <StayingWhy why={m.why} />
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {plan.graduating.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Grade 12: finishing school
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {plan.graduating.map((g) => (
                      <li key={g.id} className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground">
                        <span>{g.name}</span> <span className="text-muted-foreground">{g.section}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className={cn('flex flex-wrap items-center gap-3', nothingToDo && !namesDirty && 'hidden')}>
                {namesDirty && (
                  <>
                    <p className="text-sm text-muted-foreground">You changed a name: preview again to check it before you commit.</p>
                    <Button variant="outline" className="h-11" disabled={preview.isPending} onClick={() => preview.mutate(pending)}>
                      {preview.isPending ? 'Working…' : 'Preview again'}
                    </Button>
                  </>
                )}
                {!nothingToDo && (
                  <Button className="h-11" disabled={namesDirty || commit.isPending || preview.isPending} onClick={() => commit.mutate({ names: pending })}>
                    {commit.isPending ? 'Working…' : 'Create the sections and move the students'}
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Why a student stays behind, as the API words it ("left the school",
 * "grade not recorded", "grade 11 in 2027/28"), shown in the screen's
 * language; anything else as written.
 */
function StayingWhy({ why }: { why: string }) {
  if (why === 'left the school') return <span>Left the school</span>;
  if (why === 'grade not recorded') return <span>Grade not recorded</span>;
  const m = /^grade (\d+) in (.+)$/.exec(why);
  if (m) {
    return (
      <>
        <span>{gradeLabel(Number(m[1]))}</span> · <span dir="ltr">{m[2]}</span>
      </>
    );
  }
  return <AsWritten>{why}</AsWritten>;
}
