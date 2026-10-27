'use client';

/**
 * Reserve — one page per child per session, for the family and for the desk (COORDINATOR_REWORK.md F1, §5; P3).
 *
 * The form version: one Google Form per subject — seven identity questions, the teacher, "first entry or retake",
 * which papers, "self study 50% (ONLY 2nd entry)", the refund policy and the declaration — about 35 answers for
 * three subjects, no price anywhere, all of it again for a second child. Here the child is known: every subject
 * the school offers this child is a card with only the choices open to them, as the coordinator set them (D3, D8,
 * D9), the price beside each; the teacher where the family chooses one (D5), the earlier exam a retake follows (D6,
 * F2), the school's extra questions (D13); one total, one agreement (the refund policy and the declaration) and one
 * button per child. A parent switching children keeps each child's choices (the caller holds the draft).
 *
 * Built on the family read's v2 part (components/reservations/offers.ts). A refusal comes back with a code: the page
 * puts its sentence at the subject it concerns and offers the next step; it never shows the code.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InferRequestType } from 'hono/client';
import { api } from '~/lib/hono';
import {
  apiResponse,
  refusalCodeOf,
  DESK_CONSENT_TEXT,
  IN_SCHOOL_INSTRUMENTS,
  IN_SCHOOL_INSTRUMENT_LABELS,
  formatEgp,
  refundConsentText,
  type RefusalCode,
  type SeriesMonth,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { useI18n } from '~/lib/i18n';
import { familyWords } from '~/lib/i18n-reservations';
import { ErrorState, LoadingState, EmptyState } from '~/components/ui/query-state';
import { Money, Day, INPUT_CLASS, ErrorLine, errorText } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import { titleFor } from '~/app/(app)/(sessions)/admin/sessions/setup-shared';
import { fetchStatement, statementKey } from './statement';
import { fetchReserveOffers, reserveOffersKey, optionKey, type OffersRead, type Offering, type OfferRow, type RowOption, type Question } from './offers';

export { fetchReserveOffers, reserveOffersKey } from './offers';

// ─── The API's reservation routes, typed by it (PATTERNS.md) ─────────────────

type LinesJson = InferRequestType<typeof api.v1.registrations.direct.$post>['json']['lines'];
type Line = LinesJson[number];
const reserveDirect = (json: InferRequestType<typeof api.v1.registrations.direct.$post>['json']) => apiResponse(api.v1.registrations.direct.$post({ json }));
const reserveRequest = (json: InferRequestType<typeof api.v1.registrations.request.$post>['json']) => apiResponse(api.v1.registrations.request.$post({ json }));
const reserveDesk = (json: InferRequestType<typeof api.v1.registrations.desk.$post>['json']) => apiResponse(api.v1.registrations.desk.$post({ json }));
export type DeskResult = Awaited<ReturnType<typeof reserveDesk>>;

/** The refund terms a reservation in this session freezes at consent: weeks, or a converted session's dates (the swap's ticks read them). */
export const fetchRefundTerms = (sessionId: string) => apiResponse(api.v1.sessions[':id']['refund-terms'].$get({ param: { id: sessionId } }));
export type RefundTermsState = { terms: Awaited<ReturnType<typeof fetchRefundTerms>>['terms'] | null; ready: boolean; failed: boolean };
export function useRefundTerms(sessionId: string | null | undefined): RefundTermsState {
  const q = useQuery({ queryKey: ['sessions', sessionId, 'refund-terms'], queryFn: () => fetchRefundTerms(sessionId!), enabled: !!sessionId, retry: 1 });
  return { terms: q.data?.terms ?? null, ready: !!q.data, failed: q.isError };
}

/** The refund-policy tick's sentence from the terms it freezes; until they are read, a line saying so. */
export function RefundTermsSentence({ state }: { state: RefundTermsState }) {
  if (state.ready) return <span>{refundConsentText(state.terms)}</span>;
  if (state.failed) return <span className="text-destructive">The refund terms could not be loaded, so nothing can be reserved yet: reload the page to try again.</span>;
  return <span className="text-muted-foreground">Loading the refund terms…</span>;
}

// ─── What the caller keeps (one child's choices) ─────────────────────────────

type Attempt = 'first' | 'retake';
type Mode = 'in_school' | 'self_study';
/** The option picked in a group, with its teacher and the earlier exam it follows ('id:<series>' or 'my:<month>|<year>'). */
type Pick = { rowId: string; attempt: Attempt; mode: Mode; teacherId: string; earlier: string; title: string };
/** One child's page: the picks per group, the answers, the subjects whose retakes are shown, the ticks. */
export type ReserveDraft = {
  picks: Record<string, Pick>;
  answers: Record<string, string>;
  reveal: Record<string, boolean>;
  refund: boolean;
  decl: boolean;
  desk: boolean;
};
export const EMPTY_DRAFT: ReserveDraft = { picks: {}, answers: {}, reveal: {}, refund: false, decl: false, desk: false };

/**
 * A reservation's result. `sentences` are shown each in its own element, so each is translated on its own;
 * `message` is the same text joined, for places that take a string.
 */
export type ReserveDone = {
  registrationIds: string[];
  message: string;
  sentences: string[];
  desk?: DeskResult;
  /** What was reserved, for the family's next step: the total and whether it can be paid now (prices final). */
  total: number;
  payable: boolean;
};

/** Sentences shown one element each (each translated on its own), separated by a space. */
export function Sentences({ items }: { items: string[] }) {
  return <>{items.map((s, i) => <span key={i}>{i > 0 && ' '}<span>{s}</span></span>)}</>;
}

/** At the desk, what goes with "Reserve and collect" beside the lines: the year's school fee (collected first) and charges. */
export type DeskExtras = { chargeIds: string[]; schoolFeeYear?: string; total: number };

// ─── The page's words, per who is reading ────────────────────────────────────

type Viewer = 'student' | 'parent' | 'desk';
const WORDS: Record<Viewer, { what: string; when: string; whenAS: string; approval: string }> = {
  parent: { what: 'What will your child take?', when: 'When did your child sit it?', whenAS: 'When did your child sit the A.S.?', approval: 'waiting for your approval' },
  student: { what: 'What will you take?', when: 'When did you sit it?', whenAS: 'When did you sit the A.S.?', approval: "waiting for your parent's approval" },
  desk: { what: 'What will the student take?', when: 'When did the student sit it?', whenAS: 'When did the student sit the A.S.?', approval: "waiting for the parent's approval" },
};
const HELD_STATUS: Record<string, string> = { pending_payment: 'waiting for payment', confirmed: 'paid' };
const LIVE = ['pending_approval', 'pending_payment', 'confirmed'];
/** Codes whose next step is to take the subject off the choices (it can no longer be reserved as picked). */
const TAKE_OFF: RefusalCode[] = ['NOT_ACCEPTING', 'NOT_OPEN', 'BOARD_DEADLINE_PASSED', 'OPTION_NOT_OFFERED', 'ONE_PAPER_IS_RETAKE', 'EXCLUSIVE_OPTIONS', 'SAME_ENTRY_ONCE', 'ALREADY_RESERVED', 'RETAKE_ONLY', 'SELF_STUDY_SECOND_ENTRY_ONLY'];
/** Codes after which the page reads the offers again (a price, a close or what the student holds changed). */
const READ_AGAIN: RefusalCode[] = [...TAKE_OFF, 'PRICE_CHANGED'];

// ─── Groups: the rows a family picks one option of ───────────────────────────

/** Rows that exclude each other (D8: all papers and one-paper rows; A.S., A.2. and A.L.) are one group; a unit is its own. */
type Group = { key: string; offering: Offering; rows: OfferRow[] };
function groupsOf(o: Offering): Group[] {
  const out: Group[] = [];
  for (const r of o.rows) {
    const key = `${o.id}|${r.exclusiveGroup ?? r.id}`;
    const g = out.find((x) => x.key === key);
    if (g) g.rows.push(r);
    else out.push({ key, offering: o, rows: [r] });
  }
  return out;
}

/** A subject as the school names it: "Biology O.L.", "Biology A.S./A.L.", "Arabic A.L." (two subjects share a name; the coordinator's screens say it so). */
export const titleOf = (o: { name: string; group: string }) => titleFor(o.name, o.group);

/** A DOM id for a group or a question, unique per child. */
const domId = (studentId: string, k: string) => `reserve-${studentId}-${k}`.replace(/[^\w-]/g, '-');

/**
 * The earlier exam a picked option names: the one the school knows (F2: shown, and filled in by the server, which
 * records it as known), else the family's pick among its choices; none for a first entry that carries nothing. A
 * carried row whose known exam is not one it carries from asks among those it does; a carried row whose list the
 * coordinator emptied asks among the board's earlier exams (`retakeFrom`, what the line rules then take).
 */
function earlierOf(row: OfferRow, option: RowOption) {
  const none = { asks: false, known: null as OfferRow['knownSitting'], choices: [] as { value: string; label: { en: string; ar: string } }[] };
  const fromBoard = () => option.retakeFrom.map((s) => ({ value: s.id ? `id:${s.id}` : `my:${s.month}|${s.year}`, label: s.label }));
  if (option.needsCarriedFrom) {
    const anyOfBoard = !option.allowedSittings.length;
    if (row.knownSitting && (anyOfBoard || option.allowedSittings.some((s) => s.id === row.knownSitting!.id))) return { ...none, known: row.knownSitting };
    return { ...none, asks: true, choices: anyOfBoard ? fromBoard() : option.allowedSittings.map((s) => ({ value: `id:${s.id}`, label: s.label })) };
  }
  if (option.attempt !== 'retake') return none;
  if (row.knownSitting) return { ...none, known: row.knownSitting };
  return { ...none, asks: true, choices: fromBoard() };
}

/** Whether the family chooses this option's teacher (D5: in school, several teachers, the families' choice). */
const choosesTeacher = (o: Offering, option: RowOption) =>
  option.mode === 'in_school' && o.teacherChoice === 'families' && !o.teacherTbc && option.teachers.length > 1;

/**
 * `viewer`: who is reserving — the student (a request their parent approves), a parent (for a linked child), or
 * the desk (staff, on the family's behalf). `draft` / `onDraft`: the caller keeps the child's choices (a parent
 * switching children); without them the page keeps its own. `deskExtras`: the desk's "Also collect now".
 */
export function Reserve({ viewer, studentId, sessionId, onDone, deskExtras, draft: given, onDraft, childName }: {
  viewer: Viewer;
  studentId: string;
  sessionId: string;
  onDone: (done: ReserveDone) => void;
  deskExtras?: DeskExtras;
  draft?: ReserveDraft;
  onDraft?: (d: ReserveDraft) => void;
  childName?: string;
}): React.JSX.Element {
  const desk = viewer === 'desk';
  const words = WORDS[viewer];
  const { language: lang } = useI18n();
  const qc = useQueryClient();
  const offers = useQuery({
    queryKey: reserveOffersKey(sessionId, studentId),
    queryFn: () => fetchReserveOffers(sessionId, viewer === 'student' ? undefined : studentId),
    retry: false,
  });
  // What the student already holds in the session: a subject reserved is shown as such, not offered again.
  const statementQuery = { studentId };
  const statement = useQuery({ queryKey: statementKey(statementQuery), queryFn: () => fetchStatement(statementQuery), retry: false });
  const [own, setOwn] = useState<ReserveDraft>(EMPTY_DRAFT);
  const draft = given ?? own;
  const setDraft = (d: ReserveDraft) => (onDraft ? onDraft(d) : setOwn(d));
  const [instrument, setInstrument] = useState<(typeof IN_SCHOOL_INSTRUMENTS)[number]>('cash');
  const [escrow, setEscrow] = useState('');
  // What stops the reservation, where it is: a group or question key → its sentence; `page` for the rest.
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<{ sentence: string; code: RefusalCode | undefined; key: string | null; candidates?: string[] } | null>(null);

  const data = offers.data;
  const offerings = useMemo(() => data?.offerings ?? [], [data]);
  const groups = useMemo(() => offerings.flatMap(groupsOf), [offerings]);
  const held = useMemo(() => {
    const lines = (statement.data?.students.find((s) => s.student.id === studentId) ?? statement.data?.students[0])
      ?.sessions.find((s) => s.id === sessionId)?.lines.filter((l) => LIVE.includes(l.status)) ?? [];
    return new Map(lines.map((l) => [l.offerItemId, l]));
  }, [statement.data, studentId, sessionId]);

  // The desk: subjects of this session already waiting for payment (collected with the new ones in one payment).
  const waitingHere = [...held.values()].filter((l) => l.status === 'pending_payment').length;
  const rowOf = (id: string) => offerings.flatMap((o) => o.rows.map((r) => ({ o, r }))).find((x) => x.r.id === id) ?? null;
  const chosen = Object.entries(draft.picks).flatMap(([key, p]) => {
    const found = rowOf(p.rowId);
    const option = found?.r.options.find((x) => optionKey(x) === optionKey(p)) ?? null;
    return found && option ? [{ key, p, o: found.o, r: found.r, option }] : [];
  });
  const total = chosen.reduce((a, c) => a + (c.option.price?.total ?? 0), 0);
  const pricesFinal = !!data?.session.pricesFinal;
  const closedSession = data?.session.status === 'closed';

  const patch = (next: Partial<ReserveDraft>) => setDraft({ ...draft, ...next });
  const setPick = (key: string, p: Pick | null) => {
    const picks = { ...draft.picks };
    if (p) picks[key] = p;
    else delete picks[key];
    setProblems(({ [key]: _gone, ...rest }) => rest);
    if (refusal?.key === key || refusal?.candidates?.includes(key)) setRefusal(null);
    patch({ picks });
  };

  // A pick the read no longer offers as picked (the subject switched off or closed while the page was open, a choice
  // taken off its row, first entries gone once the school knows the student sat it; a refusal's read-again): off the
  // choices, and said in the summary with the refusal's sentence when there was one. Never left out unsaid.
  const [gone, setGone] = useState<{ key: string; sentence: string }[]>([]);
  useEffect(() => {
    if (!data) return;
    const rows = new Map(data.offerings.flatMap((o) => o.rows.map((r) => [r.id, r] as const)));
    const missing = Object.entries(draft.picks).flatMap(([key, p]) => {
      const row = rows.get(p.rowId);
      if (!row) return [{ key, p, why: `${p.title}: no longer taking reservations.` }];
      // Reserved meanwhile (the student's request, the desk, another tab): the group shows it as held.
      if (groups.find((g) => g.key === key)?.rows.some((r) => held.has(r.id))) return [{ key, p, why: `${p.title}: already reserved.` }];
      return row.options.some((x) => optionKey(x) === optionKey(p)) ? [] : [{ key, p, why: `${p.title}: this choice is no longer offered.` }];
    }).map(({ key, p, why }) => [key, p, why] as const);
    if (!missing.length) return;
    setGone((g) => [...g, ...missing.map(([key, , why]) => ({
      key, sentence: refusal?.key === key ? refusal.sentence : why,
    }))]);
    if (missing.some(([key]) => refusal?.key === key)) setRefusal(null);
    const picks = { ...draft.picks };
    for (const [key] of missing) delete picks[key];
    setDraft({ ...draft, picks });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, held]);

  // A refusal at a subject: bring it into view.
  useEffect(() => {
    if (!refusal?.key) return;
    document.getElementById(domId(studentId, refusal.key))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [refusal, studentId]);

  /** The questions asked: the session's, and each picked subject's (D13). */
  const asked: Question[] = [
    ...(data?.session.questions ?? []),
    ...offerings.filter((o) => chosen.some((c) => c.o.id === o.id)).flatMap((o) => o.questions),
  ];

  /** What is not finished, each at its place (the refusals the page can see before sending). */
  function unfinished(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const c of chosen) {
      if (choosesTeacher(c.o, c.option) && !c.p.teacherId) out[c.key] = 'Choose the teacher';
      else if (earlierOf(c.r, c.option).asks && !c.p.earlier) out[c.key] = 'Choose the earlier exam';
    }
    for (const q of asked) if (q.required && !(draft.answers[q.id] ?? '').trim()) out[`q:${q.id}`] = 'Answer this question';
    if (!chosen.length) out.page = 'Pick at least one subject.';
    else if (desk ? !draft.desk : !(draft.refund && draft.decl)) out.page = desk ? 'Tick that the parent read and signed the refund policy and the declaration.' : 'Tick the refund policy and the declaration.';
    return out;
  }

  const linesOut = (): Line[] => chosen.map((c) => {
    const line: Line = { offerItemId: c.r.id, attempt: c.p.attempt, mode: c.p.mode, ...(c.option.price ? { expectedPrice: c.option.price.total } : {}) };
    if (choosesTeacher(c.o, c.option)) line.teacherId = c.p.teacherId;
    // A known exam is not sent: the server fills it in from the student's record and records it as known (sent, it
    // would read as the family's declaration, under the declaration's two-year rule).
    if (earlierOf(c.r, c.option).known) { /* filled in by the server */ }
    else if (c.p.earlier.startsWith('id:')) line.priorSittingSeriesId = c.p.earlier.slice(3);
    else if (c.p.earlier.startsWith('my:')) {
      const [month, year] = c.p.earlier.slice(3).split('|') as [SeriesMonth, string];
      line.priorSitting = { month, year: Number(year) };
    }
    return line;
  });
  const answersOut = () => asked.flatMap((q) => {
    const v = (draft.answers[q.id] ?? '').trim();
    return v ? [{ questionId: q.id, value: v }] : [];
  });
  const consent = { refundPolicy: true as const, declaration: true as const };

  /**
   * Where a refusal belongs: the picked subject its sentence names (the longest name, then the row's words), read
   * from the API's own sentence. Two picks the sentence names alike with no row named (Physics O.L. and Physics
   * A.S./A.L.: a subject's close, or an all-papers row, is named by the subject alone) leave it at the page, each of
   * them offered off: a refusal is never pinned to a guess. `candidates`: the picks it may concern.
   */
  function locate(sentence: string): { key: string | null; candidates: string[] } {
    const named = chosen.filter((c) => sentence.includes(c.o.name)).sort((a, b) => b.o.name.length - a.o.name.length);
    if (!named.length) {
      const q = asked.find((x) => sentence.includes(x.prompt));
      return { key: q ? `q:${q.id}` : null, candidates: [] };
    }
    const top = named.filter((c) => c.o.name === named[0]!.o.name);
    const byRow = top.filter((c) => c.r.kind !== 'all_papers' && sentence.includes(`${c.o.name} — `) && sentence.includes(c.r.label.en));
    if (byRow.length === 1) return { key: byRow[0]!.key, candidates: [] };
    return top.length === 1 ? { key: top[0]!.key, candidates: [] } : { key: null, candidates: top.map((c) => c.key) };
  }
  const refused = (e: unknown) => {
    const code = refusalCodeOf(e);
    // Located by the API's sentence (the school's question prompts and names as written), shown in the family's words.
    const raw = errorText(e);
    const sentence = familyWords(raw);
    const q = code === 'ANSWER_REQUIRED' ? asked.find((x) => raw.includes(x.prompt)) : undefined;
    const at = code === 'ANSWER_REQUIRED' ? { key: q ? `q:${q.id}` : null, candidates: [] } : locate(raw);
    setRefusal({ sentence, code, key: at.key, candidates: at.candidates });
    // What the student holds is read again after any refusal (something may have been reserved meanwhile: the held
    // picks then leave the choices, named); the offers when the code says they changed, or when there is no code.
    qc.invalidateQueries({ queryKey: statementKey(statementQuery) });
    if (!code || READ_AGAIN.includes(code)) qc.invalidateQueries({ queryKey: reserveOffersKey(sessionId, studentId) });
  };
  const afterReserve = () => {
    // A consent belongs to the lines it was given for; the next reservation asks again.
    setDraft(EMPTY_DRAFT);
    setProblems({});
    setRefusal(null);
    setGone([]);
    qc.invalidateQueries({ queryKey: ['registrations'] });
    qc.invalidateQueries({ queryKey: ['statement'] });
  };

  const familyMutation = useMutation({
    mutationFn: async () => {
      const body = { sessionId, lines: linesOut(), answers: answersOut(), consent };
      if (viewer === 'student') return reserveRequest(body);
      return reserveDirect({ ...body, studentId });
    },
    onSuccess: (made) => {
      const reservedTotal = total;
      afterReserve();
      const n = `${made.length} reservation${made.length === 1 ? '' : 's'}`;
      const sentences = viewer === 'student'
        ? [`Sent to your parent for approval: ${n}.`]
        : pricesFinal
          ? [`Reserved: ${n} waiting for payment.`]
          : [`Reserved: ${n}.`, 'You can pay once the school confirms its prices.'];
      onDone({ registrationIds: made.map((r) => r.id), message: sentences.join(' '), sentences, total: reservedTotal, payable: pricesFinal && viewer === 'parent' });
    },
    onError: refused,
  });

  const deskMutation = useMutation({
    mutationFn: (collect: boolean) => reserveDesk({
      studentId, sessionId, lines: linesOut(), answers: answersOut(), consent,
      ...(collect ? { collectNow: {
        instrumentUsed: instrument, escrowAmountToApply: Math.min(Math.max(Number(escrow) || 0, 0), total),
        // The year's school fee first (the registration's gate asks for it) and the charges after, each its own payment.
        ...(deskExtras?.schoolFeeYear ? { schoolFeeYear: deskExtras.schoolFeeYear } : {}),
        ...(deskExtras?.chargeIds.length ? { chargeIds: deskExtras.chargeIds } : {}),
      } } : {}),
    }),
    onSuccess: (r) => {
      const reservedTotal = total;
      afterReserve();
      qc.invalidateQueries({ queryKey: ['desk'] });
      qc.invalidateQueries({ queryKey: ['finance'] });
      const parts = [`Reserved ${r.registrations.length} reservation${r.registrations.length === 1 ? '' : 's'}.`];
      if (r.schoolFee) parts.push(`The ${r.schoolFee.academicYear} school fee collected first (${formatEgp(r.schoolFee.amount)}).`);
      // One payment for the subjects (no split by deadline), the charges each in their own.
      if (r.collected > 0) parts.push(`Collected ${formatEgp(r.collected)}.`);
      if (r.reservedNotCollected.length) parts.push(`${r.reservedNotCollected.length} reserved, not collected: prices are not final yet.`);
      for (const n of r.notCollected) parts.push(`Not collected — hand this money back: ${formatEgp(n.amount)} (${familyWords(n.reason)}).`);
      onDone({ registrationIds: r.registrations.map((x) => x.id), message: parts.join(' '), sentences: parts, desk: r, total: reservedTotal, payable: false });
    },
    onError: refused,
  });
  const pending = familyMutation.isPending || deskMutation.isPending;

  const submit = (send: () => void) => {
    setRefusal(null);
    const left = unfinished();
    setProblems(left);
    const first = Object.keys(left).find((k) => k !== 'page');
    if (first) {
      document.getElementById(domId(studentId, first))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (left.page) return;
    send();
  };

  if (offers.isLoading || statement.isLoading) return <LoadingState />;
  if (offers.isError || !data) return <ErrorState message={offers.error instanceof Error ? familyWords(offers.error.message) : undefined} onRetry={() => offers.refetch()} />;
  // What the student already holds decides what can be picked: without it, nothing is offered as pickable.
  if (statement.isError) return <ErrorState message="What this student already reserved could not be loaded, so nothing can be picked yet." onRetry={() => statement.refetch()} />;
  if (!data.eligibility.allowed) {
    return <Notice tone="danger" title="Not open to this student">{familyWords(data.eligibility.reason ?? '')}</Notice>;
  }
  if (data.session.status === 'draft') return <EmptyState title="Reservations have not opened yet" />;
  if (!offerings.length) return <EmptyState title="Nothing is offered in this session yet" />;

  // The balance used: at most the subjects' total (the API refuses more; the charges are paid apart).
  const fromBalance = Math.min(Math.max(Number(escrow) || 0, 0), total);
  const payableNow = pricesFinal ? Math.max(0, total + (deskExtras?.total ?? 0) - fromBalance) : 0;
  const pageProblem = problems.page ?? (refusal && !refusal.key ? refusal.sentence : null);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          <span>Reservations close</span>{' '}
          {data.session.closesAt ? <Day iso={String(data.session.closesAt)} /> : <span>when the school closes them</span>}
          {' · '}
          {!data.session.paymentDueAt ? <span>The payment date is not set yet</span>
            : new Date(data.session.paymentDueAt).getTime() > Date.now() ? <><span>Pay by</span> <Day iso={String(data.session.paymentDueAt)} /></>
              // Past the session's payment date, a new reservation is due a few days after it is made: its own date is on the statement.
              : <span>Each new reservation has its own date to pay by, shown once it is reserved</span>}
        </p>
        <p className="text-sm text-muted-foreground">
          {desk
            ? 'Every subject this student may take, with only the choices open to them and their prices. Pick what the parent asks for; the total is at the bottom.'
            : viewer === 'student'
              ? 'Every subject open to you this session, with its choices and their prices. Pick one choice per subject; your parent approves and pays.'
              : 'Every subject open to your child this session, with its choices and their prices. Pick one choice per subject; the total is at the bottom.'}
        </p>
      </div>
      {closedSession && <Notice tone="neutral">Reservations for this session are closed. What is already reserved can still be paid.</Notice>}
      {!pricesFinal && !closedSession && <Notice tone="info">Prices are not final yet: you can reserve now and pay once the school confirms them.</Notice>}

      {(['O.L.', 'A.S./A.L.'] as const).map((group) => {
        const os = offerings.filter((o) => o.group === group);
        if (!os.length) return null;
        return (
          <section key={group} aria-label={group === 'O.L.' ? 'O.L.' : 'A.S. / A.L.'} className="space-y-3">
            <h2 className="font-display text-base font-semibold text-foreground" dir="ltr">{group === 'O.L.' ? 'O.L.' : 'A.S. / A.L.'}</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {os.map((o) => (
                <SubjectCard key={o.id} o={o} lang={lang} words={words} viewer={viewer} studentId={studentId} draft={draft} held={held}
                  disabled={closedSession || pending} problems={problems} refusal={refusal}
                  onPick={setPick} onReveal={() => patch({ reveal: { ...draft.reveal, [o.id]: true } })}
                  onAnswer={(id, v) => { setProblems(({ [`q:${id}`]: _gone, ...rest }) => rest); patch({ answers: { ...draft.answers, [id]: v } }); }} />
              ))}
            </div>
          </section>
        );
      })}

      <section aria-labelledby={domId(studentId, 'summary')} className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={domId(studentId, 'summary')} className="font-display text-base font-semibold text-foreground">
            {childName ? <><span>Reserving for</span> <bdi data-i18n-skip="true">{childName}</bdi></> : <span>Your choices</span>}
          </h2>
          <p className="text-base font-semibold text-foreground">
            <span>{chosen.length}</span> <span>{chosen.length === 1 ? 'subject' : 'subjects'}</span> · <span>Total</span> <Money amount={total} />
          </p>
        </div>
        {chosen.length ? (
          <ul className="divide-y divide-border text-sm">
            {chosen.map((c) => (
              <li key={c.key} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                <span className="min-w-0">
                  <bdi className="font-medium text-foreground" data-i18n-skip="true">{titleOf(c.o)}</bdi>{' '}
                  <span className="text-muted-foreground" data-i18n-skip="true">{c.option.label[lang]}</span>
                  {/* D5: the teacher picked (one is preselected), read back to the parent. */}
                  {c.p.teacherId && c.option.teachers.find((t) => t.id === c.p.teacherId) && (
                    <span className="text-muted-foreground"> · <bdi data-i18n-skip="true">{c.option.teachers.find((t) => t.id === c.p.teacherId)!.name}</bdi></span>
                  )}
                </span>
                <Money amount={c.option.price?.total} />
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Nothing picked yet.</p>}
        {!pricesFinal && chosen.length > 0 && <p className="text-xs text-muted-foreground">Prices are not final yet: you can reserve now and pay once the school confirms them.</p>}

        {data.session.questions.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-medium text-foreground">A few questions from the school</p>
            {data.session.questions.map((q) => (
              <QuestionField key={q.id} q={q} id={domId(studentId, `q:${q.id}`)} value={draft.answers[q.id] ?? ''} problem={problems[`q:${q.id}`] ?? (refusal?.key === `q:${q.id}` ? refusal.sentence : undefined)}
                disabled={pending} onChange={(v) => { setProblems(({ [`q:${q.id}`]: _gone, ...rest }) => rest); patch({ answers: { ...draft.answers, [q.id]: v } }); }} />
            ))}
          </div>
        )}

        <div className="space-y-2 border-t border-border pt-3 text-sm">
          {desk ? (
            <>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={draft.desk} onChange={(e) => patch({ desk: e.target.checked })} />
                <span>{DESK_CONSENT_TEXT}</span>
              </label>
              <p className="text-xs text-muted-foreground"><span>{consentSentence(data.session.refundSentence)}</span> <span>{data.session.declaration}</span></p>
            </>
          ) : (
            <>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={draft.refund} onChange={(e) => patch({ refund: e.target.checked })} />
                <span>{consentSentence(data.session.refundSentence)}</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={draft.decl} onChange={(e) => patch({ decl: e.target.checked })} />
                <span>{data.session.declaration}</span>
              </label>
            </>
          )}
        </div>

        {gone.length > 0 && (
          <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {gone.map((g) => <p key={g.key}><span>{g.sentence}</span>{!g.sentence.endsWith('.') && <span>.</span>} <span>It was taken off the choices.</span></p>)}
          </div>
        )}
        {Object.keys(problems).some((k) => k !== 'page') && <ErrorLine message="Some choices are not finished: they are marked in red above." />}
        <ErrorLine message={pageProblem} />
        {/* A refusal that may concern several picks (two subjects of one name): each offered off, never a guess. */}
        {refusal && !refusal.key && refusal.code && TAKE_OFF.includes(refusal.code) && (refusal.candidates ?? []).length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {chosen.filter((c) => refusal.candidates!.includes(c.key)).map((c) => (
              <button key={c.key} type="button" className="font-medium text-destructive underline underline-offset-4" onClick={() => setPick(c.key, null)}>
                <span>Take off the choices:</span> <bdi data-i18n-skip="true">{titleOf(c.o)}</bdi>
              </button>
            ))}
          </div>
        )}

        {/* "Then one collection" (§5 Desk): subjects already waiting are collected with the new ones in one payment, under
            "To collect now" — "Reserve and collect" would pay the new ones alone, so it waits until nothing else does. */}
        {desk && waitingHere > 0 && (
          <p className="text-sm text-foreground">
            <span>{waitingHere}</span> <span>{waitingHere === 1 ? 'subject is already waiting for payment:' : 'subjects are already waiting for payment:'}</span>{' '}
            <span>reserve only, then collect everything in one payment under "To collect now".</span>
          </p>
        )}
        {desk ? (
          <div className="flex flex-wrap items-end gap-3">
            <Button variant="outline" disabled={pending || closedSession} onClick={() => submit(() => deskMutation.mutate(false))}>Reserve only</Button>
            <div>
              <label htmlFor={domId(studentId, 'instrument')} className="mb-1 block text-xs font-medium text-foreground">Paid with</label>
              <select id={domId(studentId, 'instrument')} className={cn(INPUT_CLASS, 'w-44')} value={instrument} onChange={(e) => setInstrument(e.target.value as typeof instrument)}>
                {IN_SCHOOL_INSTRUMENTS.map((i) => <option key={i} value={i}>{IN_SCHOOL_INSTRUMENT_LABELS[i]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={domId(studentId, 'escrow')} className="mb-1 block text-xs font-medium text-foreground">Balance to use (EGP)</label>
              <input id={domId(studentId, 'escrow')} type="number" min="0" max={total} step="0.01" inputMode="decimal" className={cn(INPUT_CLASS, 'w-32')} value={escrow} onChange={(e) => setEscrow(e.target.value)} placeholder="0" />
            </div>
            <Button disabled={pending || closedSession || !pricesFinal || waitingHere > 0 || (chosen.length > 0 && total <= 0)} onClick={() => submit(() => deskMutation.mutate(true))}>
              <span>Reserve and collect</span> <Money amount={payableNow} />
            </Button>
            {!pricesFinal && <p className="w-full text-xs text-muted-foreground">Prices are not final yet: reserve now, and collect once they are.</p>}
          </div>
        ) : (
          <Button className="w-full sm:w-auto" disabled={pending || closedSession} onClick={() => submit(() => familyMutation.mutate())}>
            {pending ? 'Reserving…' : viewer === 'student' ? 'Send to my parent' : <><span>Reserve now</span>{chosen.length > 0 && <> <span dir="ltr">({chosen.length})</span></>}</>}
          </Button>
        )}
      </section>
    </div>
  );
}

/** The refund-policy tick, from the session's policy sentence (the terms a reservation freezes). */
function consentSentence(refundSentence: string | null) {
  return refundSentence
    ? `I confirm that I have read the refund policy: of the course fee, ${refundSentence}, counted from the first lesson.`
    : 'I confirm that I have read the refund policy.';
}

// ─── One subject ─────────────────────────────────────────────────────────────

type HeldLine = { status: string; attempt: string; mode: string };

function SubjectCard({ o, lang, words, viewer, studentId, draft, held, disabled, problems, refusal, onPick, onReveal, onAnswer }: {
  o: Offering; lang: 'en' | 'ar'; words: (typeof WORDS)[Viewer]; viewer: Viewer; studentId: string; draft: ReserveDraft;
  held: Map<string, HeldLine>; disabled: boolean; problems: Record<string, string>;
  refusal: { sentence: string; code: RefusalCode | undefined; key: string | null } | null;
  onPick: (key: string, p: Pick | null) => void; onReveal: () => void; onAnswer: (id: string, v: string) => void;
}) {
  const groups = groupsOf(o);
  const picks = groups.map((g) => draft.picks[g.key]).filter((p): p is Pick => !!p);
  const known = o.rows.some((r) => r.knownSitting);
  const hasFirst = o.rows.some((r) => r.options.some((x) => x.attempt === 'first'));
  const hasRetake = o.rows.some((r) => r.options.some((x) => x.attempt === 'retake'));
  // F2 as the lead decided on P2's mock (26 Oct 2026, coordinator-rework.tsv; the coordinator's preview shows the same):
  // a student with no record sees first entries, and "Sat it before?" shows the retakes — one click, never hidden for
  // good; shown at once when there is no first entry; a student the school knows sat it gets the retakes only.
  const showRetakes = known || !hasFirst || !!draft.reveal[o.id] || picks.some((p) => p.attempt === 'retake');
  const allOnline = o.rows.every((r) => r.options.every((x) => x.mode !== 'in_school' || (x.teachers.length > 0 && x.teachers.every((t) => t.online))))
    && o.rows.some((r) => r.options.some((x) => x.mode === 'in_school' && x.teachers.length > 0));
  const several = groups.length > 1;
  const anyProblem = groups.some((g) => problems[g.key] || refusal?.key === g.key);
  return (
    <article className={cn('rounded-xl border bg-card p-4 shadow-sm', picks.length ? 'border-primary ring-1 ring-primary' : 'border-border', anyProblem && 'border-destructive ring-1 ring-destructive')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-display text-base font-semibold text-foreground">
          <bdi data-i18n-skip="true">{titleOf(o)}</bdi> <span className="text-xs font-normal text-muted-foreground"><bdi data-i18n-skip="true">{o.board}</bdi></span>
        </h3>
        {allOnline && <Badge tone="info">Taught online</Badge>}
      </div>
      {o.note && <p className="mt-1 text-sm text-muted-foreground"><bdi data-i18n-skip="true">{o.note}</bdi></p>}
      {!o.accepting && <p className="mt-2 text-sm text-muted-foreground">Not taking new reservations.</p>}
      {known && <p className="mt-2 text-sm text-muted-foreground">Sat before: only the retake choices are shown.</p>}
      {groups.map((g) => (
        <GroupPicker key={g.key} g={g} o={o} lang={lang} words={words} viewer={viewer} studentId={studentId} pick={draft.picks[g.key] ?? null}
          held={held} legend={several && g.rows.length === 1 && !g.rows[0]!.exclusiveGroup ? g.rows[0]!.label[lang] : words.what}
          showRetakes={showRetakes} disabled={disabled || !o.accepting} problem={problems[g.key]}
          refusal={refusal?.key === g.key ? refusal : null} onPick={(p) => onPick(g.key, p)} />
      ))}
      {hasFirst && hasRetake && !showRetakes && (
        <p className="mt-2"><button type="button" className="text-sm text-primary underline-offset-4 hover:underline" onClick={onReveal}>Sat it before? Show the retake choices</button></p>
      )}
      {picks.length > 0 && o.questions.length > 0 && (
        <div className="mt-3 space-y-2">
          {o.questions.map((q) => (
            <QuestionField key={q.id} q={q} id={domId(studentId, `q:${q.id}`)} value={draft.answers[q.id] ?? ''} disabled={disabled}
              problem={problems[`q:${q.id}`] ?? (refusal?.key === `q:${q.id}` ? refusal.sentence : undefined)} onChange={(v) => onAnswer(q.id, v)} />
          ))}
        </div>
      )}
    </article>
  );
}

function GroupPicker({ g, o, lang, words, viewer, studentId, pick, held, legend, showRetakes, disabled, problem, refusal, onPick }: {
  g: Group; o: Offering; lang: 'en' | 'ar'; words: (typeof WORDS)[Viewer]; viewer: Viewer; studentId: string; pick: Pick | null;
  held: Map<string, HeldLine>; legend: string; showRetakes: boolean; disabled: boolean; problem: string | undefined;
  refusal: { sentence: string; code: RefusalCode | undefined } | null; onPick: (p: Pick | null) => void;
}) {
  const id = domId(studentId, g.key);
  const heldRow = g.rows.find((r) => held.has(r.id));
  if (heldRow) {
    const line = held.get(heldRow.id)!;
    const option = heldRow.options.find((x) => optionKey(x) === optionKey(line));
    return (
      <div id={id} className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
        <Badge tone={line.status === 'confirmed' ? 'success' : 'warning'}>Already reserved</Badge>{' '}
        <span className="text-foreground" data-i18n-skip="true">{option ? option.label[lang] : heldRow.label[lang]}</span>{' '}
        <span className="text-muted-foreground">· <span>{line.status === 'pending_approval' ? words.approval : HELD_STATUS[line.status] ?? ''}</span></span>
      </div>
    );
  }
  const opts = g.rows.flatMap((r) => r.options.filter((x) => x.attempt === 'first' || showRetakes).map((x) => ({ r, x })));
  if (!opts.length) return null;
  const name = `${id}-pick`;
  const picked = pick ? opts.find(({ r, x }) => r.id === pick.rowId && optionKey(x) === optionKey(pick)) ?? null : null;
  const message = problem ?? refusal?.sentence;
  return (
    <fieldset id={id} className="mt-3 min-w-0" aria-invalid={message ? true : undefined}>
      <legend className="mb-1 text-sm font-medium text-foreground"><span data-i18n-skip={legend === words.what ? undefined : 'true'}>{legend}</span></legend>
      <div className="space-y-1.5">
        <OptionLine name={name} checked={!pick} disabled={disabled} quiet onChange={() => onPick(null)}>
          <span className="text-muted-foreground">Not taking it</span>
        </OptionLine>
        {opts.map(({ r, x }) => {
          const on = !!picked && picked.r.id === r.id && optionKey(picked.x) === optionKey(x);
          const off = r.closed || !x.price;
          return (
            <div key={`${r.id}|${optionKey(x)}`}>
              <OptionLine name={name} checked={on} disabled={disabled || off}
                // D5: where the family chooses among several teachers, one is preselected; the family may change it.
                onChange={() => onPick({ rowId: r.id, attempt: x.attempt, mode: x.mode, teacherId: choosesTeacher(o, x) ? x.teachers[0]!.id : '', earlier: '', title: titleOf(o) })}
                end={x.price ? <Money amount={x.price.total} className="font-semibold" /> : <span className="text-xs text-muted-foreground">price not set yet</span>}>
                <span data-i18n-skip="true">{x.label[lang]}</span>
                {r.closed && <> <span className="text-xs text-muted-foreground">(closed to new reservations)</span></>}
                {r.payBy && <span className="block text-xs text-muted-foreground"><span>Pay by</span> <Day iso={String(r.payBy)} /></span>}
              </OptionLine>
              {on && pick && <PickDetails o={o} r={r} x={x} lang={lang} words={words} viewer={viewer} pick={pick} id={id} disabled={disabled} problem={message} onChange={onPick} />}
            </div>
          );
        })}
      </div>
      {message && (
        <div role="alert" className="mt-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <p>{message}</p>
          {refusal?.code && TAKE_OFF.includes(refusal.code) && (
            <button type="button" className="mt-1 text-sm font-medium underline underline-offset-4" onClick={() => onPick(null)}>Take it off the choices</button>
          )}
          {refusal?.code === 'PRICE_CHANGED' && <p className="mt-1">The price shown is now up to date: reserve again.</p>}
        </div>
      )}
    </fieldset>
  );
}

/** One choice of a group. `quiet`: "Not taking it", which never looks like a pick. */
function OptionLine({ name, checked, disabled, quiet = false, onChange, end, children }: {
  name: string; checked: boolean; disabled: boolean; quiet?: boolean; onChange: () => void; end?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <label className={cn('flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-sm', checked && !quiet ? 'border-primary bg-accent' : 'border-border bg-card', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-primary/50')}>
      <input type="radio" name={name} className="h-4 w-4 shrink-0" checked={checked} disabled={disabled} onChange={onChange} />
      <span className="min-w-0 flex-1">{children}</span>
      {end && <span className="shrink-0">{end}</span>}
    </label>
  );
}

function PickDetails({ o, r, x, lang, words, pick, id, disabled, problem, onChange }: {
  o: Offering; r: OfferRow; x: RowOption; lang: 'en' | 'ar'; words: (typeof WORDS)[Viewer]; viewer: Viewer; pick: Pick; id: string;
  disabled: boolean; problem: string | undefined; onChange: (p: Pick) => void;
}) {
  const earlier = earlierOf(r, x);
  const teacherWanted = choosesTeacher(o, x);
  return (
    <div className="space-y-2 px-3 pb-1 pt-2 text-sm">
      {x.mode === 'in_school' && (
        o.teacherTbc || (!x.teachers.length && o.teacherChoice === 'families') ? <p className="text-muted-foreground">Teacher to be announced</p>
          : o.teacherChoice === 'school' ? <p className="text-muted-foreground">The school assigns the teacher</p>
            : x.teachers.length === 1 ? (
              <p className="text-foreground"><span>Teacher:</span> <bdi data-i18n-skip="true">{x.teachers[0]!.name}</bdi>{x.teachers[0]!.online && <> <span className="text-muted-foreground">(online)</span></>}</p>
            ) : teacherWanted ? (
              <div>
                <label htmlFor={`${id}-teacher`} className="mb-1 block text-xs font-medium text-foreground">Teacher</label>
                <select id={`${id}-teacher`} className={cn(INPUT_CLASS, 'sm:w-72', problem === 'Choose the teacher' && !pick.teacherId && 'border-destructive')}
                  aria-invalid={problem === 'Choose the teacher' && !pick.teacherId ? true : undefined}
                  value={pick.teacherId} disabled={disabled} onChange={(e) => onChange({ ...pick, teacherId: e.target.value })}>
                  <option value="">Choose the teacher…</option>
                  {x.teachers.map((t) => <option key={t.id} value={t.id} data-i18n-skip="true">{t.name}{t.online ? ' (online)' : ''}</option>)}
                </select>
              </div>
            ) : null
      )}
      {earlier.known && (
        <p className="text-foreground"><span>Sat in</span> <span data-i18n-skip="true">{earlier.known.label[lang]}</span></p>
      )}
      {earlier.asks && (
        <div>
          <label htmlFor={`${id}-earlier`} className="mb-1 block text-xs font-medium text-foreground">{r.kind === 'a2' ? words.whenAS : words.when}</label>
          <select id={`${id}-earlier`} className={cn(INPUT_CLASS, 'sm:w-72', problem === 'Choose the earlier exam' && !pick.earlier && 'border-destructive')}
            aria-invalid={problem === 'Choose the earlier exam' && !pick.earlier ? true : undefined}
            value={pick.earlier} disabled={disabled} onChange={(e) => onChange({ ...pick, earlier: e.target.value })}>
            <option value="">Choose…</option>
            {earlier.choices.map((c) => <option key={c.value} value={c.value} data-i18n-skip="true">{c.label[lang]}</option>)}
          </select>
        </div>
      )}
      {x.price && (
        <p className="text-xs text-muted-foreground">
          <span>Exam fee</span> <Money amount={x.price.examFee} /> · <span>Course fee</span> <Money amount={x.price.courseFee} />
        </p>
      )}
    </div>
  );
}

function QuestionField({ q, id, value, problem, disabled, onChange }: {
  q: Question; id: string; value: string; problem: string | undefined; disabled: boolean; onChange: (v: string) => void;
}) {
  const invalid = problem ? true : undefined;
  return (
    <div id={`${id}-box`} className="space-y-1">
      <label htmlFor={id} className="block text-sm text-foreground">
        <bdi data-i18n-skip="true">{q.prompt}</bdi>{q.required && <span aria-hidden className="text-destructive"> *</span>}
      </label>
      {q.kind === 'yes_no' ? (
        <select id={id} className={cn(INPUT_CLASS, 'sm:w-60')} value={value} disabled={disabled} aria-invalid={invalid} aria-required={q.required || undefined} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      ) : q.kind === 'choice' ? (
        <select id={id} className={cn(INPUT_CLASS, 'sm:w-72')} value={value} disabled={disabled} aria-invalid={invalid} aria-required={q.required || undefined} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {(q.choices ?? []).map((c) => <option key={c} value={c} data-i18n-skip="true">{c}</option>)}
        </select>
      ) : (
        <input id={id} className={cn(INPUT_CLASS, 'sm:w-96')} value={value} disabled={disabled} aria-invalid={invalid} aria-required={q.required || undefined} maxLength={500} placeholder="Your answer" onChange={(e) => onChange(e.target.value)} />
      )}
      {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
    </div>
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

/** The type of the read, for the pages that show what it offers. */
export type { OffersRead };
