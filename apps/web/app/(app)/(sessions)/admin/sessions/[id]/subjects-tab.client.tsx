'use client';

/**
 * The Subjects tab is the links sheet (F6a, docs/features/SESSION_WORDS.md; RESERVATIONS_REWORK.md
 * §4.2). The spreadsheet version: the school's links sheet — one row per subject, its board, who
 * teaches it this cycle ("ONLINE ONLY", an external team, or "Retake (Self Study ONLY)") and the
 * link to its Google Form, whose questions say what a family may enter ("All Papers", "One paper
 * ONLY", "2nd entry only", "Carry forward on June"). Here a row reads as that subject's form would:
 * teachers, the entry options in the forms' words, the course fee with the self-study share, the
 * board fee. A row opens the subject's form — one form, in the form's order, one Save — and
 * "Preview the family's form" shows what a family then sees for it.
 *
 * The screen speaks the forms' words; the request carries the model's values. Every phrase here and
 * the field and value it stands for are in the mapping table of SESSION_WORDS.md §2.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse, itemDisplayLabel, sessionSeriesMonths, IGCSE_NEVER_MONTHS, ROLES, type Availability, type SeriesMonth,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { fetchTeachers, useCatalogue, MONTH_LABEL } from '~/app/(app)/exams/exams-shared';
import { ReservePreview, useRefundTerms } from '~/components/reservations/reserve';
import {
  fetchOffers, fetchAddable, fetchSessions, fetchPreview, offersKey, previewKey, SESSIONS_KEY, Money, Modal, Drawer, Field, INPUT_CLASS, TEXTAREA_CLASS,
  ErrorLine, errorText, CopySummary, type SessionDetail, type OfferRow, type ItemRow, type AddableRow, type OffersData,
} from '../sessions-shared';

type Shares = OffersData['shares'];
type Mode = 'in_school' | 'online';
type TeacherPick = { teacherId: string; mode: Mode };

const LEVEL_GROUPS: { key: string; title: string; levels: string[] }[] = [
  { key: 'ol', title: 'O.L.', levels: ['igcse'] },
  { key: 'as', title: 'A.S. / A.L.', levels: ['as_level', 'a_level'] },
];

// ─── The forms' words (SESSION_WORDS.md §2: each phrase → the model's value) ─

/** (b) Offered as: the subject's availability. */
const OFFERED_AS: { value: Availability; label: string; hint: string }[] = [
  { value: 'open', label: 'First entry and retakes', hint: 'Taught this cycle: a first entry, a retake in school, a retake in self study.' },
  { value: 'retake_only', label: 'Retakes only', hint: '2nd entry only: a retake in school or in self study.' },
  { value: 'self_study_only', label: 'Retake (Self Study ONLY)', hint: 'Not taught this cycle: self study at the self-study share of the course fee.' },
  { value: 'closed', label: 'Not offered this cycle', hint: 'Families do not see it.' },
];
/** (d) One paper only: a paper's availability (a one-paper item takes retakes only). */
function paperChoices(current: string): { value: Availability; label: string }[] {
  return [
    { value: 'closed', label: 'Not offered' },
    { value: current === 'open' ? 'open' : 'retake_only', label: 'Retake in school or self study' },
    { value: 'self_study_only', label: 'Retake self study only' },
  ];
}
/** (e) A route, a qualification: offered or not. */
function routeChoices(current: string): { value: Availability; label: string }[] {
  return [
    { value: 'open', label: 'Offered' },
    ...(current === 'retake_only' ? [{ value: 'retake_only' as const, label: 'Retakes only' }] : []),
    { value: 'self_study_only', label: 'Self study only' },
    { value: 'closed', label: 'Not offered' },
  ];
}
/** (e) An IAL unit: taught by its teachers, self study only, or not this cycle. */
function unitChoices(current: string): { value: Availability; label: string }[] {
  return [
    { value: 'open', label: 'Taught by' },
    ...(current === 'retake_only' ? [{ value: 'retake_only' as const, label: 'Retakes only' }] : []),
    { value: 'self_study_only', label: 'Self study only' },
    { value: 'closed', label: 'Not this cycle' },
  ];
}

const WARNING_LABEL: Record<string, string> = {
  no_teacher: 'Who teaches it?', no_fee: 'Board fee not set', series_without_dates: 'Dates not set', unmapped: "Set its papers on the Catalogue",
};

/** A paper's name as the forms write it: "Paper 4 (0610/41)". */
function paperName(i: ItemRow): { name: string; code: string | null } {
  const u = i.units[0];
  if (!u) return { name: itemDisplayLabel(i), code: null };
  return u.shortCode ? { name: u.shortCode, code: u.code } : { name: u.code, code: null };
}
/** A Cambridge route as the forms write it: A.S. · A.2. (carry forward) · A.L. */
function routeWord(i: ItemRow, long = false): string {
  if (i.qualification?.level === 'as_level') return 'A.S.';
  if (i.needsPriorSeries) return long ? 'A.2. (carry forward on an earlier June or November)' : 'A.2. (carry forward)';
  return 'A.L.';
}
const ROUTE_ORDER = (i: ItemRow) => (i.qualification?.level === 'as_level' ? 0 : i.needsPriorSeries ? 1 : 2);

/** What the form shows under (d) and (e). */
function sections(o: OfferRow) {
  const qualificationItems = o.items.filter((i) => i.kind === 'qualification');
  return {
    papers: o.items.filter((i) => i.kind === 'one_paper'),
    routes: o.items.filter((i) => i.kind === 'route').sort((a, b) => ROUTE_ORDER(a) - ROUTE_ORDER(b)),
    units: o.items.filter((i) => i.kind === 'unit'),
    // Two qualifications under one subject (Arabic A Level, Edexcel): the whole item is the first of them.
    qualifications: qualificationItems.length ? o.items.filter((i) => i.kind === 'qualification' || i.kind === 'whole') : [],
  };
}

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

export default function SubjectsTab({ session, viewerRole }: { session: SessionDetail; viewerRole: string }): React.JSX.Element {
  const canEdit = (viewerRole === ROLES.ADMIN || viewerRole === ROLES.COORDINATOR) && session.status !== 'closed';
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: offersKey(session.id), queryFn: () => fetchOffers(session.id) });
  const [drawer, setDrawer] = useState<{ offerId: string } | { addable: AddableRow } | null>(null);
  const [adding, setAdding] = useState(false);
  const [copying, setCopying] = useState(false);
  const [previewing, setPreviewing] = useState<OfferRow | null>(null);
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;
  const provisional = data.offers.some((o) => o.items.some((i) => i.availability !== 'closed' && i.boardFee.provisional));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground"><span>{data.offers.length}</span> <span>{data.offers.length === 1 ? 'subject' : 'subjects'}</span></p>
        {canEdit && data.offers.length > 0 && (
          <div className="flex gap-2">
            {viewerRole === ROLES.ADMIN && <Button variant="outline" onClick={() => setCopying(true)}>Copy from…</Button>}
            <Button onClick={() => setAdding(true)}>Add subject</Button>
          </div>
        )}
      </div>
      {data.offers.length === 0 ? (
        <EmptySheet session={session} canEdit={canEdit} isAdmin={viewerRole === ROLES.ADMIN} onAdd={() => setAdding(true)} />
      ) : (
        LEVEL_GROUPS.map((g) => {
          const rows = data.offers.filter((o) => g.levels.includes(o.subject.qualificationLevel));
          if (!rows.length) return null;
          return (
            <section key={g.key} aria-label={g.title}>
              <h3 className="mb-2 font-mono text-sm font-semibold text-muted-foreground"><bdi>{g.title}</bdi></h3>
              <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
                <table className="w-full min-w-[960px] text-sm">
                  <thead className="border-b border-border bg-muted/40 text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="w-48 px-3 py-2 text-start font-medium">Subject</th>
                      <th className="w-28 px-3 py-2 text-start font-medium">Board</th>
                      <th className="w-44 px-3 py-2 text-start font-medium">Teachers</th>
                      <th className="px-3 py-2 text-start font-medium">What the form offers</th>
                      <th className="w-36 px-3 py-2 text-end font-medium">Course fee</th>
                      <th className="w-28 px-3 py-2 text-end font-medium">Board fee</th>
                      <th className="w-20 px-3 py-2 text-end font-medium">Reservations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => <SheetRow key={o.id} o={o} shares={data.shares} onOpen={() => setDrawer({ offerId: o.id })} onPreview={() => setPreviewing(o)} />)}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
      {provisional && (
        <p className="text-xs text-muted-foreground"><Badge tone="info">not published yet</Badge> <span>The board has not published this fee yet: families can reserve, not pay, until it is confirmed on the Fees tab.</span></p>
      )}
      {drawer && (
        <SubjectDrawer session={session} data={data} target={drawer} canEdit={canEdit} onClose={() => setDrawer(null)}
          onCreated={(offerId) => setDrawer({ offerId })} onPreview={(o) => setPreviewing(o)} />
      )}
      {adding && <AddSubject session={session} onClose={() => setAdding(false)} onPick={(a) => { setAdding(false); setDrawer({ addable: a }); }} />}
      {copying && <CopyFrom session={session} onClose={() => setCopying(false)} />}
      {previewing && <PreviewFamilyForm session={session} offer={previewing} onClose={() => setPreviewing(null)} />}
    </div>
  );
}

/** The sheet of a session started empty: "Copy from <last session of this kind>" first, then "Add subjects". */
function EmptySheet({ session, canEdit, isAdmin, onAdd }: { session: SessionDetail; canEdit: boolean; isAdmin: boolean; onAdd: () => void }) {
  const queryClient = useQueryClient();
  const { data: sessions } = useQuery({ queryKey: [...SESSIONS_KEY, 'admin'], queryFn: fetchSessions });
  const last = (sessions ?? []).filter((s) => s.id !== session.id && s.sessionType === session.sessionType && s.summary.offers > 0)
    .sort((a, b) => b.seriesYear - a.seriesYear || String(b.startDate).localeCompare(String(a.startDate)))[0] ?? null;
  const copy = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id']['copy-from'].$post({ param: { id: session.id }, json: { fromSessionId: last!.id } })),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: offersKey(session.id) }), queryClient.invalidateQueries({ queryKey: SESSIONS_KEY })]); },
  });
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
      <h3 className="font-display text-lg font-semibold text-foreground">No subjects on this sheet yet</h3>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">Bring last cycle&apos;s subjects with their teachers and fees, then change what differs; or add the subjects one by one.</p>
      <ErrorLine message={copy.error ? errorText(copy.error) : null} />
      {copy.data && <div className="mx-auto mt-3 max-w-xl text-start"><CopySummary copied={copy.data} /></div>}
      {canEdit && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {isAdmin && last && (
            <Button onClick={() => copy.mutate()} disabled={copy.isPending}>
              <span>Copy from</span><bdi>{last.name}</bdi>
            </Button>
          )}
          <Button variant={isAdmin && last ? 'outline' : 'default'} onClick={onAdd}>Add subjects</Button>
        </div>
      )}
    </div>
  );
}

// ─── A row of the links sheet ────────────────────────────────────────────────

function TeacherNames({ teachers }: { teachers: { teacherId: string; name: string; kind: string; mode: string }[] }) {
  return (
    <>
      {teachers.map((t, i) => (
        <span key={t.teacherId}>
          {i > 0 && ' · '}<bdi data-i18n-skip="true">{t.name}</bdi>
          {t.mode === 'online' && <> <span className="text-xs font-semibold text-muted-foreground">(ONLINE ONLY)</span></>}
          {t.kind === 'provider' && <> <span className="text-xs text-muted-foreground">(External)</span></>}
        </span>
      ))}
    </>
  );
}

/** "All papers: first entry 100% · retake in school 100% · retake self study 50%", and the rest of the row's entry options. */
function FormPhrases({ o, shares }: { o: OfferRow; shares: Shares }) {
  if (o.availability === 'closed') {
    return o.teachers.length ? <span className="text-muted-foreground">Not offered this cycle</span> : <Badge tone="warning">Who teaches it?</Badge>;
  }
  const s = sections(o);
  const parts: React.ReactNode[] = [];
  const whole = o.items.find((i) => i.kind === 'whole' && i.availability !== 'closed');
  const ssShare = pct(shares.selfStudyCoursePercent);
  if (o.availability === 'self_study_only') parts.push(<span key="ss" className="font-medium">Retake (Self Study ONLY)</span>);
  if (whole && !s.qualifications.length) {
    const retakeOnly = o.availability === 'retake_only' || whole.availability === 'retake_only';
    const ssOnly = o.availability === 'self_study_only' || whole.availability === 'self_study_only';
    parts.push(
      <span key="whole">
        <span>All papers:</span>{' '}
        {ssOnly ? <><span>self study</span> <span dir="ltr">{ssShare}</span></> : (
          <>
            {!retakeOnly && <><span>first entry</span> <span dir="ltr">100%</span> · </>}
            <span>retake in school</span> <span dir="ltr">{pct(shares.retakeTaughtCoursePercent)}</span> · <span>retake self study</span> <span dir="ltr">{ssShare}</span>
          </>
        )}
      </span>,
    );
  }
  for (const p of s.papers.filter((i) => i.availability !== 'closed')) {
    const n = paperName(p);
    parts.push(
      <span key={p.id}>
        <bdi data-i18n-skip="true">{n.name}</bdi> <span>only</span>{n.code && <> <span className="font-mono text-xs text-muted-foreground">(<bdi data-i18n-skip="true">{n.code}</bdi>)</span></>}:{' '}
        <span>{p.availability === 'self_study_only' || o.availability === 'self_study_only' ? 'self study only' : 'in school or self study'}</span>
      </span>,
    );
  }
  for (const r of s.routes.filter((i) => i.availability !== 'closed')) {
    parts.push(<span key={r.id}><span>{routeWord(r)}</span>{r.availability === 'self_study_only' && <> <span className="text-muted-foreground">(self study only)</span></>}</span>);
  }
  for (const u of s.units.filter((i) => i.availability !== 'closed')) {
    const code = u.units[0]?.shortCode ?? u.units[0]?.code ?? itemDisplayLabel(u);
    const teachers = u.teachers.length ? u.teachers : o.teachers;
    parts.push(
      <span key={u.id}>
        <bdi data-i18n-skip="true">{code}</bdi>{' '}
        {u.availability === 'self_study_only' || o.availability === 'self_study_only'
          ? <span className="text-muted-foreground">(self study only)</span>
          : <span className="text-muted-foreground">(<bdi data-i18n-skip="true">{teachers.map((t) => t.name).join(' / ')}</bdi>{teachers.some((t) => t.mode === 'online') && <>, <span>online</span></>})</span>}
      </span>,
    );
  }
  for (const q of s.qualifications.filter((i) => i.availability !== 'closed')) {
    const teachers = q.teachers.length ? q.teachers : o.teachers;
    parts.push(
      <span key={q.id}>
        <bdi data-i18n-skip="true">{q.qualification ? `${q.qualification.title} (${q.qualification.code})` : itemDisplayLabel(q)}</bdi>{' '}
        <span className="text-muted-foreground">(<bdi data-i18n-skip="true">{teachers.map((t) => t.name).join(' / ')}</bdi>)</span>
      </span>,
    );
  }
  if (!parts.length) return <span className="text-muted-foreground">—</span>;
  return <>{parts.map((p, i) => <span key={i}>{i > 0 && ' · '}{p}</span>)}</>;
}

function SheetRow({ o, shares, onOpen, onPreview }: { o: OfferRow; shares: Shares; onOpen: () => void; onPreview: () => void }) {
  const main = o.items.find((i) => i.kind === 'whole' && i.availability !== 'closed') ?? o.items.find((i) => i.availability !== 'closed') ?? o.items[0];
  const share = Math.round(o.courseFee * shares.selfStudyCoursePercent) / 100;
  const warnings = o.warnings.filter((w) => !(w === 'no_teacher' && o.availability === 'closed'));
  return (
    <tr className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30" onClick={onOpen}>
      <td className="px-3 py-3 align-top">
        <button type="button" className="text-start font-medium text-foreground hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
          <bdi data-i18n-skip="true">{o.subject.name}</bdi>
        </button>
        <div className="mt-1 flex flex-wrap gap-1">
          {o.grade10Core && <Badge tone="neutral">Grade 10 core</Badge>}
          {o.availability === 'retake_only' && <Badge tone="info">2nd entry only</Badge>}
          {warnings.map((w) => <Badge key={w} tone="warning">{WARNING_LABEL[w] ?? w}</Badge>)}
        </div>
        <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={(e) => { e.stopPropagation(); onPreview(); }}>Preview the family&apos;s form</button>
      </td>
      <td className="px-3 py-3 align-top text-xs text-muted-foreground"><bdi data-i18n-skip="true">{o.subject.boardName}</bdi></td>
      <td className="px-3 py-3 align-top">{o.teachers.length ? <TeacherNames teachers={o.teachers} /> : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-3 py-3 align-top"><FormPhrases o={o} shares={shares} /></td>
      <td className="px-3 py-3 text-end align-top">
        <Money amount={o.courseFee} />
        {o.courseFee > 0 && <div className="whitespace-nowrap text-xs text-muted-foreground"><span>self study</span> <span dir="ltr">{pct(shares.selfStudyCoursePercent)}</span>: <Money amount={share} /></div>}
      </td>
      <td className="px-3 py-3 text-end align-top">
        {!main || main.boardFee.missing ? <span className="text-muted-foreground">not set yet</span> : (
          <>
            <Money amount={main.boardFee.amount} />
            {main.boardFee.provisional && <div className="text-xs text-muted-foreground">not published yet</div>}
          </>
        )}
      </td>
      <td className="px-3 py-3 text-end align-top tabular-nums">{o.lines}</td>
    </tr>
  );
}

// ─── The subject's form ──────────────────────────────────────────────────────

/** (a) Teachers this cycle: the subject's pool with a tick each, "online only" per teacher; every teacher on request. */
function TeacherPicker({ value, onChange, pool, compact }: {
  value: TeacherPick[]; onChange: (v: TeacherPick[]) => void; pool: string[]; compact?: boolean;
}) {
  const { data: teachers } = useQuery({ queryKey: ['teachers'], queryFn: fetchTeachers });
  // A subject nobody has taught yet has an empty pool: every teacher is shown at once (one click fewer).
  const [showAll, setShowAll] = useState(pool.length === 0);
  const list = (teachers ?? []).filter((t) => t.isActive !== false);
  const shown = showAll ? list : list.filter((t) => pool.includes(t.id) || value.some((v) => v.teacherId === t.id));
  return (
    <div className="space-y-2">
      <div className={`${compact ? 'max-h-36' : 'max-h-56'} space-y-1 overflow-y-auto rounded-lg border border-border p-2`}>
        {shown.length === 0 && <p className="px-1 text-sm text-muted-foreground">{"No teacher in this subject's pool yet."}</p>}
        {shown.map((t) => {
          const picked = value.find((v) => v.teacherId === t.id);
          return (
            <div key={t.id} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-muted/40">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!picked} onChange={(e) => onChange(e.target.checked ? [...value, { teacherId: t.id, mode: 'in_school' }] : value.filter((v) => v.teacherId !== t.id))} />
                <bdi data-i18n-skip="true">{t.name}</bdi>
                {t.kind === 'provider' && <Badge tone="neutral">External team</Badge>}
              </label>
              {picked && (
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input type="checkbox" checked={picked.mode === 'online'} onChange={(e) => onChange(value.map((v) => v.teacherId === t.id ? { ...v, mode: e.target.checked ? 'online' : 'in_school' } : v))} />
                  <span>online only</span>
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

type ItemState = { availability: Availability; courseFee: string; teachers: TeacherPick[]; seriesMonth: SeriesMonth | '' };
type FormState = {
  teachers: TeacherPick[];
  teams: { providerName: string; mode: Mode }[];
  availability: Availability;
  courseFee: string;
  zeroReason: string;
  items: Record<string, ItemState>;
  papers: Record<string, { availability: Availability; courseFee: string }>;
  grade10Core: boolean;
  courseStartsOn: string;
  notes: string;
  linesStand: boolean;
  reason: string;
};

const asMode = (m: string): Mode => (m === 'online' ? 'online' : 'in_school');
const feeText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

function stateOf(o: OfferRow): FormState {
  return {
    teachers: o.teachers.map((t) => ({ teacherId: t.teacherId, mode: asMode(t.mode) })),
    teams: [],
    availability: o.availability as Availability,
    courseFee: String(o.courseFee),
    zeroReason: '',
    items: Object.fromEntries(o.items.map((i) => [i.id, {
      availability: i.availability as Availability, courseFee: feeText(i.courseFee),
      teachers: i.teachers.map((t) => ({ teacherId: t.teacherId, mode: asMode(t.mode) })),
      seriesMonth: (i.series?.month as SeriesMonth | undefined) ?? '',
    }])),
    papers: Object.fromEntries(o.papersToAdd.map((p) => [p.unitId, { availability: 'closed' as Availability, courseFee: '' }])),
    grade10Core: o.grade10Core,
    courseStartsOn: o.courseStartsOn ?? '',
    notes: o.notes ?? '',
    linesStand: false,
    reason: '',
  };
}

function newState(a: AddableRow): FormState {
  return {
    teachers: a.teachers.length === 1 ? [{ teacherId: a.teachers[0]!.teacherId, mode: 'in_school' }] : [],
    teams: [], availability: 'open', courseFee: a.courseFee > 0 ? String(a.courseFee) : '', zeroReason: '',
    items: {}, papers: {}, grade10Core: false, courseStartsOn: '', notes: '', linesStand: false, reason: '',
  };
}

/** The drawer: one subject's form (an existing row, or a subject being added), saved whole. */
function SubjectDrawer({ session, data, target, canEdit, onClose, onCreated, onPreview }: {
  session: SessionDetail; data: OffersData; target: { offerId: string } | { addable: AddableRow }; canEdit: boolean;
  onClose: () => void; onCreated: (offerId: string) => void; onPreview: (o: OfferRow) => void;
}) {
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const offer = 'offerId' in target ? data.offers.find((o) => o.id === target.offerId) ?? null : null;
  const addable = 'addable' in target ? target.addable : null;
  if ('offerId' in target && !offer) return null;
  const title = offer ? offer.subject.name : addable!.name;
  const subtitle = offer
    ? <><bdi data-i18n-skip="true">{offer.subject.boardName}</bdi> · <bdi data-i18n-skip="true" className="font-mono">{offer.subject.code}</bdi> · <span>{offer.lines}</span> <span>{offer.lines === 1 ? 'reservation' : 'reservations'}</span></>
    : <><span>Add subject</span> · <bdi data-i18n-skip="true" className="font-mono">{addable!.code}</bdi></>;
  return (
    <Drawer title={title} subtitle={subtitle} onClose={onClose}>
      {saved && <Notice tone="success">{saved}</Notice>}
      <SubjectForm key={`${offer?.id ?? addable!.id}:${version}`} session={session} shares={data.shares} offer={offer} addable={addable} canEdit={canEdit}
        onSaved={(message, createdId) => {
          setSaved(message);
          setVersion((v) => v + 1);
          if (createdId) onCreated(createdId);
        }}
        onPreview={onPreview} onRemoved={onClose} />
    </Drawer>
  );
}

function SubjectForm({ session, shares, offer, addable, canEdit, onSaved, onPreview, onRemoved }: {
  session: SessionDetail; shares: Shares; offer: OfferRow | null; addable: AddableRow | null; canEdit: boolean;
  onSaved: (message: string, createdId?: string) => void; onPreview: (o: OfferRow) => void; onRemoved: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: catalogue } = useCatalogue();
  const [f, setF] = useState<FormState>(() => (offer ? stateOf(offer) : newState(addable!)));
  const [team, setTeam] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const set = (patch: Partial<FormState>) => setF((x) => ({ ...x, ...patch }));
  const setItem = (id: string, patch: Partial<ItemState>) => setF((x) => ({ ...x, items: { ...x.items, [id]: { ...x.items[id]!, ...patch } } }));
  const level = offer?.subject.qualificationLevel ?? addable!.qualificationLevel;
  const boardCode = offer?.subject.council ?? addable!.council;
  const board = (catalogue?.boards ?? []).find((b) => b.code === boardCode);
  const s = offer ? sections(offer) : { papers: [], routes: [], units: [], qualifications: [] };
  const fee = f.courseFee === '' ? null : Number(f.courseFee);
  const share = fee !== null ? Math.round(fee * shares.selfStudyCoursePercent) / 100 : null;
  // MO-9: self-study only at 0 says why, once (an offer already so keeps its reason).
  const asksZeroReason = f.availability === 'self_study_only' && fee === 0 && !(offer && offer.availability === 'self_study_only' && !(offer.courseFee > 0));
  const pool = [...new Set([...(offer?.teachers.map((t) => t.teacherId) ?? []), ...(addable?.teachers.map((t) => t.teacherId) ?? []), ...f.teachers.map((t) => t.teacherId)])];
  // The sittings a unit may be entered in: the session's months its board sits.
  const months = sessionSeriesMonths(session.sessionType, session.seriesYear).filter((m) => !board || board.seriesMonths.includes(m.month));

  // "Its N reservations stand": what this save would stop while it has reservations.
  const closing: { name: string; n: number }[] = [];
  if (offer && f.availability === 'closed' && offer.availability !== 'closed' && offer.lines > 0) closing.push({ name: offer.subject.name, n: offer.lines });
  for (const i of offer?.items ?? []) {
    const st = f.items[i.id];
    if (st && st.availability === 'closed' && i.availability !== 'closed' && i.lines.live > 0) closing.push({ name: `${offer!.subject.name} — ${itemDisplayLabel(i)}`, n: i.lines.live });
  }
  const reserved = closing.reduce((a, c) => a + c.n, 0);

  const itemRow = (i: ItemRow, withTeachers: boolean, withSitting: boolean) => {
    const st = f.items[i.id]!;
    const out: { itemId: string; availability: Availability; courseFee: number | null; teachers?: TeacherPick[]; seriesMonth?: SeriesMonth } = {
      itemId: i.id, availability: st.availability, courseFee: st.courseFee === '' ? null : Number(st.courseFee),
    };
    if (withTeachers) out.teachers = st.teachers;
    if (withSitting && st.seriesMonth) out.seriesMonth = st.seriesMonth;
    return out;
  };
  const body = () => ({
    teachers: [...f.teachers, ...f.teams],
    availability: f.availability,
    courseFee: fee ?? 0,
    ...(asksZeroReason ? { zeroFeeReason: f.zeroReason.trim() } : {}),
    items: [
      ...s.papers.map((i) => itemRow(i, false, false)),
      ...s.routes.map((i) => itemRow(i, false, false)),
      ...s.units.map((i) => itemRow(i, true, months.length > 1)),
      ...s.qualifications.map((i) => itemRow(i, true, false)),
      ...Object.entries(f.papers).filter(([, p]) => p.availability !== 'closed')
        .map(([unitId, p]) => ({ paperUnitId: unitId, availability: p.availability, courseFee: p.courseFee === '' ? null : Number(p.courseFee) })),
    ],
    grade10Core: f.grade10Core,
    courseStartsOn: f.courseStartsOn || null,
    notes: f.notes.trim() || null,
    ...(reserved ? { linesStand: f.linesStand } : {}),
    ...(f.reason.trim() ? { reason: f.reason.trim() } : {}),
  });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: offersKey(session.id) }), queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
    queryClient.invalidateQueries({ queryKey: ['sessions', session.id, 'preview'] }),
  ]);
  const save = useMutation({
    mutationFn: async () => {
      if (offer) return { created: null, r: await apiResponse(api.v1.sessions[':id'].offers[':offerId'].form.$put({ param: { id: session.id, offerId: offer.id }, json: body() })) };
      const b = body();
      const made = await apiResponse(api.v1.sessions[':id'].offers.$post({
        param: { id: session.id },
        json: {
          subjectId: addable!.id, availability: b.availability, courseFee: b.courseFee, teachers: b.teachers, grade10Core: b.grade10Core,
          courseStartsOn: b.courseStartsOn, notes: b.notes, ...(asksZeroReason ? { zeroFeeReason: f.zeroReason.trim() } : {}),
        },
      }));
      return { created: made.id, r: null };
    },
    onSuccess: async ({ created, r }) => {
      await refresh();
      if (created) onSaved('Added. Its papers and their fees, if the Catalogue gives it any, can be set below.', created);
      else onSaved(r?.changed ? 'Saved.' : 'Nothing to change.');
    },
  });
  const remove = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].offers[':offerId'].$delete({ param: { id: session.id, offerId: offer!.id } })),
    onSuccess: async () => { await refresh(); onRemoved(); },
  });
  const invalid = fee === null || (asksZeroReason && f.zeroReason.trim().length < 5) || (reserved > 0 && !f.linesStand);
  const ro = !canEdit;

  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate(); }}>
      {/* (a) Teachers this cycle */}
      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">Teachers this cycle</h3>
        {ro ? <p className="text-sm">{offer && offer.teachers.length ? <TeacherNames teachers={offer.teachers} /> : '—'}</p> : (
          <>
            <TeacherPicker value={f.teachers} onChange={(teachers) => set({ teachers })} pool={pool} />
            {f.teams.map((t, i) => (
              <div key={`${t.providerName}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2 py-1 text-sm">
                <span><bdi data-i18n-skip="true">{t.providerName}</bdi> <Badge tone="neutral">External team</Badge></span>
                <span className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input type="checkbox" checked={t.mode === 'online'} onChange={(e) => set({ teams: f.teams.map((x, j) => j === i ? { ...x, mode: e.target.checked ? 'online' : 'in_school' } : x) })} />
                    <span>online only</span>
                  </label>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => set({ teams: f.teams.filter((_, j) => j !== i) })}>Remove</button>
                </span>
              </div>
            ))}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field label="An external team" htmlFor="sf-team" hint="An outside provider who teaches it, by the name the links sheet gives.">
                  <input id="sf-team" className={INPUT_CLASS} value={team} onChange={(e) => setTeam(e.target.value)} />
                </Field>
              </div>
              <Button type="button" variant="outline" size="sm" className="mb-6" disabled={team.trim().length < 2}
                onClick={() => { set({ teams: [...f.teams, { providerName: team.trim(), mode: 'in_school' }] }); setTeam(''); }}>Add</Button>
            </div>
          </>
        )}
      </section>

      {/* (b) Offered as */}
      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">Offered as</h3>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Offered as">
          {OFFERED_AS.filter((x) => offer || x.value !== 'closed').map((x) => (
            <label key={x.value} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${f.availability === x.value ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <input type="radio" name="offered-as" className="mt-0.5" checked={f.availability === x.value} disabled={ro} onChange={() => set({ availability: x.value })} />
              <span><span className="block font-medium text-foreground">{x.label}</span><span className="block text-xs text-muted-foreground">{x.hint}</span></span>
            </label>
          ))}
        </div>
        {f.availability === 'open' && f.teachers.length + f.teams.length === 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Who teaches it? A subject offered for first entries names its teachers.</p>}
      </section>

      {/* (c) Course fee */}
      <section className="space-y-2">
        <h3 className="font-semibold text-foreground">Course fee</h3>
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-48">
            <Field label="Course fee (EGP)" htmlFor="sf-fee">
              <input id="sf-fee" className={INPUT_CLASS} type="number" min={0} inputMode="decimal" value={f.courseFee} disabled={ro} onChange={(e) => set({ courseFee: e.target.value })} />
            </Field>
          </div>
          {share !== null && (
            <p className="pb-2 text-sm text-muted-foreground">
              <span>Self Study</span> <span dir="ltr">{pct(shares.selfStudyCoursePercent)}</span> <span>School fees:</span> <Money amount={share} />
            </p>
          )}
        </div>
        {asksZeroReason && (
          <Field label="Why the course fee is 0" htmlFor="sf-zero" hint="Self-study only at 0: its lines are priced at the board fee alone.">
            <input id="sf-zero" className={INPUT_CLASS} value={f.zeroReason} disabled={ro} onChange={(e) => set({ zeroReason: e.target.value })} />
          </Field>
        )}
      </section>

      {/* (d) One paper only — an IGCSE subject's papers on the Catalogue */}
      {level === 'igcse' && offer && (
        <section className="space-y-2">
          <h3 className="font-semibold text-foreground">One paper only</h3>
          {s.papers.length === 0 && offer.papersToAdd.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <span>The Catalogue gives this subject no papers yet.</span>{' '}
              <Link href="/exams/catalogue" className="text-primary underline">Set this subject&apos;s papers on the Catalogue</Link>
            </p>
          ) : (
            <div className="space-y-2">
              {s.papers.map((p) => {
                const n = paperName(p);
                const st = f.items[p.id]!;
                return (
                  <PaperLine key={p.id} name={n.name} code={n.code} reservations={p.lines.live} value={st.availability} choices={paperChoices(p.availability)}
                    fee={st.courseFee} subjectFee={fee} ro={ro} onChoice={(availability) => setItem(p.id, { availability })} onFee={(courseFee) => setItem(p.id, { courseFee })} />
                );
              })}
              {offer.papersToAdd.map((p) => {
                const st = f.papers[p.unitId]!;
                return (
                  <PaperLine key={p.unitId} name={p.shortCode ?? p.code} code={p.shortCode ? p.code : null} reservations={0} value={st.availability} choices={paperChoices('closed')}
                    fee={st.courseFee} subjectFee={fee} ro={ro} onChoice={(availability) => set({ papers: { ...f.papers, [p.unitId]: { ...st, availability } } })}
                    onFee={(courseFee) => set({ papers: { ...f.papers, [p.unitId]: { ...st, courseFee } } })} />
                );
              })}
              <p className="text-xs text-muted-foreground">A retake of one paper carries the other papers from the sitting the family names. Its course fee, when empty, is the subject&apos;s.</p>
            </div>
          )}
        </section>
      )}
      {level === 'igcse' && !offer && <p className="text-xs text-muted-foreground">Its papers, if the Catalogue gives it any, are set once it is added.</p>}

      {/* (e) Components: a Cambridge A level's routes, an IAL subject's units, two qualifications */}
      {s.routes.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold text-foreground">Components</h3>
          {s.routes.map((r) => {
            const st = f.items[r.id]!;
            return (
              <div key={r.id} className="grid grid-cols-[1fr_12rem_9rem] items-center gap-3 rounded-lg border border-border p-3 text-sm">
                <span><span className="font-medium">{routeWord(r, true)}</span>{r.qualificationOptionId && r.label !== routeWord(r) && <> <span className="text-xs text-muted-foreground"><bdi data-i18n-skip="true">{r.label}</bdi></span></>}{r.lines.live > 0 && <> · <span className="text-xs text-muted-foreground"><span>{r.lines.live}</span> <span>reserved</span></span></>}</span>
                <select aria-label={routeWord(r)} className={INPUT_CLASS} value={st.availability} disabled={ro} onChange={(e) => setItem(r.id, { availability: e.target.value as Availability })}>
                  {routeChoices(r.availability).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <input aria-label="Its course fee" className={INPUT_CLASS} type="number" min={0} placeholder={fee !== null ? String(fee) : ''} value={st.courseFee} disabled={ro || st.availability === 'closed'} onChange={(e) => setItem(r.id, { courseFee: e.target.value })} />
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">A.2. (carry forward) takes the A.S. result of an earlier June or November sitting, named by the family. A course fee left empty is the subject&apos;s.</p>
        </section>
      )}
      {s.units.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold text-foreground">Units</h3>
          {s.units.map((u) => {
            const st = f.items[u.id]!;
            const code = u.units[0];
            return (
              <div key={u.id} className="space-y-2 rounded-lg border border-border p-3 text-sm">
                <div className="grid grid-cols-[1fr_11rem_9rem] items-center gap-3">
                  <span>
                    <span className="font-medium"><bdi data-i18n-skip="true">{code?.shortCode ?? itemDisplayLabel(u)}</bdi></span>
                    {code && <> <span className="font-mono text-xs text-muted-foreground">(<bdi data-i18n-skip="true">{code.code}</bdi>)</span></>}
                    {u.lines.live > 0 && <> · <span className="text-xs text-muted-foreground"><span>{u.lines.live}</span> <span>reserved</span></span></>}
                  </span>
                  <select aria-label="How this unit is offered" className={INPUT_CLASS} value={st.availability} disabled={ro} onChange={(e) => setItem(u.id, { availability: e.target.value as Availability })}>
                    {unitChoices(u.availability).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <input aria-label="Its course fee" className={INPUT_CLASS} type="number" min={0} placeholder={fee !== null ? String(fee) : ''} value={st.courseFee} disabled={ro || st.availability === 'closed'} onChange={(e) => setItem(u.id, { courseFee: e.target.value })} />
                </div>
                {st.availability === 'open' && !ro && (
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Its teachers (none ticked: the subject&apos;s)</p>
                    <TeacherPicker compact value={st.teachers} onChange={(teachers) => setItem(u.id, { teachers })} pool={[...pool, ...u.teachers.map((t) => t.teacherId)]} />
                  </div>
                )}
                {months.length > 1 && st.availability !== 'closed' && (
                  <div className="flex items-center gap-2">
                    <label htmlFor={`sf-sit-${u.id}`} className="text-xs text-muted-foreground">Sitting</label>
                    <select id={`sf-sit-${u.id}`} className={INPUT_CLASS.replace('w-full', 'w-64')} value={st.seriesMonth} disabled={ro} onChange={(e) => setItem(u.id, { seriesMonth: e.target.value as SeriesMonth })}>
                      {months.filter((m) => !(code?.level === 'igcse' && IGCSE_NEVER_MONTHS.includes(m.month))).map((m) => (
                        <option key={m.month} value={m.month}>{`${board?.name ?? ''} ${MONTH_LABEL[m.month]} ${m.year}`}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            );
          })}
          {offer && s.units.some((u) => f.items[u.id]!.seriesMonth !== ((u.series?.month as string | undefined) ?? '') && u.lines.live > 0) && (
            <Field label="Reason" htmlFor="sf-reason" hint="A unit moved to another sitting takes its reservations with it; the reason is kept with each.">
              <input id="sf-reason" className={INPUT_CLASS} value={f.reason} onChange={(e) => set({ reason: e.target.value })} />
            </Field>
          )}
        </section>
      )}
      {s.qualifications.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-semibold text-foreground">Qualifications</h3>
          {s.qualifications.map((q) => {
            const st = f.items[q.id]!;
            return (
              <div key={q.id} className="space-y-2 rounded-lg border border-border p-3 text-sm">
                <div className="grid grid-cols-[1fr_11rem_9rem] items-center gap-3">
                  <span className="font-medium"><bdi data-i18n-skip="true">{q.qualification ? `${q.qualification.title} (${q.qualification.code})` : itemDisplayLabel(q)}</bdi></span>
                  <select aria-label="How this qualification is offered" className={INPUT_CLASS} value={st.availability} disabled={ro} onChange={(e) => setItem(q.id, { availability: e.target.value as Availability })}>
                    {routeChoices(q.availability).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <input aria-label="Its course fee" className={INPUT_CLASS} type="number" min={0} placeholder={fee !== null ? String(fee) : ''} value={st.courseFee} disabled={ro || st.availability === 'closed'} onChange={(e) => setItem(q.id, { courseFee: e.target.value })} />
                </div>
                {st.availability === 'open' && !ro && (
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Its teacher (the family chooses the qualification with the teacher)</p>
                    <TeacherPicker compact value={st.teachers} onChange={(teachers) => setItem(q.id, { teachers })} pool={[...pool, ...q.teachers.map((t) => t.teacherId)]} />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* (f) Grade 10 core (June only), (g) course starts, (h) notes */}
      <section className="grid gap-3 sm:grid-cols-2">
        {session.sessionType === 'june' && (
          <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
            <input type="checkbox" checked={f.grade10Core} disabled={ro} onChange={(e) => set({ grade10Core: e.target.checked })} />
            <span>Grade 10 core</span>
          </label>
        )}
        <Field label="Course starts (if not the session's)" htmlFor="sf-start">
          <input id="sf-start" className={INPUT_CLASS} type="date" value={f.courseStartsOn} disabled={ro} onChange={(e) => set({ courseStartsOn: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes" htmlFor="sf-notes">
            <textarea id="sf-notes" className={`${TEXTAREA_CLASS} min-h-16`} value={f.notes} disabled={ro} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
      </section>

      {closing.length > 0 && (
        <Notice tone="warning">
          {closing.map((c) => (
            <p key={c.name}><bdi data-i18n-skip="true">{c.name}</bdi>: <span>{c.n === 1 ? 'it has a reservation: it stands when it is not offered this cycle, and no new one is taken.' : 'its reservations stand when it is not offered this cycle, and no new one is taken.'}</span>{c.n > 1 && <> (<span>{c.n}</span>)</>}</p>
          ))}
          <label className="mt-2 flex items-center gap-2 font-medium">
            <input type="checkbox" checked={f.linesStand} onChange={(e) => set({ linesStand: e.target.checked })} />
            <span>{reserved === 1 ? 'Its reservation stands' : <><span>Its</span> <span>{reserved}</span> <span>reservations stand</span></>}</span>
          </label>
        </Notice>
      )}

      <ErrorLine message={save.error ? errorText(save.error) : null} />
      {canEdit && (
        <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card px-6 py-3">
          <div className="flex flex-wrap gap-2">
            {offer && offer.teachers.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => setReplacing(true)}>Replace teacher</Button>}
            {offer && <Button type="button" variant="outline" size="sm" onClick={() => setRemoving(true)}>Remove subject</Button>}
            {offer && <Button type="button" variant="ghost" size="sm" onClick={() => onPreview(offer)}>Preview the family&apos;s form</Button>}
          </div>
          <Button type="submit" disabled={invalid || save.isPending}>{save.isPending ? 'Saving…' : offer ? 'Save' : 'Add subject'}</Button>
        </div>
      )}
      {replacing && offer && <ReplaceTeacher session={session} offer={offer} onClose={() => setReplacing(false)} />}
      {removing && offer && (
        <Modal title="Remove this subject" onClose={() => setRemoving(false)}>
          <div className="space-y-4">
            <p className="text-sm">A subject with reservations cannot be removed: set it to &quot;Not offered this cycle&quot; instead (its reservations stand).</p>
            <ErrorLine message={remove.error ? errorText(remove.error) : null} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRemoving(false)}>Cancel</Button>
              <Button type="button" variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>Remove</Button>
            </div>
          </div>
        </Modal>
      )}
    </form>
  );
}

/** A paper of "One paper only": not offered, a retake in school or self study, or a retake in self study only, with its fee. */
function PaperLine({ name, code, reservations, value, choices, fee, subjectFee, ro, onChoice, onFee }: {
  name: string; code: string | null; reservations: number; value: Availability; choices: { value: Availability; label: string }[];
  fee: string; subjectFee: number | null; ro: boolean; onChoice: (v: Availability) => void; onFee: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_14rem_9rem] items-center gap-3 rounded-lg border border-border p-3 text-sm">
      <span>
        <span className="font-medium"><bdi data-i18n-skip="true">{name}</bdi> <span>only</span></span>
        {code && <> <span className="font-mono text-xs text-muted-foreground">(<bdi data-i18n-skip="true">{code}</bdi>)</span></>}
        {reservations > 0 && <> · <span className="text-xs text-muted-foreground"><span>{reservations}</span> <span>reserved</span></span></>}
      </span>
      <select aria-label="How this paper is offered" className={INPUT_CLASS} value={value} disabled={ro} onChange={(e) => onChoice(e.target.value as Availability)}>
        {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <input aria-label="Its course fee" className={INPUT_CLASS} type="number" min={0} placeholder={subjectFee !== null ? String(subjectFee) : ''} value={fee} disabled={ro || value === 'closed'} onChange={(e) => onFee(e.target.value)} />
    </div>
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
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{"Every reservation, paper and this year's class of the teacher who leaves moves to the other, audited."}</p>
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
        <Field label="Reason" htmlFor="rt-why"><input id="rt-why" className={INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => go.mutate()} disabled={!to || reason.trim().length < 5 || go.isPending}>Replace</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Add a subject, copy from a session, preview ─────────────────────────────

/** "Add subject": the catalogue's subjects not on the sheet yet; picking one opens its form. */
function AddSubject({ session, onClose, onPick }: { session: SessionDetail; onClose: () => void; onPick: (a: AddableRow) => void }) {
  const { data: addable, isLoading } = useQuery({ queryKey: ['sessions', session.id, 'addable'], queryFn: () => fetchAddable(session.id) });
  const [search, setSearch] = useState('');
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (addable ?? []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)).slice(0, 60);
  }, [addable, search]);
  return (
    <Modal title="Add subject" onClose={onClose} wide>
      <div className="space-y-4">
        <Field label="Subject" htmlFor="as-search">
          <input id="as-search" className={INPUT_CLASS} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or code" autoFocus />
        </Field>
        {isLoading ? <LoadingState /> : (
          <div className="max-h-80 overflow-y-auto rounded-lg border border-border" role="listbox" aria-label="Subjects">
            {matches.length === 0 && <p className="p-3 text-sm text-muted-foreground">Every active subject is already on this sheet.</p>}
            {matches.map((a) => (
              <button key={a.id} type="button" role="option" aria-selected={false} onClick={() => onPick(a)}
                className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-start text-sm last:border-0 hover:bg-muted/40">
                <span><bdi data-i18n-skip="true">{a.name}</bdi> <span className="font-mono text-xs text-muted-foreground"><bdi data-i18n-skip="true">{a.code}</bdi></span></span>
                {!a.mapped && <Badge tone="warning">Set its papers on the Catalogue</Badge>}
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button></div>
      </div>
    </Modal>
  );
}

function CopyFrom({ session, onClose }: { session: SessionDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: sessions } = useQuery({ queryKey: [...SESSIONS_KEY, 'admin'], queryFn: fetchSessions });
  const choices = (sessions ?? []).filter((s) => s.id !== session.id && s.sessionType === session.sessionType).sort((a, b) => b.seriesYear - a.seriesYear);
  const [from, setFrom] = useState('');
  const go = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id']['copy-from'].$post({ param: { id: session.id }, json: { fromSessionId: from || choices[0]!.id } })),
    onSuccess: async (r) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: offersKey(session.id) }), queryClient.invalidateQueries({ queryKey: SESSIONS_KEY })]);
      if (!r.closedNoTeacher && !r.closedNoFee.length && !r.zeroFeeSelfStudy.length) onClose();
    },
  });
  const done = go.data && (go.data.closedNoTeacher > 0 || go.data.closedNoFee.length > 0 || go.data.zeroFeeSelfStudy.length > 0) ? go.data : null;
  return (
    <Modal title="Copy subjects from another session" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Its subjects, teachers, papers and course fees come across (the subjects this session has are kept); its board fees come across as not published yet.</p>
        <ErrorLine message={go.error ? errorText(go.error) : null} />
        {done && <CopySummary copied={done} />}
        {choices.length === 0 ? <Notice tone="neutral">No other session of this kind to copy from.</Notice> : (
          <Field label="From" htmlFor="cf-from">
            <select id="cf-from" className={INPUT_CLASS} value={from || choices[0]!.id} onChange={(e) => setFrom(e.target.value)}>
              {choices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {done ? <Button onClick={onClose}>Done</Button> : <Button onClick={() => go.mutate()} disabled={!choices.length || go.isPending}>Copy</Button>}
        </div>
      </div>
    </Modal>
  );
}

/**
 * "Preview the family's form" (F6a): what a family sees for this subject on the Reserve page, from
 * the family read with no student — the subject with its teacher choice, the entry choices, the
 * sitting it follows, the price; the refund policy sentence and the declaration. Read-only.
 */
function PreviewFamilyForm({ session, offer, onClose }: { session: SessionDetail; offer: OfferRow; onClose: () => void }) {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: previewKey(session.id), queryFn: () => fetchPreview(session.id) });
  const terms = useRefundTerms(session.id);
  const shown = data?.offers.find((o) => o.id === offer.id) ?? null;
  return (
    <Modal title="The family's form" onClose={onClose} wide="xl">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          <span>What a family sees for</span> <bdi data-i18n-skip="true" className="font-medium text-foreground">{offer.subject.name}</bdi> <span>on the Reserve page, every choice open. Nothing is reserved from here.</span>
        </p>
        {isLoading ? <LoadingState /> : isError || !data ? <ErrorState onRetry={() => refetch()} /> : !shown ? (
          <Notice tone="neutral">{offer.availability === 'closed' ? 'Not offered this cycle: families do not see it.' : 'Families see nothing of it to reserve: nothing under it is offered.'}</Notice>
        ) : (
          <ReservePreview offer={shown} sittings={data.declarableSittings.filter((x) => x.boardCode === shown.subject.boardCode)} terms={terms} />
        )}
        <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </div>
    </Modal>
  );
}
