'use client';

/**
 * Shared by the timetable screens (FEATURES_PLAN.md F1): the fetchers (every
 * response type derived from the RPC client, PATTERNS.md), one query key so a
 * change refreshes every screen, the year picker in the address (?year=), and
 * the words for a day and a lesson's status.
 */

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { api } from '~/lib/hono';
import { apiResponse, WEEKDAY_NAMES } from '@repo/validations';
import { Badge, type Tone } from '~/components/ui/tone';
import { cn } from '~/lib/utils';

export const TT_KEY = ['timetable'] as const;

// ─── Fetchers ────────────────────────────────────────────────────────────────

export const fetchTimetables = (academicYearId: string) => apiResponse(api.v1.timetables.$get({ query: { academicYearId } }));
export type TimetableRow = Awaited<ReturnType<typeof fetchTimetables>>[number];

export const fetchTimetable = (id: string) => apiResponse(api.v1.timetables[':id'].$get({ param: { id } }));
export type Editor = Awaited<ReturnType<typeof fetchTimetable>>;
export type EditorGroup = Editor['groups'][number];
export type EditorLesson = Editor['engine']['lessons'][number];
export type EditorClash = Editor['clashes'][number];

export const fetchGroups = (academicYearId: string) => apiResponse(api.v1.scheduling.groups.$get({ query: { academicYearId } }));
export type GroupList = Awaited<ReturnType<typeof fetchGroups>>;
export type GroupRow = GroupList['groups'][number];

export const fetchGroup = (id: string) => apiResponse(api.v1.scheduling.groups[':id'].$get({ param: { id } }));

export const fetchRules = (academicYearId: string) => apiResponse(api.v1.scheduling.rules.$get({ query: { academicYearId } }));
export type Rules = Awaited<ReturnType<typeof fetchRules>>;

export const fetchTeachers = () => apiResponse(api.v1.teachers.$get({ query: {} }));

export const fetchWeek = (q: { studentId?: string; teacherId?: string; roomId?: string; sectionId?: string; date?: string }) =>
  apiResponse(api.v1.schedule.week.$get({ query: q }));
export type Week = Awaited<ReturnType<typeof fetchWeek>>;
export type WeekDay = Week['days'][number];
export type WeekLesson = WeekDay['lessons'][number];

export const fetchMyWeek = (date?: string) => apiResponse(api.v1.schedule.me.week.$get({ query: date ? { date } : {} }));
export const fetchMyDay = (date?: string) => apiResponse(api.v1.schedule.me.day.$get({ query: date ? { date } : {} }));
export type MyDay = Awaited<ReturnType<typeof fetchMyDay>>;

export const fetchClass = (lessonId: string, date: string) => apiResponse(api.v1.schedule.lesson.$get({ query: { lessonId, date } }));

export const fetchFeed = () => apiResponse(api.v1.schedule.feed.$get());

/** The clashes in a year's published timetables the coordinator went ahead with. */
export const fetchPublishedClashes = (academicYearId: string) => apiResponse(api.v1.timetables.clashes.$get({ query: { academicYearId } }));

// ─── Words ───────────────────────────────────────────────────────────────────

export const DAY_NAMES = WEEKDAY_NAMES;
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  covered: { label: 'Cover', tone: 'info' },
  uncovered: { label: 'Teacher away', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  covering: { label: 'You cover', tone: 'info' },
  covered_by_other: { label: 'Covered by a colleague', tone: 'neutral' },
};

export function StatusBadge({ status }: { status: string }) {
  if (status === 'scheduled') return null;
  const s = STATUS[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Why a day has no lessons, in a sentence. */
export const DAY_NOTE: Record<string, string> = {
  holiday: 'Holiday: no lessons',
  weekend: 'Weekend',
  out_of_term: 'Between terms: no lessons',
  no_academic_year: 'Outside the school year',
  exam_only: 'Exams only: no lessons',
  no_timetable: 'No timetable is published for this day yet',
  left: 'Has left the school',
};

export const ROOM_TYPE_LABEL: Record<string, string> = {
  classroom: 'Classroom',
  science_lab: 'Science lab',
  computer_lab: 'Computer lab',
  hall: 'Hall',
  library: 'Library',
  art_room: 'Art room',
  sports: 'Sports',
  other: 'Other',
};

export const FEATURE_LABEL: Record<string, string> = {
  projector: 'Projector',
  smartboard: 'Smartboard',
  computers: 'Computers',
  lab_benches: 'Lab benches',
  fume_cupboard: 'Fume cupboard',
  air_conditioning: 'Air conditioning',
  wheelchair_access: 'Wheelchair access',
};

// ─── The screens' own tabs ───────────────────────────────────────────────────

const TABS = [
  { href: '/timetable/versions', label: 'Timetables' },
  { href: '/timetable/groups', label: 'Teaching groups' },
  { href: '/timetable/rules', label: 'Rules' },
  { href: '/timetable/cover', label: 'Cover' },
] as const;

/** The four timetable screens, one click apart, keeping the chosen year. */
export function TimetableTabs({ year }: { year?: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Timetable" className="mb-6 flex flex-wrap gap-1 border-b border-border print:hidden">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={(year ? `${t.href}?year=${year}` : t.href) as Route}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors',
              active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** A file from an export endpoint, saved under the name the API gives it. */
export async function download(res: Response, fallback: string) {
  if (!res.ok) throw new Error('The file could not be made');
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallback;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** The school's date today (Cairo), as YYYY-MM-DD. */
export function schoolToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
