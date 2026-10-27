'use client';

/**
 * The desk's collection (RESERVATIONS_REWORK.md §3.10 item 1; COORDINATOR_REWORK.md §5 "Desk", §10): everything the
 * student owes now — subjects waiting for payment, charges (board services, instalments, adjustments) and the year's
 * school fee — ticked and taken in one action: the subjects in one payment whatever their dates, the charges each in
 * their own, the school fee first. `AlsoCollect` offers the same charges and fee beside a reservation (the
 * reservation page's "Reserve and collect": `deskExtras` → `collectNow`), one action.
 *
 * A subject whose prices are not final yet is reserved, not collected (E6): listed apart, collected once the school
 * confirms them. A subject past its last day to pay is no longer payable (C10): listed apart with that day, to
 * reserve again while it is offered. Each subject shows its last day to pay. A subject the school reserved (grade 10)
 * takes the family's own consent with its collection, "read and signed by the parent".
 *
 * In the sheet the officer adds the columns by hand, remembers who is late, and writes one receipt per column; here
 * the ticked total is the money in hand, the dates are on each line, and each subject gets its own receipt.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, schoolDateString, refusalCodeOf } from '@repo/validations';
import { familyWords } from '~/lib/i18n-reservations';
import { lineNamedBy } from '~/components/reservations/offers';
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
    // A line under a live plan is paid by its instalments (they are charges, listed below). A plan
    // released in full is not live: its line is collected in full here again (its paid
    // instalments stay paid; their deposits went back to escrow).
    const waiting = (summary?.registrations ?? []).filter((r) => r.status === 'pending_payment' && !r.livePlan);
    const lines = waiting.filter((r) => r.payableNow);
    // F8-09: a line whose payment is under way (the family's transfer waiting for finance's check, a checkout
    // they started) is listed apart, never ticked: the Finance Workbench confirms or rejects that payment.
    const underWay = waiting.filter((r) => r.paymentInProgress);
    // E6: prices not final yet — reserved, collected once the school confirms them.
    const provisional = waiting.filter((r) => !r.payableNow && !r.paymentInProgress && r.priceProvisional);
    // C10: past its last day to pay — no longer payable (the cut-off sweep expires it).
    const pastLastDay = waiting.filter((r) => !r.payableNow && !r.paymentInProgress && !r.priceProvisional);
    const payable = rows.filter((c) => c.status === 'pending_payment' && c.kind !== 'school_fee_push' && !c.openPaymentId);
    const requested = rows.filter((c) => c.status === 'requested');
    const pushes = rows.filter((c) => c.kind === 'school_fee_push' && c.status === 'pending_payment');
    const fees = (summary?.schoolFeesDue ?? []).map((f) => ({ ...f, push: pushes.find((p) => p.academicYear === f.academicYear) ?? null }));
    // An instalment plan is paid over time: only each plan's next instalment (and any already due) is
    // ticked at first, not the whole plan (F6: the desk offered all three instalments, EGP 24,850, for a
    // plan whose first falls due in three days). The officer can still tick the rest.
    // "Already due" is read in the school's day (Cairo), as the desk's Today and the Money tab read it, not
    // the UTC date: between 22:00 and midnight UTC the two differ (F6's review, finding 7).
    const today = schoolDateString(new Date());
    const nextOfPlan = new Map<string, string>();
    for (const c of [...payable].filter((x) => x.kind === 'instalment').sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))) {
      const plan = c.registration?.id ?? c.id;
      if (!nextOfPlan.has(plan)) nextOfPlan.set(plan, c.id);
    }
    const laterInstalments = new Set(payable
      .filter((c) => c.kind === 'instalment' && nextOfPlan.get(c.registration?.id ?? c.id) !== c.id && !(c.dueAt && schoolDateString(new Date(c.dueAt)) <= today))
      .map((c) => `c:${c.id}`));
    return { lines, underWay, provisional, pastLastDay, payable, requested, fees, laterInstalments, loading: charges.isLoading };
  }, [charges.data, charges.isLoading, summary]);
}

export function DeskCollectPanel({ studentId, summary, onDone }: { studentId: string; summary: Summary; onDone: () => void }) {
  const queryClient = useQueryClient();
  const owed = useOwed(studentId, summary);
  // What the officer changed from the first ticks (everything owed, less a plan's later instalments).
  const [picked, setPicked] = useState<Map<string, boolean>>(new Map());
  const [result, setResult] = useState<Collected | null>(null);
  const [error, setError] = useState('');
  // A subject the school reserved (grade 10) carries the school's consent only: the parent's own,
  // read and signed, goes with its collection (step B, RESERVATIONS_REWORK.md §3.5).
  const [consent, setConsent] = useState(false);
  const [refusedLine, setRefusedLine] = useState<{ id: string; sentence: string } | null>(null);
  // The family's balance, used only as far as the parent asks (0 at first): it pays the subjects and the charges
  // other than instalments, never the school fee (desk.services: at most their total).
  const [balanceText, setBalanceText] = useState('');
  const isOn = (key: string) => picked.get(key) ?? !owed.laterInstalments.has(key);
  const flip = (key: string) => setPicked((m) => new Map(m).set(key, !isOn(key)));
  const lineIds = owed.lines.filter((l) => isOn(`l:${l.id}`)).map((l) => l.id);
  const chargeIds = owed.payable.filter((c) => isOn(`c:${c.id}`)).map((c) => c.id);
  const fee = owed.fees.find((f) => isOn(`f:${f.academicYear}`));
  const total = owed.lines.filter((l) => lineIds.includes(l.id)).reduce((s, l) => s + l.priceAtRegistration, 0)
    + owed.payable.filter((c) => chargeIds.includes(c.id)).reduce((s, c) => s + c.amount, 0)
    + (fee?.amount ?? 0);
  const balance = summary.escrow.freeBalance;
  const balanceCap = Math.round(Math.min(balance,
    owed.lines.filter((l) => lineIds.includes(l.id)).reduce((s, l) => s + l.priceAtRegistration, 0)
    + owed.payable.filter((c) => chargeIds.includes(c.id) && c.kind !== 'instalment').reduce((s, c) => s + c.amount, 0)) * 100) / 100;
  const fromBalance = Math.round(Math.min(Math.max(Number(balanceText) || 0, 0), balanceCap) * 100) / 100;
  const cash = Math.round((total - fromBalance) * 100) / 100;

  const collect = useMutation({
    mutationFn: (instrumentUsed: Parameters<typeof collectAtDesk>[0]['instrumentUsed']) => collectAtDesk({
      studentId, registrationIds: lineIds, chargeIds, instrumentUsed, escrowAmountToApply: fromBalance,
      // The prices this screen shows: a re-price landing since it was read is refused (PRICE_CHANGED), not collected.
      expectedPrices: owed.lines.filter((l) => lineIds.includes(l.id)).map((l) => ({ registrationId: l.id, price: l.priceAtRegistration })),
      ...(fee ? { schoolFeeYear: fee.academicYear } : {}),
      ...(consent && owed.lines.some((l) => l.familyConsentNeeded && lineIds.includes(l.id)) ? { consent: { refundPolicy: true as const, declaration: true as const } } : {}),
    }),
    onSuccess: (r) => { setResult(r); setError(''); setRefusedLine(null); setPicked(new Map()); setConsent(false); setBalanceText(''); queryClient.invalidateQueries({ queryKey: CHARGES_KEY }); onDone(); },
    onError: (err: Error) => {
      // A refusal at the subject it names (CUT_OFF_PASSED, PRICES_NOT_FINAL, NOT_WAITING…): untick it, say why there.
      const sentence = familyWords(err.message);
      // lineNamedBy: the longest name, never a guess between two lines named alike (then the refusal stays at the top).
      const named = lineNamedBy(sentence, owed.lines, (l) => l.subject.name);
      if (named && refusalCodeOf(err)) {
        setRefusedLine({ id: named.id, sentence });
        setPicked((m) => new Map(m).set(`l:${named.id}`, false));
        setError('');
        onDone();
      } else {
        setError(sentence);
        // A price changed since this screen was read: read it again, so the new price is what is collected next.
        if (refusalCodeOf(err) === 'PRICE_CHANGED') onDone();
      }
    },
  });

  if (!owed.lines.length && !owed.underWay.length && !owed.provisional.length && !owed.pastLastDay.length && !owed.payable.length && !owed.fees.length && !owed.requested.length) {
    return result ? <Notice tone="success" title="Collected at the desk"><CollectedNotice r={result} /></Notice> : null;
  }
  return (
    <section aria-labelledby="desk-owed" className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 id="desk-owed" className="font-display text-sm font-semibold text-foreground">To collect now</h3>
        <CollectBar total={cash} disabled={!lineIds.length && !chargeIds.length && !fee} pending={collect.isPending} onCollect={(i) => collect.mutate(i)} />
      </div>
      {balance > 0 && (
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-5 py-2.5 text-sm">
          <div>
            <label htmlFor="collect-balance" className="mb-1 block text-xs font-medium text-foreground">
              <span>Balance to use</span> <span className="font-normal text-muted-foreground">(<span>available</span> <Money amount={balance} />)</span>
            </label>
            <input id="collect-balance" type="number" min="0" max={balanceCap} step="0.01" inputMode="decimal" placeholder="0"
              className="h-9 w-36 rounded-lg border border-input bg-background px-3 text-sm text-foreground" value={balanceText} onChange={(e) => setBalanceText(e.target.value)} />
          </div>
          {balanceCap > 0 && fromBalance < balanceCap && (
            <button type="button" className="mb-2 text-xs text-primary underline underline-offset-4" onClick={() => setBalanceText(String(balanceCap))}>
              <span>Use</span> <Money amount={balanceCap} />
            </button>
          )}
          <p className="mb-2 text-xs text-muted-foreground">
            {fromBalance > 0
              ? <><span>From the balance</span> <Money amount={fromBalance} /> · <span>to take now</span> <Money amount={cash} /></>
              : <span>Ask the parent before using it. It pays the subjects and charges, not the school fee.</span>}
          </p>
        </div>
      )}
      <ul className="divide-y divide-border text-sm">
        {owed.fees.map((f) => (
          <Row key={`f:${f.academicYear}`} checked={isOn(`f:${f.academicYear}`)} onChange={() => flip(`f:${f.academicYear}`)}
            title={<><span>School fee</span> <bdi dir="ltr">{f.academicYear}</bdi></>}
            detail={f.push ? <><span>pushed, due</span> <Day iso={f.push.dueAt} /></> : <span>the registration gate asks for it</span>}
            amount={f.amount} />
        ))}
        {owed.lines.map((l) => (
          <Row key={`l:${l.id}`} checked={isOn(`l:${l.id}`)} onChange={() => flip(`l:${l.id}`)}
            title={<bdi data-i18n-skip="true">{l.subject.name}</bdi>}
            detail={<>
              <span>waiting for payment</span> · <bdi data-i18n-skip="true">{l.session.name}</bdi>
              {l.cutOff && <> · <span>last day to pay</span> <Day iso={String(l.cutOff)} /></>}
              {refusedLine?.id === l.id && <span role="alert" className="block text-destructive">{refusedLine.sentence}</span>}
            </>}
            amount={l.priceAtRegistration} />
        ))}
        {owed.payable.map((c) => (
          <Row key={`c:${c.id}`} checked={isOn(`c:${c.id}`)} onChange={() => flip(`c:${c.id}`)}
            title={<bdi>{c.description}</bdi>} detail={<><span>{kindLabel(c.kind)}</span> · <span>due</span> <Day iso={c.dueAt} /></>} amount={c.amount} />
        ))}
        {owed.underWay.map((l) => (
          <li key={`w:${l.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-muted-foreground">
            <span className="flex min-w-0 items-start gap-3">
              <span aria-hidden className="mt-1 h-4 w-4 shrink-0" />
              <span>
                <span className="block font-medium text-foreground"><bdi data-i18n-skip="true">{l.subject.name}</bdi></span>
                <span className="block text-xs">
                  <span>{l.paymentInProgress?.status === 'pending_verification' ? "awaiting the transfer's check" : 'a payment the family started'}</span>
                  {' · '}<bdi data-i18n-skip="true">{l.session.name}</bdi>{' · '}
                  <span>confirm or reject it on the</span> <Link href="/finance" className="text-primary underline">Finance Workbench</Link>
                </span>
              </span>
            </span>
            <Money amount={l.priceAtRegistration} />
          </li>
        ))}
        {owed.provisional.length > 0 && (
          <li className="px-5 py-2.5 text-xs text-muted-foreground">
            <span>Prices not final yet, collected once the school confirms them:</span> <bdi data-i18n-skip="true">{owed.provisional.map((r) => r.subject.name).join(' · ')}</bdi>
          </li>
        )}
        {owed.pastLastDay.map((l) => (
          <li key={`x:${l.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-muted-foreground">
            <span>
              <span className="block font-medium text-foreground"><bdi data-i18n-skip="true">{l.subject.name}</bdi></span>
              <span className="block text-xs">
                <span>Past its last day to pay</span>{l.cutOff && <> (<Day iso={String(l.cutOff)} />)</>}<span>: it can no longer be paid. Reserve it again while it is offered.</span>
              </span>
            </span>
            <Money amount={l.priceAtRegistration} />
          </li>
        ))}
        {owed.requested.map((c: ChargeRow) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-muted-foreground">
            <span><bdi>{c.description}</bdi> · <span>asked for by the family — accept it on the</span> <Link href="/charges" className="text-primary underline">Charges</Link> <span>page first</span></span>
            <Money amount={c.amount} />
          </li>
        ))}
      </ul>
      {/* Only for a line the school reserved (grade 10): a family that reserved itself already gave it (F6). */}
      {owed.lines.some((l) => l.familyConsentNeeded && lineIds.includes(l.id)) && (
        <label className="flex items-center gap-2 border-t border-border px-5 py-2.5 text-xs text-foreground">
          <input type="checkbox" className="h-3.5 w-3.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>Refund policy and declaration read and signed by the parent (asked for subjects the school reserved)</span>
        </label>
      )}
      {error && <div className="px-5 pb-4"><Notice tone="danger">{familyWords(error)}</Notice></div>}
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
  const [touched, setTouched] = useState(false);
  const total = (next: Omit<Extras, 'total'>) => owed.payable.filter((c) => next.chargeIds.includes(c.id)).reduce((t, c) => t + c.amount, 0)
    + (owed.fees.find((f) => f.academicYear === next.schoolFeeYear)?.amount ?? 0);
  // The year's school fee gates reserving: it is ticked at first, so "Reserve and collect" takes it
  // first as the server asks (F6: unticked, the walk-in family's reservation was refused for it).
  const firstFee = owed.fees[0]?.academicYear;
  useEffect(() => {
    if (!touched && firstFee && value.schoolFeeYear === undefined) {
      const next = { ...value, schoolFeeYear: firstFee };
      onChange({ ...next, total: total(next) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstFee, touched]);
  if (!owed.payable.length && !owed.fees.length) return null;
  const change = (next: Omit<Extras, 'total'>) => { setTouched(true); onChange({ ...next, total: total(next) }); };
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
