'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { refundConsentText, DECLARATION_TEXT, DESK_CONSENT_TEXT, type RefundPolicySnapshot } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { fetchStatement, statementKey } from '~/components/reservations/statement';
import { Money, Day } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';

export default function SlipClient({ studentId, ids }: { studentId: string; ids: string[] }): React.JSX.Element {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: statementKey({ studentId }), queryFn: () => fetchStatement({ studentId }) });
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, [data]);
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;
  const s = data.students[0];
  if (!s) return <ErrorState title="Student not found" />;
  const lines = s.sessions.flatMap((x) => x.lines).filter((l) => ids.includes(l.id));
  const session = lines[0]?.session.name ?? '';
  const snapshot = (lines.find((l) => l.refundPolicySnapshot)?.refundPolicySnapshot ?? null) as RefundPolicySnapshot | null;
  const total = lines.reduce((a, l) => a + l.price, 0);
  const deskSigned = lines.some((l) => l.consents.some((c) => c.channel === 'desk'));
  return (
    <div className="mx-auto max-w-2xl p-8 print:max-w-none print:p-0">
      <div className="rounded-xl border border-border bg-card p-8 print:rounded-none print:border-0 print:bg-white print:text-black">
        <div className="mb-4 border-b border-border pb-4 text-center">
          <h1 className="font-display text-xl font-bold">IGCSE Subject Reservation System</h1>
          <p className="mt-1 text-sm text-muted-foreground print:text-black">Reservation slip</p>
        </div>
        <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground print:text-black">Student</dt><dd className="text-end font-medium"><bdi data-i18n-skip="true">{s.student.name}</bdi> · <span>{s.student.gradeLabel}</span></dd>
          <dt className="text-muted-foreground print:text-black">Student ID</dt><dd className="text-end font-mono">{s.student.number ?? '—'}</dd>
          <dt className="text-muted-foreground print:text-black">Session</dt><dd className="text-end"><bdi data-i18n-skip="true">{session}</bdi></dd>
        </dl>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-xs uppercase text-muted-foreground print:text-black">
            <tr><th className="py-1 text-start">Line</th><th className="py-1 text-start">Entry</th><th className="py-1 text-end">Price</th><th className="py-1 text-start ps-3">Due</th></tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-border align-top">
                <td className="py-1.5">
                  <bdi data-i18n-skip="true">{l.label}</bdi>
                  <div className="text-xs text-muted-foreground print:text-black"><bdi data-i18n-skip="true">{l.series ?? ''}</bdi>{l.teacher && <> · <bdi data-i18n-skip="true">{l.teacher}</bdi></>}</div>
                  {l.priorSitting && <div className="text-xs text-muted-foreground print:text-black"><span>from</span> <bdi data-i18n-skip="true">{l.priorSitting.name}</bdi></div>}
                </td>
                <td className="py-1.5"><span>{l.attempt === 'retake' ? 'Retake' : 'First entry'}</span>, <span>{l.mode === 'self_study' ? 'self-study' : 'in school'}</span></td>
                <td className="py-1.5 text-end"><Money amount={l.price} />{l.provisional && <> ⓟ</>}<div className="text-[10px] text-muted-foreground print:text-black" dir="ltr">{l.basisText}</div></td>
                <td className="py-1.5 ps-3">{l.status === 'confirmed' ? <span>paid</span> : <Day iso={l.dueAt} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-end text-sm font-semibold"><span>Total</span> <Money amount={total} /></p>
        {lines.some((l) => l.provisional) && <p className="text-xs text-muted-foreground print:text-black">ⓟ board fee provisional: confirmed before payment.</p>}
        <div className="mt-6 space-y-2 border-t border-border pt-4 text-xs">
          <p>{refundConsentText(snapshot)}</p>
          <p>{DECLARATION_TEXT}</p>
          {deskSigned && <p className="font-medium">{DESK_CONSENT_TEXT}.</p>}
          <div className="flex justify-between gap-8 pt-8">
            <span className="flex-1 border-t border-current pt-1 text-center">Parent signature</span>
            <span className="flex-1 border-t border-current pt-1 text-center">Desk</span>
          </div>
        </div>
      </div>
      <div className="mt-6 text-center print:hidden"><Button onClick={() => window.print()}>Print</Button></div>
    </div>
  );
}
