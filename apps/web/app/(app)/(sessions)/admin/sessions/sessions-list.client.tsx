'use client';

/**
 * Sessions (RESERVATIONS_REWORK.md §4.1).
 *
 * The spreadsheet version: one Google Form per level per cycle (three a June), each built or
 * copy-edited by hand with its subjects, teachers and fees, and a links sheet that lists them;
 * the series each form feeds and its deadline are remembered, not written down.
 *
 * Here: one session per cycle — June, or November–January — with every level in it. A row says
 * when families reserve, when the course starts and when money is due, which boards' series it
 * enters and their deadlines, and what is paid and owed. "New session" takes six inputs; the
 * name, the refund policy and the series follow, and "Copy from" brings last cycle's subjects,
 * teachers, items and course fees (board fees come across provisional).
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, academicYearStartOf, deriveSessionName, refundPolicySentence, DEFAULT_REFUND_POLICIES, ROLES, type SessionType } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { EmptyState } from '~/components/ui/query-state';
import { DeadlineBadge, SeriesName } from '~/app/(app)/exams/exams-shared';
import {
  fetchSessions, SESSIONS_KEY, StatusBadge, Money, Day, Modal, Field, INPUT_CLASS, ErrorLine, errorText, type SessionRow,
} from './sessions-shared';

/** The series year a new session most likely is: June of the academic year's end, or this November. */
function suggestedYear(type: SessionType): number {
  const ay = academicYearStartOf();
  return type === 'june' ? ay + 1 : ay;
}

export default function SessionsListClient({ viewerRole }: { viewerRole: string }): React.JSX.Element {
  const isAdmin = viewerRole === ROLES.ADMIN;
  const { data: sessions } = useSuspenseQuery({ queryKey: [...SESSIONS_KEY, 'admin'], queryFn: fetchSessions });
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<'all' | 'june' | 'winter'>('all');
  const shown = sessions.filter((s) => filter === 'all' || s.sessionType === filter);
  const open = sessions.filter((s) => s.status === 'active').length;
  const drafts = sessions.filter((s) => s.status === 'draft').length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span>{open}</span> <span>open</span> · <span>{drafts}</span> <span>draft</span> · <span>{sessions.length}</span> <span>in all</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-card p-0.5 text-sm" role="group" aria-label="Show">
            {(['all', 'june', 'winter'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
                className={`rounded-md px-3 py-1.5 ${filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {f === 'all' ? 'All' : f === 'june' ? 'June' : 'Winter'}
              </button>
            ))}
          </div>
          {isAdmin && <Button onClick={() => setCreating(true)}>New session</Button>}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState title="No sessions yet" message={isAdmin ? 'A session is one cycle — June, or November to January — with every level in it.' : undefined} />
      ) : (
        <ul className="space-y-3">
          {shown.map((s) => <SessionCard key={s.id} s={s} viewerRole={viewerRole} />)}
        </ul>
      )}

      {creating && <NewSessionModal sessions={sessions} onClose={() => setCreating(false)} />}
    </div>
  );
}

function SessionCard({ s, viewerRole }: { s: SessionRow; viewerRole: string }) {
  const money = viewerRole === ROLES.ADMIN || viewerRole === ROLES.FINANCE_ADMIN || viewerRole === ROLES.FINANCE_OFFICER;
  return (
    <li className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/sessions/${s.id}`} className="font-display text-lg font-semibold text-foreground hover:underline">
              <bdi>{s.name}</bdi>
            </Link>
            <StatusBadge status={s.status} />
          </div>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span><span>Reserve</span> <Day iso={s.startDate} /> – <Day iso={s.endDate} /></span>
            <span><span>Course starts</span> <Day iso={s.courseStartsOn} /></span>
            <span><span>Due</span> <Day iso={s.paymentDueAt} /></span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/admin/sessions/${s.id}`}><Button variant="outline" size="sm">Open</Button></Link>
          {money && <Link href={`/admin/sessions/${s.id}#money`}><Button variant="outline" size="sm">Money</Button></Link>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="text-foreground"><span>{s.summary.offers}</span> <span>{s.summary.offers === 1 ? 'subject' : 'subjects'}</span> · <span>{s.summary.boards}</span> <span>{s.summary.boards === 1 ? 'board' : 'boards'}</span></span>
        {s.boardSeries.length > 0 && <span className="text-muted-foreground">·</span>}
        {s.boardSeries.map((b) => (
          <span key={b.id} className="inline-flex items-center gap-1.5">
            <SeriesName boardName={b.boardName} month={b.month} year={b.year} label={b.label} />
            {b.entryDeadline || b.retakeDeadline
              ? <DeadlineBadge iso={b.entryDeadline} />
              : b.examsStart ? <Badge tone="neutral"><span>exams</span>&nbsp;<Day iso={b.examsStart} /></Badge> : <Badge tone="warning">Dates not set</Badge>}
          </span>
        ))}
      </div>
      {s.summary.lines > 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          <span>{s.summary.lines}</span> <span>lines</span> · <span>{s.summary.paid}</span> <span>paid</span> · <span>{s.summary.unpaid}</span> <span>unpaid</span>
          {money && s.summary.outstanding > 0 && <> (<Money amount={s.summary.outstanding} /> <span>outstanding</span>)</>}
          {s.summary.overdue > 0 && <> · <Badge tone="danger"><span>{s.summary.overdue}</span>&nbsp;<span>overdue</span></Badge></>}
        </p>
      )}
    </li>
  );
}

function NewSessionModal({ sessions, onClose }: { sessions: SessionRow[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<SessionType>('june');
  const [year, setYear] = useState(String(suggestedYear('june')));
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [courseStartsOn, setCourseStartsOn] = useState('');
  const [paymentDueAt, setPaymentDueAt] = useState('');
  const sameKind = useMemo(() => sessions.filter((s) => s.sessionType === type).sort((a, b) => b.seriesYear - a.seriesYear), [sessions, type]);
  const [copyFrom, setCopyFrom] = useState<string>('');
  const copyDefault = sameKind[0]?.id ?? '';
  const copySource = copyFrom === 'none' ? '' : copyFrom || copyDefault;
  const y = Number(year);
  const create = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions.$post({
      json: {
        type, year: y, startDate: new Date(startDate).toISOString(), endDate: new Date(endDate).toISOString(), courseStartsOn,
        paymentDueAt: new Date(paymentDueAt).toISOString(), ...(copySource ? { copyFromSessionId: copySource } : {}),
      },
    })),
    onSuccess: async (made) => {
      await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      window.location.assign(`/admin/sessions/${made.id}`);
    },
  });
  const ready = Number.isInteger(y) && y >= 2000 && y <= 2100 && startDate && endDate && courseStartsOn && paymentDueAt;

  return (
    <Modal title="New session" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ready) create.mutate(); }}>
        <ErrorLine message={create.error ? errorText(create.error) : null} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" htmlFor="ns-type">
            <select id="ns-type" className={INPUT_CLASS} value={type} onChange={(e) => { const t = e.target.value as SessionType; setType(t); setYear(String(suggestedYear(t))); setCopyFrom(''); }}>
              <option value="june">June</option>
              <option value="winter">Winter (November – January)</option>
            </select>
          </Field>
          <Field label={type === 'june' ? 'June of' : 'November of'} htmlFor="ns-year">
            <input id="ns-year" className={INPUT_CLASS} type="number" inputMode="numeric" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />
          </Field>
        </div>
        <Notice tone="neutral">
          <span>It will be called</span> <strong><bdi>{Number.isInteger(y) ? deriveSessionName(type, y) : '—'}</bdi></strong>.{' '}
          <span>Refunds:</span> <span>{refundPolicySentence(DEFAULT_REFUND_POLICIES[type])}</span>
        </Notice>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reserve from" htmlFor="ns-from"><input id="ns-from" className={INPUT_CLASS} type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></Field>
          <Field label="Reserve to" htmlFor="ns-to"><input id="ns-to" className={INPUT_CLASS} type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} required /></Field>
          <Field label="Course starts" htmlFor="ns-course"><input id="ns-course" className={INPUT_CLASS} type="date" value={courseStartsOn} onChange={(e) => setCourseStartsOn(e.target.value)} required /></Field>
          <Field label="Payment due" htmlFor="ns-due"><input id="ns-due" className={INPUT_CLASS} type="datetime-local" value={paymentDueAt} onChange={(e) => setPaymentDueAt(e.target.value)} required /></Field>
        </div>
        <Field label="Copy from" htmlFor="ns-copy" hint="Subjects, teachers, what can be entered and course fees come across; board fees come across provisional until the board publishes.">
          <select id="ns-copy" className={INPUT_CLASS} value={copyFrom || copyDefault || 'none'} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="none">Start empty</option>
            {sameKind.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <p className="text-xs text-muted-foreground">
          A session whose reserving starts now or earlier opens at once; otherwise it opens on its start date. Families may preregister for a session that has not opened.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!ready || create.isPending}>{create.isPending ? 'Creating…' : 'Create session'}</Button>
        </div>
      </form>
    </Modal>
  );
}

