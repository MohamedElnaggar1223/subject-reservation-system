'use client';

/**
 * Shared by the day-one import's screens (FEATURES_PLAN.md F7): the
 * fetchers, typed by the API (PATTERNS.md: never by hand), the words for a
 * problem, a plan and a status, and the small pieces every tab shows. Text
 * that carries a number or a name is split into its own nodes so the page
 * translator (lib/i18n.tsx) finds the words; names, emails and the sheet's
 * own cells are marked data-i18n-skip.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, IMPORT_PROBLEMS, IMPORT_NOTES, IMPORT_KIND_LABELS, type ImportProblemCode, type ImportNoteCode, type ImportKind } from '@repo/validations';
import { Badge, type Tone } from '~/components/ui/tone';
import { cn } from '~/lib/utils';

// ─── Fetchers ────────────────────────────────────────────────────────────────

export const fetchImports = () => apiResponse(api.v1.imports.$get());
export type ImportListRow = Awaited<ReturnType<typeof fetchImports>>[number];

export const fetchImport = (id: string) => apiResponse(api.v1.imports[':id'].$get({ param: { id } }));
export type ImportView = Awaited<ReturnType<typeof fetchImport>>;
export type ImportRow = ImportView['rows'][number];
export type ImportPerson = ImportView['people'][number];
export type ImportFamily = ImportView['families'][number];
export type ImportProblem = ImportRow['problems'][number];

export const IMPORTS_KEY = ['imports'] as const;

export function useImport(id: string) {
  return useQuery({ queryKey: [...IMPORTS_KEY, id], queryFn: () => fetchImport(id) });
}

// ─── Words ───────────────────────────────────────────────────────────────────

export const SEVERITY: Record<string, { tone: Tone; label: string; order: number }> = {
  error: { tone: 'danger', label: 'Must be fixed', order: 0 },
  warning: { tone: 'warning', label: 'Check it', order: 1 },
  info: { tone: 'info', label: 'For information', order: 2 },
};

export const problemTitle = (code: string) => IMPORT_PROBLEMS[code as ImportProblemCode]?.title ?? code;
export const problemMeaning = (code: string) => IMPORT_PROBLEMS[code as ImportProblemCode]?.meaning ?? '';
export const problemFinding = (code: string) => (IMPORT_PROBLEMS[code as ImportProblemCode] as { finding?: string } | undefined)?.finding ?? null;
export const noteTitle = (code: string) => IMPORT_NOTES[code as ImportNoteCode]?.title ?? code;
export const noteMeaning = (code: string) => IMPORT_NOTES[code as ImportNoteCode]?.meaning ?? '';
export const kindLabel = (kind: string) => IMPORT_KIND_LABELS[kind as ImportKind] ?? kind;

export const STATUS: Record<string, { tone: Tone; label: string }> = {
  staged: { tone: 'info', label: 'Waiting for review' },
  committing: { tone: 'warning', label: 'Being committed' },
  partial: { tone: 'warning', label: 'Partly committed' },
  committed: { tone: 'success', label: 'Committed' },
  discarded: { tone: 'neutral', label: 'Put aside' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: 'neutral' as Tone, label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const FAMILY_STATUS: Record<string, { tone: Tone; label: string }> = {
  ready: { tone: 'info', label: 'Ready' },
  held: { tone: 'danger', label: 'Held back' },
  committed: { tone: 'success', label: 'Committed' },
  failed: { tone: 'danger', label: 'Failed — see why' },
  partly_committed: { tone: 'warning', label: 'Partly committed' },
};

export const LEVEL_LABEL: Record<string, string> = { igcse: 'IGCSE', as_level: 'AS Level', a_level: 'A Level' };
export const MONTH: Record<string, string> = { january: 'January', june: 'June', october: 'October', november: 'November' };

/** What a row will make, in a few words. */
export function planWords(r: ImportRow): { label: string; tone: Tone }[] {
  const p = r.plan;
  const out: { label: string; tone: Tone }[] = [];
  if (r.status === 'committed') return [{ label: 'Committed', tone: 'success' }];
  if (r.decision === 'skip') return [{ label: 'Left out', tone: 'neutral' }];
  if (p.registration === 'live') out.push({ label: 'Registration awaiting payment', tone: 'warning' });
  if (p.registration === 'live_exists') out.push({ label: 'Registered already', tone: 'neutral' });
  if (p.registration === 'history') out.push({ label: 'History', tone: 'info' });
  if (p.registration === 'history_exists') out.push({ label: 'History already', tone: 'neutral' });
  if (p.enrolment === 'create') out.push({ label: 'Enrolment', tone: 'info' });
  if (p.money === 'create') out.push({ label: 'Money history', tone: 'info' });
  if (p.money === 'exists') out.push({ label: 'Money history already', tone: 'neutral' });
  if (r.data.kind === 'scl' && p.student === 'create') out.push({ label: 'New student', tone: 'info' });
  return out;
}

export function SeverityDot({ severity }: { severity: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        severity === 'error' ? 'bg-red-500' : severity === 'warning' ? 'bg-amber-500' : 'bg-violet-400',
      )}
    />
  );
}

/** A problem as a chip: its severity, its title. */
export function ProblemChip({ p, compact = false }: { p: ImportProblem; compact?: boolean }) {
  return (
    <span
      title={p.detail ? `${problemTitle(p.code)} — ${p.detail}` : problemTitle(p.code)}
      className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', SEV_CHIP[p.severity])}
    >
      <SeverityDot severity={p.severity} />
      <span className={cn(compact && 'truncate')}>{problemTitle(p.code)}</span>
    </span>
  );
}
const SEV_CHIP: Record<string, string> = {
  error: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  info: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
};

/** The line of the sheet a row came from: "2024, row 14". */
export function LineRef({ r }: { r: Pick<ImportRow, 'tab' | 'rowNumber'> }) {
  return (
    <span className="whitespace-nowrap tabular-nums text-muted-foreground">
      <bdi data-i18n-skip="true">{r.tab}</bdi><span>, row</span> <span>{r.rowNumber}</span>
    </span>
  );
}

/** A student or parent as the sheet names them. */
export function Who({ name, email }: { name?: string | null; email?: string | null }) {
  return (
    <span className="min-w-0">
      <bdi data-i18n-skip="true" className="block truncate font-medium text-foreground">{name || email || '—'}</bdi>
      {email && name && <bdi data-i18n-skip="true" className="block truncate text-xs text-muted-foreground">{email}</bdi>}
    </span>
  );
}

/** What a row names: its student, subject, level and series, whatever the source. */
export function rowSummary(r: ImportRow) {
  const d = r.data;
  if (d.kind === 'sheet') {
    return {
      student: d.studentName, email: d.studentEmail, subject: d.subject, code: d.levelCode ?? d.levelText,
      series: d.series ? `${MONTH[d.series.type]} ${d.series.year}` : null, cls: d.section ?? d.classText,
    };
  }
  if (d.kind === 'scl') return { student: d.studentName, email: d.studentEmail, subject: null, code: null, series: null, cls: d.grade !== null ? `grade ${d.grade}` : null };
  return { student: d.studentRef, email: null, subject: d.subject, code: null, series: d.seriesLabel, cls: null };
}

export const SELECT = 'h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';
export const INPUT = 'h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';
