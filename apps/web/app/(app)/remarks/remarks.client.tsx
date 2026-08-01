'use client';

/**
 * Remarks Client — Students & Parents (V3 §6.10)
 *
 * - Create a remark request per paper for a resulted subject
 * - Parents approve/reject student requests, attest consent, pay the fee
 * - Bundling nudge: Edexcel/OxfordAQA only waive fees on a grade change
 *   for papers submitted TOGETHER
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse,
  REMARK_SERVICE_TYPES,
  REMARK_SERVICE_LABELS,
  REMARK_STATUS_LABELS,
  COUNCIL_LABELS,
} from '@repo/validations';
import { formatPrice } from '~/lib/format';
import { Button } from '~/components/ui/button';

type RemarkItem = {
  id: string;
  paperCode: string;
  paperName: string | null;
  outcome: string;
  gradeAfter: string | null;
};

type RemarkRow = {
  id: string;
  serviceType: string;
  status: string;
  feeCharged: number;
  feeRefunded: boolean;
  boardReference: string | null;
  comments: string | null;
  createdAt: string;
  items: RemarkItem[];
  student: { id: string; name: string } | null;
  registration: {
    id: string;
    gradeReceived: string | null;
    subject: { id: string; name: string; code: string; council: string };
    session: { id: string; name: string };
  };
};

type ResultedRegistration = {
  id: string;
  status: string;
  gradeReceived: string | null;
  studentId: string;
  subject: { id: string; name: string; code: string; council: string };
  session: { id: string; name: string };
};

type FeeRow = { council: string; serviceType: string; amountPerPaper: number };

type PaymentResult = {
  id: string;
  paymentMethod: string;
  amount: number;
  externalReference: string | null;
  metadata: unknown;
};

const STATUS_STYLES: Record<string, string> = {
  pending_approval: 'bg-amber-50 text-amber-700',
  pending_consent: 'bg-amber-50 text-amber-700',
  pending_payment: 'bg-brand-50 text-brand-700',
  awaiting_submission: 'bg-violet-50 text-violet-700',
  submitted: 'bg-blue-50 text-blue-700',
  outcome_recorded: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
};

export default function RemarksClient({ userRole, userId }: { userRole: string; userId: string }) {
  const isParent = userRole === 'parent';
  const qc = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [createRegId, setCreateRegId] = useState('');
  const [createService, setCreateService] = useState<(typeof REMARK_SERVICE_TYPES)[number]>('review_of_marking');
  const [papers, setPapers] = useState<{ paperCode: string; paperName: string }[]>([{ paperCode: '', paperName: '' }]);
  const [createError, setCreateError] = useState('');
  const [actionError, setActionError] = useState('');
  const [consentTarget, setConsentTarget] = useState<RemarkRow | null>(null);
  const [payTarget, setPayTarget] = useState<RemarkRow | null>(null);
  const [payMethod, setPayMethod] = useState<'in_school' | 'instapay'>('in_school');
  const [payResult, setPayResult] = useState<PaymentResult | null>(null);
  const [instapayRef, setInstapayRef] = useState('');
  const [refSubmitted, setRefSubmitted] = useState(false);
  const [refError, setRefError] = useState('');

  const { data: remarksList = [], isLoading } = useQuery<RemarkRow[]>({
    queryKey: ['remarks'],
    queryFn: async () => (await apiResponse(api.v1.remarks.$get())) as RemarkRow[],
  });

  // Resulted registrations eligible for a remark (own or children's)
  const { data: registrations = [] } = useQuery<ResultedRegistration[]>({
    queryKey: ['registrations', 'list'],
    queryFn: async () =>
      (await apiResponse(api.v1.registrations.$get({ query: {} }))) as ResultedRegistration[],
  });
  const resulted = registrations.filter((r) => r.status === 'confirmed' && r.gradeReceived);

  const { data: fees = [] } = useQuery<FeeRow[]>({
    queryKey: ['remarks', 'fees'],
    queryFn: async () => (await apiResponse(api.v1.remarks.fees.$get())) as FeeRow[],
  });

  const selectedReg = resulted.find((r) => r.id === createRegId);
  const feePerPaper = selectedReg
    ? fees.find((f) => f.council === selectedReg.subject.council && f.serviceType === createService)?.amountPerPaper ?? null
    : null;
  const validPapers = papers.filter((p) => p.paperCode.trim());

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['remarks'] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.remarks.$post({
          json: {
            registrationId: createRegId,
            serviceType: createService,
            papers: validPapers.map((p) => ({
              paperCode: p.paperCode.trim(),
              paperName: p.paperName.trim() || null,
            })),
          },
        })
      ),
    onSuccess: () => {
      setShowCreate(false);
      setCreateRegId('');
      setPapers([{ paperCode: '', paperName: '' }]);
      setCreateError('');
      refresh();
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      apiResponse(
        approve
          ? api.v1.remarks[':id'].approve.$put({ param: { id }, json: {} })
          : api.v1.remarks[':id'].reject.$put({ param: { id }, json: { comments: 'Rejected by parent' } })
      ),
    onSuccess: () => { setActionError(''); refresh(); },
    onError: (err: Error) => setActionError(err.message),
  });

  const consentMutation = useMutation({
    mutationFn: (id: string) =>
      apiResponse(api.v1.remarks[':id'].consent.$post({ param: { id }, json: { attest: true } })),
    onSuccess: () => { setConsentTarget(null); setActionError(''); refresh(); },
    onError: (err: Error) => setActionError(err.message),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, method }: { id: string; method: 'in_school' | 'instapay' }) =>
      apiResponse(api.v1.remarks[':id'].pay.$post({ param: { id }, json: { paymentMethod: method } })),
    onSuccess: (data) => {
      setPayResult(data as unknown as PaymentResult);
      setActionError('');
      refresh();
    },
    onError: (err: Error) => setActionError(err.message),
  });

  const submitRefMutation = useMutation({
    mutationFn: ({ paymentId, reference }: { paymentId: string; reference: string }) =>
      apiResponse(
        api.v1.payments[':id']['instapay-reference'].$post({
          param: { id: paymentId },
          json: { reference },
        })
      ),
    onSuccess: () => { setRefSubmitted(true); setRefError(''); refresh(); },
    onError: (err: Error) => setRefError(err.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiResponse(api.v1.remarks[':id'].cancel.$post({ param: { id } })),
    onSuccess: () => { setActionError(''); refresh(); },
    onError: (err: Error) => setActionError(err.message),
  });

  const payMeta = (payResult?.metadata ?? {}) as {
    inSchool?: { referenceNumber: string };
    instapay?: {
      account: { bankName: string; accountName: string; accountNumber: string; iban: string | null };
      amountDue: number;
    };
  };

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto animate-fade-up space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Remarks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Post-results re-mark requests, per paper. Grades can go up, down, or stay the same.
          </p>
        </div>
        <Button onClick={() => { setShowCreate((v) => !v); setCreateError(''); }}>
          {showCreate ? 'Close' : 'New Remark Request'}
        </Button>
      </div>

      {actionError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Subject (resulted)</label>
            <select
              value={createRegId}
              onChange={(e) => setCreateRegId(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Pick a subject with a recorded result…</option>
              {resulted.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.subject.name} ({r.subject.code}) — {r.session.name} — grade {r.gradeReceived}
                </option>
              ))}
            </select>
            {resulted.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                No subjects with recorded results yet — remarks open after results day.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Service</label>
            <select
              value={createService}
              onChange={(e) => setCreateService(e.target.value as typeof createService)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {REMARK_SERVICE_TYPES.map((sv) => (
                <option key={sv} value={sv}>{REMARK_SERVICE_LABELS[sv]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Papers</label>
            {papers.map((p, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={p.paperCode}
                  onChange={(e) => setPapers((prev) => prev.map((x, j) => (j === i ? { ...x, paperCode: e.target.value } : x)))}
                  placeholder="Paper code (e.g. 4MB1/01)"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground font-mono"
                />
                <input
                  type="text"
                  value={p.paperName}
                  onChange={(e) => setPapers((prev) => prev.map((x, j) => (j === i ? { ...x, paperName: e.target.value } : x)))}
                  placeholder="Paper name (optional)"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                />
                {papers.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setPapers((prev) => prev.filter((_, j) => j !== i))}>
                    ✕
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setPapers((prev) => [...prev, { paperCode: '', paperName: '' }])}>
              + Add Paper
            </Button>
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              Submit every paper you want reviewed in ONE request — Edexcel and OxfordAQA only
              waive the fee on a grade change for papers submitted together. Cambridge accepts
              only one request per subject, ever.
            </p>
          </div>

          {selectedReg && (
            <div className="text-sm text-foreground bg-muted rounded-lg p-3">
              {COUNCIL_LABELS[selectedReg.subject.council as keyof typeof COUNCIL_LABELS] ?? selectedReg.subject.council} ·{' '}
              {feePerPaper != null
                ? <>Fee: {formatPrice(feePerPaper)} × {validPapers.length || 1} paper(s) = <span className="font-semibold">{formatPrice(feePerPaper * Math.max(validPapers.length, 1))}</span> (refunded if the grade changes)</>
                : 'Fee not configured yet — the school must set it before this request can proceed.'}
            </div>
          )}

          {createError && <p className="text-sm text-destructive">{createError}</p>}

          <Button
            className="w-full"
            disabled={createMutation.isPending || !createRegId || validPapers.length === 0}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending
              ? 'Submitting…'
              : isParent
                ? 'Create Remark Request'
                : 'Request (parent approval needed)'}
          </Button>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
        </div>
      ) : remarksList.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-10 text-center shadow-sm">
          <p className="text-muted-foreground text-sm">No remark requests yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {remarksList.map((r) => (
            <div key={r.id} className="bg-card rounded-xl border border-border shadow-sm p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-medium text-foreground">
                    {r.registration.subject.name}
                    <span className="text-xs text-muted-foreground ml-2 font-mono">{r.registration.subject.code}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {r.registration.session.name} · {REMARK_SERVICE_LABELS[r.serviceType as keyof typeof REMARK_SERVICE_LABELS] ?? r.serviceType}
                    {isParent && r.student && <> · {r.student.name}</>}
                    {' · '}Grade: {r.registration.gradeReceived ?? '—'}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Papers: {r.items.map((i) => i.paperCode).join(', ')}
                  </div>
                  {r.status === 'outcome_recorded' && (
                    <div className="text-xs mt-2 space-y-0.5">
                      {r.items.map((i) => (
                        <div key={i.id} className="text-foreground">
                          {i.paperCode}: {i.outcome === 'mark_up' ? '▲ mark up' : i.outcome === 'mark_down' ? '▼ mark down' : 'unchanged'}
                          {i.gradeAfter && <> → grade {i.gradeAfter}</>}
                        </div>
                      ))}
                      {r.feeRefunded && (
                        <div className="text-emerald-600 dark:text-emerald-400">Fee refunded to escrow (grade changed)</div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap ${STATUS_STYLES[r.status] ?? 'bg-muted text-muted-foreground'}`}>
                    {REMARK_STATUS_LABELS[r.status as keyof typeof REMARK_STATUS_LABELS] ?? r.status}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{formatPrice(r.feeCharged)}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-3 flex gap-2 flex-wrap">
                {isParent && r.status === 'pending_approval' && (
                  <>
                    <Button size="sm" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate({ id: r.id, approve: true })}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={decideMutation.isPending} onClick={() => decideMutation.mutate({ id: r.id, approve: false })}>
                      Reject
                    </Button>
                  </>
                )}
                {isParent && r.status === 'pending_consent' && (
                  <Button size="sm" onClick={() => setConsentTarget(r)}>
                    Give Consent
                  </Button>
                )}
                {isParent && r.status === 'pending_payment' && (
                  <Button size="sm" onClick={() => { setPayTarget(r); setPayResult(null); setInstapayRef(''); setRefSubmitted(false); }}>
                    Pay Fee
                  </Button>
                )}
                {['pending_approval', 'pending_consent', 'pending_payment'].includes(r.status) && (
                  <Button size="sm" variant="ghost" disabled={cancelMutation.isPending} onClick={() => {
                    if (confirm('Cancel this remark request?')) cancelMutation.mutate(r.id);
                  }}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Consent modal */}
      {consentTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-xl shadow-xl border border-border max-w-md w-full p-6">
            <h2 className="text-lg font-bold text-foreground font-display mb-2">Candidate Consent</h2>
            <p className="text-sm text-muted-foreground mb-4">
              A review of marking can move marks <span className="font-semibold text-foreground">up, down, or not at all</span> —
              the final grade may be LOWER than the current one. The exam boards require the
              candidate&apos;s written consent before the school can submit; please also bring the
              signed consent form to the school office.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setConsentTarget(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={consentMutation.isPending}
                onClick={() => consentMutation.mutate(consentTarget.id)}
              >
                {consentMutation.isPending ? 'Confirming…' : 'I consent on behalf of the candidate'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Pay modal */}
      {payTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-xl shadow-xl border border-border max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-foreground font-display mb-2">
              Pay Remark Fee — {formatPrice(payTarget.feeCharged)}
            </h2>

            {!payResult ? (
              <>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {(['in_school', 'instapay'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPayMethod(m)}
                      className={`p-3 rounded-xl border-2 text-sm font-medium text-left transition-all ${
                        payMethod === m
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border text-muted-foreground hover:border-primary/40'
                      }`}
                    >
                      {m === 'in_school' ? 'Pay at School' : 'InstaPay'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setPayTarget(null)}>
                    Cancel
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={payMutation.isPending}
                    onClick={() => payMutation.mutate({ id: payTarget.id, method: payMethod })}
                  >
                    {payMutation.isPending ? 'Processing…' : 'Continue'}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {payResult.paymentMethod === 'in_school' && (
                  <div className="bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-700 rounded-xl p-4 text-center">
                    <p className="text-sm font-medium text-brand-800 dark:text-brand-300 mb-1">Pay at the Finance Desk</p>
                    <p className="text-2xl font-bold tracking-widest text-brand-900 dark:text-brand-200 font-mono">
                      {payResult.externalReference ?? payMeta.inSchool?.referenceNumber}
                    </p>
                  </div>
                )}
                {payResult.paymentMethod === 'instapay' && payMeta.instapay && (
                  <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700 rounded-xl p-4 space-y-2 text-sm">
                    {[
                      ['Bank', payMeta.instapay.account.bankName],
                      ['Account Name', payMeta.instapay.account.accountName],
                      ['Account Number', payMeta.instapay.account.accountNumber],
                      ['Exact Amount', formatPrice(payMeta.instapay.amountDue)],
                    ].map(([label, value]) => (
                      <div key={label as string} className="flex justify-between gap-4">
                        <dt className="text-violet-700 dark:text-violet-400">{label}</dt>
                        <dd className="font-medium text-violet-900 dark:text-violet-200 font-mono text-right">{value}</dd>
                      </div>
                    ))}
                    {refSubmitted ? (
                      <p className="text-emerald-700 dark:text-emerald-400 text-xs pt-2">
                        Reference submitted — finance will verify and the request moves forward automatically.
                      </p>
                    ) : (
                      <div className="pt-2">
                        <input
                          type="text"
                          value={instapayRef}
                          onChange={(e) => setInstapayRef(e.target.value)}
                          placeholder="InstaPay transaction reference"
                          className="w-full px-3 py-2 text-sm border border-violet-300 dark:border-violet-700 bg-background rounded-lg text-foreground placeholder:text-muted-foreground font-mono"
                        />
                        {refError && <p className="mt-1 text-xs text-destructive">{refError}</p>}
                        <Button
                          size="sm"
                          className="mt-2 w-full bg-violet-600 hover:bg-violet-700 text-white"
                          disabled={submitRefMutation.isPending || instapayRef.trim().length < 4}
                          onClick={() => submitRefMutation.mutate({ paymentId: payResult.id, reference: instapayRef.trim() })}
                        >
                          {submitRefMutation.isPending ? 'Submitting…' : 'Submit Reference'}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                <Button variant="ghost" className="w-full mt-4" onClick={() => { setPayTarget(null); setPayResult(null); }}>
                  Done
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
