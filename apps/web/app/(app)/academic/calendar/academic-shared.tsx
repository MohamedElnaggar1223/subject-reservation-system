'use client';

/**
 * Shared by the F0a academic screens (years, calendar, bells, rooms) and
 * /today:
 * - dates as the school writes them (YYYY-MM-DD, the school's own day, no
 *   zone), rendered with each month and weekday name as its own text node so
 *   the page translator (lib/i18n.tsx) finds it;
 * - what a day is (the kinds GET /v1/academic/calendar/day answers) with its
 *   label and tone;
 * - the academic-year picker, kept in the URL (?year=2026) so the years,
 *   calendar and bells screens open on the same year and can link to each
 *   other.
 * Every response type is derived from the RPC fetcher (PATTERNS.md).
 */

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, academicYearStartOf, WEEKDAY_LABELS } from '@repo/validations';
import { Badge, type Tone } from '~/components/ui/tone';
import { cn } from '~/lib/utils';

// ─── Fetchers (typed by the API) ─────────────────────────────────────────────

export const fetchAcademicYears = () => apiResponse(api.v1.academic.years.$get());
export type AcademicYearRow = Awaited<ReturnType<typeof fetchAcademicYears>>[number];

export const fetchSchoolDay = (date?: string) =>
  apiResponse(api.v1.academic.calendar.day.$get({ query: date ? { date } : {} }));
export type SchoolDay = Awaited<ReturnType<typeof fetchSchoolDay>>;

export const fetchBellSchedules = (academicYearId: string) =>
  apiResponse(api.v1.academic['bell-schedules'].$get({ query: { academicYearId } }));
export type BellScheduleRow = Awaited<ReturnType<typeof fetchBellSchedules>>[number];

const fetchSettings = () => apiResponse(api.v1.settings.$get());

/** Every academic query starts with this, so one invalidation refreshes them all. */
export const ACADEMIC_KEY = ['academic'] as const;

export function useAcademicYears() {
  return useQuery({ queryKey: ['academic', 'years'], queryFn: fetchAcademicYears });
}

export function useBellSchedules(academicYearId: string) {
  return useQuery({ queryKey: ['academic', 'bell-schedules', academicYearId], queryFn: () => fetchBellSchedules(academicYearId) });
}

const isWeekdayList = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === 'number');

/**
 * The school week (the calendar.schoolWeekdays setting) and whether the
 * viewer may change it on the Settings page. Refetched on every visit: it
 * changes on another screen.
 */
export function useSchoolWeek() {
  const q = useQuery({ queryKey: ['academic', 'school-week'], queryFn: fetchSettings, staleTime: 0 });
  const setting = q.data?.find((s) => s.key === 'calendar.schoolWeekdays');
  return {
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
    weekdays: setting && isWeekdayList(setting.value) ? setting.value : null,
    canEdit: setting?.canEdit ?? false,
  };
}

// ─── The chosen academic year (?year=2026) ───────────────────────────────────

/** The current year, else the nearest upcoming one, else the latest. */
function defaultYear(years: AcademicYearRow[]): AcademicYearRow | undefined {
  const current = academicYearStartOf();
  return (
    years.find((y) => y.isCurrent) ??
    [...years].filter((y) => y.startYear > current).sort((a, b) => a.startYear - b.startYear)[0] ??
    years[0]
  );
}

export function useChosenYear(years: AcademicYearRow[] | undefined) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const wanted = Number(params.get('year'));
  const year = years?.find((y) => y.startYear === wanted) ?? (years ? defaultYear(years) : undefined);
  const choose = (startYear: number) => router.replace(`${pathname}?year=${startYear}` as Route, { scroll: false });
  return { year, choose };
}

export function yearHref(path: '/academic/years' | '/academic/calendar' | '/academic/bells', startYear: number): Route {
  return `${path}?year=${startYear}` as Route;
}

export function yearStatus(y: AcademicYearRow): { label: string; tone: Tone } {
  if (y.isCurrent) return { label: 'Current year', tone: 'success' };
  return y.startYear > academicYearStartOf() ? { label: 'Upcoming', tone: 'info' } : { label: 'Past', tone: 'neutral' };
}

export const SELECT_CLASS =
  'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50';

/** The year picker every per-year screen shows in its header. */
export function YearPicker({ years, year, onChoose }: { years: AcademicYearRow[]; year: AcademicYearRow; onChoose: (startYear: number) => void }) {
  const status = yearStatus(year);
  return (
    <div className="flex items-end gap-2">
      <div>
        <label htmlFor="academic-year-picker" className="mb-1 block text-xs font-medium text-muted-foreground">
          Academic year
        </label>
        <select
          id="academic-year-picker"
          value={year.startYear}
          onChange={(e) => onChoose(Number(e.target.value))}
          className={cn(SELECT_CLASS, 'w-32 font-semibold')}
        >
          {years.map((y) => (
            <option key={y.id} value={y.startYear}>
              {y.shortLabel}
            </option>
          ))}
        </select>
      </div>
      <Badge tone={status.tone} className="mb-2.5">{status.label}</Badge>
    </div>
  );
}

/** What a per-year screen shows when no academic year exists yet. */
export function NoYearYet({ what }: { what: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-10 text-center shadow-sm">
      <p className="font-medium text-foreground">No academic year yet</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{what}</p>
      <Link
        href="/academic/years"
        className="mt-4 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        Set up the academic year
      </Link>
    </div>
  );
}

// ─── Dates ───────────────────────────────────────────────────────────────────

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const WEEKDAYS = WEEKDAY_LABELS;
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function dateParts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}

export function toDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Days from a to b (b − a); inclusive counts add one. */
export function daysFrom(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "2026-09" of a date. */
export const monthOf = (date: string) => date.slice(0, 7);

/**
 * A date as separate text nodes ("Tue", "29", "Sep", "2026"), so each word
 * translates on its own.
 */
export function DateText({
  date,
  weekday = false,
  long = false,
  year = true,
  className,
}: {
  date: string;
  weekday?: boolean;
  long?: boolean;
  year?: boolean;
  className?: string;
}) {
  const { y, m, d } = dateParts(date);
  return (
    <span className={cn('whitespace-nowrap', className)}>
      {weekday && (
        <>
          {(long ? WEEKDAYS : WEEKDAYS_SHORT)[weekdayOf(date)]}
          {' '}
        </>
      )}
      {d}
      {' '}
      {(long ? MONTHS : MONTHS_SHORT)[m - 1]}
      {year && (
        <>
          {' '}
          {y}
        </>
      )}
    </span>
  );
}

/** "13 Sep – 24 Jun 2027", or one date when both ends are the same day. */
export function DateRange({ from, to, weekday = false }: { from: string; to: string; weekday?: boolean }) {
  if (from === to) return <DateText date={from} weekday={weekday} />;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return (
    <span className="whitespace-nowrap">
      <DateText date={from} weekday={weekday} year={!sameYear} />
      {' – '}
      <DateText date={to} weekday={weekday} />
    </span>
  );
}

// ─── What a day is ───────────────────────────────────────────────────────────

export type DayKind = SchoolDay['kind'];

export const DAY_KIND: Record<DayKind, { label: string; tone: Tone }> = {
  school_day: { label: 'School day', tone: 'success' },
  extra_school_day: { label: 'Extra school day', tone: 'success' },
  early_dismissal: { label: 'Early dismissal', tone: 'warning' },
  exam_only: { label: 'Exam-only day', tone: 'info' },
  holiday: { label: 'Holiday', tone: 'danger' },
  weekend: { label: 'Weekend', tone: 'neutral' },
  out_of_term: { label: 'Out of term', tone: 'neutral' },
  no_academic_year: { label: 'No academic year set up', tone: 'warning' },
};

/** The kinds a calendar entry can be (CALENDAR_ENTRY_KINDS), as staff name them. */
export const ENTRY_KIND: Record<'holiday' | 'early_dismissal' | 'exam_only' | 'school_day', { label: string; hint: string; tone: Tone }> = {
  holiday: { label: 'Holiday', hint: 'No school.', tone: 'danger' },
  early_dismissal: { label: 'Early dismissal', hint: 'School on a shorter bell schedule.', tone: 'warning' },
  exam_only: { label: 'Exam-only day', hint: 'Students come in for exams only: no lessons.', tone: 'info' },
  school_day: { label: 'Extra school day', hint: 'A make-up day on a weekend or outside term.', tone: 'success' },
};

export const PERIOD_KIND: Record<string, { label: string; tone: Tone }> = {
  lesson: { label: 'Lesson', tone: 'neutral' },
  break: { label: 'Break', tone: 'warning' },
  assembly: { label: 'Assembly', tone: 'info' },
  // 'Registration' already translates as subject registration; this is the homeroom roll call.
  registration: { label: 'Roll call', tone: 'info' },
};

/** A period's kind is worth a badge unless it is a lesson or the period's name already says it ("Break", "Roll call"). */
export function periodBadge(p: { kind: string; label: string }): { label: string; tone: Tone } | null {
  const k = PERIOD_KIND[p.kind];
  if (!k || p.kind === 'lesson' || k.label.toLowerCase() === p.label.trim().toLowerCase()) return null;
  return k;
}

// ─── Clock times ─────────────────────────────────────────────────────────────

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function fromMinutes(total: number): string {
  const t = Math.max(0, Math.min(23 * 60 + 59, total));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** What staff type ("8", "815", "0815", "8:15", "8.15") as HH:MM; unchanged when it cannot be read. */
export function normalizeTime(input: string): string {
  const s = input.trim().replace(/[.,٫]/g, ':').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
  let h: number;
  let m: number;
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else if (/^\d{1,4}$/.test(s)) {
    if (s.length <= 2) {
      h = Number(s);
      m = 0;
    } else {
      h = Number(s.slice(0, s.length - 2));
      m = Number(s.slice(-2));
    }
  } else {
    return input;
  }
  if (h > 23 || m > 59) return input;
  return fromMinutes(h * 60 + m);
}

/** The school's clock (Cairo) as HH:MM and seconds past midnight, from the browser's clock. */
export function schoolClock(now: Date): { hhmm: string; seconds: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const h = get('hour');
  const m = get('minute');
  return { hhmm: fromMinutes(h * 60 + m), seconds: h * 3600 + m * 60 + get('second') };
}
