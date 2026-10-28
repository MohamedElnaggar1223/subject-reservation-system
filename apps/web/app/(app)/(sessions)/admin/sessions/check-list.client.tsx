'use client';

/**
 * "Check before you open" (COORDINATOR_REWORK.md §5; C5, C6, D4, D6, E6, Q10, Q15): the session's check
 * list as she acts on it, on the Session screen and on her Home.
 *
 * The spreadsheet version: she scans the links sheet row by row for a missing teacher or fee, re-reads
 * each form against last cycle's, and keeps in her head which board has not published its dates. Here
 * the API's check list (GET /sessions/:id) is grouped so each line is one thing to do, with the button
 * that does it:
 * - the prices not set: one line for every subject (E6), to the Prices tab;
 * - the cells a default ticked (Q10): one line for every subject, one "Looks right" (each subject's
 *   `defaultsReviewed`), each subject listed with its rows to open it;
 * - the pre-load's notes on a subject: one line per subject, "Looks right" (`notesReviewed`);
 * - the dates (C5): "Keep them" (`datesConfirmed`) or set them in the header;
 * - a board date the reference lacks (C6): the coordinator reads "Waiting for the admin", with no
 *   button (the lead's decision on the mock); the admin enters it here, once;
 * - the subjects not on the board's list we hold: one line naming them (D1: flagged for us, who add them to the list);
 * - every other item: its sentence and the subject or tab that fixes it; an item this screen does not
 *   know yet shows the API's own sentence, so nothing the API says is dropped.
 *
 * A button that saves for several subjects tries every one, says which were not saved and why, and the
 * list is read again whatever happened.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, impactSentence, ROLES, type ImpactType } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { useI18n } from '~/lib/i18n';
import { herWords } from '~/lib/i18n-setup';
import { Day, INPUT_CLASS } from './sessions-shared';
import {
  CELL_SHORT, examMonth, refusalText, subjectTitle, isCell,
  type CheckItem, type Offering, type SetupSession,
} from './setup-shared';

type Action =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'run'; label: string; run: () => Promise<unknown>; primary?: boolean };

type Entry = {
  key: string;
  severity: 'blocks' | 'look';
  body: React.ReactNode;
  details?: { key: string; body: React.ReactNode; href?: string }[];
  actions: Action[];
  /** Waiting for someone else (the admin): no button for her. */
  waiting?: boolean;
  /** The admin enters a missing board date here (C6). */
  boardDate?: { seriesId: string };
  /** On her Home: only what she can act on, or waits on the admin. */
  forHome: boolean;
};

/** A subject a check-list button could not save: what it would do to families (saved: false), or the API's refusal. */
type NotSaved = { offeringId: string; name: string; impact?: ImpactType; refusal?: string };
class NotSavedError extends Error {
  constructor(readonly notSaved: NotSaved[]) { super('Not saved'); }
}

/** The codes this screen words itself; any other is shown with the API's own sentence. */
const KNOWN = new Set<CheckItem['code']>([
  'sitting_no_board_date', 'dates_to_check', 'price_not_set', 'last_years_prices', 'payment_date_passed', 'ticked_by_default',
  'review_note', 'switched_off', 'nothing_ticked', 'no_teacher', 'teacher_tbc', 'not_on_the_list', 'carried_from_too_old',
  'date_after_board_deadline', 'teacher_name_doubt',
]);

const DAY = 24 * 60 * 60 * 1000;
/** A deadline as the school reads it, in one piece for a sentence ("21 March 2027", Cairo). */
const longDay = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Cairo' }).format(new Date(iso));

/** The missing fees counted in brackets, each only when there is one ("(4 exam fees)"); nothing when neither is counted. */
export const missingFees = (course: number, exam: number) => {
  const parts = [
    ...(course ? [`${course} ${course === 1 ? 'course fee' : 'course fees'}`] : []),
    ...(exam ? [`${exam} ${exam === 1 ? 'exam fee' : 'exam fees'}`] : []),
  ];
  return parts.length ? ` (${parts.join(', ')})` : '';
};

const Name = ({ children }: { children: React.ReactNode }) => <bdi data-i18n-skip="true" className="font-medium">{children}</bdi>;

/** The board and exam month of a sitting the session uses, from its rows. */
function sittingOf(s: SetupSession, seriesId: string) {
  for (const o of s.offerings) {
    const r = o.rows.find((x) => x.series?.id === seriesId);
    if (r?.series) return { board: o.board.name, month: r.series.month, year: r.series.year };
  }
  return null;
}

/** What can fall after a board's entry deadline: her words, and the API's (date_after_board_deadline's message). */
const LATE = {
  closes: { her: 'reservations close', api: 'the session closes' },
  due: { her: 'payment is due', api: 'payment is due' },
  cancel: { her: 'unpaid reservations are cancelled', api: 'unpaid reservations are cancelled' },
  rowCloses: { her: 'the row closes', api: 'the row closes' },
  rowDue: { her: 'the row is due', api: 'the row is due' },
} as const;
type Late = keyof typeof LATE;

/** What is after a board's entry deadline for a row (the API's rule for date_after_board_deadline, in its order). */
function lateReasons(s: SetupSession, row: Offering['rows'][number], deadline: Date): Late[] {
  const late: Late[] = [];
  const closes = s.closesAt ? new Date(s.closesAt) : null;
  const due = new Date(s.paymentDueAt);
  const cancel = new Date(due.getTime() + s.unpaidCancelDays * DAY);
  if (closes && closes > deadline) late.push('closes');
  if (due > deadline && !row.payBy) late.push('due');
  if (cancel > deadline && !row.payBy) late.push('cancel');
  if (row.closesAt && new Date(row.closesAt) > deadline) late.push('rowCloses');
  if (row.payBy && new Date(row.payBy) > deadline) late.push('rowDue');
  return late;
}

/** A teacher-name doubt (Q15) as the API words it: "A" looks like "B" (why): one person or two? */
const DOUBT = /^"(.+)" looks like "(.+)" \((same name|spelling|initials)\): one person or two\?$/;
const DOUBT_WHY: Record<string, string> = { 'same name': '(the same name)', spelling: '(spelt differently)', initials: '(initials for a name)' };

export function useCheckEntries(s: SetupSession, viewerRole: string) {
  const queryClient = useQueryClient();
  const { language } = useI18n();
  const label = (r: { label: string; labelAr: string }) => (language === 'ar' ? r.labelAr : r.label);
  const isAdmin = viewerRole === ROLES.ADMIN;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sessions'] });
  const subjectHref = (offeringId: string) => `/admin/sessions/${s.id}/subjects/${offeringId}`;
  const byId = new Map(s.offerings.map((o) => [o.id, o]));
  // A check-list button saves nothing families would feel: a subject whose save answers that it would (a fee that
  // follows another re-derived, closing with reservations) is not saved, and she is sent to the subject to see it.
  // Every subject is tried; the ones not saved are named with the reason, and the list is read again either way.
  const putOfferings = async (ids: string[], json: { notesReviewed?: true; defaultsReviewed?: true; olderSittingsKept?: true; accepting?: boolean }) => {
    const notSaved: NotSaved[] = [];
    for (const offeringId of ids) {
      const o = byId.get(offeringId);
      const name = o ? subjectTitle(o) : '';
      try {
        const r = await apiResponse(api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: s.id, offeringId }, json }));
        if (!r.saved) notSaved.push({ offeringId, name, impact: r.impact });
      } catch (err) {
        notSaved.push({ offeringId, name, refusal: refusalText(err) });
      }
    }
    if (notSaved.length) throw new NotSavedError(notSaved);
  };

  const items = s.checkList;
  const of = (code: CheckItem['code']) => items.filter((c) => c.code === code);
  const entries: Entry[] = [];

  // C6: a sitting with no board date blocks opening; the admin enters it once.
  for (const c of of('sitting_no_board_date')) {
    const at = c.seriesId ? sittingOf(s, c.seriesId) : null;
    const what = at ? <><Name>{at.board}</Name> <span>has not published its</span> <span>{examMonth(at.month, at.year)}</span> <span>entry deadline yet.</span></> : <span>A board has not published its entry deadline yet.</span>;
    entries.push(isAdmin && c.seriesId
      ? { key: c.seriesId, severity: 'blocks', body: <>{what} <span>Enter it once when it does: it joins the reference data for every session.</span></>, actions: [], boardDate: { seriesId: c.seriesId }, forHome: true }
      : { key: c.seriesId ?? 'board-date', severity: 'blocks', waiting: true, body: <><span className="font-medium">Waiting for the admin:</span> {what} <span>Opening waits until the admin enters it.</span></>, actions: [], forHome: true });
  }

  // C5: the dates kept as they are, or set.
  for (const c of of('dates_to_check')) {
    entries.push({
      key: 'dates', severity: 'blocks', forHome: true,
      body: (
        <>
          <span>{s.copiedFrom ? 'The copy moved the dates one year:' : 'The dates are the defaults:'}</span>{' '}
          <span>pay by</span> <Day iso={s.paymentDueAt} /><span>,</span> <span>first lesson</span> <Day iso={`${s.courseStartsOn}T12:00:00.000Z`} /><span>.</span>{' '}
          <span>Set them in the header, or keep them.</span>
        </>
      ),
      actions: [
        { kind: 'run', label: 'Keep them', primary: true, run: () => apiResponse(api.v1.sessions[':id'].$put({ param: { id: s.id }, json: { datesConfirmed: true } })) },
        { kind: 'link', label: 'Set them', href: `/admin/sessions/${s.id}#dates` },
      ],
    });
    void c;
  }

  // E6: the subjects not offered for a price not set — one line.
  const unpriced = of('price_not_set').map((c) => byId.get(c.offeringId ?? '')).filter((o): o is Offering => !!o);
  if (unpriced.length) {
    const ticked = (r: Offering['rows'][number]) => r.cells.firstInSchool || r.cells.retakeInSchool || r.cells.retakeSelfStudy || r.cells.firstSelfStudy;
    const exam = unpriced.reduce((a, o) => a + o.rows.filter((r) => ticked(r) && r.examFee === null).length, 0);
    const course = unpriced.filter((o) => o.rows.some((r) => ticked(r) && (r.courseFee ?? o.courseFee) === null)).length;
    entries.push({
      key: 'prices', severity: 'look', forHome: true,
      // Only the fees that are missing are counted: "(4 exam fees)", never "(0 course fees, 4 exam fees)".
      body: <span>{`${unpriced.length} of ${s.offerings.length} subjects ${unpriced.length === 1 ? 'is' : 'are'} not offered to families: a price is not set${missingFees(course, exam)}.`}</span>,
      actions: [{ kind: 'link', label: 'Go to Prices', href: `/admin/sessions/${s.id}#prices` }],
    });
  }
  if (of('last_years_prices').length) {
    entries.push({
      key: 'last-year', severity: 'look', forHome: true,
      body: <span>The prices are last cycle&apos;s, copied: paste this year&apos;s lists, check what is left, then switch prices final.</span>,
      actions: [{ kind: 'link', label: 'Go to Prices', href: `/admin/sessions/${s.id}#prices` }],
    });
  }
  if (of('payment_date_passed').length) {
    entries.push({
      key: 'due-passed', severity: 'look', forHome: true,
      body: <span>The pay-by date has passed and prices are not final: families cannot pay yet.</span>,
      actions: [{ kind: 'link', label: 'Set it', href: `/admin/sessions/${s.id}#dates` }],
    });
  }

  // Q10, D4: the cells a default ticked — one line, one "Looks right" for every subject.
  const defaults = of('ticked_by_default');
  if (defaults.length) {
    const subjects = [...new Set(defaults.map((c) => c.offeringId).filter((x): x is string => !!x))];
    const cells = defaults.reduce((a, c) => a + (byId.get(c.offeringId ?? '')?.rows.find((r) => r.id === c.rowId)?.cellsByDefault.length ?? 1), 0);
    entries.push({
      key: 'defaults', severity: 'look', forHome: true,
      body: (
        <>
          <span>{`Ticked by a default, not by your forms: ${cells} ${cells === 1 ? 'tick' : 'ticks'} on ${subjects.length} ${subjects.length === 1 ? 'subject' : 'subjects'}.`}</span>{' '}
          <span>On your forms a retaker who picks a teacher retakes in school, so retake in school starts ticked wherever first entry in school is. Untick any the school does not offer.</span>
        </>
      ),
      details: subjects.map((id) => {
        const o = byId.get(id)!;
        const rows = defaults.filter((c) => c.offeringId === id).map((c) => o.rows.find((r) => r.id === c.rowId)).filter((r): r is Offering['rows'][number] => !!r);
        return {
          key: id, href: subjectHref(id),
          body: <><Name>{subjectTitle(o)}</Name><span>:</span> {rows.map((r, i) => (
            <span key={r.id}>{i > 0 && <span>; </span>}<span data-i18n-skip="true">{label(r)}</span> — {r.cellsByDefault.filter(isCell).map((k, j) => <span key={k}>{j > 0 && ', '}<span>{CELL_SHORT[k]}</span></span>)}</span>
          ))}</>,
        };
      }),
      actions: [{ kind: 'run', label: 'Looks right', primary: true, run: () => putOfferings(subjects, { defaultsReviewed: true }) }],
    });
  }

  // The pre-load's notes on a subject: one line each, "Looks right".
  const notes = of('review_note');
  for (const id of [...new Set(notes.map((c) => c.offeringId).filter((x): x is string => !!x))]) {
    const o = byId.get(id);
    if (!o) continue;
    entries.push({
      key: `notes-${id}`, severity: 'look', forHome: true,
      body: <><Name>{subjectTitle(o)}</Name><span>:</span> {o.checkNotes.map((n, i) => <span key={i} className="block" lang="en" dir="ltr" data-i18n-skip="true">{n}</span>)}</>,
      actions: [
        { kind: 'run', label: 'Looks right', primary: true, run: () => putOfferings([id], { notesReviewed: true }) },
        { kind: 'link', label: 'Open the subject', href: subjectHref(id) },
      ],
    });
  }

  // A subject at a time: switched off, nothing ticked, no teacher, to be confirmed, not on the list.
  const perSubject: { code: CheckItem['code']; words: string; action?: 'switch-on' }[] = [
    { code: 'switched_off', words: 'switched off — not offered to families until you switch it on.', action: 'switch-on' },
    { code: 'nothing_ticked', words: 'nothing ticked — not offered to families.' },
    { code: 'no_teacher', words: 'taught in school, but no teacher is named.' },
    { code: 'teacher_tbc', words: 'teacher to be confirmed. Families read “teacher to be announced”.' },
  ];
  for (const p of perSubject) {
    for (const c of of(p.code)) {
      const o = byId.get(c.offeringId ?? '');
      if (!o) continue;
      entries.push({
        key: `${p.code}-${o.id}`, severity: 'look', forHome: true,
        body: <><Name>{subjectTitle(o)}</Name><span>:</span> <span>{p.words}</span></>,
        actions: [
          ...(p.action === 'switch-on' ? [{ kind: 'run' as const, label: 'Switch it on', primary: true, run: () => putOfferings([o.id], { accepting: true }) }] : []),
          { kind: 'link', label: 'Open the subject', href: subjectHref(o.id) },
        ],
      });
    }
  }

  // D1: the subjects not on the board's list we hold — one line naming them; nothing for her to do (D1: flagged for us; we add them to the reference list).
  const notListed = of('not_on_the_list').map((c) => byId.get(c.offeringId ?? '')).filter((o): o is Offering => !!o);
  if (notListed.length) {
    entries.push({
      key: 'not-on-the-list', severity: 'look', forHome: true, waiting: true,
      body: (
        <>
          <span>Not on the board&apos;s list we hold:</span> {notListed.map((o, i) => <span key={o.id}>{i > 0 && ', '}<Name>{subjectTitle(o)}</Name></span>)}{!subjectTitle(notListed[notListed.length - 1]!).endsWith('.') && '.'}{' '}
          <span>{notListed.length === 1 ? 'Families see its name as you typed it; we add it to the board\'s list we hold.' : 'Families see the names as you typed them; we add them to the board\'s list we hold.'}</span>
        </>
      ),
      actions: [],
    });
  }

  // D6: an earlier exam older than the board carries a result forward — her list wins, so it stays, with a warning.
  // One line per subject: "Keep it" says she means it (olderSittingsKept, P1c item 10a) — the line leaves, the editor
  // says it is kept, and a copy of the session keeps it so; or she opens the subject and unticks it.
  const old = new Map<string, { o: Offering; items: { r: Offering['rows'][number]; p: Offering['rows'][number]['allowedPriorSittings'][number] }[] }>();
  for (const c of of('carried_from_too_old')) {
    const o = byId.get(c.offeringId ?? '');
    const r = o?.rows.find((x) => x.id === c.rowId);
    if (!o || !r) continue;
    const g = old.get(o.id) ?? { o, items: [] };
    for (const p of r.allowedPriorSittings.filter((x) => x.beyondCarryForward && !x.kept)) {
      if (!g.items.some((x) => x.r.id === r.id && x.p.id === p.id)) g.items.push({ r, p });
    }
    old.set(o.id, g);
  }
  for (const { o, items } of old.values()) {
    if (!items.length) continue;
    entries.push({
      key: `old-${o.id}`, severity: 'look', forHome: true,
      body: (
        <>
          <Name>{subjectTitle(o)}</Name> — {items.map(({ r, p }, i) => (
            <span key={`${r.id}-${p.id}`}>{i > 0 && <span>; </span>}<span data-i18n-skip="true">{label(r)}</span><span>:</span> <span>{examMonth(p.month, p.year)}</span></span>
          ))}{' '}
          <span>{items.length === 1 ? 'is older than' : 'are older than'}</span> <Name>{o.board.name}</Name>{' '}
          <span>carries a result forward. It stays, since your list wins; the board may refuse the entry.</span>{' '}
          <span>Keep it, or untick it on the subject.</span>
        </>
      ),
      actions: [
        { kind: 'run', label: 'Keep it', primary: true, run: () => putOfferings([o.id], { olderSittingsKept: true }) },
        { kind: 'link', label: 'Open the subject', href: subjectHref(o.id) },
      ],
    });
  }

  // A date after a board's deadline: one line per deadline and what is late. Where the browser's reading of the
  // dates does not give the API's reasons (a date it reads differently), the API's own sentence is shown instead.
  const late = new Map<string, { board: string; deadline: string; reasons: Late[]; rows: { id: string; offeringId: string; text: React.ReactNode }[] }>();
  for (const c of of('date_after_board_deadline')) {
    const o = byId.get(c.offeringId ?? '');
    const r = o?.rows.find((x) => x.id === c.rowId);
    const reasons = o && r?.series?.entryDeadline ? lateReasons(s, r, new Date(r.series.entryDeadline)) : [];
    if (!o || !r?.series?.entryDeadline || !reasons.length || !c.message.includes(`: ${reasons.map((k) => LATE[k].api).join(', ')} after the board's deadline`)) {
      entries.push({
        key: `late-api-${c.rowId ?? c.message}`, severity: c.severity, forHome: true, body: <span lang="en" dir="ltr">{herWords(c.message)}</span>,
        actions: [{ kind: 'link', label: 'Set the dates', href: `/admin/sessions/${s.id}#dates` }, ...(o ? [{ kind: 'link' as const, label: 'Open the subject', href: subjectHref(o.id) }] : [])],
      });
      continue;
    }
    const key = `${o.board.name}|${r.series.entryDeadline}|${reasons.join(',')}`;
    const g = late.get(key) ?? { board: o.board.name, deadline: r.series.entryDeadline, reasons, rows: [] };
    g.rows.push({ id: r.id, offeringId: o.id, text: <><Name>{subjectTitle(o)}</Name> — <span data-i18n-skip="true">{label(r)}</span></> });
    late.set(key, g);
  }
  for (const [key, g] of late) {
    entries.push({
      key: `late-${key}`, severity: 'look', forHome: true,
      body: (
        <>
          <span>{`${g.reasons.map((k) => LATE[k].her).join(', ').replace(/, ([^,]*)$/, ' and $1')} after ${g.board}'s entry deadline (${longDay(g.deadline)}): ${g.rows.length} ${g.rows.length === 1 ? 'row' : 'rows'}.`}</span>{' '}
          <span>The board&apos;s deadline cancels unpaid reservations first. Move your dates earlier?</span>
        </>
      ),
      details: g.rows.map((r) => ({ key: r.id, body: r.text, href: subjectHref(r.offeringId) })),
      actions: [{ kind: 'link', label: 'Set the dates', href: `/admin/sessions/${s.id}#dates` }],
    });
  }

  // Q15: two names on the school's list that look like one person — fixed on the subject, no button here.
  for (const [i, c] of of('teacher_name_doubt').entries()) {
    const m = DOUBT.exec(c.message);
    entries.push({
      key: `doubt-${i}`, severity: 'look', forHome: false, actions: [],
      body: m
        ? <><Name>{m[1]}</Name> <span>looks like</span> <Name>{m[2]}</Name> <span>{DOUBT_WHY[m[3]!]}</span><span>:</span> <span>one person or two?</span></>
        : <span lang="en" dir="ltr" data-i18n-skip="true">{c.message}</span>,
    });
  }

  // An item this screen does not word yet: the API's own sentence, never dropped.
  for (const [i, c] of items.filter((x) => !KNOWN.has(x.code)).entries()) {
    entries.push({
      key: `other-${i}`, severity: c.severity, forHome: true, body: <span lang="en" dir="ltr">{herWords(c.message)}</span>,
      actions: c.offeringId ? [{ kind: 'link', label: 'Open the subject', href: subjectHref(c.offeringId) }] : [],
    });
  }

  entries.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'blocks' ? -1 : 1));
  return { entries, refresh };
}

/**
 * The check list under its heading ("Check before you open (n)", or "Needs a look" once open), each line
 * with its action. `place` "home" keeps only what she can act on or waits on the admin.
 */
export function CheckList({ s, viewerRole, place, headingLevel = 'h2' }: { s: SetupSession; viewerRole: string; place: 'home' | 'session'; headingLevel?: 'h2' | 'h3' }) {
  const { entries, refresh } = useCheckEntries(s, viewerRole);
  const shown = place === 'home' ? entries.filter((e) => e.forHome) : entries;
  const [hidden, setHidden] = useState(false);
  const H = headingLevel;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <H className={cn('font-display font-semibold text-foreground', H === 'h2' ? 'text-lg' : 'text-base')}>
          <span>{s.status === 'draft' ? 'Check before you open' : 'Needs a look'}</span> <span className="text-muted-foreground">(<span>{shown.length}</span>)</span>
        </H>
        {place === 'session' && shown.length > 0 && (
          <Button variant="ghost" size="sm" aria-expanded={!hidden} onClick={() => setHidden(!hidden)}>{hidden ? 'Show' : 'Hide'}</Button>
        )}
      </div>
      {hidden ? null : shown.length
        ? <ul className="mt-2 divide-y divide-border">{shown.map((e) => <CheckLine key={e.key} e={e} refresh={refresh} sessionId={s.id} />)}</ul>
        : <p className="mt-2 text-sm text-muted-foreground">{s.status === 'draft' ? 'Nothing left: the session can open.' : 'Nothing needs a look.'}</p>}
    </>
  );
}

function CheckLine({ e, refresh, sessionId }: { e: Entry; refresh: () => Promise<unknown>; sessionId: string }) {
  const [open, setOpen] = useState(false);
  // The line stays busy until the list is read again, so a second click never lands on the line below it; the list
  // is read again whether or not every subject was saved.
  const run = useMutation({
    mutationFn: async (a: Extract<Action, { kind: 'run' }>) => { try { await a.run(); } finally { await refresh(); } },
  });
  return (
    <li className="flex flex-wrap items-start gap-3 py-3">
      <span aria-hidden="true" className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', e.severity === 'blocks' ? 'bg-destructive' : e.waiting ? 'bg-muted-foreground/50' : 'bg-amber-500')} />
      <div className="min-w-0 flex-1 text-sm text-foreground">
        {e.severity === 'blocks' && <Badge tone="danger" className="me-2">Blocks opening</Badge>}
        {e.body}
        {e.details && e.details.length > 0 && (
          <div className="mt-1">
            <button type="button" className="text-xs font-medium text-primary hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Hide the list' : 'Show the list'}
            </button>
            {open && (
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {e.details.map((d) => (
                  <li key={d.key} className="flex flex-wrap items-center gap-2">
                    <span>{d.body}</span>
                    {d.href && <Link href={d.href as never} className="font-medium text-primary hover:underline">Open the subject</Link>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {run.error && <NotSavedLines err={run.error} sessionId={sessionId} />}
        {e.boardDate && <BoardDateForm seriesId={e.boardDate.seriesId} refresh={refresh} />}
      </div>
      {/* On a phone the buttons take their own line under the words (beside them the words were a narrow column). */}
      {e.actions.length > 0 && (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 ps-5 sm:w-auto sm:ps-0">
          {e.actions.map((a) => a.kind === 'link'
            ? <Button key={a.label} asChild size="sm" variant="ghost"><PageLink href={a.href}>{a.label}</PageLink></Button>
            : <Button key={a.label} size="sm" variant={a.primary ? 'outline' : 'ghost'} disabled={run.isPending} onClick={() => run.mutate(a)}>{a.label}</Button>)}
        </div>
      )}
    </li>
  );
}

/** What a check-list button did not save, subject by subject: what it would do to families, or why it was refused. */
function NotSavedLines({ err, sessionId }: { err: unknown; sessionId: string }) {
  if (!(err instanceof NotSavedError)) return <p role="alert" className="mt-1 text-xs text-destructive">{refusalText(err)}</p>;
  return (
    <div role="alert" className="mt-1 text-xs text-destructive">
      <p className="font-medium">{err.notSaved.length === 1 ? 'Not saved:' : 'These were not saved:'}</p>
      <ul className="mt-0.5 space-y-0.5">
        {err.notSaved.map((x) => (
          <li key={x.offeringId}>
            <Name>{x.name}</Name><span>:</span>{' '}
            {x.impact ? <><span>{impactSentence(x.impact)}</span> <span>Open the subject to see it and save it there.</span></> : <span>{x.refusal}</span>}{' '}
            <Link href={`/admin/sessions/${sessionId}/subjects/${x.offeringId}` as never} className="font-medium text-primary hover:underline">Open the subject</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * C6's one exception, the admin's: a board's entry deadline the reference data lacks, entered once (and
 * the retake deadline when the board has one). The waiting reservations' due dates follow; when that
 * step fails the date is still saved, and sending it again runs the step again.
 */
function BoardDateForm({ seriesId, refresh }: { seriesId: string; refresh: () => Promise<unknown> }) {
  const [entry, setEntry] = useState('');
  const [retake, setRetake] = useState('');
  const save = useMutation({
    mutationFn: async () => apiResponse(api.v1.reference.sittings[':id']['board-date'].$put({
      param: { id: seriesId },
      json: { entryDeadline: entry, ...(retake ? { retakeDeadline: retake } : {}) },
    })),
    onSuccess: (r) => { if (r.linesRedated !== null) void refresh(); },
  });
  const notMoved = save.data && save.data.linesRedated === null;
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="text-xs font-medium text-foreground">
        <span className="mb-1 block">Entry deadline</span>
        <input type="date" className={cn(INPUT_CLASS, 'h-9 w-44')} value={entry} onChange={(ev) => setEntry(ev.target.value)} />
      </label>
      <label className="text-xs font-medium text-foreground">
        <span className="mb-1 block">Retake deadline (if the board has one)</span>
        <input type="date" className={cn(INPUT_CLASS, 'h-9 w-44')} value={retake} onChange={(ev) => setRetake(ev.target.value)} />
      </label>
      <Button size="sm" disabled={!entry || save.isPending} onClick={() => save.mutate()}>{notMoved ? 'Try again' : 'Save the date'}</Button>
      {notMoved && <p role="status" className="basis-full text-xs text-amber-700 dark:text-amber-400">The date is saved, but the waiting reservations&apos; due dates did not move. Try again.</p>}
      {save.error && <p role="alert" className="basis-full text-xs text-destructive">{refusalText(save.error)}</p>}
    </div>
  );
}

/** What the Accepting switch waits for (the check list's blocking lines), in a few words. */
export function openWaitsFor(s: SetupSession): string[] {
  const out: string[] = [];
  for (const c of s.checkList.filter((x) => x.severity === 'blocks')) {
    if (c.code === 'dates_to_check') out.push('the dates');
    else if (c.code === 'sitting_no_board_date') {
      const at = c.seriesId ? sittingOf(s, c.seriesId) : null;
      out.push(at ? `${at.board}'s entry deadline (the admin)` : 'a board date (the admin)');
    } else out.push(herWords(c.message));
  }
  return [...new Set(out)];
}

/**
 * A link to a tab or the dates of the session screen: from that screen itself it sets the address's hash so the screen
 * hears it (a Next.js navigation to the same page changes the address without a hashchange, so the tab did not move —
 * the guide's drive found it); from another page (her Home) a normal link.
 */
function PageLink({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const pathname = usePathname();
  const [path, hash] = href.split('#');
  if (hash && path === pathname) {
    return (
      <a {...rest} href={`#${hash}`} onClick={(e) => {
        e.preventDefault();
        if (window.location.hash === `#${hash}`) window.dispatchEvent(new HashChangeEvent('hashchange'));
        else window.location.hash = hash;
      }}>{children}</a>
    );
  }
  return <Link {...rest} href={href as never}>{children}</Link>;
}
