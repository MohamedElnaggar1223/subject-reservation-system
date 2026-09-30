'use client';

/**
 * Shared by the campus-leave screens (FEATURES_PLAN.md F2): the fetchers
 * (every response type derived from the RPC client, PATTERNS.md), one query
 * key so a change refreshes every screen, the words for a leave's status,
 * the pass's QR code, photos and uploads, and the request form the family,
 * the desk and the coordinator share.
 */

import { useMemo, useState } from 'react';
import { encode } from 'uqr';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { env } from '~/env';
import { apiResponse, WEEKDAY_LABELS, type LeaveStatus } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Badge, Notice, type Tone } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { DateText, addDays, isTime, normalizeTime } from '../academic/calendar/academic-shared';

export const LEAVE_KEY = ['leave'] as const;

// ─── Fetchers ────────────────────────────────────────────────────────────────

export const fetchFamily = () => apiResponse(api.v1.leave.family.$get());
export type FamilyView = Awaited<ReturnType<typeof fetchFamily>>;
export type FamilyChild = FamilyView['children'][number];

type ListQuery = Parameters<typeof api.v1.leave.requests.$get>[0]['query'];
export const fetchLeaves = (query: ListQuery) => apiResponse(api.v1.leave.requests.$get({ query }));
export type LeaveRow = Awaited<ReturnType<typeof fetchLeaves>>[number];

export const fetchLeave = (id: string) => apiResponse(api.v1.leave.requests[':id'].$get({ param: { id } }));
export const fetchPass = (id: string) => apiResponse(api.v1.leave.requests[':id'].pass.$get({ param: { id } }));
export const fetchQueue = () => apiResponse(api.v1.leave.queue.$get());
export type QueueItem = Awaited<ReturnType<typeof fetchQueue>>['requests'][number];
export type PendingCollector = Awaited<ReturnType<typeof fetchQueue>>['collectors'][number];

export const fetchCollectors = (query: Parameters<typeof api.v1.leave.collectors.$get>[0]['query']) => apiResponse(api.v1.leave.collectors.$get({ query }));
export type CollectorRow = Awaited<ReturnType<typeof fetchCollectors>>[number];

export const fetchStudentLeave = (studentId: string) => apiResponse(api.v1.leave.students[':studentId'].$get({ param: { studentId } }));
export type StudentLeave = Awaited<ReturnType<typeof fetchStudentLeave>>;

export const fetchGateToday = () => apiResponse(api.v1.leave.gate.today.$get());
export type GateLeave = Awaited<ReturnType<typeof fetchGateToday>>['leaves'][number];

export const fetchReport = (from: string, to: string) => apiResponse(api.v1.leave.reports.$get({ query: { from, to } }));
export type LeaveReport = Awaited<ReturnType<typeof fetchReport>>;

export const fetchTeachingLeave = (date?: string) => apiResponse(api.v1.leave.teaching.$get({ query: date ? { date } : {} }));

type StudentsQuery = Parameters<typeof api.v1.students.$get>[0]['query'];
export const searchStudents = (search: string) => apiResponse(api.v1.students.$get({ query: { search, limit: '8' } satisfies StudentsQuery }));

/** A file uploaded for a purpose through the one upload path (F0a). */
export async function uploadFor(file: File, purpose: 'collector_photo' | 'supporting_document' | 'custody_photo' | 'custody_document', studentId: string) {
  return apiResponse(api.v1.files.upload.$post({ form: { file, purpose, studentId } }));
}

/** Where a stored file's bytes are read (the API decides who may). */
export const fileUrl = (id: string) => `${env.apiUrl}/v1/files/${id}/content`;

/** The school's date (Cairo) today, and the time now. */
export function schoolNow(): { date: string; time: string } {
  const d = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return { date, time };
}

// ─── Words ───────────────────────────────────────────────────────────────────

export const STATUS: Record<LeaveStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  rejected: { label: 'Not approved', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  checked_out: { label: 'Left school', tone: 'success' },
  returned: { label: 'Back at school', tone: 'success' },
};

export function StatusBadge({ status, noShow, late }: { status: string; noShow?: boolean; late?: boolean }) {
  const s = STATUS[status as LeaveStatus] ?? { label: status, tone: 'neutral' as Tone };
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={s.tone}>{s.label}</Badge>
      {noShow && <Badge tone="danger">Not collected</Badge>}
      {late && <Badge tone="danger">Late back</Badge>}
    </span>
  );
}

export const COLLECTOR_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Waiting for the school', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

/** "10:30 – 12:00", or "10:30, not coming back". */
export function TimesText({ leaveTime, returning, returnTime }: { leaveTime: string; returning: boolean; returnTime: string | null }) {
  return (
    <span className="tabular-nums" dir="ltr">
      {leaveTime}
      {returning && returnTime ? <> – {returnTime}</> : null}
      {!returning && <span className="text-muted-foreground" dir="auto">{' · '}<span>not coming back</span></span>}
    </span>
  );
}

export function CollectorText({ c }: { c: { kind: string; name: string | null; relation: string | null } }) {
  if (c.kind === 'alone') return <span>Leaves alone</span>;
  return (
    <span>
      <bdi>{c.name ?? '—'}</bdi>
      {c.relation && <span className="text-muted-foreground"> · <span>{c.relation}</span></span>}
    </span>
  );
}

// ─── Photos and the QR code ──────────────────────────────────────────────────

export function Photo({ fileId, name, size = 'md' }: { fileId: string | null | undefined; name: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  const box = size === 'lg' ? 'size-24' : size === 'sm' ? 'size-9' : 'size-14';
  const initials = (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  if (!fileId || failed) {
    return (
      <span className={cn(box, 'inline-flex shrink-0 items-center justify-center rounded-lg bg-muted font-semibold text-muted-foreground')} aria-hidden="true">
        {initials}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a private file read with the session cookie; next/image cannot fetch it.
    <img src={fileUrl(fileId)} alt={name ? `Photo of ${name}` : 'Photo'} onError={() => setFailed(true)} className={cn(box, 'shrink-0 rounded-lg border border-border object-cover')} />
  );
}

/**
 * A QR code drawn as one SVG path. Dark modules on white whatever the theme:
 * a scanner needs the contrast (the one place the screens use fixed colours).
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const path = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    let d = '';
    qr.data.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x} ${y}h1v1h-1z`; }));
    return { d, size: qr.size };
  }, [value]);
  return (
    <svg viewBox={`0 0 ${path.size} ${path.size}`} role="img" aria-label={label} className="h-auto w-full max-w-[18rem] rounded-lg bg-white" shapeRendering="crispEdges">
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

// ─── The request form ────────────────────────────────────────────────────────

export type FormStudent = {
  id: string;
  name: string;
  mayLeaveAlone: boolean;
  parents: { id: string; name: string; isMe?: boolean }[];
  collectors: { id: string; name: string; relation: string; status: string }[];
};

type Policy = { reasons: readonly { key: string; label: string }[]; cutoff: string | null; noticeMinutes: number };

export const SELECT = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50';

/**
 * The one request form: a parent in the app, the desk for a family, the
 * coordinator or admin for a family or on the school's own decision.
 *
 * The paper version is a slip: child, date, time, reason, who collects,
 * signature — then a phone call to check it arrived. Here the choices are
 * the school's own (reasons as buttons, who may collect this child as
 * cards, today and tomorrow in one tap), the rules are said before sending
 * (the same-day cut-off, the notice), and the answer says what happens next.
 */
export function RequestLeaveForm({
  students, policy, today, mode, canApprove = false, onDone, initialStudentId,
}: {
  students: FormStudent[];
  policy: Policy;
  today: string;
  mode: 'family' | 'staff';
  canApprove?: boolean;
  onDone?: (result: { approved: number; count: number }) => void;
  initialStudentId?: string;
}) {
  const qc = useQueryClient();
  const [studentId, setStudentId] = useState(initialStudentId ?? students[0]?.id ?? '');
  const student = students.find((s) => s.id === studentId);
  const [date, setDate] = useState(today);
  const [leaveTime, setLeaveTime] = useState('');
  const [returning, setReturning] = useState(false);
  const [returnTime, setReturnTime] = useState('');
  const [reason, setReason] = useState(policy.reasons[0]?.key ?? '');
  const [note, setNote] = useState('');
  const [collector, setCollector] = useState<string>(() => {
    const me = student?.parents.find((p) => p.isMe);
    return me ? `parent:${me.id}` : student?.parents[0] ? `parent:${student.parents[0].id}` : '';
  });
  const [doc, setDoc] = useState<File | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [until, setUntil] = useState(addDays(today, 28));
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [origin, setOrigin] = useState<'family' | 'school'>('family');
  const [onBehalfOf, setOnBehalfOf] = useState('');
  const [approveNow, setApproveNow] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ approved: number; count: number; warnings: { code: string; message: string }[]; skipped: { date: string; why: string }[] } | null>(null);

  const chooseStudent = (id: string) => {
    setStudentId(id);
    const s = students.find((x) => x.id === id);
    const me = s?.parents.find((p) => p.isMe);
    setCollector(me ? `parent:${me.id}` : s?.parents[0] ? `parent:${s.parents[0].id}` : '');
  };
  const weekdayOfDate = new Date(`${date}T12:00:00Z`).getUTCDay();

  const send = useMutation({
    mutationFn: async () => {
      setError('');
      const lt = normalizeTime(leaveTime);
      if (!isTime(lt)) throw new Error('Write the leave time like 10:30');
      const rt = returning ? normalizeTime(returnTime) : null;
      if (returning && (!rt || !isTime(rt))) throw new Error('Write the time they are back, like 12:00');
      const [kind, id] = collector.split(':');
      if (!kind) throw new Error('Choose who collects');
      const documentFileId = doc ? (await uploadFor(doc, 'supporting_document', studentId)).id : null;
      return apiResponse(api.v1.leave.requests.$post({ json: {
        studentId, date, leaveTime: lt, returning, returnTime: rt, reasonCategory: reason, note: note.trim() || null, documentFileId,
        collector: kind === 'parent' ? { kind: 'parent', parentId: id! } : kind === 'collector' ? { kind: 'collector', collectorId: id! } : { kind: 'alone' },
        ...(mode === 'staff' ? { origin, onBehalfOf: onBehalfOf || null, approveNow: canApprove ? approveNow : false } : {}),
        repeat: repeat ? { until, weekdays: weekdays.length ? weekdays : [weekdayOfDate] } : null,
      } }));
    },
    onSuccess: (r) => {
      setResult({ approved: r.approved, count: r.leaves.length, warnings: r.warnings, skipped: r.skipped });
      qc.invalidateQueries({ queryKey: LEAVE_KEY });
      onDone?.({ approved: r.approved, count: r.leaves.length });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (result) {
    return (
      <div className="space-y-3">
        <Notice tone={result.approved === result.count ? 'success' : 'info'} title={result.approved === result.count ? 'Approved' : 'Sent to the school'}>
          {result.count > 1 ? <span>{`${result.count} dates requested`}</span> : null}
          {result.approved === result.count
            ? <p>The pass is ready on the family&apos;s screen.</p>
            : <p>The coordinator decides; the family is told, and the pass appears once it is approved.</p>}
        </Notice>
        {result.warnings.length > 0 && (
          <Notice tone="warning" title="The approver will see">
            <ul className="list-disc ps-5">{result.warnings.map((w) => <li key={w.code}>{w.message}</li>)}</ul>
          </Notice>
        )}
        {result.skipped.length > 0 && (
          <Notice tone="neutral" title="Dates left out">
            <ul className="list-disc ps-5">{result.skipped.map((s) => <li key={s.date}><DateText date={s.date} weekday /> — <span>{s.why}</span></li>)}</ul>
          </Notice>
        )}
        <Button variant="outline" onClick={() => { setResult(null); setLeaveTime(''); setNote(''); setDoc(null); }}>Request another</Button>
      </div>
    );
  }

  if (!student) return <Notice tone="neutral">No student to request leave for.</Notice>;
  const sameDay = date === today;
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
      {students.length > 1 && (
        <div>
          <Label htmlFor="lv-student" className="mb-1.5">Child</Label>
          <select id="lv-student" className={SELECT} value={studentId} onChange={(e) => chooseStudent(e.target.value)}>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-foreground">Day</legend>
        <div className="flex flex-wrap items-center gap-2">
          {[today, addDays(today, 1)].map((d, i) => (
            <button key={d} type="button" onClick={() => setDate(d)}
              className={cn('h-10 rounded-lg border px-4 text-sm font-medium', date === d ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent')}>
              {i === 0 ? 'Today' : 'Tomorrow'}
            </button>
          ))}
          <Input aria-label="Another day" type="date" min={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" />
          <span className="text-sm text-muted-foreground"><DateText date={date} weekday long /></span>
        </div>
        {mode === 'family' && sameDay && (policy.cutoff || policy.noticeMinutes > 0) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {policy.cutoff && <span>{`Same-day requests by ${policy.cutoff}.`}</span>}{' '}
            {policy.noticeMinutes > 0 && <span>{`Please give ${policy.noticeMinutes} minutes' notice.`}</span>}
          </p>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="lv-time" className="mb-1.5">Leaves at</Label>
          <Input id="lv-time" inputMode="numeric" placeholder="10:30" value={leaveTime} onChange={(e) => setLeaveTime(e.target.value)} onBlur={() => setLeaveTime(normalizeTime(leaveTime))} dir="ltr" className="text-lg tabular-nums" required />
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-foreground">Coming back?</span>
          <div className="flex gap-2">
            <label className={cn('flex h-10 flex-1 cursor-pointer items-center justify-center rounded-lg border text-sm', !returning ? 'border-primary bg-primary/5 font-medium' : 'border-border')}>
              <input type="radio" className="sr-only" checked={!returning} onChange={() => setReturning(false)} /> <span>Not today</span>
            </label>
            <label className={cn('flex h-10 flex-1 cursor-pointer items-center justify-center rounded-lg border text-sm', returning ? 'border-primary bg-primary/5 font-medium' : 'border-border')}>
              <input type="radio" className="sr-only" checked={returning} onChange={() => setReturning(true)} /> <span>Yes, back by</span>
            </label>
          </div>
          {returning && (
            <Input aria-label="Back by" inputMode="numeric" placeholder="12:00" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} onBlur={() => setReturnTime(normalizeTime(returnTime))} dir="ltr" className="mt-2 tabular-nums" />
          )}
        </div>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-foreground">Reason</legend>
        <div className="flex flex-wrap gap-2">
          {policy.reasons.map((r) => (
            <button key={r.key} type="button" onClick={() => setReason(r.key)} aria-pressed={reason === r.key}
              className={cn('min-h-10 rounded-full border px-4 text-sm', reason === r.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent')}>
              {r.label}
            </button>
          ))}
        </div>
        <textarea aria-label="Note for the school" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="A note for the school (optional)"
          className="mt-2 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50" />
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <span className="rounded-md border border-dashed border-border px-3 py-1.5 hover:bg-accent">{doc ? doc.name : 'Attach a letter or appointment card (optional)'}</span>
          <input type="file" accept="application/pdf,image/*,.docx" className="sr-only" onChange={(e) => setDoc(e.target.files?.[0] ?? null)} />
        </label>
      </fieldset>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-foreground">Who collects</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {student.parents.map((p) => (
            <ChoiceCard key={p.id} checked={collector === `parent:${p.id}`} onSelect={() => setCollector(`parent:${p.id}`)} title={p.isMe ? `${p.name} (me)` : p.name} hint="Parent" />
          ))}
          {student.collectors.filter((c) => c.status === 'approved' || c.status === 'pending').map((c) => (
            <ChoiceCard key={c.id} checked={collector === `collector:${c.id}`} onSelect={() => setCollector(`collector:${c.id}`)} title={c.name}
              hint={c.status === 'pending' ? `${c.relation} · waiting for the school's approval` : c.relation} warn={c.status === 'pending'} />
          ))}
          {student.mayLeaveAlone && (
            <ChoiceCard checked={collector === 'alone'} onSelect={() => setCollector('alone')} title="Leaves alone" hint="Allowed for their grade" />
          )}
        </div>
        {student.parents.length === 0 && student.collectors.length === 0 && !student.mayLeaveAlone && (
          <p className="mt-2 text-sm text-destructive">Nobody is recorded to collect this student: add a collector first.</p>
        )}
      </fieldset>

      <fieldset>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
          <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="size-4" />
          <span>Repeat every week</span>
        </label>
        {repeat && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => {
              const on = weekdays.length ? weekdays.includes(d) : d === weekdayOfDate;
              return (
                <button key={d} type="button" aria-pressed={on}
                  onClick={() => setWeekdays((w) => { const base = w.length ? w : [weekdayOfDate]; return base.includes(d) ? base.filter((x) => x !== d) : [...base, d].sort(); })}
                  className={cn('h-9 rounded-lg border px-3 text-sm', on ? 'border-primary bg-primary/10 font-medium' : 'border-border')}>
                  {WEEKDAY_LABELS[d]}
                </button>
              );
            })}
            <span className="text-sm text-muted-foreground">until</span>
            <Input aria-label="Until" type="date" min={date} value={until} onChange={(e) => e.target.value && setUntil(e.target.value)} className="w-44" />
            <span className="text-xs text-muted-foreground">School days only; holidays are left out.</span>
          </div>
        )}
      </fieldset>

      {mode === 'staff' && (
        <fieldset className="space-y-3 rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-medium text-foreground">For the school&apos;s record</legend>
          <div className="flex flex-wrap gap-2">
            <ChoiceCard checked={origin === 'family'} onSelect={() => setOrigin('family')} title="The family asked" hint="At the desk or by phone" />
            {canApprove && <ChoiceCard checked={origin === 'school'} onSelect={() => setOrigin('school')} title="The school sends them home" hint="Unwell, or the school's decision" />}
          </div>
          {origin === 'family' && student.parents.length > 0 && (
            <div>
              <Label htmlFor="lv-behalf" className="mb-1.5">Which parent asked</Label>
              <select id="lv-behalf" className={SELECT} value={onBehalfOf} onChange={(e) => setOnBehalfOf(e.target.value)}>
                <option value="">Not recorded</option>
                {student.parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          {canApprove && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={approveNow} onChange={(e) => setApproveNow(e.target.checked)} className="size-4" />
              <span>Approve it now</span>
            </label>
          )}
        </fieldset>
      )}

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={send.isPending || !collector || !reason}>
        {send.isPending ? 'Sending…' : mode === 'staff' && canApprove && approveNow ? 'Record and approve' : 'Send the request'}
      </Button>
    </form>
  );
}

export function ChoiceCard({ checked, onSelect, title, hint, warn = false }: { checked: boolean; onSelect: () => void; title: string; hint?: string; warn?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onSelect}
      className={cn('min-h-12 flex-1 rounded-xl border px-4 py-2 text-start transition-colors', checked ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:bg-accent')}>
      <span className="block text-sm font-semibold text-foreground"><bdi>{title}</bdi></span>
      {hint && <span className={cn('block text-xs', warn ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>{hint}</span>}
    </button>
  );
}
