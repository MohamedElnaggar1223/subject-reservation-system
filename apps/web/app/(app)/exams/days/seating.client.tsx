'use client';

/**
 * A sitting's rooms, seating plan and invigilators (docs/features/EXAM_ENTRIES.md
 * §4, "A sitting", "Invigilators").
 *
 * The paper version: the hall drawn on squared paper, candidate numbers
 * pencilled into the desks and rubbed out when someone moves; the rota of
 * invigilators on the staffroom wall, the ratio counted by hand.
 *
 * Here: the rooms and their grids are chosen in one row each; "Seat everyone"
 * previews where each candidate would go before anything is saved; a
 * candidate is moved by clicking them and then a free desk (the API refuses
 * a taken desk and names who sits there); each room shows the invigilators it
 * needs and who is already in another room of the sitting.
 */

import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, seatLabel } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { fetchTeachers, SELECT_CLASS } from '../exams-shared';
import { Code, EXAMS_KEY, type SittingPlan } from '../exam-f4-shared';
import { ArrangementBadges, Name } from '../timetable/timetable-shared';

type PlanRoom = SittingPlan['rooms'][number];
type Occupant = PlanRoom['seats'][number];
type Unseated = SittingPlan['unseated'][number];

const fetchRooms = () => apiResponse(api.v1.academic.rooms.$get());

const numbersOf = (papers: { candidateNumber: string | null }[]) => [...new Set(papers.map((p) => p.candidateNumber).filter((n): n is string => !!n))];

/** The candidates of a sitting: those seated for a paper today and those without a seat. */
function candidateCount(plan: SittingPlan) {
  return plan.rooms.flatMap((r) => r.seats).filter((s) => s.papers.length > 0).length + plan.unseated.length;
}

// ─── Rooms and their grids ───────────────────────────────────────────────────

type RoomDraft = { roomId: string; seatRows: string; seatColumns: string };

export function RoomsEditor({ plan }: { plan: SittingPlan }): React.JSX.Element {
  const signature = plan.rooms.map((r) => `${r.roomId}:${r.seatRows}x${r.seatColumns}`).join('|');
  return <RoomsForm key={signature} plan={plan} />;
}

function RoomsForm({ plan }: { plan: SittingPlan }) {
  const queryClient = useQueryClient();
  const roomsQ = useQuery({ queryKey: [...EXAMS_KEY, 'rooms'], queryFn: fetchRooms });
  const initial: RoomDraft[] = plan.rooms.map((r) => ({ roomId: r.roomId, seatRows: String(r.seatRows), seatColumns: String(r.seatColumns) }));
  const [rows, setRows] = useState<RoomDraft[]>(initial);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const all = roomsQ.data ?? [];
  const nameOf = (id: string) => all.find((r) => r.id === id)?.name ?? plan.rooms.find((r) => r.roomId === id)?.name ?? '';
  const free = all.filter((r) => r.isActive && !rows.some((x) => x.roomId === r.id));
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const seats = rows.reduce((n, r) => n + (Number(r.seatRows) || 0) * (Number(r.seatColumns) || 0), 0);
  const candidates = candidateCount(plan);

  const save = useMutation({
    mutationFn: () => apiResponse(api.v1.exams.sittings.rooms.$put({
      json: {
        examDate: plan.sitting.examDate, session: plan.sitting.session,
        rooms: rows.map((r) => ({ roomId: r.roomId, seatRows: Number(r.seatRows), seatColumns: Number(r.seatColumns) })),
      },
    })),
    onSuccess: () => { setError(''); setSaved(true); queryClient.invalidateQueries({ queryKey: EXAMS_KEY }); },
    onError: (err: Error) => { setSaved(false); setError(err.message); },
  });

  const add = (id: string) => {
    const room = all.find((r) => r.id === id);
    if (!room) return;
    // A first grid from the room's capacity: six desks a row.
    const cap = room.capacity ?? 30;
    const columns = Math.min(6, Math.max(1, cap));
    setRows([...rows, { roomId: id, seatRows: String(Math.min(26, Math.max(1, Math.ceil(cap / columns)))), seatColumns: String(columns) }]);
    setSaved(false);
  };
  const change = (i: number, patch: Partial<RoomDraft>) => { setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); setSaved(false); };

  return (
    <div>
      <h3 className="font-display text-lg font-bold text-foreground">Rooms</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        The rooms this sitting uses and their desks: rows lettered from the front (A, B, C…), desks numbered along each row. A room with candidates in it cannot leave the sitting or shrink under them.
      </p>
      <form
        className="rounded-xl border border-border bg-background p-4"
        onSubmit={(e) => {
          e.preventDefault();
          for (const r of rows) {
            const a = Number(r.seatRows), b = Number(r.seatColumns);
            if (!Number.isInteger(a) || a < 1 || a > 26 || !Number.isInteger(b) || b < 1 || b > 40) {
              return setError('Each room has 1 to 26 rows and 1 to 40 desks a row.');
            }
          }
          save.mutate();
        }}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No room chosen yet. Add the rooms this sitting uses.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r, i) => {
              const inUse = plan.rooms.find((x) => x.roomId === r.roomId)?.seats.length ?? 0;
              const capacity = (Number(r.seatRows) || 0) * (Number(r.seatColumns) || 0);
              return (
                <li key={r.roomId} className="flex flex-wrap items-end gap-3">
                  <p className="min-w-36 pb-2 font-semibold text-foreground"><Name>{nameOf(r.roomId)}</Name></p>
                  <div>
                    <Label htmlFor={`rows-${r.roomId}`} className="mb-1 text-xs text-muted-foreground">Rows</Label>
                    <Input id={`rows-${r.roomId}`} dir="ltr" inputMode="numeric" value={r.seatRows} onChange={(e) => change(i, { seatRows: e.target.value.replace(/[^\d]/g, '') })} className="w-20 tabular-nums" />
                  </div>
                  <div>
                    <Label htmlFor={`cols-${r.roomId}`} className="mb-1 text-xs text-muted-foreground">Desks a row</Label>
                    <Input id={`cols-${r.roomId}`} dir="ltr" inputMode="numeric" value={r.seatColumns} onChange={(e) => change(i, { seatColumns: e.target.value.replace(/[^\d]/g, '') })} className="w-24 tabular-nums" />
                  </div>
                  <p className="pb-2 text-sm text-muted-foreground">
                    <span>Seats</span> <span className="tabular-nums text-foreground">{capacity}</span>
                    {inUse > 0 && <> · <span>seated now</span> <span className="tabular-nums text-foreground">{inUse}</span></>}
                  </p>
                  <Button type="button" variant="ghost" size="sm" className="mb-1" onClick={() => { setRows(rows.filter((_, j) => j !== i)); setSaved(false); }}>Remove</Button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <div>
            <Label htmlFor={`add-room-${plan.sitting.examDate}`} className="mb-1 text-xs text-muted-foreground">Add a room</Label>
            <select id={`add-room-${plan.sitting.examDate}`} value="" onChange={(e) => add(e.target.value)} className={cn(SELECT_CLASS, 'w-56')} disabled={!free.length}>
              <option value="">{roomsQ.isLoading ? 'Loading the rooms…' : free.length ? 'Choose a room…' : 'Every room is in the list'}</option>
              {free.map((r) => <option key={r.id} value={r.id} data-i18n-skip="true">{r.name}{r.capacity ? ` (${r.capacity})` : ''}</option>)}
            </select>
          </div>
          <p className="pb-2 text-sm text-muted-foreground">
            <span>Seats in the rooms</span> <span className="tabular-nums font-semibold text-foreground">{seats}</span>
            {' · '}<span>Candidates</span> <span className="tabular-nums font-semibold text-foreground">{candidates}</span>
          </p>
          {seats < candidates && <Badge tone="danger" className="mb-2">Not enough seats</Badge>}
          <Button type="submit" className="ms-auto" disabled={!dirty || save.isPending}>{save.isPending ? 'Saving…' : 'Save the rooms'}</Button>
        </div>
        {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
        {saved && !error && !dirty && <p className="mt-2 text-xs text-muted-foreground">Saved.</p>}
      </form>
    </div>
  );
}

// ─── Seats ───────────────────────────────────────────────────────────────────

type Selected = { studentId: string; name: string };

export function SeatingSection({ plan }: { plan: SittingPlan }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Selected | null>(null);
  const [error, setError] = useState('');
  const teachersQ = useQuery({ queryKey: [...EXAMS_KEY, 'teachers'], queryFn: fetchTeachers });
  const assign = useMutation({
    mutationFn: (v: { studentId: string; roomId: string; seatLabel: string }) =>
      apiResponse(api.v1.exams.seats.$put({ json: { examDate: plan.sitting.examDate, session: plan.sitting.session, ...v } })),
    onSuccess: () => { setSelected(null); setError(''); queryClient.invalidateQueries({ queryKey: EXAMS_KEY }); },
    onError: (err: Error) => setError(err.message),
  });
  const onSeat = (roomId: string, label: string, occupant: Occupant | undefined) => {
    if (assign.isPending) return;
    if (!selected) {
      if (occupant) { setSelected({ studentId: occupant.studentId, name: occupant.name }); setError(''); }
      return;
    }
    if (occupant?.studentId === selected.studentId) { setSelected(null); return; }
    assign.mutate({ studentId: selected.studentId, roomId, seatLabel: label });
  };
  const pick = (u: Unseated) => { setError(''); setSelected(selected?.studentId === u.studentId ? null : { studentId: u.studentId, name: u.name }); };

  return (
    <div className="mt-8">
      <h3 className="font-display text-lg font-bold text-foreground">Seating plan</h3>
      <p className="mb-3 text-sm text-muted-foreground">Click a candidate — in a desk or in the list of those without a seat — then click a free desk to put them there.</p>

      {selected && (
        <div className="sticky top-2 z-10 mb-3">
          <Notice tone="info">
            <span className="flex flex-wrap items-center gap-2">
              <span>Moving</span> <Name className="font-semibold">{selected.name}</Name><span>: click a free desk.</span>
              <Button size="sm" variant="outline" className="ms-auto" onClick={() => { setSelected(null); setError(''); }}>Cancel</Button>
            </span>
          </Notice>
        </div>
      )}
      {error && <Notice tone="danger" className="mb-3">{error}</Notice>}

      <UnseatedPanel plan={plan} selectedId={selected?.studentId ?? null} onPick={pick} />

      {plan.rooms.length === 0 ? (
        <Notice tone="warning" className="mt-4">Choose the rooms above first; then seat the candidates.</Notice>
      ) : (
        <div className="mt-4 space-y-6">
          {plan.rooms.map((r) => (
            <div key={r.roomId} className="rounded-xl border border-border bg-background p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <p className="flex flex-wrap items-center gap-2">
                  <Name className="text-base font-semibold text-foreground">{r.name}</Name>
                  <Badge tone={r.seats.length >= r.capacity ? 'warning' : 'neutral'}>
                    <span className="tabular-nums">{r.seats.length}</span>/<span className="tabular-nums">{r.capacity}</span>&nbsp;<span>seats taken</span>
                  </Badge>
                </p>
              </div>
              <InvigilatorsEditor
                key={r.invigilators.map((i) => `${i.teacherId}:${i.isLead}`).join('|')}
                plan={plan} room={r} teachers={teachersQ.data ?? []} teachersLoading={teachersQ.isLoading}
              />
              <SeatGrid room={r} selectedId={selected?.studentId ?? null} moving={!!selected} busy={assign.isPending} onSeat={(label, occ) => onSeat(r.roomId, label, occ)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SeatGrid({ room, selectedId, moving, busy, onSeat }: {
  room: PlanRoom; selectedId: string | null; moving: boolean; busy: boolean; onSeat: (label: string, occupant: Occupant | undefined) => void;
}) {
  const byLabel = useMemo(() => new Map(room.seats.map((s) => [s.seatLabel, s])), [room.seats]);
  const rows = Array.from({ length: room.seatRows }, (_, i) => i);
  const cols = Array.from({ length: room.seatColumns }, (_, i) => i);
  return (
    // A room's plan is a map of the room: it reads left to right whatever the language.
    <div className="mt-4 overflow-x-auto pb-1" dir="ltr" data-room-grid={room.roomId}>
      <p className="mb-2 rounded-md bg-muted py-1 text-center text-xs font-medium text-muted-foreground" style={{ minWidth: `${2 + room.seatColumns * 7}rem` }}>Front of the room</p>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `2rem repeat(${room.seatColumns}, minmax(6.5rem, 1fr))` }}>
        <span />
        {cols.map((c) => <span key={c} className="text-center text-xs tabular-nums text-muted-foreground">{c + 1}</span>)}
        {rows.map((r) => (
          <Fragment key={r}>
            <span className="self-center text-center text-sm font-semibold text-muted-foreground">{String.fromCharCode(65 + r)}</span>
            {cols.map((c) => {
              const label = seatLabel(r, c);
              const occ = byLabel.get(label);
              const isSelected = !!occ && occ.studentId === selectedId;
              const numbers = occ ? numbersOf(occ.papers) : [];
              return (
                <button
                  key={label}
                  type="button"
                  data-seat={label}
                  disabled={busy}
                  onClick={() => onSeat(label, occ)}
                  className={cn(
                    'flex min-h-24 flex-col items-start gap-0.5 rounded-lg border p-1.5 text-start text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60',
                    occ ? 'border-border bg-card hover:bg-accent/50' : 'border-dashed border-border bg-muted/30',
                    occ && !occ.papers.length && 'border-amber-300 dark:border-amber-700',
                    isSelected && 'border-primary bg-primary/10 ring-2 ring-primary',
                    moving && !occ && 'hover:border-primary hover:bg-primary/5',
                  )}
                >
                  <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
                  {occ ? (
                    <>
                      <span className="font-mono text-sm font-bold text-foreground">{numbers.length ? numbers.join(' / ') : '—'}</span>
                      <Name className="line-clamp-2 font-medium text-foreground">{occ.name}</Name>
                      {!occ.papers.length && <span className="text-amber-700 dark:text-amber-400">No paper in this sitting</span>}
                      <span className="flex flex-wrap gap-1 font-mono text-[10px] text-muted-foreground" data-i18n-skip="true">{occ.papers.map((p) => <span key={p.id}>{p.code}</span>)}</span>
                      {occ.accessArrangements.length > 0 && <ArrangementBadges list={occ.accessArrangements} className="[&>span]:px-1.5 [&>span]:text-[10px]" />}
                    </>
                  ) : (
                    <span className="mt-auto text-muted-foreground">Empty</span>
                  )}
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// ─── Candidates without a seat ───────────────────────────────────────────────

function UnseatedPanel({ plan, selectedId, onPick }: { plan: SittingPlan; selectedId: string | null; onPick: (u: Unseated) => void }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">
          {plan.unseated.length ? (
            <><span>Without a seat</span> <span className="tabular-nums">{plan.unseated.length}</span></>
          ) : (
            <span>Every candidate has a seat.</span>
          )}
        </p>
        {plan.unseated.length > 0 && plan.rooms.length > 0 && <SeatEveryone plan={plan} />}
      </div>
      {plan.unseated.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {plan.unseated.map((u) => {
            const numbers = numbersOf(u.papers);
            return (
              <li key={u.studentId}>
                <button
                  type="button"
                  onClick={() => onPick(u)}
                  aria-pressed={selectedId === u.studentId}
                  className={cn(
                    'flex min-h-11 flex-col items-start rounded-lg border px-3 py-1.5 text-start text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    selectedId === u.studentId ? 'border-primary bg-primary/10 ring-2 ring-primary' : 'border-border bg-card hover:bg-accent/50',
                  )}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-foreground">{numbers.length ? numbers.join(' / ') : '—'}</span>
                    <Name className="font-medium text-foreground">{u.name}</Name>
                  </span>
                  <span className="flex flex-wrap gap-1 font-mono text-[11px] text-muted-foreground" data-i18n-skip="true">{u.papers.map((p) => <span key={p.id}>{p.code}</span>)}</span>
                  {u.accessArrangements.length > 0 && <ArrangementBadges list={u.accessArrangements} className="mt-1" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const autoSeat = (json: { examDate: string; session: SittingPlan['sitting']['session']; commit: boolean }) => apiResponse(api.v1.exams.sittings.seat.$post({ json }));
type AutoSeatResult = Awaited<ReturnType<typeof autoSeat>>;

function SeatEveryone({ plan }: { plan: SittingPlan }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<AutoSeatResult | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState('');
  const run = useMutation({
    mutationFn: (commit: boolean) => autoSeat({ examDate: plan.sitting.examDate, session: plan.sitting.session, commit }),
    onSuccess: (r) => {
      setError('');
      if (r.committed) {
        setPreview(null);
        setDone(r.assigned.length);
        queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
      } else {
        setDone(null);
        setPreview(r);
      }
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <div className="flex basis-full flex-col items-end gap-2 sm:basis-auto">
      {!preview && (
        <Button onClick={() => run.mutate(false)} disabled={run.isPending}>{run.isPending ? 'Working…' : 'Seat everyone'}</Button>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {done !== null && !preview && (
        <p className="text-xs text-muted-foreground"><span>Seated</span> <span className="tabular-nums">{done}</span><span>.</span></p>
      )}
      {preview && (
        <div className="w-full rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <p className="font-semibold text-foreground">
            <span className="tabular-nums">{preview.assigned.length}</span> <span>{preview.assigned.length === 1 ? 'candidate would be seated:' : 'candidates would be seated:'}</span>
          </p>
          <p className="text-xs text-muted-foreground">Candidates of one paper together, in candidate-number order, row by row. Nothing is saved yet.</p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {preview.assigned.map((a) => (
              <li key={a.studentId} className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{a.number ?? '—'}</span>
                <Name>{a.name}</Name>
                <Code className="text-xs text-muted-foreground">{a.paperCode}</Code>
                <span className="text-muted-foreground">→</span>
                <Name className="font-medium">{a.roomName}</Name>
                <span className="font-mono font-semibold" dir="ltr">{a.seatLabel}</span>
              </li>
            ))}
          </ul>
          {preview.unseated.length > 0 && (
            <Notice tone="warning" className="mt-2">
              <span className="tabular-nums">{preview.unseated.length}</span>{' '}
              <span>{preview.unseated.length === 1 ? 'candidate would still have no seat: add a room or more desks first.' : 'candidates would still have no seat: add a room or more desks first.'}</span>
            </Notice>
          )}
          {preview.separateRoom.length > 0 && (
            <Notice tone="info" className="mt-2" title="A separate room (access arrangement): seat by hand">
              <ul className="mt-1 space-y-0.5">
                {preview.separateRoom.map((s) => (
                  <li key={s.studentId}>
                    <Code>{s.number ?? '—'}</Code> <bdi data-i18n-skip="true">{s.name}</bdi> · <Code>{s.paperCode}</Code>
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setPreview(null)} disabled={run.isPending}>Cancel</Button>
            <Button size="sm" onClick={() => run.mutate(true)} disabled={run.isPending || !preview.assigned.length}>{run.isPending ? 'Seating…' : 'Seat them'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Invigilators ────────────────────────────────────────────────────────────

type TeacherOption = { id: string; name: string };

function InvigilatorsEditor({ plan, room, teachers, teachersLoading }: { plan: SittingPlan; room: PlanRoom; teachers: TeacherOption[]; teachersLoading: boolean }) {
  const queryClient = useQueryClient();
  const initialIds = room.invigilators.map((i) => i.teacherId);
  const initialLead = room.invigilators.find((i) => i.isLead)?.teacherId ?? null;
  const [ids, setIds] = useState<string[]>(initialIds);
  const [lead, setLead] = useState<string | null>(initialLead);
  const [error, setError] = useState('');
  const elsewhere = new Map(plan.rooms.filter((r) => r.roomId !== room.roomId).flatMap((r) => r.invigilators.map((i) => [i.teacherId, r.name] as const)));
  const nameOf = (id: string) => teachers.find((t) => t.id === id)?.name ?? room.invigilators.find((i) => i.teacherId === id)?.name ?? '';
  const dirty = JSON.stringify([...ids].sort()) !== JSON.stringify([...initialIds].sort()) || lead !== initialLead;
  const needed = room.invigilatorsNeeded;
  const save = useMutation({
    mutationFn: () => apiResponse(api.v1.exams.invigilation.$put({
      json: { examDate: plan.sitting.examDate, session: plan.sitting.session, roomId: room.roomId, teacherIds: ids, leadTeacherId: lead && ids.includes(lead) ? lead : null },
    })),
    onSuccess: () => { setError(''); queryClient.invalidateQueries({ queryKey: EXAMS_KEY }); },
    onError: (err: Error) => setError(err.message),
  });
  const available = teachers.filter((t) => !ids.includes(t.id));

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-foreground">Invigilators</p>
        <Badge tone={ids.length < needed ? 'warning' : 'success'}>
          <span className="tabular-nums">{initialIds.length}</span>&nbsp;<span>of</span>&nbsp;<span className="tabular-nums">{needed}</span>&nbsp;<span>needed</span>
        </Badge>
        {initialIds.length < needed && <span className="text-xs text-amber-700 dark:text-amber-400">This room needs more invigilators for its candidates.</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {ids.map((id) => (
          <span key={id} className="inline-flex items-center gap-2 rounded-full border border-border bg-background py-1 ps-3 pe-1 text-sm">
            <Name className="text-foreground">{nameOf(id)}</Name>
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
              <input type="radio" name={`lead-${room.roomId}`} checked={lead === id} onChange={() => setLead(id)} />
              <span>Lead</span>
            </label>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setIds(ids.filter((x) => x !== id)); if (lead === id) setLead(null); }}>Remove</Button>
          </span>
        ))}
        <select
          aria-label="Add an invigilator"
          value=""
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            setIds([...ids, id]);
            if (!lead) setLead(id);
            setError('');
          }}
          className={cn(SELECT_CLASS, 'w-60')}
          disabled={teachersLoading || !available.length}
        >
          <option value="">{teachersLoading ? 'Loading the teachers…' : available.length ? 'Add an invigilator…' : 'No other teacher'}</option>
          {available.map((t) => (
            <option key={t.id} value={t.id} disabled={elsewhere.has(t.id)} data-i18n-skip="true">
              {t.name}{elsewhere.has(t.id) ? ` — ${elsewhere.get(t.id)}` : ''}
            </option>
          ))}
        </select>
        {dirty && (
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save the invigilators'}</Button>
        )}
      </div>
      {error && <Notice tone="danger" className="mt-2">{error}</Notice>}
    </div>
  );
}
