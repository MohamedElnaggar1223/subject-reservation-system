'use client';

/**
 * Enrolment by student: one student's year — each subject with its teacher
 * and whether it is taught in school or studied alone, changed in place; a
 * subject added in one row; one ended with a reason (kept as history). Their
 * exam registrations that year sit beside it: a registration with no
 * enrolment is enrolled in one click, with the teacher it names.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, gradeLabel } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { ReasonModal } from '~/components/ui/reason-modal';
import { cn } from '~/lib/utils';
import { DateText, type AcademicYearRow } from '../calendar/academic-shared';
import { ENROLMENT_KEY, fetchTeachers, useCatalogue, SELECT_CLASS } from '../../exams/exams-shared';

const fetchStudents = (academicYearId: string, search: string) =>
  apiResponse(api.v1.enrolments.students.$get({ query: { academicYearId, ...(search ? { search } : {}) } }));
const fetchStudentYear = (studentId: string, academicYearId: string) =>
  apiResponse(api.v1.enrolments.student[':studentId'].$get({ param: { studentId }, query: { academicYearId } }));
type StudentYear = Awaited<ReturnType<typeof fetchStudentYear>>;
type EnrolmentRow = StudentYear['enrolments'][number];
type Mode = 'in_school' | 'self_study';

export function ByStudent({ year, studentId, onChoose }: { year: AcademicYearRow; studentId: string | null; onChoose: (id: string) => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <StudentFinder year={year} chosen={studentId} onChoose={onChoose} />
      {studentId ? (
        <StudentYearPanel key={`${studentId}-${year.id}`} studentId={studentId} year={year} />
      ) : (
        <EmptyState title="Choose a student" message="Search by name, email or student ID; the student's subjects this year open here." />
      )}
    </div>
  );
}

function StudentFinder({ year, chosen, onChoose }: { year: AcademicYearRow; chosen: string | null; onChoose: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const term = search.trim();
  const students = useQuery({ queryKey: [...ENROLMENT_KEY, 'students', year.id, term], queryFn: () => fetchStudents(year.id, term) });
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <Label htmlFor="enrol-search" className="mb-1 text-xs text-muted-foreground">Find a student</Label>
      <Input id="enrol-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email or student ID" autoComplete="off" />
      <p className="mt-2 text-xs text-muted-foreground">Students in grades 10 to 12 this year.</p>
      <ul className="mt-2 max-h-[28rem] space-y-1 overflow-y-auto">
        {students.isLoading && <li className="px-2 py-1 text-sm text-muted-foreground">Searching…</li>}
        {students.data?.length === 0 && <li className="px-2 py-1 text-sm text-muted-foreground">No student matches.</li>}
        {students.data?.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onChoose(s.id)}
              aria-current={s.id === chosen ? 'true' : undefined}
              className={cn(
                'w-full rounded-md px-2 py-1.5 text-start text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                s.id === chosen ? 'bg-primary/10 font-semibold text-foreground' : 'text-foreground hover:bg-accent',
              )}
            >
              <bdi>{s.name}</bdi>
              <span className="block text-xs text-muted-foreground">
                {s.gradeThatYear != null && <span>{gradeLabel(s.gradeThatYear)}</span>}
                {s.studentId && <> · <span dir="ltr" className="font-mono">{s.studentId}</span></>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StudentYearPanel({ studentId, year }: { studentId: string; year: AcademicYearRow }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: [...ENROLMENT_KEY, 'student', studentId, year.id], queryFn: () => fetchStudentYear(studentId, year.id) });
  const teachers = useQuery({ queryKey: ['teachers', 'all'], queryFn: fetchTeachers });
  const { data: catalogue } = useCatalogue();
  const [error, setError] = useState('');
  const [ending, setEnding] = useState<EnrolmentRow | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ENROLMENT_KEY });
  const onError = (err: Error) => setError(err.message);

  const update = useMutation({
    mutationFn: (v: { id: string; teacherId?: string | null; mode?: Mode }) =>
      apiResponse(api.v1.enrolments[':id'].$put({ param: { id: v.id }, json: { teacherId: v.teacherId, mode: v.mode } })),
    onSuccess: () => { setError(''); invalidate(); },
    onError,
  });
  const create = useMutation({
    mutationFn: (v: { subjectId: string; teacherId: string | null; mode: Mode }) =>
      apiResponse(api.v1.enrolments.$post({ json: { academicYearId: year.id, studentId, ...v } })),
    onSuccess: () => { setError(''); invalidate(); },
    onError,
  });
  const end = useMutation({
    mutationFn: (v: { id: string; reason: string }) => apiResponse(api.v1.enrolments[':id'].end.$post({ param: { id: v.id }, json: { reason: v.reason } })),
    onSuccess: () => { setEnding(null); setError(''); invalidate(); },
    onError,
  });

  const activeTeachers = useMemo(() => (teachers.data ?? []).filter((t) => t.isActive), [teachers.data]);
  if (q.isLoading) return <LoadingState label="Loading the student's year…" />;
  if (q.isError || !q.data) return <ErrorState title="The student's year did not load" onRetry={() => q.refetch()} />;
  const { student, enrolments, flags } = q.data;
  const open = enrolments.filter((e) => !e.endedOn);
  const ended = enrolments.filter((e) => e.endedOn);
  const taken = new Set(open.map((e) => e.subjectId));
  const addable = (catalogue?.registrable ?? []).filter((r) => r.isActive && !taken.has(r.id));
  const section = open[0]?.section ?? enrolments[0]?.section ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-foreground"><bdi>{student.name}</bdi></h2>
          <p className="text-sm text-muted-foreground">
            {student.grade != null && <span>{gradeLabel(student.grade)}</span>}
            {section && <> · <bdi>{section.name}</bdi></>}
            {student.studentCode && <> · <span dir="ltr" className="font-mono">{student.studentCode}</span></>}
          </p>
        </div>
        <Badge tone={open.length ? 'info' : 'neutral'}><span className="tabular-nums">{open.length}</span>&nbsp;<span>subjects this year</span></Badge>
      </div>
      {student.leftOn && <Notice tone="warning">This student left the school; their enrolments ended with it.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      {flags.registeredNotEnrolled.length > 0 && (
        <Notice tone="warning" title="Registered for exams, not enrolled">
          <ul className="mt-1 space-y-1">
            {flags.registeredNotEnrolled.map((f) => (
              <li key={f.registrationId ?? f.subjectId} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <bdi className="font-semibold">{f.subjectName}</bdi> · <bdi>{f.window}</bdi>
                  {f.takenOutsideSchool ? <> · <span>taken outside school</span></> : f.registrationTeacher ? <> · <bdi>{f.registrationTeacher}</bdi></> : null}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={create.isPending}
                  onClick={() => create.mutate({ subjectId: f.subjectId, teacherId: f.takenOutsideSchool ? null : f.registrationTeacherId, mode: f.takenOutsideSchool ? 'self_study' : 'in_school' })}
                >
                  {f.takenOutsideSchool ? 'Enrol as self-study' : 'Enrol'}
                </Button>
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted text-start text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-semibold">Subject</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">How it is taught</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">Teacher</th>
              <th scope="col" className="px-3 py-2 text-start font-semibold">Since</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {open.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Not enrolled in any subject this year yet — add one below.</td></tr>
            )}
            {open.map((e) => {
              const flagged = flags.teacherDiffers.find((f) => f.enrolmentId === e.id) ?? null;
              const modeFlag = flags.modeDiffers.find((f) => f.enrolmentId === e.id) ?? null;
              const unregistered = flags.enrolledNotRegistered.some((f) => f.enrolmentId === e.id);
              return (
                <tr key={e.id} className="align-top">
                  <td className="px-3 py-2">
                    <bdi className="font-medium text-foreground">{e.subjectName}</bdi>
                    <span className="ms-1 font-mono text-xs text-muted-foreground" dir="ltr">{e.subjectCode}</span>
                    {unregistered && <p className="text-xs text-muted-foreground">No exam registration this year yet.</p>}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`How ${e.subjectName} is taught`}
                      value={e.mode}
                      disabled={update.isPending}
                      onChange={(ev) => update.mutate({ id: e.id, mode: ev.target.value as Mode, teacherId: ev.target.value === 'self_study' ? null : undefined })}
                      className={cn(SELECT_CLASS, 'h-9 w-36')}
                    >
                      <option value="in_school">In school</option>
                      <option value="self_study">Self-study</option>
                    </select>
                    {modeFlag && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        {modeFlag.takenOutsideSchool ? 'The registration says it is taken outside school.' : 'The registration says it is taken in school.'}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {e.mode === 'self_study' ? (
                      <span className="text-muted-foreground">Not taught</span>
                    ) : (
                      <select
                        aria-label={`Teacher for ${e.subjectName}`}
                        value={e.teacherId ?? ''}
                        disabled={update.isPending}
                        onChange={(ev) => update.mutate({ id: e.id, teacherId: ev.target.value || null })}
                        className={cn(SELECT_CLASS, 'h-9 w-52')}
                      >
                        <option value="">No teacher yet</option>
                        {activeTeachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        {e.teacherId && !activeTeachers.some((t) => t.id === e.teacherId) && <option value={e.teacherId}>{e.teacherName}</option>}
                      </select>
                    )}
                    {flagged && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        <span>The registration names</span> <bdi>{flagged.registrationTeacher}</bdi>.{' '}
                        <button type="button" className="font-semibold underline" onClick={() => update.mutate({ id: e.id, teacherId: flagged.registrationTeacherId })}>
                          Use the registration&apos;s teacher
                        </button>
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground"><DateText date={e.startedOn} /></td>
                  <td className="px-3 py-2 text-end">
                    <Button size="sm" variant="ghost" onClick={() => setEnding(e)}>End…</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!student.leftOn && <AddSubject addable={addable} teachers={activeTeachers} pending={create.isPending} onAdd={(v) => create.mutate(v)} />}

      {ended.length > 0 && (
        <details className="rounded-xl border border-border bg-card p-3 text-sm">
          <summary className="cursor-pointer font-semibold text-foreground"><span>Ended this year</span> (<span className="tabular-nums">{ended.length}</span>)</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {ended.map((e) => (
              <li key={e.id}>
                <bdi className="text-foreground">{e.subjectName}</bdi> · <DateText date={e.startedOn} /> – <DateText date={e.endedOn!} /> · <bdi>{e.endReason}</bdi>
              </li>
            ))}
          </ul>
        </details>
      )}

      {ending && (
        <ReasonModal
          title="End this enrolment"
          description={`${student.name} stops being taught ${ending.subjectName}. The enrolment stays on record with your reason.`}
          confirmLabel="End the enrolment"
          destructive
          minLength={3}
          isPending={end.isPending}
          onConfirm={(reason) => end.mutate({ id: ending.id, reason })}
          onClose={() => setEnding(null)}
        />
      )}
    </div>
  );
}

function AddSubject({
  addable, teachers, pending, onAdd,
}: {
  addable: { id: string; name: string; code: string; isOfferedAtSchool: boolean }[];
  teachers: { id: string; name: string }[];
  pending: boolean;
  onAdd: (v: { subjectId: string; teacherId: string | null; mode: Mode }) => void;
}) {
  const [subjectId, setSubjectId] = useState('');
  const [mode, setMode] = useState<Mode>('in_school');
  const [teacherId, setTeacherId] = useState('');
  const chosen = addable.find((s) => s.id === subjectId);
  const effectiveMode: Mode = chosen && !chosen.isOfferedAtSchool ? 'self_study' : mode;
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!subjectId) return;
        onAdd({ subjectId, mode: effectiveMode, teacherId: effectiveMode === 'self_study' ? null : teacherId || null });
        setSubjectId('');
        setTeacherId('');
      }}
    >
      <div>
        <Label htmlFor="add-subject" className="mb-1 text-xs text-muted-foreground">Add a subject</Label>
        <select id="add-subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className={cn(SELECT_CLASS, 'w-72')}>
          <option value="">Choose a subject…</option>
          {addable.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor="add-mode" className="mb-1 text-xs text-muted-foreground">How it is taught</Label>
        <select id="add-mode" value={effectiveMode} disabled={!!chosen && !chosen.isOfferedAtSchool} onChange={(e) => setMode(e.target.value as Mode)} className={cn(SELECT_CLASS, 'w-36')}>
          <option value="in_school">In school</option>
          <option value="self_study">Self-study</option>
        </select>
      </div>
      {effectiveMode === 'in_school' && (
        <div>
          <Label htmlFor="add-teacher" className="mb-1 text-xs text-muted-foreground">Teacher</Label>
          <select id="add-teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className={cn(SELECT_CLASS, 'w-52')}>
            <option value="">No teacher yet</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      <Button type="submit" disabled={!subjectId || pending}>{pending ? 'Enrolling…' : 'Enrol'}</Button>
      {chosen && !chosen.isOfferedAtSchool && <p className="w-full text-xs text-muted-foreground">The school does not teach this subject: it is enrolled as self-study.</p>}
    </form>
  );
}
