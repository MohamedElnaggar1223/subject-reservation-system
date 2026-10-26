'use client';

/**
 * Subjects (COORDINATOR_REWORK.md §5.3, D1, D10; Appendix A `POST /sessions/:id/offerings`): the
 * session's subjects in two groups — O.L., then A.S./A.L. — each a tile with its board, teachers, what
 * it offers, its fees and its switch; "Add a subject" picks one from the board's list, copies one from
 * another session, or adds one not on the list. A subject opens in the subject editor.
 *
 * The spreadsheet version: a row on the links sheet and a Google Form copied from a similar subject and
 * edited by hand. Here a subject from the board's list arrives with its rows and the usual ticks (the
 * check list names the ticks a default made); she changes what differs.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, SUBJECT_GROUPS, type ParsePriceListType } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/tone';
import { Switch } from '~/components/ui/switch';
import { cn } from '~/lib/utils';
import { useI18n } from '~/lib/i18n';
import { Money, Modal, Field, INPUT_CLASS, ErrorLine, fetchSessions, SESSIONS_KEY } from '../sessions-shared';
import {
  fetchReferenceSubjects, fetchReferenceBoards, fetchSetupSession, REFERENCE_SUBJECTS_KEY, REFERENCE_BOARDS_KEY, setupKey,
  CELLS, CELL_SHORT, subjectTitle, useImpactSave, ImpactDialog, refusalText,
  type SetupSession, type Offering,
} from '../setup-shared';

/** A subject's code as she reads it ("3180"); none for one not on the list (its X- placeholder). */
export const shownCode = (code: string | null | undefined) => (code && !code.startsWith('X-') ? code : null);

export default function SubjectsTab({ s }: { s: SetupSession }) {
  const [dialog, setDialog] = useState<'copy' | 'custom' | null>(null);
  const closed = s.status === 'closed';
  return (
    <div className="space-y-6">
      {!closed && <AddSubject s={s} onDialog={setDialog} />}
      {SUBJECT_GROUPS.map((g) => {
        const xs = s.offerings.filter((o) => o.group === g);
        return (
          <section key={g} aria-labelledby={`group-${g}`}>
            <h2 id={`group-${g}`} className="font-display text-base font-semibold text-foreground"><span>{g}</span> <span className="text-muted-foreground">(<span>{xs.length}</span>)</span></h2>
            {xs.length
              ? <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{xs.map((o) => <Tile key={o.id} s={s} o={o} />)}</div>
              : <p className="mt-2 text-sm text-muted-foreground">None yet.</p>}
          </section>
        );
      })}
      {dialog === 'copy' && <CopySubject s={s} onClose={() => setDialog(null)} />}
      {dialog === 'custom' && <NotOnTheList s={s} onClose={() => setDialog(null)} />}
    </div>
  );
}

function useOpenNew(s: SetupSession) {
  const router = useRouter();
  const queryClient = useQueryClient();
  return async (offeringId: string) => {
    await queryClient.invalidateQueries({ queryKey: setupKey(s.id) });
    router.push(`/admin/sessions/${s.id}/subjects/${offeringId}`);
  };
}

/** "Add a subject": the board's list (D1), grouped by board and group, less what the session has. */
function AddSubject({ s, onDialog }: { s: SetupSession; onDialog: (d: 'copy' | 'custom') => void }) {
  const ref = useQuery({ queryKey: REFERENCE_SUBJECTS_KEY, queryFn: fetchReferenceSubjects });
  const boards = useQuery({ queryKey: REFERENCE_BOARDS_KEY, queryFn: fetchReferenceBoards });
  const [pick, setPick] = useState('');
  const openNew = useOpenNew(s);
  const add = useMutation({
    mutationFn: async (key: string) => {
      const [board, code] = key.split('|') as [string, string];
      return apiResponse(api.v1.sessions[':id'].offerings.$post({ param: { id: s.id }, json: { referenceCode: code, board: board as ParsePriceListType['board'] } }));
    },
    onSuccess: (o) => openNew(o.id),
  });
  const groups = useMemo(() => {
    const have = new Set(s.offerings.map((o) => `${o.board.code}|${o.referenceCode}`));
    const name = new Map((boards.data ?? []).map((b) => [b.code, b.name]));
    const out: { label: string; items: { key: string; text: string }[] }[] = [];
    for (const r of ref.data ?? []) {
      const key = `${r.board}|${r.code}`;
      if (have.has(key)) continue;
      const label = `${name.get(r.board) ?? r.board} · ${r.group}`;
      let g = out.find((x) => x.label === label);
      if (!g) { g = { label, items: [] }; out.push(g); }
      const code = shownCode(r.code);
      g.items.push({ key, text: code ? `${r.name} · ${code}` : r.name });
    }
    return out;
  }, [ref.data, boards.data, s.offerings]);
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="add-subject" className="text-sm font-semibold text-foreground">Add a subject</label>
        <select id="add-subject" className={cn(INPUT_CLASS, 'w-auto max-w-sm flex-1')} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Pick from the board&apos;s list…</option>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((i) => <option key={i.key} value={i.key} data-i18n-skip="true">{i.text}</option>)}
            </optgroup>
          ))}
        </select>
        <Button disabled={!pick || add.isPending} onClick={() => add.mutate(pick)}>{add.isPending ? 'Adding…' : 'Add'}</Button>
        <span className="text-sm text-muted-foreground">or</span>
        <Button variant="outline" size="sm" onClick={() => onDialog('copy')}>Copy a subject from another session</Button>
        <Button variant="ghost" size="sm" onClick={() => onDialog('custom')}>Not on the list</Button>
      </div>
      <ErrorLine message={add.error ? refusalText(add.error) : null} />
    </div>
  );
}

/** A subject's tile: board, teachers, what it offers, its fees, its switch. */
function Tile({ s, o }: { s: SetupSession; o: Offering }) {
  const queryClient = useQueryClient();
  const { language } = useI18n();
  const toggle = useImpactSave(
    (accepting: boolean, expected) => apiResponse(api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: s.id, offeringId: o.id }, json: { accepting, ...(expected ? { expected } : {}) } })),
    () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  );
  const ticked = o.rows.filter((r) => CELLS.some((c) => r.cells[c]));
  const fees = ticked.map((r) => r.examFee).filter((f): f is number => f !== null);
  const notSet = ticked.length - fees.length;
  const code = shownCode(o.subject.code);
  const href = `/admin/sessions/${s.id}/subjects/${o.id}`;
  return (
    <article className={cn('rounded-xl border border-border bg-card p-4 shadow-sm', !o.accepting && 'bg-muted/40')}>
      <div className="flex items-start justify-between gap-3">
        <Link href={href as never} className="font-display text-base font-semibold text-foreground hover:underline"><bdi data-i18n-skip="true">{subjectTitle(o)}</bdi></Link>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span>{o.accepting ? (s.status === 'active' ? 'Accepting' : 'Opens with the session') : 'Switched off'}</span>
          <Switch checked={o.accepting} label={`${subjectTitle(o)}: accepting reservations`} disabled={toggle.isPending || s.status === 'closed'} onChange={(on) => toggle.save(on)} />
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        <bdi data-i18n-skip="true">{o.board.name}</bdi>{code && <> · <span dir="ltr" data-i18n-skip="true">{code}</span></>}{o.notOnTheList && <> · <span>not on the board&apos;s list we hold</span></>}
      </p>
      <p className="mt-2 text-sm text-foreground">
        {o.teacherTbc
          ? <Badge tone="warning">teacher to be confirmed</Badge>
          : o.teachers.length
            ? o.teachers.map((t, i) => <span key={t.teacherId}>{i > 0 && ', '}<bdi data-i18n-skip="true">{t.name}</bdi>{t.online && <> <span className="text-xs text-muted-foreground">(online)</span></>}{t.external && <> <span className="text-xs text-muted-foreground">(external team)</span></>}</span>)
            : <span className="text-muted-foreground">no teacher</span>}
      </p>
      <ul className="mt-2 space-y-1 text-xs">
        {ticked.length ? ticked.map((r) => (
          <li key={r.id}>
            <span className="font-medium text-foreground" data-i18n-skip="true">{language === 'ar' ? r.labelAr : r.label}</span>{' '}
            <span className="text-muted-foreground">{CELLS.filter((c) => r.cells[c]).map((c, i) => <span key={c}>{i > 0 && ' · '}<span>{CELL_SHORT[c]}</span></span>)}</span>
            {r.teachers.length > 0 && <span className="text-muted-foreground"> — <bdi data-i18n-skip="true">{r.teachers.map((t) => t.name).join(' / ')}</bdi></span>}
          </li>
        )) : <li className="text-muted-foreground">No row ticked.</li>}
      </ul>
      <p className="mt-2 text-xs text-foreground">
        {fees.length
          ? <><span>{fees.length > 1 ? 'exam fees' : 'exam fee'}</span> {Math.min(...fees) === Math.max(...fees) ? <Money amount={fees[0]} /> : <><Money amount={Math.min(...fees)} />–<Money amount={Math.max(...fees)} /></>}{notSet > 0 && <> <span className="text-amber-700 dark:text-amber-400">(<span>{notSet}</span> <span>not set</span>)</span></>}</>
          : <span className="text-amber-700 dark:text-amber-400">exam fee not set</span>}
        {' · '}
        {o.courseFee === null ? <span className="text-amber-700 dark:text-amber-400">course fee not set</span> : <><span>course fee</span> <Money amount={o.courseFee} /></>}
      </p>
      {o.accepting && o.priceNotSet.length > 0 && <p className="mt-2"><Badge tone="warning">Not offered to families: a price is not set</Badge></p>}
      {o.lines > 0 && <p className="mt-1 text-xs text-muted-foreground"><span>{o.lines}</span> <span>{o.lines === 1 ? 'reservation' : 'reservations'}</span></p>}
      <ErrorLine message={toggle.error} />
      <ImpactDialog save={toggle} />
    </article>
  );
}

/** A subject copied from another session (C3's copy, one subject): its rows, cells, teachers, note, questions and fees, a year on. */
function CopySubject({ s, onClose }: { s: SetupSession; onClose: () => void }) {
  const sessions = useQuery({ queryKey: [...SESSIONS_KEY, 'admin'], queryFn: fetchSessions });
  const others = (sessions.data ?? []).filter((x) => x.id !== s.id).sort((a, b) => b.seriesYear - a.seriesYear);
  const [from, setFrom] = useState('');
  const source = from || others[0]?.id || '';
  const src = useQuery({ queryKey: setupKey(source), queryFn: () => fetchSetupSession(source), enabled: !!source });
  const have = new Set(s.offerings.map((o) => o.subject.id));
  const candidates = (src.data?.offerings ?? []).filter((o) => !have.has(o.subject.id));
  const [pick, setPick] = useState('');
  const openNew = useOpenNew(s);
  const copy = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].offerings.$post({ param: { id: s.id }, json: { copyFromOfferingId: pick } })),
    onSuccess: (o) => openNew(o.id),
  });
  return (
    <Modal title="Copy a subject from another session" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Its rows, ticks, teachers, note, questions and fees come across; its earlier exams and dates move to this session&apos;s year.</p>
        <Field label="From" htmlFor="cp-session">
          <select id="cp-session" className={INPUT_CLASS} value={source} onChange={(e) => { setFrom(e.target.value); setPick(''); }}>
            {others.length === 0 && <option value="">No other session yet</option>}
            {others.map((x) => <option key={x.id} value={x.id} data-i18n-skip="true">{x.name}</option>)}
          </select>
        </Field>
        <Field label="Subject" htmlFor="cp-subject">
          <select id="cp-subject" className={INPUT_CLASS} value={pick} onChange={(e) => setPick(e.target.value)} disabled={!candidates.length}>
            <option value="">{candidates.length ? 'Pick a subject…' : 'Every subject there is already here'}</option>
            {candidates.map((o) => <option key={o.id} value={o.id} data-i18n-skip="true">{subjectTitle(o)}</option>)}
          </select>
        </Field>
        <ErrorLine message={copy.error ? refusalText(copy.error) : null} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!pick || copy.isPending} onClick={() => copy.mutate()}>{copy.isPending ? 'Copying…' : 'Copy it'}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** D1's "not on the list": board, name, level; the code optional. Flagged for us to add to the reference. */
function NotOnTheList({ s, onClose }: { s: SetupSession; onClose: () => void }) {
  const boards = useQuery({ queryKey: REFERENCE_BOARDS_KEY, queryFn: fetchReferenceBoards });
  const [board, setBoard] = useState<ParsePriceListType['board']>('cambridge');
  const [name, setName] = useState('');
  const [group, setGroup] = useState<'O.L.' | 'A.S./A.L.'>('O.L.');
  const [code, setCode] = useState('');
  const openNew = useOpenNew(s);
  const add = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].offerings.$post({
      param: { id: s.id },
      json: { custom: { board, name: name.trim(), level: group === 'O.L.' ? 'igcse' : 'as_al', group, ...(code.trim() ? { code: code.trim() } : {}) } },
    })),
    onSuccess: (o) => openNew(o.id),
  });
  return (
    <Modal title="A subject not on the list" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) add.mutate(); }}>
        <p className="text-sm text-muted-foreground">Families see its name as you type it, and the admin is told to add it to the board&apos;s list we hold.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Board" htmlFor="nl-board">
            <select id="nl-board" className={INPUT_CLASS} value={board} onChange={(e) => setBoard(e.target.value as ParsePriceListType['board'])}>
              {(boards.data ?? []).map((b) => <option key={b.code} value={b.code} data-i18n-skip="true">{b.name}</option>)}
            </select>
          </Field>
          <Field label="Group" htmlFor="nl-group">
            <select id="nl-group" className={INPUT_CLASS} value={group} onChange={(e) => setGroup(e.target.value as 'O.L.' | 'A.S./A.L.')}>
              {SUBJECT_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Name families read" htmlFor="nl-name"><input id="nl-name" className={INPUT_CLASS} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Code (optional)" htmlFor="nl-code"><input id="nl-code" className={INPUT_CLASS} value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" /></Field>
        <ErrorLine message={add.error ? refusalText(add.error) : null} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={name.trim().length < 2 || add.isPending}>{add.isPending ? 'Adding…' : 'Add it'}</Button>
        </div>
      </form>
    </Modal>
  );
}
