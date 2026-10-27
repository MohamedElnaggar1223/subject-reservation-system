'use client';

/**
 * Reservations, read only (COORDINATOR_REWORK.md B1, D7, D13, §5.3; Appendix A
 * `GET /sessions/:id/reservations` + `?format=csv`): who reserved what, paid or not, the earlier exam a
 * retake declared, and the answers to the extra questions — with the export. Payments are the finance
 * desk's: nothing here changes a reservation.
 *
 * The spreadsheet version: each form's response sheet, one per subject, merged by hand to see a child's
 * subjects. Here every subject is one list, a line per reservation, and the export is that list.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { Button } from '~/components/ui/button';
import { Badge, type Tone } from '~/components/ui/tone';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { downloadCsv } from '~/lib/csv';
import { cn } from '~/lib/utils';
import { Money, ErrorLine } from '../sessions-shared';
import { fetchReservations, reservationsKey, refusalText, subjectTitle, examMonth, TH as th, TD as td, type SetupSession } from '../setup-shared';

type Line = Awaited<ReturnType<typeof fetchReservations>>['lines'][number];

/** Where a reservation stands, in plain words (every status a live line can have). */
const STATUS: Record<string, { words: string; tone: Tone }> = {
  confirmed: { words: 'Paid', tone: 'success' },
  pending_payment: { words: 'Waiting for payment', tone: 'warning' },
  pending_approval: { words: 'Waiting for the parent to approve', tone: 'warning' },
  preregistered: { words: 'Preregistered', tone: 'info' },
  dropped_pending_receipt: { words: 'Dropped: the receipt is to come back to the school', tone: 'neutral' },
};

/**
 * A reservation's subject with its group, as her screens name it ("Arabic O.L."): the line names the subject alone,
 * so it is matched to the session's offering by name, then by its row's kind and codes when two subjects share it.
 */
function subjectOf(s: SetupSession, l: Line): string {
  const named = s.offerings.filter((o) => o.subject.name === l.subject);
  const sameRow = named.filter((o) => o.rows.some((r) => r.kind === l.kind && r.referenceCodes.join() === l.codes.join()));
  const one = named.length === 1 ? named[0] : sameRow.length === 1 ? sameRow[0] : undefined;
  return one ? subjectTitle(one) : l.subject;
}

/** The exam a retake declared, as the school says it: Pearson's October International A Level is "November" (D12). */
function declared(carriedFrom: string): string {
  const m = /^([A-Za-z]+) (\d{4})$/.exec(carriedFrom);
  return m ? examMonth(m[1]!.toLowerCase(), Number(m[2])) : carriedFrom;
}

export default function ReservationsTab({ s }: { s: SetupSession }) {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: reservationsKey(s.id), queryFn: () => fetchReservations(s.id) });
  const exportCsv = useMutation({
    mutationFn: async () => {
      const res = await api.v1.sessions[':id'].reservations.$get({ param: { id: s.id }, query: { format: 'csv' } });
      if (!res.ok) throw new Error('The export did not download; nothing is lost. Try again.');
      // The API's file already starts with its header; downloadCsv adds the mark Excel reads Arabic by.
      downloadCsv(`reservations-${s.name.replace(/[^\w]+/g, '-').toLowerCase()}.csv`, await res.text());
    },
  });
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;
  const t = data.totals;
  if (!data.lines.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-sm">
        <span>No reservations yet.</span>{s.status === 'draft' && <> <span>A draft is invisible to families.</span></>}
      </div>
    );
  }
  const questions = data.questions;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-foreground">
          <span>{t.lines}</span> <span>{t.lines === 1 ? 'reservation' : 'reservations'}</span> · <span>{t.students}</span> <span>{t.students === 1 ? 'student' : 'students'}</span> · <span>{t.paid}</span> <span>paid</span> · <span>{t.unpaid}</span> <span>waiting for payment</span>.{' '}
          <span className="text-muted-foreground">Read only: payments are the finance desk&apos;s.</span>
        </p>
        <Button variant="outline" size="sm" disabled={exportCsv.isPending} onClick={() => exportCsv.mutate()}>Export (CSV)</Button>
      </div>
      <ErrorLine message={exportCsv.error ? refusalText(exportCsv.error) : null} />
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={th}>Student</th><th className={th}>Subject</th><th className={th}>What</th><th className={th}>Teacher</th>
              <th className={th}>Earlier exam</th><th className={th}>Price</th><th className={th}>Status</th>
              {questions.length > 0 && <th className={th}>Answers</th>}
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => {
              const st = data.students.find((x) => x.id === l.studentId);
              return (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className={td}><bdi data-i18n-skip="true">{l.studentName}</bdi></td>
                  <td className={td}><bdi data-i18n-skip="true">{subjectOf(s, l)}</bdi></td>
                  <td className={td}><span data-i18n-skip="true">{l.option}</span></td>
                  <td className={td}>{l.teacher ? <bdi data-i18n-skip="true">{l.teacher}</bdi> : <span className="text-muted-foreground">{l.mode === 'self_study' ? 'self study' : 'to be announced'}</span>}</td>
                  <td className={td}>{l.carriedFrom ? <><span>{declared(l.carriedFrom)}</span> <span className="text-xs text-muted-foreground">declared</span></> : '—'}</td>
                  <td className={cn(td, 'whitespace-nowrap')}><Money amount={l.price} />{l.provisional && <> <span className="text-xs text-muted-foreground">not final</span></>}</td>
                  <td className={td}><Badge tone={STATUS[l.status]?.tone ?? 'neutral'}>{STATUS[l.status]?.words ?? l.status}</Badge></td>
                  {questions.length > 0 && (
                    <td className={cn(td, 'text-xs')}>
                      {questions.map((q, i) => <span key={q.id}>{i > 0 && ' · '}<bdi data-i18n-skip="true">{st?.answers.find((a) => a.questionId === q.id)?.value ?? '—'}</bdi></span>)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">“Earlier exam” is what the family declared for a one-paper retake or an A.2.: listed for anyone who wants to check it.</p>
    </div>
  );
}
