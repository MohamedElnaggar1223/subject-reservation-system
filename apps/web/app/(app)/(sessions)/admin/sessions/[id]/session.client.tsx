'use client';

/**
 * Session (RESERVATIONS_REWORK.md §4.2) — the links sheet.
 *
 * The spreadsheet version: the links sheet (one row per subject: its teachers, its form link,
 * its fee), three Google Forms per cycle, two printed fee PDFs, and the boards' deadlines in
 * someone's head. Here the header says when families reserve, when the course starts and when
 * money is due, and every series the session's subjects are entered in with its deadlines (a
 * series with no dates takes no reservation, and says so). The tabs: Subjects (who teaches what,
 * what can be entered, the course and board fees), Fees (the boards' fee lists per series),
 * Money (every line's price, due date and what is owed) and Grade 10 (the school registers the
 * core in one step).
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, refundPolicySentence, ROLES, type RefundPolicy } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { ReasonModal } from '~/components/ui/reason-modal';
import { InstantText, SeriesName } from '~/app/(app)/exams/exams-shared';
import {
  fetchSession, sessionKey, SESSIONS_KEY, StatusBadge, Day, Modal, Field, INPUT_CLASS, ErrorLine, errorText, toLocalInput, type SessionDetail,
} from '../sessions-shared';
import SubjectsTab from './subjects-tab.client';
import FeesTab from './fees-tab.client';
import MoneyTab from './money-tab.client';
import Grade10Tab from './grade10-tab.client';

type Tab = 'subjects' | 'fees' | 'money' | 'grade10';
const TAB_LABEL: Record<Tab, string> = { subjects: 'Subjects', fees: 'Fees', money: 'Money', grade10: 'Grade 10' };

/** Which tabs a role reads (each endpoint still checks its own role). */
function tabsFor(role: string, isJune: boolean): Tab[] {
  const tabs: Tab[] = [];
  if (role === ROLES.ADMIN || role === ROLES.COORDINATOR) tabs.push('subjects');
  if (role === ROLES.ADMIN || role === ROLES.FINANCE_ADMIN || role === ROLES.COORDINATOR) tabs.push('fees');
  if (role === ROLES.ADMIN || role === ROLES.FINANCE_ADMIN || role === ROLES.FINANCE_OFFICER) tabs.push('money');
  if (isJune && (role === ROLES.ADMIN || role === ROLES.COORDINATOR)) tabs.push('grade10');
  return tabs;
}

export default function SessionClient({ id, viewerRole }: { id: string; viewerRole: string }): React.JSX.Element {
  const { data: s, isLoading, isError, refetch } = useQuery({ queryKey: sessionKey(id), queryFn: () => fetchSession(id) });
  const [tab, setTab] = useState<Tab | null>(null);
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.replace('#', '') as Tab;
      if (h && TAB_LABEL[h]) setTab(h);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  if (isLoading) return <LoadingState />;
  if (isError || !s) return <div className="mx-auto max-w-6xl px-6 py-8"><ErrorState onRetry={() => refetch()} /></div>;
  const tabs = tabsFor(viewerRole, s.sessionType === 'june');
  const current = tab && tabs.includes(tab) ? tab : tabs[0];
  const choose = (t: Tab) => { setTab(t); window.history.replaceState(null, '', `#${t}`); };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <Link href="/admin/sessions" className="text-sm text-muted-foreground hover:text-foreground">← <span>Sessions</span></Link>
      <Header s={s} viewerRole={viewerRole} />
      <Deadlines s={s} />
      <div className="mt-6 flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Session">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={current === t} onClick={() => choose(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${current === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="mt-6" role="tabpanel">
        {current === 'subjects' && <SubjectsTab session={s} viewerRole={viewerRole} />}
        {current === 'fees' && <FeesTab session={s} viewerRole={viewerRole} />}
        {current === 'money' && <MoneyTab session={s} />}
        {current === 'grade10' && <Grade10Tab session={s} />}
        {!current && <Notice tone="neutral">Nothing on this session is yours to see.</Notice>}
      </div>
    </div>
  );
}

function Header({ s, viewerRole }: { s: SessionDetail; viewerRole: string }) {
  const isAdmin = viewerRole === ROLES.ADMIN;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
  const close = useMutation({
    mutationFn: async (reason: string) => apiResponse(api.v1.sessions[':id'].close.$post({ param: { id: s.id }, json: { reason } })),
    onSuccess: () => { setClosing(false); refresh(); },
  });
  const activate = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].activate.$post({ param: { id: s.id } })),
    onSuccess: () => { setOpening(false); refresh(); },
  });
  const policy = s.refundPolicy as RefundPolicy | null;

  return (
    <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-bold text-foreground"><bdi>{s.name}</bdi></h1>
          <StatusBadge status={s.status} />
        </div>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span><span>Reserve</span> <InstantText iso={s.startDate} /> – <InstantText iso={s.endDate} /></span>
          <span><span>Course starts</span> <Day iso={s.courseStartsOn} /></span>
          <span><span>Due</span> <InstantText iso={s.paymentDueAt} /></span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          <span>Refunds:</span> {policy ? <span>{refundPolicySentence(policy)}</span> : <span>by the refund windows (a converted session)</span>}
          {s.refundPolicyLocked && <> · <span>fixed: a family has agreed to it</span></>}
        </p>
      </div>
      {isAdmin && s.status !== 'closed' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>
          {s.status === 'draft' && <Button variant="outline" onClick={() => setOpening(true)}>Open now</Button>}
          {s.status === 'active' && <Button variant="outline" onClick={() => setClosing(true)}>Close</Button>}
          <Button variant="ghost" onClick={() => setCorrecting(true)}>Correct the series</Button>
        </div>
      )}
      {correcting && <CorrectSeries s={s} onClose={() => setCorrecting(false)} />}
      {editing && <EditHeader s={s} onClose={() => setEditing(false)} />}
      {closing && (
        <ReasonModal title="Close this session" description="Families can no longer reserve or pay here. Unpaid lines expire; their checkouts close and any money held comes back to the family."
          confirmLabel="Close session" destructive minLength={5} isPending={close.isPending} error={close.error ? errorText(close.error) : undefined}
          onConfirm={(reason) => close.mutate(reason)} onClose={() => setClosing(false)} />
      )}
      {opening && (
        <Modal title="Open this session now" onClose={() => setOpening(false)}>
          <div className="space-y-4">
            <p className="text-sm text-foreground">{"Families can reserve from now. Preregistrations are captured: a paid one is confirmed, an unpaid one waits for payment — and one whose series' deadline has passed is refunded in full instead."}</p>
            <ErrorLine message={activate.error ? errorText(activate.error) : null} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpening(false)}>Cancel</Button>
              <Button onClick={() => activate.mutate()} disabled={activate.isPending}>{activate.isPending ? 'Opening…' : 'Open now'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EditHeader({ s, onClose }: { s: SessionDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const draft = s.status === 'draft';
  const [startDate, setStartDate] = useState(toLocalInput(s.startDate));
  const [endDate, setEndDate] = useState(toLocalInput(s.endDate));
  const [courseStartsOn, setCourseStartsOn] = useState(s.courseStartsOn);
  const [paymentDueAt, setPaymentDueAt] = useState(toLocalInput(s.paymentDueAt));
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const json: { startDate?: string; endDate?: string; courseStartsOn?: string; paymentDueAt?: string; reason?: string } = {};
      if (draft && startDate !== toLocalInput(s.startDate)) json.startDate = new Date(startDate).toISOString();
      if (endDate !== toLocalInput(s.endDate)) json.endDate = new Date(endDate).toISOString();
      if (courseStartsOn !== s.courseStartsOn) json.courseStartsOn = courseStartsOn;
      if (paymentDueAt !== toLocalInput(s.paymentDueAt)) json.paymentDueAt = new Date(paymentDueAt).toISOString();
      if (reason.trim()) json.reason = reason.trim();
      return apiResponse(api.v1.sessions[':id'].$put({ param: { id: s.id }, json }));
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }); onClose(); },
  });
  return (
    <Modal title="Edit the session" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <ErrorLine message={save.error ? errorText(save.error) : null} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reserve from" htmlFor="eh-from"><input id="eh-from" className={INPUT_CLASS} type="datetime-local" value={startDate} disabled={!draft} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label="Reserve to" htmlFor="eh-to"><input id="eh-to" className={INPUT_CLASS} type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
          <Field label="Course starts" htmlFor="eh-course"><input id="eh-course" className={INPUT_CLASS} type="date" value={courseStartsOn} onChange={(e) => setCourseStartsOn(e.target.value)} /></Field>
          <Field label="Payment due" htmlFor="eh-due"><input id="eh-due" className={INPUT_CLASS} type="datetime-local" value={paymentDueAt} onChange={(e) => setPaymentDueAt(e.target.value)} /></Field>
        </div>
        <Field label="Why" htmlFor="eh-why" hint="Kept with the change. An open session's end needs one.">
          <input id="eh-why" className={INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <p className="text-xs text-muted-foreground">{"Moving the payment date moves the due date of every unpaid line with it (never past its series' deadline)."}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** "Deadlines:" — every series the session's subjects are entered in, with its dates. */
function Deadlines({ s }: { s: SessionDetail }) {
  if (!s.series.length) {
    return <p className="mt-3 text-sm text-muted-foreground">{"No series yet: a subject's series is attached when it is added."}</p>;
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span className="font-medium text-foreground">Deadlines</span>
      {s.series.map((b) => (
        <span key={b.id} className="inline-flex flex-wrap items-center gap-1.5">
          <SeriesName boardName={b.boardName} month={b.month} year={b.year} label={b.label} />
          {b.entryDeadline
            ? <Badge tone={b.entryDeadlinePassed ? 'danger' : 'success'}><InstantText iso={b.entryDeadline} time={false} />{b.entryDeadlinePassed && <>&nbsp;<span>passed</span></>}</Badge>
            : b.examsStart ? <Badge tone="neutral"><span>exams</span>&nbsp;<Day iso={b.examsStart} /></Badge> : <Badge tone="warning">Dates not set</Badge>}
          {b.retakeDeadline && <Badge tone="info"><span>retakes</span>&nbsp;<InstantText iso={b.retakeDeadline} time={false} /></Badge>}
        </span>
      ))}
    </div>
  );
}

/**
 * Correct the session's series (F0a): its type and year decide the academic year every line is
 * judged by. Its items go to the corresponding series of the new year, with their lines; lines a
 * student may no longer sit expire. Refused once a line's entry is made (past its deadline).
 */
function CorrectSeries({ s, onClose }: { s: SessionDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<'june' | 'winter'>(s.sessionType === 'june' ? 'june' : 'winter');
  const [year, setYear] = useState(String(s.seriesYear));
  const [reason, setReason] = useState('');
  const go = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].series.$put({ param: { id: s.id }, json: { sessionType: type, seriesYear: Number(year), reason: reason.trim() } })),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }); onClose(); },
  });
  return (
    <Modal title="Correct the series" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); go.mutate(); }}>
        <p className="text-sm text-muted-foreground">The series decides the academic year every line is judged by. The subjects go to the same series of the new year with their lines; a line whose student may no longer sit it expires, and its checkout closes.</p>
        <ErrorLine message={go.error ? errorText(go.error) : null} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type" htmlFor="cs-type">
            <select id="cs-type" className={INPUT_CLASS} value={type} onChange={(e) => setType(e.target.value as 'june' | 'winter')}>
              <option value="june">June</option>
              <option value="winter">Winter (November – January)</option>
            </select>
          </Field>
          <Field label={type === 'june' ? 'June of' : 'November of'} htmlFor="cs-year">
            <input id="cs-year" className={INPUT_CLASS} type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />
          </Field>
        </div>
        <Field label="Why" htmlFor="cs-why"><input id="cs-why" className={INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={reason.trim().length < 5 || go.isPending}>Correct</Button>
        </div>
      </form>
    </Modal>
  );
}
