'use client';

/**
 * Daily Takings Client (UX_AUDIT G4)
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, IN_SCHOOL_INSTRUMENT_LABELS, PAYMENT_METHOD_LABELS } from '@repo/validations';
import { formatPrice } from '~/lib/format';
import { Button } from '~/components/ui/button';

type Takings = {
  date: string;
  rows: {
    id: string;
    amount: number;
    escrowAmountApplied: number;
    paymentMethod: string;
    purpose: string;
    instrumentUsed: string | null;
    externalReference: string | null;
    confirmedAt: string | null;
    student: { id: string; name: string } | null;
    confirmedByUser: { id: string; name: string } | null;
  }[];
  totals: { cashIn: number; escrowApplied: number; byInstrument: Record<string, number> };
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function instrumentLabel(key: string): string {
  return (
    IN_SCHOOL_INSTRUMENT_LABELS[key as keyof typeof IN_SCHOOL_INSTRUMENT_LABELS] ??
    PAYMENT_METHOD_LABELS[key as keyof typeof PAYMENT_METHOD_LABELS] ??
    key
  );
}

export default function TakingsClient(): React.JSX.Element {
  const [date, setDate] = useState(todayStr());

  const { data, isFetching } = useQuery<Takings>({
    queryKey: ['finance', 'takings', date],
    queryFn: async () =>
      (await apiResponse(api.v1.payments['daily-takings'].$get({ query: { date } }))) as Takings,
  });

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto animate-fade-up">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Daily Takings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Everything confirmed on this day — reconcile the cash drawer against it.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <Button variant="outline" onClick={() => window.print()}>Print</Button>
        </div>
      </div>

      <h2 className="hidden print:block text-lg font-bold mb-4">Daily takings — {date}</h2>

      {isFetching ? (
        <div className="flex justify-center py-10 print:hidden">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        </div>
      ) : !data || data.rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center shadow-sm">
          <p className="text-muted-foreground text-sm">No confirmed payments on {date}.</p>
        </div>
      ) : (
        <>
          {/* Totals */}
          <div className="grid gap-3 sm:grid-cols-3 mb-6">
            <div className="bg-card rounded-xl border border-border shadow-sm p-4">
              <p className="text-xs text-muted-foreground">Money in</p>
              <p className="text-2xl font-bold text-foreground">{formatPrice(data.totals.cashIn)}</p>
            </div>
            <div className="bg-card rounded-xl border border-border shadow-sm p-4">
              <p className="text-xs text-muted-foreground">Escrow applied</p>
              <p className="text-2xl font-bold text-foreground">{formatPrice(data.totals.escrowApplied)}</p>
            </div>
            <div className="bg-card rounded-xl border border-border shadow-sm p-4">
              <p className="text-xs text-muted-foreground">By instrument</p>
              {Object.entries(data.totals.byInstrument).map(([k, v]) => (
                <p key={k} className="text-sm text-foreground flex justify-between">
                  <span>{instrumentLabel(k)}</span>
                  <span className="font-medium">{formatPrice(v)}</span>
                </p>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Time</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Student</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">For</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Instrument</th>
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground">By</th>
                  <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {r.confirmedAt ? new Date(r.confirmedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{r.student?.name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-card-foreground capitalize">{r.purpose.replace('_', ' ')}</td>
                    <td className="px-4 py-2.5 text-card-foreground">{instrumentLabel(r.instrumentUsed ?? r.paymentMethod)}</td>
                    <td className="px-4 py-2.5 text-card-foreground">{r.confirmedByUser?.name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-foreground whitespace-nowrap">{formatPrice(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
