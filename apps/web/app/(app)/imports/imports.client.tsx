'use client';

/**
 * Day-one import: bring a file in (FEATURES_PLAN.md F7).
 *
 * The spreadsheet version (UX_AUDIT.md §4): the coordinator copies the
 * Google Form's rows into a master sheet, eyeballs the emails and phones,
 * then the desk retypes each family (parent, child, link), each class tab is
 * retyped from the class column, and nobody can tell afterwards which rows
 * went in, which were fixed and which were forgotten; doing it twice makes
 * duplicates.
 *
 * Here: pick what the file is, drop it in — nothing changes yet. The review
 * lists every problem the spike found (IMPORT_SPIKE.md) with its fix beside
 * it; a commit makes each family in one go, every record pointing back to its
 * line; the same file again finds everything already there. SCL's roster and
 * the money record come with a template to fill.
 */

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, schoolDateString, SCL_ROSTER_TEMPLATE, MONEY_RECORD_TEMPLATE, type ImportKind } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/tone';
import { ErrorState, LoadingState, EmptyState } from '~/components/ui/query-state';
import { toCsv, downloadCsv } from '~/lib/csv';
import { cn } from '~/lib/utils';
import { DateText } from '../academic/calendar/academic-shared';
import { fetchImports, IMPORTS_KEY, StatusBadge, kindLabel } from './import-shared';

const SOURCES: { kind: ImportKind; title: string; hint: string; accept: string; template?: { fileName: string; headers: readonly string[]; example: readonly (readonly string[])[] } }[] = [
  {
    kind: 'school_sheet',
    title: "The school's registration sheet",
    hint: 'The Google Form export (.xlsx) with all its tabs, or one tab saved as CSV. Families, classes, teachers, enrolments and what each student registered for.',
    accept: '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  {
    kind: 'scl_roster',
    title: 'Grade 9 roster from SCL',
    hint: 'Students starting grade 10, with their parents and grade-10 section. Export from SCL as CSV in the template’s columns.',
    accept: '.csv,text/csv',
    template: SCL_ROSTER_TEMPLATE,
  },
  {
    kind: 'money_record',
    title: 'Money record (history only)',
    hint: 'What was paid, refunded or dropped before the system. Kept as history on each student: nothing is paid, refunded or credited.',
    accept: '.csv,text/csv',
    template: MONEY_RECORD_TEMPLATE,
  },
];

export default function ImportsClient({ isAdmin }: { isAdmin: boolean }): React.JSX.Element {
  const router = useRouter();
  const list = useQuery({ queryKey: [...IMPORTS_KEY], queryFn: fetchImports });
  const [kind, setKind] = useState<ImportKind>('school_sheet');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const source = SOURCES.find((s) => s.kind === kind)!;

  const stage = useMutation({
    mutationFn: async () => {
      const uploaded = await apiResponse(api.v1.files.upload.$post({ form: { file: file!, purpose: 'import_file' } }));
      return apiResponse(api.v1.imports.$post({ json: { fileId: uploaded.id, kind } }));
    },
    onSuccess: (r) => router.push(`/imports/${r.id}` as Route),
    onError: (err: Error) => setError(err.message),
  });

  const pick = (f: File | null | undefined) => { setError(''); setFile(f ?? null); };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 animate-fade-up">
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Day-one import</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Bring the school’s own files into the system. Nothing changes when you upload: every row is checked first, you fix, merge or skip what needs it, then commit one family at a time. Running the same file again changes nothing.
        </p>
      </header>

      <section aria-labelledby="new-import" className="mb-8 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 id="new-import" className="mb-3 font-semibold text-foreground">Start an import</h2>
        <div role="radiogroup" aria-label="What the file is" className="grid gap-3 md:grid-cols-3">
          {SOURCES.map((s) => (
            <label
              key={s.kind}
              className={cn(
                'flex cursor-pointer gap-3 rounded-xl border bg-card p-4',
                kind === s.kind ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:bg-accent/40',
              )}
            >
              <input type="radio" name="import-kind" className="mt-1" checked={kind === s.kind} onChange={() => { setKind(s.kind); pick(null); }} />
              <span>
                <span className="block font-semibold text-foreground">{s.title}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{s.hint}</span>
                {s.template && (
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-primary underline-offset-4 hover:underline"
                    onClick={(e) => { e.preventDefault(); downloadCsv(s.template!.fileName, toCsv([...s.template!.headers], s.template!.example.map((r) => [...r]))); }}
                  >
                    Download the template
                  </button>
                )}
              </span>
            </label>
          ))}
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]); }}
          className={cn(
            'mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-dashed p-5',
            dragging ? 'border-primary bg-primary/5' : 'border-border',
          )}
        >
          <div className="min-w-0 text-sm">
            {file ? (
              <p><span className="text-muted-foreground">File:</span> <bdi data-i18n-skip="true" className="font-medium text-foreground">{file.name}</bdi></p>
            ) : (
              <p className="text-muted-foreground">Drop the file here, or choose it.</p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">Up to 10 MB. The file is kept with the import so every row can be traced back to it.</p>
          </div>
          <div className="flex gap-2">
            <input ref={input} type="file" accept={source.accept} className="sr-only" aria-label="Choose the file" onChange={(e) => pick(e.target.files?.[0])} />
            <Button variant="outline" onClick={() => input.current?.click()}>Choose file</Button>
            <Button disabled={!file || stage.isPending} onClick={() => stage.mutate()}>
              {stage.isPending ? 'Reading the file…' : 'Stage for review'}
            </Button>
          </div>
        </div>
        {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
        {!isAdmin && (
          <p className="mt-3 text-xs text-muted-foreground">
            Reserving lines for families in a session and adding subjects to the catalogue are the admin’s steps; everything else here is yours.
          </p>
        )}
      </section>

      <section aria-labelledby="past-imports">
        <h2 id="past-imports" className="mb-3 font-semibold text-foreground">Imports</h2>
        {list.isLoading ? (
          <LoadingState label="Loading the imports…" />
        ) : list.isError ? (
          <ErrorState title="The imports did not load" onRetry={() => list.refetch()} />
        ) : !list.data?.length ? (
          <EmptyState title="No imports yet" message="Upload the school's sheet above to start." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">File</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">What it is</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">State</th>
                  <th scope="col" className="px-3 py-2 text-end font-semibold">Rows</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">Families</th>
                  <th scope="col" className="px-3 py-2 text-start font-semibold">Staged</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.data.map((b) => (
                  <tr
                    key={b.id}
                    className="cursor-pointer hover:bg-accent/40"
                    onClick={() => router.push(`/imports/${b.id}` as Route)}
                  >
                    <td className="px-3 py-2">
                      <a href={`/imports/${b.id}`} className="font-medium text-foreground hover:underline" onClick={(e) => e.stopPropagation()}>
                        <bdi data-i18n-skip="true">{b.fileName}</bdi>
                      </a>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{kindLabel(b.kind)}</td>
                    <td className="px-3 py-2"><StatusBadge status={b.status} /></td>
                    <td className="px-3 py-2 text-end tabular-nums">{b.rows}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <span className="tabular-nums">{b.committedFamilies}</span> <span>committed</span>
                      {b.readyFamilies > 0 && <> · <span className="tabular-nums">{b.readyFamilies}</span> <span>ready</span></>}
                      {b.heldFamilies > 0 && <> · <span className="tabular-nums text-red-600 dark:text-red-400">{b.heldFamilies}</span> <span>held back</span></>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <DateText date={schoolDateString(new Date(b.createdAt))} /> <span>·</span> <bdi data-i18n-skip="true">{b.createdByName ?? ''}</bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
