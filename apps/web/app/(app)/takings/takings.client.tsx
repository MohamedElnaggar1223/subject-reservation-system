'use client';

/**
 * Daily Takings Client (UX_AUDIT G4)
 *
 * What the day's report means (money audit MA-04, MA-05, MA-09, MO-11):
 * - Money in is every payment confirmed that day. A payment reversed later
 *   with the money handed back stays here, marked; the hand-back is money
 *   out on the day it was made.
 * - Money out is the reversals made that day that handed money back, and
 *   each hand-over of refund cash made that day.
 * - Corrections: a payment confirmed by mistake (reversed later, no money
 *   ever received) leaves this day's money in and is listed here with who
 *   reversed it and when; the day it was reversed does not move.
 * - The drawer counts cash only: InstaPay lands in the bank, card in the
 *   terminal.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, IN_SCHOOL_INSTRUMENT_LABELS, PAYMENT_METHOD_LABELS, formatEgp } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { ErrorState, LoadingState, EmptyState } from '~/components/ui/query-state';

// Typed by the API, never by hand (PATTERNS.md).
const fetchTakings = (date: string) => apiResponse(api.v1.payments['daily-takings'].$get({ query: { date } }));

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The payment method's label first: the 'instapay' line holds transfers the
// app took as well as ones recorded at the desk, so it is not "(at desk)".
function instrumentLabel(key: string): string {
  return (
    PAYMENT_METHOD_LABELS[key as keyof typeof PAYMENT_METHOD_LABELS] ??
    IN_SCHOOL_INSTRUMENT_LABELS[key as keyof typeof IN_SCHOOL_INSTRUMENT_LABELS] ??
    key
  );
}

// The school's clock, 24-hour, as every other screen writes a time (F6: "07:41 AM" here, "07:41" elsewhere).
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Cairo' }) : '—';

export default function TakingsClient(): React.JSX.Element {
  const [date, setDate] = useState(todayStr());

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ['finance', 'takings', date],
    queryFn: () => fetchTakings(date),
  });

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto animate-fade-up">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Daily Takings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Everything confirmed and paid out on this day — reconcile the cash drawer against it.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="date"
            aria-label="Day"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <Button variant="outline" onClick={() => window.print()}>Print</Button>
        </div>
      </div>

      <h2 className="hidden print:block text-lg font-bold mb-4">Daily takings — {date}</h2>

      {isFetching ? (
        <div className="print:hidden"><LoadingState label="Loading the day's takings…" /></div>
      ) : isError ? (
        <ErrorState
          title="Takings did not load"
          message="Do not reconcile from this screen until it loads — this is a connection problem, not an empty day."
          onRetry={() => refetch()}
        />
      ) : !data || (data.rows.length === 0 && data.reversed.length === 0 && data.cashRefunds.length === 0 && data.corrected.length === 0 && data.correctionsRecorded.length === 0 && data.lateTransfers.length === 0) ? (
        <EmptyState title={`No money moved on ${date}.`} />
      ) : (
        <>
          {/* Totals */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            <div className="bg-card rounded-xl border border-border shadow-sm p-4">
              <p className="text-xs text-muted-foreground">Cash in drawer</p>
              <p className="text-2xl font-bold text-foreground">{formatEgp(data.totals.drawer.net)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatEgp(data.totals.drawer.cashIn)} cash in · {formatEgp(data.totals.drawer.cashOut)} cash out
              </p>
            </div>
            <div className="bg-card rounded-xl border border-border shadow-sm p-4">
              <p className="text-xs text-muted-foreground">Money in</p>
              <p className="text-2xl font-bold text-foreground">{formatEgp(data.totals.moneyIn)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                all instruments · plus {formatEgp(data.totals.escrowApplied)} paid from balances
                {data.totals.correctedTotal > 0 && (
                  <> · {formatEgp(data.totals.correctedTotal)} corrected out
                    {data.totals.correctedEscrow > 0 && <> (and {formatEgp(data.totals.correctedEscrow)} to balances)</>}</>
                )}
                {data.totals.lateTransferTotal > 0 && <> · incl. {formatEgp(data.totals.lateTransferTotal)} transfers found later</>}
              </p>
            </div>
            <div className="bg-card rounded-xl border border-border shadow-sm p-4">
              <p className="text-xs text-muted-foreground">Money out</p>
              <p className="text-2xl font-bold text-foreground">{formatEgp(data.totals.moneyOut)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatEgp(data.totals.cashRefunded)} refunds · {formatEgp(data.totals.reversedTotal)} reversed
                {data.totals.closedMonthCorrectionTotal > 0 && <> · less {formatEgp(data.totals.closedMonthCorrectionTotal)} corrections to closed months</>}
                {' '}· net {formatEgp(data.totals.net)}
              </p>
            </div>
            <div className="bg-card rounded-xl border border-border shadow-sm p-4">
              <p className="text-xs text-muted-foreground">Money in by instrument</p>
              {Object.entries(data.totals.byInstrument).map(([k, v]) => (
                <p key={k} className="text-sm text-foreground flex justify-between">
                  <span>{instrumentLabel(k)}</span>
                  <span className="font-medium">{formatEgp(v)}</span>
                </p>
              ))}
            </div>
          </div>

          {/* Money in */}
          {data.rows.length > 0 && (
            <div className="bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">Money in</h2>
              </div>
              <table className="w-full min-w-[640px] text-sm">
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
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{time(r.confirmedAt)}</td>
                      <td className="px-4 py-2.5 text-foreground">{r.student?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-card-foreground capitalize">
                        {r.purpose.replace('_', ' ')}
                        {r.reversedAt && (
                          <span className="ml-2 text-xs normal-case text-muted-foreground">
                            (reversed {new Date(r.reversedAt).toLocaleDateString()})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-card-foreground">{instrumentLabel(r.instrumentUsed ?? r.paymentMethod)}</td>
                      <td className="px-4 py-2.5 text-card-foreground">{r.confirmedByUser?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-foreground whitespace-nowrap">{formatEgp(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Money out */}
          {(data.reversed.length > 0 || data.cashRefunds.length > 0) && (
            <div className="mt-6 bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">Money out</h2>
              </div>
              <table className="w-full min-w-[640px] text-sm">
                <tbody className="divide-y divide-border">
                  {data.cashRefunds.map((d) => (
                    <tr key={d.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{time(d.disbursedAt)}</td>
                      <td className="px-4 py-2.5 text-foreground">{d.student?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-card-foreground">Cash refund</td>
                      <td className="px-4 py-2.5 text-card-foreground">{d.disbursedByUser?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-destructive whitespace-nowrap">− {formatEgp(d.amount)}</td>
                    </tr>
                  ))}
                  {data.reversed.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{time(r.reversedAt)}</td>
                      <td className="px-4 py-2.5 text-foreground">{r.student?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-card-foreground">
                        Reversed ({r.purpose.replace('_', ' ')}, {instrumentLabel(r.instrumentUsed ?? r.paymentMethod)}
                        {r.confirmedAt && new Date(r.confirmedAt).toDateString() !== new Date(r.reversedAt ?? r.confirmedAt).toDateString()
                          ? `, confirmed ${new Date(r.confirmedAt).toLocaleDateString()}`
                          : ''}
                        )
                      </td>
                      <td className="px-4 py-2.5 text-card-foreground">{r.reversedByUser?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-destructive whitespace-nowrap">− {formatEgp(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Transfers found on the statement after their payment had closed, credited to escrow */}
          {data.lateTransfers.length > 0 && (
            <div className="mt-6 bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">Transfers found later</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Found on the bank statement after their payment had closed, and added to the family&apos;s balance. Included in money in.
                </p>
              </div>
              <table className="w-full min-w-[640px] text-sm">
                <tbody className="divide-y divide-border">
                  {data.lateTransfers.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{time(r.lateTransferAt)}</td>
                      <td className="px-4 py-2.5 text-foreground">{r.student?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-card-foreground">
                        InstaPay <span className="font-mono">{r.verificationReference}</span> — added to the balance
                        {r.lateTransferAmount !== r.amount && <> (the payment was for {formatEgp(r.amount)})</>}
                      </td>
                      <td className="px-4 py-2.5 text-card-foreground">{r.lateTransferByUser?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-foreground whitespace-nowrap">{formatEgp(r.lateTransferAmount ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Corrections (MO-11): confirmed by mistake, no money ever received */}
          {(data.corrected.length > 0 || data.correctionsRecorded.length > 0) && (
            <div className="mt-6 bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">Corrections</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Payments confirmed by mistake and reversed, with no money ever received. The figures above already leave them out; one
                  confirmed in a month already closed is corrected here instead, and that month stays as printed.
                </p>
              </div>
              <table className="w-full min-w-[640px] text-sm">
                <tbody className="divide-y divide-border">
                  {data.corrected.map((r) => (
                    <tr key={`c-${r.id}`} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{time(r.confirmedAt)}</td>
                      <td className="px-4 py-2.5 text-foreground">{r.student?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-card-foreground">
                        Confirmed this day by {r.confirmedByUser?.name ?? '—'}; reversed{' '}
                        {r.reversedAt ? new Date(r.reversedAt).toLocaleDateString() : ''} by {r.reversedByUser?.name ?? '—'}
                        {' '}({instrumentLabel(r.instrumentUsed ?? r.paymentMethod)}
                        {r.escrowAmountApplied > 0 ? `; ${formatEgp(r.escrowAmountApplied)} from the balance, returned` : ''})
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-muted-foreground line-through whitespace-nowrap">{formatEgp(r.amount)}</td>
                    </tr>
                  ))}
                  {data.correctionsRecorded
                    .filter((r) => !data.corrected.some((c) => c.id === r.id))
                    .map((r) => (
                      <tr key={`r-${r.id}`} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{time(r.reversedAt)}</td>
                        <td className="px-4 py-2.5 text-foreground">{r.student?.name ?? '—'}</td>
                        <td className="px-4 py-2.5 text-card-foreground">
                          {r.postedHere ? (
                            <>
                              Reversed this day by {r.reversedByUser?.name ?? '—'}: confirmed{' '}
                              {r.confirmedAt ? new Date(r.confirmedAt).toLocaleDateString() : ''}, a month already closed, so corrected on this day
                              {r.escrowAmountApplied > 0 ? ` (${formatEgp(r.escrowAmountApplied)} from the balance, returned)` : ''}
                            </>
                          ) : (
                            <>
                              Reversed this day by {r.reversedByUser?.name ?? '—'}: corrects{' '}
                              {r.confirmedAt ? new Date(r.confirmedAt).toLocaleDateString() : 'the day it was confirmed'}, not this day
                            </>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">{formatEgp(r.amount)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
