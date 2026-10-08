'use client';

/**
 * Board services (RESERVATIONS_REWORK.md §3.6): each board's services — remarks, cash-in, late
 * cash-in, the certificate split — with their refund rule (Q-21: full until the school sets
 * another) and whether a family may ask for one; and per series, each service's last date and
 * its fee per level (IGCSE / AS–A Level), provisional until finance confirms it from the board's
 * list. A remark, a cash-in or a split is charged at the series' fee and refused past its date.
 *
 * The coordinator and the admin keep the catalogue and the dates; finance keeps the fees. The
 * session's Fees tab keeps the subjects' board fees; these are the services' (one grid per
 * series here — RESERVATIONS_MONEY.md §8).
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, REFUND_RULES, SERVICE_LEVELS, SERVICE_LEVEL_LABELS, type RefundRule, type ServiceLevel } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Field, INPUT_CLASS, Modal, Money, Day } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import { fetchBoardSeries, SeriesName, MONTH_LABEL } from '~/app/(app)/exams/exams-shared';

const fetchServices = (boardSeriesId?: string) => apiResponse(api.v1['board-services'].$get({ query: boardSeriesId ? { boardSeriesId } : {} }));
type ServiceRow = Awaited<ReturnType<typeof fetchServices>>[number];
const SERVICES_KEY = ['board-services'] as const;

const KIND_LABEL: Record<string, string> = { remark: 'Remark', cash_in: 'Cash-in', late_cash_in: 'Late cash-in', certificate_split: 'Certificate split' };
const RULE_LABEL: Record<RefundRule, string> = { none: 'No refund', full: 'Refunded in full', less_fixed: 'Refunded less a fixed amount' };

export default function ServicesClient({ viewerRole }: { viewerRole: string | null }): React.JSX.Element {
  const keepsCatalogue = viewerRole === 'admin' || viewerRole === 'coordinator';
  const keepsFees = viewerRole === 'admin' || viewerRole === 'finance_admin';
  const all = useQuery({ queryKey: SERVICES_KEY, queryFn: () => fetchServices() });
  const series = useQuery({ queryKey: ['board-series', 'services'], queryFn: () => fetchBoardSeries() });
  const boards = useMemo(() => [...new Map((all.data ?? []).map((s) => [s.boardCode, s.boardName])).entries()], [all.data]);
  const [board, setBoard] = useState('');
  const current = board || boards[0]?.[0] || '';
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [seriesId, setSeriesId] = useState('');
  const boardSeries = (series.data ?? []).filter((s) => s.boardCode === current);
  useEffect(() => { setSeriesId(''); }, [current]);

  if (all.isLoading) return <Page><LoadingState /></Page>;
  if (all.isError || !all.data) return <Page><ErrorState onRetry={() => all.refetch()} /></Page>;
  const services = all.data.filter((s) => s.boardCode === current);

  return (
    <Page>
      <div className="flex rounded-lg border border-border bg-card p-0.5 text-sm" role="group" aria-label="Board">
        {boards.map(([code, name]) => (
          <button key={code} type="button" aria-pressed={current === code} onClick={() => setBoard(code)}
            className={`rounded-md px-3 py-1.5 ${current === code ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{name}</button>
        ))}
      </div>

      <section aria-labelledby="catalogue" className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <h2 id="catalogue" className="border-b border-border px-5 py-3 font-display text-sm font-semibold text-foreground">The board&apos;s services</h2>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-border bg-muted">
            <tr>
              <th className="px-4 py-2 text-start font-semibold text-muted-foreground">Service</th>
              <th className="px-4 py-2 text-start font-semibold text-muted-foreground">Kind</th>
              <th className="px-4 py-2 text-start font-semibold text-muted-foreground">Priced</th>
              <th className="px-4 py-2 text-start font-semibold text-muted-foreground">On a changed grade</th>
              <th className="px-4 py-2 text-start font-semibold text-muted-foreground">Asked by</th>
              <th className="px-4 py-2 text-end font-semibold text-muted-foreground"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {services.map((s) => (
              <tr key={s.id} className={s.isActive ? '' : 'opacity-60'}>
                <td className="px-4 py-2"><bdi className="font-medium text-foreground">{s.label}</bdi>{!s.isActive && <> <Badge>Not offered</Badge></>}</td>
                <td className="px-4 py-2">{KIND_LABEL[s.kind] ?? s.kind}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  <span>{s.perComponent ? 'per paper' : 'per request'}</span>{s.levelRates && <> · <span>by level</span></>}
                </td>
                <td className="px-4 py-2 text-xs">
                  <span>{RULE_LABEL[s.refundRule as RefundRule] ?? s.refundRule}</span>
                  {s.refundRule === 'less_fixed' && s.refundDeduction != null && <> (<Money amount={s.refundDeduction} />)</>}
                </td>
                <td className="px-4 py-2 text-xs">{s.requestableByFamily ? 'the family or the desk' : 'the desk'}</td>
                <td className="px-4 py-2 text-end">{keepsCatalogue && <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="per-series" className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="per-series" className="font-display text-sm font-semibold text-foreground">Dates and fees in a series</h2>
          <Field label="Series" htmlFor="svc-series">
            <select id="svc-series" value={seriesId} onChange={(e) => setSeriesId(e.target.value)} className={`${INPUT_CLASS} min-w-72`}>
              <option value="">Pick a series…</option>
              {boardSeries.map((s) => <option key={s.id} value={s.id}>{`${s.boardName} ${MONTH_LABEL[s.month] ?? s.month} ${s.year}${s.label ? ` (${s.label})` : ''}`}</option>)}
            </select>
          </Field>
        </div>
        {seriesId
          ? <SeriesGrid seriesId={seriesId} keepsDates={keepsCatalogue} keepsFees={keepsFees} name={boardSeries.find((s) => s.id === seriesId)} />
          : <p className="mt-3 text-sm text-muted-foreground">Pick a series to set each service&apos;s last date and its fees.</p>}
      </section>

      {editing && <EditService service={editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8 animate-fade-up">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Board services</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Remarks, cash-in and certificate splits: what each board offers, what it costs in a series and until when, and what comes back on a changed grade.
        </p>
      </div>
      {children}
    </div>
  );
}

type Draft = { deadline: string; fees: Record<ServiceLevel, string>; confirmed: boolean };
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');

function SeriesGrid({ seriesId, keepsDates, keepsFees, name }: {
  seriesId: string; keepsDates: boolean; keepsFees: boolean; name?: { boardName: string; month: string; year: number; label: string | null };
}) {
  const queryClient = useQueryClient();
  const grid = useQuery({ queryKey: [...SERVICES_KEY, seriesId], queryFn: () => fetchServices(seriesId) });
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!grid.data) return;
    setDraft(Object.fromEntries(grid.data.filter((s) => s.isActive).map((s) => [s.id, {
      deadline: toLocal(s.deadline),
      fees: Object.fromEntries(SERVICE_LEVELS.map((l) => [l, String(s.fees.find((f) => f.level === l)?.amount ?? '')])) as Record<ServiceLevel, string>,
      confirmed: s.fees.length > 0 && s.fees.every((f) => !f.provisional),
    }])));
  }, [grid.data]);

  const save = useMutation({
    mutationFn: async (what: 'dates' | 'fees') => {
      const rows = grid.data!.filter((s) => s.isActive);
      if (what === 'dates') {
        return apiResponse(api.v1['board-services'].deadlines.$put({ json: {
          boardSeriesId: seriesId, reason: reason.trim(),
          rows: rows.map((s) => ({ boardServiceId: s.id, deadline: draft[s.id]?.deadline ? new Date(draft[s.id]!.deadline) : null })),
        } }));
      }
      return apiResponse(api.v1['board-services'].fees.$put({ json: {
        boardSeriesId: seriesId, reason: reason.trim() || undefined,
        rows: rows.flatMap((s) => (s.levelRates ? SERVICE_LEVELS : (['igcse'] as const))
          .filter((l) => draft[s.id]?.fees[l] !== '' && draft[s.id]?.fees[l] !== undefined)
          .map((l) => ({ boardServiceId: s.id, level: l, amount: Number(draft[s.id]!.fees[l]), provisional: !draft[s.id]!.confirmed }))),
      } }));
    },
    onSuccess: (_r, what) => {
      setMessage(what === 'dates' ? 'The dates are saved.' : 'The fees are saved.');
      setError('');
      queryClient.invalidateQueries({ queryKey: SERVICES_KEY });
    },
    onError: (err: Error) => { setError(err.message); setMessage(''); },
  });

  if (grid.isLoading) return <LoadingState />;
  if (grid.isError || !grid.data) return <ErrorState onRetry={() => grid.refetch()} />;
  const rows = grid.data.filter((s) => s.isActive);
  const set = (id: string, patch: Partial<Draft>) => setDraft((d) => ({ ...d, [id]: { ...d[id]!, ...patch } }));

  return (
    <div className="mt-4 space-y-4">
      {name && <p className="text-sm text-muted-foreground"><SeriesName boardName={name.boardName} month={name.month} year={name.year} label={name.label} /></p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border bg-muted">
            <tr>
              <th className="px-3 py-2 text-start font-semibold text-muted-foreground">Service</th>
              <th className="px-3 py-2 text-start font-semibold text-muted-foreground">Last date</th>
              {SERVICE_LEVELS.map((l) => <th key={l} className="px-3 py-2 text-start font-semibold text-muted-foreground">{SERVICE_LEVEL_LABELS[l]}</th>)}
              <th className="px-3 py-2 text-start font-semibold text-muted-foreground">Fee</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((s) => {
              const d = draft[s.id];
              if (!d) return null;
              const provisional = s.fees.some((f) => f.provisional);
              return (
                <tr key={s.id}>
                  <td className="px-3 py-2 align-top"><bdi className="font-medium text-foreground">{s.label}</bdi></td>
                  <td className="px-3 py-2 align-top">
                    {keepsDates
                      ? <input type="datetime-local" aria-label={`Last date: ${s.label}`} value={d.deadline} onChange={(e) => set(s.id, { deadline: e.target.value })} className={INPUT_CLASS} />
                      : <Day iso={s.deadline} />}
                  </td>
                  {SERVICE_LEVELS.map((l) => (
                    <td key={l} className="px-3 py-2 align-top">
                      {(!s.levelRates && l !== 'igcse') ? <span className="text-xs text-muted-foreground">one rate</span>
                        : keepsFees
                          ? <input type="number" inputMode="decimal" min="0" step="0.01" aria-label={`${s.label}: ${SERVICE_LEVEL_LABELS[l]}`} value={d.fees[l]} onChange={(e) => set(s.id, { fees: { ...d.fees, [l]: e.target.value } })} className={`${INPUT_CLASS} max-w-32`} />
                          : <Money amount={s.fees.find((f) => f.level === l)?.amount ?? null} />}
                    </td>
                  ))}
                  <td className="px-3 py-2 align-top">
                    {s.fees.length === 0 ? <Badge tone="warning">Not set</Badge> : provisional ? <Badge tone="warning">Provisional</Badge> : <Badge tone="success">Confirmed</Badge>}
                    {s.fees.some((f) => f.copiedFromDefault) && <p className="mt-1 text-xs text-muted-foreground">copied from the old fee list</p>}
                    {keepsFees && (
                      <label className="mt-2 flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={d.confirmed} onChange={(e) => set(s.id, { confirmed: e.target.checked })} />
                        <span>as the board published it</span>
                      </label>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(keepsDates || keepsFees) && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label="Reason" htmlFor="svc-reason">
            <input id="svc-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="The board's list of dates and fees" className={`${INPUT_CLASS} min-w-80`} />
          </Field>
          <div className="flex gap-2">
            {keepsDates && <Button variant="outline" disabled={save.isPending || reason.trim().length < 3} onClick={() => save.mutate('dates')}>Save the dates</Button>}
            {keepsFees && <Button disabled={save.isPending} onClick={() => save.mutate('fees')}>Save the fees</Button>}
          </div>
        </div>
      )}
      {message && <Notice tone="success">{message}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
    </div>
  );
}

function EditService({ service, onClose }: { service: ServiceRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(service.label);
  const [rule, setRule] = useState<RefundRule>(service.refundRule as RefundRule);
  const [deduction, setDeduction] = useState(service.refundDeduction != null ? String(service.refundDeduction) : '');
  const [requestable, setRequestable] = useState(service.requestableByFamily);
  const [active, setActive] = useState(service.isActive);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => apiResponse(api.v1['board-services'][':id'].$put({ param: { id: service.id }, json: {
      label: label.trim(), refundRule: rule, refundDeduction: rule === 'less_fixed' ? Number(deduction) : null,
      requestableByFamily: requestable, isActive: active, reason: reason.trim(),
    } })),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: SERVICES_KEY }); onClose(); },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <Modal title="Edit the service" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name" htmlFor="svc-label"><input id="svc-label" value={label} onChange={(e) => setLabel(e.target.value)} className={INPUT_CLASS} /></Field>
        <Field label="On a changed grade" htmlFor="svc-rule">
          <select id="svc-rule" value={rule} onChange={(e) => setRule(e.target.value as RefundRule)} className={INPUT_CLASS}>
            {REFUND_RULES.map((r) => <option key={r} value={r}>{RULE_LABEL[r]}</option>)}
          </select>
        </Field>
        {rule === 'less_fixed' && (
          <Field label="Kept by the school (EGP)" htmlFor="svc-deduction">
            <input id="svc-deduction" type="number" inputMode="decimal" min="0" step="0.01" value={deduction} onChange={(e) => setDeduction(e.target.value)} className={INPUT_CLASS} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={requestable} onChange={(e) => setRequestable(e.target.checked)} /><span>A family may ask for it in the app</span></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span>Offered</span></label>
        <Field label="Reason" htmlFor="svc-edit-reason"><input id="svc-edit-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT_CLASS} /></Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button disabled={save.isPending || reason.trim().length < 3} onClick={() => save.mutate()}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
