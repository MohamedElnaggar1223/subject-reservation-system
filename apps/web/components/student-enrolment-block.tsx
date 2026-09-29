'use client';

/**
 * The student's subjects this year (F0b course enrolment) on their record:
 * each subject with its teacher, or self-study, and how many of their exam
 * registrations this year have no enrolment. The coordinator and the admin
 * open the Course enrolment screen on this student to change it.
 */

import Link from 'next/link';
import type { Route } from 'next';
import { useQuery } from '@tanstack/react-query';
import { apiResponse } from '@repo/validations';
import { api } from '~/lib/hono';
import { Badge } from '~/components/ui/tone';

const fetchStudentYear = (studentId: string) =>
  apiResponse(api.v1.enrolments.student[':studentId'].$get({ param: { studentId }, query: {} }));

export function StudentEnrolmentBlock({ studentId, canEdit }: { studentId: string; canEdit: boolean }) {
  const q = useQuery({ queryKey: ['enrolments', 'student', studentId, 'current'], queryFn: () => fetchStudentYear(studentId) });
  if (q.isLoading || q.isError || !q.data || !q.data.academicYear) return null;
  const open = q.data.enrolments.filter((e) => !e.endedOn);
  const unenrolled = q.data.flags.registeredNotEnrolled.length;
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subjects this year</h3>
        {canEdit && (
          <Link href={`/academic/enrolment?tab=student&student=${studentId}` as Route} className="text-xs font-medium underline hover:no-underline">
            Change the enrolment
          </Link>
        )}
      </div>
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not enrolled in any subject this year yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {open.map((e) => (
            <li key={e.id} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm">
              <bdi className="font-medium text-foreground">{e.subjectName}</bdi>
              <span className="text-muted-foreground"> · </span>
              {e.mode === 'self_study' ? (
                <span className="text-muted-foreground">Self-study</span>
              ) : e.teacherName ? (
                <bdi className="text-muted-foreground">{e.teacherName}</bdi>
              ) : (
                <span className="text-muted-foreground">No teacher yet</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {unenrolled > 0 && (
        <p className="mt-2">
          <Badge tone="warning">
            <span className="tabular-nums">{unenrolled}</span>&nbsp;
            <span>{unenrolled === 1 ? 'exam registration has no enrolment' : 'exam registrations have no enrolment'}</span>
          </Badge>
        </p>
      )}
    </div>
  );
}
