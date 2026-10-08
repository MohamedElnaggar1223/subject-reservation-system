'use client';

/**
 * Teaching groups (FEATURES_PLAN.md F1).
 *
 * The spreadsheet version: a "classes" tab per teacher, copied from the
 * enrolment lists by hand each September — self-study students crossed out,
 * a big class split into two by colour, a student who drops Physics left on
 * the list until someone notices — and the periods per week written in a
 * margin nobody updates.
 *
 * Here: one click forms the year's groups from the course enrolment (a group
 * per subject — or per unit, for an IAL paper taught on its own — and teacher,
 * taught in school or online as the session's offer says; a provider's group
 * has no lessons; self-study forms none) after a preview of who goes where;
 * running it again only adds the students not yet grouped and takes out those
 * no longer taught in school. A line's teacher changed at the desk moves the
 * student's group itself; who could not be moved (no group of the new teacher
 * yet, or a clash in the published timetable) and who has no teacher yet
 * ("no preference") wait in "To place", one click each. Subjects a whole section takes
 * together (a national subject, PE) are one group per section in one form.
 * Periods per week, doubles and the room a group needs are edited in the row
 * (Enter saves); a group opens to its students, where some can be moved to a
 * new group (a split), others taken out with a reason, or other groups merged
 * in. Every change keeps history, and draft timetables follow at once.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PublishedClashNotice, isPublishedClash, clashMessage, goAheadWith } from '~/components/published-clash';
import { api } from '~/lib/hono';
import { apiResponse, ROOM_TYPES, ROOM_FEATURES } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { ReasonModal } from '~/components/ui/reason-modal';
import { cn } from '~/lib/utils';
import { NoYearYet, SELECT_CLASS, YearPicker, useAcademicYears, useChosenYear, type AcademicYearRow } from '../../academic/calendar/academic-shared';
import { TT_KEY, TimetableTabs, fetchGroups, fetchGroup, fetchTeachers, schoolToday, ROOM_TYPE_LABEL, FEATURE_LABEL, type GroupRow } from '../timetable-shared';

const fetchCatalogue = () => apiResponse(api.v1.catalogue.$get());
const fetchSections = (academicYearId: string) => apiResponse(api.v1.academic.sections.$get({ query: { academicYearId } }));
const fetchRooms = () => apiResponse(api.v1.academic.rooms.$get());
const fetchWaiting = (academicYearId: string) => apiResponse(api.v1.scheduling.groups.waiting.$get({ query: { academicYearId } }));
type GoAhead = { anyway: true; clashToken: string | null };

/** How a group is taught: in school, online (no room), or by a provider outside the timetable. */
function DeliveryBadge({ g }: { g: { delivery: string; providerTaught?: boolean } }) {
  if (g.providerTaught) return <Badge tone="neutral">Provider: no lessons</Badge>;
  if (g.delivery === 'online') return <Badge tone="info">Online</Badge>;
  return null;
}

const KIND: Record<string, { label: string; tone: 'info' | 'neutral' | 'success' }> = {
  enrolment: { label: 'From enrolment', tone: 'info' },
  section: { label: 'Whole section', tone: 'success' },
  manual: { label: 'By hand', tone: 'neutral' },
};

export default function GroupsClient(): React.JSX.Element {
  const { data: years, isLoading, isError, refetch } = useAcademicYears();
  const { year, choose } = useChosenYear(years);
  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-up">
      <TimetableTabs year={year?.startYear} />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Teaching groups</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Who is taught together, by whom, and for how many periods a week. Formed from the course enrolment (self-study forms no group) and from sections; students in two groups of one subject never happen.
          </p>
        </div>
        {years && year && <YearPicker years={years} year={year} onChoose={choose} />}
      </header>
      {isLoading ? <LoadingState label="Loading…" /> : isError ? <ErrorState onRetry={() => refetch()} /> : !year ? (
        <NoYearYet what="Teaching groups belong to an academic year." />
      ) : (
        <YearGroups year={year} />
      )}
    </div>
  );
}

function YearGroups({ year }: { year: AcademicYearRow }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: [...TT_KEY, 'groups', year.id], queryFn: () => fetchGroups(year.id) });
  const teachers = useQuery({ queryKey: ['teachers', 'active'], queryFn: fetchTeachers });
  const rooms = useQuery({ queryKey: ['academic', 'rooms'], queryFn: fetchRooms });
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: TT_KEY });
  if (isLoading) return <LoadingState label="Loading the groups…" />;
  if (isError || !data) return <ErrorState title="The groups did not load" onRetry={() => refetch()} />;
  const q = search.trim().toLowerCase();
  const shown = data.groups.filter((g) => (showRetired || !g.archived) && (!q || g.name.toLowerCase().includes(q) || (g.teacher?.name ?? '').toLowerCase().includes(q) || (g.subject?.name ?? '').toLowerCase().includes(q)));
  const live = data.groups.filter((g) => !g.archived);
  const periods = live.reduce((n, g) => n + g.weeklyPeriods, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <FormFromEnrolment year={year} onDone={refresh} />
        <SectionGroups year={year} teachers={teachers.data ?? []} onDone={refresh} />
      </div>

      <ToPlace year={year} onDone={refresh} />

      <section aria-labelledby="groups-title" className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="groups-title" className="font-display text-lg font-bold text-foreground">The year's groups</h2>
            <p className="text-sm text-muted-foreground">
              <bdi className="tabular-nums">{live.length}</bdi> <span>groups</span> · <bdi className="tabular-nums">{periods}</bdi> <span>periods a week</span>
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="group-search" className="mb-1 text-xs text-muted-foreground">Search</Label>
              <Input id="group-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Group, subject or teacher" className="w-64" />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
              <span>Show retired groups</span>
            </label>
            <NewGroup year={year} teachers={teachers.data ?? []} onDone={refresh} />
          </div>
        </div>
        {shown.length === 0 ? (
          <div className="p-6">
            <EmptyState title={data.groups.length ? 'No group matches' : 'No teaching groups yet'} message={data.groups.length ? undefined : 'Form them from the course enrolment above, or add a group by hand.'} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-5 py-2 text-start font-medium">Group</th>
                  <th className="px-3 py-2 text-start font-medium">Teacher</th>
                  <th className="px-3 py-2 text-end font-medium">Students</th>
                  <th className="px-3 py-2 text-start font-medium">Periods a week</th>
                  <th className="px-3 py-2 text-start font-medium">Of them doubles</th>
                  <th className="px-3 py-2 text-start font-medium">Room</th>
                  <th className="px-5 py-2"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => (
                  <GroupRowView key={g.id} g={g} teachers={teachers.data ?? []} rooms={rooms.data ?? []} open={open === g.id} onToggle={() => setOpen(open === g.id ? null : g.id)} onDone={refresh} all={live} year={year} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

type Teacher = Awaited<ReturnType<typeof fetchTeachers>>[number];
type Room = Awaited<ReturnType<typeof fetchRooms>>[number];

// ─── Forming from the enrolment ──────────────────────────────────────────────

function FormFromEnrolment({ year, onDone }: { year: AcademicYearRow; onDone: () => void }) {
  const [weekly, setWeekly] = useState('4');
  const preview = useMutation({ mutationFn: async () => apiResponse(api.v1.scheduling.groups.form.$post({ json: { academicYearId: year.id, commit: false, weeklyPeriods: Number(weekly) || 4 } })) });
  const commit = useMutation({
    mutationFn: async (vars: Partial<GoAhead> = {}) => apiResponse(api.v1.scheduling.groups.form.$post({ json: { academicYearId: year.id, commit: true, weeklyPeriods: Number(weekly) || 4, ...(vars.anyway ? { anyway: true, clashToken: vars.clashToken ?? null } : {}) } })),
    onSuccess: () => { preview.reset(); onDone(); },
  });
  const [moveClash, setMoveClash] = useState<{ message: string; retry: () => void } | null>(null);
  const move = useMutation({
    mutationFn: async (v: { groupId: string; studentId: string } & Partial<GoAhead>) => apiResponse(api.v1.scheduling.groups[':id'].members.$post({
      param: { id: v.groupId }, json: { studentIds: [v.studentId], ...(v.anyway ? { anyway: true, clashToken: v.clashToken ?? null } : {}) },
    })),
    onSuccess: () => { setMoveClash(null); preview.mutate(); onDone(); },
    onError: (e, v) => { if (isPublishedClash(e)) setMoveClash({ message: clashMessage(e), retry: () => move.mutate({ ...v, ...goAheadWith(e) }) }); },
  });
  const plan = preview.data;
  const changes = plan?.groups.filter((g) => g.action !== 'unchanged') ?? [];
  return (
    <section aria-labelledby="form-title" className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h2 id="form-title" className="font-display text-base font-bold text-foreground">From the course enrolment</h2>
      <p className="mt-1 text-sm text-muted-foreground">A group for each subject (or unit) and teacher, with the students taught it in school. Nothing is written until you confirm; running it again adds only who is new.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="form-weekly" className="mb-1 text-xs text-muted-foreground">Periods a week for new groups</Label>
          <Input id="form-weekly" type="number" min={0} max={30} value={weekly} onChange={(e) => setWeekly(e.target.value)} className="w-28" />
        </div>
        <Button variant="outline" onClick={() => preview.mutate()} disabled={preview.isPending}>{preview.isPending ? 'Reading the enrolment…' : 'Preview'}</Button>
      </div>
      {preview.isError && <Notice tone="danger" className="mt-3">{preview.error instanceof Error ? preview.error.message : 'The preview failed'}</Notice>}
      {commit.data && (
        <Notice tone="success" className="mt-3">
          <span>Groups made:</span> <bdi>{commit.data.created}</bdi> · <span>students added:</span> <bdi>{commit.data.added}</bdi> · <span>taken out:</span> <bdi>{commit.data.removed}</bdi>
        </Notice>
      )}
      {plan && (
        <div className="mt-4 space-y-3">
          {changes.length === 0 ? (
            <Notice tone="success">Everyone taught in school is already in a group of their subject.</Notice>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {changes.map((g) => (
                <li key={`${g.subject.id}:${g.unit?.id ?? ''}:${g.teacher?.id ?? ''}:${g.name}`} className="rounded-lg border border-border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground"><bdi>{g.name}</bdi></span>
                    {g.action === 'create' ? <Badge tone="info">New group</Badge> : <Badge tone="neutral">Existing</Badge>}
                    <DeliveryBadge g={g} />
                    {g.adding.length > 0 && <Badge tone="success">{`+${g.adding.length}`}</Badge>}
                    {g.removing.length > 0 && <Badge tone="danger">{`−${g.removing.length}`}</Badge>}
                    <span className="ms-auto text-xs text-muted-foreground"><bdi className="tabular-nums">{g.total}</bdi> <span>students</span></span>
                  </div>
                  {g.adding.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground"><span>Joining:</span> <bdi>{g.adding.map((a) => a.name + (a.section ? ` (${a.section})` : '')).join(', ')}</bdi></p>
                  )}
                  {g.removing.length > 0 && (
                    <p className="mt-1 text-xs text-destructive"><span>Leaving (no longer taught this in school):</span> <bdi>{g.removing.map((r) => r.name).join(', ')}</bdi></p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {plan.teacherDiffers.length > 0 && (
            <Notice tone="warning" title="Enrolled with another teacher than their group's">
              <ul className="mt-1 space-y-1">
                {plan.teacherDiffers.map((d) => (
                  <li key={`${d.studentId}:${d.subject}`} className="flex flex-wrap items-center gap-2">
                    <bdi>{`${d.name}: ${d.subject}, in ${d.group}, enrolled with ${d.enrolledWith ?? 'no teacher'}`}</bdi>
                    {d.target
                      ? <Button size="sm" variant="outline" disabled={move.isPending} onClick={() => move.mutate({ groupId: d.target!.id, studentId: d.studentId })}><span>Move to</span> <bdi>{d.target.name}</bdi></Button>
                      : <span className="text-xs text-muted-foreground">No group of that teacher yet: make one by hand, then move them.</span>}
                  </li>
                ))}
              </ul>
              {moveClash && <PublishedClashNotice className="mt-2" message={moveClash.message} pending={move.isPending} onAnyway={moveClash.retry} onCancel={() => setMoveClash(null)} />}
              {move.isError && !isPublishedClash(move.error) && <p className="mt-1 text-sm text-destructive">{move.error instanceof Error ? move.error.message : 'Not moved'}</p>}
            </Notice>
          )}
          {changes.length > 0 && (
            <div className="flex gap-2">
              <Button onClick={() => commit.mutate({})} disabled={commit.isPending}>{commit.isPending ? 'Forming…' : 'Form the groups'}</Button>
              <Button variant="outline" onClick={() => preview.reset()}>Cancel</Button>
            </div>
          )}
          {commit.isError && (isPublishedClash(commit.error)
            ? <PublishedClashNotice message={clashMessage(commit.error)} pending={commit.isPending} onAnyway={() => commit.mutate(goAheadWith(commit.error))} onCancel={() => commit.reset()} />
            : <Notice tone="danger">{commit.error instanceof Error ? commit.error.message : 'The groups were not formed'}</Notice>)}
        </div>
      )}
    </section>
  );
}

// ─── To place: the follow-up's list, and "no preference" ─────────────────────

/**
 * What the enrolment changed that a group could not follow by itself (a line's teacher changed at
 * the desk with no group of the new teacher yet, or a move that would clash in the published
 * timetable) and the students with no teacher yet ("no preference" on their reservation): each with
 * its one action. The spreadsheet version: a list on the coordinator's desk.
 */
function ToPlace({ year, onDone }: { year: AcademicYearRow; onDone: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: [...TT_KEY, 'waiting', year.id], queryFn: () => fetchWaiting(year.id) });
  const [clash, setClash] = useState<{ message: string; retry: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = schoolToday();
  const from = today < year.startsOn ? year.startsOn : today > year.endsOn ? year.startsOn : today;
  const done = () => { setClash(null); setError(null); qc.invalidateQueries({ queryKey: TT_KEY }); onDone(); };
  const fail = (e: unknown, retry: (go: GoAhead) => void) => {
    if (isPublishedClash(e)) setClash({ message: clashMessage(e), retry: () => retry(goAheadWith(e)) });
    else setError(e instanceof Error ? e.message : 'That did not work');
  };
  const move = useMutation({
    mutationFn: async (v: { groupId: string; studentId: string } & Partial<GoAhead>) => apiResponse(api.v1.scheduling.groups[':id'].members.$post({
      param: { id: v.groupId }, json: { studentIds: [v.studentId], ...(v.anyway ? { anyway: true, clashToken: v.clashToken ?? null } : {}) },
    })),
    onSuccess: done, onError: (e, v) => fail(e, (go) => move.mutate({ ...v, ...go })),
  });
  const give = useMutation({
    mutationFn: async (v: { groupId: string; teacherId: string } & Partial<GoAhead>) => apiResponse(api.v1.scheduling.groups[':id'].$put({
      param: { id: v.groupId }, json: { teacherId: v.teacherId, teacherFrom: from, ...(v.anyway ? { anyway: true, clashToken: v.clashToken ?? null } : {}) },
    })),
    onSuccess: done, onError: (e, v) => fail(e, (go) => give.mutate({ ...v, ...go })),
  });
  if (q.isLoading) return null;
  if (q.isError || !q.data) return <ErrorState title="Who waits for a group did not load" onRetry={() => q.refetch()} />;
  const w = q.data;
  if (!w.students.length && !w.giveTo.length && !w.noTeacher.length) return null;
  const pending = move.isPending || give.isPending;
  return (
    <section aria-labelledby="toplace-title" className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h2 id="toplace-title" className="font-display text-base font-bold text-foreground">To place</h2>
      <p className="mt-1 text-sm text-muted-foreground">A teacher changed on a reservation moves the student’s group by itself. These could not be moved yet, or have no teacher yet.</p>
      {w.giveTo.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold text-foreground">Every student of the group now has another teacher</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {w.giveTo.map((x) => (
              <li key={x.groupId} className="flex flex-wrap items-center gap-2">
                <bdi className="font-medium">{x.group}</bdi>
                <span className="text-muted-foreground"><bdi className="tabular-nums">{x.students}</bdi> <span>students enrolled with</span> <bdi>{x.teacher ?? ''}</bdi></span>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => give.mutate({ groupId: x.groupId, teacherId: x.teacherId })}><span>Give the group to</span> <bdi>{x.teacher ?? ''}</bdi></Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {w.students.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold text-foreground">Enrolled with another teacher than their group’s</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {w.students.map((x) => (
              <li key={`${x.studentId}:${x.groupId}`} className="flex flex-wrap items-center gap-2">
                <bdi className="font-medium">{x.name}</bdi>
                <span className="text-muted-foreground"><bdi>{x.subject}</bdi> · <span>in</span> <bdi>{x.group}</bdi> · <span>enrolled with</span> <bdi>{x.enrolledTeacher ?? 'no teacher'}</bdi></span>
                {x.target
                  ? <Button size="sm" variant="outline" disabled={pending} onClick={() => move.mutate({ groupId: x.target!.id, studentId: x.studentId })}><span>Move to</span> <bdi>{x.target.name}</bdi></Button>
                  : <span className="text-xs text-muted-foreground">No group of that teacher yet: make one by hand below, then move them.</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {clash && <PublishedClashNotice className="mt-3" message={clash.message} pending={pending} onAnyway={clash.retry} onCancel={() => setClash(null)} />}
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      {w.noTeacher.map((n) => <AssignTeacher key={`${n.subjectId}:${n.unitId ?? ''}`} year={year} entry={n} onDone={done} />)}
    </section>
  );
}

type NoTeacher = Awaited<ReturnType<typeof fetchWaiting>>['noTeacher'][number];

/** "No preference" given its teacher: the students' lines take the teacher (the line's rules), their enrolments and groups follow. */
function AssignTeacher({ year, entry, onDone }: { year: AcademicYearRow; entry: NoTeacher; onDone: () => void }) {
  const [chosen, setChosen] = useState<string[]>(entry.students.map((x) => x.studentId));
  const [teacherId, setTeacherId] = useState(entry.teachers[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const assign = useMutation({
    mutationFn: async () => apiResponse(api.v1.scheduling.groups['assign-teacher'].$post({
      json: { academicYearId: year.id, subjectId: entry.subjectId, unitId: entry.unitId, studentIds: chosen, teacherId, reason: reason.trim() },
    })),
    onSuccess: (r) => { if (!r.refused.length) setReason(''); onDone(); },
  });
  const r = assign.data;
  return (
    <form className="mt-3 rounded-lg border border-border p-3" onSubmit={(e) => { e.preventDefault(); if (teacherId && chosen.length && reason.trim().length >= 3) assign.mutate(); }}>
      <h3 className="text-sm font-semibold text-foreground"><span>No teacher yet:</span> <bdi>{entry.subject}</bdi></h3>
      <div className="mt-1 flex flex-wrap gap-2">
        {entry.students.map((x) => {
          const on = chosen.includes(x.studentId);
          return (
            <button key={x.studentId} type="button" aria-pressed={on} onClick={() => setChosen(on ? chosen.filter((y) => y !== x.studentId) : [...chosen, x.studentId])}
              className={cn('rounded-full border px-3 py-1 text-xs font-medium', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent')}>
              <bdi>{x.name}</bdi>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor={`as-t-${entry.subjectId}-${entry.unitId ?? ''}`} className="mb-1 text-xs text-muted-foreground">Teacher</Label>
          <select id={`as-t-${entry.subjectId}-${entry.unitId ?? ''}`} className={cn(SELECT_CLASS, 'w-48')} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            {entry.teachers.length === 0 && <option value="">Nobody teaches it this cycle</option>}
            {entry.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor={`as-r-${entry.subjectId}-${entry.unitId ?? ''}`} className="mb-1 text-xs text-muted-foreground">Reason</Label>
          <Input id={`as-r-${entry.subjectId}-${entry.unitId ?? ''}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Placed in the morning set" className="w-60" />
        </div>
        <Button type="submit" disabled={!teacherId || !chosen.length || reason.trim().length < 3 || assign.isPending}>{assign.isPending ? 'Assigning…' : `Assign ${chosen.length}`}</Button>
      </div>
      {assign.isError && <p className="mt-2 text-sm text-destructive">{assign.error instanceof Error ? assign.error.message : 'Not assigned'}</p>}
      {r && (
        <div className="mt-2 text-sm">
          <p><span>Assigned:</span> <bdi className="tabular-nums">{r.assigned.length}</bdi>{r.followed.groupsGiven.length > 0 && <> · <span>groups given their teacher:</span> <bdi>{r.followed.groupsGiven.map((g) => g.groupName).join(', ')}</bdi></>}</p>
          {r.refused.length > 0 && (
            <ul className="mt-1 list-disc ps-4 text-destructive">
              {r.refused.map((x) => <li key={`${x.studentId}:${x.registrationId ?? ''}`}><bdi>{x.name}</bdi>: <span>{x.why}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

// ─── Section groups ──────────────────────────────────────────────────────────

function SectionGroups({ year, teachers, onDone }: { year: AcademicYearRow; teachers: Teacher[]; onDone: () => void }) {
  const sections = useQuery({ queryKey: ['academic', 'sections', year.id], queryFn: () => fetchSections(year.id) });
  const catalogue = useQuery({ queryKey: ['catalogue'], queryFn: fetchCatalogue });
  const [name, setName] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [weekly, setWeekly] = useState('3');
  const [doubles, setDoubles] = useState('0');
  const [chosen, setChosen] = useState<string[]>([]);
  const make = useMutation({
    mutationFn: async () => apiResponse(api.v1.scheduling.groups.sections.$post({
      json: { academicYearId: year.id, sectionIds: chosen, name: name.trim(), subjectId: subjectId || null, teacherId: teacherId || null, weeklyPeriods: Number(weekly) || 0, doublePeriods: Number(doubles) || 0 },
    })),
    onSuccess: () => { setChosen([]); onDone(); },
  });
  const list = sections.data ?? [];
  return (
    <section aria-labelledby="sections-title" className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h2 id="sections-title" className="font-display text-base font-bold text-foreground">Taught to whole sections</h2>
      <p className="mt-1 text-sm text-muted-foreground">One group per section (its students follow the section, moves included) — for a national subject, PE or anything a section takes together.</p>
      <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (name.trim() && chosen.length) make.mutate(); }}>
        <div>
          <Label htmlFor="sg-name" className="mb-1 text-xs text-muted-foreground">Course (each group is “course section”)</Label>
          <Input id="sg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Arabic" maxLength={100} />
        </div>
        <div>
          <Label htmlFor="sg-subject" className="mb-1 text-xs text-muted-foreground">Subject (optional)</Label>
          <select id="sg-subject" className={SELECT_CLASS} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Not an exam subject</option>
            {(catalogue.data?.registrable ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{`${s.name} (${s.code})`}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="sg-teacher" className="mb-1 text-xs text-muted-foreground">Teacher</Label>
          <select id="sg-teacher" className={SELECT_CLASS} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">No teacher yet</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="flex gap-3">
          <div>
            <Label htmlFor="sg-weekly" className="mb-1 text-xs text-muted-foreground">Periods a week</Label>
            <Input id="sg-weekly" type="number" min={0} max={30} value={weekly} onChange={(e) => setWeekly(e.target.value)} className="w-24" />
          </div>
          <div>
            <Label htmlFor="sg-doubles" className="mb-1 text-xs text-muted-foreground">Doubles</Label>
            <Input id="sg-doubles" type="number" min={0} max={15} value={doubles} onChange={(e) => setDoubles(e.target.value)} className="w-24" />
          </div>
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-xs text-muted-foreground">Sections</legend>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sections this year — add them on the Sections screen.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-accent" onClick={() => setChosen(chosen.length === list.length ? [] : list.map((s) => s.id))}>
                {chosen.length === list.length ? 'None' : 'All'}
              </button>
              {list.map((s) => {
                const on = chosen.includes(s.id);
                return (
                  <button key={s.id} type="button" aria-pressed={on} onClick={() => setChosen(on ? chosen.filter((x) => x !== s.id) : [...chosen, s.id])}
                    className={cn('rounded-full border px-3 py-1 text-xs font-medium', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent')}>
                    <bdi>{s.name}</bdi>
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!name.trim() || !chosen.length || make.isPending}>{make.isPending ? 'Making…' : `Make ${chosen.length || ''} groups`.replace('  ', ' ')}</Button>
          {make.data && (
            <span className="text-sm text-muted-foreground">
              <span>Made:</span> <bdi>{make.data.created.map((g) => g.name).join(', ') || '—'}</bdi>
              {make.data.skipped.length > 0 && <> · <span>Already there:</span> <bdi>{make.data.skipped.join(', ')}</bdi></>}
            </span>
          )}
        </div>
        {make.isError && <Notice tone="danger" className="sm:col-span-2">{make.error instanceof Error ? make.error.message : 'They were not made'}</Notice>}
      </form>
    </section>
  );
}

function NewGroup({ year, teachers, onDone }: { year: AcademicYearRow; teachers: Teacher[]; onDone: () => void }) {
  const catalogue = useQuery({ queryKey: ['catalogue'], queryFn: fetchCatalogue });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [delivery, setDelivery] = useState<'in_school' | 'online'>('in_school');
  const [weekly, setWeekly] = useState('2');
  const make = useMutation({
    mutationFn: async () => apiResponse(api.v1.scheduling.groups.$post({
      json: {
        academicYearId: year.id, name: name.trim(), subjectId: subjectId || null, unitId: subjectId && unitId ? unitId : null, teacherId: teacherId || null,
        delivery, weeklyPeriods: Number(weekly) || 0, doublePeriods: 0,
      },
    })),
    onSuccess: () => { setOpen(false); setName(''); setUnitId(''); onDone(); },
  });
  // The units a group of this subject may teach: those of its board in the catalogue.
  const subjectRow = (catalogue.data?.registrable ?? []).find((x) => x.id === subjectId);
  const units = (catalogue.data?.units ?? []).filter((u) => subjectRow && u.boardCode === subjectRow.council);
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>A group by hand</Button>;
  return (
    <form className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/40 p-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) make.mutate(); }}>
      <div><Label htmlFor="ng-name" className="mb-1 text-xs text-muted-foreground">Name</Label><Input id="ng-name" value={name} onChange={(e) => setName(e.target.value)} className="w-44" autoFocus /></div>
      <div>
        <Label htmlFor="ng-subject" className="mb-1 text-xs text-muted-foreground">Subject</Label>
        <select id="ng-subject" className={cn(SELECT_CLASS, 'w-44')} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">Not an exam subject</option>
          {(catalogue.data?.registrable ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {subjectId && units.length > 0 && (
        <div>
          <Label htmlFor="ng-unit" className="mb-1 text-xs text-muted-foreground">Unit</Label>
          <select id="ng-unit" className={cn(SELECT_CLASS, 'w-36')} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">The whole subject</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.shortCode ?? u.code}</option>)}
          </select>
        </div>
      )}
      <div>
        <Label htmlFor="ng-delivery" className="mb-1 text-xs text-muted-foreground">Taught</Label>
        <select id="ng-delivery" className={cn(SELECT_CLASS, 'w-32')} value={delivery} onChange={(e) => setDelivery(e.target.value as 'in_school' | 'online')}>
          <option value="in_school">In school</option>
          <option value="online">Online</option>
        </select>
      </div>
      <div>
        <Label htmlFor="ng-teacher" className="mb-1 text-xs text-muted-foreground">Teacher</Label>
        <select id="ng-teacher" className={cn(SELECT_CLASS, 'w-40')} value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
          <option value="">No teacher yet</option>
          {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div><Label htmlFor="ng-weekly" className="mb-1 text-xs text-muted-foreground">Periods</Label><Input id="ng-weekly" type="number" min={0} max={30} value={weekly} onChange={(e) => setWeekly(e.target.value)} className="w-20" /></div>
      <Button type="submit" disabled={!name.trim() || make.isPending}>Add</Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      {make.isError && <span className="w-full text-sm text-destructive">{make.error instanceof Error ? make.error.message : 'Not added'}</span>}
    </form>
  );
}

// ─── One group's row, and its students ───────────────────────────────────────

function NumberCell({ id, value, onSave, label, max }: { id: string; value: number; onSave: (n: number) => void; label: string; max: number }) {
  const [v, setV] = useState(String(value));
  const save = () => { const n = Number(v); if (Number.isInteger(n) && n >= 0 && n <= max && n !== value) onSave(n); else setV(String(value)); };
  return (
    <Input id={id} aria-label={label} type="number" min={0} max={max} value={v} className="h-8 w-20"
      onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') setV(String(value)); }} />
  );
}

type GroupChange = {
  teacherId?: string | null; teacherFrom?: string; anyway?: boolean; clashToken?: string | null; weeklyPeriods?: number; doublePeriods?: number; delivery?: 'in_school' | 'online';
  roomType?: (typeof ROOM_TYPES)[number] | null; roomFeatures?: (typeof ROOM_FEATURES)[number][]; roomId?: string | null; name?: string;
};

function GroupRowView({ g, teachers, rooms, open, onToggle, onDone, all, year }: { g: GroupRow; teachers: Teacher[]; rooms: Room[]; open: boolean; onToggle: () => void; onDone: () => void; all: GroupRow[]; year: AcademicYearRow }) {
  const [error, setError] = useState<string | null>(null);
  const [clash, setClash] = useState<{ message: string; retry: GroupChange } | null>(null);
  // A new teacher takes the group from a day: the weeks before keep the teacher they had.
  const today = schoolToday();
  const firstDay = today < year.startsOn ? year.startsOn : today > year.endsOn ? year.startsOn : today;
  const [newTeacher, setNewTeacher] = useState<{ teacherId: string | null; from: string } | null>(null);
  const update = useMutation({
    mutationFn: async (json: GroupChange) => apiResponse(api.v1.scheduling.groups[':id'].$put({ param: { id: g.id }, json })),
    onSuccess: () => { setError(null); setClash(null); setNewTeacher(null); onDone(); },
    onError: (e, vars) => {
      if (isPublishedClash(e)) setClash({ message: clashMessage(e), retry: { ...vars, ...goAheadWith(e) } });
      else setError(e instanceof Error ? e.message : 'Not saved');
    },
  });
  const kind = KIND[g.kind] ?? KIND.manual!;
  const roomLabel = g.delivery === 'online' ? 'None: online' : g.room ? g.room.name : g.roomType ? ROOM_TYPE_LABEL[g.roomType] : g.kind === 'section' ? 'Its section’s room first' : 'Any that fits';
  return (
    <>
      <tr className={cn('border-b border-border', g.archived && 'opacity-60')}>
        <td className="px-5 py-2">
          <button type="button" onClick={onToggle} aria-expanded={open} className="text-start">
            <span className="block font-semibold text-foreground hover:underline"><bdi>{g.name}</bdi></span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge tone={kind.tone}>{kind.label}</Badge>
              {g.subject ? <bdi>{`${g.subject.name} (${g.subject.code})`}</bdi> : <span>Not an exam subject</span>}
              {g.unit && <Badge tone="info"><span>Unit</span> <bdi>{g.unit.shortCode ?? g.unit.code}</bdi></Badge>}
              <DeliveryBadge g={g} />
              {g.archived && <Badge tone="neutral">Retired</Badge>}
            </span>
          </button>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </td>
        <td className="px-3 py-2">
          <select aria-label={`Teacher for ${g.name}`} className={cn(SELECT_CLASS, 'h-8 w-44')} value={newTeacher ? newTeacher.teacherId ?? '' : g.teacherId ?? ''} disabled={g.archived || update.isPending}
            onChange={(e) => setNewTeacher({ teacherId: e.target.value || null, from: newTeacher?.from ?? firstDay })}>
            <option value="">No teacher yet</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {newTeacher && (
            <form className="mt-1.5 flex flex-wrap items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); update.mutate({ teacherId: newTeacher.teacherId, teacherFrom: newTeacher.from }); }}>
              <Label htmlFor={`from-${g.id}`} className="text-xs text-muted-foreground">From</Label>
              <Input id={`from-${g.id}`} type="date" className="h-8 w-36" min={year.startsOn} max={year.endsOn} value={newTeacher.from} onChange={(e) => setNewTeacher({ ...newTeacher, from: e.target.value })} required />
              <Button size="sm" type="submit" disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Change'}</Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => { setNewTeacher(null); setClash(null); }}>Cancel</Button>
            </form>
          )}
        </td>
        <td className="px-3 py-2 text-end tabular-nums">{g.size}</td>
        <td className="px-3 py-2">{g.archived ? g.weeklyPeriods : <NumberCell id={`w-${g.id}`} label={`Periods a week for ${g.name}`} value={g.weeklyPeriods} max={30} onSave={(n) => update.mutate({ weeklyPeriods: n, doublePeriods: Math.min(g.doublePeriods, Math.floor(n / 2)) })} />}</td>
        <td className="px-3 py-2">{g.archived ? g.doublePeriods : <NumberCell id={`d-${g.id}`} label={`Doubles for ${g.name}`} value={g.doublePeriods} max={15} onSave={(n) => update.mutate({ doublePeriods: n })} />}</td>
        <td className="px-3 py-2 text-xs text-muted-foreground"><bdi>{roomLabel}</bdi>{g.roomFeatures.length > 0 && <span>{` + ${g.roomFeatures.map((f) => FEATURE_LABEL[f] ?? f).join(', ')}`}</span>}</td>
        <td className="px-5 py-2 text-end"><Button size="sm" variant="ghost" onClick={onToggle}>{open ? 'Close' : 'Details'}</Button></td>
      </tr>
      {clash && (
        <tr className="border-b border-border">
          <td colSpan={7} className="px-5 py-3">
            <PublishedClashNotice message={clash.message} pending={update.isPending} onAnyway={() => update.mutate(clash.retry)} onCancel={() => { setClash(null); setNewTeacher(null); }} />
          </td>
        </tr>
      )}
      {open && (
        <tr className="border-b border-border bg-muted/30">
          <td colSpan={7} className="px-5 py-4">
            <GroupDetail g={g} rooms={rooms} teachers={teachers} all={all} year={year} onDone={onDone} update={(json) => update.mutate(json)} pending={update.isPending} />
          </td>
        </tr>
      )}
    </>
  );
}

function GroupDetail({
  g, rooms, teachers, all, year, onDone, update, pending,
}: {
  g: GroupRow; rooms: Room[]; teachers: Teacher[]; all: GroupRow[]; year: AcademicYearRow; onDone: () => void; pending: boolean;
  update: (json: { roomType?: (typeof ROOM_TYPES)[number] | null; roomFeatures?: (typeof ROOM_FEATURES)[number][]; roomId?: string | null; delivery?: 'in_school' | 'online' }) => void;
}) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: [...TT_KEY, 'group', g.id], queryFn: () => fetchGroup(g.id) });
  const [selected, setSelected] = useState<string[]>([]);
  const [modal, setModal] = useState<'end' | 'split' | 'merge' | 'retire' | null>(null);
  const [splitName, setSplitName] = useState(`${g.name} (2)`);
  const [splitTeacher, setSplitTeacher] = useState(g.teacherId ?? '');
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [clash, setClash] = useState<{ message: string; retry: () => void } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const withCode = (v: Partial<GoAhead>) => (v.anyway ? { anyway: true as const, clashToken: v.clashToken ?? null } : {});
  const done = () => { setSelected([]); setModal(null); setError(null); setClash(null); qc.invalidateQueries({ queryKey: TT_KEY }); onDone(); };
  const fail = (e: unknown, retry?: (goAhead: GoAhead) => void) => {
    if (retry && isPublishedClash(e)) { setModal(null); setClash({ message: clashMessage(e), retry: () => retry(goAheadWith(e)) }); return; }
    setError(e instanceof Error ? e.message : 'That did not work');
  };
  const candidates = useQuery({
    queryKey: ['enrolable', year.id, search],
    queryFn: () => apiResponse(api.v1.enrolments.students.$get({ query: { academicYearId: year.id, search: search.trim() || undefined } })),
    enabled: search.trim().length >= 2 && g.kind !== 'section',
  });
  const add = useMutation({
    mutationFn: async (v: { studentId: string } & Partial<GoAhead>) => apiResponse(api.v1.scheduling.groups[':id'].members.$post({ param: { id: g.id }, json: { studentIds: [v.studentId], ...withCode(v) } })),
    onSuccess: done, onError: (e, v) => fail(e, (go) => add.mutate({ ...v, ...go })),
  });
  const end = useMutation({ mutationFn: async (reason: string) => apiResponse(api.v1.scheduling.groups[':id'].members.end.$post({ param: { id: g.id }, json: { studentIds: selected, reason } })), onSuccess: done, onError: (e) => fail(e) });
  const split = useMutation({
    mutationFn: async (v: Partial<GoAhead> = {}) => apiResponse(api.v1.scheduling.groups[':id'].split.$post({ param: { id: g.id }, json: { parts: [{ name: splitName.trim(), teacherId: splitTeacher || null, studentIds: selected }], ...withCode(v) } })),
    onSuccess: (r) => { done(); if (r.notInPublishedTimetable) setNotice('The new group has no lessons in the published timetable: its students have none for this subject until a new version with it is published.'); },
    onError: (e) => fail(e, (go) => split.mutate(go)),
  });
  const merge = useMutation({
    mutationFn: async (v: Partial<GoAhead> = {}) => apiResponse(api.v1.scheduling.groups.merge.$post({ json: { intoGroupId: g.id, groupIds: mergeIds, ...withCode(v) } })),
    onSuccess: done, onError: (e) => fail(e, (go) => merge.mutate(go)),
  });
  const retire = useMutation({ mutationFn: async (reason: string) => apiResponse(api.v1.scheduling.groups[':id'].archive.$post({ param: { id: g.id }, json: { reason } })), onSuccess: done, onError: (e) => fail(e) });
  const mergeable = useMemo(() => all.filter((x) => x.id !== g.id && x.kind !== 'section' && (x.subject?.id ?? null) === (g.subject?.id ?? null) && (x.unitId ?? null) === (g.unitId ?? null)), [all, g]);
  const students = detail.data?.students ?? [];
  const explicit = g.kind !== 'section';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-foreground">
            <span>Students today</span> <span className="text-muted-foreground">(<bdi className="tabular-nums">{students.length}</bdi>)</span>
          </h3>
          {explicit && !g.archived && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!selected.length} onClick={() => setModal('split')}>{`Move ${selected.length || ''} to a new group`.replace('  ', ' ')}</Button>
              <Button size="sm" variant="outline" disabled={!selected.length} onClick={() => setModal('end')}>Take out</Button>
            </div>
          )}
        </div>
        {!explicit && <p className="mt-1 text-sm text-muted-foreground">Its students are the section’s: move a student between sections on the Sections screen.</p>}
        {detail.isLoading ? <LoadingState label="Loading the students…" /> : students.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No students in this group today.</p>
        ) : (
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {students.map((s) => (
              <li key={s.id}>
                <label className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
                  {explicit && !g.archived && <input type="checkbox" checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} />}
                  <bdi className="text-foreground">{s.name}</bdi>
                  {s.grade !== null && <span className="text-xs text-muted-foreground">{`Grade ${s.grade}`}</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
        {explicit && !g.archived && (
          <div className="mt-4">
            <Label htmlFor={`add-${g.id}`} className="mb-1 text-xs text-muted-foreground">Add a student</Label>
            <Input id={`add-${g.id}`} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email or student ID" className="max-w-sm" />
            {candidates.data && candidates.data.length > 0 && (
              <ul className="mt-2 max-w-sm divide-y divide-border rounded-lg border border-border bg-card">
                {candidates.data.filter((c) => !students.some((s) => s.id === c.id)).slice(0, 8).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                    <span><bdi>{c.name}</bdi> <span className="text-xs text-muted-foreground">{c.gradeThatYear !== null ? `Grade ${c.gradeThatYear}` : ''}</span></span>
                    <Button size="sm" variant="outline" disabled={add.isPending} onClick={() => add.mutate({ studentId: c.id })}>Add</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {detail.data && detail.data.history.some((h) => h.endedOn) && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted-foreground">History</summary>
            <ul className="mt-2 space-y-0.5 text-muted-foreground">
              {detail.data.history.filter((h) => h.endedOn).map((h) => (
                <li key={h.id}><bdi>{`${h.name}: ${h.startedOn} – ${h.endedOn}${h.endReason ? ` (${h.endReason})` : ''}`}</bdi></li>
              ))}
            </ul>
          </details>
        )}
        {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
        {clash && (
          <PublishedClashNotice className="mt-3" message={clash.message} pending={add.isPending || split.isPending || merge.isPending}
            onAnyway={() => { const retry = clash.retry; setClash(null); retry(); }} onCancel={() => setClash(null)} />
        )}
        {notice && <Notice tone="info" className="mt-3">{notice}</Notice>}
      </div>

      <div className="space-y-4">
        {g.kind !== 'section' && (
          <div>
            <Label htmlFor={`dl-${g.id}`} className="mb-1 text-xs text-muted-foreground">Taught</Label>
            <select id={`dl-${g.id}`} className={SELECT_CLASS} value={g.delivery} disabled={g.archived || pending} onChange={(e) => update({ delivery: e.target.value as 'in_school' | 'online' })}>
              <option value="in_school">In school</option>
              <option value="online">Online (timetabled, no room)</option>
            </select>
          </div>
        )}
        {g.providerTaught && <Notice tone="info">A provider teaches this group outside the timetable: it has no lessons.</Notice>}
        <fieldset disabled={g.archived || pending || g.delivery === 'online'} hidden={g.delivery === 'online'} className="space-y-3">
          <legend className="font-semibold text-foreground">The room it needs</legend>
          <div>
            <Label htmlFor={`rt-${g.id}`} className="mb-1 text-xs text-muted-foreground">Type</Label>
            <select id={`rt-${g.id}`} className={SELECT_CLASS} value={g.roomType ?? ''} onChange={(e) => update({ roomType: (e.target.value || null) as (typeof ROOM_TYPES)[number] | null })}>
              <option value="">Any type</option>
              {ROOM_TYPES.map((t) => <option key={t} value={t}>{ROOM_TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div>
            <span className="mb-1 block text-xs text-muted-foreground">Features</span>
            <div className="flex flex-wrap gap-1.5">
              {ROOM_FEATURES.map((f) => {
                const on = g.roomFeatures.includes(f);
                return (
                  <button key={f} type="button" aria-pressed={on} onClick={() => update({ roomFeatures: on ? g.roomFeatures.filter((x) => x !== f) as (typeof ROOM_FEATURES)[number][] : [...g.roomFeatures, f] as (typeof ROOM_FEATURES)[number][] })}
                    className={cn('rounded-full border px-2.5 py-0.5 text-xs', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-accent')}>
                    {FEATURE_LABEL[f]}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Label htmlFor={`rf-${g.id}`} className="mb-1 text-xs text-muted-foreground">Always in</Label>
            <select id={`rf-${g.id}`} className={SELECT_CLASS} value={g.roomId ?? ''} onChange={(e) => update({ roomId: e.target.value || null })}>
              <option value="">Any room that fits</option>
              {rooms.filter((r) => r.isActive).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </fieldset>
        {!g.archived && (
          <div className="flex flex-wrap gap-2">
            {explicit && mergeable.length > 0 && <Button size="sm" variant="outline" onClick={() => setModal('merge')}>Merge groups into this one</Button>}
            <Button size="sm" variant="ghost" onClick={() => setModal('retire')}>Retire</Button>
          </div>
        )}
      </div>

      {modal === 'end' && (
        <ReasonModal title={`Take ${selected.length} out of ${g.name}`} description="They leave the group from today (their history stays). Their lessons in draft timetables follow." confirmLabel="Take out"
          isPending={end.isPending} error={error ?? undefined} onConfirm={(r) => end.mutate(r)} onClose={() => setModal(null)} />
      )}
      {modal === 'retire' && (
        <ReasonModal title={`Retire ${g.name}`} description="It is not taught from today: its students leave it, and its lessons leave draft timetables. Published timetables keep their history." confirmLabel="Retire" destructive
          isPending={retire.isPending} error={error ?? undefined} onConfirm={(r) => retire.mutate(r)} onClose={() => setModal(null)} />
      )}
      {modal === 'split' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="split-title">
          <form className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl" onSubmit={(e) => { e.preventDefault(); if (splitName.trim()) split.mutate({}); }}>
            <h2 id="split-title" className="font-display text-lg font-bold text-foreground">{`Move ${selected.length} students to a new group`}</h2>
            <p className="mt-1 text-sm text-muted-foreground">The new group teaches the same subject for the same periods; the others stay in {g.name}.</p>
            <div className="mt-4 space-y-3">
              <div><Label htmlFor="split-name" className="mb-1 text-sm">Name of the new group</Label><Input id="split-name" value={splitName} onChange={(e) => setSplitName(e.target.value)} maxLength={120} autoFocus /></div>
              <div>
                <Label htmlFor="split-teacher" className="mb-1 text-sm">Teacher</Label>
                <select id="split-teacher" className={SELECT_CLASS} value={splitTeacher} onChange={(e) => setSplitTeacher(e.target.value)}>
                  <option value="">No teacher yet</option>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              {error && <Notice tone="danger">{error}</Notice>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setModal(null)}>Cancel</Button>
              <Button type="submit" disabled={split.isPending || !splitName.trim()}>{split.isPending ? 'Moving…' : 'Make the group'}</Button>
            </div>
          </form>
        </div>
      )}
      {modal === 'merge' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="merge-title">
          <form className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl" onSubmit={(e) => { e.preventDefault(); if (mergeIds.length) merge.mutate({}); }}>
            <h2 id="merge-title" className="font-display text-lg font-bold text-foreground">{`Merge into ${g.name}`}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Their students move here from today and the merged groups are retired.</p>
            <ul className="mt-3 space-y-1">
              {mergeable.map((x) => (
                <li key={x.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={mergeIds.includes(x.id)} onChange={(e) => setMergeIds(e.target.checked ? [...mergeIds, x.id] : mergeIds.filter((y) => y !== x.id))} />
                    <bdi>{x.name}</bdi> <span className="text-xs text-muted-foreground">{`${x.size} students`}</span>
                  </label>
                </li>
              ))}
            </ul>
            {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setModal(null)}>Cancel</Button>
              <Button type="submit" disabled={merge.isPending || !mergeIds.length}>{merge.isPending ? 'Merging…' : 'Merge'}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
