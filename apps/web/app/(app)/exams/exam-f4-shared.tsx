'use client';

/**
 * Shared by the F4 screens (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md
 * §8): the fetchers — typed by the API through the RPC client, never by hand
 * (PATTERNS.md) — one query-key root so a change refreshes every exam screen,
 * the series picker kept in the address, and the small pieces every screen
 * shows (an entry's status, what the board would refuse, a board's name kept
 * as the board writes it, a print button). Text with a number or a name in it
 * is split into its own nodes so the page translator (lib/i18n.tsx) finds the
 * words.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api } from '~/lib/hono';
import {
  apiResponse, academicYearStartOf, ENTRY_PROBLEM_LABELS, ENTRY_STATUS_LABELS, EXAM_SESSION_LABELS,
  type EntryProblem, type EntryStatus, type ExamSession,
} from '@repo/validations';
import { Badge, type Tone } from '~/components/ui/tone';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { cn } from '~/lib/utils';
import { fetchBoardSeries, SeriesName, SELECT_CLASS, type BoardSeriesRow } from './exams-shared';

// ─── Fetchers (types come from the API) ──────────────────────────────────────

export const fetchCandidates = (q: { search?: string; boardSeriesId?: string; missing?: 'legal_name' | 'date_of_birth' | 'gender' | 'uci' | 'candidate_number' | 'national_id' } = {}) =>
  apiResponse(api.v1.exams.candidates.$get({ query: q }));
export type CandidatesData = Awaited<ReturnType<typeof fetchCandidates>>;
export type CandidateRow = CandidatesData['candidates'][number];

export const fetchCandidate = (studentId: string) => apiResponse(api.v1.exams.candidates[':studentId'].$get({ param: { studentId } }));
export type CandidateDetail = Awaited<ReturnType<typeof fetchCandidate>>;

export const fetchEntries = (q: { boardSeriesId?: string; studentId?: string; includeWithdrawn?: 'true' | 'false' }) =>
  apiResponse(api.v1.exams.entries.$get({ query: q }));
export type EntryRow = Awaited<ReturnType<typeof fetchEntries>>[number];

export const fetchEntryList = (boardSeriesId: string) => apiResponse(api.v1.exams['entry-lists'].$get({ query: { boardSeriesId } }));
export type EntryListData = Awaited<ReturnType<typeof fetchEntryList>>;

export const fetchBoardRules = () => apiResponse(api.v1.exams['board-rules'].$get());
export type BoardRuleRow = Awaited<ReturnType<typeof fetchBoardRules>>[number];

export const fetchForecasts = (boardSeriesId?: string) => apiResponse(api.v1.exams.forecasts.$get({ query: boardSeriesId ? { boardSeriesId } : {} }));
export type ForecastRow = Awaited<ReturnType<typeof fetchForecasts>>[number];

export const fetchPapers = (boardSeriesId: string) => apiResponse(api.v1.exams.papers.$get({ query: { boardSeriesId } }));
export type PapersData = Awaited<ReturnType<typeof fetchPapers>>;

export const fetchClashes = (boardSeriesId: string) => apiResponse(api.v1.exams.clashes.$get({ query: { boardSeriesId } }));
export type ClashRow = Awaited<ReturnType<typeof fetchClashes>>[number];

export const fetchSittings = (q: { boardSeriesId?: string; from?: string; to?: string }) => apiResponse(api.v1.exams.sittings.$get({ query: q }));
export type SittingsData = Awaited<ReturnType<typeof fetchSittings>>;

export const fetchSittingPlan = (examDate: string, session: ExamSession) => apiResponse(api.v1.exams.sittings.plan.$get({ query: { examDate, session } }));
export type SittingPlan = Awaited<ReturnType<typeof fetchSittingPlan>>;

export const fetchRegister = (paperId: string, roomId?: string) => apiResponse(api.v1.exams.registers.$get({ query: roomId ? { paperId, roomId } : { paperId } }));
export type RegisterData = Awaited<ReturnType<typeof fetchRegister>>;

export const fetchMyDuties = () => apiResponse(api.v1.exams.invigilation.mine.$get());
export type DutiesData = Awaited<ReturnType<typeof fetchMyDuties>>;

export const fetchSpecialConsiderations = (boardSeriesId: string) => apiResponse(api.v1.exams['special-consideration'].$get({ query: { boardSeriesId } }));

export const fetchResults = (q: { boardSeriesId?: string; studentId?: string }) => apiResponse(api.v1.exams.results.$get({ query: q }));
export type ResultsData = Awaited<ReturnType<typeof fetchResults>>;

export const fetchMappings = () => apiResponse(api.v1.exams.results.mappings.$get({ query: {} }));

export const fetchCertificates = (q: { boardSeriesId?: string; status?: 'received' | 'collected' | 'returned_to_board' | 'destroyed'; unclaimedOnly?: 'true' | 'false'; search?: string }) =>
  apiResponse(api.v1.exams.certificates.$get({ query: q }));
export type CertificatesData = Awaited<ReturnType<typeof fetchCertificates>>;

export const fetchDeadlines = () => apiResponse(api.v1.exams.deadlines.$get({ query: {} }));
export type DeadlinesData = Awaited<ReturnType<typeof fetchDeadlines>>;

export const fetchStudentSeries = (studentId: string) => apiResponse(api.v1.exams.students[':studentId'].series.$get({ param: { studentId } }));
export const fetchStatement = (studentId: string, boardSeriesId: string) =>
  apiResponse(api.v1.exams.students[':studentId'].statement.$get({ param: { studentId }, query: { boardSeriesId } }));
export type StatementData = Awaited<ReturnType<typeof fetchStatement>>;
export const fetchStudentTimetable = (studentId: string, boardSeriesId?: string) =>
  apiResponse(api.v1.exams.students[':studentId'].timetable.$get({ param: { studentId }, query: boardSeriesId ? { boardSeriesId } : {} }));
export const fetchStudentResults = (studentId: string) => apiResponse(api.v1.exams.students[':studentId'].results.$get({ param: { studentId } }));

/** Every F4 query starts with this: one invalidation refreshes every exam screen. */
export const EXAMS_KEY = ['exams'] as const;

// ─── The series picker, kept in the address (?series=) ───────────────────────

const MONTH_ORDER: Record<string, number> = { january: 1, june: 6, october: 10, november: 11 };

/**
 * Every board series of last, this and next academic year, the chosen one
 * from the address — else the next one whose entry deadline or exams are
 * still ahead (what the coordinator works on now).
 */
export function useSeriesChoice(param = 'series') {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const y = academicYearStartOf();
  const { data: all = [], isLoading } = useQuery({
    queryKey: [...EXAMS_KEY, 'series-choice', y],
    queryFn: async () => (await Promise.all([y - 1, y, y + 1].map((ay) => fetchBoardSeries(ay)))).flat(),
  });
  const sorted = useMemo(
    () => [...all].sort((a, b) => b.year - a.year || (MONTH_ORDER[b.month] ?? 0) - (MONTH_ORDER[a.month] ?? 0) || a.name.localeCompare(b.name)),
    [all],
  );
  const chosenId = search.get(param);
  const today = new Date().toISOString().slice(0, 10);
  const fallback = useMemo(() => {
    const ahead = [...all]
      .filter((s) => (s.entryDeadline && !s.entryDeadlinePassed) || (s.examsEnd ?? '') >= today)
      .sort((a, b) => a.year - b.year || (MONTH_ORDER[a.month] ?? 0) - (MONTH_ORDER[b.month] ?? 0));
    return ahead[0] ?? sorted[0] ?? null;
  }, [all, sorted, today]);
  const chosen = sorted.find((s) => s.id === chosenId) ?? fallback;
  const choose = (id: string) => {
    const next = new URLSearchParams(search.toString());
    next.set(param, id);
    router.replace(`${pathname}?${next.toString()}` as never, { scroll: false });
  };
  return { series: sorted, chosen, choose, isLoading };
}

/** The series picker: board, month and year, as the boards write them. */
export function SeriesSelect({
  series, value, onChange, id = 'exam-series', label = 'Board series', className,
}: {
  series: BoardSeriesRow[]; value: string | null | undefined; onChange: (id: string) => void; id?: string; label?: string; className?: string;
}): React.JSX.Element {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1 text-xs text-muted-foreground">{label}</Label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={cn(SELECT_CLASS, 'min-w-72 font-semibold')} data-i18n-skip="true">
        {!value && <option value="">—</option>}
        {series.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Small pieces ────────────────────────────────────────────────────────────

const STATUS_TONE: Record<EntryStatus, Tone> = { draft: 'neutral', submitted: 'success', amended: 'info', withdrawn: 'danger' };

export function EntryStatusBadge({ status }: { status: string }): React.JSX.Element {
  return <Badge tone={STATUS_TONE[status as EntryStatus] ?? 'neutral'}>{ENTRY_STATUS_LABELS[status as EntryStatus] ?? status}</Badge>;
}

/** What the board would refuse or ask for, one chip each; "Ready" when nothing. */
export function ProblemChips({ problems, className }: { problems: readonly string[]; className?: string }): React.JSX.Element {
  if (!problems.length) return <Badge tone="success" className={className}>Ready</Badge>;
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {problems.map((p) => (
        <Badge key={p} tone={p === 'registration_not_confirmed' || p === 'missing_forecast' ? 'danger' : 'warning'}>
          {ENTRY_PROBLEM_LABELS[p as EntryProblem] ?? p}
        </Badge>
      ))}
    </span>
  );
}

export function SessionBadge({ session }: { session: string }): React.JSX.Element {
  return <Badge tone="neutral">{EXAM_SESSION_LABELS[session as ExamSession] ?? session}</Badge>;
}

/** A board's name (or anything else the board writes) is never translated. */
export function BoardText({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <bdi data-i18n-skip="true" className={className}>{children}</bdi>;
}

/** A code (0610, WMA11/01, EG123) kept left to right and untranslated. */
export function Code({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <bdi data-i18n-skip="true" dir="ltr" className={cn('font-mono', className)}>{children}</bdi>;
}

/** Print what is on screen (the page's own print layout hides navigation). */
export function PrintButton({ label = 'Print', className }: { label?: string; className?: string }): React.JSX.Element {
  return (
    <Button type="button" variant="outline" size="sm" className={cn('print:hidden', className)} onClick={() => window.print()}>
      {label}
    </Button>
  );
}

export { SeriesName };
export type { BoardSeriesRow };
