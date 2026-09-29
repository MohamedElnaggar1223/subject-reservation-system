'use client';

/**
 * Check: the year's exam registrations against its enrolments. Each
 * disagreement is listed with the one-click fix beside it — flagged, never
 * blocked (a student may register for a subject they study alone, and
 * June's window opens long after teaching starts).
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { ReasonModal } from '~/components/ui/reason-modal';
import type { AcademicYearRow } from '../calendar/academic-shared';
import { ENROLMENT_KEY } from '../../exams/exams-shared';

const fetchCheck = (academicYearId: string) => apiResponse(api.v1.enrolments.check.$get({ query: { academicYearId } }));
type Flags = Awaited<ReturnType<typeof fetchCheck>>;
type FlagRow = Flags['registeredNotEnrolled'][number];

export function Check({ year, onOpenStudent }: { year: AcademicYearRow; onOpenStudent: (id: string) => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: [...ENROLMENT_KEY, 'check', year.id], queryFn: () => fetchCheck(year.id) });
  const [error, setError] = useState('');
  const [ending, setEnding] = useState<FlagRow | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ENROLMENT_KEY });
  const onError = (err: Error) => setError(err.message);

  const enrol = useMutation({
    mutationFn: (rows: FlagRow[]) => apiResponse(api.v1.enrolments.batch.$post({
      json: {
        academicYearId: year.id,
        commit: true,
        rows: rows.map((f) => ({
          student: f.studentId,
          subject: f.subjectId,
          teacher: f.takenOutsideSchool ? null : f.registrationTeacherId,
          mode: f.takenOutsideSchool ? ('self_study' as const) : ('in_school' as const),
          ref: f.registrationId ? `registration:${f.registrationId}` : undefined,
        })),
      },
    })),
    onSuccess: (r) => {
      invalidate();
      const refused = r.rows.filter((x) => x.outcome === 'refused');
      setError(refused.length ? refused.map((x) => `${x.studentName} · ${x.subjectName}: ${x.reason}`).join(' · ') : '');
    },
    onError,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; teacherId?: string | null; mode?: 'in_school' | 'self_study' }) =>
      apiResponse(api.v1.enrolments[':id'].$put({ param: { id: v.id }, json: { teacherId: v.teacherId, mode: v.mode } })),
    onSuccess: () => { setError(''); invalidate(); },
    onError,
  });
  const end = useMutation({
    mutationFn: (v: { id: string; reason: string }) => apiResponse(api.v1.enrolments[':id'].end.$post({ param: { id: v.id }, json: { reason: v.reason } })),
    onSuccess: () => { setEnding(null); setError(''); invalidate(); },
    onError,
  });

  if (q.isLoading) return <LoadingState label="Checking the registrations against the enrolments…" />;
  if (q.isError || !q.data) return <ErrorState title="The check did not load" onRetry={() => q.refetch()} />;
  const f = q.data;
  const total = f.registeredNotEnrolled.length + f.enrolledNotRegistered.length + f.modeDiffers.length + f.teacherDiffers.length;
  const pending = enrol.isPending || update.isPending;

  return (
    <div className="space-y-6">
      {total === 0 ? (
        <Notice tone="success" title="Registrations and enrolments agree">
          <span>Every live exam registration of</span> <bdi>{year.shortLabel}</bdi> <span>has an enrolment in its subject, with the same teacher and mode.</span>
        </Notice>
      ) : (
        <p className="text-sm text-muted-foreground">
          <span>The year&apos;s live exam registrations against its enrolments. Nothing here blocks a registration or a payment; each line has its fix beside it.</span>
        </p>
      )}
      {error && <Notice tone="danger">{error}</Notice>}

      <FlagSection
        title="Registered for an exam, not enrolled"
        hint="A live registration this year with no enrolment in that subject. Enrol it with the teacher the registration names, or as self-study where it is taken outside school."
        rows={f.registeredNotEnrolled}
        tone="warning"
        bulk={f.registeredNotEnrolled.length > 1 ? (
          <Button size="sm" disabled={pending} onClick={() => enrol.mutate(f.registeredNotEnrolled)}>
            <span>Enrol all</span> <span className="tabular-nums">{f.registeredNotEnrolled.length}</span>
          </Button>
        ) : null}
        onOpenStudent={onOpenStudent}
        detail={(r) => (
          <>
            <bdi>{r.window}</bdi>
            {r.takenOutsideSchool ? <> · <span>taken outside school</span></> : r.registrationTeacher ? <> · <bdi data-i18n-skip="true">{r.registrationTeacher}</bdi></> : <> · <span>no teacher named</span></>}
          </>
        )}
        fix={(r) => (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => enrol.mutate([r])}>
            {r.takenOutsideSchool ? 'Enrol as self-study' : 'Enrol'}
          </Button>
        )}
      />

      <FlagSection
        title="Mode differs"
        hint="The enrolment says taught in school and the registration says taken outside school, or the other way round."
        rows={f.modeDiffers}
        tone="warning"
        onOpenStudent={onOpenStudent}
        detail={(r) => (
          <>
            <span>Enrolled</span> <span>{r.mode === 'self_study' ? 'self-study' : 'in school'}</span> · <span>registered</span>{' '}
            <span>{r.takenOutsideSchool ? 'outside school' : 'in school'}</span> (<bdi>{r.window}</bdi>)
          </>
        )}
        fix={(r) => (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !r.enrolmentId}
            onClick={() => update.mutate(r.takenOutsideSchool
              ? { id: r.enrolmentId!, mode: 'self_study', teacherId: null }
              : { id: r.enrolmentId!, mode: 'in_school', teacherId: r.registrationTeacherId })}
          >
            {r.takenOutsideSchool ? 'Make it self-study' : 'Make it in school'}
          </Button>
        )}
      />

      <FlagSection
        title="Teacher differs"
        hint="The registration names a different teacher from the enrolment. The enrolment's teacher is the one who gives the forecast grade."
        rows={f.teacherDiffers}
        tone="info"
        onOpenStudent={onOpenStudent}
        detail={(r) => (
          <>
            <span>Enrolled with</span> <bdi data-i18n-skip="true">{r.teacherName}</bdi> · <span>registration names</span> <bdi data-i18n-skip="true">{r.registrationTeacher}</bdi>
          </>
        )}
        fix={(r) => (
          <Button size="sm" variant="outline" disabled={pending || !r.enrolmentId} onClick={() => update.mutate({ id: r.enrolmentId!, teacherId: r.registrationTeacherId })}>
            Use the registration&apos;s teacher
          </Button>
        )}
      />

      <FlagSection
        title="Enrolled, not registered for an exam"
        hint="Taught this year with no live registration in any window of the year yet. Expected before June's window opens; after it closes, check whether the student still takes the subject."
        rows={f.enrolledNotRegistered}
        tone="neutral"
        onOpenStudent={onOpenStudent}
        detail={(r) => (r.mode === 'self_study' ? <span>Self-study</span> : r.teacherName ? <bdi data-i18n-skip="true">{r.teacherName}</bdi> : <span>No teacher yet</span>)}
        fix={(r) => (
          <Button size="sm" variant="ghost" disabled={pending || !r.enrolmentId} onClick={() => setEnding(r)}>End…</Button>
        )}
      />

      {ending && (
        <ReasonModal
          title="End this enrolment"
          description={`${ending.studentName} stops being taught ${ending.subjectName}. The enrolment stays on record with your reason.`}
          confirmLabel="End the enrolment"
          destructive
          minLength={3}
          isPending={end.isPending}
          onConfirm={(reason) => end.mutate({ id: ending.enrolmentId!, reason })}
          onClose={() => setEnding(null)}
        />
      )}
    </div>
  );
}

function FlagSection({
  title, hint, rows, tone, bulk, detail, fix, onOpenStudent,
}: {
  title: string;
  hint: string;
  rows: FlagRow[];
  tone: 'warning' | 'info' | 'neutral';
  bulk?: React.ReactNode;
  detail: (r: FlagRow) => React.ReactNode;
  fix: (r: FlagRow) => React.ReactNode;
  onOpenStudent: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  if (!rows.length) return null;
  return (
    <section className="rounded-xl border border-border bg-card shadow-sm" aria-label={title}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-start hover:underline">{title}</button>
            <Badge tone={tone}><span className="tabular-nums">{rows.length}</span></Badge>
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
        </div>
        {bulk}
      </header>
      {open && (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={`${r.studentId}|${r.subjectId}|${r.registrationId ?? ''}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <button type="button" className="font-semibold text-foreground hover:underline" onClick={() => onOpenStudent(r.studentId)}><bdi data-i18n-skip="true">{r.studentName}</bdi></button>
                {r.section && <span className="text-muted-foreground"> · <bdi data-i18n-skip="true">{r.section}</bdi></span>}
                <span className="text-muted-foreground"> · </span><bdi data-i18n-skip="true" className="text-foreground">{r.subjectName}</bdi>
                <p className="text-xs text-muted-foreground">{detail(r)}</p>
              </div>
              {fix(r)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
