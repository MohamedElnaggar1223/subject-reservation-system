'use client';

/**
 * The Fees tab (RESERVATIONS_REWORK.md §3.4, §4.2): the boards' fee lists, one grid per series
 * the session's subjects are entered in — the PDF's shape (code, title, amount, provisional
 * mark). Rows are typed or pasted from the list, or copied from an earlier series (every row
 * provisional); "Confirm" when the board publishes; "Re-price unpaid lines" when a confirmed
 * amount differs from what lines were priced at (lines with any payment are listed, untouched).
 * Finance's and the admin's; the coordinator reads.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, ROLES } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { ErrorState, LoadingState, EmptyState } from '~/components/ui/query-state';
import { ReasonModal } from '~/components/ui/reason-modal';
import { SeriesName } from '~/app/(app)/exams/exams-shared';
import {
  fetchFeeGrid, feesKey, offersKey, SESSIONS_KEY, Money, Modal, Field, INPUT_CLASS, TEXTAREA_CLASS, ErrorLine, errorText, type SessionDetail, type SessionSeries, type FeeGrid,
} from '../sessions-shared';

export default function FeesTab({ session, viewerRole }: { session: SessionDetail; viewerRole: string }): React.JSX.Element {
  const canEdit = viewerRole === ROLES.ADMIN || viewerRole === ROLES.FINANCE_ADMIN;
  if (!session.series.length) return <EmptyState title="No series yet" message="A series appears here when a subject's item is entered in it." />;
  return (
    <div className="space-y-6">
      {!canEdit && <Notice tone="neutral">Finance and the admin set the board fees; you can read them here.</Notice>}
      {session.series.map((s) => <SeriesGrid key={s.id} session={session} series={s} canEdit={canEdit} />)}
    </div>
  );
}

function SeriesGrid({ session, series, canEdit }: { session: SessionDetail; series: SessionSeries; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data: grid, isLoading, isError, refetch } = useQuery({ queryKey: feesKey(series.id), queryFn: () => fetchFeeGrid(series.id) });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [published, setPublished] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [copying, setCopying] = useState(false);
  const [repricing, setRepricing] = useState(false);
  const [repriced, setRepriced] = useState<string | null>(null);
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: feesKey(series.id) }),
    queryClient.invalidateQueries({ queryKey: offersKey(session.id) }),
    queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  ]);
  const save = useMutation({
    mutationFn: async (rows: { keyKind: 'unit' | 'option' | 'qualification' | 'subject'; keyId: string; amount: number; provisional: boolean }[]) =>
      apiResponse(api.v1['board-fees'].$put({ query: { seriesId: series.id }, json: { rows } })),
    onSuccess: async () => { setEdits({}); await refresh(); },
  });
  const confirm = useMutation({
    mutationFn: async (rows: { feeId: string; amount?: number }[]) =>
      apiResponse(api.v1['board-fees'][':seriesId'].confirm.$post({ param: { seriesId: series.id }, json: { rows } })),
    onSuccess: async () => { setEdits({}); await refresh(); },
  });
  const reprice = useMutation({
    mutationFn: async (reason: string) => apiResponse(api.v1['board-fees'][':seriesId'].reprice.$post({
      param: { seriesId: series.id }, json: { feeIds: (grid?.rows ?? []).filter((r) => !r.provisional && (r.toReprice > 0 || r.toList > 0)).map((r) => r.id), reason },
    })),
    onSuccess: async (r) => {
      setRepricing(false);
      setRepriced(`${r.repriced.length}|${r.listed.length}|${r.totalDifference}`);
      await refresh();
    },
  });
  if (isLoading) return <LoadingState />;
  if (isError || !grid) return <ErrorState onRetry={() => refetch()} />;
  const provisionalRows = grid.rows.filter((r) => r.provisional);
  const toReprice = grid.rows.filter((r) => !r.provisional).reduce((a, r) => a + r.toReprice, 0);
  const toList = grid.rows.filter((r) => !r.provisional).reduce((a, r) => a + r.toList, 0);
  const changedNew = grid.missing.filter((m) => edits[`new|${m.keyKind}|${m.keyId}`]);
  const changedProvisional = provisionalRows.filter((r) => edits[r.id] !== undefined && edits[r.id] !== String(r.amount));

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm" aria-label={grid.series.name}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 className="font-semibold text-foreground"><SeriesName boardName={series.boardName} month={series.month} year={series.year} label={series.label} /></h3>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            {grid.copyFrom.length > 0 && <Button variant="outline" size="sm" onClick={() => setCopying(true)}>Copy from…</Button>}
            <Button variant="outline" size="sm" onClick={() => setPasting(true)}>Paste the fee list</Button>
            {provisionalRows.length > 0 && (
              <Button size="sm" onClick={() => confirm.mutate(provisionalRows.map((r) => ({ feeId: r.id, ...(edits[r.id] ? { amount: Number(edits[r.id]) } : {}) })))} disabled={confirm.isPending}>
                <span>Confirm all</span>&nbsp;<span>({provisionalRows.length})</span>
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="space-y-3 p-5">
        <ErrorLine message={save.error ? errorText(save.error) : confirm.error ? errorText(confirm.error) : null} />
        {repriced && (() => { const [a, b, d] = repriced.split('|'); return (
          <Notice tone="success"><span>{a}</span> <span>lines re-priced</span>; <span>{b}</span> <span>listed, untouched (they have a payment)</span>. <span>Difference</span> <Money amount={Number(d)} />.</Notice>
        ); })()}
        {grid.stuck.length > 0 && (
          <Notice tone="warning" title={<><span>Lines still provisional on confirmed fees</span> <span>({grid.stuck.length})</span></>}>
            <p><span>These waiting lines read only confirmed fees here but are still marked provisional, so they cannot be paid.</span> {canEdit && <span>Confirming their fees again makes them payable.</span>}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {grid.stuck.map((l) => (
                <li key={l.id} className="flex flex-wrap gap-x-2">
                  <bdi data-i18n-skip="true" className="font-medium">{l.studentName}</bdi>
                  <span className="text-muted-foreground">·</span>
                  <bdi data-i18n-skip="true">{l.subjectName}</bdi>
                  <span className="text-muted-foreground">·</span>
                  <bdi data-i18n-skip="true" className="text-muted-foreground">{l.sessionName}</bdi>
                  <Money amount={l.price} />
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="mt-2">
                <Button size="sm" disabled={confirm.isPending}
                  onClick={() => confirm.mutate([...new Set(grid.stuck.flatMap((l) => l.feeIds))].map((feeId) => ({ feeId })))}>
                  Confirm their fees again
                </Button>
              </div>
            )}
          </Notice>
        )}
        {canEdit && (toReprice > 0 || toList > 0) && (
          <Notice tone="warning" title="A confirmed fee differs from what lines were priced at">
            <span>{toReprice}</span> <span>unpaid lines can be re-priced on their board part;</span> <span>{toList}</span> <span>with a payment stay as they are (finance adjusts them).</span>
            <div className="mt-2"><Button size="sm" onClick={() => setRepricing(true)}>Re-price unpaid lines</Button></div>
          </Notice>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-start font-medium">Code</th>
                <th className="px-2 py-2 text-start font-medium">Title</th>
                <th className="px-2 py-2 text-start font-medium">Used by</th>
                <th className="px-2 py-2 text-end font-medium">Amount</th>
                <th className="px-2 py-2 text-start font-medium">State</th>
                <th className="px-2 py-2 text-end font-medium">Lines</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-2 font-mono text-xs"><bdi data-i18n-skip="true">{r.code}</bdi></td>
                  <td className="px-2 py-2"><bdi data-i18n-skip="true">{r.title}</bdi></td>
                  <td className="px-2 py-2 text-xs text-muted-foreground"><bdi data-i18n-skip="true">{r.items.map((i) => i.subjectName).filter((v, n, a) => a.indexOf(v) === n).join(' · ') || '—'}</bdi></td>
                  <td className="px-2 py-2 text-end">
                    {canEdit && r.provisional ? (
                      <input aria-label={`Amount for ${r.code}`} className={`${INPUT_CLASS} ms-auto h-8 w-28 text-end`} type="number" min={0} value={edits[r.id] ?? String(r.amount)} onChange={(e) => setEdits({ ...edits, [r.id]: e.target.value })} />
                    ) : <Money amount={r.amount} />}
                  </td>
                  <td className="px-2 py-2">
                    {r.provisional ? <Badge tone="info">provisional</Badge> : <Badge tone="success">confirmed</Badge>}
                    {r.zeroReason && <span className="ms-1 text-xs text-muted-foreground"><bdi data-i18n-skip="true">{r.zeroReason}</bdi></span>}
                    {canEdit && !r.provisional && <ConfirmAt row={r} onConfirm={(amount) => confirm.mutate([{ feeId: r.id, amount }])} />}
                  </td>
                  <td className="px-2 py-2 text-end tabular-nums">{r.lines}{(r.toReprice > 0 || r.toList > 0) && <> <Badge tone="warning">to re-price</Badge></>}</td>
                </tr>
              ))}
              {grid.missing.map((m) => (
                <tr key={`${m.keyKind}|${m.keyId}`} className="border-b border-border last:border-0">
                  <td className="px-2 py-2 font-mono text-xs"><bdi data-i18n-skip="true">{m.code}</bdi></td>
                  <td className="px-2 py-2"><bdi data-i18n-skip="true">{m.title}</bdi></td>
                  <td className="px-2 py-2 text-xs text-muted-foreground"><bdi data-i18n-skip="true">{m.subjectName}</bdi></td>
                  <td className="px-2 py-2 text-end">
                    {canEdit ? (
                      <input aria-label={`Amount for ${m.code}`} className={`${INPUT_CLASS} ms-auto h-8 w-28 text-end`} type="number" min={0} value={edits[`new|${m.keyKind}|${m.keyId}`] ?? ''} placeholder="—"
                        onChange={(e) => setEdits({ ...edits, [`new|${m.keyKind}|${m.keyId}`]: e.target.value })} />
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-2 py-2"><Badge tone="warning">No fee</Badge></td>
                  <td className="px-2 py-2 text-end">—</td>
                </tr>
              ))}
              {grid.rows.length === 0 && grid.missing.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No subject of this session reads a fee from this series yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {canEdit && (changedNew.length > 0 || changedProvisional.length > 0) && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
              <span>{"These are the board's published fees"}</span>
            </label>
            <Button onClick={() => save.mutate([
              ...changedNew.map((m) => ({ keyKind: m.keyKind as 'unit' | 'option' | 'qualification' | 'subject', keyId: m.keyId, amount: Number(edits[`new|${m.keyKind}|${m.keyId}`]), provisional: !published })),
              ...changedProvisional.map((r) => ({ keyKind: r.keyKind as 'unit' | 'option' | 'qualification' | 'subject', keyId: r.keyId, amount: Number(edits[r.id]), provisional: !published })),
            ])} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save fees'}</Button>
          </div>
        )}
      </div>
      {pasting && <PasteFees seriesId={series.id} onDone={async () => { setPasting(false); await refresh(); }} onClose={() => setPasting(false)} />}
      {copying && <CopyFees grid={grid} seriesId={series.id} onDone={async () => { setCopying(false); await refresh(); }} onClose={() => setCopying(false)} />}
      {repricing && (
        <ReasonModal title="Re-price unpaid lines" description={`Lines with no payment are re-priced on their board part, with the discounts they were priced with; each family is told the old and the new price. Lines with a payment are listed and left as they are.`}
          confirmLabel="Re-price" minLength={5} isPending={reprice.isPending} error={reprice.error ? errorText(reprice.error) : undefined}
          onConfirm={(reason) => reprice.mutate(reason)} onClose={() => setRepricing(false)} />
      )}
    </section>
  );
}

/** A confirmed row changes only by confirming it again at the published amount. */
function ConfirmAt({ row, onConfirm }: { row: FeeGrid['rows'][number]; onConfirm: (amount: number) => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(row.amount));
  if (!open) return <button type="button" className="ms-2 text-xs text-primary hover:underline" onClick={() => setOpen(true)}>Change</button>;
  return (
    <span className="ms-2 inline-flex items-center gap-1">
      <input aria-label={`New amount for ${row.code}`} className={`${INPUT_CLASS} h-8 w-24 text-end`} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Button size="sm" onClick={() => { onConfirm(Number(amount)); setOpen(false); }}>Confirm</Button>
    </span>
  );
}

function PasteFees({ seriesId, onDone, onClose }: { seriesId: string; onDone: () => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [published, setPublished] = useState(true);
  const parse = useMutation({
    mutationFn: async () => apiResponse(api.v1['board-fees'][':seriesId'].parse.$post({ param: { seriesId }, json: { text } })),
  });
  const save = useMutation({
    mutationFn: async () => apiResponse(api.v1['board-fees'].$put({
      query: { seriesId }, json: { rows: (parse.data?.matched ?? []).map((m) => ({ keyKind: m.keyKind, keyId: m.keyId, amount: m.amount, provisional: !published })) },
    })),
    onSuccess: onDone,
  });
  return (
    <Modal title="Paste the fee list" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{`One fee per line, as the board's list has it: a code and an amount ("0970 CX 10,850", "WMA11 4,800").`}</p>
        <textarea aria-label="The fee list" className={`${TEXTAREA_CLASS} min-h-40 font-mono`} value={text} onChange={(e) => setText(e.target.value)} />
        <ErrorLine message={parse.error ? errorText(parse.error) : save.error ? errorText(save.error) : null} />
        {parse.data && (
          <div className="space-y-2 text-sm">
            <p><span>{parse.data.matched.length}</span> <span>matched</span> · <span>{parse.data.unknown.length}</span> <span>not recognised</span></p>
            <ul className="max-h-40 overflow-y-auto rounded-lg border border-border">
              {parse.data.matched.map((m) => (
                <li key={m.line} className="flex justify-between gap-2 border-b border-border px-3 py-1 last:border-0"><span><bdi data-i18n-skip="true" className="font-mono">{m.code}</bdi> <bdi data-i18n-skip="true">{m.title}</bdi></span><Money amount={m.amount} /></li>
              ))}
              {parse.data.unknown.map((u) => (
                <li key={u.line} className="border-b border-border px-3 py-1 last:border-0"><Badge tone="warning">Not recognised</Badge> <bdi data-i18n-skip="true" className="font-mono">{u.line}</bdi> — <span>{u.reason}</span></li>
              ))}
            </ul>
            <label className="flex items-center gap-2"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /><span>{"These are the board's published fees"}</span></label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {!parse.data ? <Button onClick={() => parse.mutate()} disabled={!text.trim() || parse.isPending}>Read the list</Button>
            : <Button onClick={() => save.mutate()} disabled={!parse.data.matched.length || save.isPending}>Add these fees</Button>}
        </div>
      </div>
    </Modal>
  );
}

function CopyFees({ grid, seriesId, onDone, onClose }: { grid: FeeGrid; seriesId: string; onDone: () => void; onClose: () => void }) {
  const [from, setFrom] = useState(grid.copyFrom[0]?.id ?? '');
  const go = useMutation({
    mutationFn: async () => apiResponse(api.v1['board-fees'][':seriesId'].copy.$post({ param: { seriesId }, json: { fromSeriesId: from } })),
    onSuccess: onDone,
  });
  return (
    <Modal title="Copy fees from an earlier series" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Every row comes across provisional (the rows this series has are kept): families can reserve, not pay, until the board publishes and you confirm.</p>
        <ErrorLine message={go.error ? errorText(go.error) : null} />
        <Field label="From" htmlFor="cpf-from">
          <select id="cpf-from" className={INPUT_CLASS} value={from} onChange={(e) => setFrom(e.target.value)}>
            {grid.copyFrom.map((c) => <option key={c.id} value={c.id} data-i18n-skip="true">{c.name} ({c.rows})</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => go.mutate()} disabled={!from || go.isPending}>Copy</Button>
        </div>
      </div>
    </Modal>
  );
}
