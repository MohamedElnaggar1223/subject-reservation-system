'use client';

/**
 * On a teacher's Today (FEATURES_PLAN.md F2, "to teachers of affected
 * lessons"): the students leaving during their own lessons today, lesson by
 * lesson, and whether each has left or is back. Nothing shows when nobody
 * leaves.
 */

import { useQuery } from '@tanstack/react-query';
import { Badge } from '~/components/ui/tone';
import { LEAVE_KEY, fetchTeachingLeave, STATUS } from '~/app/(app)/leave/leave-shared';
import type { LeaveStatus } from '@repo/validations';

export function LeaveInMyLessons() {
  const q = useQuery({ queryKey: [...LEAVE_KEY, 'teaching'], queryFn: () => fetchTeachingLeave(), refetchInterval: 60_000, retry: false });
  const lessons = q.data?.lessons ?? [];
  if (lessons.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm" aria-labelledby="leaving-title">
      <h2 id="leaving-title" className="font-display text-lg font-bold text-foreground">Leaving during your lessons</h2>
      <ul className="mt-3 space-y-3">
        {lessons.map((l) => (
          <li key={l.lessonId} className="rounded-xl border border-border p-3">
            <p className="text-sm font-semibold text-foreground"><span>{l.label}</span> · <span dir="ltr">{l.startsAt}–{l.endsAt}</span> · <bdi>{l.subject ?? l.group}</bdi></p>
            <ul className="mt-1 space-y-1 text-sm">
              {l.students.map((s) => (
                <li key={s.leaveId} className="flex flex-wrap items-center gap-2">
                  <bdi className="font-medium text-foreground">{s.name}</bdi>
                  <span className="text-muted-foreground"><span>leaves at</span> <span dir="ltr">{s.leaveTime}</span>{s.returnTime && <> · <span>back by</span> <span dir="ltr">{s.returnTime}</span></>}</span>
                  <Badge tone={STATUS[s.status as LeaveStatus]?.tone ?? 'neutral'}>{STATUS[s.status as LeaveStatus]?.label ?? s.status}</Badge>
                  {s.leftAt && <span className="text-xs text-muted-foreground"><span>left</span> <span dir="ltr">{s.leftAt}</span></span>}
                  {s.backAt && <span className="text-xs text-muted-foreground"><span>back</span> <span dir="ltr">{s.backAt}</span></span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
