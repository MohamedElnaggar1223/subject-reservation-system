'use client';

/**
 * The family's exams (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §5).
 *
 * The paper version: the school prints each candidate's statement of entry
 * and hands it out in class, where it gets lost in a bag before anyone
 * checks the name on it; the board's timetable is a PDF of every syllabus,
 * so the family highlights their child's papers with a marker and works
 * out the extra time themselves; the room and seat are on a list pinned at
 * the hall door on the morning; results arrive as a photo of the broadsheet
 * in a WhatsApp group.
 *
 * Here, on the phone: the next exams first — today, tomorrow, then the rest
 * — each with its start and end (extra time already counted), room and
 * seat; two papers at the same time are shown with how the school handles
 * them. The statement of entry says exactly what the board was sent (the
 * name as on the ID, the candidate number, the UCI, each entry with its
 * option and tier, each paper) with one line to check it and tell the
 * school at once, and prints on its own. Results appear per series once the
 * school publishes them; a grade the board changed shows the earlier one.
 * A parent with more than one child picks one; with one child there is
 * nothing to pick. The desk opens the same screen for any student
 * (?student=) to answer a parent standing in front of them.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse, gradeLabel, schoolDateString, ACCESS_ARRANGEMENT_LABELS, TIER_LABELS, ROLES,
  type AccessArrangement, type Tier,
} from '@repo/validations';
import { Button } from '~/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { DateText, addDays, daysFrom } from '../../academic/calendar/academic-shared';
import { MaybeDate } from '../exams-shared';
import {
  fetchStudentSeries, fetchStatement, fetchStudentTimetable, fetchStudentResults, EXAMS_KEY,
  BoardText, Code, PrintButton, SessionBadge,
} from '../exam-f4-shared';

// ─── Requests (types come from the API) ──────────────────────────────────────

const fetchChildren = () => apiResponse(api.v1.links.children.$get());
const fetchStudentsFound = (search: string) => apiResponse(api.v1.students.$get({ query: { search, limit: '12' } }));
const fetchStudentRecord = (id: string) => apiResponse(api.v1.students[':id'].$get({ param: { id } }));
/** F5's sittings: used here for each result's subject title (a family cannot read the catalogue). */
const fetchSittings = (studentId: string) => apiResponse(api.v1.exams.students[':studentId'].sittings.$get({ param: { studentId } }));

type SeriesRow = Awaited<ReturnType<typeof fetchStudentSeries>>[number];
type TimetableData = Awaited<ReturnType<typeof fetchStudentTimetable>>;
type PaperRow = TimetableData['papers'][number];
type ClashRow = TimetableData['clashes'][number];
type ResultRow = Awaited<ReturnType<typeof fetchStudentResults>>['results'][number];
type SittingRow = Awaited<ReturnType<typeof fetchSittings>>[number];

/** Who is looking: the candidate, a parent, or a member of staff. */
type Audience = 'self' | 'parent' | 'staff';

const STAFF_ROLES_HERE: string[] = [ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN, ROLES.COORDINATOR, ROLES.ADMIN];

// ─── The screen ──────────────────────────────────────────────────────────────

export default function MyExamsClient({ role, viewerId }: { role: string; viewerId: string }): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const chosen = params.get('student');
  const setStudent = (id: string | null) => router.replace((id ? `${pathname}?student=${encodeURIComponent(id)}` : pathname) as Route, { scroll: false });

  if (role === ROLES.STUDENT) {
    return (
      <Page title="My exams" intro="Your next exams, your statement of entry to check, and your results.">
        <StudentExams studentId={viewerId} audience="self" />
      </Page>
    );
  }
  if (role === ROLES.PARENT) return <ParentView chosen={chosen} setStudent={setStudent} />;
  if (STAFF_ROLES_HERE.includes(role)) return <StaffView chosen={chosen} setStudent={setStudent} />;
  return <Page title="Exams" intro=""><EmptyState title="Nothing to show" /></Page>;
}

function Page({ title, intro, children, aside }: { title: string; intro: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8 animate-fade-up print:max-w-none print:p-0">
      <div className="mb-5 print:hidden">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {intro && <p className="mt-1 text-sm text-muted-foreground">{intro}</p>}
        {aside}
      </div>
      {children}
    </div>
  );
}

// ─── A parent: pick a child (one child: nothing to pick) ─────────────────────

function ParentView({ chosen, setStudent }: { chosen: string | null; setStudent: (id: string | null) => void }) {
  const { data: children, isLoading, isError, refetch } = useQuery({ queryKey: ['links', 'children'], queryFn: fetchChildren });
  const list = children ?? [];
  const current = list.find((c) => c.student.id === chosen) ?? list[0] ?? null;

  return (
    <Page
      title="Exams"
      intro="Your child's next exams, their statement of entry to check, and their results."
      aside={list.length > 1 ? (
        <div role="group" aria-label="Child" className="mt-4 flex flex-wrap gap-2">
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={current?.student.id === c.student.id}
              onClick={() => setStudent(c.student.id)}
              className={cn(
                'min-h-11 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                current?.student.id === c.student.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground hover:border-primary/40',
              )}
            >
              <bdi data-i18n-skip="true">{c.student.name}</bdi>
              {c.student.grade != null && <span className="ms-1 text-muted-foreground">· {gradeLabel(c.student.grade)}</span>}
            </button>
          ))}
        </div>
      ) : current ? (
        <p className="mt-2 text-sm font-medium text-foreground"><bdi data-i18n-skip="true">{current.student.name}</bdi></p>
      ) : null}
    >
      {isLoading ? (
        <LoadingState label="Loading your children…" />
      ) : isError ? (
        <ErrorState title="Your children did not load" message="This is a connection problem. Try again." onRetry={() => refetch()} />
      ) : !current ? (
        <EmptyState
          title="No linked children yet"
          message="Link your child's account first; their exams appear here once the school publishes the timetable."
          action={<Link href="/links" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">Link your child</Link>}
        />
      ) : (
        <StudentExams key={current.student.id} studentId={current.student.id} audience="parent" />
      )}
    </Page>
  );
}

// ─── The desk (and the coordinator, the admin): any student ──────────────────

function StaffView({ chosen, setStudent }: { chosen: string | null; setStudent: (id: string | null) => void }) {
  const { data: record, isError: recordFailed } = useQuery({
    queryKey: ['students', 'record', chosen],
    queryFn: () => fetchStudentRecord(chosen!),
    enabled: !!chosen,
    retry: false,
  });
  if (!chosen) {
    return (
      <Page title="A student's exams" intro="What a family sees on their exams page — find the student to answer a parent at the desk.">
        <StudentFinder onPick={setStudent} />
      </Page>
    );
  }
  const name = record?.student.name ?? null;
  return (
    <Page
      title="A student's exams"
      intro="What the family sees, and more: entries not yet sent and series whose timetable is not published are included for staff."
      aside={
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-700 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
          <p>
            {name ? (
              <>
                <span>Viewing the exams of</span> <bdi data-i18n-skip="true" className="font-semibold">{name}</bdi>
                {record?.student.studentId && <> · <Code>{record.student.studentId}</Code></>}
              </>
            ) : recordFailed ? (
              <span>No student with this ID.</span>
            ) : (
              <span>Loading the student…</span>
            )}
          </p>
          <Button variant="outline" size="sm" onClick={() => setStudent(null)}>Choose another student</Button>
        </div>
      }
    >
      {!recordFailed && <StudentExams key={chosen} studentId={chosen} audience="staff" />}
    </Page>
  );
}

function StudentFinder({ onPick }: { onPick: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setApplied(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ['students', 'exam-finder', applied],
    queryFn: () => fetchStudentsFound(applied),
    enabled: applied.length >= 2,
    placeholderData: keepPreviousData,
  });
  const rows = applied.length >= 2 ? data?.students ?? [] : [];
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <label htmlFor="exam-student-search" className="mb-1 block text-sm font-medium text-foreground">Find the student</label>
      <input
        id="exam-student-search"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && rows[0] && applied === search.trim()) {
            e.preventDefault();
            onPick(rows[0].id);
          }
        }}
        placeholder="Name, email or student ID"
        autoComplete="off"
        autoFocus
        suppressHydrationWarning
        className="h-11 w-full rounded-lg border border-border bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <p className="mt-1 text-xs text-muted-foreground">Enter opens the first student.</p>
      {isError ? (
        <div className="mt-3"><ErrorState title="The search did not run" onRetry={() => refetch()} /></div>
      ) : applied.length >= 2 && !isFetching && rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No student matches.</p>
      ) : rows.length > 0 ? (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {rows.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onPick(s.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-start text-sm hover:bg-accent">
                <bdi data-i18n-skip="true" className="font-medium text-foreground">{s.name}</bdi>
                <span className="text-xs text-muted-foreground">
                  {s.studentId && <Code>{s.studentId}</Code>}
                  {s.gradeLabel && <> · <span>{s.gradeLabel}</span></>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ─── One student's exams ─────────────────────────────────────────────────────

function StudentExams({ studentId, audience }: { studentId: string; audience: Audience }) {
  const seriesQ = useQuery({ queryKey: [...EXAMS_KEY, 'student', studentId, 'series'], queryFn: () => fetchStudentSeries(studentId) });
  const timetableQ = useQuery({ queryKey: [...EXAMS_KEY, 'student', studentId, 'timetable'], queryFn: () => fetchStudentTimetable(studentId) });
  const resultsQ = useQuery({ queryKey: [...EXAMS_KEY, 'student', studentId, 'results'], queryFn: () => fetchStudentResults(studentId) });
  const sittingsQ = useQuery({ queryKey: [...EXAMS_KEY, 'student', studentId, 'sittings'], queryFn: () => fetchSittings(studentId) });

  return (
    <div className="space-y-8">
      {/* The page translator records the label on the element before hydration. */}
      <nav aria-label="On this page" suppressHydrationWarning className="flex flex-wrap gap-2 text-sm print:hidden">
        <a href="#exams-next" className="rounded-full border border-border px-3 py-1.5 text-foreground hover:bg-accent">Next exams</a>
        <a href="#exams-statement" className="rounded-full border border-border px-3 py-1.5 text-foreground hover:bg-accent">Statement of entry</a>
        <a href="#exams-results" className="rounded-full border border-border px-3 py-1.5 text-foreground hover:bg-accent">Results</a>
      </nav>

      <section id="exams-next" aria-labelledby="exams-next-heading" className="scroll-mt-4 print:hidden">
        <h2 id="exams-next-heading" className="mb-3 font-display text-lg font-semibold text-foreground">Next exams</h2>
        {timetableQ.isLoading ? (
          <LoadingState label="Loading the timetable…" />
        ) : timetableQ.isError ? (
          <ErrorState title="The timetable did not load" message="This is a connection problem, not an empty timetable. Try again." onRetry={() => timetableQ.refetch()} />
        ) : (
          <Agenda papers={timetableQ.data?.papers ?? []} clashes={timetableQ.data?.clashes ?? []} audience={audience} />
        )}
      </section>

      <section id="exams-statement" aria-labelledby="exams-statement-heading" className="scroll-mt-4">
        <h2 id="exams-statement-heading" className="mb-3 font-display text-lg font-semibold text-foreground print:hidden">Statement of entry</h2>
        {seriesQ.isLoading ? (
          <LoadingState label="Loading the series…" />
        ) : seriesQ.isError ? (
          <ErrorState title="The series did not load" message="This is a connection problem. Try again." onRetry={() => seriesQ.refetch()} />
        ) : !seriesQ.data?.length ? (
          <EmptyState
            title="No statement of entry yet"
            message={audience === 'staff'
              ? 'This student has no entries with a board yet.'
              : 'Your statement of entry appears here when the school publishes the exam timetable. You will get a notice.'}
          />
        ) : (
          <Statements studentId={studentId} series={seriesQ.data} audience={audience} />
        )}
      </section>

      <section id="exams-results" aria-labelledby="exams-results-heading" className="scroll-mt-4 print:hidden">
        <h2 id="exams-results-heading" className="mb-3 font-display text-lg font-semibold text-foreground">Results</h2>
        {resultsQ.isLoading ? (
          <LoadingState label="Loading the results…" />
        ) : resultsQ.isError ? (
          <ErrorState title="The results did not load" message="This is a connection problem. Try again." onRetry={() => resultsQ.refetch()} />
        ) : (
          <Results results={resultsQ.data?.results ?? []} sittings={sittingsQ.data ?? []} audience={audience} />
        )}
      </section>
    </div>
  );
}

// ─── Next exams: today and upcoming first ────────────────────────────────────

function groupByDate<T extends { examDate: string }>(papers: T[]): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const p of papers) out.set(p.examDate, [...(out.get(p.examDate) ?? []), p]);
  return [...out.entries()];
}

function Agenda({ papers, clashes, audience }: { papers: PaperRow[]; clashes: ClashRow[]; audience: Audience }) {
  const [showPast, setShowPast] = useState(false);
  const today = schoolDateString(new Date());
  const upcoming = papers.filter((p) => p.examDate >= today);
  const past = papers.filter((p) => p.examDate < today).reverse();
  const openClashes = clashes.filter((c) => (c.papers[0]?.examDate ?? '') >= today);

  if (!papers.length) {
    return (
      <EmptyState
        title="No exams on the timetable yet"
        message={audience === 'staff'
          ? 'This student has no papers yet: their entries have no papers on a timetable.'
          : 'Your papers appear here, with the room and seat, when the school publishes the exam timetable.'}
      />
    );
  }

  return (
    <div className="space-y-4">
      {openClashes.map((c) => <ClashNotice key={`${c.papers[0]!.paperId}-${c.papers[1]!.paperId}`} clash={c} audience={audience} />)}

      {upcoming.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">No exams coming up. The past ones are below.</p>
      ) : (
        <ol className="space-y-3">
          {groupByDate(upcoming).map(([date, list]) => <DayCard key={date} date={date} papers={list} today={today} />)}
        </ol>
      )}

      {past.length > 0 && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowPast(!showPast)} aria-expanded={showPast}>
            {showPast ? 'Hide past exams' : (
              <>
                <span>Past exams</span> <span className="tabular-nums">({past.length})</span>
              </>
            )}
          </Button>
          {showPast && (
            <ol className="mt-2 space-y-3 opacity-80">
              {groupByDate(past).map(([date, list]) => <DayCard key={date} date={date} papers={list} today={today} />)}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function WhenBadge({ date, today }: { date: string; today: string }) {
  if (date === today) return <Badge tone="success">Today</Badge>;
  if (date === addDays(today, 1)) return <Badge tone="info">Tomorrow</Badge>;
  const n = daysFrom(today, date);
  // One text node, so a rule in the Arabic file can put the number where Arabic wants it.
  if (n > 1) return <Badge tone="neutral">{`in ${n} days`}</Badge>;
  return null;
}

function DayCard({ date, papers, today }: { date: string; papers: PaperRow[]; today: string }) {
  return (
    <li className={cn('rounded-xl border bg-card p-4 shadow-sm', date === today ? 'border-primary' : 'border-border')}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-foreground"><DateText date={date} weekday long /></p>
        <WhenBadge date={date} today={today} />
      </div>
      <ul className="divide-y divide-border">
        {papers.map((p) => (
          <li key={p.paperId} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-base font-semibold tabular-nums text-foreground" dir="ltr">{p.startTime}–{p.endTime}</p>
              <SessionBadge session={p.session} />
            </div>
            <p className="mt-0.5 text-sm text-foreground">
              <Code className="font-semibold">{p.code}</Code> <BoardText>{p.title}</BoardText>
            </p>
            {p.extraMinutes > 0 && (
              <p className="text-xs text-muted-foreground">
                <span>Ends later: it includes</span> <span className="tabular-nums">{p.extraMinutes}</span> <span>minutes of extra time</span>
              </p>
            )}
            <RoomSeat room={p.room} seat={p.seat} />
            <p className="text-xs text-muted-foreground"><BoardText>{p.seriesName}</BoardText></p>
          </li>
        ))}
      </ul>
    </li>
  );
}

function RoomSeat({ room, seat }: { room: string | null; seat: string | null }) {
  if (!room) return <p className="text-xs text-muted-foreground">Room and seat: the school tells you nearer the day.</p>;
  return (
    <p className="text-sm text-foreground">
      <span className="text-muted-foreground">Room</span> <bdi data-i18n-skip="true" className="font-medium">{room}</bdi>
      {seat && (
        <>
          {' · '}
          <span className="text-muted-foreground">Seat</span> <Code className="font-semibold">{seat}</Code>
        </>
      )}
    </p>
  );
}

function ClashNotice({ clash, audience }: { clash: ClashRow; audience: Audience }) {
  const [a, b] = clash.papers;
  if (!a || !b) return null;
  return (
    <Notice tone="warning" title="Two papers at the same time">
      <p>
        <DateText date={a.examDate} weekday long />{' · '}
        <Code>{a.code}</Code> <span dir="ltr" className="tabular-nums">({a.startTime}–{a.endTime})</span>{' '}
        <span>and</span>{' '}
        <Code>{b.code}</Code> <span dir="ltr" className="tabular-nums">({b.startTime}–{b.endTime})</span>
      </p>
      {clash.note ? (
        <p className="mt-1">
          <span className="font-semibold">How the school handles it:</span> <bdi data-i18n-skip="true" dir="auto">{clash.note}</bdi>
        </p>
      ) : (
        <p className="mt-1">
          {audience === 'staff'
            ? 'No note yet on how this is handled: the coordinator notes it on the timetable screen.'
            : 'The school will tell you how this is handled: usually one paper straight after the other, supervised in between.'}
        </p>
      )}
    </Notice>
  );
}

// ─── The statement of entry, per series ──────────────────────────────────────

function Statements({ studentId, series, audience }: { studentId: string; series: SeriesRow[]; audience: Audience }) {
  const today = schoolDateString(new Date());
  const defaultId = useMemo(() => {
    const ahead = series.filter((s) => (s.examsStart ?? '9999') >= today).sort((a, b) => (a.examsStart ?? '').localeCompare(b.examsStart ?? ''));
    return (ahead[0] ?? series[0])?.id ?? null;
  }, [series, today]);
  const [chosen, setChosen] = useState<string | null>(null);
  const id = chosen && series.some((s) => s.id === chosen) ? chosen : defaultId;
  const current = series.find((s) => s.id === id);

  return (
    <div className="space-y-3">
      {series.length > 1 && (
        <div role="group" aria-label="Series" className="flex flex-wrap gap-2 print:hidden">
          {series.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === id}
              onClick={() => setChosen(s.id)}
              className={cn(
                'min-h-11 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                s.id === id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-foreground hover:border-primary/40',
              )}
            >
              <BoardText>{s.name}</BoardText>
            </button>
          ))}
        </div>
      )}
      {audience === 'staff' && current && !current.timetablePublishedAt && (
        <Notice tone="warning" className="print:hidden">The family cannot see this series yet: its timetable is not published.</Notice>
      )}
      {id && <Statement key={id} studentId={studentId} seriesId={id} audience={audience} />}
    </div>
  );
}

function Statement({ studentId, seriesId, audience }: { studentId: string; seriesId: string; audience: Audience }) {
  const { data: s, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...EXAMS_KEY, 'student', studentId, 'statement', seriesId],
    queryFn: () => fetchStatement(studentId, seriesId),
  });
  if (isLoading) return <LoadingState label="Loading the statement…" />;
  if (isError || !s) return <ErrorState title="The statement did not load" message={error instanceof Error ? error.message : undefined} onRetry={() => refetch()} />;

  const c = s.candidate;
  const you = audience === 'self';
  const legal = c.legalSurname && c.legalForenames ? `${c.legalSurname.toUpperCase()}, ${c.legalForenames}` : null;
  const byDate = groupByDate(s.papers);

  return (
    <article className="rounded-xl border border-border bg-card p-4 text-foreground shadow-sm sm:p-6 print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black print:shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* On screen the section's heading names it; on paper this one does. */}
          <h3 className="hidden font-display text-xl font-bold print:block">Statement of entry</h3>
          <p className="font-display text-lg font-semibold"><BoardText>{s.series.name}</BoardText></p>
        </div>
        <PrintButton label="Print the statement" />
      </div>

      <Notice tone="warning" className="mt-4 print:border-black print:bg-white print:text-black">
        {you
          ? 'Check your name and your entries. If anything is wrong, tell the school at once: the board prints your certificate with exactly what is here.'
          : 'Check the name and the entries. If anything is wrong, tell the school at once: the board prints the certificate with exactly what is here.'}
      </Notice>

      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Field label="Name as on the ID">
          {legal ? <bdi data-i18n-skip="true" className="font-semibold">{legal}</bdi> : <span className="text-amber-700 dark:text-amber-400">Not recorded yet: tell the school</span>}
        </Field>
        <Field label="Date of birth"><MaybeDate date={c.dateOfBirth} /></Field>
        <Field label="Centre number">
          {s.centre.centreNumber ? <Code className="font-semibold">{s.centre.centreNumber}</Code> : <span className="text-muted-foreground">Not set yet</span>}
        </Field>
        <Field label="Candidate number">
          {c.candidateNumber ? <Code className="text-base font-semibold">{c.candidateNumber}</Code> : <span className="text-muted-foreground">Not given yet</span>}
        </Field>
        <Field label="UCI">{c.uci ? <Code>{c.uci}</Code> : <span className="text-muted-foreground">—</span>}</Field>
        <Field label="Access arrangements">
          {c.accessArrangements.length ? (
            <span className="flex flex-wrap gap-1">
              {c.accessArrangements.map((a) => <Badge key={a} tone="info">{ACCESS_ARRANGEMENT_LABELS[a as AccessArrangement] ?? a}</Badge>)}
            </span>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </Field>
      </dl>

      <h4 className="mt-6 text-sm font-semibold">Entries</h4>
      {s.entries.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">No entries in this series.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border print:border-black">
          {s.entries.map((e) => (
            <li key={e.id} className="px-3 py-2 text-sm">
              <p><Code className="font-semibold">{e.entryCode}</Code> <BoardText>{e.title}</BoardText></p>
              <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground print:text-black">
                {e.optionCode && <span><span>Option</span> <Code>{e.optionCode}</Code></span>}
                {e.tier && <span><span>Tier</span> <span>{TIER_LABELS[e.tier as Tier] ?? e.tier}</span></span>}
                {e.isRetake && <span>Retake</span>}
                {audience === 'staff' && e.status === 'draft' && <Badge tone="warning">Not sent to the board yet</Badge>}
              </p>
            </li>
          ))}
        </ul>
      )}

      <h4 className="mt-6 text-sm font-semibold">Papers</h4>
      {byDate.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">No papers on the timetable for these entries yet.</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {byDate.map(([date, list]) => (
            <li key={date} className="rounded-lg border border-border px-3 py-2 print:break-inside-avoid print:border-black">
              <p className="text-sm font-semibold"><DateText date={date} weekday long /></p>
              <ul className="mt-1 space-y-1.5">
                {list.map((p) => (
                  <li key={p.paperId} className="text-sm">
                    <p className="flex flex-wrap items-center gap-x-2">
                      <span dir="ltr" className="font-semibold tabular-nums">{p.startTime}–{p.endTime}</span>
                      <SessionBadge session={p.session} />
                      <Code>{p.code}</Code> <BoardText>{p.title}</BoardText>
                    </p>
                    {p.extraMinutes > 0 && (
                      <p className="text-xs text-muted-foreground print:text-black">
                        <span>Includes</span> <span className="tabular-nums">{p.extraMinutes}</span> <span>minutes of extra time</span>
                      </p>
                    )}
                    <RoomSeat room={p.room} seat={p.seat} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {s.clashes.length > 0 && (
        <div className="mt-4 space-y-2">
          {s.clashes.map((c) => <ClashNotice key={`${c.papers[0]!.paperId}-${c.papers[1]!.paperId}`} clash={c} audience={audience} />)}
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground print:text-black">
        <span>Printed on</span> <MaybeDate date={s.generatedOn} />
        {s.series.resultsOn && (
          <>
            {' · '}
            <span>Results day</span> <MaybeDate date={s.series.resultsOn} />
          </>
        )}
      </p>
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground print:text-black">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

// ─── Results, per series ─────────────────────────────────────────────────────

type ResultGroup = { seriesId: string; seriesName: string; latestAt: string; codes: { code: string; kind: string; reports: ResultRow[] }[] };

function Results({ results, sittings, audience }: { results: ResultRow[]; sittings: SittingRow[]; audience: Audience }) {
  const groups = useMemo(() => {
    const out: ResultGroup[] = [];
    for (const r of results) {
      let g = out.find((x) => x.seriesId === r.boardSeriesId);
      if (!g) out.push((g = { seriesId: r.boardSeriesId, seriesName: r.seriesName, latestAt: r.createdAt, codes: [] }));
      if (r.createdAt > g.latestAt) g.latestAt = r.createdAt;
      let c = g.codes.find((x) => x.code === r.code && x.kind === r.kind);
      if (!c) g.codes.push((c = { code: r.code, kind: r.kind, reports: [] }));
      c.reports.push(r); // newest first, as the API orders them
    }
    return out.sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  }, [results]);

  const titleOf = (seriesId: string, kind: string, code: string, fallback: string | null) =>
    sittings.find((s) => s.boardSeriesId === seriesId && s.kind === kind && s.code.toUpperCase() === code.toUpperCase())?.title ?? fallback;

  if (!groups.length) {
    return (
      <EmptyState
        title="No results yet"
        message={audience === 'staff'
          ? 'No results are recorded for this student yet.'
          : 'Results appear here on results day, once the school publishes them. You will get a notice.'}
      />
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.seriesId} className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="font-semibold text-foreground"><BoardText>{g.seriesName}</BoardText></h3>
          <ul className="mt-2 divide-y divide-border">
            {g.codes.map((c) => {
              const [latest, ...earlier] = c.reports;
              return (
                <li key={`${c.kind}-${c.code}`} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">
                      <Code className="font-semibold">{c.code}</Code> <BoardText>{titleOf(g.seriesId, c.kind, c.code, latest!.title) ?? ''}</BoardText>
                    </p>
                    {earlier.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        <span>The board changed this grade. Earlier:</span>{' '}
                        {earlier.map((e) => <s key={e.id} className="me-1"><bdi data-i18n-skip="true" dir="ltr">{e.grade}</bdi></s>)}
                      </p>
                    )}
                    {latest!.attempts > 1 && (
                      <p className="text-xs text-muted-foreground">
                        <span className="tabular-nums">{latest!.attempts}</span> <span>attempts at this code; each is kept</span>
                      </p>
                    )}
                    {audience === 'staff' && latest!.status !== 'published' && <Badge tone="warning">Not published to the family yet</Badge>}
                  </div>
                  <p className="shrink-0 text-end">
                    <bdi data-i18n-skip="true" dir="ltr" className="text-2xl font-bold text-foreground">{latest!.grade}</bdi>
                    {latest!.mark !== null && (
                      <span className="block text-xs text-muted-foreground"><span>Mark</span> <span className="tabular-nums" dir="ltr">{latest!.mark}</span></span>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {audience !== 'staff' && (
        <p className="text-xs text-muted-foreground">
          Certificates arrive some months after results. The school tells you when to collect them from the office: bring an ID.
        </p>
      )}
    </div>
  );
}
