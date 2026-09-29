'use client';

/**
 * Rooms (FEATURES_PLAN.md F0a).
 *
 * The spreadsheet version: a rooms sheet, Name | Capacity | Type | Notes,
 * with the equipment typed as free text ("projector, AC", "has PCs"), so
 * nobody can filter for "a lab with a fume cupboard", two rows spell the same
 * room differently, and a room that closes is deleted or struck through and
 * its history goes with it.
 *
 * Here: one grid. The add row sits at the top and keeps the last type,
 * capacity and features, so a corridor of identical classrooms is a name and
 * Enter each. Features are a fixed set of chips (the timetable will match a
 * lesson's needs against them), room names are unique (the API's sentence
 * says so beside the row), rows edit in place (Enter saves, Escape cancels),
 * and a room is taken out of use instead of deleted, so sections and
 * timetables that used it keep their history. Search and the type filter
 * answer "which labs seat 24?" without scrolling.
 */

import { useRef, useState, type RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, ROOM_FEATURES, ROOM_TYPES } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { ACADEMIC_KEY, SELECT_CLASS } from '../calendar/academic-shared';

const fetchRooms = () => apiResponse(api.v1.academic.rooms.$get());
type Room = Awaited<ReturnType<typeof fetchRooms>>[number];
type RoomType = (typeof ROOM_TYPES)[number];
type RoomFeature = (typeof ROOM_FEATURES)[number];

const TYPE_LABEL: Record<RoomType, string> = {
  classroom: 'Classroom',
  science_lab: 'Science lab',
  computer_lab: 'Computer lab',
  hall: 'Hall',
  library: 'Library',
  art_room: 'Art room',
  sports: 'Sports',
  other: 'Other',
};

const FEATURE_LABEL: Record<RoomFeature, string> = {
  projector: 'Projector',
  smartboard: 'Smartboard',
  computers: 'Computers',
  lab_benches: 'Lab benches',
  fume_cupboard: 'Fume cupboard',
  air_conditioning: 'Air conditioning',
  wheelchair_access: 'Wheelchair access',
};

const isRoomType = (t: string): t is RoomType => (ROOM_TYPES as readonly string[]).includes(t);
const isFeature = (f: string): f is RoomFeature => (ROOM_FEATURES as readonly string[]).includes(f);

type Draft = { name: string; capacity: string; type: RoomType; features: RoomFeature[]; notes: string };

const emptyDraft: Draft = { name: '', capacity: '', type: 'classroom', features: [], notes: '' };

function draftOf(r: Room): Draft {
  return {
    name: r.name,
    capacity: r.capacity === null ? '' : String(r.capacity),
    type: isRoomType(r.type) ? r.type : 'other',
    features: r.features.filter(isFeature),
    notes: r.notes ?? '',
  };
}

/** The draft as the API takes it, or the sentence saying what is missing. */
function toInput(d: Draft) {
  if (!d.name.trim()) return 'Name the room.';
  const capacity = d.capacity.trim() === '' ? null : Number(d.capacity);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000)) return 'Capacity is a whole number of seats, 1 to 1000.';
  return { name: d.name.trim(), capacity, type: d.type, features: d.features, notes: d.notes.trim() || null };
}

const byName = (a: Room, b: Room) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, undefined, { numeric: true });

export default function RoomsClient(): React.JSX.Element {
  const { data: rooms, isLoading, isError, refetch } = useQuery({ queryKey: ['academic', 'rooms'], queryFn: fetchRooms });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | RoomType>('all');
  const [editingId, setEditingId] = useState<string | null>(null);

  const all = [...(rooms ?? [])].sort(byName);
  const q = search.trim().toLowerCase();
  const shown = all.filter((r) => (typeFilter === 'all' || r.type === typeFilter) && (!q || r.name.toLowerCase().includes(q) || (r.notes ?? '').toLowerCase().includes(q)));
  const inUse = all.filter((r) => r.isActive);
  const seats = inUse.reduce((sum, r) => sum + (r.capacity ?? 0), 0);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-up">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Rooms</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every teaching space, with its seats and equipment. Sections take a homeroom from here, and the timetable will place lessons by type and features.
          </p>
        </div>
        {rooms && rooms.length > 0 && (
          <dl className="flex gap-6 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">In use</dt>
              <dd className="text-xl font-bold tabular-nums text-foreground">{inUse.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Seats in use</dt>
              <dd className="text-xl font-bold tabular-nums text-foreground">{seats}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Out of use</dt>
              <dd className="text-xl font-bold tabular-nums text-foreground">{all.length - inUse.length}</dd>
            </div>
          </dl>
        )}
      </header>

      {isLoading ? (
        <LoadingState label="Loading the rooms…" />
      ) : isError ? (
        <ErrorState title="The rooms did not load" message="This is a connection problem, not an empty list. Try again before adding rooms." onRetry={() => refetch()} />
      ) : (
        <>
          {all.length > 0 && (
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="room-search" className="mb-1 text-xs text-muted-foreground">Search</Label>
                <Input id="room-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Room name or notes" className="w-64" />
              </div>
              <div>
                <Label htmlFor="room-type-filter" className="mb-1 text-xs text-muted-foreground">Type</Label>
                <select id="room-type-filter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'all' | RoomType)} className={cn(SELECT_CLASS, 'w-48')}>
                  <option value="all">All types</option>
                  {ROOM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              {(q || typeFilter !== 'all') && (
                <p className="pb-2.5 text-sm text-muted-foreground">
                  <span>{shown.length}</span> <span>of</span> <span>{all.length}</span> <span>rooms</span>
                </p>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="border-b border-border bg-muted">
                <tr>
                  <th scope="col" className="w-48 px-3 py-2 text-start font-semibold text-muted-foreground">Name</th>
                  <th scope="col" className="w-24 px-3 py-2 text-start font-semibold text-muted-foreground">Capacity</th>
                  <th scope="col" className="w-40 px-3 py-2 text-start font-semibold text-muted-foreground">Type</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Features</th>
                  <th scope="col" className="w-48 px-3 py-2 text-start font-semibold text-muted-foreground">Notes</th>
                  <th scope="col" className="w-28 px-3 py-2 text-start font-semibold text-muted-foreground">In use</th>
                  <th scope="col" className="w-44 px-3 py-2 text-end font-semibold text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <AddRoomRow />
                {shown.map((r) =>
                  editingId === r.id ? (
                    <EditRoomRow key={r.id} room={r} onDone={() => setEditingId(null)} />
                  ) : (
                    <RoomRow key={r.id} room={r} onEdit={() => setEditingId(r.id)} />
                  ),
                )}
              </tbody>
            </table>
          </div>
          {all.length === 0 && (
            <div className="mt-6">
              <EmptyState title="No rooms yet" message="Type the first room's name in the row above and press Enter. The type, capacity and features stay for the next one." />
            </div>
          )}
          {all.length > 0 && shown.length === 0 && (
            <p className="mt-4 text-center text-sm text-muted-foreground">No room matches the search.</p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Features as chips ───────────────────────────────────────────────────────

function FeaturePicker({ value, onChange }: { value: RoomFeature[]; onChange: (v: RoomFeature[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Features">
      {ROOM_FEATURES.map((f) => {
        const on = value.includes(f);
        return (
          <button
            key={f}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== f) : [...value, f])}
            className={cn(
              'h-9 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
              on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {FEATURE_LABEL[f]}
          </button>
        );
      })}
    </div>
  );
}

function DraftCells({
  formId, draft, setDraft, nameRef, autoFocus,
}: {
  formId: string;
  draft: Draft;
  setDraft: (d: Draft) => void;
  nameRef?: RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
}) {
  return (
    <>
      <td className="px-3 py-2 align-top">
        <Input form={formId} ref={nameRef} aria-label="Room name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={60} placeholder="e.g. Room 101" autoFocus={autoFocus} />
      </td>
      <td className="px-3 py-2 align-top">
        <Input form={formId} aria-label="Capacity" type="number" min={1} max={1000} inputMode="numeric" value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} placeholder="30" />
      </td>
      <td className="px-3 py-2 align-top">
        <select form={formId} aria-label="Type" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as RoomType })} className={SELECT_CLASS}>
          {ROOM_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 align-top">
        <FeaturePicker value={draft.features} onChange={(features) => setDraft({ ...draft, features })} />
      </td>
      <td className="px-3 py-2 align-top">
        <Input form={formId} aria-label="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} maxLength={500} />
      </td>
    </>
  );
}

// ─── The add row ─────────────────────────────────────────────────────────────

function AddRoomRow() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const create = useMutation({
    mutationFn: (json: Exclude<ReturnType<typeof toInput>, string>) => apiResponse(api.v1.academic.rooms.$post({ json })),
    onSuccess: (room, sent) => {
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
      // The next room is usually like this one: keep its type, capacity and
      // features. Clear only what was sent: the next name may already be typed.
      setDraft((d) => (d.name.trim() === sent.name ? { ...d, name: '', notes: '' } : d));
      setError('');
      setAdded(room.name);
      nameRef.current?.focus();
    },
    onError: (err: Error) => {
      setAdded(null);
      setError(err.message);
    },
  });

  return (
    <>
      <tr className="bg-primary/5">
        <DraftCells formId="add-room" draft={draft} setDraft={setDraft} nameRef={nameRef} autoFocus />
        <td className="px-3 py-2 align-top">
          <Badge tone="success">In use</Badge>
        </td>
        <td className="px-3 py-2 text-end align-top">
          <form
            id="add-room"
            onSubmit={(e) => {
              e.preventDefault();
              const input = toInput(draft);
              if (typeof input === 'string') return setError(input);
              setError('');
              create.mutate(input);
            }}
          >
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add the room'}
            </Button>
          </form>
        </td>
      </tr>
      {(error || added) && (
        <tr className="bg-primary/5">
          <td colSpan={7} className="px-3 pb-3">
            {error ? (
              <Notice tone="danger">{error}</Notice>
            ) : (
              <p className="text-xs text-muted-foreground">
                <span>Added</span> <bdi className="font-semibold text-foreground">{added}</bdi>
                <span>. Type the next room&apos;s name and press Enter.</span>
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── A room ──────────────────────────────────────────────────────────────────

function RoomRow({ room, onEdit }: { room: Room; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const toggle = useMutation({
    mutationFn: () => apiResponse(api.v1.academic.rooms[':id'].$put({ param: { id: room.id }, json: { isActive: !room.isActive } })),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <>
      <tr className={cn(!room.isActive && 'bg-muted/40 text-muted-foreground')}>
        <td className="px-3 py-2.5 font-medium text-foreground">{room.name}</td>
        <td className="px-3 py-2.5 tabular-nums">{room.capacity ?? <span className="text-muted-foreground">—</span>}</td>
        <td className="px-3 py-2.5">{isRoomType(room.type) ? TYPE_LABEL[room.type] : room.type}</td>
        <td className="px-3 py-2.5">
          {room.features.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {room.features.map((f) => (
                <li key={f}>
                  <Badge tone="neutral">{isFeature(f) ? FEATURE_LABEL[f] : f}</Badge>
                </li>
              ))}
            </ul>
          )}
        </td>
        <td className="px-3 py-2.5 text-card-foreground">{room.notes ?? <span className="text-muted-foreground">—</span>}</td>
        <td className="px-3 py-2.5">
          <Badge tone={room.isActive ? 'success' : 'neutral'}>{room.isActive ? 'In use' : 'Out of use'}</Badge>
        </td>
        <td className="px-3 py-2.5 text-end">
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
            <Button variant="ghost" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
              {room.isActive ? 'Take out of use' : 'Put back in use'}
            </Button>
          </div>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={7} className="px-3 pb-3">
            <Notice tone="danger">{error}</Notice>
          </td>
        </tr>
      )}
    </>
  );
}

function EditRoomRow({ room, onDone }: { room: Room; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftOf(room));
  const [error, setError] = useState('');
  const formId = `edit-room-${room.id}`;
  const save = useMutation({
    mutationFn: (json: Exclude<ReturnType<typeof toInput>, string>) => apiResponse(api.v1.academic.rooms[':id'].$put({ param: { id: room.id }, json })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACADEMIC_KEY });
      onDone();
    },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <>
      <tr className="bg-muted/40" onKeyDown={(e) => e.key === 'Escape' && onDone()}>
        <DraftCells formId={formId} draft={draft} setDraft={setDraft} autoFocus />
        <td className="px-3 py-2 align-top">
          <Badge tone={room.isActive ? 'success' : 'neutral'}>{room.isActive ? 'In use' : 'Out of use'}</Badge>
        </td>
        <td className="px-3 py-2 text-end align-top">
          <form
            id={formId}
            className="flex justify-end gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const input = toInput(draft);
              if (typeof input === 'string') return setError(input);
              setError('');
              save.mutate(input);
            }}
          >
            <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={save.isPending}>Cancel</Button>
            <Button type="submit" size="sm" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          </form>
        </td>
      </tr>
      {error && (
        <tr className="bg-muted/40">
          <td colSpan={7} className="px-3 pb-3">
            <Notice tone="danger">{error}</Notice>
          </td>
        </tr>
      )}
    </>
  );
}
