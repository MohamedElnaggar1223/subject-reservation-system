'use client';

/**
 * The desk's collection (RESERVATIONS_REWORK.md §3.10 item 1): everything the student owes now —
 * subjects waiting for payment, charges (board services, instalments, adjustments) and the year's
 * school fee, pushed or not — ticked and taken in one action, each part its own payment (lines per
 * entry deadline, charges per deadline or plan line, the school fee on its own path, first).
 * `AlsoCollect` offers the same charges and fee beside a reservation at the desk.
 *
 * In the sheet the officer adds the columns by hand and writes one receipt per column; here the
 * ticked total is the money in hand, and each part gets its own receipt.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Notice } from '~/components/ui/tone';
import { Money, Day } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import {
  fetchCharges, collectAtDesk, CHARGES_KEY, CollectBar, CollectedNotice, kindLabel, type Collected, type ChargeRow,
} from '~/app/(app)/(charges)/charges/charges-shared';

const fetchSummary = (id: string) => apiResponse(api.v1.users[':id'].summary.$get({ param: { id } }));
type Summary = Awaited<ReturnType<typeof fetchSummary>>;

/** What the student owes now, as the desk collects it. */
function useOwed(studentId: string, summary: Summary | undefined) {
  const charges = useQuery({ queryKey: [...CHARGES_KEY, 'student', studentId], queryFn: () => fetchCharges({ studentId }) });
  return useMemo(() => {
    const rows = charges.data ?? [];
    // A line under a live plan is paid by its instalments (they are charges).
    const planLines = new Set(rows.filter((c) => c.kind === 'instalment' && (c.status === 'pending_payment' || c.status === 'paid')).map((c) => c.registrationId));
    const lines = (summary?.registrations ?? []).filter((r) => r.status === 'pending_payment' && !planLines.has(r.id));
    const payable = rows.filter((c) => c.status === 'pending_payment' && c.kind !== 'school_fee_push' && !c.openPaymentId);
    const requested = rows.filter((c) => c.status === 'requested');
    const pushes = rows.filter((c) => c.kind === 'school_fee_push' && c.status === 'pending_payment');
    const fees = (summary?.schoolFeesDue ?? []).map((f) => ({ ...f, push: pushes.find((p) => p.academicYear === f.academicYear) ?? null }));
    return { lines, payable, requested, fees, loading: charges.isLoading };
  }, [charges.data, charges.isLoading, summary]);
}

export function DeskCollectPanel({ studentId, summary, onDone }: { studentId: string; summary: Summary; onDone: () => void }) {
  const queryClient = useQueryClient();
  const owed = useOwed(studentId, summary);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<Collected | null>(null);
  const [error, setError] = useState('');
  const isOn = (key: string) => !unticked.has(key);
  const flip = (key: string) => setUnticked((u) => {
    const next = new Set(u);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const lineIds = owed.lines.filter((l) => isOn(`l:${l.id}`)).map((l) => l.id);
  const chargeIds = owed.payable.filter((c) => isOn(`c:${c.id}`)).map((c) => c.id);
  const fee = owed.fees.find((f) => isOn(`f:${f.academicYear}`));
  const total = owed.lines.filter((l) => lineIds.includes(l.id)).reduce((s, l) => s + l.priceAtRegistration, 0)
    + owed.payable.filter((c) => chargeIds.includes(c.id)).reduce((s, c) => s + c.amount, 0)
    + (fee?.amount ?? 0);

  const collect = useMutation({
    mutationFn: (instrumentUsed: Parameters<typeof collectAtDesk>[0]['instrumentUsed']) => collectAtDesk({
      studentId, registrationIds: lineIds, chargeIds, instrumentUsed, escrowAmountToApply: 0,
      ...(fee ? { schoolFeeYear: fee.academicYear } : {}),
    }),
    onSuccess: (r) => { setResult(r); setError(''); setUnticked(new Set()); queryClient.invalidateQueries({ queryKey: CHARGES_KEY }); onDone(); },
    onError: (err: Error) => setError(err.message),
  });

  if (!owed.lines.length && !owed.payable.length && !owed.fees.length && !owed.requested.length) {
    return result ? <Notice tone="success" title="Collected at the desk"><CollectedNotice r={result} /></Notice> : null;
  }
  return (
    <section aria-labelledby="desk-owed" className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 id="desk-owed" className="font-display text-sm font-semibold text-foreground">To collect now</h3>
        <CollectBar total={total} disabled={!lineIds.length && !chargeIds.length && !fee} pending={collect.isPending} onCollect={(i) => collect.mutate(i)} />
      </div>
      <ul className="divide-y divide-border text-sm">
        {owed.fees.map((f) => (
          <Row key={`f:${f.academicYear}`} checked={isOn(`f:${f.academicYear}`)} onChange={() => flip(`f:${f.academicYear}`)}
            title={<><span>School fee</span> <bdi dir="ltr">{f.academicYear}</bdi></>}
            detail={f.push ? <><span>pushed, due</span> <Day iso={f.push.dueAt} /></> : <span>the registration gate asks for it</span>}
            amount={f.amount} />
        ))}
        {owed.lines.map((l) => (
          <Row key={`l:${l.id}`} checked={isOn(`l:${l.id}`)} onChange={() => flip(`l:${l.id}`)}
            title={<bdi>{l.subject.name}</bdi>} detail={<><span>subject waiting for payment</span> · <bdi>{l.session.name}</bdi></>} amount={l.priceAtRegistration} />
        ))}
        {owed.payable.map((c) => (
          <Row key={`c:${c.id}`} checked={isOn(`c:${c.id}`)} onChange={() => flip(`c:${c.id}`)}
            title={<bdi>{c.description}</bdi>} detail={<><span>{kindLabel(c.kind)}</span> · <span>due</span> <Day iso={c.dueAt} /></>} amount={c.amount} />
        ))}
        {owed.requested.map((c: ChargeRow) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-muted-foreground">
            <span><bdi>{c.description}</bdi> · <span>asked for by the family — accept it on the</span> <Link href="/charges" className="text-primary underline">Charges</Link> <span>page first</span></span>
            <Money amount={c.amount} />
          </li>
        ))}
      </ul>
      {error && <div className="px-5 pb-4"><Notice tone="danger">{error}</Notice></div>}
      {result && <div className="px-5 pb-4"><Notice tone={result.notCollected.length ? 'warning' : 'success'} title="Collected at the desk"><CollectedNotice r={result} /></Notice></div>}
    </section>
  );
}

function Row({ checked, onChange, title, detail, amount }: { checked: boolean; onChange: () => void; title: React.ReactNode; detail: React.ReactNode; amount: number }) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-2.5">
      <label className="flex min-w-0 items-start gap-3">
        <input type="checkbox" checked={checked} onChange={onChange} className="mt-1 h-4 w-4" />
        <span>
          <span className="block font-medium text-foreground">{title}</span>
          <span className="block text-xs text-muted-foreground">{detail}</span>
        </span>
      </label>
      <Money amount={amount} />
    </li>
  );
}

/** Beside a reservation: the student's charges and the year's fee, taken in the same action. */
export type Extras = { chargeIds: string[]; schoolFeeYear?: string; total: number };

export function AlsoCollect({ studentId, value, onChange }: { studentId: string; value: Extras; onChange: (v: Extras) => void }) {
  const summary = useQuery({ queryKey: ['desk', 'summary', studentId], queryFn: () => fetchSummary(studentId) });
  const owed = useOwed(studentId, summary.data);
  if (!owed.payable.length && !owed.fees.length) return null;
  const change = (next: Omit<Extras, 'total'>) => onChange({
    ...next,
    total: owed.payable.filter((c) => next.chargeIds.includes(c.id)).reduce((t, c) => t + c.amount, 0)
      + (owed.fees.find((f) => f.academicYear === next.schoolFeeYear)?.amount ?? 0),
  });
  const toggleCharge = (id: string) => change({ ...value, chargeIds: value.chargeIds.includes(id) ? value.chargeIds.filter((x) => x !== id) : [...value.chargeIds, id] });
  return (
    <fieldset className="mb-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-medium text-foreground">Also collect now</legend>
      <ul className="space-y-1.5 text-sm">
        {owed.fees.map((f) => (
          <li key={f.academicYear} className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={value.schoolFeeYear === f.academicYear}
                onChange={(e) => change({ ...value, schoolFeeYear: e.target.checked ? f.academicYear : undefined })} className="h-4 w-4" />
              <span><span>School fee</span> <bdi dir="ltr">{f.academicYear}</bdi> <span className="text-xs text-muted-foreground">(collected first: the registration needs it)</span></span>
            </label>
            <Money amount={f.amount} />
          </li>
        ))}
        {owed.payable.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={value.chargeIds.includes(c.id)} onChange={() => toggleCharge(c.id)} className="h-4 w-4" />
              <span><bdi>{c.description}</bdi> <span className="text-xs text-muted-foreground">{kindLabel(c.kind)}</span></span>
            </label>
            <Money amount={c.amount} />
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
