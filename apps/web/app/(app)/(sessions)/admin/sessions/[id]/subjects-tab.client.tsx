'use client';

/**
 * The Subjects tab (RESERVATIONS_REWORK.md §4.2): one row per subject the session offers — its
 * board, its teachers, what can be entered (the items), the course fee and the board fee — and a
 * drawer per row. Adding a subject is three inputs for an IGCSE subject (the subject, its
 * teachers, the course fee); the items and their series come from the catalogue. Who teaches it
 * is picked from the subject's pool (or any teacher, who then joins the pool).
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse, seriesAcademicYearStart, ROLES, AVAILABILITIES, ITEM_KIND_LABELS, ITEM_KINDS, type Availability, type ItemKind,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { fetchBoardSeries, fetchTeachers } from '~/app/(app)/exams/exams-shared';
import {
  fetchOffers, fetchAddable, fetchSessions, offersKey, SESSIONS_KEY, Money, Modal, Drawer, Field, INPUT_CLASS, ErrorLine, errorText,
  AVAILABILITY_SHORT, type SessionDetail, type OfferRow, type ItemRow,
} from '../sessions-shared';

const WARNING_LABEL: Record<string, string> = {
  no_teacher: 'No teacher', no_fee: 'No board fee', series_without_dates: 'Series has no dates', unmapped: 'Map on the Catalogue',
};
const LEVEL_GROUPS: { key: string; title: string; levels: string[] }[] = [
  { key: 'ol', title: 'O.L.', levels: ['igcse'] },
  { key: 'as', title: 'A.S. / A.L.', levels: ['as_level', 'a_level'] },
];

function useSeriesChoices(session: SessionDetail) {
  const ay = seriesAcademicYearStart(session.sessionType, session.seriesYear);
  const { data } = useQuery({ queryKey: ['board-series', ay], queryFn: () => fetchBoardSeries(ay) });
  return (boardCode: string) => (data ?? []).filter((b) => b.boardCode === boardCode && session.months.some((m) => m.month === b.month && m.year === b.year));
}

export default function SubjectsTab({ session, viewerRole }: { session: SessionDetail; viewerRole: string }): React.JSX.Element {
  const canEdit = (viewerRole === ROLES.ADMIN || viewerRole === ROLES.COORDINATOR) && session.status !== 'closed';
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: offersKey(session.id), queryFn: () => fetchOffers(session.id) });
  const [openOffer, setOpenOffer] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [copying, setCopying] = useState(false);
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;
  const offer = data.offers.find((o) => o.id === openOffer) ?? null;
  const provisional = data.offers.some((o) => o.items.some((i) => i.availability !== 'closed' && i.boardFee.provisional));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground"><span>{data.offers.length}</span> <span>{data.offers.length === 1 ? 'subject' : 'subjects'}</span></p>
        {canEdit && (
          <div className="flex gap-2">
            {viewerRole === ROLES.ADMIN && <Button variant="outline" onClick={() => setCopying(true)}>Copy from…</Button>}
            <Button onClick={() => setAdding(true)}>Add subject</Button>
          </div>
        )}
      </div>
      {data.offers.length === 0 ? (
        <EmptyState title="No subjects in this session yet" message="Add the subjects the school offers this cycle, or copy them from the last session of this kind." />
      ) : (
        LEVEL_GROUPS.map((g) => {
          const rows = data.offers.filter((o) => g.levels.includes(o.subject.qualificationLevel));
          if (!rows.length) return null;
          return (
            <section key={g.key} aria-label={g.title}>
              <h3 className="mb-2 font-mono text-sm font-semibold text-muted-foreground"><bdi>{g.title}</bdi></h3>
              <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/40 text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-start font-medium">Subject</th>
                      <th className="px-4 py-2 text-start font-medium">Board</th>
                      <th className="px-4 py-2 text-start font-medium">Teachers</th>
                      <th className="px-4 py-2 text-start font-medium">What can be entered</th>
                      <th className="px-4 py-2 text-end font-medium">Course fee</th>
                      <th className="px-4 py-2 text-end font-medium">Board fee</th>
                      <th className="px-4 py-2 text-end font-medium">Lines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => <OfferLine key={o.id} o={o} onOpen={() => setOpenOffer(o.id)} />)}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
      {provisional && (
        <p className="text-xs text-muted-foreground"><Badge tone="info">provisional</Badge> <span>The board has not published this fee yet: families can reserve, not pay, until it is confirmed on the Fees tab.</span></p>
      )}
      {offer && <OfferDrawer session={session} offer={offer} canEdit={canEdit} onClose={() => setOpenOffer(null)} />}
      {adding && <AddSubject session={session} onClose={() => setAdding(false)} />}
      {copying && <CopyFrom session={session} onClose={() => setCopying(false)} />}
    </div>
  );
}

function OfferLine({ o, onOpen }: { o: OfferRow; onOpen: () => void }) {
  const open = o.items.filter((i) => i.availability !== 'closed');
  const main = open[0] ?? o.items[0];
  return (
    <tr className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30" onClick={onOpen}>
      <td className="px-4 py-3 align-top">
        <button type="button" className="text-start font-medium text-foreground hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
          <bdi data-i18n-skip="true">{o.subject.name}</bdi>
        </button>
        <div className="mt-1 flex flex-wrap gap-1">
          {o.availability !== 'open' && <Badge tone={o.availability === 'closed' ? 'neutral' : 'info'}>{AVAILABILITY_SHORT[o.availability] ?? o.availability}</Badge>}
          {o.grade10Core && <Badge tone="neutral">Grade 10 core</Badge>}
          {o.warnings.map((w) => <Badge key={w} tone="warning">{WARNING_LABEL[w] ?? w}</Badge>)}
        </div>
      </td>
      <td className="px-4 py-3 align-top text-muted-foreground">{o.subject.boardName}</td>
      <td className="px-4 py-3 align-top">
        {o.teachers.length ? o.teachers.map((t, i) => (
          <span key={t.teacherId}>{i > 0 && ' · '}<bdi data-i18n-skip="true">{t.name}</bdi>{t.mode === 'online' && <> <span className="text-muted-foreground">(online)</span></>}</span>
        )) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3 align-top">
        {o.items.map((i, n) => (
          <span key={i.id} className={i.availability === 'closed' ? 'text-muted-foreground line-through' : ''}>
            {n > 0 && ' · '}<bdi>{i.label}</bdi>
            {i.availability === 'retake_only' && <> <span className="text-muted-foreground">(retake)</span></>}
            {i.availability === 'self_study_only' && <> <span className="text-muted-foreground">(self-study)</span></>}
          </span>
        ))}
      </td>
      <td className="px-4 py-3 text-end align-top"><Money amount={o.courseFee} /></td>
      <td className="px-4 py-3 text-end align-top">
        {main?.boardFee.missing ? <Badge tone="warning">No fee</Badge> : (
          <span className="inline-flex items-center gap-1"><Money amount={main?.boardFee.amount ?? null} />{main?.boardFee.provisional && <Badge tone="info">provisional</Badge>}</span>
        )}
      </td>
      <td className="px-4 py-3 text-end align-top tabular-nums">{o.lines}</td>
    </tr>
  );
}

// ─── The drawer ──────────────────────────────────────────────────────────────

function TeacherPicker({ value, onChange, pool }: {
  value: { teacherId: string; mode: 'in_school' | 'online' }[];
  onChange: (v: { teacherId: string; mode: 'in_school' | 'online' }[]) => void;
  pool: string[];
}) {
  const { data: teachers } = useQuery({ queryKey: ['teachers'], queryFn: fetchTeachers });
  const [showAll, setShowAll] = useState(false);
  const list = (teachers ?? []).filter((t) => t.isActive !== false);
  const shown = showAll ? list : list.filter((t) => pool.includes(t.id) || value.some((v) => v.teacherId === t.id));
  return (
    <div className="space-y-2">
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
        {shown.length === 0 && <p className="px-1 text-sm text-muted-foreground">{"No teacher in this subject's pool yet."}</p>}
        {shown.map((t) => {
          const picked = value.find((v) => v.teacherId === t.id);
          return (
            <div key={t.id} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-muted/40">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!picked} onChange={(e) => onChange(e.target.checked ? [...value, { teacherId: t.id, mode: 'in_school' }] : value.filter((v) => v.teacherId !== t.id))} />
                <bdi data-i18n-skip="true">{t.name}</bdi>
              </label>
              {picked && (
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input type="checkbox" checked={picked.mode === 'online'} onChange={(e) => onChange(value.map((v) => v.teacherId === t.id ? { ...v, mode: e.target.checked ? 'online' : 'in_school' } : v))} />
                  <span>online</span>
                </label>
              )}
            </div>
          );
        })}
      </div>
      <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowAll((x) => !x)}>
        {showAll ? 'Show this subject\'s teachers only' : 'Show every teacher'}
      </button>
    </div>
  );
}

function OfferDrawer({ session, offer, canEdit, onClose }: { session: SessionDetail; offer: OfferRow; canEdit: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: offersKey(session.id) }), queryClient.invalidateQueries({ queryKey: SESSIONS_KEY })]);
  const [availability, setAvailability] = useState<Availability>(offer.availability as Availability);
  const [courseFee, setCourseFee] = useState(String(offer.courseFee));
  const [courseStartsOn, setCourseStartsOn] = useState(offer.courseStartsOn ?? '');
  const [grade10Core, setGrade10Core] = useState(offer.grade10Core);
  const [notes, setNotes] = useState(offer.notes ?? '');
  const [teachers, setTeachers] = useState(offer.teachers.map((t) => ({ teacherId: t.teacherId, mode: (t.mode === 'online' ? 'online' : 'in_school') as 'in_school' | 'online' })));
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const save = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].offers[':offerId'].$put({
      param: { id: session.id, offerId: offer.id },
      json: { availability, courseFee: Number(courseFee), courseStartsOn: courseStartsOn || null, grade10Core, notes: notes.trim() || null, teachers },
    })),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].offers[':offerId'].$delete({ param: { id: session.id, offerId: offer.id } })),
    onSuccess: async () => { await refresh(); onClose(); },
  });

  return (
    <Drawer title={offer.subject.name} subtitle={<><span>{offer.subject.boardName}</span> · <bdi data-i18n-skip="true" className="font-mono">{offer.subject.code}</bdi> · <span>{offer.lines}</span> <span>live lines</span></>} onClose={onClose}>
      <section className="space-y-3">
        <h3 className="font-semibold text-foreground">This cycle</h3>
        <ErrorLine message={save.error ? errorText(save.error) : null} />
        {save.isSuccess && !save.isPending && <Notice tone="success">Saved.</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Availability" htmlFor="od-avail" hint="Closing stops new lines; the lines already made stand.">
            <select id="od-avail" className={INPUT_CLASS} value={availability} disabled={!canEdit} onChange={(e) => setAvailability(e.target.value as Availability)}>
              {AVAILABILITIES.map((a) => <option key={a} value={a}>{AVAILABILITY_SHORT[a]}</option>)}
            </select>
          </Field>
          <Field label="Course fee" htmlFor="od-fee">
            <input id="od-fee" className={INPUT_CLASS} type="number" min={0} inputMode="decimal" value={courseFee} disabled={!canEdit} onChange={(e) => setCourseFee(e.target.value)} />
          </Field>
          <Field label="Course starts (if not the session's)" htmlFor="od-start">
            <input id="od-start" className={INPUT_CLASS} type="date" value={courseStartsOn} disabled={!canEdit} onChange={(e) => setCourseStartsOn(e.target.value)} />
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={grade10Core} disabled={!canEdit} onChange={(e) => setGrade10Core(e.target.checked)} />
            <span>Grade 10 core</span>
          </label>
        </div>
        <Field label="Teachers">
          {canEdit ? <TeacherPicker value={teachers} onChange={setTeachers} pool={offer.teachers.map((t) => t.teacherId)} /> : (
            <p className="text-sm">{offer.teachers.map((t) => t.name).join(' · ') || '—'}</p>
          )}
        </Field>
        <Field label="Notes" htmlFor="od-notes">
          <textarea id="od-notes" className="min-h-16 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" value={notes} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {canEdit && (
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex gap-2">
              {offer.teachers.length > 0 && <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>Replace teacher</Button>}
              <Button variant="outline" size="sm" onClick={() => setRemoving(true)}>Remove subject</Button>
            </div>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !courseFee}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">What can be entered</h3>
          {canEdit && <Button variant="outline" size="sm" onClick={() => setAddingItem(true)}>Add an item</Button>}
        </div>
        {offer.items.map((i) => <ItemCard key={i.id} session={session} offer={offer} item={i} canEdit={canEdit} />)}
      </section>

      {replacing && <ReplaceTeacher session={session} offer={offer} onClose={() => setReplacing(false)} />}
      {removing && (
        <Modal title="Remove this subject" onClose={() => setRemoving(false)}>
          <div className="space-y-4">
            <p className="text-sm">A subject with lines cannot be removed: close it instead (its lines stand).</p>
            <ErrorLine message={remove.error ? errorText(remove.error) : null} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRemoving(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>Remove</Button>
            </div>
          </div>
        </Modal>
      )}
      {addingItem && <AddItem session={session} offer={offer} onClose={() => setAddingItem(false)} />}
    </Drawer>
  );
}

function SeriesSelect({ session, boardCode, value, onChange, disabled, id }: { session: SessionDetail; boardCode: string; value: string; onChange: (v: string) => void; disabled?: boolean; id: string }) {
  const choices = useSeriesChoices(session)(boardCode);
  return (
    <select id={id} className={INPUT_CLASS} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {!choices.some((c) => c.id === value) && value && <option value={value}>—</option>}
      {choices.map((c) => <option key={c.id} value={c.id} data-i18n-skip="true">{c.name}</option>)}
    </select>
  );
}

function ItemCard({ session, offer, item, canEdit }: { session: SessionDetail; offer: OfferRow; item: ItemRow; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: offersKey(session.id) }), queryClient.invalidateQueries({ queryKey: SESSIONS_KEY })]);
  const [series, setSeries] = useState(item.boardSeriesId ?? '');
  const [availability, setAvailability] = useState<Availability>(item.availability as Availability);
  const [courseFee, setCourseFee] = useState(item.courseFee === null ? '' : String(item.courseFee));
  const [group, setGroup] = useState(item.exclusiveGroup ?? '');
  const [required, setRequired] = useState(item.requiredInSeries);
  const [reason, setReason] = useState('');
  const [unticking, setUnticking] = useState(false);
  const save = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$put({
      param: { id: session.id, offerId: offer.id, itemId: item.id },
      json: {
        ...(series && series !== item.boardSeriesId ? { boardSeriesId: series } : {}),
        availability, courseFee: courseFee === '' ? null : Number(courseFee), exclusiveGroup: group.trim() || null, requiredInSeries: required,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      },
    })),
    onSuccess: refresh,
  });
  const untick = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].offers[':offerId'].items[':itemId'].$delete({ param: { id: session.id, offerId: offer.id, itemId: item.id } })),
    onSuccess: async () => { setUnticking(false); await refresh(); },
  });
  const movesLines = series !== (item.boardSeriesId ?? '') && item.lines.live > 0;
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground"><bdi>{item.label}</bdi></span>
          {ITEM_KIND_LABELS[item.kind as ItemKind] !== item.label && <Badge tone="neutral">{ITEM_KIND_LABELS[item.kind as ItemKind] ?? item.kind}</Badge>}
          {item.units.map((u) => <Badge key={u.unitId} tone="neutral" className="font-mono"><bdi data-i18n-skip="true">{u.code}</bdi></Badge>)}
        </div>
        <span className="text-xs text-muted-foreground"><span>{item.lines.live}</span> <span>live lines</span> · <span>board fee</span> {item.boardFee.missing ? <Badge tone="warning">No fee</Badge> : <><Money amount={item.boardFee.amount} />{item.boardFee.provisional && <> <Badge tone="info">provisional</Badge></>}</>}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Series" htmlFor={`it-s-${item.id}`} hint={item.series && !item.series.reservable ? 'This series has no dates yet: it takes no reservation until they are set.' : undefined}>
          <SeriesSelect id={`it-s-${item.id}`} session={session} boardCode={offer.subject.council} value={series} onChange={setSeries} disabled={!canEdit} />
        </Field>
        <Field label="Availability" htmlFor={`it-a-${item.id}`}>
          <select id={`it-a-${item.id}`} className={INPUT_CLASS} value={availability} disabled={!canEdit} onChange={(e) => setAvailability(e.target.value as Availability)}>
            {AVAILABILITIES.map((a) => <option key={a} value={a}>{AVAILABILITY_SHORT[a]}</option>)}
          </select>
        </Field>
        <Field label="Course fee (if not the subject's)" htmlFor={`it-f-${item.id}`}>
          <input id={`it-f-${item.id}`} className={INPUT_CLASS} type="number" min={0} inputMode="decimal" value={courseFee} placeholder={String(offer.courseFee)} disabled={!canEdit} onChange={(e) => setCourseFee(e.target.value)} />
        </Field>
        <Field label="Only one of the group" htmlFor={`it-g-${item.id}`} hint="Items with the same group cannot be reserved together.">
          <input id={`it-g-${item.id}`} className={INPUT_CLASS} value={group} disabled={!canEdit} onChange={(e) => setGroup(e.target.value)} />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={required} disabled={!canEdit} onChange={(e) => setRequired(e.target.checked)} />
        <span>A first entry of the subject in this series includes it</span>
      </label>
      {canEdit && movesLines && (
        <div className="mt-3 space-y-2">
          <Notice tone="warning"><span>{item.lines.live}</span> <span>lines move with it to the new series, each audited.</span></Notice>
          <Field label="Why" htmlFor={`it-r-${item.id}`}><input id={`it-r-${item.id}`} className={INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      )}
      <ErrorLine message={save.error ? errorText(save.error) : untick.error ? errorText(untick.error) : null} />
      {canEdit && (
        <div className="mt-3 flex justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => setUnticking(true)}>Untick</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save item'}</Button>
        </div>
      )}
      {unticking && (
        <Modal title="Untick this item" onClose={() => setUnticking(false)}>
          <div className="space-y-4">
            <p className="text-sm">An item with live lines cannot be unticked: move or drop them first. With only history, it is closed and kept.</p>
            <ErrorLine message={untick.error ? errorText(untick.error) : null} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setUnticking(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => untick.mutate()} disabled={untick.isPending}>Untick</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AddItem({ session, offer, onClose }: { session: SessionDetail; offer: OfferRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<ItemKind>('one_paper');
  const [series, setSeries] = useState(offer.items.find((i) => i.boardSeriesId)?.boardSeriesId ?? '');
  const [availability, setAvailability] = useState<Availability>('retake_only');
  const [courseFee, setCourseFee] = useState('');
  const add = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].offers[':offerId'].items.$post({
      param: { id: session.id, offerId: offer.id },
      json: { label: label.trim(), kind, enters: { kind: 'subject' }, boardSeriesId: series || null, availability, courseFee: courseFee === '' ? null : Number(courseFee), requiredInSeries: false },
    })),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: offersKey(session.id) }); onClose(); },
  });
  return (
    <Modal title="Add an item" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <ErrorLine message={add.error ? errorText(add.error) : null} />
        <Field label="Label" htmlFor="ai-label"><input id="ai-label" className={INPUT_CLASS} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Paper 4 only (retake)" required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind" htmlFor="ai-kind">
            <select id="ai-kind" className={INPUT_CLASS} value={kind} onChange={(e) => setKind(e.target.value as ItemKind)}>
              {ITEM_KINDS.map((k) => <option key={k} value={k}>{ITEM_KIND_LABELS[k]}</option>)}
            </select>
          </Field>
          <Field label="Availability" htmlFor="ai-avail">
            <select id="ai-avail" className={INPUT_CLASS} value={availability} onChange={(e) => setAvailability(e.target.value as Availability)}>
              {AVAILABILITIES.map((a) => <option key={a} value={a}>{AVAILABILITY_SHORT[a]}</option>)}
            </select>
          </Field>
          <Field label="Series" htmlFor="ai-series"><SeriesSelect id="ai-series" session={session} boardCode={offer.subject.council} value={series} onChange={setSeries} /></Field>
          <Field label="Course fee (if not the subject's)" htmlFor="ai-fee"><input id="ai-fee" className={INPUT_CLASS} type="number" min={0} value={courseFee} placeholder={String(offer.courseFee)} onChange={(e) => setCourseFee(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-muted-foreground">Its board fee is read for the subject row; an item entering a unit or an award is made from the catalogue when the subject is added.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!label.trim() || add.isPending}>Add</Button>
        </div>
      </form>
    </Modal>
  );
}

function ReplaceTeacher({ session, offer, onClose }: { session: SessionDetail; offer: OfferRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: teachers } = useQuery({ queryKey: ['teachers'], queryFn: fetchTeachers });
  const [from, setFrom] = useState(offer.teachers[0]?.teacherId ?? '');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const go = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].offers[':offerId']['replace-teacher'].$post({
      param: { id: session.id, offerId: offer.id }, json: { fromTeacherId: from, toTeacherId: to, reason: reason.trim() },
    })),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: offersKey(session.id) }); onClose(); },
  });
  return (
    <Modal title="Replace a teacher" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); go.mutate(); }}>
        <p className="text-sm text-muted-foreground">{"Every line, item and this year's class of the teacher who leaves moves to the other, audited."}</p>
        <ErrorLine message={go.error ? errorText(go.error) : null} />
        <Field label="Who leaves" htmlFor="rt-from">
          <select id="rt-from" className={INPUT_CLASS} value={from} onChange={(e) => setFrom(e.target.value)}>
            {offer.teachers.map((t) => <option key={t.teacherId} value={t.teacherId} data-i18n-skip="true">{t.name}</option>)}
          </select>
        </Field>
        <Field label="Who takes over" htmlFor="rt-to">
          <select id="rt-to" className={INPUT_CLASS} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose…</option>
            {(teachers ?? []).filter((t) => t.id !== from && t.isActive !== false).map((t) => <option key={t.id} value={t.id} data-i18n-skip="true">{t.name}</option>)}
          </select>
        </Field>
        <Field label="Why" htmlFor="rt-why"><input id="rt-why" className={INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!to || reason.trim().length < 5 || go.isPending}>Replace</Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Add a subject, copy from a session ─────────────────────────────────────

function AddSubject({ session, onClose }: { session: SessionDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: addable, isLoading } = useQuery({ queryKey: ['sessions', session.id, 'addable'], queryFn: () => fetchAddable(session.id) });
  const [search, setSearch] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [teachers, setTeachers] = useState<{ teacherId: string; mode: 'in_school' | 'online' }[]>([]);
  const [courseFee, setCourseFee] = useState('');
  const [availability, setAvailability] = useState<Availability>('open');
  const picked = (addable ?? []).find((a) => a.id === subjectId);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (addable ?? []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)).slice(0, 40);
  }, [addable, search]);
  const add = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].offers.$post({
      param: { id: session.id }, json: { subjectId, courseFee: Number(courseFee), availability, teachers },
    })),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: offersKey(session.id) }), queryClient.invalidateQueries({ queryKey: SESSIONS_KEY })]);
      onClose();
    },
  });
  return (
    <Modal title="Add a subject" onClose={onClose} wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <ErrorLine message={add.error ? errorText(add.error) : null} />
        <Field label="Subject" htmlFor="as-search">
          <input id="as-search" className={INPUT_CLASS} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or code" />
        </Field>
        {isLoading ? <LoadingState /> : (
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border" role="listbox" aria-label="Subjects">
            {matches.length === 0 && <p className="p-3 text-sm text-muted-foreground">Every active subject is already in this session.</p>}
            {matches.map((a) => (
              <button key={a.id} type="button" role="option" aria-selected={a.id === subjectId}
                onClick={() => { setSubjectId(a.id); setCourseFee(String(a.courseFee)); setTeachers(a.teachers.length === 1 ? [{ teacherId: a.teachers[0]!.teacherId, mode: 'in_school' }] : []); }}
                className={`flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-start text-sm last:border-0 ${a.id === subjectId ? 'bg-primary/10' : 'hover:bg-muted/40'}`}>
                <span><bdi data-i18n-skip="true">{a.name}</bdi> <span className="font-mono text-xs text-muted-foreground"><bdi data-i18n-skip="true">{a.code}</bdi></span></span>
                {!a.mapped && <Badge tone="warning">Map on the Catalogue</Badge>}
              </button>
            ))}
          </div>
        )}
        {picked && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Course fee" htmlFor="as-fee"><input id="as-fee" className={INPUT_CLASS} type="number" min={0} value={courseFee} onChange={(e) => setCourseFee(e.target.value)} /></Field>
              <Field label="Availability" htmlFor="as-avail">
                <select id="as-avail" className={INPUT_CLASS} value={availability} onChange={(e) => setAvailability(e.target.value as Availability)}>
                  {AVAILABILITIES.filter((a) => a !== 'closed').map((a) => <option key={a} value={a}>{AVAILABILITY_SHORT[a]}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Teachers" hint={availability === 'open' ? 'An open subject names who teaches it.' : undefined}>
              <TeacherPicker value={teachers} onChange={setTeachers} pool={picked.teachers.map((t) => t.teacherId)} />
            </Field>
            <p className="text-xs text-muted-foreground">{"What can be entered and its series come from the catalogue; change them on the subject's row after."}</p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!picked || courseFee === '' || add.isPending}>{add.isPending ? 'Adding…' : 'Add subject'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function CopyFrom({ session, onClose }: { session: SessionDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: sessions } = useQuery({ queryKey: [...SESSIONS_KEY, 'admin'], queryFn: fetchSessions });
  const choices = (sessions ?? []).filter((s) => s.id !== session.id && s.sessionType === session.sessionType);
  const [from, setFrom] = useState('');
  const go = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id']['copy-from'].$post({ param: { id: session.id }, json: { fromSessionId: from || choices[0]!.id } })),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: offersKey(session.id) }), queryClient.invalidateQueries({ queryKey: SESSIONS_KEY })]);
      onClose();
    },
  });
  return (
    <Modal title="Copy subjects from another session" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Its subjects, teachers, items and course fees come across (the subjects this session has are kept); its board fees come across provisional.</p>
        <ErrorLine message={go.error ? errorText(go.error) : null} />
        {choices.length === 0 ? <Notice tone="neutral">No other session of this kind to copy from.</Notice> : (
          <Field label="From" htmlFor="cf-from">
            <select id="cf-from" className={INPUT_CLASS} value={from || choices[0]!.id} onChange={(e) => setFrom(e.target.value)}>
              {choices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => go.mutate()} disabled={!choices.length || go.isPending}>Copy</Button>
        </div>
      </div>
    </Modal>
  );
}

