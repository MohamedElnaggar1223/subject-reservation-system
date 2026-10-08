'use client';

/**
 * Reserve — one page per student per session, for the desk and for the family
 * (RESERVATIONS_REWORK.md §4.3, §4.4; docs/features/RESERVATIONS_LINES.md §6).
 *
 * The form version: one Google Form per subject (seven identity questions, the teacher, "first
 * entry or retake", which papers, "self study 50% (ONLY 2nd entry)", the refund policy and the
 * declaration), the response sheet read at the desk, the fee note typed by hand. Here the
 * student is already known; each subject of the session is listed with what can be entered under
 * it; a tick, the entry (attempt and mode in one choice, as the form's options), the teacher where
 * there are several, and for a retake the system does not know, the sitting it follows. The
 * price of each line is the price charged (exceptions included), a provisional board fee marked;
 * the total says when it is due and how it is paid (one payment per entry deadline). The desk
 * ticks "read and signed by the parent" once; a family ticks the refund policy and the
 * declaration. The desk reserves only, or reserves and collects; a provisional line is reserved
 * now and collected once its fee is confirmed.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferRequestType } from 'hono/client';
import { api } from '~/lib/hono';
import {
  apiResponse,
  refundConsentText,
  DECLARATION_TEXT,
  DESK_CONSENT_TEXT,
  IN_SCHOOL_INSTRUMENTS,
  IN_SCHOOL_INSTRUMENT_LABELS,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { ErrorState, LoadingState, EmptyState } from '~/components/ui/query-state';
import { Money, Day, INPUT_CLASS, ErrorLine, errorText } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';

// ─── Fetchers, typed by the API (PATTERNS.md) ───────────────────────────────

export const fetchReserveOffers = (sessionId: string, studentId?: string) =>
  apiResponse(api.v1.registrations.offers.$get({ query: { sessionId, ...(studentId ? { studentId } : {}) } }));
type OffersRead = Awaited<ReturnType<typeof fetchReserveOffers>>;
type Offer = OffersRead['offers'][number];
type Item = Offer['items'][number];
type Price = Item['prices'][number];
type Sitting = OffersRead['declarableSittings'][number];

type LinesJson = InferRequestType<typeof api.v1.registrations.direct.$post>['json']['lines'];
type Line = LinesJson[number];

const reserveDirect = (json: InferRequestType<typeof api.v1.registrations.direct.$post>['json']) => apiResponse(api.v1.registrations.direct.$post({ json }));
const reservePrereg = (json: InferRequestType<typeof api.v1.registrations.preregister.$post>['json']) => apiResponse(api.v1.registrations.preregister.$post({ json }));
const reserveRequest = (json: InferRequestType<typeof api.v1.registrations.request.$post>['json']) => apiResponse(api.v1.registrations.request.$post({ json }));
const reserveDesk = (json: InferRequestType<typeof api.v1.registrations.desk.$post>['json']) => apiResponse(api.v1.registrations.desk.$post({ json }));
export type DeskResult = Awaited<ReturnType<typeof reserveDesk>>;

export const reserveOffersKey = (sessionId: string, studentId: string) => ['registrations', 'offers', sessionId, studentId] as const;

/** The refund terms a reservation in this session freezes at consent: weeks, or a converted session's dates. */
export const fetchRefundTerms = (sessionId: string) => apiResponse(api.v1.sessions[':id']['refund-terms'].$get({ param: { id: sessionId } }));
export type RefundTermsState = { terms: Awaited<ReturnType<typeof fetchRefundTerms>>['terms'] | null; ready: boolean; failed: boolean };
export function useRefundTerms(sessionId: string | null | undefined): RefundTermsState {
  const q = useQuery({ queryKey: ['sessions', sessionId, 'refund-terms'], queryFn: () => fetchRefundTerms(sessionId!), enabled: !!sessionId, retry: 1 });
  return { terms: q.data?.terms ?? null, ready: !!q.data, failed: q.isError };
}

/**
 * The refund-policy tick's sentence: the terms the tick freezes once they are read; until then a
 * loading line, and if they cannot be read, a sentence saying so (the tick and Reserve stay off).
 */
export function RefundTermsSentence({ state }: { state: RefundTermsState }) {
  if (state.ready) return <span>{refundConsentText(state.terms)}</span>;
  if (state.failed) return <span className="text-destructive">The refund terms could not be loaded, so nothing can be reserved yet: reload the page to try again.</span>;
  return <span className="text-muted-foreground">Loading the refund terms…</span>;
}

// ─── Words ───────────────────────────────────────────────────────────────────

const MONTH: Record<string, string> = { january: 'January', june: 'June', october: 'October', november: 'November' };
const MONTH_ORDER: Record<string, number> = { january: 1, june: 6, october: 10, november: 11 };
const ym = (month: string, year: number) => year * 12 + (MONTH_ORDER[month] ?? 0);
const LEVEL_GROUP: Record<string, string> = { igcse: 'O.L.', as_level: 'A.S. / A.L.', a_level: 'A.S. / A.L.' };
const AVAILABILITY: Record<string, string> = { retake_only: 'Retakes only', self_study_only: 'Self-study only (not taught this cycle)' };

const entryKey = (p: { attempt: string; mode: string }) => `${p.attempt}|${p.mode}`;
/** A sitting is known when the student sat it: a confirmed line (a dropped one was never sat, so it is declared). */
const knownOf = (it: Item) => it.knownSittings.filter((k) => k.status === 'confirmed');
const isKnown = (it: Item) => knownOf(it).length > 0;
/** Open per attempt (docs/features/RESERVATIONS.md §2.12): a first entry to the entry deadline, a retake of the previous sitting to the retake deadline. */
const reservable = (it: Item) => it.open.first || it.open.retake;
const usable = (p: Price) => !p.noFee && p.open;

/** The entry choices as the forms word them: the attempt and the mode in one list. */
function entryLabel(p: Price, known: boolean): string {
  if (p.attempt === 'first') return p.mode === 'in_school' ? 'First entry, in school' : 'First entry, self-study (not taught this cycle)';
  if (p.mode === 'in_school') return known ? 'Retake, in school' : 'Retake, in school — name the sitting';
  return known ? 'Retake, self-study' : 'Retake, self-study — name the sitting';
}

/** The entry a tick starts with: a retake when the system knows the earlier sitting (§4.3). */
function defaultEntry(it: Item): string | null {
  const keys = it.prices.filter(usable).map(entryKey);
  const taught = it.teachers.length > 0;
  const want = isKnown(it)
    ? [taught ? 'retake|in_school' : 'retake|self_study', 'retake|self_study', 'retake|in_school']
    : ['first|in_school', 'first|self_study', taught ? 'retake|in_school' : 'retake|self_study', 'retake|self_study'];
  return want.find((k) => keys.includes(k)) ?? keys[0] ?? null;
}

const seriesName = (o: Offer, it: Item) => (it.series ? `${o.subject.boardName} ${MONTH[it.series.month] ?? it.series.month} ${it.series.year}${it.series.label ? ` (${it.series.label})` : ''}` : null);
const sittingName = (s: Sitting) => `${s.boardName} ${MONTH[s.month] ?? s.month} ${s.year}`;
const sittingValue = (s: Sitting) => (s.seriesId ? `id:${s.seriesId}` : `my:${s.month}|${s.year}`);

type Pick = { on: boolean; entry: string | null; teacherId: string | null | undefined; sitting: string };

export type ReserveDone = { registrationIds: string[]; message: string; desk?: DeskResult };

/**
 * `viewer`: who is reserving — the student (a request their parent approves), a parent (for a
 * linked child; a preregistration when the session has not opened), or the desk (staff).
 */
export function Reserve({ viewer, studentId, sessionId, onDone }: {
  viewer: 'student' | 'parent' | 'desk';
  studentId: string;
  sessionId: string;
  onDone: (done: ReserveDone) => void;
}): React.JSX.Element {
  const desk = viewer === 'desk';
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, error } = useQuery({
    queryKey: reserveOffersKey(sessionId, studentId),
    queryFn: () => fetchReserveOffers(sessionId, viewer === 'student' ? undefined : studentId),
    retry: false,
  });
  const terms = useRefundTerms(desk ? null : sessionId);
  const termsReady = desk || terms.ready;
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [refundTick, setRefundTick] = useState(false);
  const [declTick, setDeclTick] = useState(false);
  const [deskTick, setDeskTick] = useState(false);
  const [instrument, setInstrument] = useState<(typeof IN_SCHOOL_INSTRUMENTS)[number]>('cash');
  const [escrow, setEscrow] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const offers = data?.offers ?? [];
  const items = useMemo(() => offers.flatMap((o) => o.items.map((it) => ({ o, it }))), [offers]);
  const coreLocked = !!data && data.eligibility.grade === 10 && data.session.sessionType === 'june';

  // Grade 10 in June reserves the core subjects (A-05): ticked and kept.
  useEffect(() => {
    if (!data || !coreLocked) return;
    setPicks((prev) => {
      const next = { ...prev };
      for (const o of data.offers.filter((x) => x.grade10Core)) {
        const it = o.items.find((i) => reservable(i) && !i.held && defaultEntry(i));
        if (it && !next[it.id]?.on) next[it.id] = { on: true, entry: defaultEntry(it), teacherId: undefined, sitting: '' };
      }
      return next;
    });
  }, [data, coreLocked]);

  const pickOf = (it: Item): Pick => picks[it.id] ?? { on: false, entry: null, teacherId: undefined, sitting: '' };
  const setPick = (it: Item, patch: Partial<Pick>) => setPicks((prev) => ({ ...prev, [it.id]: { ...pickOf(it), ...patch } }));
  const toggle = (o: Offer, it: Item, on: boolean) => {
    setPicks((prev) => {
      const next = { ...prev, [it.id]: { ...pickOf(it), on, entry: pickOf(it).entry ?? defaultEntry(it) } };
      // One item of an exclusive group (the whole subject or one paper; AS or the A Level).
      if (on && it.exclusiveGroup) {
        for (const other of o.items) if (other.id !== it.id && other.exclusiveGroup === it.exclusiveGroup && next[other.id]) next[other.id] = { ...next[other.id]!, on: false };
      }
      return next;
    });
  };

  const chosen = items.filter(({ it }) => pickOf(it).on).map(({ o, it }) => {
    const p = pickOf(it);
    const price = it.prices.find((x) => entryKey(x) === p.entry && !x.noFee) ?? null;
    const [attempt, mode] = (p.entry ?? '|').split('|') as ['first' | 'retake', 'in_school' | 'self_study'];
    const needsSitting = (attempt === 'retake' || it.needsPriorSeries) && !isKnown(it);
    const sittings = (data?.declarableSittings ?? []).filter((s) => s.boardCode === o.subject.boardCode);
    return { o, it, p, price, attempt, mode, needsSitting, sittings, missing: needsSitting && !p.sitting };
  });

  const total = chosen.reduce((a, c) => a + (c.price?.total ?? 0), 0);
  const provisionalTotal = chosen.filter((c) => c.price?.provisional).reduce((a, c) => a + (c.price?.total ?? 0), 0);
  // The money is taken per entry deadline, as the desk and the checkout split it: a retake of
  // the board's previous sitting runs to the series' retake deadline where the board sets one,
  // every other line to the entry deadline (line_effective_deadline, docs/features/RESERVATIONS.md §2.6).
  const declarable = data?.declarableSittings ?? [];
  const priorOf = (c: (typeof chosen)[number]) => {
    if (c.needsSitting) {
      if (!c.p.sitting) return null;
      if (c.p.sitting.startsWith('id:')) return declarable.find((x) => x.seriesId === c.p.sitting.slice(3)) ?? null;
      const [month, year] = c.p.sitting.slice(3).split('|');
      return { month: month!, year: Number(year) };
    }
    if (c.attempt !== 'retake') return null;
    const known = knownOf(c.it).map((k) => declarable.find((x) => x.seriesId === k.seriesId)).filter((x) => !!x);
    return known.sort((a, b) => ym(b.month, b.year) - ym(a.month, a.year))[0] ?? null;
  };
  const deadlineOf = (c: (typeof chosen)[number]): { at: string | null; retake: boolean } => {
    const s = c.it.series;
    const entry = { at: c.it.firstEntryDeadline ? String(c.it.firstEntryDeadline) : null, retake: false };
    if (!s || c.attempt !== 'retake' || !s.retakeDeadline) return entry;
    const previous = declarable
      .filter((x) => x.boardCode === c.o.subject.boardCode && ym(x.month, x.year) < ym(s.month, s.year))
      .sort((a, b) => ym(b.month, b.year) - ym(a.month, a.year))[0];
    const prior = priorOf(c);
    return previous && prior && prior.month === previous.month && prior.year === previous.year ? { at: String(s.retakeDeadline), retake: true } : entry;
  };
  const bySeries = new Map<string, { name: string; amount: number; provisional: boolean; retake: boolean }>();
  for (const c of chosen) {
    const d = deadlineOf(c);
    const key = `${c.it.series?.id ?? 'none'}|${d.at ?? ''}`;
    const cur = bySeries.get(key) ?? { name: seriesName(c.o, c.it) ?? '—', amount: 0, provisional: false, retake: d.retake };
    bySeries.set(key, { ...cur, amount: cur.amount + (c.price?.total ?? 0), provisional: cur.provisional || !!c.price?.provisional });
  }
  const consented = desk ? deskTick : refundTick && declTick;
  const ready = chosen.length > 0 && chosen.every((c) => c.price && !c.missing) && consented && termsReady;

  const linesOut = (): Line[] => chosen.map((c) => {
    const line: Line = { offerItemId: c.it.id, attempt: c.attempt, mode: c.mode, expectedPrice: c.price!.total ?? undefined };
    if (c.mode === 'in_school' && c.it.teachers.length > 1) line.teacherId = c.p.teacherId ?? null;
    if (c.needsSitting && c.p.sitting) {
      if (c.p.sitting.startsWith('id:')) line.priorSittingSeriesId = c.p.sitting.slice(3);
      else {
        const [month, year] = c.p.sitting.slice(3).split('|') as ['january' | 'june' | 'october' | 'november', string];
        line.priorSitting = { month, year: Number(year) };
      }
    }
    return line;
  });
  const consent = { refundPolicy: true as const, declaration: true as const };

  const familyMutation = useMutation({
    mutationFn: async () => {
      const lines = linesOut();
      if (viewer === 'student') return reserveRequest({ sessionId, lines, consent });
      if (data?.session.status === 'draft') return reservePrereg({ sessionId, studentId, lines, consent });
      return reserveDirect({ sessionId, studentId, lines, consent });
    },
    onSuccess: (made) => {
      // A consent belongs to the lines it was given for; the next reservation asks again.
      setPicks({}); setRefundTick(false); setDeclTick(false);
      qc.invalidateQueries({ queryKey: ['registrations'] });
      onDone({
        registrationIds: made.map((r) => r.id),
        message: viewer === 'student'
          ? `Sent to your parent for approval: ${made.length} line${made.length === 1 ? '' : 's'}.`
          : data?.session.status === 'draft'
            ? `Preregistered: ${made.length} line${made.length === 1 ? '' : 's'}. Pay now to hold the money until the session opens.`
            : `Reserved: ${made.length} line${made.length === 1 ? '' : 's'} awaiting payment. Pay by exam series on the next screen.`,
      });
    },
    onError: (e) => setFailure(errorText(e)),
  });

  const deskMutation = useMutation({
    mutationFn: (collect: boolean) => reserveDesk({
      studentId, sessionId, lines: linesOut(), consent,
      ...(collect ? { collectNow: { instrumentUsed: instrument, escrowAmountToApply: Number(escrow) > 0 ? Number(escrow) : 0 } } : {}),
    }),
    onSuccess: (r) => {
      setPicks({}); setDeskTick(false);
      qc.invalidateQueries({ queryKey: ['registrations'] });
      qc.invalidateQueries({ queryKey: ['desk'] });
      qc.invalidateQueries({ queryKey: ['finance'] });
      const parts = [`Reserved ${r.registrations.length} line${r.registrations.length === 1 ? '' : 's'}.`];
      if (r.collected > 0) parts.push(`Collected EGP ${r.collected.toLocaleString('en-US')}${r.payments.length > 1 ? ` in ${r.payments.length} payments, one per entry deadline` : ''}.`);
      if (r.reservedNotCollected.length) parts.push(`${r.reservedNotCollected.length} on a provisional board fee: collected once the fee is confirmed.`);
      if (r.notCollected.length) parts.push(`Not collected — hand this money back: ${r.notCollected.map((n) => n.series.join(' and ')).join('; ')}.`);
      onDone({ registrationIds: r.registrations.map((x) => x.id), message: parts.join(' '), desk: r });
    },
    onError: (e) => setFailure(errorText(e)),
  });
  const pending = familyMutation.isPending || deskMutation.isPending;

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />;
  if (!data.eligibility.allowed) {
    return <Notice tone="danger" title="Not open to this student">{data.eligibility.reason}</Notice>;
  }
  if (!offers.length) return <EmptyState title="Nothing is offered in this session yet" />;

  const groups = [...new Set(offers.map((o) => LEVEL_GROUP[o.subject.level] ?? 'Other'))];

  const payableNow = Math.max(0, total - provisionalTotal - (Number(escrow) > 0 ? Number(escrow) : 0));

  return (
    <div className="space-y-4">
      {coreLocked && <Notice tone="info">Grade 10 in June: the core subjects are ticked and stay ticked.</Notice>}
      <p className="text-xs text-muted-foreground">
        {desk
          ? 'A retake is set when the system knows the earlier sitting. For a new family choose "retake" and name the sitting: it is recorded and listed on the session\'s To verify tab. A teacher may be left as "no preference". A line on a provisional board fee (ⓟ) is reserved now and collected once the fee is confirmed.'
          : 'Tick what you want to sit. A retake the school does not know about yet: choose "retake" and name the sitting, as on the form; the school verifies it. A provisional board fee (ⓟ) is confirmed before you pay.'}
      </p>

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2 text-start font-medium">Subject · what is entered</th>
              <th className="px-3 py-2 text-start font-medium">Teacher</th>
              <th className="px-3 py-2 text-start font-medium">Entry</th>
              <th className="px-3 py-2 text-end font-medium">Price</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g}>
              <tr><td colSpan={5} className="bg-muted/20 px-3 py-1.5 text-xs font-semibold text-muted-foreground">{g}</td></tr>
              {offers.filter((o) => (LEVEL_GROUP[o.subject.level] ?? 'Other') === g).map((o) => (
                <OfferRows key={o.id} o={o} desk={desk} coreLocked={coreLocked && o.grade10Core} pickOf={pickOf} setPick={setPick} toggle={toggle}
                  sittings={(data.declarableSittings ?? []).filter((s) => s.boardCode === o.subject.boardCode)} />
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-base font-semibold text-foreground">
            <span>{chosen.length}</span> <span>{chosen.length === 1 ? 'line' : 'lines'}</span> · <Money amount={total} />
          </p>
          <p className="text-xs text-muted-foreground">
            <span>Due</span> <Day iso={typeof data.session.paymentDueAt === 'string' ? data.session.paymentDueAt : null} />
            {provisionalTotal > 0 && <> · <span>on a provisional board fee:</span> <Money amount={provisionalTotal} /> <span>(payable once confirmed)</span></>}
          </p>
        </div>
        {bySeries.size > 1 && (
          <div className="text-xs text-muted-foreground">
            <span>Paid per entry deadline:</span>{' '}
            {[...bySeries.values()].map((s, i) => (
              <span key={`${s.name}|${s.retake}`}>{i > 0 && ' · '}<bdi data-i18n-skip="true">{s.name}</bdi>{s.retake && <> <span>(retake deadline)</span></>} <Money amount={s.amount} />{s.provisional && ' ⓟ'}</span>
            ))}
          </div>
        )}
        {chosen.some((c) => c.missing) && <p className="text-xs text-destructive">Name the earlier sitting on each retake</p>}

        <div className="space-y-2 border-t border-border pt-3 text-sm">
          {desk ? (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={deskTick} onChange={(e) => setDeskTick(e.target.checked)} />
              <span>{DESK_CONSENT_TEXT}</span>
            </label>
          ) : (
            <>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={refundTick} disabled={!terms.ready} onChange={(e) => setRefundTick(e.target.checked)} />
                <RefundTermsSentence state={terms} />
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={declTick} onChange={(e) => setDeclTick(e.target.checked)} />
                <span>{DECLARATION_TEXT}</span>
              </label>
            </>
          )}
        </div>

        <ErrorLine message={failure} />

        {desk ? (
          <div className="flex flex-wrap items-end gap-3">
            <Button variant="outline" disabled={!ready || pending} onClick={() => { setFailure(null); deskMutation.mutate(false); }}>Reserve only</Button>
            <div>
              <label htmlFor="desk-instrument" className="mb-1 block text-xs font-medium text-foreground">Paid with</label>
              <select id="desk-instrument" className={INPUT_CLASS.replace('w-full', 'w-36')} value={instrument} onChange={(e) => setInstrument(e.target.value as typeof instrument)}>
                {IN_SCHOOL_INSTRUMENTS.map((i) => <option key={i} value={i}>{IN_SCHOOL_INSTRUMENT_LABELS[i]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="desk-escrow" className="mb-1 block text-xs font-medium text-foreground">Escrow to apply (EGP)</label>
              <input id="desk-escrow" type="number" min="0" step="0.01" inputMode="decimal" className={INPUT_CLASS.replace('w-full', 'w-32')} value={escrow} onChange={(e) => setEscrow(e.target.value)} placeholder="0" />
            </div>
            <Button disabled={!ready || pending || total - provisionalTotal <= 0} onClick={() => { setFailure(null); deskMutation.mutate(true); }}>
              <span>Reserve and collect</span> <Money amount={payableNow} />{provisionalTotal > 0 && <> <span>now</span></>}
            </Button>
          </div>
        ) : (
          <Button disabled={!ready || pending} onClick={() => { setFailure(null); familyMutation.mutate(); }}>
            {pending ? 'Reserving…' : viewer === 'student' ? 'Send to my parent' : <><span>Reserve</span> <span>{chosen.length || ''}</span> <span>{chosen.length === 1 ? 'line' : chosen.length ? 'lines' : ''}</span></>}
          </Button>
        )}
      </div>
    </div>
  );
}

function OfferRows({ o, desk, coreLocked, pickOf, setPick, toggle, sittings }: {
  o: Offer; desk: boolean; coreLocked: boolean; sittings: Sitting[];
  pickOf: (it: Item) => Pick; setPick: (it: Item, patch: Partial<Pick>) => void; toggle: (o: Offer, it: Item, on: boolean) => void;
}) {
  return (
    <>
      <tr className="border-t border-border">
        <td colSpan={5} className="px-3 pt-3 pb-1">
          <span className="font-semibold text-foreground"><bdi data-i18n-skip="true">{o.subject.name}</bdi></span>{' '}
          <span className="text-xs text-muted-foreground"><bdi data-i18n-skip="true">{o.subject.boardName}</bdi></span>
          {o.grade10Core && <> <Badge tone="info">grade-10 core</Badge></>}
          {o.availability !== 'open' && AVAILABILITY[o.availability] && <> <Badge tone="warning">{AVAILABILITY[o.availability]}</Badge></>}
        </td>
      </tr>
      {o.items.map((it) => {
        const p = pickOf(it);
        const options = it.prices.filter(usable);
        const unavailable = !reservable(it) || !!it.held || options.length === 0;
        const [attempt, mode] = (p.entry ?? '|').split('|');
        const price = it.prices.find((x) => entryKey(x) === p.entry && !x.noFee) ?? null;
        const needsSitting = p.on && (attempt === 'retake' || it.needsPriorSeries) && !isKnown(it);
        const noFee = it.prices.length > 0 && it.prices.every((x) => x.noFee);
        return (
          <tr key={it.id} className={unavailable ? 'text-muted-foreground' : ''}>
            <td className="px-3 py-2 align-top">
              <input type="checkbox" className="h-4 w-4" aria-label={`${o.subject.name}: ${it.label}`}
                checked={p.on} disabled={unavailable || (coreLocked && p.on)} onChange={(e) => toggle(o, it, e.target.checked)} />
            </td>
            <td className="px-3 py-2 align-top">
              <span>{it.label}</span>
              {it.availability !== 'open' && AVAILABILITY[it.availability] && <> <Badge tone="warning">{AVAILABILITY[it.availability]}</Badge></>}
              {isKnown(it) && <> <Badge tone="info"><span>sat</span>&nbsp;<bdi data-i18n-skip="true">{knownOf(it)[0]!.series}</bdi></Badge></>}
              {it.held && <> <Badge tone="success">already reserved</Badge></>}
              {!reservable(it) && !it.held && <> <Badge tone="neutral">closed for new entries</Badge></>}
              {!it.open.first && it.open.retake && !it.held && <> <Badge tone="warning">retakes of the previous sitting only</Badge></>}
              {noFee && <> <Badge tone="warning">board fee not set yet</Badge></>}
              {/* A retake or a carry-forward whose sitting the system does not know is declared: the school verifies it. */}
              {needsSitting && <> <Badge tone="warning">{desk ? 'declared — listed to verify' : 'to be verified by the school'}</Badge></>}
              {it.series && <div className="text-xs text-muted-foreground"><bdi data-i18n-skip="true">{seriesName(o, it)}</bdi></div>}
            </td>
            <td className="px-3 py-2 align-top">
              {p.on && (mode === 'self_study' ? <span className="text-muted-foreground">— self-study</span>
                : it.teachers.length > 1 ? (
                  <select aria-label="Teacher" className={INPUT_CLASS.replace('w-full', 'w-48')} value={p.teacherId ?? ''} onChange={(e) => setPick(it, { teacherId: e.target.value || null })}>
                    <option value="">No preference</option>
                    {it.teachers.map((t) => <option key={t.id} value={t.id} data-i18n-skip="true">{t.name}{t.mode === 'online' ? ' (online)' : ''}</option>)}
                  </select>
                ) : it.teachers.length === 1 ? <bdi data-i18n-skip="true">{it.teachers[0]!.name}{it.teachers[0]!.mode === 'online' ? ' (online)' : ''}</bdi> : <span className="text-muted-foreground">—</span>)}
            </td>
            <td className="px-3 py-2 align-top">
              {p.on && (
                <div className="space-y-1.5">
                  <select aria-label="Entry" className={INPUT_CLASS.replace('w-full', 'w-80')} value={p.entry ?? ''} onChange={(e) => setPick(it, { entry: e.target.value, sitting: '' })}>
                    {options.map((x) => <option key={entryKey(x)} value={entryKey(x)}>{entryLabel(x, isKnown(it))}</option>)}
                  </select>
                  {needsSitting && (
                    <select aria-label="The sitting it follows" className={INPUT_CLASS.replace('w-full', 'w-80')} value={p.sitting} onChange={(e) => setPick(it, { sitting: e.target.value })}>
                      <option value="">{it.needsPriorSeries ? 'Carried from the sitting…' : 'From the sitting…'}</option>
                      {sittings.map((s) => <option key={sittingValue(s)} value={sittingValue(s)}>{sittingName(s)}</option>)}
                    </select>
                  )}
                </div>
              )}
            </td>
            <td className="px-3 py-2 text-end align-top">
              {p.on && price && (
                <span title={`course ${price.courseFee?.toLocaleString('en-US')} + board ${price.registrationFee?.toLocaleString('en-US')}`}>
                  <Money amount={price.total} />{price.provisional && <> <Badge tone="warning">ⓟ</Badge></>}
                </span>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

export function SlipLink({ studentId, registrationIds }: { studentId: string; registrationIds: string[] }) {
  if (!registrationIds.length) return null;
  return (
    <Link href={`/reservation-slip/${studentId}?ids=${registrationIds.join(',')}`} target="_blank" className="text-sm text-primary underline hover:no-underline">
      Print the reservation slip
    </Link>
  );
}
