'use client';

/**
 * Remarks Desk Client — Staff (V3 §6.10)
 *
 * Two queues + config:
 * 1. Awaiting submission → enter the board reference
 * 2. Submitted → record per-paper outcomes; a subject-grade change
 *    refunds the fee to escrow automatically
 * 3. (finance admin) Fee schedule per council+service
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse,
  REMARK_SERVICE_TYPES,
  REMARK_SERVICE_LABELS,
  COUNCIL_LABELS,
} from '@repo/validations';
import { formatPrice } from '~/lib/format';
import { Button } from '~/components/ui/button';

type RemarkItem = { id: string; paperCode: string; paperName: string | null; outcome: string; gradeAfter: string | null };
type RemarkRow = {
  id: string;
  serviceType: string;
  status: string;
  feeCharged: number;
  boardReference: string | null;
  items: RemarkItem[];
  student: { id: string; name: string } | null;
  registration: {
    id: string;
    gradeReceived: string | null;
    subject: { id: string; name: string; code: string; council: string };
    session: { id: string; name: string };
  };
};
type FeeRow = { id: string; council: string; serviceType: string; amountPerPaper: number };

export default function RemarksDeskClient({ userRole }: { userRole: string }) {
  const isFinanceAdmin = userRole === 'finance_admin' || userRole === 'admin';
  const qc = useQueryClient();

  const [actionError, setActionError] = useState('');
  const [boardRefs, setBoardRefs] = useState<Record<string, string>>({});
  const [outcomeTarget, setOutcomeTarget] = useState<RemarkRow | null>(null);
  const [itemOutcomes, setItemOutcomes] = useState<Record<string, { outcome: string; gradeAfter: string }>>({});
  const [gradeChanged, setGradeChanged] = useState(false);
  const [feeForm, setFeeForm] = useState({ council: 'pearson_edexcel', serviceType: 'review_of_marking', amount: '' });

  const { data: remarksList = [], isLoading } = useQuery<RemarkRow[]>({
    queryKey: ['remarks', 'desk'],
    queryFn: async () => (await apiResponse(api.v1.remarks.$get())) as RemarkRow[],
    refetchInterval: 30_000,
  });

  const { data: fees = [] } = useQuery<FeeRow[]>({
    queryKey: ['remarks', 'fees'],
    queryFn: async () => (await apiResponse(api.v1.remarks.fees.$get())) as FeeRow[],
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['remarks'] });
  };

  const submitBoardMutation = useMutation({
    mutationFn: ({ id, boardReference }: { id: string; boardReference: string }) =>
      apiResponse(api.v1.remarks[':id']['submit-board'].$post({ param: { id }, json: { boardReference } })),
    onSuccess: () => { setActionError(''); refresh(); },
    onError: (err: Error) => setActionError(err.message),
  });

  const outcomeMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.remarks[':id'].outcome.$post({
          param: { id: outcomeTarget!.id },
          json: {
            items: outcomeTarget!.items.map((i) => ({
              itemId: i.id,
              outcome: (itemOutcomes[i.id]?.outcome ?? 'unchanged') as 'mark_up' | 'mark_down' | 'unchanged',
              gradeAfter: itemOutcomes[i.id]?.gradeAfter || null,
            })),
            gradeChanged,
          },
        })
      ),
    onSuccess: () => { setOutcomeTarget(null); setItemOutcomes({}); setGradeChanged(false); setActionError(''); refresh(); },
    onError: (err: Error) => setActionError(err.message),
  });

  const feeMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.remarks.fees.$put({
          json: {
            council: feeForm.council as 'pearson_edexcel' | 'cambridge' | 'oxford',
            serviceType: feeForm.serviceType as (typeof REMARK_SERVICE_TYPES)[number],
            amountPerPaper: parseFloat(feeForm.amount),
          },
        })
      ),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['remarks', 'fees'] }); setFeeForm({ ...feeForm, amount: '' }); setActionError(''); },
    onError: (err: Error) => setActionError(err.message),
  });

  const awaitingSubmission = remarksList.filter((r) => r.status === 'awaiting_submission');
  const submitted = remarksList.filter((r) => r.status === 'submitted');

  if (isLoading) {
    return (
      <div className="px-6 py-8 flex justify-center min-h-[300px] items-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Remarks Desk</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Submit approved requests through the board portal, then record outcomes here — a grade
          change refunds the fee automatically.
        </p>
      </div>

      {actionError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* Awaiting board submission */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">
          Awaiting submission to board <span className="text-sm font-normal text-muted-foreground">({awaitingSubmission.length})</span>
        </h2>
        {awaitingSubmission.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-6 text-center shadow-sm">
            <p className="text-sm text-muted-foreground">Nothing waiting.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {awaitingSubmission.map((r) => (
              <div key={r.id} className="bg-card rounded-xl border border-border shadow-sm p-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="font-medium text-foreground">
                    {r.student?.name} — {r.registration.subject.name}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {COUNCIL_LABELS[r.registration.subject.council as keyof typeof COUNCIL_LABELS]} ·{' '}
                    {REMARK_SERVICE_LABELS[r.serviceType as keyof typeof REMARK_SERVICE_LABELS]} ·{' '}
                    {r.registration.session.name} · Papers: {r.items.map((i) => i.paperCode).join(', ')} · {formatPrice(r.feeCharged)} paid
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <input
                    type="text"
                    value={boardRefs[r.id] ?? ''}
                    onChange={(e) => setBoardRefs((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    placeholder="Board reference"
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground font-mono"
                  />
                  <Button
                    size="sm"
                    disabled={submitBoardMutation.isPending || !(boardRefs[r.id] ?? '').trim()}
                    onClick={() => submitBoardMutation.mutate({ id: r.id, boardReference: boardRefs[r.id]!.trim() })}
                  >
                    Mark Submitted
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Submitted → record outcome */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">
          Submitted — awaiting board outcome <span className="text-sm font-normal text-muted-foreground">({submitted.length})</span>
        </h2>
        {submitted.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-6 text-center shadow-sm">
            <p className="text-sm text-muted-foreground">Nothing submitted.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {submitted.map((r) => (
              <div key={r.id} className="bg-card rounded-xl border border-border shadow-sm p-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="font-medium text-foreground">
                    {r.student?.name} — {r.registration.subject.name}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Board ref: <span className="font-mono">{r.boardReference}</span> · Papers: {r.items.map((i) => i.paperCode).join(', ')}
                  </div>
                </div>
                <Button size="sm" onClick={() => { setOutcomeTarget(r); setItemOutcomes({}); setGradeChanged(false); }}>
                  Record Outcome
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Fee config (finance admin) */}
      {isFinanceAdmin && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">Remark fees (per paper)</h2>
          <div className="bg-card rounded-xl border border-border shadow-sm p-5">
            <div className="flex gap-2 flex-wrap items-end mb-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Council</label>
                <select
                  value={feeForm.council}
                  onChange={(e) => setFeeForm({ ...feeForm, council: e.target.value })}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="pearson_edexcel">Pearson Edexcel</option>
                  <option value="cambridge">Cambridge</option>
                  <option value="oxford">Oxford</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Service</label>
                <select
                  value={feeForm.serviceType}
                  onChange={(e) => setFeeForm({ ...feeForm, serviceType: e.target.value })}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  {REMARK_SERVICE_TYPES.map((sv) => (
                    <option key={sv} value={sv}>{REMARK_SERVICE_LABELS[sv]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">EGP / paper</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={feeForm.amount}
                  onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })}
                  className="w-32 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>
              <Button
                size="sm"
                disabled={feeMutation.isPending || !(parseFloat(feeForm.amount) >= 0)}
                onClick={() => feeMutation.mutate()}
              >
                Save Fee
              </Button>
            </div>
            {fees.length > 0 && (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {fees.map((f) => (
                    <tr key={f.id}>
                      <td className="py-2 text-card-foreground">{COUNCIL_LABELS[f.council as keyof typeof COUNCIL_LABELS] ?? f.council}</td>
                      <td className="py-2 text-card-foreground">{REMARK_SERVICE_LABELS[f.serviceType as keyof typeof REMARK_SERVICE_LABELS] ?? f.serviceType}</td>
                      <td className="py-2 text-right font-medium text-foreground">{formatPrice(f.amountPerPaper)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {/* Outcome modal */}
      {outcomeTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-xl shadow-xl border border-border max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-foreground font-display mb-1">
              Outcome — {outcomeTarget.registration.subject.name}
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Per paper, from the board&apos;s outcome letter.
            </p>

            <div className="space-y-3 mb-4">
              {outcomeTarget.items.map((i) => (
                <div key={i.id} className="flex items-center gap-2">
                  <span className="text-sm font-mono text-foreground w-28 shrink-0">{i.paperCode}</span>
                  <select
                    value={itemOutcomes[i.id]?.outcome ?? 'unchanged'}
                    onChange={(e) => setItemOutcomes((prev) => ({ ...prev, [i.id]: { outcome: e.target.value, gradeAfter: prev[i.id]?.gradeAfter ?? '' } }))}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground flex-1"
                  >
                    <option value="unchanged">Unchanged</option>
                    <option value="mark_up">Mark up</option>
                    <option value="mark_down">Mark down</option>
                  </select>
                  <input
                    type="text"
                    value={itemOutcomes[i.id]?.gradeAfter ?? ''}
                    onChange={(e) => setItemOutcomes((prev) => ({ ...prev, [i.id]: { outcome: prev[i.id]?.outcome ?? 'unchanged', gradeAfter: e.target.value } }))}
                    placeholder="New grade"
                    className="w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              ))}
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={gradeChanged}
                onChange={(e) => setGradeChanged(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              The SUBJECT grade changed — refund the fee ({formatPrice(outcomeTarget.feeCharged)}) to escrow
            </label>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setOutcomeTarget(null)}>
                Cancel
              </Button>
              <Button className="flex-1" disabled={outcomeMutation.isPending} onClick={() => outcomeMutation.mutate()}>
                {outcomeMutation.isPending ? 'Saving…' : 'Save Outcome'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
