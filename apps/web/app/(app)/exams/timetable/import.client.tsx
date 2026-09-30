'use client';

/**
 * "Paste the board's timetable" (docs/features/EXAM_ENTRIES.md §4, Papers).
 *
 * The spreadsheet version: the board's timetable is retyped paper by paper
 * into the school's sheet, and when the board sends a corrected timetable the
 * two are compared line by line by eye.
 *
 * Here: the board's table is pasted as it is, headings first. The API reads
 * it and says which column it took for each field — each a choice that reads
 * the paste again at once — and, per line, new, changed (the old value shown
 * beside the new), unchanged, or what it cannot read, and whether the paper
 * belongs to a unit or award in the catalogue. Nothing is saved until "Save",
 * and a paste of the same timetable again saves nothing.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, TIMETABLE_FIELDS, TIMETABLE_FIELD_LABELS, type TimetableField } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { Badge, Notice, type Tone } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { DateText } from '../../academic/calendar/academic-shared';
import { SELECT_CLASS } from '../exams-shared';
import { SessionBadge, BoardText, Code, EXAMS_KEY, type PapersData } from '../exam-f4-shared';
import { Minutes } from './timetable-shared';

type Mapping = Partial<Record<TimetableField, string>>;

const readTimetable = (json: { boardSeriesId: string; text: string; mapping: Mapping; commit: boolean }) =>
  apiResponse(api.v1.exams.papers.import.$post({ json }));
type ImportResult = Awaited<ReturnType<typeof readTimetable>>;
type Line = ImportResult['lines'][number];

const REQUIRED: TimetableField[] = ['code', 'date', 'startTime', 'duration'];

const OUTCOME: Record<Line['outcome'], { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'success' },
  changed: { label: 'Changed', tone: 'warning' },
  unchanged: { label: 'Unchanged', tone: 'neutral' },
  error: { label: 'Cannot be read', tone: 'danger' },
};

export function ImportPanel({ data }: { data: PapersData }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(data.papers.length === 0);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<{ result: ImportResult; text: string } | null>(null);
  const [saved, setSaved] = useState<ImportResult['summary'] | null>(null);
  const [error, setError] = useState('');

  const read = useMutation({
    mutationFn: (v: { mapping: Mapping; commit: boolean }) => readTimetable({ boardSeriesId: data.series.id, text, mapping: v.mapping, commit: v.commit }),
    onSuccess: (r) => {
      setError('');
      if (r.committed) {
        setSaved(r.summary);
        setPreview(null);
        setText('');
        queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
      } else {
        setSaved(null);
        setPreview({ result: r, text });
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  const mapping: Mapping = preview?.result.mapping ?? {};
  const remap = (field: TimetableField, header: string) => {
    const next: Mapping = { ...mapping };
    // A column is one field's: taking it for this field frees it elsewhere.
    for (const f of TIMETABLE_FIELDS) if (f !== field && next[f] === header) delete next[f];
    if (header) next[field] = header;
    else delete next[field];
    read.mutate({ mapping: next, commit: false });
  };

  const r = preview?.result;
  const stale = !!preview && preview.text !== text;
  const toSave = r ? r.summary.new + r.summary.changed : 0;
  const blocked = !r || stale || r.missingColumns.length > 0 || r.summary.errors > 0 || toSave === 0;
  const before = (l: Line) => (l.paperId ? data.papers.find((p) => p.id === l.paperId) : undefined);

  if (!open) {
    return (
      <div className="mb-6 print:hidden">
        <Button variant="outline" onClick={() => setOpen(true)}>Paste the board&apos;s timetable</Button>
        {saved && <SavedNotice s={saved} published={!!data.published} />}
      </div>
    );
  }

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm print:hidden" aria-labelledby="import-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="import-title" className="text-sm font-semibold text-foreground">Paste the board&apos;s timetable</h2>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
            Copy the board&apos;s timetable table — from its Excel file, or select the table in its PDF — with its headings row, and paste it here. Tabs or commas both work. Dates such as 2026-11-02, 02/11/2026 or 2 November 2026; times such as 09:00 or 1:30 pm; durations such as 90, 1:30 or 1h 30m.
          </p>
        </div>
        {data.papers.length > 0 && <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>}
      </div>

      <Label htmlFor="timetable-paste" className="mb-1 mt-3 text-xs text-muted-foreground">The board&apos;s timetable, headings on the first line</Label>
      <textarea
        id="timetable-paste"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        dir="ltr"
        spellCheck={false}
        placeholder="Paste here: headings on the first line, one paper on each line after it"
        className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button onClick={() => read.mutate({ mapping: {}, commit: false })} disabled={!text.trim() || read.isPending}>
          {read.isPending && !read.variables?.commit ? 'Reading…' : preview ? 'Read it again' : 'Read the timetable'}
        </Button>
        {stale && <span className="text-xs text-amber-700 dark:text-amber-400">The text changed since it was read: read it again before saving.</span>}
      </div>
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      {saved && <SavedNotice s={saved} published={!!data.published} />}

      {r && (
        <div className="mt-4 space-y-4">
          <fieldset className="rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold text-foreground">Which column is which</legend>
            <p className="mb-2 text-xs text-muted-foreground">Guessed from the headings. Change one and the paste is read again.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {TIMETABLE_FIELDS.map((f) => {
                const missing = r.missingColumns.includes(f);
                return (
                  <div key={f}>
                    <Label htmlFor={`map-${f}`} className="mb-1 text-xs text-muted-foreground">
                      <span>{TIMETABLE_FIELD_LABELS[f]}</span>
                      {!REQUIRED.includes(f) && <span>(optional)</span>}
                    </Label>
                    <select
                      id={`map-${f}`}
                      value={mapping[f] ?? ''}
                      onChange={(e) => remap(f, e.target.value)}
                      disabled={read.isPending}
                      className={cn(SELECT_CLASS, missing && 'border-destructive')}
                      aria-invalid={missing || undefined}
                    >
                      <option value="">Not in the paste</option>
                      {r.header.map((h) => <option key={h} value={h} data-i18n-skip="true">{h}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
            {r.missingColumns.length > 0 && (
              <Notice tone="danger" className="mt-3">
                <span>Say which column holds:</span>{' '}
                {r.missingColumns.map((f, i) => (
                  <span key={f}>{i > 0 && ', '}<span>{TIMETABLE_FIELD_LABELS[f as TimetableField] ?? f}</span></span>
                ))}
              </Notice>
            )}
          </fieldset>

          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="success"><span className="tabular-nums">{r.summary.new}</span>&nbsp;<span>new</span></Badge>
            <Badge tone="warning"><span className="tabular-nums">{r.summary.changed}</span>&nbsp;<span>changed</span></Badge>
            <Badge tone="neutral"><span className="tabular-nums">{r.summary.unchanged}</span>&nbsp;<span>unchanged</span></Badge>
            {r.summary.errors > 0 && <Badge tone="danger"><span className="tabular-nums">{r.summary.errors}</span>&nbsp;<span>cannot be read</span></Badge>}
            {r.summary.unlinked > 0 && <Badge tone="warning"><span className="tabular-nums">{r.summary.unlinked}</span>&nbsp;<span>not in the catalogue</span></Badge>}
          </p>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b border-border bg-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Line</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Outcome</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Paper</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Title</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Date</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Session</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Start</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Duration</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">In the catalogue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.lines.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">The paste has headings but no lines under them.</td></tr>
                ) : r.lines.map((l) => {
                  const was = before(l);
                  const o = OUTCOME[l.outcome];
                  const changed = l.outcome === 'changed' && was;
                  return (
                    <tr key={l.line} className={cn(l.outcome === 'error' && 'bg-red-50/60 dark:bg-red-900/10')}>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{l.line}</td>
                      <td className="px-3 py-2">
                        <Badge tone={o.tone}>{o.label}</Badge>
                        {l.problems.length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-xs text-red-700 dark:text-red-400">
                            {l.problems.map((p) => <li key={p}>{p}</li>)}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2 font-semibold text-foreground">{l.code ? <Code>{l.code}</Code> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2 text-foreground">
                        <BoardText>{l.title}</BoardText>
                        {changed && was.title !== l.title && <Was><BoardText>{was.title}</BoardText></Was>}
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        {l.examDate ? <DateText date={l.examDate} weekday /> : <span className="text-muted-foreground">—</span>}
                        {changed && was.examDate !== l.examDate && <Was><DateText date={was.examDate} weekday /></Was>}
                      </td>
                      <td className="px-3 py-2">
                        {l.session ? <SessionBadge session={l.session} /> : <span className="text-muted-foreground">—</span>}
                        {changed && was.session !== l.session && <Was><SessionBadge session={was.session} /></Was>}
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        {l.startTime ? <span dir="ltr" className="tabular-nums">{l.startTime}</span> : <span className="text-muted-foreground">—</span>}
                        {changed && was.startTime !== l.startTime && <Was><span dir="ltr" className="tabular-nums">{was.startTime}</span></Was>}
                      </td>
                      <td className="px-3 py-2 text-foreground">
                        {l.durationMinutes ? <Minutes n={l.durationMinutes} /> : <span className="text-muted-foreground">—</span>}
                        {changed && was.durationMinutes !== l.durationMinutes && <Was><Minutes n={was.durationMinutes} /></Was>}
                      </td>
                      <td className="px-3 py-2">
                        {!l.code ? null : l.linked ? (
                          <Badge tone="success">{l.unitId ? 'Unit linked' : 'Syllabus linked'}</Badge>
                        ) : (
                          <Badge tone="warning">Not in the catalogue</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {!stale && r.summary.errors > 0 && (
              <span className="text-sm text-red-700 dark:text-red-400">Fix the lines that cannot be read in the paste (or remove them), then read it again.</span>
            )}
            {!stale && !r.summary.errors && !r.missingColumns.length && toSave === 0 && (
              <span className="text-sm text-muted-foreground">Nothing to save: every line is already on the timetable as it is.</span>
            )}
            <Button onClick={() => read.mutate({ mapping, commit: true })} disabled={blocked || read.isPending}>
              {read.isPending && read.variables?.commit ? 'Saving…' : (
                <><span>Save</span> <span className="tabular-nums">{toSave}</span> <span>{toSave === 1 ? 'paper' : 'papers'}</span></>
              )}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Was({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <span>was</span> <span className="line-through">{children}</span>
    </p>
  );
}

function SavedNotice({ s, published }: { s: ImportResult['summary']; published: boolean }) {
  return (
    <Notice tone="success" className="mt-3">
      <span>Saved:</span> <span className="tabular-nums">{s.new}</span> <span>new</span>, <span className="tabular-nums">{s.changed}</span> <span>changed</span>.
      {published && s.changed > 0 && <> <span>The families of candidates whose papers moved were told.</span></>}
    </Notice>
  );
}
