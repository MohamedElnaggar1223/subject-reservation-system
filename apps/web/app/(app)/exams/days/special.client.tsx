'use client';

/**
 * Special consideration for a series (docs/features/EXAM_ENTRIES.md §4).
 *
 * The paper version: a parent brings a doctor's note to the office; it is
 * photocopied, filed in a folder, emailed to the coordinator, typed into the
 * board's portal, and the board's reference and outcome are written on the
 * folder's cover — if anyone remembers to come back to it.
 *
 * Here: one line per request with the candidate, the paper, what happened and
 * the scanned evidence (uploaded for that student), then "Mark as sent" with
 * the board's reference and "Record the outcome" when the board answers. What
 * is still waiting to be sent, or waiting for the board, shows at the top.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse, SPECIAL_CONSIDERATION_CATEGORIES, SPECIAL_CONSIDERATION_CATEGORY_LABELS,
  type CreateSpecialConsiderationType, type UpdateSpecialConsiderationType,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice, type Tone } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { DateText } from '../../academic/calendar/academic-shared';
import { InstantText, SELECT_CLASS } from '../exams-shared';
import {
  fetchCandidates, fetchPapers, fetchSpecialConsiderations, fetchStudentTimetable, BoardText, Code, EXAMS_KEY, type BoardSeriesRow,
} from '../exam-f4-shared';
import { Name } from '../timetable/timetable-shared';

type Case = Awaited<ReturnType<typeof fetchSpecialConsiderations>>[number];
type Category = (typeof SPECIAL_CONSIDERATION_CATEGORIES)[number];

const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Not sent yet', tone: 'warning' },
  submitted: { label: 'Sent to the board', tone: 'info' },
  outcome_received: { label: 'Outcome received', tone: 'success' },
};

const uploadEvidence = (file: File, studentId: string) =>
  apiResponse(api.v1.files.upload.$post({ form: { file, purpose: 'supporting_document', studentId } }));

const evidenceUrl = (id: string) => api.v1.files[':id'].content.$url({ param: { id }, query: {} }).toString();

export function SpecialConsideration({ series }: { series: BoardSeriesRow }): React.JSX.Element {
  const q = useQuery({ queryKey: [...EXAMS_KEY, 'special', series.id], queryFn: () => fetchSpecialConsiderations(series.id) });
  const [open, setOpen] = useState(false);
  const toSend = (q.data ?? []).filter((c) => c.status === 'draft').length;
  const waiting = (q.data ?? []).filter((c) => c.status === 'submitted').length;

  return (
    <section className="mt-10" aria-labelledby="sc-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="sc-title" className="font-display text-lg font-bold text-foreground">Special consideration</h2>
          <p className="text-sm text-muted-foreground">
            <span>For</span> <BoardText className="font-medium text-foreground">{series.name}</BoardText><span>: illness, bereavement or a disturbance on the day, with the evidence, sent to the board and its outcome.</span>
          </p>
        </div>
        {!open && <Button onClick={() => setOpen(true)}>Open a request</Button>}
      </div>

      {open && <OpenCaseForm series={series} onClose={() => setOpen(false)} />}

      {q.isLoading ? (
        <LoadingState label="Loading special consideration…" />
      ) : q.isError ? (
        <ErrorState title="Special consideration did not load" message={q.error.message} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">No request in this series.</p>
      ) : (
        <>
          {(toSend > 0 || waiting > 0) && (
            <p className="mb-3 flex flex-wrap gap-2 text-sm">
              {toSend > 0 && <Badge tone="warning"><span className="tabular-nums">{toSend}</span>&nbsp;<span>to send to the board</span></Badge>}
              {waiting > 0 && <Badge tone="info"><span className="tabular-nums">{waiting}</span>&nbsp;<span>waiting for the board</span></Badge>}
            </p>
          )}
          <ul className="space-y-3">
            {q.data.map((c) => <CaseLine key={c.id} c={c} />)}
          </ul>
        </>
      )}
    </section>
  );
}

function CaseLine({ c }: { c: Case }) {
  const queryClient = useQueryClient();
  const [reference, setReference] = useState(c.boardReference ?? '');
  const [outcome, setOutcome] = useState(c.outcome ?? '');
  const [error, setError] = useState('');
  const update = useMutation({
    mutationFn: (json: UpdateSpecialConsiderationType) => apiResponse(api.v1.exams['special-consideration'][':id'].$put({ param: { id: c.id }, json })),
    onSuccess: () => { setError(''); queryClient.invalidateQueries({ queryKey: EXAMS_KEY }); },
    onError: (err: Error) => setError(err.message),
  });
  const attach = useMutation({
    mutationFn: async (file: File) => {
      const f = await uploadEvidence(file, c.studentId);
      return apiResponse(api.v1.exams['special-consideration'][':id'].$put({ param: { id: c.id }, json: { evidenceFileId: f.id } }));
    },
    onSuccess: () => { setError(''); queryClient.invalidateQueries({ queryKey: EXAMS_KEY }); },
    onError: (err: Error) => setError(err.message),
  });
  const s = STATUS[c.status] ?? { label: c.status, tone: 'neutral' as Tone };

  return (
    <li className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Name className="font-semibold text-foreground">{c.studentName}</Name>
        {c.paperCode ? <Code className="text-sm">{c.paperCode}</Code> : <span className="text-sm text-muted-foreground">Every paper in the series</span>}
        <Badge tone="neutral">{SPECIAL_CONSIDERATION_CATEGORY_LABELS[c.category as Category] ?? c.category}</Badge>
        <Badge tone={s.tone}>{s.label}</Badge>
        <span className="ms-auto text-xs text-muted-foreground"><span>Opened</span> <InstantText iso={c.createdAt} /></span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground" data-i18n-skip="true">{c.description}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">Evidence</span>
        {c.evidenceFileId ? (
          <a href={evidenceUrl(c.evidenceFileId)} target="_blank" rel="noreferrer" className="font-semibold text-primary underline underline-offset-2">Open the evidence</a>
        ) : (
          <label className="inline-flex cursor-pointer items-center gap-2">
            <span className="text-amber-700 dark:text-amber-400">None attached</span>
            <span className="rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold hover:bg-accent">{attach.isPending ? 'Uploading…' : 'Attach a scan'}</span>
            <input
              type="file" accept="application/pdf,image/*,.docx" className="sr-only" disabled={attach.isPending}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) attach.mutate(f); e.target.value = ''; }}
            />
          </label>
        )}
        {c.boardReference && (
          <span><span className="text-muted-foreground">Board&apos;s reference</span> <Code className="font-semibold">{c.boardReference}</Code></span>
        )}
        {c.submittedAt && (
          <span><span className="text-muted-foreground">Sent</span> <InstantText iso={c.submittedAt} /></span>
        )}
      </div>

      {c.status === 'draft' && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reference.trim()) return setError("Type the board's reference for the request.");
            update.mutate({ status: 'submitted', boardReference: reference.trim() });
          }}
        >
          <div>
            <Label htmlFor={`sc-ref-${c.id}`} className="mb-1 text-xs text-muted-foreground">The board&apos;s reference</Label>
            <Input id={`sc-ref-${c.id}`} dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} className="w-56 font-mono" />
          </div>
          <Button type="submit" size="sm" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Mark as sent'}</Button>
        </form>
      )}
      {c.status === 'submitted' && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!outcome.trim()) return setError("Write the board's answer.");
            update.mutate({ status: 'outcome_received', outcome: outcome.trim() });
          }}
        >
          <div className="min-w-72 flex-1">
            <Label htmlFor={`sc-outcome-${c.id}`} className="mb-1 text-xs text-muted-foreground">The board&apos;s answer</Label>
            <Input id={`sc-outcome-${c.id}`} value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={2000} placeholder="e.g. 3% allowance on 0610/42" />
          </div>
          <Button type="submit" size="sm" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Record the outcome'}</Button>
        </form>
      )}
      {c.status === 'outcome_received' && c.outcome && (
        <p className="mt-3 border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Outcome</span>{' '}
          <span className="text-foreground" data-i18n-skip="true">{c.outcome}</span>
        </p>
      )}
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
    </li>
  );
}

function OpenCaseForm({ series, onClose }: { series: BoardSeriesRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const candidatesQ = useQuery({ queryKey: [...EXAMS_KEY, 'candidates', { boardSeriesId: series.id }], queryFn: () => fetchCandidates({ boardSeriesId: series.id }) });
  const papersQ = useQuery({ queryKey: [...EXAMS_KEY, 'papers', series.id], queryFn: () => fetchPapers(series.id) });
  const [studentId, setStudentId] = useState('');
  const timetableQ = useQuery({
    queryKey: [...EXAMS_KEY, 'student-timetable', studentId, series.id],
    queryFn: () => fetchStudentTimetable(studentId, series.id),
    enabled: !!studentId,
  });
  const [paperId, setPaperId] = useState('');
  const [category, setCategory] = useState<Category>('illness');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const candidates = [...(candidatesQ.data?.candidates ?? [])].filter((c) => c.entryCount > 0).sort((a, b) => a.name.localeCompare(b.name));
  // The candidate's own papers in this series; before the timetable loads, none.
  const theirPapers = (timetableQ.data?.papers ?? []).filter((p) => p.boardSeriesId === series.id);
  const paperTitle = (id: string) => papersQ.data?.papers.find((p) => p.id === id)?.title ?? '';

  const create = useMutation({
    mutationFn: async () => {
      const evidenceFileId = file ? (await uploadEvidence(file, studentId)).id : null;
      const json: CreateSpecialConsiderationType = {
        studentId, boardSeriesId: series.id, paperId: paperId || null, category, description: description.trim(), evidenceFileId,
      };
      return apiResponse(api.v1.exams['special-consideration'].$post({ json }));
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: EXAMS_KEY }); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <form
      className="mb-4 rounded-xl border border-border bg-primary/5 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!studentId) return setError('Choose the candidate.');
        if (description.trim().length < 3) return setError('Say what happened (at least 3 characters).');
        setError('');
        create.mutate();
      }}
    >
      <p className="mb-3 text-sm font-semibold text-foreground">Open a request</p>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="sc-candidate" className="mb-1 text-xs text-muted-foreground">Candidate</Label>
          <select id="sc-candidate" value={studentId} onChange={(e) => { setStudentId(e.target.value); setPaperId(''); }} className={SELECT_CLASS} disabled={candidatesQ.isLoading}>
            <option value="">{candidatesQ.isLoading ? 'Loading the candidates…' : 'Choose…'}</option>
            {candidates.map((c) => (
              <option key={c.studentId} value={c.studentId} data-i18n-skip="true">{c.candidateNumber ? `${c.candidateNumber} · ` : ''}{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="sc-paper" className="mb-1 text-xs text-muted-foreground">Paper</Label>
          <select id="sc-paper" value={paperId} onChange={(e) => setPaperId(e.target.value)} className={SELECT_CLASS} disabled={!studentId || timetableQ.isLoading}>
            <option value="">Every paper in the series</option>
            {theirPapers.map((p) => (
              <option key={p.paperId} value={p.paperId} data-i18n-skip="true">{p.code} · {p.examDate} · {paperTitle(p.paperId) || p.title}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="sc-category" className="mb-1 text-xs text-muted-foreground">What kind</Label>
          <select id="sc-category" value={category} onChange={(e) => setCategory(e.target.value as Category)} className={SELECT_CLASS}>
            {SPECIAL_CONSIDERATION_CATEGORIES.map((k) => <option key={k} value={k}>{SPECIAL_CONSIDERATION_CATEGORY_LABELS[k]}</option>)}
          </select>
        </div>
      </div>
      {paperId && (() => {
        const p = theirPapers.find((x) => x.paperId === paperId);
        return p ? <p className="mt-2 text-xs text-muted-foreground"><Code>{p.code}</Code> · <DateText date={p.examDate} weekday /></p> : null;
      })()}
      <div className="mt-3">
        <Label htmlFor="sc-description" className="mb-1 text-xs text-muted-foreground">What happened</Label>
        <textarea
          id="sc-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="sc-evidence" className="mb-1 text-xs text-muted-foreground">Evidence (a scan or photo of the note; can be added later)</Label>
          <label htmlFor="sc-evidence" className={cn('inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm', !studentId && 'pointer-events-none opacity-50')}>
            <span className="font-semibold">Choose a file</span>
            {file ? <Name className="text-muted-foreground">{file.name}</Name> : <span className="text-muted-foreground">No file chosen</span>}
          </label>
          <input id="sc-evidence" type="file" accept="application/pdf,image/*,.docx" className="sr-only" disabled={!studentId} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <span className="ms-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Open the request'}</Button>
        </span>
      </div>
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
    </form>
  );
}
