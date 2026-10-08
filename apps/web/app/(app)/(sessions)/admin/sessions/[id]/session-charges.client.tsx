'use client';

/**
 * The session's charges, on its Money tab (RESERVATIONS_REWORK.md §4.6, step C): the charges of
 * its lines (instalments, price adjustments, a line's board service) and the services asked in
 * the series its items sit in — what is owed and what was paid, beside the lines. Collecting,
 * accepting, cancelling and refunding are on the Charges screen.
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Money, Day } from '../sessions-shared';
import { fetchCharges, CHARGES_KEY, ChargeStatusBadge, kindLabel } from '~/app/(app)/(charges)/charges/charges-shared';

export function SessionCharges({ sessionId }: { sessionId: string }) {
  const list = useQuery({ queryKey: [...CHARGES_KEY, 'session', sessionId], queryFn: () => fetchCharges({ sessionId }) });
  if (list.isLoading) return <LoadingState />;
  if (list.isError || !list.data) return <ErrorState onRetry={() => list.refetch()} />;
  const rows = list.data;
  const owed = rows.filter((c) => c.status === 'pending_payment' || c.status === 'requested').reduce((s, c) => s + c.amount, 0);
  const paid = rows.filter((c) => c.status === 'paid').reduce((s, c) => s + c.amount, 0);
  return (
    <section aria-labelledby="session-charges" className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 id="session-charges" className="font-display text-sm font-semibold text-foreground">Charges</h3>
        <p className="text-sm text-muted-foreground">
          <span>Owed</span> <Money amount={owed} /> · <span>Paid</span> <Money amount={paid} /> · <Link href="/charges" className="text-primary underline">Charges</Link>
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">No charge in this session yet.</p>
      ) : (
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-border bg-muted">
            <tr>
              <th className="px-4 py-2 text-start font-semibold text-muted-foreground">Student</th>
              <th className="px-4 py-2 text-start font-semibold text-muted-foreground">Charge</th>
              <th className="px-4 py-2 text-end font-semibold text-muted-foreground">Amount</th>
              <th className="px-4 py-2 text-start font-semibold text-muted-foreground">Due</th>
              <th className="px-4 py-2 text-start font-semibold text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2"><bdi className="font-medium text-foreground">{c.student.name}</bdi></td>
                <td className="px-4 py-2">
                  <bdi>{c.description}</bdi>
                  <p className="text-xs text-muted-foreground"><span>{kindLabel(c.kind)}</span>{c.registration?.subject && <> · <bdi>{c.registration.subject.name}</bdi></>}</p>
                </td>
                <td className="px-4 py-2 text-end"><Money amount={c.amount} /></td>
                <td className="px-4 py-2"><Day iso={c.dueAt} /></td>
                <td className="px-4 py-2"><ChargeStatusBadge status={c.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
