'use client';

/**
 * Small pieces the timetable, exam-day and invigilation screens share (all
 * three are this area's): a paper's clock times, minutes, a person's name kept
 * as written, access arrangements as badges, the key of a sitting in the
 * address, and a hook that keeps a screen's choices in the address so a link
 * (or a reload at the desk) lands on the same sitting, register or duty.
 * Every number, time and name is its own text node so the page translator
 * (lib/i18n.tsx) finds the words around it.
 */

import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ACCESS_ARRANGEMENT_LABELS, EXAM_SESSIONS, type AccessArrangement, type ExamSession } from '@repo/validations';
import { Badge } from '~/components/ui/tone';
import { cn } from '~/lib/utils';

/** "08:30" + 75 minutes → "09:45". */
export function endOf(start: string, minutes: number): string {
  const [h, m] = start.split(':').map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** The session a start time falls in, as the board's timetables read it. */
export function sessionOf(start: string): ExamSession {
  const h = Number(start.slice(0, 2));
  return h < 12 ? 'am' : h < 17 ? 'pm' : 'ev';
}

/** Start–end, left to right in either language. */
export function TimeSpan({ start, end, className }: { start: string; end: string; className?: string }): React.JSX.Element {
  return <span dir="ltr" className={cn('whitespace-nowrap tabular-nums', className)}>{start}–{end}</span>;
}

/** "75 min", the number its own node. */
export function Minutes({ n, className }: { n: number; className?: string }): React.JSX.Element {
  return (
    <span className={cn('whitespace-nowrap', className)}>
      <span className="tabular-nums">{n}</span> <span>min</span>
    </span>
  );
}

/** A person's or a room's name: data, never translated. */
export function Name({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <bdi data-i18n-skip="true" className={className}>{children}</bdi>;
}

export function ArrangementBadges({ list, className }: { list: readonly string[]; className?: string }): React.JSX.Element | null {
  if (!list.length) return null;
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {list.map((a) => (
        <Badge key={a} tone="info">{ACCESS_ARRANGEMENT_LABELS[a as AccessArrangement] ?? a}</Badge>
      ))}
    </span>
  );
}

/** A sitting in the address: "2026-11-02.am". */
export const sittingParam = (examDate: string, session: string) => `${examDate}.${session}`;
export function parseSitting(v: string | null): { examDate: string; session: ExamSession } | null {
  if (!v) return null;
  const [examDate, session] = v.split('.');
  if (!examDate || !/^\d{4}-\d{2}-\d{2}$/.test(examDate) || !EXAM_SESSIONS.includes(session as ExamSession)) return null;
  return { examDate, session: session as ExamSession };
}

/** Read and replace the page's own address parameters, keeping the rest. */
export function useAddress() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const q = next.toString();
    router.replace(`${pathname}${q ? `?${q}` : ''}` as Route, { scroll: false });
  };
  return { get: (k: string) => search.get(k), set };
}
