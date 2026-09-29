'use client';

/**
 * One section (FEATURES_PLAN.md F0a): its members, adding students, taking
 * one out, and its history.
 *
 * The spreadsheet version: the class tab. Adding a student means finding
 * them on the master list, copying the row to the tab (and remembering to
 * delete it from their old class's tab), with nothing to stop a grade-10
 * student landing in 11A or the class going over its size; taking one out
 * deletes the row, and with it the fact they were ever there. Here the
 * search already shows only the students of the section's grade who have
 * no section yet (one toggle widens it to students in other sections, who
 * are moved), several searches build one selection, one click adds them
 * all, the API refuses a wrong grade or a full class with its reason, and
 * a membership that ends stays in the history with the day and the reason.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiResponse, academicYearShortLabel, academicYearStartOf, gradeLabel, gradeStanding, schoolDateString } from '@repo/validations';
import { api } from '~/lib/hono';
import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { ReasonModal } from '~/components/ui/reason-modal';
import { Badge, Notice } from '~/components/ui/tone';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { AsWritten, EndReason, useSchoolDates } from '~/components/student-academic-panel';
import { SectionForm } from './section-form.client';
import { fetchSection, fetchSections, fetchStudents, keys, type SectionDetailData, type StudentsQuery } from './sections.data';

type Member = SectionDetailData['members'][number];

export function SectionDetail({ sectionId, onBack }: { sectionId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const dates = useSchoolDates();
  const { data: s, isLoading, isError, error, refetch } = useQuery({
    queryKey: keys.section(sectionId),
    queryFn: () => fetchSection(sectionId),
  });
  const { data: siblings = [] } = useQuery({
    queryKey: keys.sections(s?.academicYearId ?? ''),
    queryFn: () => fetchSections(s!.academicYearId),
    enabled: !!s,
  });
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [ending, setEnding] = useState<Member | null>(null);
  const [endError, setEndError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['academic'] });
    qc.invalidateQueries({ queryKey: ['students'] });
  };

  const remove = useMutation({
    mutationFn: () => apiResponse(api.v1.academic.sections[':id'].$delete({ param: { id: sectionId } })),
    onSuccess: () => {
      refresh();
      onBack();
    },
    onError: (err: Error) => {
      setDeleteError(err.message);
      setConfirmDelete(false);
    },
  });

  const endMembership = useMutation({
    mutationFn: ({ m, reason }: { m: Member; reason: string }) => {
      // Today, kept inside the membership and the school year (a section of next year has not started).
      const today = schoolDateString(new Date());
      let endedOn = today < m.startedOn ? m.startedOn : today;
      if (s && endedOn > s.academicYear.endsOn) endedOn = s.academicYear.endsOn < m.startedOn ? m.startedOn : s.academicYear.endsOn;
      return apiResponse(
        api.v1.academic.sections[':id'].members[':membershipId'].end.$post({
          param: { id: sectionId, membershipId: m.id },
          json: { endedOn, reason },
        }),
      );
    },
    onSuccess: () => {
      setEnding(null);
      setEndError('');
      setNotice('Taken out of the section. The membership stays in the history below.');
      refresh();
    },
    onError: (err: Error) => setEndError(err.message),
  });

  if (isLoading) return <LoadingState label="Loading the section…" />;
  if (isError || !s) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <ErrorState title="Could not open this section" message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />
      </div>
    );
  }

  const full = s.capacity !== null && s.members.length >= s.capacity;

  return (
    <div className="space-y-6">
      <BackButton onBack={onBack} />

      {/* The section */}
      <header className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-3xl font-bold tracking-tight text-foreground">{s.name}</h2>
              <Badge tone="info">{gradeLabel(s.grade)}</Badge>
              <span className="text-sm text-muted-foreground" dir="ltr">
                {academicYearShortLabel(s.academicYear.startYear)}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Homeroom teacher</dt>
                <dd className="font-medium text-foreground">{s.homeroomTeacher?.name ?? <span className="text-muted-foreground">Not named yet</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Room</dt>
                <dd className="font-medium text-foreground">{s.room?.name ?? <span className="text-muted-foreground">No room yet</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Students</dt>
                <dd className="font-medium text-foreground">
                  <span>{s.members.length}</span>
                  {s.capacity !== null && (
                    <>
                      {' / '}
                      <span>{s.capacity}</span>
                    </>
                  )}
                  {full && (
                    <Badge tone="warning" className="ms-2">
                      Full
                    </Badge>
                  )}
                </dd>
              </div>
            </dl>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-10" onClick={() => setEditing(true)}>
              Edit
            </Button>
            {!confirmDelete ? (
              <Button
                variant="outline"
                className="h-10 text-destructive hover:text-destructive"
                onClick={() => {
                  setDeleteError('');
                  setConfirmDelete(true);
                }}
              >
                Delete
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5">
                <span className="text-sm text-foreground">Delete this section?</span>
                <Button variant="destructive" size="sm" className="h-9" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  {remove.isPending ? 'Working…' : 'Delete'}
                </Button>
                <Button variant="ghost" size="sm" className="h-9" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>
        {deleteError && (
          <Notice tone="danger" className="mt-4">
            <AsWritten>{deleteError}</AsWritten>
          </Notice>
        )}
      </header>

      {notice && (
        <Notice tone="success">
          <span>{notice}</span>{' '}
          <button type="button" className="text-xs underline hover:no-underline" onClick={() => setNotice('')}>
            Dismiss
          </button>
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Members */}
        <section aria-labelledby="members-heading" className="min-w-0">
          <h3 id="members-heading" className="mb-2 font-display text-lg font-bold text-foreground">
            Members
          </h3>
          {s.members.length === 0 ? (
            <EmptyState title="No students in this section yet" message="Add them with the search on this page." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-border bg-muted">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold text-muted-foreground">Name</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold text-muted-foreground">Student ID</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold text-muted-foreground">Grade that year</th>
                    <th scope="col" className="px-4 py-2.5 text-start font-semibold text-muted-foreground">Since</th>
                    <th scope="col" className="px-4 py-2.5 text-end font-semibold text-muted-foreground">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.members.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-2.5">
                        <Link href={`/students/${m.studentId}`} className="whitespace-nowrap font-medium text-foreground hover:underline">
                          {m.student.name}
                        </Link>
                        {m.student.leftOn && (
                          <Badge tone="danger" className="ms-2">
                            Left the school
                          </Badge>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-foreground">{m.student.studentId ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-foreground">
                        <span>{gradeLabel(m.gradeThatYear)}</span>
                        {m.gradeThatYear !== s.grade && (
                          <Badge tone="warning" className="ms-2">
                            Not this section&apos;s grade
                          </Badge>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-foreground">{dates.day(m.startedOn)}</td>
                      <td className="px-4 py-2.5 text-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9"
                          onClick={() => {
                            setEndError('');
                            setEnding(m);
                          }}
                        >
                          Take out
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <AddStudents section={s} full={full} onAdded={refresh} />
      </div>

      {/* History */}
      <section aria-labelledby="history-heading">
        <h3 id="history-heading" className="mb-2 font-display text-lg font-bold text-foreground">
          History
        </h3>
        {s.history.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground shadow-sm">
            No one has left this section.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border bg-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold text-muted-foreground">Name</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold text-muted-foreground">Student ID</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold text-muted-foreground">From</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold text-muted-foreground">Until</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold text-muted-foreground">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {s.history.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2.5">
                      <Link href={`/students/${m.studentId}`} className="whitespace-nowrap font-medium text-foreground hover:underline">
                        {m.student.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-foreground">{m.student.studentId ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-foreground">{dates.day(m.startedOn)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-foreground">{m.endedOn ? dates.day(m.endedOn) : '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{m.endReason ? <EndReason text={m.endReason} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <SectionForm
          academicYearId={s.academicYearId}
          section={s}
          takenNames={siblings.filter((x) => x.id !== s.id).map((x) => x.name)}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
      {ending && (
        <ReasonModal
          title={ending.student.name}
          description="Their membership of this section ends today and stays in its history. To move a student to another section, add them there instead: this membership then ends by itself."
          confirmLabel="Take out of the section"
          destructive
          isPending={endMembership.isPending}
          error={endError}
          onConfirm={(reason) => endMembership.mutate({ m: ending, reason })}
          onClose={() => setEnding(null)}
        />
      )}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex min-h-10 items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span aria-hidden className="inline-block rtl:rotate-180">←</span>
      <span>All sections</span>
    </button>
  );
}

// ─── Adding students ─────────────────────────────────────────────────────────

function AddStudents({ section: s, full, onAdded }: { section: SectionDetailData; full: boolean; onAdded: () => void }) {
  const current = academicYearStartOf();
  const yearStart = s.academicYear.startYear;
  const isCurrentYear = yearStart === current;
  // The students list filters on today's grade: in the section's year they are in the section's grade.
  const todayGrade = s.grade - (yearStart - current);
  const searchable = todayGrade >= 9 && todayGrade <= 14;

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [includeOthers, setIncludeOthers] = useState(false);
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [startsOn, setStartsOn] = useState('');
  const [result, setResult] = useState<{ added: number; moved: number; alreadyIn: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const query: StudentsQuery = {
    search: debounced || undefined,
    grade: String(todayGrade),
    status: gradeStanding(todayGrade),
    withoutSection: isCurrentYear && !includeOthers ? 'true' : undefined,
    limit: '100',
    offset: '0',
  };
  const { data, isLoading, isError, error: loadError, refetch, isFetching } = useQuery({
    queryKey: ['academic', 'sections-screen', 'candidates', s.id, query],
    queryFn: () => fetchStudents(query),
    enabled: searchable,
    placeholderData: keepPreviousData,
  });
  const memberIds = new Set(s.members.map((m) => m.studentId));
  const candidates = (data?.students ?? []).filter((c) => !memberIds.has(c.id));
  const placesLeft = s.capacity === null ? null : s.capacity - s.members.length;

  const add = useMutation({
    mutationFn: () =>
      apiResponse(
        api.v1.academic.sections[':id'].members.$post({
          param: { id: s.id },
          json: { studentIds: [...selected.keys()], ...(startsOn ? { startsOn } : {}) },
        }),
      ),
    onSuccess: (d) => {
      setResult(d);
      setError('');
      setSelected(new Map());
      onAdded();
    },
    onError: (err: Error) => {
      setError(err.message);
      setResult(null);
    },
  });

  const toggle = (id: string, name: string) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, name);
      return next;
    });
  const allShownSelected = candidates.length > 0 && candidates.every((c) => selected.has(c.id));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (allShownSelected) candidates.forEach((c) => next.delete(c.id));
      else candidates.forEach((c) => next.set(c.id, c.name));
      return next;
    });
  const n = selected.size;

  return (
    <section aria-labelledby="add-heading" className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm">
      <h3 id="add-heading" className="font-display text-lg font-bold text-foreground">
        Add students
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {isCurrentYear
          ? includeOthers
            ? 'Students of this grade, including those in other sections: adding one moves them here.'
            : 'Students of this grade with no section this year.'
          : 'Students of this grade in that year. One already in another section of that year is moved here.'}
      </p>

      {result && (
        <Notice tone="success" className="mt-3">
          <ul className="space-y-0.5">
            <li>
              <span>Added:</span> <span className="font-semibold">{result.added}</span>
            </li>
            {result.moved > 0 && (
              <li>
                <span>Moved from another section:</span> <span className="font-semibold">{result.moved}</span>
              </li>
            )}
            {result.alreadyIn > 0 && (
              <li>
                <span>Already in this section:</span> <span className="font-semibold">{result.alreadyIn}</span>
              </li>
            )}
          </ul>
        </Notice>
      )}
      {error && (
        <Notice tone="danger" className="mt-3">
          <AsWritten>{error}</AsWritten>
        </Notice>
      )}

      {!searchable ? (
        <p className="mt-3 text-sm text-muted-foreground">No student can be in this grade in that year yet.</p>
      ) : (
        <>
          <label htmlFor="add-search" className="mt-3 mb-1 block text-sm font-medium text-foreground">
            Search
          </label>
          <input
            id="add-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, email or student ID"
            autoComplete="off"
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {isCurrentYear && (
            <label className="mt-2 flex min-h-10 cursor-pointer items-center gap-2 text-sm text-foreground">
              <input type="checkbox" className="size-4" checked={includeOthers} onChange={(e) => setIncludeOthers(e.target.checked)} />
              <span>Include students in other sections (they move here)</span>
            </label>
          )}

          <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-border">
            {isLoading ? (
              <LoadingState label="Finding students…" />
            ) : isError ? (
              <ErrorState title="Could not search" message={loadError instanceof Error ? loadError.message : undefined} onRetry={() => refetch()} />
            ) : candidates.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                {debounced
                  ? 'No student of this grade matches.'
                  : isCurrentYear && !includeOthers
                    ? 'Every student of this grade has a section this year.'
                    : 'No other student of this grade.'}
              </p>
            ) : (
              <ul className={cn('divide-y divide-border', isFetching && 'opacity-70')}>
                <li className="bg-muted/60">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm font-medium text-foreground">
                    <input type="checkbox" className="size-4" checked={allShownSelected} onChange={toggleAll} />
                    <span>Select all shown</span>
                    <span className="ms-auto text-xs font-normal text-muted-foreground">{candidates.length}</span>
                  </label>
                </li>
                {candidates.map((c) => (
                  <li key={c.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                      <input type="checkbox" className="size-4" checked={selected.has(c.id)} onChange={() => toggle(c.id, c.name)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">{c.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          <span className="font-mono">{c.studentId ?? '—'}</span> · <span>{c.gradeLabel}</span>
                        </span>
                      </span>
                      {isCurrentYear && c.sectionName && (
                        <Badge tone="warning">
                          <span>Moves from</span>&nbsp;<span>{c.sectionName}</span>
                        </Badge>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {data && data.total > (data.students.length ?? 0) && (
            <p className="mt-1 text-xs text-muted-foreground">
              <span>Showing the first</span> <span>{data.students.length}</span> <span>of</span> <span>{data.total}</span>
              {': '}
              <span>search to narrow the list.</span>
            </p>
          )}

          {n > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                <span>Selected:</span> <span>{n}</span>
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {[...selected.entries()].map(([id, name]) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => toggle(id, name)}
                      className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-background px-2.5 text-xs text-foreground hover:bg-muted"
                    >
                      <span className="sr-only">Remove</span>
                      <span>{name}</span>
                      <span aria-hidden>×</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3">
            <label htmlFor="add-starts" className="mb-1 block text-xs font-medium text-muted-foreground">
              Starting on (optional)
            </label>
            <input
              id="add-starts"
              type="date"
              value={startsOn}
              min={s.academicYear.startsOn}
              max={s.academicYear.endsOn}
              onChange={(e) => setStartsOn(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">Empty: today, or the year&apos;s first day if it has not started.</p>
          </div>

          {placesLeft !== null && n > placesLeft && (
            <Notice tone="warning" className="mt-3">
              <span>Places left in this section:</span> <span className="font-semibold">{Math.max(0, placesLeft)}</span>
            </Notice>
          )}
          {full && n === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">This section is full: raise its capacity with Edit to add more.</p>
          )}

          <Button className="mt-3 h-11 w-full" disabled={n === 0 || add.isPending} onClick={() => add.mutate()}>
            {add.isPending ? (
              'Adding…'
            ) : n === 0 ? (
              'Tick the students to add'
            ) : (
              <>
                <span>Add</span> <span>{n}</span> <span>{n === 1 ? 'student' : 'students'}</span>
              </>
            )}
          </Button>
        </>
      )}
    </section>
  );
}
