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
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, refundPolicySentence, seriesAcademicYearStart, ROLES, type RefundPolicy } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { ReasonModal } from '~/components/ui/reason-modal';
import { InstantText, SeriesName, fetchBoardSeries, SERIES_KEY } from '~/app/(app)/exams/exams-shared';
import { DatesForm } from '~/app/(app)/exams/series/series.client';
import {
  fetchSession, sessionKey, SESSIONS_KEY, StatusBadge, Day, Modal, Field, INPUT_CLASS, ErrorLine, errorText, toLocalInput, type SessionDetail,
} from '../sessions-shared';
import SubjectsTab from './subjects-tab.client';
import FeesTab from './fees-tab.client';
import MoneyTab from './money-tab.client';
import Grade10Tab from './grade10-tab.client';
import ToVerifyTab from './to-verify-tab.client';

type Tab = 'subjects' | 'fees' | 'money' | 'grade10' | 'verify';
const TAB_LABEL: Record<Tab, string> = { subjects: 'Subjects', fees: 'Fees', money: 'Money', grade10: 'Grade 10', verify: 'To verify' };

/** Which tabs a role reads (each endpoint still checks its own role). */
function tabsFor(role: string, isJune: boolean): Tab[] {
  const tabs: Tab[] = [];
  if (role === ROLES.ADMIN || role === ROLES.COORDINATOR) tabs.push('subjects');
  if (role === ROLES.ADMIN || role === ROLES.FINANCE_ADMIN || role === ROLES.COORDINATOR) tabs.push('fees');
  if (role === ROLES.ADMIN || role === ROLES.FINANCE_ADMIN || role === ROLES.FINANCE_OFFICER) tabs.push('money');
  if (isJune && (role === ROLES.ADMIN || role === ROLES.COORDINATOR)) tabs.push('grade10');
  // Step B (§3.5): the declared sittings — the coordinator's; the admin's and the finance desk's too.
  if (role === ROLES.ADMIN || role === ROLES.COORDINATOR || role === ROLES.FINANCE_ADMIN || role === ROLES.FINANCE_OFFICER) tabs.push('verify');
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
      <Deadlines s={s} viewerRole={viewerRole} />
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
        {current === 'verify' && <ToVerifyTab session={s} viewerRole={viewerRole} />}
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
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const refresh = () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
  // F8-01: a draft nobody reserved in goes (a stale sample draft, one made by mistake); the API refuses otherwise.
  const remove = useMutation({
    mutationFn: async (reason: string) => apiResponse(api.v1.sessions[':id'].$delete({ param: { id: s.id }, json: { reason } })),
    onSuccess: async () => { setDeleting(false); await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }); router.push('/admin/sessions'); },
  });
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
          <Button variant="ghost" onClick={() => setCorrecting(true)}>Correct the sitting</Button>
          {s.status === 'draft' && <Button variant="ghost" className="text-destructive" onClick={() => setDeleting(true)}>Delete this draft</Button>}
        </div>
      )}
      {deleting && (
        <ReasonModal title="Delete this draft session" description="Only a draft nobody has reserved in can be deleted. Its subjects, items and fees on this sheet go with it; the subjects stay in the catalogue and the boards' series keep their dates and fee lists. Recorded in the audit trail with your reason."
          confirmLabel="Delete the draft" destructive minLength={5} isPending={remove.isPending} error={remove.error ? errorText(remove.error) : undefined}
          onConfirm={(reason) => remove.mutate(reason)} onClose={() => setDeleting(false)} />
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

/**
 * "Deadlines:" — every series the session's subjects are entered in, each a line in the school's
 * words ("Cambridge International June 2027: entries by 20 Feb 2027 · retakes by …", or "Dates not
 * set"). For the admin and the coordinator each line is a button opening the Board Series page's
 * dates form in place (F6a): the board's deadlines are set from the session, no page change.
 */
function Deadlines({ s, viewerRole }: { s: SessionDetail; viewerRole: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const canSet = viewerRole === ROLES.ADMIN || viewerRole === ROLES.COORDINATOR;
  if (!s.series.length) {
    return <p className="mt-3 text-sm text-muted-foreground">{"No sittings yet: a subject's sitting is added with the subject."}</p>;
  }
  const chosen = s.series.find((b) => b.id === open) ?? null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="font-medium text-foreground">Deadlines</span>
      {s.series.map((b) => {
        const line = (
          <span>
            <SeriesName boardName={b.boardName} month={b.month} year={b.year} label={b.label} /><span>:</span>{' '}
            {b.entryDeadline
              ? <span className={b.entryDeadlinePassed ? 'text-destructive' : 'text-foreground'}><span>entries by</span> <InstantText iso={b.entryDeadline} time={false} />{b.entryDeadlinePassed && <> (<span>passed</span>)</>}</span>
              : b.examsStart ? <span><span>exams</span> <Day iso={b.examsStart} /></span> : <span className="font-medium text-amber-700 dark:text-amber-400">Dates not set</span>}
            {b.retakeDeadline && <> · <span><span>retakes by</span> <InstantText iso={b.retakeDeadline} time={false} /></span></>}
          </span>
        );
        return canSet ? (
          <button key={b.id} type="button" onClick={() => setOpen(b.id)}
            className="rounded-lg border border-border bg-card px-2.5 py-1 text-start hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            {line}
          </button>
        ) : <span key={b.id} className="rounded-lg border border-border px-2.5 py-1">{line}</span>;
      })}
      {chosen && <SeriesDates s={s} seriesId={chosen.id} isAdmin={viewerRole === ROLES.ADMIN} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** The Board Series page's dates form, in a dialog over the session (its own endpoint, its required reason). */
function SeriesDates({ s, seriesId, isAdmin, onClose }: { s: SessionDetail; seriesId: string; isAdmin: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const ay = seriesAcademicYearStart(s.sessionType, s.seriesYear);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: [...SERIES_KEY, ay], queryFn: () => fetchBoardSeries(ay) });
  const row = (data ?? []).find((b) => b.id === seriesId) ?? null;
  const done = () => {
    queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    onClose();
  };
  return (
    <Modal title="The board's dates" onClose={onClose} wide>
      {isLoading ? <LoadingState /> : isError ? <ErrorState onRetry={() => refetch()} /> : !row ? <Notice tone="neutral">This sitting was not found.</Notice> : (
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground"><SeriesName boardName={row.boardName} month={row.month} year={row.year} label={row.label} /></p>
          <DatesForm s={row} isAdmin={isAdmin} onDone={done} />
        </div>
      )}
    </Modal>
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
    <Modal title="Correct the sitting" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); go.mutate(); }}>
        <p className="text-sm text-muted-foreground">The sitting decides the academic year every reservation is judged by. The subjects go to the same sitting of the new year with their reservations; a reservation whose student may no longer sit it expires, and its checkout closes.</p>
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
