'use client';

/**
 * Session (COORDINATOR_REWORK.md §5.3, §9.3; Appendix A): one cycle, set up the way she works.
 *
 * The spreadsheet version: a links sheet (one row per subject, its teachers and its form's link), a
 * Google Form per subject copied from last cycle and edited by hand, the boards' fee lists as PDFs, the
 * refund policy typed into every form, and the dates in her head. Here the header holds the switch
 * families see (Accepting reservations), prices final and the three dates; "Check before you open"
 * lists what blocks or deserves a look, each line with the button that deals with it; the tabs are the
 * subjects (a tile each), the prices (paste a board's list as printed), what families agree to, and
 * who reserved — read only, with the export. The Money tab stays for finance (and the admin).
 *
 * The admin sees the same screen; finance reads it (B3): no switch, no date to change, the prices read
 * only. Removed with the rework (§9.3): the Grade 10 and To verify tabs, "Correct the sitting" and the
 * Deadlines line; the old Subjects sheet and the fee grid are replaced by the subject editor and Prices.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, ROLES } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { Switch } from '~/components/ui/switch';
import { ReasonModal } from '~/components/ui/reason-modal';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { cn } from '~/lib/utils';
import { Day, Modal, ErrorLine, INPUT_CLASS, fetchSession, sessionKey, STATUS_TONE } from '../sessions-shared';
import {
  STATUS_WORDS, pickerValue, endOfSchoolDay, useImpactSave, ImpactDialog, refusalText,
  type SetupSession,
} from '../setup-shared';
import { CheckList, openWaitsFor } from '../check-list.client';
import SubjectsTab from './subjects-tab.client';
import PricesTab from './prices-tab.client';
import AgreeTab from './agree-tab.client';
import ReservationsTab from './reservations-tab.client';
import MoneyTab from './money-tab.client';

type Tab = 'subjects' | 'prices' | 'agree' | 'reservations' | 'money';
const TAB_WORDS: Record<Tab, string> = { subjects: 'Subjects', prices: 'Prices', agree: 'What families agree to', reservations: 'Reservations', money: 'Money' };

/** Which tabs a role reads (B1–B3; each endpoint still checks its own role). */
function tabsFor(role: string): Tab[] {
  if (role === ROLES.COORDINATOR) return ['subjects', 'prices', 'agree', 'reservations'];
  if (role === ROLES.ADMIN) return ['subjects', 'prices', 'agree', 'reservations', 'money'];
  if (role === ROLES.FINANCE_ADMIN || role === ROLES.FINANCE_OFFICER) return ['money', 'prices', 'reservations'];
  return [];
}

export default function SessionClient({ id, viewerRole }: { id: string; viewerRole: string }): React.JSX.Element {
  const { data: s, isLoading, isError, refetch } = useQuery({ queryKey: sessionKey(id), queryFn: () => fetchSession(id) });
  const [tab, setTab] = useState<Tab | null>(null);
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.replace('#', '');
      if (h in TAB_WORDS) setTab(h as Tab);
      // The check list's "Set them": the dates in the header, focused.
      if (h === 'dates') window.setTimeout(() => document.getElementById('sess-due')?.focus(), 50);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  if (isLoading) return <LoadingState />;
  if (isError || !s) return <div className="mx-auto max-w-6xl px-6 py-8"><ErrorState onRetry={() => refetch()} /></div>;
  const tabs = tabsFor(viewerRole);
  const current = tab && tabs.includes(tab) ? tab : tabs[0];
  const choose = (t: Tab) => { setTab(t); window.history.replaceState(null, '', `#${t}`); };
  const canSetUp = viewerRole === ROLES.ADMIN || viewerRole === ROLES.COORDINATOR;
  const count: Partial<Record<Tab, number>> = { subjects: s.offerings.length, reservations: s.counts.lines };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Link href="/admin/sessions" className="text-sm text-muted-foreground hover:text-foreground">← <span>Sessions</span></Link>
      <Header s={s} canSetUp={canSetUp} isAdmin={viewerRole === ROLES.ADMIN} />
      {canSetUp && (
        <section id="checks" className="mt-4 rounded-xl border border-border bg-card p-5 shadow-sm">
          <CheckList s={s} viewerRole={viewerRole} place="session" />
        </section>
      )}
      <div className="mt-6 flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Session">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={current === t} aria-controls="session-tabpanel" onClick={() => choose(t)}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium', current === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            <span>{TAB_WORDS[t]}</span>{count[t] !== undefined && <> <span className="text-muted-foreground">(<span>{count[t]}</span>)</span></>}
          </button>
        ))}
      </div>
      <div className="mt-6" role="tabpanel" id="session-tabpanel" aria-labelledby={current ? `tab-${current}` : undefined}>
        {current === 'subjects' && <SubjectsTab s={s} />}
        {current === 'prices' && <PricesTab s={s} canEdit={canSetUp} />}
        {current === 'agree' && <AgreeTab s={s} />}
        {current === 'reservations' && <ReservationsTab s={s} />}
        {current === 'money' && <MoneyTab session={s} />}
        {!current && <Notice tone="neutral">Nothing on this session is yours to see.</Notice>}
      </div>
    </div>
  );
}

/**
 * The session's header: its name and status, the Accepting switch, prices final, the three dates (C4, C5, E6),
 * and for the admin, while it is a draft, "Delete this draft" (F8-01: a duplicate or mistaken draft goes; the API
 * refuses a draft anyone reserved in).
 */
function Header({ s, canSetUp, isAdmin }: { s: SetupSession; canSetUp: boolean; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sessions'] });
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Deleted, the screen goes back to Sessions at once and only the lists are read again: the deleted session's own
  // queries would each answer 404 (the review of 744e553, item 2).
  const remove = useMutation({
    mutationFn: async (reason: string) => apiResponse(api.v1.sessions[':id'].$delete({ param: { id: s.id }, json: { reason } })),
    onSuccess: () => {
      router.replace('/admin/sessions');
      void queryClient.invalidateQueries({ queryKey: ['sessions'], predicate: (q) => q.queryKey[1] !== s.id });
    },
  });
  const waits = s.status === 'draft' ? openWaitsFor(s) : [];
  const accepting = useMutation({
    mutationFn: async (on: boolean) => {
      if (on && s.status === 'draft') return apiResponse(api.v1.sessions[':id'].open.$post({ param: { id: s.id } }));
      if (on) return apiResponse(api.v1.sessions[':id'].reopen.$post({ param: { id: s.id }, json: {} }));
      return apiResponse(api.v1.sessions[':id'].close.$post({ param: { id: s.id }, json: {} }));
    },
    onSuccess: async () => { setClosing(false); await refresh(); },
  });
  const pricesFinal = useImpactSave(
    (final: boolean, expected) => apiResponse(api.v1.sessions[':id']['prices-final'].$put({ param: { id: s.id }, json: { final, ...(expected ? { expected } : {}) } })),
    () => refresh(),
  );
  // One-way once any line exists, as the API decides it (any status, cancelled ones too): the live count, or a row's.
  const oneWay = s.pricesFinal && (s.counts.lines > 0 || s.offerings.some((o) => o.rows.some((r) => r.lines.all > 0)));

  return (
    <section className="mt-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold text-foreground"><bdi>{s.name}</bdi></h1>
            <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>{STATUS_WORDS[s.status] ?? s.status}</Badge>
            {s.copiedFrom && <Badge tone="neutral"><span>copied from</span>&nbsp;<bdi>{s.copiedFrom.name}</bdi></Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <span>{s.offerings.length}</span> <span>{s.offerings.length === 1 ? 'subject' : 'subjects'}</span> · <span>{s.counts.offeredToFamilies}</span> <span>offered to families</span> · <span>self study pays</span> <span>{s.selfStudyPercent}%</span> <span>of the course fee</span>
          </p>
        </div>
        <div className="w-full space-y-3 sm:w-auto sm:min-w-80">
          <div className="flex items-center justify-between gap-4">
            <span id="sw-accepting" className="text-sm font-medium text-foreground">Accepting reservations</span>
            <Switch checked={s.status === 'active'} label="Accepting reservations" describedBy={waits.length ? 'open-waits' : undefined}
              disabled={!canSetUp || accepting.isPending || (s.status === 'draft' && waits.length > 0)}
              onChange={(on) => (on ? accepting.mutate(true) : setClosing(true))} />
          </div>
          {waits.length > 0 && (
            <p id="open-waits" className="text-xs text-amber-700 dark:text-amber-400">
              <span>Opening waits for:</span> {waits.map((w, i) => <span key={w}>{i > 0 && '; '}<span>{w}</span></span>)}
            </p>
          )}
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-foreground"><span>Prices final</span> <span className="text-xs font-normal text-muted-foreground">— families can pay</span></span>
            <Switch checked={s.pricesFinal} label="Prices final" disabled={!canSetUp || pricesFinal.isPending || oneWay}
              describedBy={oneWay ? 'prices-one-way' : undefined} onChange={(on) => pricesFinal.save(on)} />
          </div>
          {oneWay && <p id="prices-one-way" className="text-xs text-muted-foreground">Families have reserved: prices stay final.</p>}
          <ErrorLine message={accepting.error ? refusalText(accepting.error) : pricesFinal.error} />
          {isAdmin && s.status === 'draft' && (
            <div className="flex justify-end">
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(true)}>Delete this draft</Button>
            </div>
          )}
        </div>
      </div>
      <Dates s={s} canSetUp={canSetUp} />
      <ImpactDialog save={pricesFinal} />
      {deleting && (
        <ReasonModal title={`Delete ${s.name}`}
          description="Only a draft nobody has reserved in can be deleted. Its subjects, rows, teachers and prices in this session go with it; the boards' lists and the school's teachers stay. Kept in the audit trail with your reason."
          confirmLabel="Delete the draft" destructive minLength={5} isPending={remove.isPending || remove.isSuccess}
          error={remove.error ? refusalText(remove.error) : undefined}
          onConfirm={(reason) => remove.mutate(reason)} onClose={() => setDeleting(false)} />
      )}
      {closing && (
        <Modal title={`Close ${s.name}`} onClose={() => setClosing(false)}>
          <div className="space-y-3 text-sm text-foreground">
            <p>Families can no longer reserve here. You can open it again later.</p>
            {/* Until P1b: today's close still cancels unpaid reservations (C10 replaces it with the cut-off). Drop this line when it lands. */}
            <p className="font-medium text-amber-700 dark:text-amber-400">{CLOSE_CANCELS_UNPAID}</p>
            {s.counts.unpaid > 0 && <p><span>Unpaid reservations now:</span> <span className="tabular-nums">{s.counts.unpaid}</span></p>}
            <ErrorLine message={accepting.error ? refusalText(accepting.error) : null} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setClosing(false)}>Cancel</Button>
              <Button variant="destructive" disabled={accepting.isPending} onClick={() => accepting.mutate(false)}>{accepting.isPending ? 'Closing…' : 'Close it'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

/**
 * Until P1b removes the expiry at the close (the owner's decision of 26 Oct; C10): what closing does today
 * to waiting reservations, said before she confirms. One constant, so it leaves in one line.
 */
export const CLOSE_CANCELS_UNPAID = 'Today closing also cancels every unpaid reservation and ends its checkout; money held comes back to the family\'s balance.';

/** C5: the three dates, each a date picker, saved when she leaves the field (a payment date that moves due dates asks first). */
function Dates({ s, canSetUp }: { s: SetupSession; canSetUp: boolean }) {
  const queryClient = useQueryClient();
  const save = useImpactSave(
    (json: { closesAt?: string | null; paymentDueAt?: string; courseStartsOn?: string }, expected) =>
      apiResponse(api.v1.sessions[':id'].$put({ param: { id: s.id }, json: { ...json, ...(expected ? { expected } : {}) } })),
    () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    () => { sentClose.current = null; setClose(pickerValue(s.closesAt)); setDue(pickerValue(s.paymentDueAt)); setFirst(s.courseStartsOn); },
  );
  const [close, setClose] = useState(pickerValue(s.closesAt));
  const [due, setDue] = useState(pickerValue(s.paymentDueAt));
  const [first, setFirst] = useState(s.courseStartsOn);
  // The close date last sent and not read back yet: leaving the field does not send it a second time (the API would
  // answer "Nothing to change" under a save that worked). Forgotten once read back, cancelled or refused.
  const sentClose = useRef<string | null>(null);
  const saveClose = (v: string) => { sentClose.current = v; save.save({ closesAt: v ? endOfSchoolDay(v) : null }); };
  useEffect(() => { if (save.error) sentClose.current = null; }, [save.error]);
  useEffect(() => {
    sentClose.current = null;
    setClose(pickerValue(s.closesAt)); setDue(pickerValue(s.paymentDueAt)); setFirst(s.courseStartsOn);
  }, [s.closesAt, s.paymentDueAt, s.courseStartsOn]);
  // Clear pressed while another date was being saved or asked about: sent once that is settled (saved, cancelled or
  // refused), so the two never race and a question she has open is never dismissed by the clear.
  const clearNext = useRef(false);
  useEffect(() => {
    if (save.isPending || save.asking || save.busy() || !clearNext.current) return;
    clearNext.current = false;
    saveClose('');
  }, [save.isPending, save.asking]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = (d: string) => /^\d{4}-\d\d-\d\d$/.test(d) && Number(d.slice(0, 4)) >= 2000;
  const field = 'mt-1 h-10';
  return (
    <div id="dates" className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
      <div>
        <label htmlFor="sess-close" className="block text-sm font-medium text-foreground"><span>Reservations close</span> <span className="font-normal text-muted-foreground">(optional)</span></label>
        <div className="flex items-center gap-2">
          <input id="sess-close" type="date" className={cn(INPUT_CLASS, field)} value={close} disabled={!canSetUp || s.status === 'closed'}
            onChange={(e) => setClose(e.target.value)}
            onBlur={() => { if (close !== pickerValue(s.closesAt) && close !== sentClose.current && (close === '' || valid(close))) saveClose(close); }} />
          {/* Clear takes the place of a close date typed and not saved yet: pressed from the close field it keeps the
              focus there, so leaving the field never sends the typed date first. From another date field, that field
              is left (and saved) as usual; a save running or asking is let settle, then the close date is cleared. */}
          {canSetUp && s.closesAt && (
            <Button type="button" size="sm" variant="ghost" onMouseDown={(e) => { if (document.activeElement?.id === 'sess-close') e.preventDefault(); }}
              onClick={() => { setClose(''); if (save.busy()) clearNext.current = true; else saveClose(''); }}>Clear</Button>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Switches Accepting off at the end of that day.</p>
        {/* Until P1b: closing on this date does what the switch does (CLOSE_CANCELS_UNPAID). Drop this line with it. */}
        {s.status !== 'closed' && <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">{CLOSE_CANCELS_UNPAID}</p>}
      </div>
      <div>
        <label htmlFor="sess-due" className="block text-sm font-medium text-foreground">Payment due</label>
        <input id="sess-due" type="date" className={cn(INPUT_CLASS, field)} value={due} disabled={!canSetUp || s.status === 'closed'}
          onChange={(e) => setDue(e.target.value)}
          onBlur={() => { if (due !== pickerValue(s.paymentDueAt) && valid(due)) save.save({ paymentDueAt: endOfSchoolDay(due) }); }} />
        <p className="mt-1 text-xs text-muted-foreground"><span>Unpaid reservations are cancelled</span> <span>{s.unpaidCancelDays}</span> <span>{s.unpaidCancelDays === 1 ? 'day after it.' : 'days after it.'}</span></p>
      </div>
      <div>
        <label htmlFor="sess-first" className="block text-sm font-medium text-foreground">First lesson</label>
        <input id="sess-first" type="date" className={cn(INPUT_CLASS, field)} value={first} disabled={!canSetUp || s.status === 'closed'}
          onChange={(e) => setFirst(e.target.value)}
          onBlur={() => { if (first !== s.courseStartsOn && valid(first)) save.save({ courseStartsOn: first }); }} />
        <p className="mt-1 text-xs text-muted-foreground">The refund weeks count from it.</p>
      </div>
      {save.error && <div className="sm:col-span-3"><ErrorLine message={save.error} /></div>}
      {s.status === 'closed' && <p className="text-xs text-muted-foreground sm:col-span-3"><span>Closed on</span> <Day iso={s.closedAt} />. <span>Switch Accepting on to open it again.</span></p>}
      <ImpactDialog save={save} />
    </div>
  );
}
