'use client';

/**
 * Campus leave for a family (FEATURES_PLAN.md F2) — a parent's and a
 * student's screen, built for a phone.
 *
 * The paper version: a handwritten note in the school bag or a phone call to
 * the office, the gate calling the office to check, and the parent waiting
 * outside while someone finds the note. Here: the child's leave for today
 * and the days ahead, each with where it stands; the pass (a QR code the
 * gate scans) as soon as the school approves; the request itself in one
 * screen (today or tomorrow in one tap, the school's reasons as buttons, who
 * may collect this child as cards, the school's rules said before sending);
 * and the people the family trusts to collect, with the school's approval of
 * each. A student sees their own leave and pass.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, COLLECTOR_RELATIONS, maskIdNumber } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { ReasonModal } from '~/components/ui/reason-modal';
import { cn } from '~/lib/utils';
import { DateText } from '../academic/calendar/academic-shared';
import {
  LEAVE_KEY, fetchFamily, fetchPass, uploadFor, StatusBadge, TimesText, CollectorText, Photo, QrCode, RequestLeaveForm,
  COLLECTOR_STATUS, type FamilyView, type LeaveRow,
} from './leave-shared';

export default function FamilyLeaveClient({ role }: { role: 'parent' | 'student' }): React.JSX.Element {
  const family = useQuery({ queryKey: [...LEAVE_KEY, 'family'], queryFn: fetchFamily, refetchInterval: 60_000 });
  const [tab, setTab] = useState<'leave' | 'request' | 'collectors'>('leave');
  const [passFor, setPassFor] = useState<string | null>(null);
  const parent = role === 'parent';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 animate-fade-up">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Campus leave</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {parent
            ? 'Ask the school to let your child leave during the day, show the pass at the gate, and choose who may collect them.'
            : 'Your leave from school: when it is approved, and the pass the gate scans.'}
        </p>
      </header>
      {parent && (
        <div role="tablist" aria-label="Campus leave" className="mb-5 grid grid-cols-3 rounded-lg border border-border bg-card p-1">
          {([['leave', 'Leave'], ['request', 'Request'], ['collectors', 'Collectors']] as const).map(([k, label]) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cn('h-10 rounded-md text-sm font-medium', tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}>
              {label}
            </button>
          ))}
        </div>
      )}
      {family.isLoading ? <LoadingState label="Loading campus leave…" /> : family.isError || !family.data ? (
        <ErrorState title="Campus leave did not load" onRetry={() => family.refetch()} />
      ) : family.data.children.length === 0 ? (
        <EmptyState title="No child linked yet" message="Link your child on the Linked Children page, or ask the school's desk to link you." />
      ) : tab === 'request' && parent ? (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 font-display text-lg font-bold text-foreground">Request leave</h2>
          <RequestLeaveForm
            mode="family"
            today={family.data.today}
            policy={family.data.policy}
            students={family.data.children.filter((c) => !c.leftOn).map((c) => ({ id: c.id, name: c.name, mayLeaveAlone: c.mayLeaveAlone, parents: c.parents, collectors: c.collectors }))}
            onDone={() => undefined}
          />
        </section>
      ) : tab === 'collectors' && parent ? (
        <Collectors data={family.data} />
      ) : (
        <LeaveList data={family.data} parent={parent} onPass={setPassFor} onRequest={() => setTab('request')} />
      )}
      {passFor && <PassSheet leaveId={passFor} parent={parent} onClose={() => setPassFor(null)} />}
    </div>
  );
}

// ─── The leave list ──────────────────────────────────────────────────────────

function LeaveList({ data, parent, onPass, onRequest }: { data: FamilyView; parent: boolean; onPass: (id: string) => void; onRequest: () => void }) {
  const qc = useQueryClient();
  const [cancelling, setCancelling] = useState<LeaveRow | null>(null);
  const cancel = useMutation({
    mutationFn: async ({ id, reason, series }: { id: string; reason: string; series: boolean }) =>
      apiResponse(api.v1.leave.requests[':id'].cancel.$post({ param: { id }, json: { reason: reason || null, series } })),
    onSuccess: () => { setCancelling(null); qc.invalidateQueries({ queryKey: LEAVE_KEY }); },
  });
  const standing = data.leaves.filter((l) => l.date >= data.today && l.status !== 'rejected' && l.status !== 'cancelled').sort((a, b) => a.date.localeCompare(b.date) || a.leaveTime.localeCompare(b.leaveTime));
  // A weekly request shows once, at its next date, with the rest of its dates under it.
  const seriesDates = new Map<string, LeaveRow[]>();
  for (const l of standing) if (l.seriesId) seriesDates.set(l.seriesId, [...(seriesDates.get(l.seriesId) ?? []), l]);
  const upcoming = standing.filter((l) => !l.seriesId || seriesDates.get(l.seriesId)![0] === l);
  const past = data.leaves.filter((l) => !standing.includes(l));
  return (
    <div className="space-y-6">
      {upcoming.length === 0 ? (
        <EmptyState title="No leave coming up" message={parent ? 'A request sent now appears here, with its pass once the school approves it.' : 'When your parent asks for leave, it appears here.'}
          action={parent ? <Button onClick={onRequest}>Request leave</Button> : undefined} />
      ) : (
        <ul className="space-y-3">
          {upcoming.map((l) => (
            <li key={l.id} className={cn('rounded-2xl border bg-card p-4 shadow-sm', l.date === data.today && l.status === 'approved' ? 'border-primary' : 'border-border')}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {l.date === data.today ? <span>Today</span> : <DateText date={l.date} weekday long />}
                    {' · '}<TimesText leaveTime={l.leaveTime} returning={l.returning} returnTime={l.returnTime} />
                  </p>
                  {data.children.length > 1 && <p className="text-sm text-muted-foreground"><bdi>{l.student.name}</bdi></p>}
                  <p className="mt-1 text-sm text-muted-foreground"><span>{l.reason.label}</span> · <CollectorText c={l.collector} /></p>
                </div>
                <StatusBadge status={l.status} noShow={!!l.noShowAt && !l.checkout} late={!!l.lateReturnAt} />
              </div>
              {l.seriesId && (seriesDates.get(l.seriesId)?.length ?? 0) > 1 && (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-foreground">{`Every week: ${seriesDates.get(l.seriesId)!.length} dates`}</summary>
                  <ul className="mt-1 space-y-1 text-muted-foreground">
                    {seriesDates.get(l.seriesId)!.map((x) => <li key={x.id} className="flex items-center gap-2"><DateText date={x.date} weekday /><StatusBadge status={x.status} /></li>)}
                  </ul>
                </details>
              )}
              {l.status === 'rejected' || l.decisionNote ? <p className="mt-2 text-sm text-muted-foreground"><span>School&apos;s note:</span> <bdi>{l.decisionNote}</bdi></p> : null}
              {l.checkout && <p className="mt-2 text-sm text-foreground"><span>Left at</span> <span dir="ltr">{l.checkout.time}</span>{l.checkout.name && <> <span>with</span> <bdi>{l.checkout.name}</bdi></>}{l.returnedTime && <> · <span>back at</span> <span dir="ltr">{l.returnedTime}</span></>}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {l.hasPass && <Button size="lg" onClick={() => onPass(l.id)}>Show the pass</Button>}
                {parent && l.canCancel && <Button variant="outline" size="lg" onClick={() => setCancelling(l)}>Cancel</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <details className="rounded-2xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Earlier and cancelled ({past.length})</summary>
          <ul className="mt-3 divide-y divide-border text-sm">
            {past.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><DateText date={l.date} weekday /> · <TimesText leaveTime={l.leaveTime} returning={l.returning} returnTime={l.returnTime} />{data.children.length > 1 && <> · <bdi>{l.student.name}</bdi></>} · <span>{l.reason.label}</span></span>
                <StatusBadge status={l.status} noShow={!!l.noShowAt && !l.checkout} late={!!l.lateReturnAt} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {cancelling && (
        <ReasonModal
          title="Cancel this leave?"
          description={`${cancelling.student.name} stays at school. The school and the teachers are told.`}
          label="Why (optional)"
          minLength={0}
          confirmLabel="Cancel the leave"
          destructive
          isPending={cancel.isPending}
          error={cancel.error?.message}
          choice={cancelling.seriesId ? { legend: 'This is a weekly request', options: [{ value: 'one', label: 'This day only' }, { value: 'all', label: 'This day and every one after it' }] } : undefined}
          onConfirm={(reason, choice) => cancel.mutate({ id: cancelling.id, reason, series: choice === 'all' })}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  );
}

// ─── The pass ────────────────────────────────────────────────────────────────

/** The pass, full screen and bright enough to scan: the QR code, the child, the time, who collects. */
function PassSheet({ leaveId, parent, onClose }: { leaveId: string; parent: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const pass = useQuery({ queryKey: [...LEAVE_KEY, 'pass', leaveId], queryFn: () => fetchPass(leaveId) });
  const replace = useMutation({
    mutationFn: async () => apiResponse(api.v1.leave.requests[':id'].pass.$post({ param: { id: leaveId } })),
    onSuccess: (p) => qc.setQueryData([...LEAVE_KEY, 'pass', leaveId], p),
  });
  const p = pass.data;
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-background p-4" role="dialog" aria-modal="true" aria-labelledby="pass-title">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between">
          <h2 id="pass-title" className="font-display text-xl font-bold text-foreground">Leave pass</h2>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
        {pass.isLoading ? <LoadingState label="Loading the pass…" /> : pass.isError || !p ? (
          <ErrorState title="The pass did not load" message={pass.error?.message} onRetry={() => pass.refetch()} />
        ) : !p.token ? (
          <Notice tone="success" title="Already left">{p.message}</Notice>
        ) : (
          <div className="mt-3 rounded-2xl border border-border bg-card p-5 text-center shadow-sm">
            <p className="font-display text-2xl font-bold text-foreground"><bdi>{p.leave.student.name}</bdi></p>
            <p className="mt-1 text-lg font-semibold text-foreground"><DateText date={p.leave.date} weekday long /></p>
            <p className="text-3xl font-bold tabular-nums text-foreground" dir="ltr">{p.leave.leaveTime}{p.leave.returning && p.leave.returnTime ? ` – ${p.leave.returnTime}` : ''}</p>
            <div className="my-4 flex justify-center"><QrCode value={p.token} label={`Leave pass for ${p.leave.student.name}`} /></div>
            <p className="text-sm text-muted-foreground"><span>Collected by</span> <CollectorText c={p.leave.collector} /></p>
            <p className="mt-2 text-xs text-muted-foreground">Show this at the gate. The gate also checks the collector&apos;s ID. It works until the end of the day.</p>
            {parent && (
              <Button variant="link" size="sm" className="mt-2 h-auto whitespace-normal" disabled={replace.isPending} onClick={() => replace.mutate()}>
                Shared it by mistake? Make a new pass (the old one stops working)
              </Button>
            )}
            {replace.isSuccess && <p className="text-xs text-emerald-700 dark:text-emerald-400">A new pass is shown; the old one no longer works.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Collectors ──────────────────────────────────────────────────────────────

function Collectors({ data }: { data: FamilyView }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const withdraw = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => apiResponse(api.v1.leave.collectors[':id'].withdraw.$post({ param: { id }, json: { reason: reason || null } })),
    onSuccess: () => { setWithdrawing(null); qc.invalidateQueries({ queryKey: LEAVE_KEY }); },
  });
  const live = data.collectors.filter((c) => c.status !== 'withdrawn');
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">People other than parents who may collect your children. The school checks each one before the gate accepts them.</p>
        {!adding && <Button onClick={() => setAdding(true)}>Add a collector</Button>}
      </div>
      {adding && <AddCollector data={data} onDone={() => setAdding(false)} />}
      {live.length === 0 && !adding ? (
        <EmptyState title="No collectors yet" message="Parents linked to a child may always collect them. Add a grandparent, a driver or another trusted adult here." />
      ) : (
        <ul className="space-y-3">
          {live.map((c) => (
            <li key={c.id} className="flex gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <Photo fileId={c.photoFileId} name={c.name} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-foreground"><bdi>{c.name}</bdi> <span className="font-normal text-muted-foreground">· {c.relation}</span></p>
                  <Badge tone={COLLECTOR_STATUS[c.status]?.tone ?? 'neutral'}>{COLLECTOR_STATUS[c.status]?.label ?? c.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground"><span dir="ltr">{c.phone}</span> · <span>ID</span> <span dir="ltr">{c.idNumber}</span></p>
                <p className="mt-1 flex flex-wrap gap-1">{c.students.map((s) => <Badge key={s.id} tone="neutral"><bdi>{s.name}</bdi></Badge>)}</p>
                {c.status === 'rejected' && c.decisionReason && <p className="mt-1 text-sm text-destructive"><span>Not approved:</span> <bdi>{c.decisionReason}</bdi></p>}
                {c.status !== 'rejected' && (
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => setWithdrawing(c.id)}>Withdraw</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {withdrawing && (
        <ReasonModal title="Withdraw this collector?" description="They may no longer collect your children. A leave naming them needs someone else." label="Why (optional)" minLength={0}
          confirmLabel="Withdraw" destructive isPending={withdraw.isPending} error={withdraw.error?.message}
          onConfirm={(reason) => withdraw.mutate({ id: withdrawing, reason })} onClose={() => setWithdrawing(null)} />
      )}
    </section>
  );
}

function AddCollector({ data, onDone }: { data: FamilyView; onDone: () => void }) {
  const qc = useQueryClient();
  const kids = data.children.filter((c) => !c.leftOn);
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [phone, setPhone] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [studentIds, setStudentIds] = useState<string[]>(kids.map((k) => k.id));
  const save = useMutation({
    mutationFn: async () => {
      if (studentIds.length === 0) throw new Error('Choose at least one child');
      const photoFileId = photo ? (await uploadFor(photo, 'collector_photo', studentIds[0]!)).id : null;
      return apiResponse(api.v1.leave.collectors.$post({ json: { name, relation, phone, idNumber, photoFileId, studentIds } }));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: LEAVE_KEY }); onDone(); },
  });
  return (
    <form className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <h2 className="font-display text-lg font-bold text-foreground">A new collector</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="c-name" className="mb-1.5">Full name, as on their ID</Label><Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div>
          <Label htmlFor="c-rel" className="mb-1.5">Relation to the child</Label>
          <Input id="c-rel" list="c-rel-list" value={relation} onChange={(e) => setRelation(e.target.value)} required />
          <datalist id="c-rel-list">{COLLECTOR_RELATIONS.map((r) => <option key={r} value={r} />)}</datalist>
        </div>
        <div><Label htmlFor="c-phone" className="mb-1.5">Mobile</Label><Input id="c-phone" type="tel" inputMode="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} required /></div>
        <div><Label htmlFor="c-id" className="mb-1.5">National ID or passport number</Label><Input id="c-id" inputMode="numeric" dir="ltr" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} required /></div>
      </div>
      <p className="text-xs text-muted-foreground"><span>Only the school sees the full number; you see</span> <span dir="ltr">{maskIdNumber(idNumber) ?? '••••'}</span><span>.</span></p>
      <label className="flex cursor-pointer items-center gap-3">
        {photo ? <span className="text-sm text-foreground">{photo.name}</span> : <span className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:bg-accent">Take or choose a clear photo of their face</span>}
        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </label>
      {kids.length > 1 && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-foreground">May collect</legend>
          <div className="flex flex-wrap gap-2">
            {kids.map((k) => (
              <label key={k.id} className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input type="checkbox" checked={studentIds.includes(k.id)} onChange={() => setStudentIds((s) => (s.includes(k.id) ? s.filter((x) => x !== k.id) : [...s, k.id]))} />
                <bdi>{k.name}</bdi>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {save.error && <p className="text-sm text-destructive" role="alert">{save.error.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={save.isPending}>{save.isPending ? 'Sending…' : 'Send to the school for approval'}</Button>
        <Button type="button" variant="outline" size="lg" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
