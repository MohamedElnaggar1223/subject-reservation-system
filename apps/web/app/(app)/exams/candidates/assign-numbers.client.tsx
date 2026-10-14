'use client';

/**
 * Candidate numbers for a whole series in one action (FEATURES_PLAN.md F4,
 * "a candidate number per series with its history").
 *
 * The spreadsheet version: a new column for the series, then for each
 * candidate a look back along the row for the number they had with the board
 * last time (the boards like a candidate to keep it), and for everyone else a
 * count up from 0001 past the numbers already taken — easy to give two
 * candidates the same number, and nothing says so until the board's portal
 * refuses the upload.
 *
 * Here: one button shows who gets which number and whether it is kept from the
 * board's last series; a second saves exactly that. The API keeps a number to
 * one candidate and a candidate to one number, and running it twice changes
 * nothing.
 */

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { EXAMS_KEY, Code } from '../exam-f4-shared';
import { SeriesWords } from './series-words';

const assignNumbers = (boardSeriesId: string, commit: boolean) =>
  apiResponse(api.v1.exams['candidate-numbers'].assign.$post({ json: { boardSeriesId, commit } }));
type AssignResult = Awaited<ReturnType<typeof assignNumbers>>;

export function AssignNumbers({ seriesId, seriesName }: { seriesId: string; seriesName: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<AssignResult | null>(null);
  const [done, setDone] = useState<AssignResult | null>(null);
  const [error, setError] = useState('');

  const run = useMutation({
    mutationFn: (commit: boolean) => assignNumbers(seriesId, commit),
    // A new run replaces the last one's answer, so an old "assigned" never sits beside a new error.
    onMutate: (commit) => {
      setError('');
      if (!commit) setDone(null);
    },
    onSuccess: (r) => {
      setError('');
      if (r.committed) {
        setDone(r);
        setPreview(null);
        queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
      } else {
        setPreview(r);
        setDone(null);
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <section className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm print:hidden" aria-labelledby="assign-numbers-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 id="assign-numbers-title" className="text-sm font-semibold text-foreground">
            <span>Candidate numbers in</span> <SeriesWords name={seriesName} />
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Everyone in this series without a number gets one: the number they had in this board&apos;s last series where it is still free, otherwise the lowest free number. You see who gets which number before anything is saved.
          </p>
        </div>
        <Button type="button" variant="outline" disabled={run.isPending} onClick={() => run.mutate(false)}>
          {run.isPending && !preview ? 'Working…' : 'Assign candidate numbers'}
        </Button>
      </div>

      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}

      {done && (
        <Notice tone="success" className="mt-3">
          {done.toAssign.length ? (
            <span><span>Candidate numbers assigned:</span> <span className="font-semibold tabular-nums">{done.toAssign.length}</span></span>
          ) : (
            <span>Every candidate in this series already has a number; nothing changed.</span>
          )}
        </Notice>
      )}

      {preview && (
        <div className="mt-4 space-y-3">
          {preview.toAssign.length === 0 ? (
            <Notice tone="success">
              <span>Every candidate in this series already has a number.</span>{' '}
              <span className="tabular-nums">{preview.alreadyNumbered}</span> <span>numbered.</span>
            </Notice>
          ) : (
            <>
              {preview.centreNumber ? (
                <p className="text-sm text-foreground">
                  <span>Centre number</span> <Code className="font-semibold">{preview.centreNumber}</Code>
                </p>
              ) : (
                <Notice tone="warning">
                  <span>No centre number is recorded for this board. The numbers can be assigned, but every entry list row is flagged until it is set.</span>{' '}
                  <Link href="/settings" className="font-semibold underline underline-offset-2">Open Settings</Link>
                </Notice>
              )}
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">{preview.toAssign.length}</span> <span>candidates get a number</span>
                {' · '}
                <span className="tabular-nums">{preview.alreadyNumbered}</span> <span>already have one</span>
              </p>
              <div className="max-h-96 overflow-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b border-border bg-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Candidate number</th>
                      <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Candidate</th>
                      <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Where the number comes from</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.toAssign.map((a) => (
                      <tr key={a.studentId}>
                        <td className="px-3 py-2"><Code className="font-semibold">{a.number}</Code></td>
                        <td className="px-3 py-2 text-foreground"><bdi data-i18n-skip="true">{a.name}</bdi></td>
                        <td className="px-3 py-2">
                          {a.keptFromLastSeries ? <Badge tone="success">Kept from the board&apos;s last series</Badge> : <Badge tone="neutral">Next free number</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setPreview(null)} disabled={run.isPending}>
              {preview.toAssign.length ? 'Cancel' : 'Close'}
            </Button>
            {preview.toAssign.length > 0 && (
              <Button type="button" disabled={run.isPending} onClick={() => run.mutate(true)}>
                {run.isPending ? 'Saving…' : 'Assign these numbers'}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
