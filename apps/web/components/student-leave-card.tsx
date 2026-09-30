'use client';

/**
 * Campus leave in the Student 360 (FEATURES_PLAN.md F0a "the desk sees leave
 * in the Student 360"; F2): what is coming up for this student, this term's
 * count, whether a custody note is on file, and a request for the family
 * made here, without leaving the desk.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useQuery } from '@tanstack/react-query';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/tone';
import { LEAVE_KEY, fetchStudentLeave, StatusBadge, TimesText, CollectorText } from '~/app/(app)/leave/leave-shared';
import { StaffRequest } from '~/app/(app)/leave/manage/manage.client';
import { DateText } from '~/app/(app)/academic/calendar/academic-shared';

export function StudentLeaveCard({ studentId, viewerRole }: { studentId: string; viewerRole: string }) {
  const rec = useQuery({ queryKey: [...LEAVE_KEY, 'student', studentId], queryFn: () => fetchStudentLeave(studentId) });
  const [requesting, setRequesting] = useState(false);
  const academic = viewerRole === 'coordinator' || viewerRole === 'admin';
  const r = rec.data;
  const coming = r ? r.leaves.filter((l) => l.date >= r.today && ['pending', 'approved', 'checked_out'].includes(l.status)).slice(0, 4) : [];
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby={`leave-${studentId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`leave-${studentId}`} className="font-display text-base font-bold text-foreground">Campus leave</h3>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setRequesting((v) => !v)}>{requesting ? 'Close' : 'Request leave'}</Button>
          <Button size="sm" variant="outline" asChild><Link href={`/leave/students/${studentId}` as Route}>Leave record</Link></Button>
        </div>
      </div>
      {rec.isLoading ? <p className="mt-2 text-sm text-muted-foreground">Loading…</p> : rec.isError || !r ? <p className="mt-2 text-sm text-destructive">Campus leave did not load.</p> : (
        <>
          <p className="mt-2 flex flex-wrap gap-2 text-sm">
            <Badge tone="neutral">{r.summary.term ? `${r.summary.term.name}: ${r.summary.thisTerm}` : `So far: ${r.summary.thisTerm}`}</Badge>
            {r.summary.noShows > 0 && <Badge tone="danger">{`${r.summary.noShows} not collected`}</Badge>}
            {r.custodyOnFile > 0 && <Badge tone="danger">Custody note on file — the gate checks it</Badge>}
            <Badge tone="neutral">{`${r.collectors.filter((c) => c.status === 'approved').length} approved collectors`}</Badge>
          </p>
          {coming.length > 0 && (
            <ul className="mt-3 divide-y divide-border text-sm">
              {coming.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><DateText date={l.date} weekday /> · <TimesText leaveTime={l.leaveTime} returning={l.returning} returnTime={l.returnTime} /> · <span>{l.reason.label}</span> · <CollectorText c={l.collector} /></span>
                  <StatusBadge status={l.status} />
                </li>
              ))}
            </ul>
          )}
          {requesting && <div className="mt-4 border-t border-border pt-4"><StaffRequest studentId={studentId} academic={academic} /></div>}
        </>
      )}
    </section>
  );
}
