'use client';

/**
 * The exam timetable (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §4).
 *
 * The spreadsheet version: the board's timetable PDF is printed; the
 * coordinator copies each paper the school's candidates sit into a sheet
 * (code, date, AM/PM, start, duration) by hand, then goes down every
 * candidate's entries with a ruler looking for two papers the same morning —
 * and misses the candidate with 25% extra time whose paper now runs into the
 * next one. When the board moves a paper the sheet is corrected and someone
 * phones each family whose child sits it; families get a photocopy.
 *
 * Here: the board's table is pasted as it is (from its Excel file or its PDF),
 * the columns are recognised and can be chosen, and each line says new,
 * changed (with what it was), unchanged or what is wrong — a second paste
 * changes only what moved, so nothing is typed twice. Each paper shows how
 * many of the school's candidates sit it and which unit or award it belongs
 * to. Clashes are found for every candidate, across boards, with extra time
 * counted, and each carries a note of how it is handled. "Publish" shows each
 * family their statement of entry and timetable and tells them; a paper moved
 * afterwards tells only the families who sit it. Three steps (paste, check,
 * save) replace a day of copying, and nobody has to remember who sits what.
 */

import Link from 'next/link';
import { useMemo, useRef, useState, type RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, EXAM_SESSIONS, EXAM_SESSION_LABELS, type ExamSession, type UpdatePaperType } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { DateText, normalizeTime, isTime } from '../../academic/calendar/academic-shared';
import { InstantText, SELECT_CLASS } from '../exams-shared';
import {
  fetchClashes, fetchPapers, useSeriesChoice, SeriesSelect, SessionBadge, BoardText, Code, PrintButton, EXAMS_KEY,
  type PapersData, type ClashRow,
} from '../exam-f4-shared';
import { ImportPanel } from './import.client';
import { sessionOf, Minutes, Name, TimeSpan } from './timetable-shared';

type Paper = PapersData['papers'][number];

export default function TimetableClient(): React.JSX.Element {
  const { series, chosen, choose, isLoading: seriesLoading } = useSeriesChoice();
  const seriesId = chosen?.id ?? '';
  const papersQ = useQuery({ queryKey: [...EXAMS_KEY, 'papers', seriesId], queryFn: () => fetchPapers(seriesId), enabled: !!seriesId });

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-up">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Exam timetable</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground print:hidden">
            Paste the board&apos;s timetable once; each candidate&apos;s own timetable, their clashes and their statement of entry follow from their entries. Families see it when you publish.
          </p>
          {chosen && <p className="mt-1 hidden text-sm font-semibold text-foreground print:block"><BoardText>{chosen.name}</BoardText></p>}
        </div>
        <SeriesSelect series={series} value={chosen?.id} onChange={choose} className="print:hidden" />
      </div>

      {seriesLoading ? (
        <LoadingState label="Loading the series…" />
      ) : !chosen ? (
        <EmptyState title="No board series yet" message="Add the board's series on the Board series screen first; its timetable is kept here." />
      ) : papersQ.isLoading ? (
        <LoadingState label="Loading the timetable…" />
      ) : papersQ.isError || !papersQ.data ? (
        <ErrorState title="The timetable did not load" message={papersQ.error?.message ?? 'This is a connection problem, not an empty timetable. Try again.'} onRetry={() => papersQ.refetch()} />
      ) : (
        <>
          <PublishCard key={`publish-${seriesId}`} data={papersQ.data} />
          <ImportPanel key={`import-${seriesId}`} data={papersQ.data} />
          <PapersSection key={`papers-${seriesId}`} data={papersQ.data} />
          <ClashesSection key={`clashes-${seriesId}`} seriesId={seriesId} />
        </>
      )}
    </div>
  );
}

// ─── Publication ─────────────────────────────────────────────────────────────

function PublishCard({ data }: { data: PapersData }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const publish = useMutation({
    mutationFn: () => apiResponse(api.v1.exams.timetable.publish.$post({ json: { boardSeriesId: data.series.id } })),
    onSuccess: () => {
      setConfirming(false);
      setError('');
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
    },
    onError: (err: Error) => setError(err.message),
  });
  const at = data.published ? Date.parse(data.published.at) : null;
  const changedSince = at === null ? 0 : data.papers.filter((p) => Date.parse(p.updatedAt) > at || Date.parse(p.createdAt) > at).length;
  const told = publish.data;

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm print:hidden" aria-labelledby="publish-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="publish-title" className="text-sm font-semibold text-foreground">Families&apos; timetable</h2>
          {data.published ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground">
              <Badge tone="success">Published</Badge>
              <span><span>Version</span> <span className="tabular-nums">{data.published.version}</span></span>
              <span className="text-muted-foreground">·</span>
              <InstantText iso={data.published.at} />
            </p>
          ) : (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge tone="warning">Not published yet</Badge>
              <span>Families cannot see their statement of entry or exam timetable until it is published.</span>
            </p>
          )}
        </div>
        {!confirming && (
          <Button onClick={() => { setConfirming(true); setError(''); }} disabled={!data.papers.length}>
            {data.published ? 'Publish again' : 'Publish to families'}
          </Button>
        )}
      </div>

      {changedSince > 0 && (
        <Notice tone="warning" className="mt-3">
          <span className="tabular-nums">{changedSince}</span>{' '}
          <span>{changedSince === 1 ? 'paper was added or changed after the last publication.' : 'papers were added or changed after the last publication.'}</span>{' '}
          <span>Families whose paper moved were told of that paper; publish again so every family&apos;s timetable and statement are sent afresh.</span>
        </Notice>
      )}
      {data.unlinked > 0 && (
        <Notice tone="warning" className="mt-3">
          <span className="tabular-nums">{data.unlinked}</span>{' '}
          <span>{data.unlinked === 1 ? 'paper is not linked to the catalogue, so nobody is counted as sitting it.' : 'papers are not linked to the catalogue, so nobody is counted as sitting them.'}</span>{' '}
          <Link href="/exams/catalogue?tab=units" className="font-semibold underline underline-offset-2">Check the codes on the Catalogue</Link>
        </Notice>
      )}
      {confirming && (
        <Notice tone="info" className="mt-3" title={data.published ? 'Publish the timetable again?' : 'Publish the timetable to families?'}>
          <p>Every candidate with an entry sent to the board, and their parents, are told that their statement of entry and exam timetable are ready to check.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => publish.mutate()} disabled={publish.isPending}>{publish.isPending ? 'Publishing…' : 'Publish now'}</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={publish.isPending}>Cancel</Button>
          </div>
        </Notice>
      )}
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      {told && !confirming && (
        <Notice tone="success" className="mt-3">
          <span>Published: version</span> <span className="tabular-nums">{told.version}</span><span>.</span>{' '}
          <span className="tabular-nums">{told.candidatesTold}</span> <span>{told.candidatesTold === 1 ? 'candidate and their parents were told' : 'candidates and their parents were told'}</span>{' '}
          (<span className="tabular-nums">{told.notices}</span> <span>notices</span>).
        </Notice>
      )}
    </section>
  );
}

// ─── The papers ──────────────────────────────────────────────────────────────

function PapersSection({ data }: { data: PapersData }) {
  const byDate = useMemo(() => {
    const m = new Map<string, Paper[]>();
    for (const p of data.papers) m.set(p.examDate, [...(m.get(p.examDate) ?? []), p]);
    return [...m.entries()];
  }, [data.papers]);
  const published = !!data.published;
  // Kept here, not in the row: a paper moved to another day re-renders under that day.
  const [saved, setSaved] = useState<{ code: string; familiesTold: number } | null>(null);

  return (
    <section className="mb-8" aria-labelledby="papers-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="papers-title" className="font-display text-lg font-bold text-foreground">Papers</h2>
          <p className="text-sm text-muted-foreground print:hidden">
            <span className="tabular-nums">{data.papers.length}</span> <span>{data.papers.length === 1 ? 'paper' : 'papers'}</span>
            {data.series.examsStart && data.series.examsEnd && (
              <>
                {' · '}<span>exams from</span> <DateText date={data.series.examsStart} /> <span>to</span> <DateText date={data.series.examsEnd} />
              </>
            )}
          </p>
        </div>
        {data.papers.length > 0 && <PrintButton label="Print the timetable" />}
      </div>

      <AddPaperForm data={data} />

      {saved && (
        <Notice tone="success" className="mb-3 print:hidden">
          <span>Saved</span> <Code className="font-semibold">{saved.code}</Code><span>.</span>{' '}
          {saved.familiesTold > 0 ? (
            <><span>The families of</span> <span className="tabular-nums">{saved.familiesTold}</span> <span>{saved.familiesTold === 1 ? 'candidate were told of the new time.' : 'candidates were told of the new time.'}</span></>
          ) : published ? (
            <span>No family needed telling: the time did not move, or nobody sitting it has an entry sent to the board.</span>
          ) : (
            <span>The timetable is not published yet, so no family was told.</span>
          )}
        </Notice>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm print:overflow-visible print:shadow-none">
        <table className="w-full min-w-[980px] text-sm print:min-w-0">
          <thead className="border-b border-border bg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Session</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Time</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Duration</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Paper</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Title</th>
              {/* Printed, the catalogue and action columns collapse to nothing (hiding their cells would leave a column). */}
              <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground print:p-0"><span className="print:hidden">In the catalogue</span></th>
              <th scope="col" className="px-3 py-2 text-end font-semibold text-muted-foreground">Candidates</th>
              <th scope="col" className="px-3 py-2 text-end font-semibold text-muted-foreground print:p-0"><span className="print:hidden">Actions</span></th>
            </tr>
          </thead>
          {byDate.length === 0 ? (
            <tbody>
              <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No papers yet. Paste the board&apos;s timetable above, or add a paper by hand.</td></tr>
            </tbody>
          ) : byDate.map(([date, papers]) => (
            <tbody key={date} className="divide-y divide-border border-b border-border last:border-b-0">
              <tr className="bg-muted/40">
                <th scope="rowgroup" colSpan={8} className="px-3 py-1.5 text-start text-sm font-semibold text-foreground">
                  <DateText date={date} weekday long />
                </th>
              </tr>
              {papers.map((p) => <PaperLine key={p.id} p={p} published={published} onSaved={(familiesTold) => setSaved({ code: p.code, familiesTold })} onStart={() => setSaved(null)} />)}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

function CatalogueLink({ p }: { p: Paper }) {
  if (p.unitCode) {
    return (
      <span className="flex flex-wrap items-center gap-1">
        <Code className="text-xs">{p.unitCode}</Code>
        {p.unitShortCode && <Badge tone="neutral"><BoardText>{p.unitShortCode}</BoardText></Badge>}
      </span>
    );
  }
  if (p.qualificationCode) {
    return (
      <span className="flex flex-wrap items-center gap-1">
        <Code className="text-xs">{p.qualificationCode}</Code> <span className="text-xs text-muted-foreground">whole syllabus</span>
      </span>
    );
  }
  return <Badge tone="warning">Not linked</Badge>;
}

function PaperLine({ p, published, onSaved, onStart }: { p: Paper; published: boolean; onSaved: (familiesTold: number) => void; onStart: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const remove = useMutation({
    mutationFn: () => apiResponse(api.v1.exams.papers[':id'].$delete({ param: { id: p.id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: EXAMS_KEY }),
    onError: (err: Error) => { setConfirmDelete(false); setError(err.message); },
  });

  return (
    <>
      <tr className={cn(editing && 'bg-primary/5')}>
        <td className="px-3 py-2.5"><SessionBadge session={p.session} /></td>
        <td className="px-3 py-2.5 text-foreground"><TimeSpan start={p.startTime} end={p.endTime} /></td>
        <td className="px-3 py-2.5 text-foreground"><Minutes n={p.durationMinutes} /></td>
        <td className="px-3 py-2.5 font-semibold text-foreground"><Code>{p.code}</Code></td>
        <td className="px-3 py-2.5 text-foreground"><BoardText>{p.title}</BoardText></td>
        <td className="px-3 py-2.5 print:p-0"><span className="print:hidden"><CatalogueLink p={p} /></span></td>
        <td className="px-3 py-2.5 text-end tabular-nums text-foreground">{p.candidates}</td>
        <td className="px-3 py-2.5 text-end print:p-0 [&>*]:print:hidden">
          {confirmDelete ? (
            <span className="inline-flex flex-wrap items-center justify-end gap-1">
              <span className="text-xs text-muted-foreground">Delete this paper?</span>
              <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? 'Deleting…' : 'Delete'}</Button>
              <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => setConfirmDelete(false)}>Keep</Button>
            </span>
          ) : (
            <span className="inline-flex gap-1">
              <Button size="sm" variant="outline" onClick={() => { setEditing(!editing); setError(''); onStart(); }} aria-expanded={editing}>{editing ? 'Close' : 'Edit'}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setConfirmDelete(true); setError(''); onStart(); }}>Delete</Button>
            </span>
          )}
        </td>
      </tr>
      {error && !editing && (
        <tr className="print:hidden"><td colSpan={8} className="px-3 pb-3"><Notice tone="danger">{error}</Notice></td></tr>
      )}
      {editing && (
        <tr className="bg-primary/5 print:hidden">
          <td colSpan={8} className="px-3 pb-4">
            <EditPaperForm p={p} published={published} onDone={(n) => { setEditing(false); onSaved(n); }} onCancel={() => setEditing(false)} />
          </td>
        </tr>
      )}
    </>
  );
}

/** The fields a paper is typed with, shared by the add row and the edit row. */
type PaperDraft = { code: string; title: string; examDate: string; session: ExamSession; startTime: string; duration: string };

function PaperFields({ draft, onChange, idPrefix, sessionTouched, onSessionTouched, codeRef }: {
  draft: PaperDraft; onChange: (d: PaperDraft) => void; idPrefix: string;
  sessionTouched: boolean; onSessionTouched: () => void; codeRef?: RefObject<HTMLInputElement | null>;
}) {
  const setStart = (raw: string) => {
    const t = normalizeTime(raw);
    onChange({ ...draft, startTime: t, session: !sessionTouched && isTime(t) ? sessionOf(t) : draft.session });
  };
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <Label htmlFor={`${idPrefix}-code`} className="mb-1 text-xs text-muted-foreground">Paper code</Label>
        <Input id={`${idPrefix}-code`} ref={codeRef} dir="ltr" value={draft.code} onChange={(e) => onChange({ ...draft, code: e.target.value })} maxLength={30} placeholder="0610/42" className="w-32 font-mono" />
      </div>
      <div className="min-w-56 flex-1">
        <Label htmlFor={`${idPrefix}-title`} className="mb-1 text-xs text-muted-foreground">Title, as the board writes it</Label>
        <Input id={`${idPrefix}-title`} value={draft.title} onChange={(e) => onChange({ ...draft, title: e.target.value })} maxLength={200} data-i18n-skip="true" />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-date`} className="mb-1 text-xs text-muted-foreground">Date</Label>
        <Input id={`${idPrefix}-date`} type="date" dir="ltr" value={draft.examDate} onChange={(e) => onChange({ ...draft, examDate: e.target.value })} className="w-40" />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-start`} className="mb-1 text-xs text-muted-foreground">Start</Label>
        <Input
          id={`${idPrefix}-start`} dir="ltr" inputMode="numeric" value={draft.startTime} placeholder="08:30"
          onChange={(e) => onChange({ ...draft, startTime: e.target.value })} onBlur={(e) => setStart(e.target.value)}
          className="w-24 tabular-nums"
        />
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-session`} className="mb-1 text-xs text-muted-foreground">Session</Label>
        <select
          id={`${idPrefix}-session`} value={draft.session} className={cn(SELECT_CLASS, 'w-36')}
          onChange={(e) => { onSessionTouched(); onChange({ ...draft, session: e.target.value as ExamSession }); }}
        >
          {EXAM_SESSIONS.map((s) => <option key={s} value={s}>{EXAM_SESSION_LABELS[s]}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor={`${idPrefix}-duration`} className="mb-1 text-xs text-muted-foreground">Minutes</Label>
        <Input id={`${idPrefix}-duration`} dir="ltr" inputMode="numeric" value={draft.duration} onChange={(e) => onChange({ ...draft, duration: e.target.value.replace(/[^\d]/g, '') })} placeholder="90" className="w-24 tabular-nums" />
      </div>
    </div>
  );
}

function draftProblem(d: PaperDraft): string | null {
  if (!d.code.trim() || !d.title.trim()) return 'Give the paper its code and title.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.examDate)) return 'Choose the date.';
  if (!isTime(normalizeTime(d.startTime))) return 'Type the start time, such as 08:30.';
  const n = Number(d.duration);
  if (!Number.isInteger(n) || n < 5 || n > 480) return 'The duration is between 5 and 480 minutes.';
  return null;
}

function EditPaperForm({ p, published, onDone, onCancel }: { p: Paper; published: boolean; onDone: (familiesTold: number) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PaperDraft>({
    code: p.code, title: p.title, examDate: p.examDate, session: p.session as ExamSession, startTime: p.startTime, duration: String(p.durationMinutes),
  });
  const [sessionTouched, setSessionTouched] = useState(true);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const changes = (): UpdatePaperType => {
    const out: UpdatePaperType = {};
    if (draft.code.trim().toUpperCase() !== p.code) out.code = draft.code.trim();
    if (draft.title.trim() !== p.title) out.title = draft.title.trim();
    if (draft.examDate !== p.examDate) out.examDate = draft.examDate;
    if (draft.session !== p.session) out.session = draft.session;
    const start = normalizeTime(draft.startTime);
    if (start !== p.startTime) out.startTime = start;
    if (Number(draft.duration) !== p.durationMinutes) out.durationMinutes = Number(draft.duration);
    return out;
  };
  const moves = (c: UpdatePaperType) => c.examDate !== undefined || c.session !== undefined || c.startTime !== undefined || c.durationMinutes !== undefined;
  const save = useMutation({
    mutationFn: (json: UpdatePaperType) => apiResponse(api.v1.exams.papers[':id'].$put({ param: { id: p.id }, json })),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
      onDone(r.candidatesTold);
    },
    onError: (err: Error) => setError(err.message),
  });
  const c = changes();
  const needsReason = published && moves(c);

  return (
    <form
      className="space-y-3 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        const problem = draftProblem(draft);
        if (problem) return setError(problem);
        if (!Object.keys(c).length) return onCancel();
        if (needsReason && reason.trim().length < 3) return setError('Say why the paper moves — families are told, and it is recorded.');
        setError('');
        save.mutate({ ...c, ...(reason.trim().length >= 3 ? { reason: reason.trim() } : {}) });
      }}
    >
      <PaperFields draft={draft} onChange={setDraft} idPrefix={`edit-${p.id}`} sessionTouched={sessionTouched} onSessionTouched={() => setSessionTouched(true)} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-72 flex-1">
          <Label htmlFor={`edit-${p.id}-reason`} className="mb-1 text-xs text-muted-foreground">
            {needsReason ? 'Why it changes (required: the families who sit it are told)' : 'Why it changes (recorded)'}
          </Label>
          <Input id={`edit-${p.id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. the board moved it (notice of 12 October)" />
        </div>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={save.isPending}>Cancel</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save the paper'}</Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </form>
  );
}

function AddPaperForm({ data }: { data: PapersData }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const empty: PaperDraft = { code: '', title: '', examDate: data.series.examsStart ?? '', session: 'am', startTime: '', duration: '' };
  const [draft, setDraft] = useState<PaperDraft>(empty);
  const [sessionTouched, setSessionTouched] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const create = useMutation({
    mutationFn: () => apiResponse(api.v1.exams.papers.$post({
      json: {
        boardSeriesId: data.series.id, code: draft.code.trim(), title: draft.title.trim(), examDate: draft.examDate, session: draft.session,
        startTime: normalizeTime(draft.startTime), durationMinutes: Number(draft.duration),
      },
    })),
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
      // The next paper is often the same day and session: keep them.
      setDraft({ ...draft, code: '', title: '', duration: '' });
      setError('');
      setAdded(row.code);
      codeRef.current?.focus();
    },
    onError: (err: Error) => { setAdded(null); setError(err.message); },
  });

  if (!open) {
    return (
      <div className="mb-3 print:hidden">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>Add a paper by hand</Button>
      </div>
    );
  }
  return (
    <form
      className="mb-4 rounded-xl border border-border bg-primary/5 p-4 print:hidden"
      onSubmit={(e) => {
        e.preventDefault();
        const problem = draftProblem(draft);
        if (problem) return setError(problem);
        create.mutate();
      }}
    >
      <p className="mb-3 text-sm font-semibold text-foreground">Add a paper by hand</p>
      <PaperFields draft={draft} onChange={setDraft} idPrefix="add-paper" sessionTouched={sessionTouched} onSessionTouched={() => setSessionTouched(true)} codeRef={codeRef} />
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => { setOpen(false); setError(''); setAdded(null); }}>Close</Button>
        <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add the paper'}</Button>
      </div>
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      {added && !error && (
        <p className="mt-2 text-xs text-muted-foreground">
          <span>Added</span> <Code className="font-semibold text-foreground">{added}</Code><span>. The date and session stay for the next paper.</span>
        </p>
      )}
    </form>
  );
}

// ─── Clashes ─────────────────────────────────────────────────────────────────

function ClashesSection({ seriesId }: { seriesId: string }) {
  const q = useQuery({ queryKey: [...EXAMS_KEY, 'clashes', seriesId], queryFn: () => fetchClashes(seriesId) });
  const open = (q.data ?? []).filter((c) => !c.note).length;
  return (
    <section className="mb-8 print:hidden" aria-labelledby="clashes-title">
      <div className="mb-3">
        <h2 id="clashes-title" className="font-display text-lg font-bold text-foreground">Clashes</h2>
        <p className="text-sm text-muted-foreground">
          Candidates with two papers at the same time — across every board, with their extra time counted. Note how each is handled; the note is kept with the candidate.
        </p>
      </div>
      {q.isLoading ? (
        <LoadingState label="Looking for clashes…" />
      ) : q.isError ? (
        <ErrorState title="The clashes did not load" message={q.error.message} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Notice tone="success">No clashes: no candidate has two papers at once.</Notice>
      ) : (
        <>
          {open > 0 && (
            <Notice tone="warning" className="mb-3">
              <span className="tabular-nums">{open}</span> <span>{open === 1 ? 'clash has no note yet.' : 'clashes have no note yet.'}</span>
            </Notice>
          )}
          <ul className="space-y-3">
            {q.data.map((c) => <ClashLine key={`${c.studentId}-${c.papers[0]?.paperId}-${c.papers[1]?.paperId}`} c={c} />)}
          </ul>
        </>
      )}
    </section>
  );
}

function ClashPaper({ p }: { p: ClashRow['papers'][number] }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-border bg-background p-3">
      <p className="flex flex-wrap items-center gap-2">
        <Code className="font-semibold text-foreground">{p.code}</Code>
        <BoardText className="text-sm text-foreground">{p.title}</BoardText>
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <DateText date={p.examDate} weekday />
        <SessionBadge session={p.session} />
        <TimeSpan start={p.startTime} end={p.endTime} className="text-foreground" />
        {p.extraMinutes > 0 && (
          <Badge tone="info"><span dir="ltr">+{p.extraMinutes}</span>&nbsp;<span>min extra time</span></Badge>
        )}
      </p>
    </div>
  );
}

function ClashLine({ c }: { c: ClashRow }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState(c.note ?? '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => apiResponse(api.v1.exams.clashes.$put({ json: { studentId: c.studentId, paperIds: [c.papers[0]!.paperId, c.papers[1]!.paperId], resolution: note.trim() } })),
    onSuccess: () => { setError(''); setSaved(true); queryClient.invalidateQueries({ queryKey: EXAMS_KEY }); },
    onError: (err: Error) => { setSaved(false); setError(err.message); },
  });
  const [a, b] = c.papers;
  return (
    <li className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Name className="font-semibold text-foreground">{c.studentName}</Name>
        {c.candidateNumber && (
          <span className="text-sm text-muted-foreground"><span>Candidate</span> <Code>{c.candidateNumber}</Code></span>
        )}
        {c.note ? <Badge tone="success">Handled</Badge> : <Badge tone="warning">No note yet</Badge>}
      </div>
      <div className="flex flex-col gap-2 md:flex-row">
        {a && <ClashPaper p={a} />}
        {b && <ClashPaper p={b} />}
      </div>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (note.trim().length < 3) return setError('Write how the clash is handled (at least 3 characters).');
          save.mutate();
        }}
      >
        <div className="min-w-72 flex-1">
          <Label htmlFor={`clash-${c.studentId}-${a?.paperId}`} className="mb-1 text-xs text-muted-foreground">How it is handled</Label>
          <Input
            id={`clash-${c.studentId}-${a?.paperId}`} value={note} maxLength={500}
            onChange={(e) => { setNote(e.target.value); setSaved(false); }}
            placeholder="e.g. sits 0610/42 first, then 0620/42 under supervision in Room 101"
          />
        </div>
        <Button type="submit" size="sm" disabled={save.isPending || note.trim() === (c.note ?? '')}>{save.isPending ? 'Saving…' : 'Save the note'}</Button>
      </form>
      {error && <Notice tone="danger" className="mt-2">{error}</Notice>}
      {saved && !error && <p className="mt-2 text-xs text-muted-foreground">Saved.</p>}
    </li>
  );
}

