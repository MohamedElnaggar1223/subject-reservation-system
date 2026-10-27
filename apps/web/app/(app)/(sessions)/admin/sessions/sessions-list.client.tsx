'use client';

/**
 * Sessions (COORDINATOR_REWORK.md §5.1–§5.2, C1–C3; Appendix A `GET/POST /sessions`).
 *
 * The spreadsheet version: a links sheet per cycle and a Drive folder of Google Forms, each copied
 * from last cycle's and edited by hand — every year moved, every subject re-checked. Here a session
 * is one cycle (June, or November / January), a card says where it stands, and "New session" asks
 * three things, each picked from a list: the type, the year, and where it starts from — a copy of the
 * last session of the type (its subjects, rows, teachers, notes, questions, policy and share, every
 * year moved forward, prices as last year's) or empty. The name is made from the type and year, never
 * typed. A new session is a draft: families do not see it until it accepts reservations.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, deriveSessionName, ROLES, SessionTypeSchema, type SessionType } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/tone';
import { EmptyState } from '~/components/ui/query-state';
import { cn } from '~/lib/utils';
import { fetchSessions, SESSIONS_KEY, STATUS_TONE, Money, Day, Modal, Field, INPUT_CLASS, ErrorLine, type SessionRow } from './sessions-shared';
import { STATUS_WORDS, refusalText } from './setup-shared';

const TYPE_WORDS: Record<SessionType, string> = { june: 'June', winter: 'November / January' };

export default function SessionsListClient({ viewerRole }: { viewerRole: string }): React.JSX.Element {
  const canCreate = viewerRole === ROLES.ADMIN || viewerRole === ROLES.COORDINATOR;
  const { data: sessions } = useSuspenseQuery({ queryKey: [...SESSIONS_KEY, 'admin'], queryFn: fetchSessions });
  const [creating, setCreating] = useState(false);
  // The cycle's order: the one taking reservations, then the drafts, then the closed ones — newest first in each.
  const rank = (s: SessionRow) => (s.status === 'active' ? 0 : s.status === 'draft' ? 1 : 2);
  const shown = [...sessions].sort((a, b) => rank(a) - rank(b) || b.seriesYear - a.seriesYear || a.sessionType.localeCompare(b.sessionType));
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">A session is one cycle — June, or November / January. Families see it once it accepts reservations.</p>
        </div>
        {canCreate && <Button onClick={() => setCreating(true)}>New session</Button>}
      </div>
      {shown.length === 0
        ? <EmptyState title="No sessions yet" message="A session is one cycle — June, or November / January — with every subject in it." />
        : <ul className="space-y-3">{shown.map((s) => <SessionCard key={s.id} s={s} viewerRole={viewerRole} sessions={sessions} />)}</ul>}
      {creating && <NewSession sessions={sessions} onClose={() => setCreating(false)} />}
    </div>
  );
}

function SessionCard({ s, viewerRole, sessions }: { s: SessionRow; viewerRole: string; sessions: SessionRow[] }) {
  const money = viewerRole === ROLES.ADMIN || viewerRole === ROLES.FINANCE_ADMIN || viewerRole === ROLES.FINANCE_OFFICER;
  const copiedFrom = s.copiedFromSessionId ? sessions.find((x) => x.id === s.copiedFromSessionId) : null;
  const href = `/admin/sessions/${s.id}`;
  return (
    <li className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={href as never} className="font-display text-lg font-semibold text-foreground hover:underline"><bdi>{s.name}</bdi></Link>
            <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>{STATUS_WORDS[s.status] ?? s.status}</Badge>
            {copiedFrom && <Badge tone="neutral"><span>copied from</span>&nbsp;<bdi>{copiedFrom.name}</bdi></Badge>}
          </div>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span><span>Reservations close</span> {s.endDate ? <Day iso={s.endDate} /> : <span>when you switch them off</span>}</span>
            <span><span>Pay by</span> <Day iso={s.paymentDueAt} /></span>
            <span><span>First lesson</span> <Day iso={`${s.courseStartsOn}T12:00:00.000Z`} /></span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm"><Link href={href as never}>Open the session</Link></Button>
          {money && s.summary.lines > 0 && <Button asChild variant="outline" size="sm"><Link href={`${href}#money` as never}>Money</Link></Button>}
        </div>
      </div>
      <p className="mt-3 text-sm text-foreground">
        <span>{s.summary.offers}</span> <span>{s.summary.offers === 1 ? 'subject' : 'subjects'}</span>
        {' · '}<span>{s.summary.lines}</span> <span>{s.summary.lines === 1 ? 'reservation' : 'reservations'}</span>
        {s.summary.lines > 0 && <>, <span>{s.summary.paid}</span> <span>paid</span>, <span>{s.summary.unpaid}</span> <span>waiting for payment</span></>}
        {money && s.summary.outstanding > 0 && <> (<Money amount={s.summary.outstanding} /> <span>outstanding</span>)</>}
        {' · '}<span>{s.pricesFinal ? 'prices final' : 'prices not final'}</span>
      </p>
    </li>
  );
}

/** C1–C3: the type and year picked, where it starts from picked, the name shown (never typed). */
function NewSession({ sessions, onClose }: { sessions: SessionRow[]; onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const thisYear = new Date().getFullYear();
  const years = [thisYear, thisYear + 1, thisYear + 2];
  const lastOf = (t: SessionType) => sessions.filter((x) => x.sessionType === t && !x.label).sort((a, b) => b.seriesYear - a.seriesYear)[0] ?? null;
  // The year after the last session of the type (the one she makes next), within the three offered.
  const suggest = (t: SessionType) => {
    const last = lastOf(t);
    const next = last ? last.seriesYear + 1 : t === 'june' ? thisYear + 1 : thisYear;
    return Math.min(Math.max(next, years[0]!), years[2]!);
  };
  const [type, setType] = useState<SessionType>('june');
  const [year, setYear] = useState(() => suggest('june'));
  const last = useMemo(() => lastOf(type), [type, sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  const [from, setFrom] = useState<'copy' | 'empty'>('copy');
  const start = last ? from : 'empty';
  const name = deriveSessionName(type, year);
  const exists = sessions.some((x) => x.sessionType === type && x.seriesYear === year && !x.label);
  const create = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions.$post({ json: { type, year, ...(start === 'copy' && last ? { copyFromSessionId: last.id } : {}) } })),
    onSuccess: async (made) => {
      await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      router.push(`/admin/sessions/${made.id}`);
    },
  });
  return (
    <Modal title="New session" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!exists) create.mutate(); }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" htmlFor="ns-type">
            <select id="ns-type" className={INPUT_CLASS} value={type} onChange={(e) => { const t = SessionTypeSchema.parse(e.target.value); setType(t); setYear(suggest(t)); }}>
              {SessionTypeSchema.options.map((t) => <option key={t} value={t}>{TYPE_WORDS[t]}</option>)}
            </select>
          </Field>
          <Field label="Year" htmlFor="ns-year">
            <select id="ns-year" className={INPUT_CLASS} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Start from" htmlFor="ns-from"
          hint={start === 'copy'
            ? "Every subject, row, teacher, note, question, policy and share comes across. Earlier exams and dates move on a year; prices come across as last year's, not final."
            : 'No subjects: add them from the boards’ lists.'}>
          <select id="ns-from" className={INPUT_CLASS} value={start} onChange={(e) => setFrom(e.target.value === 'copy' ? 'copy' : 'empty')}>
            <option value="copy" disabled={!last}>{last ? `Copy the last ${TYPE_WORDS[type]} session (${last.name})` : 'Copy the last session of this type (there is none yet)'}</option>
            <option value="empty">Empty</option>
          </select>
        </Field>
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">The session&apos;s name — made from the type and the year</p>
          <p className="font-display text-lg font-semibold text-foreground"><bdi>{name}</bdi></p>
        </div>
        {exists && <p role="alert" className={cn('rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive')}><bdi>{name}</bdi> <span>already exists.</span></p>}
        <ErrorLine message={create.error ? refusalText(create.error) : null} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={exists || create.isPending}>{create.isPending ? 'Creating…' : <span><span>Create</span> <bdi>{name}</bdi></span>}</Button>
        </div>
      </form>
    </Modal>
  );
}
