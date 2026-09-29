'use client';

/**
 * Start of year: the year's enrolments in bulk — a preview first, one click
 * to commit, and running it again changes nothing (what is already enrolled
 * shows as "Already enrolled").
 * - Carry last year forward: last year's enrolments, with their teachers and
 *   self-study, for students still in school; a finished subject replaced by
 *   the one that follows it (one rule for everyone), or dropped.
 * - From registrations: the exam registrations of the year's series, with
 *   the teacher each names; taken outside school becomes self-study.
 * - Paste rows from a sheet: student ID or email, subject code or name,
 *   teacher, mode. What does not resolve is listed with its line, never
 *   guessed.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { useAcademicYears, type AcademicYearRow } from '../calendar/academic-shared';
import { ENROLMENT_KEY, useCatalogue, SELECT_CLASS } from '../../exams/exams-shared';

const fetchSections = (academicYearId: string) => apiResponse(api.v1.academic.sections.$get({ query: { academicYearId } }));
const fetchYearEnrolments = (academicYearId: string) => apiResponse(api.v1.enrolments.$get({ query: { academicYearId } }));
const postBulk = (json: Parameters<typeof api.v1.enrolments.bulk.$post>[0]['json']) => apiResponse(api.v1.enrolments.bulk.$post({ json }));
const postBatch = (json: Parameters<typeof api.v1.enrolments.batch.$post>[0]['json']) => apiResponse(api.v1.enrolments.batch.$post({ json }));
type BulkResult = Awaited<ReturnType<typeof postBulk>>;
type BatchResult = Awaited<ReturnType<typeof postBatch>>;
type OutcomeRow = BulkResult['rows'][number];

type Source = 'previous_enrolment' | 'registrations' | 'paste';
const SOURCES: [Source, string, string][] = [
  ['previous_enrolment', 'Carry last year forward', "Last year's subjects, teachers and self-study, for students still in school."],
  ['registrations', 'From exam registrations', 'The subjects students registered for, with the teacher each registration names.'],
  ['paste', 'Paste rows from a sheet', 'Student ID or email, subject code or name, teacher, mode — one row per line.'],
];

export function Bulk({ year }: { year: AcademicYearRow }) {
  const [source, setSource] = useState<Source>('previous_enrolment');
  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Where the enrolments come from" className="grid gap-3 md:grid-cols-3">
        {SOURCES.map(([s, title, hint]) => (
          <label
            key={s}
            className={cn(
              'flex cursor-pointer gap-3 rounded-xl border bg-card p-4 shadow-sm',
              source === s ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:bg-accent/40',
            )}
          >
            <input type="radio" name="bulk-source" className="mt-1" checked={source === s} onChange={() => setSource(s)} />
            <span>
              <span className="block font-semibold text-foreground">{title}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">{hint}</span>
            </span>
          </label>
        ))}
      </div>
      {source === 'paste' ? <Paste key={year.id} year={year} /> : <FromSource key={`${source}-${year.id}`} year={year} source={source} />}
    </div>
  );
}

function FromSource({ year, source }: { year: AcademicYearRow; source: 'previous_enrolment' | 'registrations' }) {
  const queryClient = useQueryClient();
  const years = useAcademicYears();
  const prev = years.data?.find((y) => y.startYear === year.startYear - 1) ?? null;
  const sections = useQuery({ queryKey: ['academic', 'sections', year.id], queryFn: () => fetchSections(year.id) });
  const lastYear = useQuery({
    queryKey: [...ENROLMENT_KEY, 'list', prev?.id ?? 'none'],
    queryFn: () => fetchYearEnrolments(prev!.id),
    enabled: source === 'previous_enrolment' && !!prev,
  });
  const { data: catalogue } = useCatalogue();
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [registrationYear, setRegistrationYear] = useState(year.startYear);
  const [map, setMap] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<BulkResult | null>(null);
  const [done, setDone] = useState<BulkResult | null>(null);
  const [error, setError] = useState('');

  const lastSubjects = useMemo(() => {
    const by = new Map<string, { id: string; name: string; code: string; n: number }>();
    for (const e of lastYear.data ?? []) {
      const cur = by.get(e.subjectId) ?? { id: e.subjectId, name: e.subjectName, code: e.subjectCode, n: 0 };
      cur.n++;
      by.set(e.subjectId, cur);
    }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [lastYear.data]);

  const body = () => ({
    academicYearId: year.id,
    source,
    ...(source === 'registrations' ? { registrationYear } : {}),
    ...(sectionIds.length ? { sectionIds } : {}),
    subjectMap: Object.entries(map).filter(([from, to]) => to !== from).map(([from, to]) => ({ from, to: to === '__drop__' ? null : to })),
    exclude: [...excluded],
  });
  const run = useMutation({
    mutationFn: (commit: boolean) => postBulk({ ...body(), commit }),
    onSuccess: (r) => {
      setError('');
      if (r.committed) { setDone(r); setPreview(null); setExcluded(new Set()); queryClient.invalidateQueries({ queryKey: ENROLMENT_KEY }); }
      else { setPreview(r); setDone(null); }
    },
    onError: (err: Error) => setError(err.message),
  });
  const changed = () => { setPreview(null); setDone(null); };

  const activeSubjects = (catalogue?.registrable ?? []).filter((r) => r.isActive);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        {source === 'previous_enrolment' ? (
          !prev ? (
            <Notice tone="info">There is no academic year before this one: carry forward starts next year. Use the registrations or paste rows instead.</Notice>
          ) : lastYear.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading last year&apos;s enrolments…</p>
          ) : lastSubjects.length === 0 ? (
            <Notice tone="info"><span>Nobody was enrolled in</span> <bdi>{prev.shortLabel}</bdi><span>: nothing to carry forward. Use the registrations or paste rows instead.</span></Notice>
          ) : (
            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">
                <span>What each of last year&apos;s subjects becomes in</span> <bdi>{year.shortLabel}</bdi>
              </p>
              <p className="mb-3 text-xs text-muted-foreground">One rule for everyone: a finished subject is replaced by the one that follows it (AS units by A2 units), or dropped.</p>
              <div className="grid gap-2 md:grid-cols-2">
                {lastSubjects.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-sm">
                    <span className="w-48 shrink-0 truncate" title={s.name}><bdi>{s.name}</bdi> <span className="text-xs text-muted-foreground">(<span className="tabular-nums">{s.n}</span>)</span></span>
                    <span aria-hidden="true" className="text-muted-foreground rtl:rotate-180">→</span>
                    <select
                      aria-label={`${s.name} becomes`}
                      value={map[s.id] ?? s.id}
                      onChange={(e) => { setMap({ ...map, [s.id]: e.target.value }); changed(); }}
                      className={cn(SELECT_CLASS, 'h-9')}
                    >
                      <option value={s.id}>The same subject</option>
                      <option value="__drop__">Not carried forward</option>
                      {activeSubjects.filter((a) => a.id !== s.id).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.code})</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="reg-year" className="mb-1 text-xs text-muted-foreground">Registrations for the series of</Label>
              <select id="reg-year" value={registrationYear} onChange={(e) => { setRegistrationYear(Number(e.target.value)); changed(); }} className={cn(SELECT_CLASS, 'w-48')}>
                <option value={year.startYear}>{year.shortLabel} (this year)</option>
                {prev && <option value={prev.startYear}>{prev.shortLabel}</option>}
              </select>
            </div>
            <p className="max-w-xl text-xs text-muted-foreground">
              Each live registration becomes an enrolment in its subject, with the teacher the registration names; one taken outside school becomes self-study.
            </p>
          </div>
        )}

        {(sections.data?.length ?? 0) > 0 && (
          <fieldset className="mt-4">
            <legend className="mb-1 text-xs text-muted-foreground">Only these sections (none chosen: everyone)</legend>
            <div className="flex flex-wrap gap-2">
              {sections.data!.map((s) => {
                const on = sectionIds.includes(s.id);
                return (
                  <label key={s.id} className={cn('flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm', on ? 'border-primary bg-primary/5' : 'border-border')}>
                    <input type="checkbox" checked={on} onChange={() => { setSectionIds(on ? sectionIds.filter((x) => x !== s.id) : [...sectionIds, s.id]); changed(); }} />
                    <bdi>{s.name}</bdi>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={run.isPending || (source === 'previous_enrolment' && (!prev || lastSubjects.length === 0))}
            onClick={() => run.mutate(false)}
          >
            {run.isPending && !preview ? 'Working…' : 'Preview'}
          </Button>
          {preview && (
            <Button disabled={run.isPending || preview.summary.toCreate - excluded.size <= 0} onClick={() => run.mutate(true)}>
              {run.isPending ? 'Enrolling…' : `Enrol ${preview.summary.toCreate - excluded.size}`}
            </Button>
          )}
        </div>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {done && (
        <Notice tone="success" title={`${done.summary.created} enrolments created`}>
          {done.summary.existing > 0 && <p><span className="tabular-nums">{done.summary.existing}</span> <span>were already enrolled and left as they were.</span></p>}
          {done.teacherLinks > 0 && <p><span className="tabular-nums">{done.teacherLinks}</span> <span>teachers were added to the subject they now teach.</span></p>}
          {done.summary.refused > 0 && <p><span className="tabular-nums">{done.summary.refused}</span> <span>rows were refused — see the list below.</span></p>}
        </Notice>
      )}
      {(preview ?? done) && (
        <OutcomeTable
          rows={(preview ?? done)!.rows}
          excluded={excluded}
          onToggle={preview ? (key) => { const next = new Set(excluded); if (next.has(key)) next.delete(key); else next.add(key); setExcluded(next); } : undefined}
        />
      )}
    </div>
  );
}

const OUTCOME: Record<OutcomeRow['outcome'], { label: string; tone: 'success' | 'info' | 'neutral' | 'danger' }> = {
  create: { label: 'Will be enrolled', tone: 'info' },
  created: { label: 'Enrolled', tone: 'success' },
  exists: { label: 'Already enrolled', tone: 'neutral' },
  refused: { label: 'Refused', tone: 'danger' },
};

function OutcomeTable({
  rows, excluded, onToggle, lines,
}: {
  rows: (OutcomeRow & { line?: number })[];
  excluded: Set<string>;
  onToggle?: (key: string) => void;
  lines?: boolean;
}) {
  const [show, setShow] = useState<'all' | OutcomeRow['outcome']>('all');
  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
  const visible = rows.filter((r) => show === 'all' || r.outcome === show);
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3" role="group" aria-label="Show">
        {(['all', 'create', 'created', 'exists', 'refused'] as const).filter((k) => k === 'all' || counts[k]).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={show === k}
            onClick={() => setShow(k)}
            className={cn('rounded-full border px-3 py-1 text-xs font-semibold', show === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-accent')}
          >
            <span>{k === 'all' ? 'All' : OUTCOME[k].label}</span> <span className="tabular-nums">{k === 'all' ? rows.length : counts[k]}</span>
          </button>
        ))}
        {onToggle && <span className="ms-auto text-xs text-muted-foreground">Untick a row to leave it out.</span>}
      </div>
      <div className="max-h-[32rem] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b border-border bg-muted text-xs text-muted-foreground">
            <tr>
              {onToggle && <th scope="col" className="w-10 px-3 py-2"><span className="sr-only">Include</span></th>}
              {lines && <th scope="col" className="px-3 py-2 text-start font-semibold">Line</th>}
              <th scope="col" className="px-3 py-2 text-start font-semibold">Student</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">Subject</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">Teacher</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">Outcome</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((r) => {
              const key = `${r.studentId}|${r.subjectId}`;
              return (
                <tr key={`${key}-${r.line ?? ''}`} className={cn(excluded.has(key) && 'opacity-50')}>
                  {onToggle && (
                    <td className="px-3 py-1.5">
                      {r.outcome === 'create' && (
                        <input type="checkbox" aria-label={`Include ${r.studentName ?? ''} ${r.subjectName ?? ''}`} checked={!excluded.has(key)} onChange={() => onToggle(key)} />
                      )}
                    </td>
                  )}
                  {lines && <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{r.line}</td>}
                  <td className="px-3 py-1.5"><bdi>{r.studentName}</bdi></td>
                  <td className="px-3 py-1.5"><bdi>{r.subjectName}</bdi></td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.mode === 'self_study' ? <span>Self-study</span> : r.teacherName ? <bdi>{r.teacherName}</bdi> : <span>No teacher yet</span>}</td>
                  <td className="px-3 py-1.5">
                    <Badge tone={OUTCOME[r.outcome].tone}>{OUTCOME[r.outcome].label}</Badge>
                    {r.reason && <span className="ms-2 text-xs text-muted-foreground">{r.reason}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Parse pasted sheet rows: tab- or comma-separated, header line skipped. */
function parseRows(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = lines.map((l) => (l.includes('\t') ? l.split('\t') : l.split(',')).map((c) => c.trim()));
  if (rows[0] && /student/i.test(rows[0][0] ?? '')) rows.shift();
  return rows.map((c, i) => ({
    student: c[0] ?? '',
    subject: c[1] ?? '',
    teacher: c[2] ? c[2] : null,
    mode: /self|outside|alone|ذاتي/i.test(c[3] ?? '') ? ('self_study' as const) : ('in_school' as const),
    ref: `pasted line ${i + 1}`,
  })).filter((r) => r.student || r.subject);
}

function Paste({ year }: { year: AcademicYearRow }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [result, setResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState('');
  const rows = useMemo(() => parseRows(text), [text]);
  const run = useMutation({
    mutationFn: (commit: boolean) => postBatch({ academicYearId: year.id, rows, commit }),
    onSuccess: (r) => { setError(''); setResult(r); if (r.committed) queryClient.invalidateQueries({ queryKey: ENROLMENT_KEY }); },
    onError: (err: Error) => setError(err.message),
  });
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <Label htmlFor="paste-rows" className="mb-1 text-sm font-semibold text-foreground">Rows from a sheet</Label>
        <p className="mb-2 text-xs text-muted-foreground">
          Copy the columns from Excel and paste them here: student ID or email, subject code or name, teacher&apos;s name (optional), &quot;self-study&quot; (optional). A header row is skipped.
        </p>
        <textarea
          id="paste-rows"
          value={text}
          onChange={(e) => { setText(e.target.value); setResult(null); }}
          rows={8}
          dir="ltr"
          spellCheck={false}
          placeholder={'S1024\tBiology\tMs Hoda\nS1025\t4BI1\t\tself-study'}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground"><span className="tabular-nums">{rows.length}</span> <span>rows</span></span>
          <Button variant="outline" disabled={!rows.length || run.isPending} onClick={() => run.mutate(false)}>Preview</Button>
          {result && !result.committed && (
            <Button disabled={run.isPending || result.summary.toCreate === 0} onClick={() => run.mutate(true)}>
              {run.isPending ? 'Enrolling…' : `Enrol ${result.summary.toCreate}`}
            </Button>
          )}
        </div>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {result?.committed && <Notice tone="success" title={`${result.summary.created} enrolments created`} />}
      {result && result.unresolved.length > 0 && (
        <Notice tone="warning" title={`${result.unresolved.length} rows did not resolve and will not be enrolled`}>
          <ul className="mt-1 space-y-0.5">
            {result.unresolved.map((u) => (
              <li key={u.line}><span>Line</span> <span className="tabular-nums">{u.line}</span>: <span>{u.reason}</span></li>
            ))}
          </ul>
        </Notice>
      )}
      {result && result.rows.length > 0 && <OutcomeTable rows={result.rows} excluded={new Set()} lines />}
    </div>
  );
}
