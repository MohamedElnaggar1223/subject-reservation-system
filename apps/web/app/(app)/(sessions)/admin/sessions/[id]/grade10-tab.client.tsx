'use client';

/**
 * The Grade 10 tab (RESERVATIONS_REWORK.md §4.2, A-15, Q-10): grade 10 sits the core in June, and
 * the school registers it. Tick the core subjects; "Preview" lists every grade-10 student's lines
 * with their prices (and who cannot be registered, and why); "Register grade 10" makes them once
 * — unpaid, with the school's consent on each line, the teacher the subject's only one or none. A
 * second run finds nothing to do.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { fetchOffers, offersKey, SESSIONS_KEY, Money, ErrorLine, errorText, type SessionDetail } from '../sessions-shared';

export default function Grade10Tab({ session }: { session: SessionDetail }): React.JSX.Element {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: offersKey(session.id), queryFn: () => fetchOffers(session.id) });
  const toggle = useMutation({
    mutationFn: async ({ offerId, grade10Core }: { offerId: string; grade10Core: boolean }) =>
      apiResponse(api.v1.sessions[':id'].offers[':offerId'].$put({ param: { id: session.id, offerId }, json: { grade10Core } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: offersKey(session.id) }),
  });
  const preview = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].grade10.preview.$post({ param: { id: session.id }, json: {} })),
  });
  const commit = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].grade10.commit.$post({ param: { id: session.id }, json: {} })),
    onSuccess: async () => {
      preview.reset();
      await Promise.all([queryClient.invalidateQueries({ queryKey: SESSIONS_KEY })]);
    },
  });
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;
  const igcse = data.offers.filter((o) => o.subject.qualificationLevel === 'igcse' && o.availability !== 'closed');
  const p = preview.data;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h3 className="font-semibold text-foreground">The core</h3>
        <p className="mt-1 text-sm text-muted-foreground">Every grade-10 student sits these in June; a family reserving on its own must include them.</p>
        <ErrorLine message={toggle.error ? errorText(toggle.error) : null} />
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {igcse.map((o) => (
            <label key={o.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <input type="checkbox" checked={o.grade10Core} disabled={toggle.isPending || session.status === 'closed'} onChange={(e) => toggle.mutate({ offerId: o.id, grade10Core: e.target.checked })} />
              <bdi data-i18n-skip="true">{o.subject.name}</bdi>
            </label>
          ))}
          {igcse.length === 0 && <p className="text-sm text-muted-foreground">No IGCSE subject in this session yet.</p>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => { commit.reset(); preview.mutate(); }} disabled={preview.isPending || session.status === 'closed'}>{preview.isPending ? 'Working…' : 'Preview'}</Button>
          {p && p.totals.lines > 0 && (
            <Button onClick={() => commit.mutate()} disabled={commit.isPending}>
              {commit.isPending ? 'Registering…' : <><span>Register grade 10</span>&nbsp;<span>({p.totals.lines})</span></>}
            </Button>
          )}
        </div>
        <ErrorLine message={preview.error ? errorText(preview.error) : commit.error ? errorText(commit.error) : null} />
        {commit.data && (
          <Notice tone="success">
            <span>{commit.data.lines}</span> <span>lines made for</span> <span>{commit.data.students}</span> <span>students.</span>
            {commit.data.failed.length > 0 && <> <span>Not registered:</span> {commit.data.failed.map((f) => <span key={f.studentId}> <bdi data-i18n-skip="true">{f.name}</bdi> — <span>{f.reason}</span>;</span>)}</>}
          </Notice>
        )}
        {p && (
          <>
            <p className="text-sm text-muted-foreground">
              <span>{p.totals.students}</span> <span>grade-10 students</span> · <span>{p.totals.toRegister}</span> <span>to register</span> · <span>{p.totals.lines}</span> <span>lines</span>{' '}
              · <span>{p.totals.alreadyDone}</span> <span>already done</span> · <span>{p.totals.refused}</span> <span>cannot be registered</span>
            </p>
            {p.totals.lines === 0 && <Notice tone="neutral">Nothing to do: every grade-10 student has the core, or cannot be registered.</Notice>}
            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-4 py-2 text-start font-medium">Student</th><th className="px-4 py-2 text-start font-medium">Lines</th></tr>
                </thead>
                <tbody>
                  {p.students.map((s) => (
                    <tr key={s.studentId} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 align-top"><bdi data-i18n-skip="true">{s.name}</bdi></td>
                      <td className="px-4 py-2 align-top">
                        {s.refused ? <Badge tone="danger">{s.refused}</Badge> : s.lines.length === 0 && s.skipped.length === 0 ? <Badge tone="success">Done</Badge> : (
                          <span className="flex flex-wrap gap-x-3 gap-y-1">
                            {s.lines.map((l) => (
                              <span key={l.offerItemId}><bdi data-i18n-skip="true">{l.subjectName}</bdi> <Money amount={l.price} />{l.provisional && <> <Badge tone="info">provisional</Badge></>}</span>
                            ))}
                            {s.skipped.map((k) => <span key={k.subjectName}><Badge tone="warning"><bdi data-i18n-skip="true">{k.subjectName}</bdi></Badge> <span className="text-xs text-muted-foreground">{k.reason}</span></span>)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
