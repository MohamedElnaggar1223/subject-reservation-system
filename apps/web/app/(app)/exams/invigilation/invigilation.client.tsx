'use client';

/**
 * My invigilation (docs/features/EXAM_ENTRIES.md §4, "Invigilators" and "The
 * boards' attendance registers").
 *
 * The paper version: the invigilation rota is a sheet on the staffroom wall;
 * in the room the invigilator is handed the board's printed register, ticks
 * each candidate present, writes "absent" or the minutes late by hand, signs
 * it, and it goes back to the exams office to be typed up — the day's absences
 * reach the coordinator hours later, if the sheet is legible.
 *
 * Here: the teacher sees only their own duties (date, session, room, papers,
 * how many candidates, whether they lead). Opening one shows the register of
 * their room for each paper, in candidate-number order with the desk and the
 * access arrangements. One tap marks everyone present; then a tap on a
 * candidate marks them absent or late (minutes in one more tap); Save
 * records it at once for the coordinator. Big buttons, one column on a
 * phone. Another room's register is refused by the API, whose sentence is
 * shown as it is.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, schoolDateString, type MarkRegisterType } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { DateText } from '../../academic/calendar/academic-shared';
import { fetchMyDuties, fetchRegister, SessionBadge, BoardText, Code, EXAMS_KEY, type DutiesData, type RegisterData } from '../exam-f4-shared';
import { ArrangementBadges, Minutes, Name, TimeSpan, endOf, useAddress } from '../timetable/timetable-shared';

type Duty = DutiesData['duties'][number];
type Status = 'present' | 'absent' | 'late';
type Mark = { status: Status; minutes: string };

const dutyParam = (d: { examDate: string; session: string; roomId: string }) => `${d.examDate}.${d.session}.${d.roomId}`;
function parseDuty(v: string | null) {
  if (!v) return null;
  const [examDate, session, ...rest] = v.split('.');
  const roomId = rest.join('.');
  if (!examDate || !session || !roomId) return null;
  return { examDate, session, roomId };
}

export default function InvigilationClient(): React.JSX.Element {
  const q = useQuery({ queryKey: [...EXAMS_KEY, 'duties'], queryFn: fetchMyDuties, retry: false });
  const address = useAddress();
  const chosen = parseDuty(address.get('duty'));
  const duty = chosen ? q.data?.duties.find((d) => dutyParam(d) === dutyParam(chosen)) : undefined;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 animate-fade-up sm:px-6 sm:py-8">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">My invigilation</h1>
        {q.data && <p className="mt-1 text-sm text-muted-foreground"><Name className="font-medium text-foreground">{q.data.teacher.name}</Name></p>}
      </div>

      {q.isLoading ? (
        <LoadingState label="Loading your duties…" />
      ) : q.isError || !q.data ? (
        <Notice tone="warning" title="Your duties cannot be shown">
          <p>{q.error?.message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => q.refetch()}>Try again</Button>
        </Notice>
      ) : chosen ? (
        <DutyView
          duty={duty}
          roomId={chosen.roomId}
          examDate={chosen.examDate}
          session={chosen.session}
          paperId={address.get('paper')}
          onPaper={(id) => address.set({ paper: id })}
          onBack={() => address.set({ duty: null, paper: null })}
        />
      ) : !q.data.duties.length ? (
        <Notice tone="info" title="No invigilation duties">
          The exams office has not put you in a room for any sitting from yesterday on. Your duties show here when it does.
        </Notice>
      ) : (
        <ul className="space-y-3">
          {q.data.duties.map((d) => (
            <li key={dutyParam(d)}>
              <DutyCard d={d} onOpen={() => address.set({ duty: dutyParam(d), paper: d.papers[0]?.id ?? null })} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DutyCard({ d, onOpen }: { d: Duty; onOpen: () => void }) {
  const today = d.examDate === schoolDateString(new Date());
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full flex-col gap-2 rounded-2xl border bg-card p-4 text-start shadow-sm outline-none transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:p-5',
        today ? 'border-primary ring-2 ring-primary' : 'border-border',
      )}
    >
      <span className="flex flex-wrap items-center gap-2">
        <DateText date={d.examDate} weekday long className="text-lg font-bold text-foreground" />
        <SessionBadge session={d.session} />
        {today && <Badge tone="success">Today</Badge>}
        {d.isLead && <Badge tone="info">Lead invigilator</Badge>}
      </span>
      <span className="text-base font-semibold text-foreground"><Name>{d.roomName}</Name></span>
      <span className="flex flex-col gap-1 text-sm">
        {d.papers.map((p) => (
          <span key={p.id} className="flex flex-wrap items-center gap-2">
            <Code className="font-semibold text-foreground">{p.code}</Code>
            <BoardText className="text-muted-foreground">{p.title}</BoardText>
            <TimeSpan start={p.startTime} end={endOf(p.startTime, p.durationMinutes)} className="text-foreground" />
          </span>
        ))}
      </span>
      <span className="text-sm text-muted-foreground"><span className="tabular-nums font-semibold text-foreground">{d.candidates}</span> <span>candidates in your room</span></span>
    </button>
  );
}

function DutyView({ duty, roomId, examDate, session, paperId, onPaper, onBack }: {
  duty: Duty | undefined; roomId: string; examDate: string; session: string; paperId: string | null; onPaper: (id: string) => void; onBack: () => void;
}) {
  const papers = duty?.papers ?? [];
  const current = paperId ?? papers[0]?.id ?? null;
  return (
    <div>
      <Button variant="outline" className="mb-4 h-11" onClick={onBack}>All my duties</Button>
      <div className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="flex flex-wrap items-center gap-2">
          <DateText date={examDate} weekday long className="text-lg font-bold text-foreground" />
          <SessionBadge session={session} />
          {duty?.isLead && <Badge tone="info">Lead invigilator</Badge>}
        </p>
        {duty && <p className="mt-1 text-base font-semibold text-foreground"><Name>{duty.roomName}</Name></p>}
      </div>
      {papers.length > 1 && (
        <div role="tablist" aria-label="Papers" className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {papers.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={current === p.id}
              onClick={() => onPaper(p.id)}
              className={cn(
                'flex min-h-14 flex-col items-start justify-center rounded-xl border px-4 py-2 text-start outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                current === p.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-accent',
              )}
            >
              <span className="flex items-center gap-2 font-semibold"><Code>{p.code}</Code> <TimeSpan start={p.startTime} end={endOf(p.startTime, p.durationMinutes)} /></span>
              <span className="text-xs opacity-80"><span className="tabular-nums">{p.candidates}</span> <span>candidates</span></span>
            </button>
          ))}
        </div>
      )}
      {/* Every paper's register stays mounted, so marks not yet saved survive a switch between papers. */}
      {current && !papers.some((p) => p.id === current) && <RegisterMarker key={`${current}-${roomId}`} paperId={current} roomId={roomId} />}
      {papers.map((p) => (
        <div key={p.id} hidden={p.id !== current}>
          <RegisterMarker paperId={p.id} roomId={roomId} />
        </div>
      ))}
      {!current && <Notice tone="info">No candidate in this room sits a paper yet.</Notice>}
    </div>
  );
}

function RegisterMarker({ paperId, roomId }: { paperId: string; roomId: string }) {
  const q = useQuery({
    queryKey: [...EXAMS_KEY, 'register', paperId, roomId],
    queryFn: () => fetchRegister(paperId, roomId),
    retry: false,
    // Marks being taken on the tablet are not overwritten by a refetch when the screen wakes.
    refetchOnWindowFocus: false,
  });
  if (q.isLoading) return <LoadingState label="Loading the register…" />;
  if (q.isError || !q.data) {
    return (
      <Notice tone="danger" title="The register cannot be shown">
        <p>{q.error?.message}</p>
      </Notice>
    );
  }
  return <MarkForm key={q.dataUpdatedAt} data={q.data} />;
}

function MarkForm({ data }: { data: RegisterData }) {
  const queryClient = useQueryClient();
  const initial: Record<string, Mark> = Object.fromEntries(
    data.rows.filter((r) => r.mark).map((r) => [r.studentId, { status: r.mark!.status as Status, minutes: r.mark!.minutesLate ? String(r.mark!.minutesLate) : '' }]),
  );
  const [marks, setMarks] = useState<Record<string, Mark>>(initial);
  const [error, setError] = useState('');
  const dirty = JSON.stringify(marks) !== JSON.stringify(initial);
  const lateWithout = data.rows.filter((r) => marks[r.studentId]?.status === 'late' && !(Number(marks[r.studentId]!.minutes) >= 1));
  const count = (s: Status) => data.rows.filter((r) => marks[r.studentId]?.status === s).length;
  const unmarked = data.rows.filter((r) => !marks[r.studentId]).length;

  const save = useMutation({
    mutationFn: () => {
      const json: MarkRegisterType = {
        paperId: data.paper.id,
        marks: data.rows.filter((r) => marks[r.studentId]).map((r) => {
          const m = marks[r.studentId]!;
          return { studentId: r.studentId, status: m.status, minutesLate: m.status === 'late' ? Number(m.minutes) : null };
        }),
      };
      return apiResponse(api.v1.exams.registers.$put({ json }));
    },
    // The refetched register (what the API recorded) replaces this form, and its count shows below.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...EXAMS_KEY, 'register', data.paper.id] }),
    onError: (err: Error) => setError(err.message),
  });

  const set = (studentId: string, m: Mark | null) => {
    setError('');
    setMarks((prev) => {
      const next = { ...prev };
      if (m) next[studentId] = m;
      else delete next[studentId];
      return next;
    });
  };
  const allPresent = () => {
    setError('');
    setMarks(Object.fromEntries(data.rows.map((r) => [r.studentId, { status: 'present' as Status, minutes: '' }])));
  };

  return (
    <div className="pb-28">
      <div className="mb-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="flex flex-wrap items-center gap-2 text-base">
          <Code className="font-bold text-foreground">{data.paper.code}</Code>
          <BoardText className="text-foreground">{data.paper.title}</BoardText>
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <TimeSpan start={data.paper.startTime} end={endOf(data.paper.startTime, data.paper.durationMinutes)} className="font-semibold text-foreground" />
          <span>(<Minutes n={data.paper.durationMinutes} />)</span>
          <span>·</span>
          <span><span>Centre</span> {data.centreNumber ? <Code>{data.centreNumber}</Code> : <span>—</span>}</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Extra time is each candidate&apos;s own: see their access arrangements.</p>
      </div>

      {data.rows.length === 0 ? (
        <Notice tone="info">No candidate sits this paper in your room.</Notice>
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button className="h-14 text-base sm:w-56" onClick={allPresent}>All present</Button>
            <p className="flex flex-wrap gap-2 text-sm">
              <Badge tone="success"><span>Present</span>&nbsp;<span className="tabular-nums">{count('present')}</span></Badge>
              <Badge tone="danger"><span>Absent</span>&nbsp;<span className="tabular-nums">{count('absent')}</span></Badge>
              <Badge tone="warning"><span>Late</span>&nbsp;<span className="tabular-nums">{count('late')}</span></Badge>
              {unmarked > 0 && <Badge tone="neutral"><span>Not marked</span>&nbsp;<span className="tabular-nums">{unmarked}</span></Badge>}
            </p>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">Then tap a candidate&apos;s Absent or Late, and save.</p>

          <ul className="space-y-3">
            {data.rows.map((r) => (
              <CandidateRow key={r.studentId} r={r} mark={marks[r.studentId] ?? null} onMark={(m) => set(r.studentId, m)} />
            ))}
          </ul>
        </>
      )}

      {data.rows.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur sm:sticky sm:mt-6 sm:rounded-2xl sm:border">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 text-sm">
              {error ? (
                <p className="font-medium text-red-700 dark:text-red-400">{error}</p>
              ) : lateWithout.length > 0 ? (
                <p className="text-amber-700 dark:text-amber-400">Say how many minutes late for each late candidate.</p>
              ) : dirty ? (
                <p className="text-muted-foreground">Not saved yet.</p>
              ) : data.marked > 0 ? (
                <p className="text-emerald-700 dark:text-emerald-400">
                  <span>Saved:</span> <span className="tabular-nums">{data.marked}</span> <span>of</span> <span className="tabular-nums">{data.rows.length}</span> <span>candidates marked.</span>
                </p>
              ) : (
                <p className="text-muted-foreground">Nothing marked yet.</p>
              )}
            </div>
            <Button className="h-12 min-w-40 text-base" onClick={() => save.mutate()} disabled={!dirty || lateWithout.length > 0 || save.isPending || !Object.keys(marks).length}>
              {save.isPending ? 'Saving…' : 'Save the register'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const LATE_MINUTES = [5, 10, 15, 20, 30, 45];

function CandidateRow({ r, mark, onMark }: { r: RegisterData['rows'][number]; mark: Mark | null; onMark: (m: Mark | null) => void }) {
  const choose = (status: Status) => {
    if (mark?.status === status) return onMark(null);
    onMark({ status, minutes: status === 'late' ? mark?.minutes ?? '' : '' });
  };
  const tone = mark?.status === 'absent' ? 'border-red-300 dark:border-red-800' : mark?.status === 'late' ? 'border-amber-300 dark:border-amber-700' : mark?.status === 'present' ? 'border-emerald-300 dark:border-emerald-800' : 'border-border';
  return (
    <li className={cn('rounded-2xl border-2 bg-card p-3 shadow-sm sm:p-4', tone)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="font-mono text-2xl font-bold text-foreground">{r.candidateNumber ?? '—'}</span>
          <span className="min-w-0">
            <Name className="block truncate text-base font-semibold text-foreground">{r.legalName ?? r.name}</Name>
            <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span><span>Seat</span> <span className="font-mono font-semibold text-foreground" dir="ltr">{r.seatLabel ?? '—'}</span></span>
            </span>
            <ArrangementBadges list={r.accessArrangements} className="mt-1" />
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:w-80">
          <StatusButton active={mark?.status === 'present'} tone="present" onClick={() => choose('present')}>Present</StatusButton>
          <StatusButton active={mark?.status === 'absent'} tone="absent" onClick={() => choose('absent')}>Absent</StatusButton>
          <StatusButton active={mark?.status === 'late'} tone="late" onClick={() => choose('late')}>Late</StatusButton>
        </div>
      </div>
      {mark?.status === 'late' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-sm text-muted-foreground">Minutes late</span>
          {LATE_MINUTES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onMark({ status: 'late', minutes: String(n) })}
              aria-pressed={mark.minutes === String(n)}
              className={cn(
                'h-11 min-w-12 rounded-lg border px-3 text-base font-semibold tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                mark.minutes === String(n) ? 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 'border-border bg-background text-foreground hover:bg-accent',
              )}
            >
              {n}
            </button>
          ))}
          <Input
            aria-label="Minutes late"
            dir="ltr"
            inputMode="numeric"
            value={mark.minutes}
            onChange={(e) => onMark({ status: 'late', minutes: e.target.value.replace(/[^\d]/g, '').slice(0, 3) })}
            className="h-11 w-20 text-base tabular-nums"
          />
        </div>
      )}
    </li>
  );
}

function StatusButton({ active, tone, onClick, children }: { active: boolean; tone: Status; onClick: () => void; children: React.ReactNode }) {
  const on = {
    present: 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
    absent: 'border-red-500 bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    late: 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-12 rounded-xl border-2 px-2 text-base font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? on : 'border-border bg-background text-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}
