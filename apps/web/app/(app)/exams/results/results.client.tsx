'use client';

/**
 * Exam results (FEATURES_PLAN.md F4, "Results"; docs/features/EXAM_ENTRIES.md §5).
 *
 * The spreadsheet version: the board's broadsheet (Cambridge) or results
 * file (Pearson) is opened next to the school's sheet and each candidate's
 * grade is found by candidate number and typed across by hand — one wrong
 * row is a wrong grade on a family's phone. A candidate number nobody knows
 * is noticed by eye, or not at all. A remark that comes back overwrites the
 * first grade, so later nobody can say what the board first reported. Then
 * each family is messaged one by one.
 *
 * Here: the file goes in as it came (uploaded, or pasted). Its columns are
 * read through a mapping chosen once per board and saved — the first time
 * it is guessed from the headings and shown beside the file's first rows to
 * check. Before anything is saved every line says what it will do: new,
 * already saved, a grade the board changed (previous → new), or a candidate
 * or code nobody here knows, with the reason. Saving adds rows and never
 * overwrites one, so a revised grade stands beside the first report. One
 * button publishes the series to every family and tells them; which grade
 * counts after a remark stays the owner's question (RF-09).
 */

import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, schoolDateString, type ResultMappingType } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice, type Tone } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { useCatalogue, InstantText, MaybeDate, SELECT_CLASS, type BoardSeriesRow } from '../exams-shared';
import { fetchResults, fetchEntries, EXAMS_KEY, useSeriesChoice, SeriesSelect, BoardText, Code, type EntryRow } from '../exam-f4-shared';

// ─── Requests (types come from the API) ──────────────────────────────────────

type ImportJson = Parameters<typeof api.v1.exams.results.import.$post>[0]['json'];
const readResults = (json: ImportJson) => apiResponse(api.v1.exams.results.import.$post({ json }));
type ImportAnswer = Awaited<ReturnType<typeof readResults>>;
type ImportLine = ImportAnswer['lines'][number];
type Outcome = ImportLine['outcome'];

const publishResults = (boardSeriesId: string) => apiResponse(api.v1.exams.results.publish.$post({ json: { boardSeriesId } }));
type PublishAnswer = Awaited<ReturnType<typeof publishResults>>;

const uploadImportFile = (file: File) => apiResponse(api.v1.files.upload.$post({ form: { file, purpose: 'import_file' } }));

type ResultRow = Awaited<ReturnType<typeof fetchResults>>['results'][number];

/** Where the lines come from: a file uploaded as an import file, or text pasted. */
type Source = { fileId: string; name: string } | { text: string; name: string };
const sourceJson = (s: Source): ImportJson['source'] => ('fileId' in s ? { fileId: s.fileId } : { text: s.text, name: s.name });

const OUTCOMES: { key: Outcome; label: string; tone: Tone }[] = [
  { key: 'new', label: 'New', tone: 'success' },
  { key: 'revised', label: 'Grade changed by the board', tone: 'warning' },
  { key: 'unchanged', label: 'Already saved', tone: 'neutral' },
  { key: 'unknown_candidate', label: 'Unknown candidate', tone: 'danger' },
  { key: 'unknown_code', label: 'Unknown code', tone: 'danger' },
];
const OUTCOME = Object.fromEntries(OUTCOMES.map((o) => [o.key, o])) as Record<Outcome, (typeof OUTCOMES)[number]>;

// ─── Guessing columns when the staff change the headings row or the shape ────
// (the API guesses the first mapping itself; these only follow a change)

const CODE_HEADING = /^[0-9A-Z]{3,6}(?:\/[0-9]{1,2})?\b/;

function headingsOf(sample: string[][], row: number): string[] {
  return (sample[row - 1] ?? []).map((h) => h.trim()).filter(Boolean);
}

function guessCandidate(header: string[]): { candidateColumn: string; candidateKey: ResultMappingType['candidateKey'] } {
  const number = header.find((h) => /(candidate\s*(no|number|#)|cand\.?\s*no)/i.test(h));
  const uci = header.find((h) => /\buci\b/i.test(h));
  const col = number ?? uci ?? header.find((h) => /candidate/i.test(h) && !/name/i.test(h)) ?? header[0] ?? '';
  return { candidateColumn: col, candidateKey: col && col === uci ? 'uci' : 'candidate_number' };
}

function guessWide(header: string[], candidateColumn: string): string[] {
  return header.filter((h) => h !== candidateColumn && !/(name|dob|birth|sex|gender|uci|candidate)/i.test(h) && CODE_HEADING.test(h.toUpperCase()));
}

function guessLong(header: string[]) {
  return {
    codeColumn: header.find((h) => /(unit|syllabus|entry|subject)\s*code|^code$|^unit$|^syllabus$/i.test(h)),
    gradeColumn: header.find((h) => /grade|result/i.test(h)),
    markColumn: header.find((h) => /(ums|mark|score|pum)/i.test(h)),
  };
}

// ─── The screen ──────────────────────────────────────────────────────────────

export default function ResultsClient(): React.JSX.Element {
  const { series, chosen: next, choose, isLoading } = useSeriesChoice();
  const params = useSearchParams();
  // Results come after the exams: unless one is chosen, open the latest series whose exams have begun
  // (the shared picker's default is the next deadline, which is the entries screens' concern).
  const today = schoolDateString(new Date());
  const chosen = params.get('series') ? next : series.find((s) => (s.examsStart ?? '9999') <= today) ?? next;
  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-up">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Exam results</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Read a board&apos;s results file into the series, check every line before it is saved, then publish the results to families. Nothing is ever overwritten: a grade the board changes is kept beside the first one.
          </p>
        </div>
        <SeriesSelect series={series} value={chosen?.id} onChange={choose} />
      </div>

      {isLoading ? (
        <LoadingState label="Loading the series…" />
      ) : !chosen ? (
        <EmptyState title="No board series yet" message="Add each board's series on the Board series screen first; results are read into a series." />
      ) : (
        <>
          <ImportPanel key={`import-${chosen.id}`} series={chosen} />
          <SeriesResults key={`results-${chosen.id}`} series={chosen} />
        </>
      )}
    </div>
  );
}

// ─── Importing a file ────────────────────────────────────────────────────────

function ImportPanel({ series }: { series: BoardSeriesRow }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [text, setText] = useState('');
  const [source, setSource] = useState<Source | null>(null);
  const [answer, setAnswer] = useState<ImportAnswer | null>(null);
  const [mapping, setMapping] = useState<ResultMappingType | null>(null);
  const [saveMapping, setSaveMapping] = useState({ on: false, name: '' });
  const [saved, setSaved] = useState<{ answer: ImportAnswer; mappingName: string | null } | null>(null);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  // Only the latest read counts: two quick changes of the mapping must not
  // leave the older answer on screen.
  const latest = useRef(0);

  const preview = useMutation({
    mutationFn: (v: { source: Source; mapping: ResultMappingType | null; seq: number }) =>
      readResults({ boardSeriesId: series.id, source: sourceJson(v.source), ...(v.mapping ? { mapping: v.mapping } : {}), commit: false }),
    onSuccess: (a, v) => {
      if (v.seq !== latest.current) return;
      setAnswer(a);
      setMapping(a.mapping);
      setError('');
      if (!v.mapping) {
        const savedName = a.mappingFrom === 'saved' ? a.mappingName : null;
        setSaveMapping({ on: !savedName, name: savedName ?? `${series.boardName} results file` });
      }
    },
    onError: (err: Error, v) => {
      if (v.seq === latest.current) setError(err.message);
    },
  });
  const read = (s: Source, m: ResultMappingType | null) => {
    latest.current += 1;
    setSaved(null);
    preview.mutate({ source: s, mapping: m, seq: latest.current });
  };

  const upload = useMutation({
    mutationFn: (file: File) => uploadImportFile(file),
    onSuccess: (f) => {
      const s = { fileId: f.id, name: f.name };
      setSource(s);
      read(s, null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const commit = useMutation({
    mutationFn: () => {
      const name = saveMapping.on ? saveMapping.name.trim() : '';
      return readResults({ boardSeriesId: series.id, source: sourceJson(source!), mapping: mapping!, commit: true, ...(name ? { saveMappingAs: name } : {}) });
    },
    onSuccess: (a) => {
      setSaved({ answer: a, mappingName: saveMapping.on && saveMapping.name.trim() ? saveMapping.name.trim() : null });
      setAnswer(null);
      setSource(null);
      setMapping(null);
      setText('');
      setError('');
      if (fileInput.current) fileInput.current.value = '';
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
    },
    onError: (err: Error) => setError(err.message),
  });

  const reset = () => {
    latest.current += 1;
    setAnswer(null);
    setSource(null);
    setMapping(null);
    setError('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const change = (next: ResultMappingType) => {
    setMapping(next);
    // A mapping someone had to correct is one to keep for the board's next file.
    setSaveMapping((s) => ({ ...s, on: true }));
    if (source) read(source, next);
  };

  const toSave = answer ? answer.summary.new + answer.summary.revised : 0;
  const busy = preview.isPending || upload.isPending;

  return (
    <section aria-labelledby="import-heading" className="mb-8 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="import-heading" className="font-display text-lg font-semibold text-foreground">Import results</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            The board&apos;s file as it came: Pearson&apos;s results file (a row per result) or Cambridge&apos;s broadsheet (a row per candidate). Nothing is saved until you have checked the lines below and pressed Save.
          </p>
        </div>
        {answer && (
          <Button variant="outline" size="sm" onClick={reset} disabled={commit.isPending}>Use another file</Button>
        )}
      </div>

      {!answer && (
        <div className="mt-4">
          <div role="group" aria-label="How the file comes in" className="mb-3 flex flex-wrap gap-1">
            {(['file', 'paste'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'h-9 rounded-lg border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  mode === m ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-accent',
                )}
              >
                {m === 'file' ? 'Upload the file' : 'Paste it'}
              </button>
            ))}
          </div>
          {mode === 'file' ? (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">The board&apos;s file (.xlsx or .csv)</p>
              {/* The browser's own file button cannot be translated: a label stands in for it. */}
              <input
                id="results-file"
                ref={fileInput}
                type="file"
                accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                }}
                className="peer sr-only"
              />
              <label
                htmlFor="results-file"
                className={cn(
                  'inline-flex h-9 cursor-pointer items-center rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground shadow-xs hover:bg-accent peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50',
                  busy && 'pointer-events-none opacity-50',
                )}
              >
                {busy ? 'Reading…' : 'Choose the file'}
              </label>
              <p className="mt-1 text-xs text-muted-foreground">It is read as soon as you choose it; you see what it holds before anything is saved.</p>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!text.trim()) return setError('Paste the rows first, the headings included.');
                const s = { text, name: 'pasted results' };
                setSource(s);
                read(s, null);
              }}
            >
              <Label htmlFor="results-paste" className="mb-1 text-xs text-muted-foreground">The rows, copied from the board&apos;s file with the headings</Label>
              <textarea
                id="results-paste"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder="UCI, Unit Code, Grade, UMS"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <Button type="submit" className="mt-2" disabled={busy}>{busy ? 'Reading…' : 'Read it'}</Button>
            </form>
          )}
        </div>
      )}

      {error && <Notice tone="danger" className="mt-4">{error}</Notice>}

      {saved && <SavedNotice saved={saved.answer} mappingName={saved.mappingName} />}

      {answer && mapping && (
        <div className="mt-4 space-y-5">
          <p className="flex flex-wrap items-center gap-2 text-sm text-foreground">
            <span className="text-muted-foreground">File</span>
            <BoardText className="font-medium">{answer.sourceName}</BoardText>
            <MappingFrom from={answer.mappingFrom} name={answer.mappingName} />
            {preview.isPending && <span className="text-xs text-muted-foreground">Reading…</span>}
          </p>

          <SampleTable sample={answer.sample} headerRow={mapping.headerRow} onHeaderRow={(row) => {
            const header = headingsOf(answer.sample, row);
            const cand = guessCandidate(header);
            change(mapping.shape === 'wide'
              ? { ...mapping, headerRow: row, ...cand, resultColumns: guessWide(header, cand.candidateColumn) }
              : { ...mapping, headerRow: row, ...cand, ...guessLong(header) });
          }} />

          <MappingEditor mapping={mapping} header={headingsOf(answer.sample, mapping.headerRow)} onChange={change} disabled={commit.isPending} />

          <Lines answer={answer} />

          <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-muted/40 p-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={saveMapping.on} onChange={(e) => setSaveMapping({ ...saveMapping, on: e.target.checked })} />
                <span>Save this mapping for next time as</span>
              </label>
              <Input
                aria-label="Mapping name"
                value={saveMapping.name}
                onChange={(e) => setSaveMapping({ on: true, name: e.target.value })}
                maxLength={60}
                className="w-64"
              />
            </div>
            <Button onClick={() => commit.mutate()} disabled={toSave === 0 || commit.isPending || preview.isPending}>
              {commit.isPending ? (
                'Saving…'
              ) : toSave === 0 ? (
                'Nothing new to save'
              ) : (
                <>
                  <span><span>Save</span> <span className="tabular-nums">{toSave}</span> <span>{toSave === 1 ? 'result' : 'results'}</span></span>
                </>
              )}
            </Button>
            <p className="basis-full text-xs text-muted-foreground">
              Lines for an unknown candidate or code are not saved: correct the candidate&apos;s number or the catalogue, then read the file again — the lines already saved are recognised and not added twice.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function MappingFrom({ from, name }: { from: string; name: string | null }) {
  if (from === 'saved') {
    return (
      <Badge tone="success">
        <span>Read with the saved mapping</span>&nbsp;<BoardText>{name ?? ''}</BoardText>
      </Badge>
    );
  }
  if (from === 'guessed') return <Badge tone="warning">Columns guessed from the headings — check them below</Badge>;
  return <Badge tone="info">Read with your mapping</Badge>;
}

function SavedNotice({ saved, mappingName }: { saved: ImportAnswer; mappingName: string | null }) {
  const s = saved.summary;
  const added = s.new + s.revised;
  const skipped = s.unknownCandidates + s.unknownCodes;
  return (
    <Notice tone="success" className="mt-4" title="Results saved">
      <p>
        <span>Saved</span> <strong className="tabular-nums">{added}</strong> <span>{added === 1 ? 'result' : 'results'}</span>
        {' · '}
        <span className="tabular-nums">{s.new}</span> <span>new</span>
        {' · '}
        <span className="tabular-nums">{s.revised}</span> <span>changed by the board</span>
        {' · '}
        <span className="tabular-nums">{s.unchanged}</span> <span>already saved</span>
      </p>
      {skipped > 0 && (
        <p className="mt-1">
          <span className="tabular-nums">{skipped}</span> <span>lines were not saved (unknown candidate or code).</span>
        </p>
      )}
      {mappingName && (
        <p className="mt-1">
          <span>The mapping is saved for next time as</span> <BoardText className="font-semibold">{mappingName}</BoardText>
        </p>
      )}
      <p className="mt-1">The results are provisional until you publish them below.</p>
    </Notice>
  );
}

/** The file's first rows; the staff tick the row holding the headings (broadsheets carry a title block). */
function SampleTable({ sample, headerRow, onHeaderRow }: { sample: string[][]; headerRow: number; onHeaderRow: (row: number) => void }) {
  const width = Math.min(Math.max(0, ...sample.map((r) => r.length)), 30);
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">The file&apos;s first rows</h3>
      <p className="mb-2 text-xs text-muted-foreground">Tick the row that holds the column headings. A broadsheet has a title block above them.</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-muted">
            <tr>
              <th scope="col" className="w-0 whitespace-nowrap px-2 py-1.5 text-start font-semibold text-muted-foreground">Headings</th>
              <th scope="col" className="w-0 whitespace-nowrap px-2 py-1.5 text-start font-semibold text-muted-foreground">Row</th>
              {Array.from({ length: width }, (_, i) => <th key={i} scope="col" className="px-2 py-1.5" aria-hidden="true" />)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sample.map((row, i) => (
              <tr key={i} className={cn(i + 1 === headerRow && 'bg-primary/10 font-semibold', i + 1 < headerRow && 'text-muted-foreground')}>
                <td className="px-2 py-1">
                  <input type="radio" name="results-header-row" aria-label={`Row ${i + 1} holds the headings`} checked={i + 1 === headerRow} onChange={() => onHeaderRow(i + 1)} />
                </td>
                <td className="px-2 py-1 tabular-nums text-muted-foreground" dir="ltr">{i + 1}</td>
                {Array.from({ length: width }, (_, j) => (
                  <td key={j} className="max-w-48 truncate whitespace-nowrap px-2 py-1 text-foreground" data-i18n-skip="true" dir="auto">{row[j] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ColumnSelect({ id, label, value, header, onChange, optional = false, disabled }: {
  id: string; label: string; value: string | undefined; header: string[]; onChange: (v: string | undefined) => void; optional?: boolean; disabled?: boolean;
}) {
  const options = value && !header.includes(value) ? [value, ...header] : header;
  return (
    <div>
      <Label htmlFor={id} className="mb-1 text-xs text-muted-foreground">{label}</Label>
      <select id={id} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)} className={cn(SELECT_CLASS, 'min-w-48')}>
        <option value="">{optional ? 'None' : 'Choose…'}</option>
        {options.map((h) => <option key={h} value={h} data-i18n-skip="true">{h}</option>)}
      </select>
    </div>
  );
}

function MappingEditor({ mapping, header, onChange, disabled }: { mapping: ResultMappingType; header: string[]; onChange: (m: ResultMappingType) => void; disabled?: boolean }) {
  const setShape = (shape: ResultMappingType['shape']) => {
    if (shape === mapping.shape) return;
    onChange(shape === 'wide'
      ? { ...mapping, shape, codeColumn: undefined, gradeColumn: undefined, markColumn: undefined, resultColumns: guessWide(header, mapping.candidateColumn) }
      : { ...mapping, shape, resultColumns: undefined, ...guessLong(header) });
  };
  const resultColumns = mapping.resultColumns ?? [];
  return (
    <fieldset className="rounded-lg border border-border p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold text-foreground">How to read the file</legend>
      <div className="grid gap-4 lg:grid-cols-2">
        <div role="radiogroup" aria-label="How the file is laid out" className="space-y-2">
          <p className="text-xs text-muted-foreground">How the file is laid out</p>
          {([
            ['long', 'A row per result', 'Pearson’s results file: a candidate, a code and a grade on each row'],
            ['wide', 'A row per candidate', 'Cambridge’s broadsheet: a column per syllabus, the grade in each cell'],
          ] as const).map(([value, label, hint]) => (
            <label key={value} className={cn('flex cursor-pointer gap-3 rounded-lg border px-3 py-2 text-sm', mapping.shape === value ? 'border-primary bg-primary/5' : 'border-border')}>
              <input type="radio" name="results-shape" checked={mapping.shape === value} onChange={() => setShape(value)} className="mt-0.5" />
              <span>
                <span className="font-medium text-foreground">{label}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="space-y-3">
          <ColumnSelect id="map-candidate" label="Column naming the candidate" value={mapping.candidateColumn} header={header}
            onChange={(v) => v && onChange({ ...mapping, candidateColumn: v })} />
          <div role="radiogroup" aria-label="What that column holds" className="flex flex-wrap gap-3 text-sm text-foreground">
            <span className="text-xs text-muted-foreground">It holds</span>
            {([['candidate_number', 'The candidate number in this series'], ['uci', 'The UCI']] as const).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1.5">
                <input type="radio" name="results-candidate-key" checked={mapping.candidateKey === value} onChange={() => onChange({ ...mapping, candidateKey: value })} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {mapping.shape === 'long' ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <ColumnSelect id="map-code" label="Code column" value={mapping.codeColumn} header={header} onChange={(v) => onChange({ ...mapping, codeColumn: v })} />
          <ColumnSelect id="map-grade" label="Grade column" value={mapping.gradeColumn} header={header} onChange={(v) => onChange({ ...mapping, gradeColumn: v })} />
          <ColumnSelect id="map-mark" label="Mark column (if there is one)" value={mapping.markColumn} header={header} optional onChange={(v) => onChange({ ...mapping, markColumn: v })} />
        </div>
      ) : (
        <div className="mt-4">
          <p className="text-xs text-muted-foreground">Result columns: tick every column whose heading starts with a syllabus or component code</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {header.filter((h) => h !== mapping.candidateColumn).map((h) => (
              <label key={h} className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm', resultColumns.includes(h) ? 'border-primary bg-primary/5' : 'border-border')}>
                <input
                  type="checkbox"
                  checked={resultColumns.includes(h)}
                  onChange={(e) => onChange({ ...mapping, resultColumns: e.target.checked ? [...resultColumns, h] : resultColumns.filter((c) => c !== h) })}
                />
                <BoardText>{h}</BoardText>
              </label>
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );
}

function Lines({ answer }: { answer: ImportAnswer }) {
  const [show, setShow] = useState<Outcome | 'all'>('all');
  const [all, setAll] = useState(false);
  const s = answer.summary;
  const counts: Record<Outcome, number> = { new: s.new, revised: s.revised, unchanged: s.unchanged, unknown_candidate: s.unknownCandidates, unknown_code: s.unknownCodes };
  const lines = show === 'all' ? answer.lines : answer.lines.filter((l) => l.outcome === show);
  const shown = all ? lines : lines.slice(0, 200);
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">What each line will do</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        <span className="tabular-nums">{s.lines}</span> <span>lines</span>
        {' · '}
        <span className="tabular-nums">{s.candidates}</span> <span>candidates found</span>
      </p>
      <div role="group" aria-label="Show lines" className="mb-3 flex flex-wrap gap-1.5">
        <FilterChip active={show === 'all'} onClick={() => setShow('all')} label="All" count={s.lines} tone="neutral" />
        {OUTCOMES.map((o) => (
          <FilterChip key={o.key} active={show === o.key} onClick={() => setShow(o.key)} label={o.label} count={counts[o.key]} tone={o.tone} disabled={counts[o.key] === 0} />
        ))}
      </div>
      {lines.length === 0 ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          No lines read. Check the headings row and the columns above: the candidate column and the result columns must be the file&apos;s own headings.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Line</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">In the file</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Candidate</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Code</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Grade (mark)</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">What happens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((l, i) => (
                <tr key={`${l.line}-${l.code}-${i}`} className={cn(l.outcome.startsWith('unknown') && 'bg-red-50/40 dark:bg-red-900/10')}>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground" dir="ltr">{l.line}</td>
                  <td className="px-3 py-2"><Code>{l.candidate}</Code></td>
                  <td className="px-3 py-2 text-foreground">{l.studentName ? <bdi data-i18n-skip="true">{l.studentName}</bdi> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2"><Code>{l.code}</Code></td>
                  <td className="px-3 py-2 text-foreground">
                    {l.outcome === 'revised' && l.previous ? (
                      <span className="whitespace-nowrap">
                        <s className="text-muted-foreground"><GradeText grade={l.previous.grade} mark={l.previous.mark} /></s>
                        {' '}<span aria-hidden="true">→</span>{' '}
                        <strong><GradeText grade={l.grade} mark={l.mark} /></strong>
                      </span>
                    ) : (
                      <GradeText grade={l.grade} mark={l.mark} />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={OUTCOME[l.outcome].tone}>{OUTCOME[l.outcome].label}</Badge>
                    {l.note && <p className="mt-1 text-xs text-muted-foreground">{l.note}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!all && lines.length > shown.length && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll(true)}>
          <span><span>Show all</span> <span className="tabular-nums">{lines.length}</span> <span>lines</span></span>
        </Button>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, count, tone, disabled }: { active: boolean; onClick: () => void; label: string; count: number; tone: Tone; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40',
        active ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-accent',
      )}
    >
      <span>{label}</span>
      <Badge tone={tone} className="px-1.5 py-0 tabular-nums">{count}</Badge>
    </button>
  );
}

/** A grade and, when the board gives one, its mark: "A (88)". */
function GradeText({ grade, mark }: { grade: string; mark: number | string | null }) {
  return (
    <bdi data-i18n-skip="true" dir="ltr" className="font-semibold">
      {grade}
      {mark !== null && mark !== undefined && mark !== '' && <span className="ms-1 font-normal text-muted-foreground">({String(mark)})</span>}
    </bdi>
  );
}

// ─── The series' results and publication ─────────────────────────────────────

type CodeGroup = { code: string; kind: string; reports: ResultRow[] };
type StudentGroup = { studentId: string; name: string; codes: CodeGroup[] };

function SeriesResults({ series }: { series: BoardSeriesRow }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...EXAMS_KEY, 'results', series.id],
    queryFn: () => fetchResults({ boardSeriesId: series.id }),
  });
  const { data: catalogue } = useCatalogue();
  const { data: entries } = useQuery({
    queryKey: [...EXAMS_KEY, 'entries', series.id, 'with-withdrawn'],
    queryFn: () => fetchEntries({ boardSeriesId: series.id, includeWithdrawn: 'true' }),
  });
  const [find, setFind] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [published, setPublished] = useState<PublishAnswer | null>(null);
  const [error, setError] = useState('');

  const publish = useMutation({
    mutationFn: () => publishResults(series.id),
    onSuccess: (a) => {
      setPublished(a);
      setConfirming(false);
      setError('');
      queryClient.invalidateQueries({ queryKey: EXAMS_KEY });
    },
    onError: (err: Error) => setError(err.message),
  });

  const titleOf = (kind: string, code: string, fallback: string | null) => {
    const c = code.toUpperCase();
    const list = kind === 'unit' ? catalogue?.units : catalogue?.qualifications;
    return list?.find((x) => x.boardCode === series.boardCode && x.code.toUpperCase() === c)?.title ?? fallback;
  };

  const groups = useMemo(() => {
    const out: StudentGroup[] = [];
    for (const r of data?.results ?? []) {
      let g = out.find((x) => x.studentId === r.studentId);
      if (!g) out.push((g = { studentId: r.studentId, name: r.studentName, codes: [] }));
      let c = g.codes.find((x) => x.code === r.code && x.kind === r.kind);
      if (!c) g.codes.push((c = { code: r.code, kind: r.kind, reports: [] }));
      c.reports.push(r); // newest first, as the API orders them
    }
    return out;
  }, [data]);

  const q = find.trim().toLowerCase();
  const shown = q
    ? groups.filter((g) => g.name.toLowerCase().includes(q) || g.codes.some((c) => c.code.toLowerCase().includes(q)))
    : groups;
  const provisional = (data?.results ?? []).filter((r) => r.status === 'provisional');
  const provisionalCandidates = new Set(provisional.map((r) => r.studentId)).size;

  return (
    <section aria-labelledby="series-results-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="series-results-heading" className="font-display text-lg font-semibold text-foreground">
            <span>Results in</span> <BoardText>{series.name}</BoardText>
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data?.publishedAt ? (
              <>
                <span>Published to families on</span> <InstantText iso={data.publishedAt} />
              </>
            ) : (
              <span>Not published yet: families cannot see these results.</span>
            )}
            {series.resultsOn && (
              <>
                {' · '}
                <span>The board&apos;s results day</span> <MaybeDate date={series.resultsOn} />
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a candidate or a code" aria-label="Find a candidate or a code" className="w-60" />
          {provisional.length > 0 && !confirming && (
            <Button onClick={() => { setConfirming(true); setPublished(null); }}>Publish to families</Button>
          )}
        </div>
      </div>

      {provisional.length > 0 && data?.publishedAt && !confirming && (
        <Notice tone="warning" className="mb-3">
          <span className="tabular-nums">{provisional.length}</span> <span>results were saved after the last publication and are not published yet.</span>
        </Notice>
      )}

      {confirming && (
        <Notice tone="warning" className="mb-4" title="Publish these results to families?">
          <p>
            <span className="tabular-nums">{provisional.length}</span> <span>results for</span> <span className="tabular-nums">{provisionalCandidates}</span>{' '}
            <span>candidates become visible to them and their parents, and they are told.</span>
          </p>
          <p className="mt-1">A registration with no grade yet gets the board&apos;s grade; one that already has a grade keeps it, and you will see which.</p>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => publish.mutate()} disabled={publish.isPending}>{publish.isPending ? 'Publishing…' : 'Publish now'}</Button>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={publish.isPending}>Cancel</Button>
          </div>
        </Notice>
      )}

      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      {published && <PublishedNotice published={published} entries={entries ?? []} />}

      {isLoading ? (
        <LoadingState label="Loading the results…" />
      ) : isError ? (
        <ErrorState title="The results did not load" message="This is a connection problem, not an empty list. Try again." onRetry={() => refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState title="No results in this series yet" message="Import the board's file above when it arrives. Families see nothing until you publish." />
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">No candidate or code matches.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Candidate</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Code</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Subject</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Grade (mark)</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Earlier reports of this attempt</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Attempts at this code</th>
                <th scope="col" className="px-3 py-2 text-start font-semibold text-muted-foreground">Families</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((g) =>
                g.codes.map((c, i) => {
                  const [latest, ...earlier] = c.reports;
                  return (
                    <tr key={`${g.studentId}-${c.kind}-${c.code}`} className={cn(i === 0 && 'border-t-2 border-t-border')}>
                      {i === 0 && (
                        <td rowSpan={g.codes.length} className="px-3 py-2 align-top font-medium text-foreground">
                          <bdi data-i18n-skip="true">{g.name}</bdi>
                        </td>
                      )}
                      <td className="px-3 py-2"><Code>{c.code}</Code></td>
                      <td className="px-3 py-2 text-foreground"><BoardText>{titleOf(c.kind, c.code, latest!.title) ?? '—'}</BoardText></td>
                      <td className="px-3 py-2 text-base"><GradeText grade={latest!.grade} mark={latest!.mark} /></td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {earlier.length === 0 ? (
                          <span>—</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {earlier.map((e) => (
                              <li key={e.id} className="whitespace-nowrap">
                                <s><GradeText grade={e.grade} mark={e.mark} /></s>{' '}
                                <span className="text-xs"><InstantText iso={e.createdAt} time={false} /></span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-foreground">
                        {latest!.attempts > 1 ? <Badge tone="info"><span>{latest!.attempts}</span>&nbsp;<span>attempts</span></Badge> : <span className="text-muted-foreground">First</span>}
                      </td>
                      <td className="px-3 py-2">
                        {latest!.status === 'published' ? <Badge tone="success">Published</Badge> : <Badge tone="warning">Provisional</Badge>}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PublishedNotice({ published, entries }: { published: PublishAnswer; entries: EntryRow[] }) {
  const kept = published.gradesKept;
  return (
    <Notice tone="success" className="mb-4" title="Results published">
      <p>
        <strong className="tabular-nums">{published.published}</strong> <span>results published for</span>{' '}
        <strong className="tabular-nums">{published.candidates}</strong> <span>candidates. Their families were told.</span>
      </p>
      <p className="mt-1">
        <strong className="tabular-nums">{published.gradesRecorded}</strong> <span>registrations got the board&apos;s grade.</span>
      </p>
      {kept.length > 0 && (
        <div className="mt-3">
          <p>These registrations already had a different grade recorded, so they kept it:</p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-emerald-200 bg-background text-foreground dark:border-emerald-800">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted">
                <tr>
                  <th scope="col" className="px-3 py-1.5 text-start font-semibold text-muted-foreground">Candidate</th>
                  <th scope="col" className="px-3 py-1.5 text-start font-semibold text-muted-foreground">Entry</th>
                  <th scope="col" className="px-3 py-1.5 text-start font-semibold text-muted-foreground">Grade recorded</th>
                  <th scope="col" className="px-3 py-1.5 text-start font-semibold text-muted-foreground">The board&apos;s grade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {kept.map((k) => {
                  const e = entries.find((x) => x.registrationId === k.id);
                  return (
                    <tr key={k.id}>
                      <td className="px-3 py-1.5">{e ? <bdi data-i18n-skip="true">{e.studentName}</bdi> : <Code>{k.id.slice(0, 8)}</Code>}</td>
                      <td className="px-3 py-1.5">{e ? <><Code>{e.entryCode}</Code> <BoardText>{e.title}</BoardText></> : '—'}</td>
                      <td className="px-3 py-1.5"><GradeText grade={k.gradeReceived ?? '—'} mark={null} /></td>
                      <td className="px-3 py-1.5"><GradeText grade={k.grade} mark={null} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs">
        Which grade counts after a remark is the owner&apos;s open question: nothing here decides it, and every report the board sends is kept.
      </p>
    </Notice>
  );
}
