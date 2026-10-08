'use client';

/**
 * Charges, shared by the Charges screen, the desk and the session's Money tab
 * (RESERVATIONS_REWORK.md §3.6, §3.10): the fetchers — typed by the API, never by hand
 * (PATTERNS.md) — the words, and the collect action. Text carrying a number, a name or a date is
 * split into its own nodes so the page translator (lib/i18n.tsx, lib/i18n-money.ts) finds the
 * words.
 */

import { useState } from 'react';
import { api } from '~/lib/hono';
import { apiResponse, CHARGE_KIND_LABELS, CHARGE_STATUS_LABELS, IN_SCHOOL_INSTRUMENTS, IN_SCHOOL_INSTRUMENT_LABELS, type ChargeStatus } from '@repo/validations';
import { Badge, type Tone } from '~/components/ui/tone';
import { Button } from '~/components/ui/button';
import { Money } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';

// ─── Fetchers ────────────────────────────────────────────────────────────────

type ChargesQuery = { studentId?: string; status?: ChargeStatus; sessionId?: string };
export const fetchCharges = (query: ChargesQuery) => apiResponse(api.v1.charges.$get({ query }));
export type ChargeRow = Awaited<ReturnType<typeof fetchCharges>>[number];
export const CHARGES_KEY = ['charges'] as const;

const collectRoute = api.v1.registrations.desk.collect;
export const collectAtDesk = (json: Parameters<typeof collectRoute.$post>[0]['json']) => apiResponse(collectRoute.$post({ json }));
export type Collected = Awaited<ReturnType<typeof collectAtDesk>>;
export type Instrument = (typeof IN_SCHOOL_INSTRUMENTS)[number];

// ─── Words ───────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, Tone> = { requested: 'info', pending_payment: 'warning', paid: 'success', cancelled: 'neutral', refunded: 'neutral' };

export function ChargeStatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{CHARGE_STATUS_LABELS[status as ChargeStatus] ?? status}</Badge>;
}

export function kindLabel(kind: string) {
  return CHARGE_KIND_LABELS[kind as keyof typeof CHARGE_KIND_LABELS] ?? kind;
}

/** What the desk took, in one sentence per part, and what it could not take. */
export function CollectedNotice({ r }: { r: Collected }) {
  return (
    <div className="space-y-1">
      <p><span>Collected</span> <Money amount={r.collected} /><span>.</span></p>
      {r.schoolFee && <p><span>School fee</span> <bdi dir="ltr">{r.schoolFee.academicYear}</bdi>: <Money amount={r.schoolFee.amount} /></p>}
      {r.payments.length > 0 && <p><span>{r.payments.length}</span> <span>{r.payments.length === 1 ? 'payment' : 'payments'}</span><span>, one per deadline.</span></p>}
      {r.receipts.length > 0 && <p><span>Receipts to hand over:</span> <bdi dir="ltr">{r.receipts.map((x) => x.receiptNumber).join(', ')}</bdi></p>}
      {r.notCollected.map((n, i) => (
        <p key={i} className="font-medium"><span>Not collected — hand this money back:</span> <bdi>{n.series.join(', ')}</bdi> <Money amount={n.amount} /> (<span>{n.reason}</span>)</p>
      ))}
    </div>
  );
}

/** The instrument and the button: one action collects everything ticked. */
export function CollectBar({ total, disabled, pending, onCollect }: {
  total: number; disabled: boolean; pending: boolean; onCollect: (instrument: Instrument) => void;
}) {
  const [instrument, setInstrument] = useState<Instrument>('cash');
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label className="text-sm text-muted-foreground" htmlFor="collect-instrument">Paid with</label>
      <select id="collect-instrument" value={instrument} onChange={(e) => setInstrument(e.target.value as Instrument)}
        className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground">
        {IN_SCHOOL_INSTRUMENTS.map((i) => <option key={i} value={i}>{IN_SCHOOL_INSTRUMENT_LABELS[i]}</option>)}
      </select>
      <Button size="sm" disabled={disabled || pending} onClick={() => onCollect(instrument)}>
        {pending ? <span>Collecting…</span> : <><span>Collect</span> <Money amount={total} /></>}
      </Button>
    </div>
  );
}
