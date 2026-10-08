'use client';

/**
 * The Exceptions screen (RESERVATIONS_REWORK.md §3.7, §4.7): grant one (the student or family →
 * the policy → the scope it accepts → the value → its sentence → a reason), the list of what was
 * granted (active, used, lapsed, revoked) with revoke and, for a plan, release in full, and
 * "Check these": the migrated exceptions whose meaning the rework changed, which apply to nothing
 * until a finance admin confirms them, and price exceptions on a unit row a parent item now enters.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { ErrorState, LoadingState, EmptyState } from '~/components/ui/query-state';
import { ReasonModal } from '~/components/ui/reason-modal';
import { Day } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import { GrantForm } from './grant-form.client';
import {
  fetchPolicies, fetchExceptions, fetchCheckThese, POLICIES_KEY, EXCEPTIONS_KEY, STATUS_FILTERS, STATUS_LABEL,
  ExceptionStatusBadge, Holder, ScopeText, ValueText, type PoliciesData, type StatusFilter,
} from './exceptions-shared';

type Pending = { kind: 'revoke' | 'release' | 'confirm'; id: string; label: string } | null;

export type Prefill = { studentId?: string; registrationId?: string; policyKey?: string };

export default function ExceptionsAdminClient({ viewerRole, prefill = {} }: { viewerRole: string | null; prefill?: Prefill }): React.JSX.Element {
  const policies = useQuery({ queryKey: POLICIES_KEY, queryFn: fetchPolicies });
  if (policies.isLoading) return <Page><LoadingState /></Page>;
  if (policies.isError || !policies.data) return <Page><ErrorState onRetry={() => policies.refetch()} /></Page>;
  return (
    <Page>
      <CheckThese data={policies.data} />
      <GrantForm data={policies.data} viewerRole={viewerRole} prefill={prefill} />
      <Granted data={policies.data} />
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Exceptions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One rule lifted for one student or one family — a price, a refund, a deadline, a gate, a payment plan. Every hook reads them; everything is audited.
        </p>
      </div>
      {children}
    </div>
  );
}

function useActions() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState('');
  const run = useMutation({
    mutationFn: async ({ p, text }: { p: NonNullable<Pending>; text: string }) => {
      if (p.kind === 'revoke') return apiResponse(api.v1.exceptions[':id'].revocation.$post({ param: { id: p.id }, json: { reason: text } }));
      if (p.kind === 'release') return apiResponse(api.v1.exceptions[':id'].release.$post({ param: { id: p.id }, json: { note: text } }));
      return apiResponse(api.v1.exceptions[':id'].confirm.$post({ param: { id: p.id }, json: text ? { note: text } : {} }));
    },
    onSuccess: () => {
      setPending(null);
      setError('');
      queryClient.invalidateQueries({ queryKey: EXCEPTIONS_KEY });
    },
    onError: (err: Error) => setError(err.message),
  });
  const modal = pending && (
    <ReasonModal
      title={pending.kind === 'revoke' ? 'Revoke this exception' : pending.kind === 'release' ? 'Release the plan in full' : 'Confirm this exception'}
      description={pending.kind === 'revoke'
        ? `${pending.label}: it stops applying now. A plan's line expires and its deposits are settled as a drop today; a re-price it made on an unpaid line is undone.`
        : pending.kind === 'release'
          ? `${pending.label}: every deposit goes back to the family's escrow, the unpaid instalments are cancelled, and the line stays payable in full by its usual date.`
          : `${pending.label}: from now on it applies as it is scoped.`}
      label={pending.kind === 'confirm' ? 'Note (optional)' : 'Reason'}
      minLength={pending.kind === 'confirm' ? 0 : 3}
      confirmLabel={pending.kind === 'revoke' ? 'Revoke' : pending.kind === 'release' ? 'Release in full' : 'Confirm'}
      destructive={pending.kind !== 'confirm'}
      isPending={run.isPending}
      error={error}
      onConfirm={(text) => run.mutate({ p: pending, text })}
      onClose={() => { setPending(null); setError(''); }}
    />
  );
  return { setPending, modal };
}

/** "Check these" (§3.7): nothing in it applies until confirmed (or it is revoked). */
function CheckThese({ data }: { data: PoliciesData }) {
  const list = useQuery({ queryKey: [...EXCEPTIONS_KEY, 'check-these'], queryFn: fetchCheckThese });
  const { setPending, modal } = useActions();
  const rows = list.data ?? [];
  if (!rows.length) return null;
  const policyOf = (key: string) => data.policies.find((p) => p.key === key);
  return (
    <section aria-labelledby="check-these" className="rounded-xl border border-amber-200 bg-card shadow-sm dark:border-amber-700">
      <div className="border-b border-border px-5 py-4">
        <h2 id="check-these" className="font-display text-base font-semibold text-foreground"><span>Check these</span> (<span>{rows.length}</span>)</h2>
        <p className="mt-1 text-sm text-muted-foreground">Exceptions whose meaning the reservations rework changed. They apply to nothing until you confirm them as scoped, or revoke them.</p>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((e) => {
          const p = policyOf(e.policyKey);
          return (
            <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0 space-y-1 text-sm">
                <p><Holder student={e.student} family={e.family} /> · <span>{p?.label ?? e.policyKey}</span> · <ValueText valueType={p?.valueType} n={e.valueNumber} date={e.valueDate} schedule={e.valueJson} /></p>
                <p className="text-xs text-muted-foreground"><ScopeText row={e} nullScope={p?.nullScope} /></p>
                <p className="text-xs text-amber-700 dark:text-amber-400">{e.why}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setPending({ kind: 'confirm', id: e.id, label: p?.label ?? e.policyKey })}>Confirm</Button>
                <Button size="sm" variant="outline" onClick={() => setPending({ kind: 'revoke', id: e.id, label: p?.label ?? e.policyKey })}>Revoke</Button>
              </div>
            </li>
          );
        })}
      </ul>
      {modal}
    </section>
  );
}

/** What was granted, by status. */
function Granted({ data }: { data: PoliciesData }) {
  const [status, setStatus] = useState<StatusFilter>('active');
  const list = useQuery({ queryKey: [...EXCEPTIONS_KEY, status], queryFn: () => fetchExceptions(status) });
  const { setPending, modal } = useActions();
  const policyOf = (key: string) => data.policies.find((p) => p.key === key);
  return (
    <section aria-labelledby="granted" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="granted" className="font-display text-base font-semibold text-foreground">Granted</h2>
        <div className="flex rounded-lg border border-border bg-card p-0.5 text-sm" role="group" aria-label="Show">
          {STATUS_FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={status === f} onClick={() => setStatus(f)}
              className={`rounded-md px-3 py-1.5 ${status === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{STATUS_LABEL[f]}</button>
          ))}
        </div>
      </div>
      {list.isLoading ? <LoadingState /> : list.isError ? <ErrorState onRetry={() => list.refetch()} /> : !list.data?.length ? (
        <EmptyState title="Nothing here" message="No exception with this status." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th className="px-4 py-3 text-start font-semibold text-muted-foreground">For</th>
                <th className="px-4 py-3 text-start font-semibold text-muted-foreground">Policy</th>
                <th className="px-4 py-3 text-start font-semibold text-muted-foreground">Scope</th>
                <th className="px-4 py-3 text-end font-semibold text-muted-foreground">Value</th>
                <th className="px-4 py-3 text-start font-semibold text-muted-foreground">Reason</th>
                <th className="px-4 py-3 text-center font-semibold text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-end font-semibold text-muted-foreground"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.map((e) => {
                const p = policyOf(e.policyKey);
                return (
                  <tr key={e.id} className={e.status === 'active' ? 'hover:bg-muted/50' : 'opacity-70'}>
                    <td className="px-4 py-3 align-top"><Holder student={e.student} family={e.family} /></td>
                    <td className="px-4 py-3 align-top text-card-foreground">
                      <span>{p?.label ?? e.policyKey}</span>
                      {e.validUntil && <p className="text-xs text-muted-foreground"><span>until</span> <Day iso={e.validUntil} /></p>}
                    </td>
                    <td className="px-4 py-3 align-top text-xs"><ScopeText row={e} nullScope={p?.nullScope} /></td>
                    <td className="px-4 py-3 text-end align-top"><ValueText valueType={p?.valueType} n={e.valueNumber} date={e.valueDate} schedule={e.valueJson} /></td>
                    <td className="max-w-[220px] truncate px-4 py-3 align-top text-xs text-card-foreground" title={e.reason}><bdi>{e.reason}</bdi></td>
                    <td className="px-4 py-3 text-center align-top"><ExceptionStatusBadge status={e.status} /></td>
                    <td className="px-4 py-3 text-end align-top">
                      {e.status === 'active' && (
                        <div className="flex justify-end gap-1">
                          {e.policyKey === 'plan.instalments' && (
                            <Button variant="ghost" size="sm" onClick={() => setPending({ kind: 'release', id: e.id, label: p?.label ?? e.policyKey })}>Release in full</Button>
                          )}
                          {p?.grantable && (
                            <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                              onClick={() => setPending({ kind: 'revoke', id: e.id, label: p?.label ?? e.policyKey })}>Revoke</Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {modal}
    </section>
  );
}

