'use client';

/**
 * What the family owes beside its subjects (RESERVATIONS_REWORK.md §3.6, §3.10): each child's
 * charges — instalments of a plan, board services, adjustments — what is due and by when, what
 * is being checked, what was paid (its receipt, or an instalment's deposit slip). A parent ticks
 * what to pay — several instalments of one plan at once, or the charges of one deadline — and pays
 * at the school desk or by InstaPay. A pushed school fee is paid on the School fee page.
 *
 * The Statement (step B) shows the same charges among the lines; this is where they are paid.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { ErrorState, LoadingState, EmptyState } from '~/components/ui/query-state';
import { Money, Day, INPUT_CLASS } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import { fetchCharges, CHARGES_KEY, ChargeStatusBadge, kindLabel, type ChargeRow } from '~/app/(app)/(charges)/charges/charges-shared';

const initiateRoute = api.v1.payments.initiate;
const initiate = (json: Parameters<typeof initiateRoute.$post>[0]['json']) => apiResponse(initiateRoute.$post({ json }));
type Initiated = Awaited<ReturnType<typeof initiate>>;
type Method = 'in_school' | 'instapay';

/** What may be paid together: a plan's instalments (one line), or the other charges (the API splits them by deadline). */
const groupOf = (c: ChargeRow) => (c.kind === 'instalment' ? `plan:${c.registrationId}` : 'charges');

export default function ChargesDueClient({ viewerRole }: { viewerRole: string | null }): React.JSX.Element {
  const isParent = viewerRole === 'parent';
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: [...CHARGES_KEY, 'mine'], queryFn: () => fetchCharges({}) });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState<Method>('in_school');
  const [result, setResult] = useState<Initiated | null>(null);
  const [error, setError] = useState('');

  const students = useMemo(() => {
    const by = new Map<string, { id: string; name: string; rows: ChargeRow[] }>();
    for (const c of list.data ?? []) {
      const s = by.get(c.student.id) ?? { id: c.student.id, name: c.student.name, rows: [] };
      s.rows.push(c);
      by.set(c.student.id, s);
    }
    return [...by.values()];
  }, [list.data]);

  const chosen = (list.data ?? []).filter((c) => ticked.has(c.id));
  const chosenGroup = chosen[0] ? groupOf(chosen[0]) : null;
  const chosenStudent = chosen[0]?.studentId ?? null;
  const total = chosen.reduce((s, c) => s + c.amount, 0);

  const pay = useMutation({
    mutationFn: () => initiate({ chargeIds: chosen.map((c) => c.id), paymentMethod: method, registrationIds: [] }),
    onSuccess: (r) => { setResult(r); setTicked(new Set()); setError(''); queryClient.invalidateQueries({ queryKey: CHARGES_KEY }); },
    onError: (err: Error) => setError(err.message),
  });

  const toggle = (c: ChargeRow) => setTicked((t) => {
    const next = new Set(t);
    if (next.has(c.id)) next.delete(c.id);
    else {
      // One student and one group at a time: a plan's instalments together, or the other charges.
      if (chosenStudent && (c.studentId !== chosenStudent || groupOf(c) !== chosenGroup)) next.clear();
      next.add(c.id);
    }
    return next;
  });

  if (list.isLoading) return <Page><LoadingState /></Page>;
  if (list.isError) return <Page><ErrorState onRetry={() => list.refetch()} /></Page>;
  if (!students.length) return <Page><EmptyState title="Nothing owed beside the subjects" message="Instalments, board services and other charges appear here when the school adds them or you ask for one." /></Page>;

  return (
    <Page>
      {result ? <PaymentStarted r={result} onDone={() => setResult(null)} /> : null}
      {error && <Notice tone="danger">{error}</Notice>}
      {students.map((s) => {
        const plans = new Map<string, ChargeRow[]>();
        for (const c of s.rows.filter((r) => r.kind === 'instalment')) plans.set(c.registrationId ?? c.id, [...(plans.get(c.registrationId ?? c.id) ?? []), c]);
        const others = s.rows.filter((r) => r.kind !== 'instalment');
        return (
          <section key={s.id} aria-labelledby={`child-${s.id}`} className="space-y-3">
            <h2 id={`child-${s.id}`} className="font-display text-base font-semibold text-foreground"><bdi>{s.name}</bdi></h2>
            {[...plans.values()].map((rows) => {
              const sorted = [...rows].sort((a, b) => (a.instalmentNo ?? 0) - (b.instalmentNo ?? 0));
              const paidSum = sorted.filter((r) => r.status === 'paid').reduce((t, r) => t + r.amount, 0);
              const all = sorted.reduce((t, r) => t + r.amount, 0);
              return (
                <div key={sorted[0]!.id} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
                    <p className="text-sm font-semibold text-foreground"><span>Instalment plan</span> · <bdi>{sorted[0]!.description.replace(/^Instalment \d+ of \d+ — /, '')}</bdi></p>
                    <p className="text-xs text-muted-foreground"><span>Paid</span> <Money amount={paidSum} /> <span>of</span> <Money amount={all} /> · <span>held for the subject until the last instalment pays it</span></p>
                  </div>
                  <ul className="divide-y divide-border">{sorted.map((c) => <Row key={c.id} c={c} payable={isParent} checked={ticked.has(c.id)} onToggle={() => toggle(c)} />)}</ul>
                </div>
              );
            })}
            {others.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <ul className="divide-y divide-border">{others.map((c) => <Row key={c.id} c={c} payable={isParent} checked={ticked.has(c.id)} onToggle={() => toggle(c)} />)}</ul>
              </div>
            )}
          </section>
        );
      })}

      {isParent && (
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3 shadow-md">
          <p className="text-sm"><span>To pay now</span> <Money amount={total} className="font-semibold" /></p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="pay-method" checked={method === 'in_school'} onChange={() => setMethod('in_school')} /><span>At the school desk</span></label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="pay-method" checked={method === 'instapay'} onChange={() => setMethod('instapay')} /><span>InstaPay</span></label>
            <Button disabled={!chosen.length || pay.isPending} onClick={() => pay.mutate()}>{pay.isPending ? 'Starting…' : 'Pay'}</Button>
          </div>
        </div>
      )}
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-8 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Charges and instalments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What you owe beside the subjects: a plan&apos;s instalments, the boards&apos; services you asked for, adjustments. Tick what to pay; a plan&apos;s instalments can be paid together.
        </p>
      </div>
      {children}
    </div>
  );
}

function Row({ c, payable, checked, onToggle }: { c: ChargeRow; payable: boolean; checked: boolean; onToggle: () => void }) {
  const canPay = payable && c.status === 'pending_payment' && !c.openPaymentId && c.kind !== 'school_fee_push';
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
      <label className="flex min-w-0 items-start gap-3">
        {canPay ? <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 h-4 w-4" /> : <span className="w-4" />}
        <span>
          <span className="block font-medium text-foreground"><bdi>{c.description}</bdi></span>
          <span className="block text-xs text-muted-foreground">
            <span>{kindLabel(c.kind)}</span> · <span>due</span> <Day iso={c.dueAt} />
            {c.receipt && <> · <bdi dir="ltr">{c.receipt.receiptNumber}</bdi></>}
            {c.depositSlip && <> · <span>deposit slip</span> <bdi dir="ltr">{c.depositSlip}</bdi></>}
          </span>
          {c.openPaymentId && <span className="block text-xs text-amber-700 dark:text-amber-400">A payment for it is in progress.</span>}
          {c.kind === 'school_fee_push' && c.status === 'pending_payment' && (
            <span className="block text-xs"><span>Paid on the</span> <Link href="/school-fee" className="text-primary underline">School fee</Link> <span>page.</span></span>
          )}
          {c.status === 'requested' && <span className="block text-xs text-muted-foreground">Asked for: the school accepts it before it can be paid.</span>}
        </span>
      </label>
      <span className="flex items-center gap-3"><Money amount={c.amount} /><ChargeStatusBadge status={c.status} /></span>
    </li>
  );
}

function PaymentStarted({ r, onDone }: { r: Initiated; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [reference, setReference] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const meta = (r.metadata ?? {}) as { inSchool?: { referenceNumber: string }; instapay?: { account: { bankName: string; accountName: string; accountNumber: string; iban: string | null }; amountDue: number }; charges?: string };
  const submit = useMutation({
    mutationFn: () => apiResponse(api.v1.payments[':id']['instapay-reference'].$post({ param: { id: r.id! }, json: { reference: reference.trim() } })),
    onSuccess: () => { setSent(true); setError(''); queryClient.invalidateQueries({ queryKey: CHARGES_KEY }); },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <Notice tone="info" title="Payment started">
      <div className="space-y-3">
        {meta.charges && <p><bdi>{meta.charges}</bdi>: <Money amount={r.amount} /></p>}
        {r.paymentMethod === 'in_school' && (
          <p><span>Pay at the school finance desk, quoting</span> <bdi dir="ltr" className="font-mono font-semibold">{r.externalReference ?? meta.inSchool?.referenceNumber}</bdi><span>.</span></p>
        )}
        {r.paymentMethod === 'instapay' && meta.instapay && (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt>Bank</dt><dd className="font-mono"><bdi>{meta.instapay.account.bankName}</bdi></dd>
              <dt>Account name</dt><dd className="font-mono"><bdi>{meta.instapay.account.accountName}</bdi></dd>
              <dt>Account number</dt><dd className="font-mono" dir="ltr">{meta.instapay.account.accountNumber}</dd>
              {meta.instapay.account.iban && <><dt>IBAN</dt><dd className="font-mono" dir="ltr">{meta.instapay.account.iban}</dd></>}
              <dt>Exact amount</dt><dd><Money amount={meta.instapay.amountDue} /></dd>
            </dl>
            {sent ? <p>Reference sent: finance checks it and the instalment counts once confirmed.</p> : (
              <div className="flex flex-wrap items-center gap-2">
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Your InstaPay transaction reference" aria-label="Your InstaPay transaction reference" className={`${INPUT_CLASS} max-w-sm font-mono`} />
                <Button size="sm" disabled={reference.trim().length < 4 || submit.isPending} onClick={() => submit.mutate()}>Send the reference</Button>
              </div>
            )}
            {error && <p className="text-destructive">{error}</p>}
          </>
        )}
        <Button size="sm" variant="ghost" onClick={onDone}>Close</Button>
        <Badge tone="neutral">{r.status === 'completed' ? 'Paid' : 'Waiting for the money'}</Badge>
      </div>
    </Notice>
  );
}
