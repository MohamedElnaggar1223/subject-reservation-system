'use client';

/**
 * Shared by the F0b screens (catalogue, board series, a window's series,
 * course enrolment): the fetchers, typed by the API (PATTERNS.md), and the
 * small pieces every one of them shows — a board's name, a series' entry
 * deadline with how long is left, the level labels. Text that carries a
 * number or a name is split into its own nodes so the page translator
 * (lib/i18n.tsx) finds the words.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, schoolDateString, UNIT_LEVEL_LABELS, QUALIFICATION_LEVEL_LABELS, type UnitLevel, type QualificationLevel } from '@repo/validations';
import { Badge, type Tone } from '~/components/ui/tone';
import { DateText, daysFrom } from '../academic/calendar/academic-shared';

// ─── Fetchers ────────────────────────────────────────────────────────────────

export const fetchCatalogue = () => apiResponse(api.v1.catalogue.$get());
export type CatalogueData = Awaited<ReturnType<typeof fetchCatalogue>>;
export type RegistrableRow = CatalogueData['registrable'][number];
export type QualificationRow = CatalogueData['qualifications'][number];
export type UnitRow = CatalogueData['units'][number];
export type BoardRow = CatalogueData['boards'][number];

export const fetchBoardSeries = (academicYear?: number) =>
  apiResponse(api.v1['board-series'].$get({ query: academicYear === undefined ? {} : { academicYear: String(academicYear) } }));
export type BoardSeriesRow = Awaited<ReturnType<typeof fetchBoardSeries>>[number];

export const fetchTeachers = () => apiResponse(api.v1.teachers.$get({ query: {} }));
export type TeacherRow = Awaited<ReturnType<typeof fetchTeachers>>[number];

/** Every F0b query starts with one of these, so one invalidation refreshes them all. */
export const CATALOGUE_KEY = ['catalogue'] as const;
export const SERIES_KEY = ['board-series'] as const;
export const ENROLMENT_KEY = ['enrolments'] as const;

export function useCatalogue() {
  return useQuery({ queryKey: [...CATALOGUE_KEY], queryFn: fetchCatalogue });
}

// ─── Words ───────────────────────────────────────────────────────────────────

export const MONTH_LABEL: Record<string, string> = { january: 'January', june: 'June', october: 'October', november: 'November' };

export function unitLevelLabel(level: string): string {
  return UNIT_LEVEL_LABELS[level as UnitLevel] ?? level;
}

export function levelLabel(level: string): string {
  return QUALIFICATION_LEVEL_LABELS[level as QualificationLevel] ?? level;
}

export const UNIT_LEVEL_TONE: Record<string, Tone> = { igcse: 'neutral', as: 'info', a2: 'warning' };

/** "Pearson Edexcel October 2026 (IAL)" as separate words. */
export function SeriesName({ boardName, month, year, label }: { boardName: string; month: string; year: number; label?: string | null }) {
  return (
    <span>
      <span>{boardName}</span> <span>{MONTH_LABEL[month] ?? month}</span> <span dir="ltr">{year}</span>
      {label ? <> <span className="text-muted-foreground">(<bdi data-i18n-skip="true">{label}</bdi>)</span></> : null}
    </span>
  );
}

/** An instant as the school reads it: its Cairo date and time, each word its own node. */
export function InstantText({ iso, time = true }: { iso: string; time?: boolean }) {
  const d = new Date(iso);
  const date = schoolDateString(d);
  const hhmm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Cairo' });
  return (
    <span className="whitespace-nowrap">
      <DateText date={date} />
      {time && <> <span dir="ltr">{hhmm}</span></>}
    </span>
  );
}

/**
 * An entry deadline with what it means now: days left (amber inside a
 * fortnight), today, or passed — the school's hard stop (MO-10).
 */
export function DeadlineBadge({ iso }: { iso: string | null }) {
  if (!iso) return <Badge tone="warning">No entry deadline yet</Badge>;
  const today = schoolDateString(new Date());
  const day = schoolDateString(new Date(iso));
  const passed = new Date(iso).getTime() <= Date.now();
  if (passed) return <Badge tone="danger">Passed</Badge>;
  const left = daysFrom(today, day);
  if (left <= 0) return <Badge tone="danger">Today</Badge>;
  return (
    <Badge tone={left <= 14 ? 'warning' : 'success'}>
      <span>{left}</span>&nbsp;<span>{left === 1 ? 'day left' : 'days left'}</span>
    </Badge>
  );
}

/** A date-only board date, or a dash. */
export function MaybeDate({ date }: { date: string | null | undefined }) {
  return date ? <DateText date={date} /> : <span className="text-muted-foreground">—</span>;
}

/** The school's level code, as a badge. */
export function LevelCodeBadge({ code }: { code: string }) {
  const tone: Tone = code === 'A.S./A.2.' ? 'info' : code === 'O.L.' ? 'neutral' : 'success';
  return <Badge tone={tone} className="font-mono" ><bdi data-i18n-skip="true">{code}</bdi></Badge>;
}

export const SELECT_CLASS =
  'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50';
