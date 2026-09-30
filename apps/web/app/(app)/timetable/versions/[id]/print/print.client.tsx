'use client';

/**
 * Printing a timetable (FEATURES_PLAN.md F1, "print layouts"): every section,
 * teacher or room of the timetable on its own page — what the school pins on
 * each classroom door and hands each teacher. Choose which, then print; the
 * navigation is left off the paper.
 */

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { WEEKDAY_NAMES } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { cn } from '~/lib/utils';
import { TT_KEY, fetchTimetable, type Editor, type EditorLesson } from '../../../timetable-shared';

type Kind = 'section' | 'teacher' | 'room';
const KINDS: { key: Kind; label: string }[] = [
  { key: 'section', label: 'Every section' },
  { key: 'teacher', label: 'Every teacher' },
  { key: 'room', label: 'Every room' },
];

export default function PrintClient({ id }: { id: string }): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const kind = (params.get('view') as Kind | null) ?? 'section';
  const { data: tt, isLoading, isError, refetch } = useQuery({ queryKey: [...TT_KEY, 'editor', id], queryFn: () => fetchTimetable(id) });
  if (isLoading) return <LoadingState label="Loading the timetable…" />;
  if (isError || !tt) return <ErrorState onRetry={() => refetch()} />;

  const pages = pagesOf(tt, kind);
  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/timetable/versions/${id}` as Route} className="text-sm text-muted-foreground hover:text-foreground">← Back to the grid</Link>
        <div role="tablist" aria-label="What to print" className="flex rounded-lg border border-border bg-card p-1">
          {KINDS.map((k) => (
            <button key={k.key} role="tab" type="button" aria-selected={kind === k.key} onClick={() => router.replace(`${pathname}?view=${k.key}` as Route)}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium', kind === k.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')}>
              {k.label}
            </button>
          ))}
        </div>
        <Button onClick={() => window.print()}>Print</Button>
        <span className="text-sm text-muted-foreground">{`${pages.length} pages`}</span>
      </div>
      {pages.map((p, i) => (
        <section key={p.id} className={cn('print-block mb-8', i < pages.length - 1 && 'break-after-page')} aria-label={p.title}>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-display text-xl font-bold text-foreground"><bdi>{p.title}</bdi></h2>
            <p className="text-sm text-muted-foreground"><bdi>{tt.timetable.name}</bdi> · <bdi>{tt.term.name}</bdi>{tt.timetable.effectiveFrom && <> · <span>from</span> <span>{tt.timetable.effectiveFrom}</span></>}</p>
          </div>
          <PrintGrid tt={tt} lessons={p.lessons} kind={kind} />
        </section>
      ))}
    </div>
  );
}

function pagesOf(tt: Editor, kind: Kind): { id: string; title: string; lessons: EditorLesson[] }[] {
  const placed = tt.engine.lessons.filter((l) => l.weekday !== null);
  const groupOf = (l: EditorLesson) => tt.groups.find((g) => g.id === l.groupId)!;
  if (kind === 'teacher') {
    return tt.teachers.map((t) => ({ id: t.id, title: t.name, lessons: placed.filter((l) => groupOf(l).teacherId === t.id) })).filter((p) => p.lessons.length);
  }
  if (kind === 'room') {
    return tt.engine.rooms.filter((r) => placed.some((l) => l.roomId === r.id)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((r) => ({ id: r.id, title: r.name, lessons: placed.filter((l) => l.roomId === r.id) }));
  }
  const sections = new Map<string, string>();
  for (const g of tt.groups) {
    for (const s of g.sections) sections.set(s.id, s.name);
    if (g.sectionId && g.sectionName) sections.set(g.sectionId, g.sectionName);
  }
  return [...sections.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true })).map(([sid, name]) => ({
    id: sid,
    title: name,
    lessons: placed.filter((l) => { const g = groupOf(l); return g.sectionId === sid || g.sections.some((s) => s.id === sid); }),
  }));
}

function PrintGrid({ tt, lessons, kind }: { tt: Editor; lessons: EditorLesson[]; kind: Kind }) {
  const days = tt.engine.days;
  const maxP = Math.max(0, ...days.map((d) => d.periods.length));
  const first = days[0];
  const roomName = (id: string | null) => (id ? tt.engine.rooms.find((r) => r.id === id)?.name ?? '' : '');
  return (
    <table className="w-full table-fixed border-collapse border border-border text-xs">
      <thead>
        <tr>
          <th className="w-20 border border-border px-1 py-1 text-start">Period</th>
          {days.map((d) => <th key={d.weekday} className="border border-border px-1 py-1 text-start">{WEEKDAY_NAMES[d.weekday]}</th>)}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: maxP }, (_, i) => i + 1).map((p) => {
          const label = first?.periods.find((x) => x.period === p);
          return (
            <tr key={p}>
              <th className="border border-border px-1 py-1 text-start align-top">
                <span className="block font-semibold">{label?.label ?? `P${p}`}</span>
                {label && <span className="block text-[10px] text-muted-foreground" dir="ltr">{label.startsAt}–{label.endsAt}</span>}
              </th>
              {days.map((d) => {
                const here = lessons.filter((l) => l.weekday === d.weekday && l.period! <= p && p <= l.period! + l.length - 1);
                return (
                  <td key={d.weekday} className="h-12 border border-border px-1 py-0.5 align-top">
                    {here.map((l) => {
                      const g = tt.groups.find((x) => x.id === l.groupId)!;
                      return (
                        <div key={l.id} className="mb-0.5 leading-tight">
                          <span className="block font-semibold"><bdi>{g.name}</bdi></span>
                          <span className="block text-muted-foreground">
                            {kind !== 'teacher' && g.teacherName && <bdi>{g.teacherName}</bdi>}
                            {kind !== 'room' && l.roomId && <>{kind !== 'teacher' && g.teacherName ? ' · ' : ''}<bdi>{roomName(l.roomId)}</bdi></>}
                          </span>
                        </div>
                      );
                    })}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
