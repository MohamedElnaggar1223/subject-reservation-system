'use client';

/**
 * Enrolment by section: the class list as a grid, like the sheet — students
 * down the side, subjects across the top. A tick is an enrolment (the
 * teacher's initials beside it, "Self" for self-study); an empty cell enrols
 * that student in that subject with the column's teacher in one click;
 * "Enrol all" does the whole column. A tick opens the enrolment to change
 * its teacher or mode, or end it with a reason.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, gradeLabel } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Notice, TONE_CLASSES } from '~/components/ui/tone';
import { ReasonModal } from '~/components/ui/reason-modal';
import { cn } from '~/lib/utils';
import type { AcademicYearRow } from '../calendar/academic-shared';
import { ENROLMENT_KEY, fetchTeachers, useCatalogue, SELECT_CLASS } from '../../exams/exams-shared';

const fetchSections = (academicYearId: string) => apiResponse(api.v1.academic.sections.$get({ query: { academicYearId } }));
const fetchSection = (id: string) => apiResponse(api.v1.academic.sections[':id'].$get({ param: { id } }));
const fetchEnrolments = (academicYearId: string, sectionId: string) =>
  apiResponse(api.v1.enrolments.$get({ query: { academicYearId, sectionId } }));
type EnrolmentRow = Awaited<ReturnType<typeof fetchEnrolments>>[number];
type Mode = 'in_school' | 'self_study';

/** A teacher's short mark in a grid cell: the initials of the first two words ("Hoda Samir" → "HS"), or the first two letters of one. */
function initials(name: string | null) {
  const words = (name ?? '').replace(/\(.*?\)/g, ' ').split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (words.length === 1) return words[0]!.slice(0, 2);
  return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

export function BySection({ year, onOpenStudent }: { year: AcademicYearRow; onOpenStudent: (id: string) => void }) {
  const sections = useQuery({ queryKey: ['academic', 'sections', year.id], queryFn: () => fetchSections(year.id) });
  const [chosen, setChosen] = useState<string>('');
  const sectionId = chosen || sections.data?.[0]?.id || '';
  if (sections.isLoading) return <LoadingState label="Loading the sections…" />;
  if (sections.isError) return <ErrorState title="The sections did not load" onRetry={() => sections.refetch()} />;
  if (!sections.data?.length) {
    return <EmptyState title="No sections this year yet" message="Enrolment by section needs the year's homeroom sections: make them on the Sections page, or use By student and Start of year." />;
  }
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Section">
        {sections.data.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === sectionId}
            onClick={() => setChosen(s.id)}
            className={cn(
              'h-10 rounded-lg border px-3 text-sm font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              s.id === sectionId ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-accent',
            )}
          >
            <bdi data-i18n-skip="true">{s.name}</bdi> <span className="font-normal opacity-80">({s.memberCount})</span>
          </button>
        ))}
      </div>
      {sectionId && <SectionGrid key={sectionId} sectionId={sectionId} year={year} onOpenStudent={onOpenStudent} />}
    </div>
  );
}

type Column = { subjectId: string; teacherId: string; mode: Mode };

function SectionGrid({ sectionId, year, onOpenStudent }: { sectionId: string; year: AcademicYearRow; onOpenStudent: (id: string) => void }) {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ['academic', 'sections', 'detail', sectionId], queryFn: () => fetchSection(sectionId) });
  const enrols = useQuery({ queryKey: [...ENROLMENT_KEY, 'list', year.id, sectionId], queryFn: () => fetchEnrolments(year.id, sectionId) });
  const { data: catalogue } = useCatalogue();
  const teachers = useQuery({ queryKey: ['teachers', 'all'], queryFn: fetchTeachers });
  const [extra, setExtra] = useState<string[]>([]);
  const [settings, setSettings] = useState<Record<string, { teacherId: string; mode: Mode }>>({});
  const [adding, setAdding] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<EnrolmentRow | null>(null);
  const [ending, setEnding] = useState<EnrolmentRow | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ENROLMENT_KEY });

  const subjectName = useMemo(() => new Map((catalogue?.registrable ?? []).map((r) => [r.id, r])), [catalogue]);
  const byCell = useMemo(() => new Map((enrols.data ?? []).map((e) => [`${e.studentId}|${e.subjectId}`, e])), [enrols.data]);
  const columns: Column[] = useMemo(() => {
    const ids = [...new Set([...(enrols.data ?? []).map((e) => e.subjectId), ...extra])];
    return ids
      .map((subjectId) => {
        const inCol = (enrols.data ?? []).filter((e) => e.subjectId === subjectId && e.teacherId);
        const counts = new Map<string, number>();
        for (const e of inCol) counts.set(e.teacherId!, (counts.get(e.teacherId!) ?? 0) + 1);
        const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
        const set = settings[subjectId];
        return { subjectId, teacherId: set?.teacherId ?? common, mode: set?.mode ?? 'in_school' };
      })
      .sort((a, b) => (subjectName.get(a.subjectId)?.name ?? '').localeCompare(subjectName.get(b.subjectId)?.name ?? ''));
  }, [enrols.data, extra, settings, subjectName]);

  const enrolOne = useMutation({
    mutationFn: (v: { studentId: string; col: Column }) => apiResponse(api.v1.enrolments.$post({
      json: { academicYearId: year.id, studentId: v.studentId, subjectId: v.col.subjectId, teacherId: v.col.mode === 'self_study' ? null : v.col.teacherId || null, mode: v.col.mode },
    })),
    onSuccess: () => { setError(''); invalidate(); },
    onError: (err: Error) => setError(err.message),
  });
  const enrolAll = useMutation({
    mutationFn: (col: Column) => apiResponse(api.v1.enrolments.section.$post({
      json: { sectionId, subjects: [{ subjectId: col.subjectId, teacherId: col.mode === 'self_study' ? null : col.teacherId || null, mode: col.mode }], excludeStudentIds: [] },
    })),
    onSuccess: (r) => {
      invalidate();
      setError(r.summary.refused ? r.rows.filter((x) => x.outcome === 'refused').map((x) => `${x.studentName}: ${x.reason}`).join(' · ') : '');
    },
    onError: (err: Error) => setError(err.message),
  });
  const end = useMutation({
    mutationFn: (v: { id: string; reason: string }) => apiResponse(api.v1.enrolments[':id'].end.$post({ param: { id: v.id }, json: { reason: v.reason } })),
    onSuccess: () => { setEnding(null); invalidate(); },
    onError: (err: Error) => setError(err.message),
  });

  if (detail.isLoading || enrols.isLoading) return <LoadingState label="Loading the class list…" />;
  if (detail.isError || enrols.isError || !detail.data) return <ErrorState title="The class list did not load" onRetry={() => { detail.refetch(); enrols.refetch(); }} />;
  const members = detail.data.members;
  const activeSubjects = (catalogue?.registrable ?? []).filter((r) => r.isActive && !columns.some((c) => c.subjectId === r.id));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          <bdi data-i18n-skip="true" className="font-semibold text-foreground">{detail.data.name}</bdi> · <span>{gradeLabel(detail.data.grade)}</span> · <span className="tabular-nums">{members.length}</span> <span>students</span>
        </p>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (adding) { setExtra([...extra, adding]); setAdding(''); } }}>
          <div>
            <Label htmlFor="add-column" className="mb-1 text-xs text-muted-foreground">Add a subject column</Label>
            <select id="add-column" value={adding} onChange={(e) => setAdding(e.target.value)} className={cn(SELECT_CLASS, 'w-72')}>
              <option value="">Choose a subject…</option>
              {activeSubjects.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
            </select>
          </div>
          <Button type="submit" variant="outline" disabled={!adding}>Add</Button>
        </form>
      </div>
      {error && <Notice tone="danger" className="mb-3">{error}</Notice>}
      {members.length > 0 && <FromRegistrations sectionId={sectionId} sectionName={detail.data.name} year={year} onDone={invalidate} />}
      {members.length === 0 ? (
        <EmptyState title="This section has no students yet" message="Add them on the Sections page, then enrol the whole section here." />
      ) : columns.length === 0 ? (
        <EmptyState title="Nobody in this section is enrolled yet" message="Add a subject column above, choose its teacher, then Enrol all — or tick students one by one." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="text-sm">
            <thead className="border-b border-border bg-muted align-bottom">
              <tr>
                <th scope="col" className="sticky start-0 z-10 min-w-52 bg-muted px-3 py-2 text-start font-semibold text-muted-foreground">Student</th>
                {columns.map((c) => {
                  const s = subjectName.get(c.subjectId);
                  const set = (patch: Partial<{ teacherId: string; mode: Mode }>) =>
                    setSettings({ ...settings, [c.subjectId]: { teacherId: c.teacherId, mode: c.mode, ...patch } });
                  const count = members.filter((m) => byCell.has(`${m.student.id}|${c.subjectId}`)).length;
                  return (
                    <th key={c.subjectId} scope="col" className="min-w-44 px-2 py-2 text-start font-semibold text-foreground">
                      <p className="leading-tight"><bdi data-i18n-skip="true">{s?.name ?? c.subjectId}</bdi></p>
                      <p className="text-xs font-normal text-muted-foreground"><span className="tabular-nums">{count}</span>/<span className="tabular-nums">{members.length}</span></p>
                      <select aria-label={`Teacher for ${s?.name ?? ''}`} value={c.mode === 'self_study' ? '' : c.teacherId} disabled={c.mode === 'self_study'} onChange={(e) => set({ teacherId: e.target.value })} className={cn(SELECT_CLASS, 'mt-1 h-8 text-xs font-normal')}>
                        <option value="">No teacher yet</option>
                        {(teachers.data ?? []).filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <select aria-label={`Mode for ${s?.name ?? ''}`} value={c.mode} onChange={(e) => set({ mode: e.target.value as Mode })} className={cn(SELECT_CLASS, 'mt-1 h-8 text-xs font-normal')}>
                        <option value="in_school">In school</option>
                        <option value="self_study">Self-study</option>
                      </select>
                      <Button size="sm" variant="outline" className="mt-1 w-full" disabled={enrolAll.isPending || count === members.length} onClick={() => enrolAll.mutate(c)}>
                        Enrol all
                      </Button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((m) => (
                <tr key={m.id}>
                  <th scope="row" className="sticky start-0 z-10 bg-card px-3 py-1.5 text-start font-medium">
                    <button type="button" className="text-foreground hover:underline" onClick={() => onOpenStudent(m.student.id)}><bdi data-i18n-skip="true">{m.student.name}</bdi></button>
                  </th>
                  {columns.map((c) => {
                    const e = byCell.get(`${m.student.id}|${c.subjectId}`);
                    const subject = subjectName.get(c.subjectId)?.name ?? '';
                    return (
                      <td key={c.subjectId} className="px-2 py-1 text-center">
                        {e ? (
                          <button
                            type="button"
                            onClick={() => setEditing(e)}
                            aria-label={`${m.student.name}: ${subject}${e.teacherName ? ` with ${e.teacherName}` : ''}`}
                            className={cn(
                              'inline-flex h-9 min-w-16 items-center justify-center gap-1 rounded-md border px-2 text-xs font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                              e.mode === 'self_study' ? cn(TONE_CLASSES.warning, 'border-amber-200 dark:border-amber-700') : cn(TONE_CLASSES.success, 'border-emerald-200 dark:border-emerald-800'),
                            )}
                          >
                            <span aria-hidden="true">✓</span>
                            {e.mode === 'self_study' ? <span>Self</span> : <span dir="ltr">{initials(e.teacherName)}</span>}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={enrolOne.isPending}
                            onClick={() => enrolOne.mutate({ studentId: m.student.id, col: c })}
                            aria-label={`Enrol ${m.student.name} in ${subject}`}
                            className="inline-flex h-9 w-16 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          >
                            +
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <EditEnrolment
          e={editing}
          teachers={(teachers.data ?? []).filter((t) => t.isActive)}
          onClose={() => setEditing(null)}
          onEnd={() => { setEnding(editing); setEditing(null); }}
          onSaved={() => { setEditing(null); invalidate(); }}
        />
      )}
      {ending && (
        <ReasonModal
          title="End this enrolment"
          description={`${ending.studentName} stops being taught ${ending.subjectName}. The enrolment stays on record with your reason.`}
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

/**
 * The section's subjects from its students' exam registrations this year, with
 * the teacher each registration names: a preview line, then one click.
 */
function FromRegistrations({ sectionId, sectionName, year, onDone }: { sectionId: string; sectionName: string; year: AcademicYearRow; onDone: () => void }) {
  const run = useMutation({
    mutationFn: (commit: boolean) => apiResponse(api.v1.enrolments.bulk.$post({
      json: { academicYearId: year.id, source: 'registrations', sectionIds: [sectionId], subjectMap: [], exclude: [], commit },
    })),
    onSuccess: (r) => { if (r.committed) onDone(); },
  });
  const r = run.data;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3 text-sm">
      {!r ? (
        <>
          <span className="text-muted-foreground">
            <span>Take</span> <bdi data-i18n-skip="true">{sectionName}</bdi><span>&apos;s subjects from their exam registrations this year, with the teacher each registration names.</span>
          </span>
          <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate(false)}>
            {run.isPending ? 'Working…' : 'See what they give'}
          </Button>
        </>
      ) : r.committed ? (
        <span className="text-foreground">
          <span className="tabular-nums">{r.summary.created}</span> <span>enrolled from their registrations.</span>
          {r.summary.refused > 0 && <> <span className="tabular-nums">{r.summary.refused}</span> <span>refused:</span> {r.rows.filter((x) => x.outcome === 'refused').map((x) => `${x.studentName} · ${x.subjectName}: ${x.reason}`).join('; ')}</>}
        </span>
      ) : r.summary.toCreate === 0 ? (
        <span className="text-muted-foreground">
          {r.rows.length === 0 ? 'No live exam registrations for this section this year.' : 'Every registration of this section already has its enrolment.'}
        </span>
      ) : (
        <>
          <span className="text-foreground">
            <span className="tabular-nums">{r.summary.toCreate}</span> <span>enrolments from their registrations</span>
            {r.summary.existing > 0 && <> · <span className="tabular-nums">{r.summary.existing}</span> <span>already enrolled</span></>}
            {r.summary.refused > 0 && <> · <span className="tabular-nums">{r.summary.refused}</span> <span>refused</span></>}
          </span>
          <Button size="sm" disabled={run.isPending} onClick={() => run.mutate(true)}>
            {run.isPending ? 'Enrolling…' : 'Enrol them'}
          </Button>
        </>
      )}
      {run.error && <span className="text-destructive">{run.error.message}</span>}
    </div>
  );
}

export function EditEnrolment({
  e, teachers, onClose, onEnd, onSaved,
}: {
  e: { id: string; studentName: string; subjectName: string; teacherId: string | null; mode: string };
  teachers: { id: string; name: string }[];
  onClose: () => void;
  onEnd: () => void;
  onSaved: () => void;
}) {
  const [teacherId, setTeacherId] = useState(e.teacherId ?? '');
  const [mode, setMode] = useState<Mode>(e.mode as Mode);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => apiResponse(api.v1.enrolments[':id'].$put({ param: { id: e.id }, json: { mode, teacherId: mode === 'self_study' ? null : teacherId || null } })),
    onSuccess: onSaved,
    onError: (err: Error) => setError(err.message),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-enrolment-title">
      <form className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6 shadow-xl" onSubmit={(ev) => { ev.preventDefault(); save.mutate(); }}>
        <h2 id="edit-enrolment-title" className="font-display text-lg font-bold text-foreground"><bdi data-i18n-skip="true">{e.studentName}</bdi> · <bdi data-i18n-skip="true">{e.subjectName}</bdi></h2>
        <div role="radiogroup" aria-label="How it is taught" className="flex gap-2">
          {(['in_school', 'self_study'] as const).map((m) => (
            <label key={m} className={cn('flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm', mode === m ? 'border-primary bg-primary/5' : 'border-border')}>
              <input type="radio" name="edit-mode" checked={mode === m} onChange={() => setMode(m)} />
              <span>{m === 'in_school' ? 'In school' : 'Self-study'}</span>
            </label>
          ))}
        </div>
        {mode === 'in_school' && (
          <div>
            <Label htmlFor="edit-teacher" className="mb-1 text-xs text-muted-foreground">Teacher</Label>
            <select id="edit-teacher" value={teacherId} onChange={(ev) => setTeacherId(ev.target.value)} className={SELECT_CLASS}>
              <option value="">No teacher yet</option>
              {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
        {mode === 'self_study' && <p className="text-xs text-muted-foreground">Self-study is not taught: it has no teacher and forms no teaching group.</p>}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" className="text-destructive" onClick={onEnd}>
            End it…
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </form>
    </div>
  );
}

