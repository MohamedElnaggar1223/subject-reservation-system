'use client';

/**
 * The To verify tab (RESERVATIONS_REWORK.md §3.5, §4.2; docs/features/RESERVATIONS_LINES.md §3):
 * the sittings families and the desk declared, awaiting the coordinator (the admin may answer
 * too; the finance desk with the board's statement in hand), the most urgent deadline first.
 *
 * The spreadsheet version: the desk checks the "ONLY 2nd entry" column against whatever the
 * family brings, one row at a time, with no list of who is still unchecked. Here the list is the
 * session's, each row says what an answer does before it is given: verified, the line stands; not
 * confirmed, an unpaid line ends (the family may reserve a first entry), a paid one stands as a
 * first entry before the board's first-entry deadline and is dropped with its refund after it.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferRequestType } from 'hono/client';
import { api } from '~/lib/hono';
import { apiResponse, FINANCE_ROLES, hasRole, ROLES } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/tone';
import { ErrorState, LoadingState, EmptyState } from '~/components/ui/query-state';
import { Money, Day, Modal, Field, INPUT_CLASS, TEXTAREA_CLASS, ErrorLine, errorText, type SessionDetail } from '../sessions-shared';

const fetchToVerify = (id: string, show: 'awaiting' | 'decided') => apiResponse(api.v1.sessions[':id']['to-verify'].$get({ param: { id }, query: { show } }));
type Row = Awaited<ReturnType<typeof fetchToVerify>>['lines'][number];
export const toVerifyKey = (id: string) => ['sessions', id, 'to-verify'] as const;
const answer = (id: string, json: InferRequestType<(typeof api.v1.registrations)[':id']['verify-prior']['$post']>['json']) =>
  apiResponse(api.v1.registrations[':id']['verify-prior'].$post({ param: { id }, json }));

export default function ToVerifyTab({ session, viewerRole }: { session: SessionDetail; viewerRole: string }): React.JSX.Element {
  const [show, setShow] = useState<'awaiting' | 'decided'>('awaiting');
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: [...toVerifyKey(session.id), show], queryFn: () => fetchToVerify(session.id, show) });
  const [acting, setActing] = useState<{ row: Row; outcome: 'verified' | 'rejected' } | null>(null);
  const finance = hasRole(viewerRole, ...FINANCE_ROLES) && viewerRole !== ROLES.ADMIN;
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Retakes and carried sittings declared by a family or at the desk. Verified, the line stands. Not confirmed: a line not yet paid ends and the family may reserve a first entry; a paid line stands as a first entry before the board&apos;s first-entry deadline, and is dropped with its refund after it.
        </p>
        <div className="flex rounded-lg border border-border bg-card p-0.5 text-sm" role="group" aria-label="Show">
          {(['awaiting', 'decided'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)}
              className={`rounded-md px-3 py-1.5 ${show === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {s === 'awaiting' ? 'To verify' : 'Answered'}
            </button>
          ))}
        </div>
      </div>
      {data.lines.length === 0 ? <EmptyState title={show === 'awaiting' ? 'Nothing to verify' : 'Nothing answered yet'} /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-start font-medium">Student</th>
                <th className="px-4 py-2 text-start font-medium">Line</th>
                <th className="px-4 py-2 text-start font-medium">Declared sitting</th>
                <th className="px-4 py-2 text-start font-medium">Declared by</th>
                <th className="px-4 py-2 text-start font-medium">Paid</th>
                <th className="px-4 py-2 text-start font-medium">{show === 'awaiting' ? 'Answer by' : 'Answer'}</th>
                {show === 'awaiting' && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {data.lines.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-2">
                    <div className="font-medium text-foreground"><bdi data-i18n-skip="true">{r.student.name}</bdi></div>
                    <div className="text-xs text-muted-foreground"><bdi data-i18n-skip="true">{r.student.number ?? ''}</bdi>{r.student.section && <> · <bdi data-i18n-skip="true">{r.student.section}</bdi></>}</div>
                  </td>
                  <td className="px-4 py-2">
                    <bdi data-i18n-skip="true">{r.line.subject}</bdi>{r.line.kind !== 'whole' && <> — <bdi data-i18n-skip="true">{r.line.item}</bdi></>}
                    <div className="text-xs text-muted-foreground">
                      <span>{r.attempt === 'retake' ? 'Retake' : r.line.carriesForward ? 'Carry forward' : 'First entry'}</span> · <span>{r.mode === 'self_study' ? 'self-study' : 'in school'}</span> · <Money amount={r.price} />
                    </div>
                  </td>
                  <td className="px-4 py-2"><bdi data-i18n-skip="true">{r.sitting?.name ?? '—'}</bdi></td>
                  <td className="px-4 py-2">
                    <span>{r.declaredBy.channel === 'family' ? 'The family' : 'The desk'}</span>
                    <div className="text-xs text-muted-foreground"><bdi data-i18n-skip="true">{r.declaredBy.name}</bdi> · <Day iso={r.declaredAt} /></div>
                  </td>
                  <td className="px-4 py-2">{r.paid ? <Badge tone="success">paid</Badge> : r.paymentOpen ? <Badge tone="warning">payment in progress</Badge> : <Badge tone="neutral">not yet</Badge>}</td>
                  <td className="px-4 py-2">
                    {show === 'awaiting' ? (
                      <>
                        <Day iso={r.deadline} />
                        {r.daysLeft !== null && <div className={`text-xs ${r.daysLeft <= 7 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{r.daysLeft <= 0 ? 'passed' : <><span>{r.daysLeft}</span> <span>{r.daysLeft === 1 ? 'day left' : 'days left'}</span></>}</div>}
                      </>
                    ) : (
                      <>
                        {r.outcome === 'verified' ? <Badge tone="success">verified</Badge> : <Badge tone="danger">not confirmed</Badge>}
                        {r.declarationRejected && <div className="text-xs text-muted-foreground">stands as a first entry</div>}
                        <div className="text-xs text-muted-foreground"><bdi data-i18n-skip="true">{r.decidedBy ?? ''}</bdi> · <Day iso={r.decidedAt} /></div>
                      </>
                    )}
                  </td>
                  {show === 'awaiting' && (
                    <td className="whitespace-nowrap px-4 py-2 text-end">
                      <Button size="sm" variant="outline" onClick={() => setActing({ row: r, outcome: 'verified' })}>Verify</Button>{' '}
                      <Button size="sm" variant="ghost" className="text-red-700 dark:text-red-400" onClick={() => setActing({ row: r, outcome: 'rejected' })}>Not confirmed</Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {acting && <AnswerModal row={acting.row} outcome={acting.outcome} finance={finance} sessionId={session.id} onClose={() => setActing(null)} />}
    </div>
  );
}

function AnswerModal({ row, outcome, finance, sessionId, onClose }: { row: Row; outcome: 'verified' | 'rejected'; finance: boolean; sessionId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [centre, setCentre] = useState('');
  const [candidate, setCandidate] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => answer(row.id, {
      outcome, reason,
      ...(evidence.trim() ? { evidence: evidence.trim() } : {}),
      ...(outcome === 'verified' && centre.trim() ? { prevCentre: centre.trim() } : {}),
      ...(outcome === 'verified' && candidate.trim() ? { prevCandidateNumber: candidate.trim() } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: toVerifyKey(sessionId) });
      qc.invalidateQueries({ queryKey: ['sessions', sessionId, 'money'] });
      onClose();
    },
    onError: (e) => setFailure(errorText(e)),
  });
  const effect = outcome === 'verified'
    ? 'The line stands as it is.'
    : row.paid
      ? 'Paid: before the board\'s first-entry deadline the line stands and is entered as a first entry (finance decides whether anything is owed); after it, the line is dropped and refunded (the paper receipt comes back first).'
      : 'Not paid: the line ends and the family is told it may reserve a first entry.';
  return (
    <Modal title={outcome === 'verified' ? 'Verify the declared sitting' : 'The sitting is not confirmed'} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          <bdi data-i18n-skip="true">{row.student.name}</bdi> · <bdi data-i18n-skip="true">{row.line.subject}</bdi> · <bdi data-i18n-skip="true">{row.sitting?.name ?? ''}</bdi>
        </p>
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{effect}</p>
        {outcome === 'verified' && row.line.carriesForward && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Previous centre (another centre only)" htmlFor="prev-centre">
              <input id="prev-centre" className={INPUT_CLASS} value={centre} onChange={(e) => setCentre(e.target.value)} />
            </Field>
            <Field label="Previous candidate number" htmlFor="prev-candidate">
              <input id="prev-candidate" className={INPUT_CLASS} value={candidate} onChange={(e) => setCandidate(e.target.value)} />
            </Field>
          </div>
        )}
        {finance && (
          <Field label="What was seen (the board's statement)" htmlFor="evidence" hint="The finance desk answers with the board's statement in hand.">
            <input id="evidence" className={INPUT_CLASS} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="e.g. Statement of results, June 2026" />
          </Field>
        )}
        <Field label="Reason" htmlFor="answer-reason">
          <textarea id="answer-reason" className={TEXTAREA_CLASS} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What was checked" />
        </Field>
        <ErrorLine message={failure} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={outcome === 'verified' ? 'default' : 'destructive'} disabled={reason.trim().length < 5 || (finance && evidence.trim().length < 3) || m.isPending}
            onClick={() => { setFailure(null); m.mutate(); }}>
            {outcome === 'verified' ? 'Verify' : 'Not confirmed'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
