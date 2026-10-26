'use client';

/**
 * The subject editor (COORDINATOR_REWORK.md §5.4; D2–D13, E3–E5; Appendix A
 * `GET/PUT/DELETE /sessions/:id/offerings/:offeringId`, `GET /sessions/:id/preview`). Replaces the old
 * Subjects sheet.
 *
 * The spreadsheet version: a Google Form per subject — its questions typed, its options typed ("Retake
 * Self Study 50% fees"), its teachers typed (six of them spelt two ways in June 2027), the earlier exams
 * typed, its refund box sometimes empty — and its price on another sheet. Here she ticks: the rows the
 * board's list suggests (all papers, a paper, a unit, A.S., A.2., A.L.) against the ways it is studied
 * (first entry in school, retake in school, retake self study; first entry self study under "More
 * options"), the teachers picked from the school's list (a new name checked against it), the earlier
 * exams a retake carries from (ticked from the board's previous two; an older one warned, kept), and
 * reads beside it what a first-time student and a retaker would see. The words families read are made
 * from her ticks (D9); the only text she types that families read is the optional note, a question, or
 * a row not on the list.
 *
 * One Save sends the whole subject; a change that reaches families (a fee, closing the subject) says
 * what it does before it is saved (A3). Saving says her look at the ticks a default made is done
 * (`defaultsReviewed`: she has seen the grid). The preview shows what is saved.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, ROLES } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { Switch } from '~/components/ui/switch';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { cn } from '~/lib/utils';
import { useI18n } from '~/lib/i18n';
import { Money, Modal, ErrorLine, INPUT_CLASS, TEXTAREA_CLASS } from '../../../sessions-shared';
import {
  fetchOffering, fetchSetupSession, fetchTeachers, fetchReferenceBoards, fetchFamilyPreview, offeringKey, setupKey, previewKey,
  TEACHERS_KEY, REFERENCE_BOARDS_KEY, CELLS, CELL_WORDS, subjectTitle, examMonth, monthIndex, pickerValue, endOfSchoolDay,
  useImpactSave, ImpactDialog, refusalText, type CellKey, type SetupSession,
} from '../../../setup-shared';
import { shownCode } from '../../subjects-tab.client';

type OfferingData = Awaited<ReturnType<typeof fetchOffering>>;
type RowData = OfferingData['rows'][number];
type Cells = Record<CellKey, boolean>;
type TeacherPick = { teacherId?: string; newName?: string; name: string; online: boolean; external: boolean; confirmNew?: boolean };
type DraftRow = {
  key: string; id?: string; kind: string; label: string; referenceKey: string | null; referenceCodes: string[]; name?: string;
  sitting: 'june' | 'november' | 'january'; closesAt: string; payBy: string;
  examFee: string; courseFee: string; selfStudyOwn: boolean; selfStudyFee: string;
  cells: Cells; teachers: TeacherPick[] | null; needsCarriedFrom: boolean; fromReference: boolean;
  examFeeSource: string | null; lines: number;
};
type Earlier = { month: string; year: number };
type Question = { id?: string; kind: 'yes_no' | 'text' | 'choice'; prompt: string; choices: string[]; required: boolean };
type Draft = {
  accepting: boolean; closesAt: string; courseFee: string; note: string; teacherChoice: 'families' | 'school'; teacherTbc: boolean;
  teachers: TeacherPick[]; rows: DraftRow[]; earlier: Earlier[]; questions: Question[];
};

const NO_CELLS: Cells = { firstInSchool: false, retakeInSchool: false, retakeSelfStudy: false, firstSelfStudy: false };
const anyCell = (c: Cells) => CELLS.some((k) => c[k]);
/** A one-paper row is a retake: no first entry (the API refuses it). */
const cellAllowed = (kind: string, c: CellKey) => !(kind === 'paper' && (c === 'firstInSchool' || c === 'firstSelfStudy'));
/** The usual ticks when she offers a row (the API's defaults, D4): a one-paper row the two retakes; any other the three usual columns. */
const usualCells = (kind: string): Cells => (kind === 'paper'
  ? { ...NO_CELLS, retakeInSchool: true, retakeSelfStudy: true }
  : { firstInSchool: true, retakeInSchool: true, retakeSelfStudy: true, firstSelfStudy: false });
const money = (v: number | null) => (v === null ? '' : String(v));
const num = (v: string) => (v.trim() === '' ? null : Number(v));
const rowName = (r: { kind: string; label: string }) => (r.kind === 'all_papers' ? 'All papers' : r.label);

function draftOf(o: OfferingData): Draft {
  const asking = o.rows.filter((r) => r.needsCarriedFrom);
  const earlier: Earlier[] = [];
  for (const r of asking) for (const p of r.allowedPriorSittings) if (!earlier.some((e) => e.month === p.month && e.year === p.year)) earlier.push({ month: p.month, year: p.year });
  earlier.sort((a, b) => monthIndex(b.month, b.year) - monthIndex(a.month, a.year));
  return {
    accepting: o.accepting, closesAt: pickerValue(o.closesAt), courseFee: money(o.courseFee), note: o.note ?? '',
    teacherChoice: o.teacherChoice as 'families' | 'school', teacherTbc: o.teacherTbc,
    teachers: o.teachers.map((t) => ({ teacherId: t.teacherId, name: t.name, online: t.online, external: t.external })),
    rows: o.rows.map((r) => rowDraft(r)),
    earlier,
    questions: o.questions.map((q) => ({ id: q.id, kind: q.kind as Question['kind'], prompt: q.prompt, choices: q.choices, required: q.required })),
  };
}

function rowDraft(r: RowData): DraftRow {
  return {
    key: r.id, id: r.id, kind: r.kind, label: rowName(r), referenceKey: r.referenceKey, referenceCodes: r.referenceCodes,
    ...(r.kind === 'custom' ? { name: r.label } : {}),
    sitting: (r.sitting ?? 'june') as DraftRow['sitting'], closesAt: pickerValue(r.closesAt), payBy: pickerValue(r.payBy),
    examFee: money(r.examFee), courseFee: money(r.courseFee), selfStudyOwn: r.selfStudyFee !== null, selfStudyFee: money(r.selfStudyFee),
    cells: { ...r.cells }, teachers: r.teachers.length ? r.teachers.map((t) => ({ teacherId: t.teacherId, name: t.name, online: t.online, external: t.external })) : null,
    needsCarriedFrom: r.needsCarriedFrom, fromReference: r.fromReference, examFeeSource: r.examFeeSource, lines: r.lines.live,
  };
}

const teacherInput = (t: TeacherPick) => (t.teacherId
  ? { teacherId: t.teacherId, online: t.online, external: t.external }
  : { newName: t.newName!, online: t.online, external: t.external, confirmNew: !!t.confirmNew });

/** The body PUT /offerings/:id takes: the whole subject, and her look at the default ticks done. */
function bodyOf(d: Draft, o: OfferingData) {
  return {
    note: d.note.trim() || null,
    teacherChoice: d.teacherChoice,
    teacherTbc: d.teacherTbc,
    accepting: d.accepting,
    closesAt: d.closesAt ? endOfSchoolDay(d.closesAt) : null,
    courseFee: num(d.courseFee),
    teachers: d.teachers.map(teacherInput),
    rows: d.rows.map((r) => {
      const before = r.id ? o.rows.find((x) => x.id === r.id) : undefined;
      const examFee = num(r.examFee);
      return {
        ...(r.id ? { id: r.id } : {}),
        kind: r.kind as 'custom',
        ...(r.referenceKey ? { referenceKey: r.referenceKey } : {}),
        ...(!r.id ? { referenceCodes: r.referenceCodes } : {}),
        ...(r.name ? { name: r.name } : {}),
        sitting: r.sitting,
        closesAt: r.closesAt ? endOfSchoolDay(r.closesAt) : null,
        payBy: r.payBy ? endOfSchoolDay(r.payBy) : null,
        // A fee left as it was keeps where it came from (a list, the board's rule, the sum of its units).
        ...(before && before.examFee === examFee ? {} : { examFee, examFeeSource: examFee === null ? null : 'typed' as const }),
        courseFee: num(r.courseFee),
        selfStudyFee: r.selfStudyOwn ? num(r.selfStudyFee) : null,
        cells: r.cells,
        ...(r.needsCarriedFrom ? { allowedPriorSittings: d.earlier.map((e) => ({ month: e.month as 'june', year: e.year })) } : {}),
        teachers: r.teachers ? r.teachers.map(teacherInput) : null,
      };
    }),
    questions: d.questions,
    defaultsReviewed: true as const,
  };
}

export default function SubjectEditor({ sessionId, offeringId, viewerRole }: { sessionId: string; offeringId: string; viewerRole: string }): React.JSX.Element {
  const off = useQuery({ queryKey: offeringKey(sessionId, offeringId), queryFn: () => fetchOffering(sessionId, offeringId) });
  const ses = useQuery({ queryKey: setupKey(sessionId), queryFn: () => fetchSetupSession(sessionId) });
  if (off.isLoading || ses.isLoading) return <LoadingState />;
  if (off.isError || ses.isError || !off.data || !ses.data) {
    return <div className="mx-auto max-w-6xl px-6 py-8"><ErrorState message={off.error ? refusalText(off.error) : undefined} onRetry={() => { void off.refetch(); void ses.refetch(); }} /></div>;
  }
  const canEdit = (viewerRole === ROLES.ADMIN || viewerRole === ROLES.COORDINATOR) && ses.data.status !== 'closed';
  return <Editor key={off.dataUpdatedAt} o={off.data} s={ses.data} canEdit={canEdit} />;
}

function Editor({ o, s, canEdit }: { o: OfferingData; s: SetupSession; canEdit: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const initial = useMemo(() => draftOf(o), [o]);
  const [d, setD] = useState<Draft>(initial);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const [more, setMore] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const back = `/admin/sessions/${s.id}#subjects`;
  const save = useImpactSave(
    (body: ReturnType<typeof bodyOf>, expected) =>
      apiResponse(api.v1.sessions[':id'].offerings[':offeringId'].$put({ param: { id: s.id, offeringId: o.id }, json: { ...body, ...(expected ? { expected } : {}) } })),
    async () => { await queryClient.invalidateQueries({ queryKey: ['sessions', s.id] }); },
  );
  const remove = useMutation({
    mutationFn: async () => apiResponse(api.v1.sessions[':id'].offerings[':offeringId'].$delete({ param: { id: s.id, offeringId: o.id } })),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: setupKey(s.id) }); router.push(back as never); },
  });
  // Leaving with changes not saved asks first (the browser's own question).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const setRow = (key: string, patch: Partial<DraftRow>) => setD((x) => ({ ...x, rows: x.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const code = shownCode(o.subject.code);
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Link href={back as never} className="text-sm text-muted-foreground hover:text-foreground">← <bdi>{s.name}</bdi></Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-foreground"><bdi data-i18n-skip="true">{subjectTitle(o)}</bdi></h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <bdi data-i18n-skip="true">{o.board.name}</bdi>{code && <> · <span dir="ltr">{code}</span></>} · <span>{o.group}</span> · <bdi>{s.name}</bdi>
            {o.notOnTheList && <> · <span>not on the list (flagged to us)</span></>}
          </p>
        </div>
        <div className="w-full rounded-xl border border-border bg-card p-4 shadow-sm sm:w-auto sm:min-w-80">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-foreground">Accepting reservations</span>
            <Switch checked={d.accepting} label="This subject accepts reservations" disabled={!canEdit} onChange={(v) => setD({ ...d, accepting: v })} />
          </div>
          <label htmlFor="ed-close" className="mt-3 block text-sm font-medium text-foreground"><span>Closes on</span> <span className="font-normal text-muted-foreground">(optional)</span></label>
          <input id="ed-close" type="date" className={cn(INPUT_CLASS, 'mt-1')} value={d.closesAt} disabled={!canEdit} onChange={(e) => setD({ ...d, closesAt: e.target.value })} />
          <p className="mt-1 text-xs text-muted-foreground">Closing stops new reservations; waiting ones can still be paid.</p>
        </div>
      </div>
      {o.checkNotes.length > 0 && (
        <Notice tone="warning" className="mt-4" title="To look at (from the check list)">
          {o.checkNotes.map((n, i) => <p key={i} lang="en" data-i18n-skip="true">{n}</p>)}
        </Notice>
      )}
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <Grid o={o} s={s} d={d} setD={setD} setRow={setRow} more={more} setMore={setMore} canEdit={canEdit} />
          <Teachers d={d} setD={setD} canEdit={canEdit} />
          <EarlierExams o={o} s={s} d={d} setD={setD} canEdit={canEdit} />
          <ForFamilies d={d} setD={setD} canEdit={canEdit} />
          {canEdit && (
            <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 shadow-md">
              <Button disabled={!dirty || save.isPending} onClick={() => save.save(bodyOf(d, o))}>{save.isPending ? 'Saving…' : 'Save'}</Button>
              <Button variant="outline" disabled={!dirty || save.isPending} onClick={() => setD(initial)}>Undo the changes</Button>
              <span className="flex-1 text-xs text-muted-foreground">{dirty ? 'Changes not saved yet.' : 'Saved.'}</span>
              <Button variant="ghost" className="text-destructive" onClick={() => setRemoving(true)}>Remove this subject</Button>
              <div className="basis-full"><ErrorLine message={save.error} /></div>
            </div>
          )}
        </div>
        <aside aria-label="What families see"><Preview o={o} s={s} dirty={dirty} /></aside>
      </div>
      <ImpactDialog save={save} />
      {removing && (
        <Modal title={`Remove ${subjectTitle(o)}`} onClose={() => setRemoving(false)}>
          <div className="space-y-3 text-sm">
            <p>It leaves this session with its rows, teachers and questions. A subject families reserved stays: switch it off instead.</p>
            <ErrorLine message={remove.error ? refusalText(remove.error) : null} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRemoving(false)}>Cancel</Button>
              <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove it</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const card = 'rounded-xl border border-border bg-card p-5 shadow-sm';
const th = 'px-2 py-2 text-start text-xs font-semibold text-muted-foreground';

type GridProps = {
  o: OfferingData; s: SetupSession; d: Draft; setD: (d: Draft) => void; setRow: (key: string, patch: Partial<DraftRow>) => void;
  more: string | null; setMore: (k: string | null) => void; canEdit: boolean;
};

/** D2–D3: the rows against the ways it is studied, a fee on each row. */
function Grid({ o, s, d, setD, setRow, more, setMore, canEdit }: GridProps) {
  const [custom, setCustom] = useState<{ name: string; code: string; fee: string } | null>(null);
  // First entry self study (amendment 7) shows as a column once a row has it, or under a row's "More options".
  const cols: CellKey[] = d.rows.some((r) => r.cells.firstSelfStudy) ? [...CELLS] : ['firstInSchool', 'retakeInSchool', 'retakeSelfStudy'];
  const offered = d.rows.filter((r) => anyCell(r.cells));
  const column = (c: CellKey) => {
    const el = offered.filter((r) => cellAllowed(r.kind, c));
    return { el, all: el.length > 0 && el.every((r) => r.cells[c]) };
  };
  const setColumn = (c: CellKey) => {
    const { el, all } = column(c);
    setD({ ...d, rows: d.rows.map((r) => (el.includes(r) ? { ...r, cells: { ...r.cells, [c]: !all } } : r)) });
  };
  const addCustom = () => {
    if (!custom || custom.name.trim().length < 1) return;
    const key = `new-${Date.now()}`;
    setD({ ...d, rows: [...d.rows, {
      key, kind: 'custom', label: custom.name.trim(), name: custom.name.trim(), referenceKey: null, referenceCodes: custom.code.trim() ? [custom.code.trim()] : [],
      sitting: s.sessionType === 'june' ? 'june' : 'november', closesAt: '', payBy: '', examFee: custom.fee, courseFee: '', selfStudyOwn: false, selfStudyFee: '',
      cells: { ...NO_CELLS, retakeSelfStudy: true }, teachers: null, needsCarriedFrom: false, fromReference: false, examFeeSource: null, lines: 0,
    }] });
    setCustom(null);
  };
  return (
    <section className={card} aria-labelledby="grid-title">
      <h2 id="grid-title" className="font-display text-base font-semibold text-foreground">What can be entered, and how it is studied</h2>
      <p className="mt-1 text-sm text-muted-foreground"><span>Tick the rows the school offers, and how each is studied. The rows come from</span> <bdi data-i18n-skip="true">{o.board.name}</bdi><span>&apos;s list for this subject.</span></p>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="ed-course" className="block text-sm font-medium text-foreground">Course fee — the subject&apos;s (EGP)</label>
          <input id="ed-course" type="number" min={0} step={50} inputMode="decimal" className={cn(INPUT_CLASS, 'mt-1 w-40')} placeholder="not set" value={d.courseFee} disabled={!canEdit}
            onChange={(e) => setD({ ...d, courseFee: e.target.value })} />
        </div>
        <p className="max-w-md pb-2 text-xs text-muted-foreground"><span>Self study pays</span> <span>{s.selfStudyPercent}%</span> <span>of the course fee (the session&apos;s share) and the whole exam fee. A row may have its own course fee. Empty is not set; 0 is a fee.</span></p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={th}><span className="sr-only">Offered</span></th>
              <th className={th}>Row</th>
              {cols.map((c) => {
                const { el, all } = column(c);
                return (
                  <th key={c} className={cn(th, 'text-center')}>
                    <label className="flex flex-col items-center gap-1">
                      <span>{CELL_WORDS[c]}</span>
                      <input type="checkbox" className="size-4 accent-primary" checked={all} disabled={!canEdit || !el.length} onChange={() => setColumn(c)}
                        aria-label={`${CELL_WORDS[c]}: tick or untick every offered row`} />
                    </label>
                  </th>
                );
              })}
              <th className={th}>Exam fee (EGP)</th>
              <th className={th}>Course fee (EGP)</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => {
              const on = anyCell(r.cells);
              const open = more === r.key;
              const before = r.id ? o.rows.find((x) => x.id === r.id) : undefined;
              const sameFee = before && money(before.examFee) === r.examFee;
              return (
                <RowLines key={r.key} r={r} o={o} s={s} cols={cols} on={on} open={open} canEdit={canEdit} setRow={setRow} setMore={setMore}
                  feeNote={r.examFee === '' ? 'not set' : sameFee ? sourceWords(r.examFeeSource) : 'typed'} />
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && (custom ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <div className="min-w-48 flex-1">
            <label htmlFor="cr-name" className="block text-xs font-medium text-foreground">Name families read</label>
            <input id="cr-name" className={cn(INPUT_CLASS, 'mt-1 h-9')} value={custom.name} placeholder="e.g. Paper 3 only" onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
          </div>
          <div>
            <label htmlFor="cr-code" className="block text-xs font-medium text-foreground">Code (optional)</label>
            <input id="cr-code" dir="ltr" className={cn(INPUT_CLASS, 'mt-1 h-9 w-32')} value={custom.code} onChange={(e) => setCustom({ ...custom, code: e.target.value })} />
          </div>
          <div>
            <label htmlFor="cr-fee" className="block text-xs font-medium text-foreground">Its exam fee (EGP)</label>
            <input id="cr-fee" type="number" min={0} className={cn(INPUT_CLASS, 'mt-1 h-9 w-32')} placeholder="not set" value={custom.fee} onChange={(e) => setCustom({ ...custom, fee: e.target.value })} />
          </div>
          <Button size="sm" disabled={!custom.name.trim()} onClick={addCustom}>Add the row</Button>
          <Button size="sm" variant="ghost" onClick={() => setCustom(null)}>Cancel</Button>
        </div>
      ) : (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setCustom({ name: '', code: '', fee: '' })}>+ Add a row not on the list</Button>
      ))}
      <p className="mt-2 text-xs text-muted-foreground">Retake in school starts ticked wherever first entry in school is: on your forms a retaker may pick a teacher. Untick it where the school does not offer it.</p>
    </section>
  );
}

function sourceWords(src: string | null) {
  if (src === 'list') return 'from a price list';
  if (src === 'board_rule') return 'the subject\'s fee (the board\'s rule)';
  if (src === 'units_sum') return 'the sum of its units';
  if (src === 'typed') return 'typed';
  return 'not set';
}

function RowLines({ r, o, s, cols, on, open, canEdit, setRow, setMore, feeNote }: {
  r: DraftRow; o: OfferingData; s: SetupSession; cols: CellKey[]; on: boolean; open: boolean; canEdit: boolean;
  setRow: (key: string, patch: Partial<DraftRow>) => void; setMore: (k: string | null) => void; feeNote: string;
}) {
  const hint = r.kind === 'paper' ? (r.needsCarriedFrom ? 'a retake of one paper; the others carried from an earlier exam' : 'a retake of one paper')
    : r.kind === 'a2' ? 'carries the A.S. from an earlier exam' : r.kind === 'custom' ? 'not on the list' : '';
  return (
    <>
      <tr className={cn('border-b border-border', !on && 'text-muted-foreground')}>
        <td className="px-2 py-2 align-top">
          <input type="checkbox" className="size-4 accent-primary" checked={on} disabled={!canEdit} aria-label={`Offer ${r.label}`}
            onChange={() => setRow(r.key, { cells: on ? { ...NO_CELLS } : usualCells(r.kind) })} />
        </td>
        <td className="px-2 py-2 align-top">
          <span className="font-medium text-foreground" data-i18n-skip="true">{r.label}</span>
          {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
          {r.teachers && <span className="block text-xs"><bdi data-i18n-skip="true">{r.teachers.map((t) => t.name + (t.online ? ' (online)' : '')).join(' / ')}</bdi></span>}
          {s.sessionType === 'winter' && <span className="mt-1 block"><Badge tone="info">{r.sitting === 'january' ? 'exam in January' : 'exam in November'}</Badge></span>}
          {r.lines > 0 && <span className="block text-xs text-muted-foreground"><span>{r.lines}</span> <span>{r.lines === 1 ? 'reservation' : 'reservations'}</span></span>}
          <button type="button" className="mt-1 block text-xs font-medium text-primary hover:underline" aria-expanded={open} onClick={() => setMore(open ? null : r.key)}>
            {open ? 'Fewer options' : 'More options'}
          </button>
        </td>
        {cols.map((c) => (
          <td key={c} className="px-2 py-2 text-center align-top">
            {cellAllowed(r.kind, c)
              ? <input type="checkbox" className="size-4 accent-primary" checked={r.cells[c]} disabled={!canEdit} aria-label={`${r.label}: ${CELL_WORDS[c]}`}
                  onChange={() => setRow(r.key, { cells: { ...r.cells, [c]: !r.cells[c] } })} />
              : <span className="text-muted-foreground" title="A one-paper row is a retake">—</span>}
          </td>
        ))}
        <td className="px-2 py-2 align-top">
          <input type="number" min={0} step={50} inputMode="decimal" className={cn(INPUT_CLASS, 'h-9 w-28')} placeholder="not set" value={r.examFee} disabled={!canEdit}
            aria-label={`${r.label}: exam fee`} onChange={(e) => setRow(r.key, { examFee: e.target.value })} />
          <span className={cn('block max-w-44 text-xs', r.examFee === '' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>{feeNote}</span>
        </td>
        <td className="px-2 py-2 align-top">
          <input type="number" min={0} step={50} inputMode="decimal" className={cn(INPUT_CLASS, 'h-9 w-28')} placeholder="—" value={r.courseFee} disabled={!canEdit}
            aria-label={`${r.label}: its own course fee`} onChange={(e) => setRow(r.key, { courseFee: e.target.value })} />
          <span className="block text-xs text-muted-foreground">{r.courseFee !== '' ? 'its own' : o.courseFee === null ? 'the subject\'s: not set' : <><span>the subject&apos;s:</span> <Money amount={o.courseFee} /></>}</span>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border bg-muted/30">
          <td />
          <td colSpan={cols.length + 3} className="px-2 py-3">
            <MoreOptions r={r} s={s} o={o} canEdit={canEdit} setRow={setRow} />
          </td>
        </tr>
      )}
    </>
  );
}

/** A row's rarer settings: first entry self study (amendment 7), its own self-study amount (E4), its own teachers (D4), a winter row's month and dates (D12). */
function MoreOptions({ r, s, o, canEdit, setRow }: { r: DraftRow; s: SetupSession; o: OfferingData; canEdit: boolean; setRow: (key: string, patch: Partial<DraftRow>) => void }) {
  const teachers = useQuery({ queryKey: TEACHERS_KEY, queryFn: fetchTeachers });
  const inSchool = r.cells.firstInSchool || r.cells.retakeInSchool;
  const avail = (teachers.data ?? []).filter((t) => !(r.teachers ?? []).some((x) => x.teacherId === t.id));
  const id = r.key.replace(/[^\w-]/g, '');
  return (
    <div className="space-y-3 text-sm">
      {cellAllowed(r.kind, 'firstSelfStudy') && (
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-primary" checked={r.cells.firstSelfStudy} disabled={!canEdit}
            onChange={() => setRow(r.key, { cells: { ...r.cells, firstSelfStudy: !r.cells.firstSelfStudy } })} />
          <span>First entry self study</span> <span className="text-muted-foreground">— not taught this cycle</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`ss-${id}`}>Self study pays</label>
        <select id={`ss-${id}`} className={cn(INPUT_CLASS, 'h-9 w-auto')} value={r.selfStudyOwn ? 'own' : 'share'} disabled={!canEdit}
          onChange={(e) => setRow(r.key, { selfStudyOwn: e.target.value === 'own' })}>
          <option value="share">{`the session's ${s.selfStudyPercent}% of the course fee`}</option>
          <option value="own">its own amount</option>
        </select>
        {r.selfStudyOwn && (
          <input type="number" min={0} className={cn(INPUT_CLASS, 'h-9 w-32')} placeholder="EGP" value={r.selfStudyFee} disabled={!canEdit}
            aria-label={`${r.label}: self-study course amount`} onChange={(e) => setRow(r.key, { selfStudyFee: e.target.value })} />
        )}
      </div>
      {inSchool && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`rt-${id}`}>Teachers for this row</label>
          <select id={`rt-${id}`} className={cn(INPUT_CLASS, 'h-9 w-auto')} value={r.teachers ? 'own' : 'subject'} disabled={!canEdit}
            onChange={(e) => setRow(r.key, { teachers: e.target.value === 'own' ? [] : null })}>
            <option value="subject">as the subject</option>
            <option value="own">its own</option>
          </select>
          {r.teachers && (
            <>
              {r.teachers.map((t) => (
                <TeacherChip key={t.teacherId ?? t.name} t={t} canEdit={canEdit}
                  onOnline={() => setRow(r.key, { teachers: r.teachers!.map((x) => (x === t ? { ...x, online: !x.online } : x)) })}
                  onRemove={() => setRow(r.key, { teachers: r.teachers!.filter((x) => x !== t) })} />
              ))}
              <select className={cn(INPUT_CLASS, 'h-9 w-auto')} value="" disabled={!canEdit} aria-label={`Add a teacher to ${r.label}`}
                onChange={(e) => {
                  const t = avail.find((x) => x.id === e.target.value);
                  if (t) setRow(r.key, { teachers: [...(r.teachers ?? []), { teacherId: t.id, name: t.name, online: false, external: false }] });
                }}>
                <option value="">Add…</option>
                {avail.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </>
          )}
        </div>
      )}
      {s.sessionType === 'winter' && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span>Exam in</span>
            <select className={cn(INPUT_CLASS, 'h-9 w-auto')} value={r.sitting} disabled={!canEdit || r.lines > 0} onChange={(e) => setRow(r.key, { sitting: e.target.value as DraftRow['sitting'] })}>
              <option value="november">November</option>
              <option value="january">January</option>
            </select>
          </label>
          <label className="flex items-center gap-2"><span>Closes on</span><input type="date" className={cn(INPUT_CLASS, 'h-9 w-auto')} value={r.closesAt} disabled={!canEdit} onChange={(e) => setRow(r.key, { closesAt: e.target.value })} /></label>
          <label className="flex items-center gap-2"><span>Pay by</span><input type="date" className={cn(INPUT_CLASS, 'h-9 w-auto')} value={r.payBy} disabled={!canEdit} onChange={(e) => setRow(r.key, { payBy: e.target.value })} /></label>
        </div>
      )}
      {r.needsCarriedFrom
        ? <p className="text-xs text-muted-foreground">Families taking it say which earlier exam it follows, from the subject&apos;s list below.</p>
        : r.kind === 'paper' && <p className="text-xs text-muted-foreground"><bdi data-i18n-skip="true">{o.board.name}</bdi> <span>does not ask which earlier exam a one-paper retake follows.</span></p>}
    </div>
  );
}

function TeacherChip({ t, canEdit, onOnline, onExternal, onRemove }: { t: TeacherPick; canEdit: boolean; onOnline: () => void; onExternal?: () => void; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 text-xs">
      <bdi data-i18n-skip="true" className="font-medium">{t.name}</bdi>
      {t.newName && <Badge tone="info">new</Badge>}
      <button type="button" disabled={!canEdit} aria-pressed={t.online} onClick={onOnline}
        className={cn('rounded-full px-1.5 py-0.5', t.online ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>online</button>
      {onExternal
        ? <button type="button" disabled={!canEdit} aria-pressed={t.external} onClick={onExternal}
            className={cn('rounded-full px-1.5 py-0.5', t.external ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>external team</button>
        : t.external && <span className="text-muted-foreground">(external team)</span>}
      {canEdit && <button type="button" aria-label={`Remove ${t.name}`} onClick={onRemove} className="rounded-full px-1 text-muted-foreground hover:bg-muted hover:text-foreground">×</button>}
    </span>
  );
}

/** D4, D5: the subject's teachers, picked from the school's list or a new name checked against it; who picks; to be confirmed. */
function Teachers({ d, setD, canEdit }: { d: Draft; setD: (d: Draft) => void; canEdit: boolean }) {
  const teachers = useQuery({ queryKey: TEACHERS_KEY, queryFn: fetchTeachers });
  const avail = (teachers.data ?? []).filter((t) => !d.teachers.some((x) => x.teacherId === t.id));
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const check = useMutation({
    mutationFn: async (n: string) => apiResponse(api.v1.teachers.duplicates.$get({ query: { name: n } })),
    onSuccess: (r, n) => { if (!r.duplicates.length) addNew(n, false); },
  });
  const addNew = (n: string, confirmNew: boolean) => {
    setD({ ...d, teachers: [...d.teachers, { newName: n, name: n, online: false, external: false, confirmNew }] });
    setName(''); setAdding(false); check.reset();
  };
  const dups = check.data?.duplicates ?? [];
  return (
    <section className={card} aria-labelledby="teachers-title">
      <h2 id="teachers-title" className="font-display text-base font-semibold text-foreground">Teachers</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {d.teachers.length ? d.teachers.map((t) => (
          <TeacherChip key={t.teacherId ?? t.name} t={t} canEdit={canEdit}
            onOnline={() => setD({ ...d, teachers: d.teachers.map((x) => (x === t ? { ...x, online: !x.online } : x)) })}
            onExternal={t.newName ? () => setD({ ...d, teachers: d.teachers.map((x) => (x === t ? { ...x, external: !x.external } : x)) }) : undefined}
            onRemove={() => setD({ ...d, teachers: d.teachers.filter((x) => x !== t) })} />
        )) : <span className="text-sm text-muted-foreground">No teacher yet.</span>}
      </div>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className={cn(INPUT_CLASS, 'w-auto max-w-xs')} value="" aria-label="Add a teacher"
            onChange={(e) => {
              if (e.target.value === '__new') { setAdding(true); return; }
              const t = avail.find((x) => x.id === e.target.value);
              if (t) setD({ ...d, teachers: [...d.teachers, { teacherId: t.id, name: t.name, online: false, external: t.kind === 'provider' }] });
            }}>
            <option value="">Add a teacher…</option>
            <optgroup label="The school's teachers">
              {avail.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
            <option value="__new">A new teacher…</option>
          </select>
          {adding && (
            <>
              <input className={cn(INPUT_CLASS, 'w-60')} value={name} onChange={(e) => { setName(e.target.value); check.reset(); }} placeholder="Name as families will read it" aria-label="The new teacher's name" />
              <Button variant="outline" disabled={name.trim().length < 2 || check.isPending} onClick={() => check.mutate(name.trim())}>Add</Button>
            </>
          )}
        </div>
      )}
      {dups.length > 0 && (
        <Notice tone="warning" className="mt-3" title="Is this one of the school's teachers?">
          <ul className="mt-1 space-y-1">
            {dups.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2">
                <bdi data-i18n-skip="true" className="font-medium">{x.name}</bdi>
                <Button size="sm" variant="outline" onClick={() => { setD({ ...d, teachers: [...d.teachers, { teacherId: x.id, name: x.name, online: false, external: x.kind === 'provider' }] }); setName(''); setAdding(false); check.reset(); }}>
                  <span>Use</span> <bdi data-i18n-skip="true">{x.name}</bdi>
                </Button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => addNew(name.trim(), true)}>
            <span>No:</span> <bdi data-i18n-skip="true">{name.trim()}</bdi> <span>is someone new</span>
          </Button>
        </Notice>
      )}
      <ErrorLine message={check.error ? refusalText(check.error) : null} />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground"><span>Teacher to be confirmed</span> <span className="block text-xs text-muted-foreground">families read “teacher to be announced”</span></span>
          <Switch checked={d.teacherTbc} label="Teacher to be confirmed" disabled={!canEdit} onChange={(v) => setD({ ...d, teacherTbc: v })} />
        </div>
        <div>
          <label htmlFor="ed-choice" className="block text-sm font-medium text-foreground">Who picks the teacher</label>
          <select id="ed-choice" className={cn(INPUT_CLASS, 'mt-1')} value={d.teacherChoice} disabled={!canEdit} onChange={(e) => setD({ ...d, teacherChoice: e.target.value as Draft['teacherChoice'] })}>
            <option value="families">Families choose (one is preselected)</option>
            <option value="school">The school assigns</option>
          </select>
        </div>
      </div>
    </section>
  );
}

/**
 * D6: the earlier exams a retake carries from — one list for the subject, used by every row that asks
 * (a one-paper retake where the board asks, an A.2.). Ticked from the board's previous two; an older one
 * is kept (her list wins) with a warning past the board's carry-forward months.
 */
function EarlierExams({ o, s, d, setD, canEdit }: { o: OfferingData; s: SetupSession; d: Draft; setD: (d: Draft) => void; canEdit: boolean }) {
  const boards = useQuery({ queryKey: REFERENCE_BOARDS_KEY, queryFn: fetchReferenceBoards });
  const asking = d.rows.filter((r) => r.needsCarriedFrom && anyCell(r.cells));
  const notAsked = d.rows.some((r) => r.kind === 'paper' && !r.needsCarriedFrom && anyCell(r.cells));
  const [shown, setShown] = useState<Earlier[]>(() => d.earlier);
  if (!asking.length) {
    return notAsked
      ? <section className={card}><h2 className="font-display text-base font-semibold text-foreground">Earlier exams</h2><p className="mt-1 text-sm text-muted-foreground"><bdi data-i18n-skip="true">{o.board.name}</bdi> <span>does not ask which earlier exam a one-paper retake follows, so families are not asked.</span></p></section>
      : null;
  }
  const board = boards.data?.find((b) => b.code === o.board.code);
  const here = o.rows.find((r) => r.needsCarriedFrom)?.series ?? { month: s.sessionType === 'june' ? 'june' : 'november', year: s.seriesYear };
  const hereIdx = monthIndex(here.month, here.year);
  const level = o.group === 'O.L.' ? 'igcse' : 'as_al';
  const months = [...new Set((board?.sittings ?? []).filter((x) => x.levels.includes(level)).map((x) => x.month))];
  const cand: Earlier[] = [];
  for (let y = here.year; y >= here.year - 4; y--) {
    for (const m of ['november', 'october', 'june', 'january']) {
      if (!months.includes(m) || monthIndex(m, y) >= hereIdx) continue;
      if ([...shown].some((e) => e.month === m && e.year === y)) continue;
      cand.push({ month: m, year: y });
    }
  }
  const ticked = (e: Earlier) => d.earlier.some((x) => x.month === e.month && x.year === e.year);
  const toggle = (e: Earlier) => setD({ ...d, earlier: ticked(e) ? d.earlier.filter((x) => !(x.month === e.month && x.year === e.year)) : [...d.earlier, e] });
  const carry = board?.carryForwardMonths ?? null;
  return (
    <section className={card} aria-labelledby="earlier-title">
      <h2 id="earlier-title" className="font-display text-base font-semibold text-foreground">Earlier exams a retake carries from</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        <span>Asked of a family taking</span> {asking.map((r, i) => <span key={r.key}>{i > 0 && ', '}<span data-i18n-skip="true">{r.label}</span></span>)}<span>: they pick the exam they sat from this list. A student the school knows sat it has it filled in.</span>
      </p>
      <ul className="mt-3 space-y-2">
        {shown.map((e) => {
          const age = hereIdx - monthIndex(e.month, e.year);
          const old = carry !== null && age > carry && ticked(e);
          return (
            <li key={`${e.month}-${e.year}`}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-primary" checked={ticked(e)} disabled={!canEdit} onChange={() => toggle(e)} />
                <span>{examMonth(e.month, e.year)}</span>
              </label>
              {old && (
                <p role="status" className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  <span>{examMonth(e.month, e.year)}</span> <span>is</span> <span>{age}</span> <span>months before this exam: older than</span> <bdi data-i18n-skip="true">{o.board.name}</bdi> <span>carries a result forward</span> (<span>{carry}</span> <span>months</span>). <span>It stays, since your list wins; the board may refuse the entry.</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && cand.length > 0 && (
        <select className={cn(INPUT_CLASS, 'mt-3 w-auto')} value="" aria-label="Add an older earlier exam"
          onChange={(e) => {
            const [m, y] = e.target.value.split('-');
            const pick = { month: m!, year: Number(y) };
            setShown([...shown, pick].sort((a, b) => monthIndex(b.month, b.year) - monthIndex(a.month, a.year)));
            setD({ ...d, earlier: [...d.earlier, pick] });
          }}>
          <option value="">Add an older one…</option>
          {cand.map((e) => <option key={`${e.month}-${e.year}`} value={`${e.month}-${e.year}`}>{examMonth(e.month, e.year)}</option>)}
        </select>
      )}
    </section>
  );
}

/** D13 and the family note: optional; never a price, never who may reserve. */
function ForFamilies({ d, setD, canEdit }: { d: Draft; setD: (d: Draft) => void; canEdit: boolean }) {
  const [kind, setKind] = useState<Question['kind']>('yes_no');
  const [prompt, setPrompt] = useState('');
  const [choices, setChoices] = useState('');
  const list = choices.split('\n').map((c) => c.trim()).filter(Boolean);
  const ready = prompt.trim().length >= 2 && (kind !== 'choice' || list.length > 0);
  const KIND_WORDS = { yes_no: 'Yes / no', text: 'Short text', choice: 'A choice' } as const;
  return (
    <section className={card} aria-labelledby="families-title">
      <h2 id="families-title" className="font-display text-base font-semibold text-foreground">For families</h2>
      <label htmlFor="ed-note" className="mt-3 block text-sm font-medium text-foreground"><span>Note on the subject</span> <span className="font-normal text-muted-foreground">(optional)</span></label>
      <textarea id="ed-note" rows={2} className={cn(TEXTAREA_CLASS, 'mt-1')} value={d.note} disabled={!canEdit} placeholder="e.g. Taught on Saturdays." onChange={(e) => setD({ ...d, note: e.target.value })} />
      <p className="mt-4 text-sm font-medium text-foreground">Extra questions for this subject</p>
      {d.questions.length ? (
        <ul className="mt-1 divide-y divide-border">
          {d.questions.map((q, i) => (
            <li key={q.id ?? `new-${i}`} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span><bdi data-i18n-skip="true">{q.prompt}</bdi> <span className="text-xs text-muted-foreground">{KIND_WORDS[q.kind]}{q.choices.length > 0 && <>: <bdi data-i18n-skip="true">{q.choices.join(' / ')}</bdi></>}</span></span>
              {canEdit && <Button variant="ghost" size="sm" onClick={() => setD({ ...d, questions: d.questions.filter((_, j) => j !== i) })}>Remove</Button>}
            </li>
          ))}
        </ul>
      ) : <p className="mt-1 text-sm text-muted-foreground">None.</p>}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="eq-kind" className="block text-xs font-medium text-foreground">Answer</label>
            <select id="eq-kind" className={cn(INPUT_CLASS, 'mt-1 h-9 w-auto')} value={kind} onChange={(e) => setKind(e.target.value as Question['kind'])}>
              {(Object.keys(KIND_WORDS) as Question['kind'][]).map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
            </select>
          </div>
          <div className="min-w-56 flex-1">
            <label htmlFor="eq-text" className="block text-xs font-medium text-foreground">Question</label>
            <input id="eq-text" className={cn(INPUT_CLASS, 'mt-1 h-9')} value={prompt} placeholder="e.g. Which calculator will the student use?" onChange={(e) => setPrompt(e.target.value)} />
          </div>
          {kind === 'choice' && (
            <div className="min-w-56 flex-1">
              <label htmlFor="eq-choices" className="block text-xs font-medium text-foreground">Choices, one per line</label>
              <textarea id="eq-choices" rows={2} className={cn(TEXTAREA_CLASS, 'mt-1')} value={choices} onChange={(e) => setChoices(e.target.value)} />
            </div>
          )}
          <Button variant="outline" size="sm" disabled={!ready} onClick={() => { setD({ ...d, questions: [...d.questions, { kind, prompt: prompt.trim(), choices: kind === 'choice' ? list : [], required: false }] }); setPrompt(''); setChoices(''); }}>Add</Button>
        </div>
      )}
    </section>
  );
}

/**
 * The live preview (§5.4; GET /sessions/:id/preview): what a first-time student and a retaker see of this
 * subject, as saved. A student with no record sees first entries, with "Sat it before?" showing the
 * retakes (shown at once when there is no first entry); a retaker sees the retakes only, the exam they
 * sat filled in (the lead's decision on the mock).
 */
function Preview({ o, s, dirty }: { o: OfferingData; s: SetupSession; dirty: boolean }) {
  // The family wording is made in both languages (D9): the preview reads the one on screen.
  const { language } = useI18n();
  const [as, setAs] = useState<'first_timer' | 'retaker'>('first_timer');
  const [satBefore, setSatBefore] = useState(false);
  const pv = useQuery({ queryKey: previewKey(s.id, o.id, as), queryFn: () => fetchFamilyPreview(s.id, as, o.id) });
  const subject = pv.data?.offerings[0];
  const rows = subject?.rows ?? [];
  const firsts = rows.some((r) => r.options.some((x) => x.attempt === 'first'));
  const showRetakes = as === 'retaker' || satBefore || !firsts;
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.exclusiveGroup ?? `own-${r.id}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return (
    <section className={cn(card, 'lg:sticky lg:top-4')} aria-labelledby="preview-title">
      <h2 id="preview-title" className="font-display text-base font-semibold text-foreground">What families see</h2>
      <label htmlFor="pv-as" className="mt-2 block text-xs font-medium text-foreground">Preview as</label>
      <select id="pv-as" className={cn(INPUT_CLASS, 'mt-1 h-9')} value={as} onChange={(e) => { setAs(e.target.value as typeof as); setSatBefore(false); }}>
        <option value="first_timer">A first-time student</option>
        <option value="retaker">A retaker</option>
      </select>
      <p className="mt-2 text-xs text-muted-foreground">
        {as === 'retaker' ? 'A student the school knows sat this subject: retake choices only, that exam filled in.' : 'A student with no earlier exam on record: first entries; a retake is declared, as on your forms.'}
      </p>
      {dirty && <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">Changes not saved yet: the preview shows the saved subject.</p>}
      {!o.accepting && <Notice tone="neutral" className="mt-2">Switched off: families do not see it.</Notice>}
      {o.accepting && o.priceNotSet.length > 0 && <Notice tone="warning" className="mt-2">Not offered to families until every price is set.</Notice>}
      {pv.isLoading ? <LoadingState /> : pv.isError ? <ErrorLine message={refusalText(pv.error)} /> : !subject ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing to choose: no row is ticked.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="font-medium text-foreground"><bdi data-i18n-skip="true">{subject.name}</bdi> <span className="text-xs text-muted-foreground">{subject.group}</span></p>
          {subject.note && <p className="text-xs text-muted-foreground"><bdi data-i18n-skip="true">{subject.note}</bdi></p>}
          {[...groups.entries()].map(([k, rs]) => {
            const opts = rs.flatMap((r) => r.options.filter((x) => (x.attempt === 'first' ? as === 'first_timer' : showRetakes)).map((x) => ({ r, x })));
            if (!opts.length) return null;
            return (
              <fieldset key={k} className="rounded-lg border border-border p-2">
                <legend className="px-1 text-xs text-muted-foreground">One of</legend>
                <ul className="space-y-1.5">
                  {opts.map(({ r, x }) => (
                    <li key={`${r.id}-${x.attempt}-${x.mode}`} className="text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-foreground" data-i18n-skip="true">{x.label[language]}</span>
                        {x.price ? <Money amount={x.price.total} className="font-medium" /> : <span className="text-amber-700 dark:text-amber-400">price not set</span>}
                      </div>
                      {x.teachers.length > 0 && (
                        <span className="block text-muted-foreground">
                          {subject.teacherChoice === 'families' && x.teachers.length > 1 ? <span>Teacher, to choose:</span> : <span>Teacher:</span>} <bdi data-i18n-skip="true">{x.teachers.map((t) => t.name + (t.online ? ' (online)' : '')).join(' / ')}</bdi>
                        </span>
                      )}
                      {x.mode === 'in_school' && subject.teacherTbc && <span className="block text-muted-foreground">teacher to be announced</span>}
                      {x.needsCarriedFrom && (
                        <span className="block text-muted-foreground">
                          {r.knownSitting ? <><span>Sat in</span> <span data-i18n-skip="true">{r.knownSitting.label[language]}</span></> : <><span>When did you sit it?</span> <span data-i18n-skip="true">{x.allowedSittings.map((a) => a.label[language]).join(' / ')}</span></>}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </fieldset>
            );
          })}
          {as === 'first_timer' && firsts && !satBefore && rows.some((r) => r.options.some((x) => x.attempt === 'retake')) && (
            <Button variant="ghost" size="sm" onClick={() => setSatBefore(true)}>Sat it before? Show retake choices</Button>
          )}
        </div>
      )}
    </section>
  );
}
