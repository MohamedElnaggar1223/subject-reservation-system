'use client';

/**
 * Rows: every line of the file — 400 and more — in one list that scrolls
 * without lag (only the rows in view are drawn), filtered by problem, state
 * or a search, left out or brought back in bulk. A row opens to the line as
 * the sheet has it beside the fields as read, each one fixable in place.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { Route } from 'next';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, Notice } from '~/components/ui/tone';
import { EmptyState } from '~/components/ui/query-state';
import { cn } from '~/lib/utils';
import {
  ProblemChip, LineRef, Who, rowSummary, planWords, problemTitle, problemMeaning, SeverityDot, SELECT, INPUT, MONTH, egp,
  type ImportView, type ImportRow,
} from '../import-shared';
import { useReviewMutation } from './review.client';

const ROW_HEIGHT = 56;
const SHOWS: [string, string][] = [
  ['all', 'All'], ['errors', 'To fix'], ['warnings', 'To check'], ['pending', 'Not committed'], ['committed', 'Committed'], ['failed', 'Failed'], ['skipped', 'Left out'],
];

function matches(r: ImportRow, show: string) {
  switch (show) {
    case 'errors': return r.decision === 'import' && r.status !== 'committed' && r.problems.some((p) => p.severity === 'error');
    case 'warnings': return r.decision === 'import' && r.status !== 'committed' && r.problems.some((p) => p.severity === 'warning');
    case 'pending': return r.decision === 'import' && r.status !== 'committed';
    case 'committed': return r.status === 'committed';
    case 'failed': return r.status === 'failed';
    case 'skipped': return r.decision === 'skip';
    default: return true;
  }
}

export function RowsTab({ id, v, editable, onEdit }: { id: string; v: ImportView; editable: boolean; onEdit: (rowId: string) => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const show = params.get('show') ?? 'all';
  const problem = params.get('problem');
  const source = params.get('src');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const setParam = (k: string, val: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (val === null || val === '') next.delete(k); else next.set(k, val);
    router.replace(`${pathname}?${next.toString()}` as Route, { scroll: false });
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return v.rows.filter((r) => {
      if (!matches(r, show)) return false;
      if (problem && !r.problems.some((p) => p.code === problem)) return false;
      if (source && r.tab !== source) return false;
      if (!q) return true;
      const s = rowSummary(r);
      return [s.student, s.email, s.subject, s.code, s.cls, `${r.tab} ${r.rowNumber}`, String(r.rowNumber)].some((x) => x && x.toLowerCase().includes(q));
    });
  }, [v.rows, show, problem, source, search]);

  const decide = useReviewMutation(id, (json: { rowIds: string[]; decision: 'import' | 'skip'; note?: string }) =>
    apiResponse(api.v1.imports[':id'].rows.$put({ param: { id }, json })));
  const tabs = [...new Set(v.rows.map((r) => r.tab))];
  const selectable = rows.filter((r) => r.status !== 'committed');
  const allOn = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {SHOWS.map(([k, label]) => {
            const n = v.rows.filter((r) => matches(r, k)).length;
            if (k !== 'all' && n === 0) return null;
            return (
              <button key={k} type="button" aria-pressed={show === k} onClick={() => setParam('show', k === 'all' ? null : k)}
                className={cn('rounded-full border px-3 py-1 text-xs font-semibold', show === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-accent')}>
                <span>{label}</span> <span className="tabular-nums">{n}</span>
              </button>
            );
          })}
        </div>
        {tabs.length > 1 && (
          <select aria-label="Tab of the file" className={SELECT} value={source ?? ''} onChange={(e) => setParam('src', e.target.value || null)}>
            <option value="">Every tab</option>
            {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <input
          type="search"
          aria-label="Search the rows"
          placeholder="Name, email, subject or row number"
          className={cn(INPUT, 'w-64')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onBlur={() => setParam('q', search || null)}
        />
      </div>
      {problem && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Only rows with:</span>
          <span className="font-semibold text-foreground">{problemTitle(problem)}</span>
          <Button size="sm" variant="ghost" onClick={() => setParam('problem', null)}>Show every row</Button>
        </div>
      )}
      {editable && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
          <span><span className="tabular-nums font-semibold">{selected.size}</span> <span>selected</span></span>
          <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ rowIds: [...selected], decision: 'skip', note: 'Left out by staff' }, { onSuccess: () => setSelected(new Set()) })}>Leave them out</Button>
          <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ rowIds: [...selected], decision: 'import' }, { onSuccess: () => setSelected(new Set()) })}>Include them</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      {decide.error && <Notice tone="danger">{decide.error}</Notice>}

      {rows.length === 0 ? (
        <EmptyState title="No rows here" message="Change the filter to see the other rows." />
      ) : (
        <div role="table" aria-label="Rows of the file" aria-rowcount={rows.length} className="rounded-xl border border-border bg-card shadow-sm">
          <div role="row" className="grid grid-cols-[2rem_7rem_minmax(10rem,1.3fr)_minmax(10rem,1.3fr)_7rem_minmax(8rem,1fr)_minmax(10rem,1.4fr)_4.5rem] items-center gap-2 border-b border-border bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
            <span role="columnheader">
              {editable && <input type="checkbox" aria-label="Select every row shown" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(selectable.map((r) => r.id)))} />}
            </span>
            <span role="columnheader">Line</span>
            <span role="columnheader">Student</span>
            <span role="columnheader">Subject</span>
            <span role="columnheader">Series</span>
            <span role="columnheader">Will make</span>
            <span role="columnheader">Problems</span>
            <span role="columnheader"><span className="sr-only">Open line</span></span>
          </div>
          <VirtualList
            count={rows.length}
            height={Math.min(rows.length * ROW_HEIGHT, 560)}
            onOpen={(i) => onEdit(rows[i]!.id)}
            render={(i) => {
              const r = rows[i]!;
              const s = rowSummary(r);
              const on = selected.has(r.id);
              const visible = r.problems.filter((p) => p.code !== 'phone_restored' && p.code !== 'name_cleaned');
              return (
                <div
                  role="row"
                  aria-rowindex={i + 1}
                  className={cn(
                    'grid h-14 grid-cols-[2rem_7rem_minmax(10rem,1.3fr)_minmax(10rem,1.3fr)_7rem_minmax(8rem,1fr)_minmax(10rem,1.4fr)_4.5rem] items-center gap-2 border-b border-border px-3 text-sm',
                    r.decision === 'skip' && 'opacity-60',
                    on && 'bg-primary/5',
                  )}
                >
                  <span role="cell">
                    {editable && r.status !== 'committed' && (
                      <input type="checkbox" aria-label={`Select ${r.tab} row ${r.rowNumber}`} checked={on}
                        onChange={() => { const next = new Set(selected); if (on) next.delete(r.id); else next.add(r.id); setSelected(next); }} />
                    )}
                  </span>
                  <span role="cell"><LineRef r={r} /></span>
                  <span role="cell" className="min-w-0"><Who name={s.student} email={s.email} /></span>
                  <span role="cell" className="min-w-0">
                    <bdi data-i18n-skip="true" className="block truncate">{s.subject ?? '—'}</bdi>
                    {s.code && <bdi data-i18n-skip="true" className="block text-xs text-muted-foreground">{s.code}{s.cls ? ` · ${s.cls}` : ''}</bdi>}
                  </span>
                  <span role="cell" className="truncate text-muted-foreground">{s.series ?? '—'}</span>
                  <span role="cell" className="flex min-w-0 flex-wrap gap-1 overflow-hidden">
                    {planWords(r).slice(0, 2).map((p) => <Badge key={p.label} tone={p.tone} className="truncate">{p.label}</Badge>)}
                  </span>
                  <span role="cell" className="flex min-w-0 flex-wrap gap-1 overflow-hidden">
                    {visible.slice(0, 2).map((p) => <ProblemChip key={p.code} p={p} compact />)}
                    {visible.length > 2 && <span className="text-xs text-muted-foreground">+<span className="tabular-nums">{visible.length - 2}</span></span>}
                  </span>
                  <span role="cell"><Button size="sm" variant="ghost" onClick={() => onEdit(r.id)}>Open line</Button></span>
                </div>
              );
            }}
          />
          <p className="px-3 py-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{rows.length}</span> <span>lines</span> · <span>arrow keys move, Enter opens</span>
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * A list that draws only the rows in view (a fixed row height), so a file of
 * several hundred lines scrolls and filters without lag — and the page
 * translator walks a few dozen rows, not every one.
 */
function VirtualList({ count, height, render, onOpen }: { count: number; height: number; render: (i: number) => React.ReactNode; onOpen: (i: number) => void }) {
  const [top, setTop] = useState(0);
  const [focus, setFocus] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus >= count) setFocus(Math.max(0, count - 1)); }, [count, focus]);
  const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - 6);
  const last = Math.min(count, Math.ceil((top + height) / ROW_HEIGHT) + 6);
  const move = (to: number) => {
    const i = Math.max(0, Math.min(count - 1, to));
    setFocus(i);
    const el = box.current;
    if (!el) return;
    if (i * ROW_HEIGHT < el.scrollTop) el.scrollTop = i * ROW_HEIGHT;
    else if ((i + 1) * ROW_HEIGHT > el.scrollTop + height) el.scrollTop = (i + 1) * ROW_HEIGHT - height;
  };
  return (
    <div
      ref={box}
      tabIndex={0}
      role="rowgroup"
      aria-label="Rows — arrow keys move, Enter opens"
      style={{ height, overflowY: 'auto' }}
      className="outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); move(focus + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(focus - 1); }
        else if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onOpen(focus); }
      }}
    >
      <div style={{ height: count * ROW_HEIGHT, position: 'relative' }}>
        <div style={{ position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, top: first * ROW_HEIGHT }}>
          {Array.from({ length: last - first }, (_, k) => {
            const i = first + k;
            return (
              <div key={i} className={cn(i === focus && 'outline outline-2 -outline-offset-2 outline-primary/40')} onMouseDown={() => setFocus(i)}>
                {render(i)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── One row: the line as the sheet has it, the fields as read ───────────────

type Field =
  | { key: string; label: string; type: 'text'; value: string; wide?: boolean }
  | { key: string; label: string; type: 'check'; value: boolean };

function fieldsOf(r: ImportRow): Field[] {
  const d = r.data;
  if (d.kind === 'sheet') {
    return [
      { key: 'studentName', label: 'Student name', type: 'text', value: d.studentName },
      { key: 'studentEmail', label: 'Student email', type: 'text', value: d.studentEmail },
      { key: 'studentPhone', label: 'Student phone', type: 'text', value: d.studentPhone ?? '' },
      { key: 'parentName', label: 'Parent name', type: 'text', value: d.parentName },
      { key: 'parentEmail', label: 'Parent email', type: 'text', value: d.parentEmail },
      { key: 'parentPhone', label: 'Parent phone', type: 'text', value: d.parentPhone ?? '' },
      { key: 'noParent', label: 'No parent on file', type: 'check', value: d.noParent },
      { key: 'classGrade', label: 'Class & grade', type: 'text', value: d.classText },
      { key: 'levelCode', label: 'Level code', type: 'text', value: d.levelCode ?? d.levelText },
      { key: 'subject', label: 'Subject', type: 'text', value: d.subject, wide: true },
      { key: 'teacher', label: 'Teacher', type: 'text', value: d.teacher ?? '' },
      { key: 'selfStudy', label: 'Self-study', type: 'check', value: d.selfStudy },
    ];
  }
  if (d.kind === 'scl') {
    const p = d.parents[0];
    return [
      { key: 'studentName', label: 'Student name', type: 'text', value: d.studentName },
      { key: 'studentEmail', label: 'Student email', type: 'text', value: d.studentEmail },
      { key: 'studentPhone', label: 'Student phone', type: 'text', value: d.studentPhone ?? '' },
      { key: 'classGrade', label: 'Grade', type: 'text', value: d.grade === null ? '' : String(d.grade) },
      { key: 'parentName', label: 'Parent name', type: 'text', value: p?.name ?? '' },
      { key: 'parentEmail', label: 'Parent email', type: 'text', value: p?.email ?? '' },
      { key: 'parentPhone', label: 'Parent phone', type: 'text', value: p?.phone ?? '' },
      { key: 'noParent', label: 'No parent on file', type: 'check', value: d.noParent },
    ];
  }
  return [
    { key: 'studentRef', label: 'Student (email or school ID)', type: 'text', value: d.studentRef, wide: true },
    { key: 'amount', label: 'Amount (EGP)', type: 'text', value: d.amount === null ? '' : String(d.amount) },
    { key: 'date', label: 'Date', type: 'text', value: d.happenedOn ?? '' },
  ];
}

/** The field a problem is about, so the editor marks it and puts the cursor there. */
const PROBLEM_FIELDS: Record<string, string[]> = {
  email_student_missing: ['studentEmail'], email_parent_missing: ['parentEmail'], email_student_is_parent: ['studentEmail', 'parentEmail'],
  student_email_shared: ['studentEmail'], email_taken: ['studentEmail', 'parentEmail'], class_unreadable: ['classGrade'], grade_out_of_range: ['classGrade'],
  level_code_unknown: ['levelCode'], phone_unusable: ['studentPhone', 'parentPhone'], subject_unmapped: ['subject'], student_not_found: ['studentRef'],
  amount_unreadable: ['amount'], date_unreadable: ['date'],
};

const OUTCOME_WORDS: Record<string, string> = {
  studentId: 'Student account', link: 'Parent link', section: 'Section', enrolment: 'Course enrolment', history: 'History row',
  registration: 'Line', money: 'Money history',
};

/** The entry as one sentence (the reservation pages' words). */
const ENTRY_WORDS: Record<string, string> = {
  'first|in_school': 'First entry, in school', 'first|self_study': 'First entry, self-study',
  'retake|in_school': 'Retake, in school', 'retake|self_study': 'Retake, self-study',
};

/** Problems whose detail is the sheet's own words (data, never translated). */
const DATA_DETAILS = new Set(['fee_note', 'dropped', 'self_study_contradiction', 'subject_unmapped', 'level_code_unknown', 'class_unreadable', 'column_drift']);

type SaveRows = { mutate: (json: Parameters<typeof api.v1.imports[':id']['rows']['$put']>[0]['json']) => void; isPending: boolean };

/**
 * The line a row makes in its session (the reservations rework): the subject and item the sheet's
 * words found, the entry and mode its note gives, the sitting a retake follows and where it is known
 * from, the teacher and the price from the session's fee grid — and staff's choices over them: the
 * item, first entry or retake, the sitting.
 */
function LineSection({ v, row, editable, save }: { v: ImportView; row: ImportRow; editable: boolean; save: SaveRows }) {
  const line = row.plan.line;
  const edits = (row.edits ?? {}) as { offerItemId?: string | null; attempt?: 'first' | 'retake'; priorSitting?: { month: string; year: number } | null };
  const sessionId = line?.sessionId ?? (row.seriesKey ? v.settings.series[row.seriesKey]?.sessionId ?? null : null);
  const items = sessionId ? v.mapping.sessionItems[sessionId] ?? [] : [];
  const [sitting, setSitting] = useState(() => edits.priorSitting ?? (line?.priorSitting ? { month: line.priorSitting.month, year: line.priorSitting.year } : { month: 'june', year: new Date().getFullYear() }));
  const teacher = line?.teacherId ? v.options.teachers.find((t) => t.id === line.teacherId)?.name ?? null : null;
  return (
    <section aria-labelledby="row-line" className="rounded-lg border border-border p-3">
      <h3 id="row-line" className="mb-2 text-sm font-semibold text-foreground">The line in the session</h3>
      {line ? (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Session</dt><dd><bdi>{line.sessionName}</bdi></dd>
          <dt className="text-muted-foreground">Subject and item</dt>
          <dd><bdi data-i18n-skip="true">{line.subjectName} — {line.itemLabel}</bdi> {line.found === 'staff' && <Badge tone="warning">Chosen on the line</Badge>}</dd>
          <dt className="text-muted-foreground">Board series</dt><dd><bdi data-i18n-skip="true">{line.series ?? '—'}</bdi></dd>
          <dt className="text-muted-foreground">Entry</dt>
          <dd>{ENTRY_WORDS[`${line.attempt}|${line.mode}`]}</dd>
          <dt className="text-muted-foreground">Sitting it follows</dt>
          <dd>
            {line.priorSitting ? (
              <>
                <span>{MONTH[line.priorSitting.month]} {line.priorSitting.year}</span>{' '}
                {line.priorSitting.source === 'legacy'
                  ? <Badge tone="info">From the student’s history (legacy)</Badge>
                  : <Badge tone="warning">Declared by the desk — listed to verify</Badge>}
              </>
            ) : '—'}
          </dd>
          <dt className="text-muted-foreground">Teacher</dt><dd>{line.mode === 'self_study' ? 'None (self-study)' : teacher ? <bdi data-i18n-skip="true">{teacher}</bdi> : 'No preference yet'}</dd>
          <dt className="text-muted-foreground">Price</dt>
          <dd>
            {line.price ? (
              <>
                <span className="tabular-nums">EGP {egp(line.price.total)}</span>{' '}
                <span className="block text-xs text-muted-foreground">{`course ${egp(line.price.courseFeeBase)} × ${line.price.coursePercent}% + board ${egp(line.price.boardFeeBase)} × ${line.price.boardPercent}%`}</span>
                {line.price.provisional && <> <Badge tone="warning">Board fee provisional</Badge></>}
              </>
            ) : <span className="text-muted-foreground">Not priced: the series’ grid has no fee for it</span>}
          </dd>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">No line yet: see the problems above.</p>
      )}
      {editable && sessionId && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <label className="block text-sm">
            <span className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><span>Item</span>{edits.offerItemId && <Badge tone="warning">Fixed</Badge>}</span>
            <select aria-label="The item of the session this line is" className={cn(SELECT, 'w-full')} disabled={save.isPending} value={edits.offerItemId ?? ''}
              onChange={(e) => save.mutate(e.target.value ? { rowIds: [row.id], edits: { offerItemId: e.target.value } } : { rowIds: [row.id], clear: ['offerItemId'] })}>
              <option value="">As the sheet’s words find it</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>{`${it.subjectName} — ${it.label}${it.series ? ` · ${it.series}` : ''}${it.availability === 'closed' ? ' · closed' : ''}`}</option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Entry</span>
            <div className="flex flex-wrap gap-2">
              {([['first', 'First entry'], ['retake', 'Retake'], [null, 'As the sheet says']] as const).map(([val, label]) => (
                <Button key={String(val)} size="sm" variant={(edits.attempt ?? null) === val ? 'default' : 'outline'} disabled={save.isPending}
                  onClick={() => save.mutate(val === null ? { rowIds: [row.id], clear: ['attempt'] } : { rowIds: [row.id], edits: { attempt: val } })}>
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="text-sm">
            <span className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><span>The sitting a retake follows (the desk’s declaration, verified on To verify)</span>{edits.priorSitting && <Badge tone="warning">Fixed</Badge>}</span>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Sitting month" className={SELECT} disabled={save.isPending} value={sitting.month} onChange={(e) => setSitting({ ...sitting, month: e.target.value })}>
                {Object.entries(MONTH).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
              <input aria-label="Sitting year" inputMode="numeric" className={cn(INPUT, 'w-24')} disabled={save.isPending} value={sitting.year} onChange={(e) => setSitting({ ...sitting, year: Number(e.target.value) || 0 })} />
              <Button size="sm" variant="outline" disabled={save.isPending || sitting.year < 2000}
                onClick={() => save.mutate({ rowIds: [row.id], edits: { priorSitting: { month: sitting.month as 'june', year: sitting.year } } })}>Name this sitting</Button>
              {edits.priorSitting && <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ rowIds: [row.id], clear: ['priorSitting'] })}>Undo</Button>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function RowEditor({ id, v, row, editable, onClose }: { id: string; v: ImportView; row: ImportRow; editable: boolean; onClose: () => void }) {
  const fields = useMemo(() => fieldsOf(row), [row]);
  const [values, setValues] = useState<Record<string, string | boolean>>(() => Object.fromEntries(fields.map((f) => [f.key, f.value])));
  const [series, setSeries] = useState(() => (row.data.kind === 'sheet' && row.data.series ? row.data.series : null));
  const [note, setNote] = useState('');
  useEffect(() => { setValues(Object.fromEntries(fields.map((f) => [f.key, f.value]))); }, [fields]);
  const edits = (row.edits ?? {}) as Record<string, unknown>;
  const save = useReviewMutation(id, (json: Parameters<typeof api.v1.imports[':id']['rows']['$put']>[0]['json']) =>
    apiResponse(api.v1.imports[':id'].rows.$put({ param: { id }, json })));
  const changed = Object.fromEntries(fields.filter((f) => values[f.key] !== f.value).map((f) => [f.key, values[f.key]]));
  const seriesChanged = row.data.kind === 'sheet' && series && (series.type !== row.data.series?.type || series.year !== row.data.series?.year);
  const onTaught = row.problems.find((p) => p.code === 'self_study_on_taught');
  const toExisting = row.problems.find((p) => p.code === 'link_to_existing_account');
  const linkConfirmed = edits.confirmLink === true;
  const choice = row.data.kind === 'sheet' ? row.data.selfStudyChoice : null;
  const person = row.studentKey ? v.people.find((p) => p.role === 'student' && p.key === row.studentKey) : undefined;
  const boxRef = useRef<HTMLDivElement>(null);
  const flagged = new Set(row.problems.filter((p) => p.severity !== 'info').flatMap((p) => PROBLEM_FIELDS[p.code] ?? []));
  const firstFlagged = fields.find((f) => flagged.has(f.key))?.key ?? null;
  useEffect(() => { if (!firstFlagged || !editable) boxRef.current?.focus(); }, [firstFlagged, editable]);
  const submit = () => save.mutate({ rowIds: [row.id], edits: { ...changed, ...(seriesChanged ? { series: series! } : {}) } });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-labelledby="row-editor-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div ref={boxRef} tabIndex={-1} className="flex h-full w-full max-w-3xl flex-col overflow-y-auto border-s border-border bg-card shadow-xl outline-none">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card px-5 py-3">
          <h2 id="row-editor-title" className="font-display text-lg font-bold text-foreground">
            <LineRef r={row} />
          </h2>
          <div className="flex items-center gap-2">
            {row.status === 'committed' ? <Badge tone="success">Committed</Badge> : row.decision === 'skip' ? <Badge tone="neutral">Left out</Badge> : null}
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
        <div className="space-y-5 px-5 py-4">
          {row.decision === 'skip' && row.skipReason && <Notice tone="neutral"><span>Left out:</span> <span>{row.skipReason}</span></Notice>}
          {row.error && <Notice tone="danger" title="Its family could not be committed">{row.error}</Notice>}
          {save.error && <Notice tone="danger">{save.error}</Notice>}

          {row.problems.length > 0 && (
            <section aria-labelledby="row-problems">
              <h3 id="row-problems" className="mb-2 text-sm font-semibold text-foreground">Problems</h3>
              <ul className="space-y-1.5">
                {row.problems.map((p) => (
                  <li key={p.code} className="flex gap-2 text-sm">
                    <SeverityDot severity={p.severity} />
                    <span>
                      <span className="font-medium text-foreground">{problemTitle(p.code)}</span>
                      {p.detail && <> <span className="text-muted-foreground">—</span> <bdi className="text-muted-foreground" {...(DATA_DETAILS.has(p.code) ? { 'data-i18n-skip': 'true' } : {})}>{p.detail}</bdi></>}
                      <span className="block text-xs text-muted-foreground">{problemMeaning(p.code)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(toExisting || linkConfirmed) && editable && (
            <fieldset className="rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-semibold text-foreground">A new link to an account already in the system</legend>
              {toExisting ? (
                <>
                  <p className="text-sm text-muted-foreground">Check with the family that the account named above is this line’s student or parent before linking them.</p>
                  <Button className="mt-2" size="sm" disabled={save.isPending} onClick={() => save.mutate({ rowIds: [row.id], edits: { confirmLink: true } })}>
                    It is the same person: link them
                  </Button>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="success">Link confirmed</Badge>
                  <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ rowIds: [row.id], clear: ['confirmLink'] })}>Undo</Button>
                </div>
              )}
            </fieldset>
          )}

          {row.data.kind === 'sheet' && (row.plan.registration === 'live' || row.plan.line) && (
            <LineSection v={v} row={row} editable={editable && row.status !== 'committed'} save={save} />
          )}

          {onTaught && editable && (
            <fieldset className="rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-semibold text-foreground">Self-study on a subject the school teaches</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {([['in_school', 'Taught in school instead'], ['enrol_only', 'Enrol as self-study only (no exam line)'], [null, 'As the setting says']] as const).map(([val, label]) => (
                  <Button key={String(val)} size="sm" variant={choice === val ? 'default' : 'outline'} disabled={save.isPending}
                    onClick={() => save.mutate(val === null ? { rowIds: [row.id], clear: ['selfStudyChoice'] } : { rowIds: [row.id], edits: { selfStudyChoice: val } })}>
                    {label}
                  </Button>
                ))}
              </div>
            </fieldset>
          )}

          <form aria-labelledby="row-fields" onSubmit={(e) => { e.preventDefault(); if (Object.keys(changed).length || seriesChanged) submit(); }}>
            <h3 id="row-fields" className="mb-2 text-sm font-semibold text-foreground">As read {editable && <span className="font-normal text-muted-foreground">— fix any field, Enter saves</span>}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <label key={f.key} className={cn('block text-sm', f.type === 'text' && f.wide && 'sm:col-span-2')}>
                  <span className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{f.label}</span>
                    {f.key in edits && <Badge tone="warning">Fixed</Badge>}
                  </span>
                  {f.type === 'check' ? (
                    <input type="checkbox" disabled={!editable} checked={values[f.key] === true} onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })} />
                  ) : (
                    <input
                      dir="auto" data-i18n-skip="true" disabled={!editable} aria-invalid={flagged.has(f.key) || undefined} autoFocus={editable && f.key === firstFlagged}
                      className={cn(INPUT, flagged.has(f.key) && 'border-destructive ring-[3px] ring-destructive/20')}
                      value={String(values[f.key] ?? '')} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    />
                  )}
                </label>
              ))}
              {row.data.kind === 'sheet' && (
                <div className="block text-sm">
                  <span className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><span>Exam series</span>{'series' in edits && <Badge tone="warning">Fixed</Badge>}</span>
                  <div className="flex gap-2">
                    <select aria-label="Series month" disabled={!editable} className={SELECT} value={series?.type ?? ''} onChange={(e) => setSeries({ type: e.target.value as 'june', year: series?.year ?? new Date().getFullYear() })}>
                      <option value="" disabled>—</option>
                      {Object.entries(MONTH).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                    <input aria-label="Series year" disabled={!editable} inputMode="numeric" className={cn(INPUT, 'w-24')} value={series?.year ?? ''} onChange={(e) => setSeries({ type: series?.type ?? 'june', year: Number(e.target.value) || 0 })} />
                  </div>
                </div>
              )}
            </div>
            {editable && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="submit" disabled={save.isPending || (!Object.keys(changed).length && !seriesChanged)}>
                  {save.isPending ? 'Saving…' : 'Save the fixes'}
                </Button>
                {Object.keys(edits).length > 0 && (
                  <Button type="button" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ rowIds: [row.id], clear: Object.keys(edits) })}>Back to what the sheet says</Button>
                )}
              </div>
            )}
          </form>

          {editable && (
            <section aria-labelledby="row-decision" className="rounded-lg border border-border p-3">
              <h3 id="row-decision" className="mb-2 text-sm font-semibold text-foreground">This row</h3>
              {row.decision === 'import' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input aria-label="Why it is left out (optional)" placeholder="Why (optional)" className={cn(INPUT, 'max-w-xs')} value={note} onChange={(e) => setNote(e.target.value)} />
                  <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate({ rowIds: [row.id], decision: 'skip', note: note || 'Left out by staff' })}>Leave it out</Button>
                </div>
              ) : (
                <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate({ rowIds: [row.id], decision: 'import' })}>Include it</Button>
              )}
            </section>
          )}

          <section aria-labelledby="row-plan">
            <h3 id="row-plan" className="mb-2 text-sm font-semibold text-foreground">{row.status === 'committed' ? 'What it made' : 'What a commit will make'}</h3>
            <div className="flex flex-wrap gap-1.5">{planWords(row).map((p) => <Badge key={p.label} tone={p.tone}>{p.label}</Badge>)}</div>
            {row.status === 'committed' && row.outcome && (
              <ul className="mt-2 space-y-0.5 text-sm">
                {Object.entries(row.outcome as Record<string, unknown>).filter(([k]) => k in OUTCOME_WORDS).map(([k, val]) => (
                  <li key={k}><span className="text-muted-foreground">{OUTCOME_WORDS[k]}:</span> <bdi data-i18n-skip="true" className="font-mono text-xs">{String(val)}</bdi></li>
                ))}
              </ul>
            )}
            {person && (
              <p className="mt-2 text-sm text-muted-foreground">
                <span>Student:</span> <bdi data-i18n-skip="true" className="text-foreground">{person.name}</bdi>
                {person.matched ? <> <Badge tone="success">Account found</Badge></> : <> <Badge tone="info">New account</Badge></>}
                {person.gradeToday !== null && <> · <span>grade today</span> <span className="tabular-nums">{person.gradeToday > 12 ? '—' : person.gradeToday}</span></>}
              </p>
            )}
          </section>

          <section aria-labelledby="row-raw">
            <h3 id="row-raw" className="mb-2 text-sm font-semibold text-foreground">As the sheet has it</h3>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {row.raw.map(([h, val], i) => (
                  <tr key={`${h}-${i}`}>
                    <th scope="row" className="w-44 py-1 pe-3 text-start align-top text-xs font-medium text-muted-foreground"><bdi data-i18n-skip="true">{h}</bdi></th>
                    <td className="py-1"><bdi data-i18n-skip="true" className="whitespace-pre-wrap break-words">{val}</bdi></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
