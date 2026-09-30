'use client';

/**
 * One student's campus leave (FEATURES_PLAN.md F2, "History"): the desk, the
 * coordinator and the admin.
 *
 * The spreadsheet version: a filter on a leave sheet by name, a second sheet
 * for "who may collect", a folder in the office for court orders — and the
 * sibling's leave on another tab. Here: everything about one student's leave
 * on one page — this term's count and by reason, every request with where it
 * stands and what happened at the gate (the family's other children with one
 * switch), who may collect them with photo and approval, and (for the
 * coordinator and the admin) who may not; a request for the family, a new
 * collector and a custody note are each made here in place.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, COLLECTOR_RELATIONS } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { ErrorState, LoadingState, EmptyState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { ReasonModal } from '~/components/ui/reason-modal';
import { cn } from '~/lib/utils';
import { DateText } from '../../../academic/calendar/academic-shared';
import {
  LEAVE_KEY, fetchStudentLeave, fetchLeaves, uploadFor, fileUrl, StatusBadge, TimesText, CollectorText, Photo, COLLECTOR_STATUS, SELECT,
  type StudentLeave,
} from '../../leave-shared';
import { LeaveNav } from '../../leave-nav';
import { StaffRequest } from '../../manage/manage.client';

export default function StudentLeaveClient({ studentId, role }: { studentId: string; role: string }): React.JSX.Element {
  const academic = role === 'coordinator' || role === 'admin';
  const rec = useQuery({ queryKey: [...LEAVE_KEY, 'student', studentId], queryFn: () => fetchStudentLeave(studentId) });
  const [panel, setPanel] = useState<'none' | 'request' | 'collector' | 'restriction'>('none');
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 animate-fade-up">
      <LeaveNav academic={academic} />
      {rec.isLoading ? <LoadingState /> : rec.isError || !rec.data ? <ErrorState onRetry={() => rec.refetch()} /> : (
        <Record r={rec.data} academic={academic} panel={panel} setPanel={setPanel} />
      )}
    </div>
  );
}

function Record({ r, academic, panel, setPanel }: { r: StudentLeave; academic: boolean; panel: string; setPanel: (p: 'none' | 'request' | 'collector' | 'restriction') => void }) {
  const [family, setFamily] = useState(false);
  const famLeaves = useQuery({ queryKey: [...LEAVE_KEY, 'family-of', r.student.id], queryFn: () => fetchLeaves({ studentId: r.student.id, family: 'true' }), enabled: family });
  const leaves = family ? (famLeaves.data ?? []) : r.leaves;
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground"><bdi>{r.student.name}</bdi></h1>
          <p className="text-sm text-muted-foreground">
            <span>{r.student.gradeLabel}</span>{r.student.section && <> · <span>{r.student.section}</span></>}{r.student.code && <> · <span className="font-mono">{r.student.code}</span></>}
            {' · '}<Link className="text-primary underline" href={`/students/${r.student.id}` as Route}>Academic record</Link>
          </p>
          <p className="mt-1 flex flex-wrap gap-1">
            {r.custodyOnFile > 0 && <Badge tone="danger">{academic ? 'Custody note on file' : 'Custody note on file — the gate checks it'}</Badge>}
            {r.mayLeaveAlone && <Badge tone="info">May leave alone</Badge>}
            {r.student.leftOn && <Badge tone="danger">Left the school</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPanel(panel === 'request' ? 'none' : 'request')}>Request leave</Button>
          <Button variant="outline" onClick={() => setPanel(panel === 'collector' ? 'none' : 'collector')}>Add a collector</Button>
          {academic && <Button variant="outline" onClick={() => setPanel(panel === 'restriction' ? 'none' : 'restriction')}>Record who may not collect</Button>}
        </div>
      </header>

      {panel === 'request' && (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <StaffRequest studentId={r.student.id} academic={academic} />
        </section>
      )}
      {panel === 'collector' && <StaffAddCollector r={r} onDone={() => setPanel('none')} />}
      {panel === 'restriction' && academic && <AddRestriction r={r} onDone={() => setPanel('none')} />}

      <section aria-label="This term" className="grid gap-3 sm:grid-cols-4">
        <Tile label={r.summary.term ? `Leave in ${r.summary.term.name}` : 'Leave so far'} value={r.summary.thisTerm} />
        <Tile label="Asked by the family" value={r.summary.familyThisTerm} />
        <Tile label="Not collected" value={r.summary.noShows} alert />
        <Tile label="Late back" value={r.summary.lateReturns} alert />
      </section>
      {r.summary.byReason.length > 0 && <p className="flex flex-wrap gap-1">{r.summary.byReason.map((b) => <Badge key={b.label} tone="neutral">{`${b.label}: ${b.count}`}</Badge>)}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="leaves-title">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 id="leaves-title" className="font-display text-lg font-bold text-foreground">Every leave</h2>
            {r.siblings.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={family} onChange={(e) => setFamily(e.target.checked)} />
                <span>With the family</span> <span className="text-muted-foreground">({r.siblings.map((s) => s.name).join(', ')})</span>
              </label>
            )}
          </div>
          {leaves.length === 0 ? <EmptyState title="No leave yet" /> : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr><th className="px-3 py-2 text-start">Date</th>{family && <th className="px-3 py-2 text-start">Student</th>}<th className="px-3 py-2 text-start">Time</th><th className="px-3 py-2 text-start">Reason</th><th className="px-3 py-2 text-start">Collected by</th><th className="px-3 py-2 text-start">Status</th></tr>
                </thead>
                <tbody>
                  {leaves.map((l) => (
                    <tr key={l.id} className="border-t border-border align-top">
                      <td className="px-3 py-2"><DateText date={l.date} weekday /></td>
                      {family && <td className="px-3 py-2"><bdi>{l.student.name}</bdi></td>}
                      <td className="px-3 py-2"><TimesText leaveTime={l.leaveTime} returning={l.returning} returnTime={l.returnTime} /></td>
                      <td className="px-3 py-2">
                        {l.reason.label}
                        {l.origin === 'school' && <Badge tone="info" className="ms-1">School</Badge>}
                        {l.note && <p className="text-xs text-muted-foreground"><bdi>{l.note}</bdi></p>}
                        {l.document && <a className="block text-xs text-primary underline" href={fileUrl(l.document.id)} target="_blank" rel="noreferrer"><bdi>{l.document.name}</bdi></a>}
                      </td>
                      <td className="px-3 py-2">
                        <CollectorText c={l.collector} />
                        {l.checkout && <p className="text-xs text-muted-foreground"><span>Left</span> <span dir="ltr">{l.checkout.time}</span>{l.checkout.name && <> <span>with</span> <bdi>{l.checkout.name}</bdi></>}{l.returnedTime && <> · <span>back</span> <span dir="ltr">{l.returnedTime}</span></>}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={l.status} noShow={!!l.noShowAt && !l.checkout} late={!!l.lateReturnAt} />
                        {(l.decisionNote || l.cancelReason) && <p className="mt-1 text-xs text-muted-foreground"><bdi>{l.decisionNote ?? l.cancelReason}</bdi></p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <aside className="space-y-6">
          <CollectorList r={r} academic={academic} />
          {academic && <RestrictionList r={r} />}
        </aside>
      </div>
    </div>
  );
}

function Tile({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={cn('rounded-xl border bg-card p-4', alert && value > 0 ? 'border-red-200 dark:border-red-800' : 'border-border')}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-bold tabular-nums', alert && value > 0 ? 'text-red-700 dark:text-red-400' : 'text-foreground')}>{value}</p>
    </div>
  );
}

// ─── Collectors ──────────────────────────────────────────────────────────────

function CollectorList({ r, academic }: { r: StudentLeave; academic: boolean }) {
  const qc = useQueryClient();
  const [refusing, setRefusing] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const done = () => qc.invalidateQueries({ queryKey: LEAVE_KEY });
  const approve = useMutation({ mutationFn: async (id: string) => apiResponse(api.v1.leave.collectors[':id'].approve.$post({ param: { id } })), onSuccess: done });
  const reject = useMutation({ mutationFn: async ({ id, reason }: { id: string; reason: string }) => apiResponse(api.v1.leave.collectors[':id'].reject.$post({ param: { id }, json: { reason } })), onSuccess: () => { setRefusing(null); done(); } });
  const withdraw = useMutation({ mutationFn: async ({ id, reason }: { id: string; reason: string }) => apiResponse(api.v1.leave.collectors[':id'].withdraw.$post({ param: { id }, json: { reason } })), onSuccess: () => { setWithdrawing(null); done(); } });
  return (
    <section aria-labelledby="collectors-title">
      <h2 id="collectors-title" className="mb-2 font-display text-lg font-bold text-foreground">Who may collect</h2>
      <ul className="space-y-2">
        {r.parents.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-sm">
            <Photo fileId={null} name={p.name} size="sm" />
            <span className="min-w-0 flex-1"><bdi className="font-semibold text-foreground">{p.name}</bdi> <span className="text-muted-foreground">· <span>Parent</span>{p.phone && <> · <span dir="ltr">{p.phone}</span></>}</span></span>
          </li>
        ))}
        {r.restrictedParents.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-xl border border-red-200 bg-card p-3 text-sm dark:border-red-800">
            <Photo fileId={null} name={p.name} size="sm" />
            <span className="min-w-0 flex-1"><bdi className="font-semibold text-foreground">{p.name}</bdi> <Badge tone="danger">Linked parent under a custody note</Badge></span>
          </li>
        ))}
        {r.collectors.map((c) => (
          <li key={c.id} className="rounded-xl border border-border bg-card p-3 text-sm">
            <div className="flex items-start gap-3">
              <Photo fileId={c.photoFileId} name={c.name} />
              <div className="min-w-0 flex-1">
                <p><bdi className="font-semibold text-foreground">{c.name}</bdi> <span className="text-muted-foreground">· {c.relation}</span></p>
                <p className="text-muted-foreground"><span dir="ltr">{c.phone}</span> · <span>ID</span> <span dir="ltr" className="font-mono">{c.idNumber}</span></p>
                <Badge tone={COLLECTOR_STATUS[c.status]?.tone ?? 'neutral'}>{COLLECTOR_STATUS[c.status]?.label ?? c.status}</Badge>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {academic && c.status === 'pending' && r.canDecide && <>
                <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(c.id)}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => setRefusing(c.id)}>Refuse…</Button>
              </>}
              {(c.status === 'approved' || c.status === 'pending') && <Button size="sm" variant="ghost" onClick={() => setWithdrawing(c.id)}>Withdraw…</Button>}
            </div>
          </li>
        ))}
      </ul>
      {approve.error && <p className="mt-2 text-sm text-destructive">{approve.error.message}</p>}
      {refusing && <ReasonModal title="Refuse this collector?" description="The family is told the reason." label="Reason" confirmLabel="Refuse" destructive isPending={reject.isPending} error={reject.error?.message} onConfirm={(reason) => reject.mutate({ id: refusing, reason })} onClose={() => setRefusing(null)} />}
      {withdrawing && <ReasonModal title="Withdraw this collector?" description="They may no longer collect; the family is told." label="Reason" confirmLabel="Withdraw" destructive isPending={withdraw.isPending} error={withdraw.error?.message} onConfirm={(reason) => withdraw.mutate({ id: withdrawing, reason })} onClose={() => setWithdrawing(null)} />}
    </section>
  );
}

function StaffAddCollector({ r, onDone }: { r: StudentLeave; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [phone, setPhone] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [kids, setKids] = useState<string[]>([r.student.id]);
  const save = useMutation({
    mutationFn: async () => {
      const photoFileId = photo ? (await uploadFor(photo, 'collector_photo', r.student.id)).id : null;
      return apiResponse(api.v1.leave.collectors.$post({ json: { name, relation, phone, idNumber, photoFileId, studentIds: kids } }));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: LEAVE_KEY }); onDone(); },
  });
  return (
    <form className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <h2 className="font-display text-lg font-bold text-foreground">A collector for the family</h2>
      <p className="text-sm text-muted-foreground">Check the ID card in front of you. The coordinator&apos;s or the admin&apos;s own entry is approved at once; the desk&apos;s waits for the coordinator.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="sc-name" className="mb-1.5">Full name, as on their ID</Label><Input id="sc-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div><Label htmlFor="sc-rel" className="mb-1.5">Relation</Label><Input id="sc-rel" list="sc-rel-list" value={relation} onChange={(e) => setRelation(e.target.value)} required /><datalist id="sc-rel-list">{COLLECTOR_RELATIONS.map((x) => <option key={x} value={x} />)}</datalist></div>
        <div><Label htmlFor="sc-phone" className="mb-1.5">Mobile</Label><Input id="sc-phone" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} required /></div>
        <div><Label htmlFor="sc-id" className="mb-1.5">National ID or passport number</Label><Input id="sc-id" dir="ltr" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} required /></div>
      </div>
      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <span className="rounded-lg border border-dashed border-border px-4 py-2 text-muted-foreground hover:bg-accent">{photo ? photo.name : 'Photo of their face'}</span>
        <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </label>
      {r.siblings.length > 0 && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1.5 text-sm font-medium">May collect</legend>
          {[{ id: r.student.id, name: r.student.name }, ...r.siblings].map((k) => (
            <label key={k.id} className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-primary">
              <input type="checkbox" checked={kids.includes(k.id)} onChange={() => setKids((s) => (s.includes(k.id) ? s.filter((x) => x !== k.id) : [...s, k.id]))} /><bdi>{k.name}</bdi>
            </label>
          ))}
        </fieldset>
      )}
      {save.error && <p className="text-sm text-destructive" role="alert">{save.error.message}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={save.isPending || kids.length === 0}>Save</Button><Button type="button" variant="outline" onClick={onDone}>Cancel</Button></div>
    </form>
  );
}

// ─── Custody ─────────────────────────────────────────────────────────────────

function RestrictionList({ r }: { r: StudentLeave }) {
  const qc = useQueryClient();
  const [ending, setEnding] = useState<string | null>(null);
  const end = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => apiResponse(api.v1.leave.restrictions[':id'].end.$post({ param: { id }, json: { reason } })),
    onSuccess: () => { setEnding(null); qc.invalidateQueries({ queryKey: LEAVE_KEY }); },
  });
  return (
    <section aria-labelledby="custody-title">
      <h2 id="custody-title" className="mb-2 font-display text-lg font-bold text-foreground">May not collect</h2>
      {r.restrictions.length === 0 ? <p className="text-sm text-muted-foreground">No custody note.</p> : (
        <ul className="space-y-2">
          {r.restrictions.map((x) => (
            <li key={x.id} className={cn('rounded-xl border bg-card p-3 text-sm', x.endedAt ? 'border-border opacity-70' : 'border-red-200 dark:border-red-800')}>
              <div className="flex items-start gap-3">
                <Photo fileId={x.photoFileId} name={x.personName} />
                <div className="min-w-0 flex-1">
                  <p><bdi className="font-semibold text-foreground">{x.personName}</bdi>{x.relation && <span className="text-muted-foreground"> · {x.relation}</span>}</p>
                  {x.idNumber && <p className="text-muted-foreground"><span>ID</span> <span dir="ltr" className="font-mono">{x.idNumber}</span></p>}
                  {x.restrictedUser && <p className="text-muted-foreground"><span>Account:</span> <bdi>{x.restrictedUser.name}</bdi></p>}
                  <p className="text-foreground"><bdi>{x.note}</bdi></p>
                  {x.documentFileId && <a className="text-xs text-primary underline" href={fileUrl(x.documentFileId)} target="_blank" rel="noreferrer">The document</a>}
                  <p className="text-xs text-muted-foreground"><span>Recorded by</span> <bdi>{x.createdBy}</bdi>{x.endedAt && <> · <span>ended:</span> <bdi>{x.endReason}</bdi></>}</p>
                </div>
              </div>
              {!x.endedAt && <Button size="sm" variant="ghost" className="mt-1" onClick={() => setEnding(x.id)}>End…</Button>}
            </li>
          ))}
        </ul>
      )}
      {ending && <ReasonModal title="End this custody note?" description="The person is no longer refused at the gate. The record keeps the note." label="Why (an order lifted, a new instruction)" confirmLabel="End it" destructive isPending={end.isPending} error={end.error?.message} onConfirm={(reason) => end.mutate({ id: ending, reason })} onClose={() => setEnding(null)} />}
    </section>
  );
}

function AddRestriction({ r, onDone }: { r: StudentLeave; onDone: () => void }) {
  const qc = useQueryClient();
  const [personName, setPersonName] = useState('');
  const [relation, setRelation] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [userId, setUserId] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [doc, setDoc] = useState<File | null>(null);
  const [result, setResult] = useState<{ collectors: string[]; leaves: number } | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const photoFileId = photo ? (await uploadFor(photo, 'custody_photo', r.student.id)).id : null;
      const documentFileId = doc ? (await uploadFor(doc, 'custody_document', r.student.id)).id : null;
      return apiResponse(api.v1.leave.restrictions.$post({ json: { studentId: r.student.id, personName, relation: relation || null, idNumber: idNumber || null, restrictedUserId: userId || null, note, photoFileId, documentFileId } }));
    },
    onSuccess: (x) => { setResult({ collectors: x.matchingCollectors.map((c) => c.name), leaves: x.affectedLeaves.length }); qc.invalidateQueries({ queryKey: LEAVE_KEY }); },
  });
  if (result) {
    return (
      <Notice tone="success" title="Recorded: the gate refuses this person from now on">
        {result.collectors.length > 0 && <p><span>It matches an authorised collector:</span> {result.collectors.join(', ')} <span>— withdraw them below.</span></p>}
        {result.leaves > 0 && <p>{`${result.leaves} leave(s) to come name them: check who collects.`}</p>}
        <Button size="sm" className="mt-2" onClick={onDone}>Done</Button>
      </Notice>
    );
  }
  return (
    <form className="space-y-4 rounded-2xl border border-red-200 bg-card p-5 shadow-sm dark:border-red-800" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <h2 className="font-display text-lg font-bold text-foreground">Who may not collect <bdi>{r.student.name}</bdi></h2>
      <p className="text-sm text-muted-foreground">A court order or the family&apos;s written instruction. The family never sees this; the gate sees the name, the photo and the ID number on the day&apos;s list.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="r-name" className="mb-1.5">Full name</Label><Input id="r-name" value={personName} onChange={(e) => setPersonName(e.target.value)} required /></div>
        <div><Label htmlFor="r-rel" className="mb-1.5">Relation</Label><Input id="r-rel" value={relation} onChange={(e) => setRelation(e.target.value)} /></div>
        <div><Label htmlFor="r-id" className="mb-1.5">ID number (if known)</Label><Input id="r-id" dir="ltr" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} /></div>
        <div>
          <Label htmlFor="r-user" className="mb-1.5">A linked parent&apos;s account</Label>
          <select id="r-user" className={SELECT} value={userId} onChange={(e) => { setUserId(e.target.value); const p = r.parents.find((x) => x.id === e.target.value); if (p && !personName) setPersonName(p.name); }}>
            <option value="">None</option>
            {r.parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <div><Label htmlFor="r-note" className="mb-1.5">What it rests on</Label><textarea id="r-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} required className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" /></div>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="cursor-pointer rounded-lg border border-dashed border-border px-3 py-2 text-muted-foreground hover:bg-accent">{photo ? photo.name : 'Their photo'}<input type="file" accept="image/*" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></label>
        <label className="cursor-pointer rounded-lg border border-dashed border-border px-3 py-2 text-muted-foreground hover:bg-accent">{doc ? doc.name : 'The order or letter'}<input type="file" accept="application/pdf,image/*,.docx" className="sr-only" onChange={(e) => setDoc(e.target.files?.[0] ?? null)} /></label>
      </div>
      {save.error && <p className="text-sm text-destructive" role="alert">{save.error.message}</p>}
      <div className="flex gap-2"><Button type="submit" variant="destructive" disabled={save.isPending}>Record</Button><Button type="button" variant="outline" onClick={onDone}>Cancel</Button></div>
    </form>
  );
}
