'use client';

/**
 * Charges (RESERVATIONS_REWORK.md §3.6, §3.10): every charge by family and status — what a family
 * asked for and waits for the school to accept, what is owed, what was paid, refunded or
 * cancelled. The desk accepts a request, cancels, collects what is ticked (one payment per charge
 * group, and a pushed school fee on its own path), and a finance admin refunds a paid charge to
 * escrow (the paper receipt back first) or adds a charge.
 *
 * In the school's sheet these are extra columns on the family's row, chased by phone; here each
 * has its status, its receipt, and the desk takes them in one action.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, type ChargeStatus } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/tone';
import { ErrorState, LoadingState, EmptyState } from '~/components/ui/query-state';
import { ReasonModal } from '~/components/ui/reason-modal';
import { Day, INPUT_CLASS, Money } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import { AddChargeModal } from './add-charge.client';
import {
  fetchCharges, collectAtDesk, CHARGES_KEY, ChargeStatusBadge, CollectBar, CollectedNotice, kindLabel,
  type ChargeRow, type Collected, type Instrument,
} from './charges-shared';

type Filter = ChargeStatus | 'all';
const FILTERS: Filter[] = ['requested', 'pending_payment', 'paid', 'refunded', 'cancelled', 'all'];
const FILTER_LABEL: Record<Filter, string> = {
  requested: 'To accept', pending_payment: 'Unpaid', paid: 'Paid', refunded: 'Refunded', cancelled: 'Cancelled', all: 'All',
};
type Pending = { kind: 'accept' | 'cancel' | 'refund'; row: ChargeRow } | null;

export default function ChargesClient({ viewerRole }: { viewerRole: string | null }): React.JSX.Element {
  const queryClient = useQueryClient();
  const financeAdmin = viewerRole === 'finance_admin' || viewerRole === 'admin';
  const [filter, setFilter] = useState<Filter>('pending_payment');
  const [search, setSearch] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending>(null);
  const [modalError, setModalError] = useState('');
  const [adding, setAdding] = useState(false);
  const [collected, setCollected] = useState<Collected[] | null>(null);
  const [error, setError] = useState('');

  const list = useQuery({ queryKey: [...CHARGES_KEY, filter], queryFn: () => fetchCharges(filter === 'all' ? {} : { status: filter }) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: CHARGES_KEY });

  // By family: the approved parents of each student (a student with none stands alone).
  const families = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = (list.data ?? []).filter((c) => !term
      || c.student.name.toLowerCase().includes(term) || c.family.some((p) => p.name.toLowerCase().includes(term)));
    const groups = new Map<string, { parents: { id: string; name: string }[]; studentId: string; rows: ChargeRow[] }>();
    for (const c of rows) {
      const key = c.family.length ? c.family.map((p) => p.id).sort().join('+') : `student:${c.student.id}`;
      const g = groups.get(key) ?? { parents: c.family, studentId: c.student.id, rows: [] };
      g.rows.push(c);
      groups.set(key, g);
    }
    return [...groups.entries()].map(([key, g]) => ({ key, ...g, rows: g.rows.sort((a, b) => a.student.name.localeCompare(b.student.name) || a.dueAt.localeCompare(b.dueAt)) }));
  }, [list.data, search]);

  const act = useMutation({
    mutationFn: async ({ p, reason, amount }: { p: NonNullable<Pending>; reason: string; amount?: number }) => {
      const param = { id: p.row.id };
      if (p.kind === 'accept') return apiResponse(api.v1.charges[':id'].accept.$post({ param, json: { reason } }));
      if (p.kind === 'cancel') return apiResponse(api.v1.charges[':id'].cancel.$post({ param, json: { reason } }));
      return apiResponse(api.v1.charges[':id'].refund.$post({ param, json: { reason, amount: amount ?? 0 } }));
    },
    onSuccess: () => { setPending(null); setModalError(''); refresh(); },
    onError: (err: Error) => setModalError(err.message),
  });

  // One action: each student's ticked charges (a pushed fee on the school-fee path), each group its own payment.
  const collect = useMutation({
    mutationFn: async ({ rows, instrument }: { rows: ChargeRow[]; instrument: Instrument }) => {
      const byStudent = new Map<string, ChargeRow[]>();
      for (const r of rows) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r]);
      const out: Collected[] = [];
      for (const [studentId, mine] of byStudent) {
        const push = mine.find((r) => r.kind === 'school_fee_push');
        out.push(await collectAtDesk({
          studentId, instrumentUsed: instrument, escrowAmountToApply: 0, registrationIds: [],
          chargeIds: mine.filter((r) => r.kind !== 'school_fee_push').map((r) => r.id),
          ...(push?.academicYear ? { schoolFeeYear: push.academicYear } : {}),
        }));
      }
      return out;
    },
    onSuccess: (r) => { setCollected(r); setTicked(new Set()); setError(''); refresh(); },
    onError: (err: Error) => { setError(err.message); refresh(); },
  });

  const toggle = (id: string) => setTicked((t) => {
    const next = new Set(t);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8 animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Charges</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What families owe beside their subjects — board services, instalments, the pushed school fee, adjustments — by family and status.
          </p>
        </div>
        {financeAdmin && <Button onClick={() => setAdding(true)}>Add a charge</Button>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-border bg-card p-0.5 text-sm" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => { setFilter(f); setTicked(new Set()); }}
              className={`rounded-md px-3 py-1.5 ${filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{FILTER_LABEL[f]}</button>
          ))}
        </div>
        <input type="search" aria-label="Search a family or student" placeholder="Search a family or student…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${INPUT_CLASS} max-w-72`} />
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {collected && (
        <Notice tone={collected.some((c) => c.notCollected.length) ? 'warning' : 'success'} title="Collected at the desk">
          {collected.map((c, i) => <CollectedNotice key={i} r={c} />)}
        </Notice>
      )}

      {list.isLoading ? <LoadingState /> : list.isError ? <ErrorState onRetry={() => list.refetch()} /> : families.length === 0 ? (
        <EmptyState title="Nothing here" message="No charge with this status." />
      ) : (
        <div className="space-y-4">
          {families.map((fam) => {
            const mine = fam.rows.filter((r) => ticked.has(r.id));
            const total = mine.reduce((s, r) => s + r.amount, 0);
            return (
              <section key={fam.key} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
                  <h2 className="font-display text-sm font-semibold text-foreground">
                    {fam.parents.length
                      ? <><span>Family of</span> <bdi>{fam.parents.map((p) => p.name).join(' · ')}</bdi></>
                      : <><bdi>{fam.rows[0]!.student.name}</bdi> <span className="font-normal text-muted-foreground">(no family linked)</span></>}
                  </h2>
                  {fam.rows.some((r) => r.status === 'pending_payment') && (
                    <CollectBar total={total} disabled={!mine.length} pending={collect.isPending} onCollect={(instrument) => collect.mutate({ rows: mine, instrument })} />
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead className="sr-only">
                    <tr><th>Collect</th><th>Student</th><th>Charge</th><th>Amount</th><th>Due</th><th>Status</th><th>Actions</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {fam.rows.map((c) => (
                      <tr key={c.id} className={c.status === 'cancelled' || c.status === 'refunded' ? 'opacity-70' : ''}>
                        <td className="w-10 px-4 py-3 align-top">
                          {c.status === 'pending_payment' && !c.openPaymentId && (
                            <input type="checkbox" aria-label={`Collect ${c.description}`} checked={ticked.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4" />
                          )}
                        </td>
                        <td className="px-2 py-3 align-top"><bdi className="font-medium text-foreground">{c.student.name}</bdi></td>
                        <td className="px-2 py-3 align-top">
                          <p className="text-card-foreground"><bdi>{c.description}</bdi></p>
                          <p className="text-xs text-muted-foreground">
                            <span>{kindLabel(c.kind)}</span>
                            {c.registration?.subject && <> · <bdi>{c.registration.subject.name}</bdi></>}
                            {c.receipt && <> · <bdi dir="ltr">{c.receipt.receiptNumber}</bdi></>}
                            {c.depositSlip && <> · <bdi dir="ltr">{c.depositSlip}</bdi></>}
                            {c.openPaymentId && <> · <span>a payment is being checked</span></>}
                          </p>
                        </td>
                        <td className="px-2 py-3 text-end align-top">
                          <Money amount={c.amount} />
                          {c.refundAmount ? <p className="text-xs text-muted-foreground"><span>refunded</span> <Money amount={c.refundAmount} /></p> : null}
                        </td>
                        <td className="px-2 py-3 align-top text-xs text-muted-foreground"><span>due</span> <Day iso={c.dueAt} /></td>
                        <td className="px-2 py-3 align-top"><ChargeStatusBadge status={c.status} /></td>
                        <td className="px-4 py-3 text-end align-top">
                          <div className="flex justify-end gap-1">
                            {c.status === 'requested' && <Button size="sm" onClick={() => setPending({ kind: 'accept', row: c })}>Accept</Button>}
                            {(c.status === 'requested' || (c.status === 'pending_payment' && c.kind !== 'instalment' && c.kind !== 'school_fee_push')) && (
                              <Button size="sm" variant="ghost" onClick={() => setPending({ kind: 'cancel', row: c })}>Cancel</Button>
                            )}
                            {c.status === 'paid' && financeAdmin && c.kind !== 'instalment' && c.kind !== 'school_fee_push' && (
                              <Button size="sm" variant="ghost" onClick={() => setPending({ kind: 'refund', row: c })}>Refund</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
      )}

      {pending && (
        <ReasonModal
          title={pending.kind === 'accept' ? 'Accept the request' : pending.kind === 'cancel' ? 'Cancel the charge' : 'Refund to escrow'}
          description={pending.kind === 'accept'
            ? `${pending.row.description}: the family is told it is due, and it can be paid.`
            : pending.kind === 'cancel'
              ? `${pending.row.description}: nothing is owed for it any more; the family is told.`
              : `${pending.row.description}: the amount goes to the family's escrow. A paper receipt that is out comes back first.`}
          confirmLabel={pending.kind === 'accept' ? 'Accept' : pending.kind === 'cancel' ? 'Cancel the charge' : 'Refund'}
          destructive={pending.kind !== 'accept'}
          isPending={act.isPending}
          error={modalError}
          fields={pending.kind === 'refund' ? [{ label: 'Amount (EGP)', inputMode: 'decimal', initial: String(pending.row.amount) }] : []}
          onConfirm={(reason, _choice, values) => act.mutate({ p: pending, reason, amount: values?.[0] ? Number(values[0]) : undefined })}
          onClose={() => { setPending(null); setModalError(''); }}
        />
      )}
      {adding && <AddChargeModal viewerRole={viewerRole} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); refresh(); }} />}
    </div>
  );
}

