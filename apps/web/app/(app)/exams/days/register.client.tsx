'use client';

/**
 * The board's attendance register for one paper (docs/features/EXAM_ENTRIES.md
 * §4, "The boards' attendance registers").
 *
 * The paper version: the coordinator copies the board's register form by hand
 * for each room — centre number, series, paper, date, start — and lists the
 * candidates in candidate-number order from the entries sheet, with their
 * desk and access arrangements looked up one by one.
 *
 * Here: the register is built from the entries and the seating plan, one page
 * per room, in candidate-number order, with the name as on the ID, the desk,
 * the access arrangements, what the invigilators recorded on their tablet,
 * and empty columns to mark and sign on paper. Print it as it is.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ATTENDANCE_STATUS_LABELS } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { DateText } from '../../academic/calendar/academic-shared';
import { fetchRegister, SessionBadge, BoardText, Code, PrintButton, EXAMS_KEY, type RegisterData } from '../exam-f4-shared';
import { ArrangementBadges, Minutes, Name, TimeSpan, endOf } from '../timetable/timetable-shared';

type Row = RegisterData['rows'][number];

export function RegisterSheet({ paperId, roomId, onClose }: { paperId: string; roomId: string | null; onClose: () => void }): React.JSX.Element {
  const q = useQuery({ queryKey: [...EXAMS_KEY, 'register', paperId, roomId ?? 'all'], queryFn: () => fetchRegister(paperId, roomId ?? undefined) });
  const groups = useMemo(() => {
    const out = new Map<string, { roomName: string | null; rows: Row[] }>();
    for (const r of q.data?.rows ?? []) {
      const k = r.roomId ?? '';
      if (!out.has(k)) out.set(k, { roomName: r.roomName, rows: [] });
      out.get(k)!.rows.push(r);
    }
    // Candidates without a desk come last, on their own page.
    return [...out.entries()].sort(([a], [b]) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0)).map(([, g]) => g);
  }, [q.data]);

  return (
    <div className="mt-8 print:mt-0">
      {/* One page per room in print: globals.css prints the app shell as plain blocks. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h3 className="font-display text-lg font-bold text-foreground">The board&apos;s attendance register</h3>
        <span className="flex gap-2">
          <PrintButton label="Print the register" />
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </span>
      </div>
      {q.isLoading ? (
        <LoadingState label="Loading the register…" />
      ) : q.isError || !q.data ? (
        <ErrorState title="The register did not load" message={q.error?.message} onRetry={() => q.refetch()} />
      ) : !q.data.rows.length ? (
        <p className="rounded-xl border border-border bg-background p-6 text-center text-sm text-muted-foreground">No candidate sits this paper in this room.</p>
      ) : (
        groups.map((g, i) => (
          <RegisterPage key={g.roomName ?? 'none'} data={q.data!} roomName={g.roomName} rows={g.rows} last={i === groups.length - 1} />
        ))
      )}
    </div>
  );
}

function RegisterPage({ data, roomName, rows, last }: { data: RegisterData; roomName: string | null; rows: Row[]; last: boolean }) {
  const p = data.paper;
  const counts = { present: 0, absent: 0, late: 0 };
  for (const r of rows) if (r.mark) counts[r.mark.status as keyof typeof counts] += 1;
  return (
    <article
      className="mb-8 rounded-xl border border-border bg-card p-5 text-foreground shadow-sm print:mb-0 print:rounded-none print:border-0 print:p-0 print:shadow-none"
      style={{ breakAfter: last ? 'auto' : 'page' }}
    >
      <div className="mb-4 border-b border-border pb-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attendance register</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-lg font-bold">
          <Code>{p.code}</Code>
          <BoardText>{p.title}</BoardText>
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div className="flex gap-2"><dt className="text-muted-foreground">Centre number</dt><dd className="font-semibold">{data.centreNumber ? <Code>{data.centreNumber}</Code> : <span className="text-amber-700 dark:text-amber-400">Not set (Settings)</span>}</dd></div>
          <div className="flex gap-2"><dt className="text-muted-foreground">Series</dt><dd className="font-semibold"><BoardText>{data.series.name}</BoardText></dd></div>
          <div className="flex gap-2"><dt className="text-muted-foreground">Room</dt><dd className="font-semibold">{roomName ? <Name>{roomName}</Name> : <span className="text-amber-700 dark:text-amber-400">No seat yet</span>}</dd></div>
          <div className="flex gap-2"><dt className="text-muted-foreground">Date</dt><dd className="font-semibold"><DateText date={p.examDate} weekday long /></dd></div>
          <div className="flex items-center gap-2"><dt className="text-muted-foreground">Time of day</dt><dd><SessionBadge session={p.session} /></dd></div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Start</dt>
            <dd className="font-semibold"><TimeSpan start={p.startTime} end={endOf(p.startTime, p.durationMinutes)} /> <span className="font-normal text-muted-foreground">(<Minutes n={p.durationMinutes} />)</span></dd>
          </div>
        </dl>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-foreground/60">
            <th scope="col" className="w-10 px-2 py-2 text-start font-semibold">#</th>
            <th scope="col" className="px-2 py-2 text-start font-semibold">Candidate number</th>
            <th scope="col" className="px-2 py-2 text-start font-semibold">Name as on ID</th>
            <th scope="col" className="px-2 py-2 text-start font-semibold">Seat</th>
            <th scope="col" className="px-2 py-2 text-start font-semibold">Access arrangements</th>
            <th scope="col" className="w-32 px-2 py-2 text-start font-semibold">Present / absent</th>
            <th scope="col" className="w-40 px-2 py-2 text-start font-semibold">Signature</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.studentId} className="border-b border-border">
              <td className="px-2 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
              <td className="px-2 py-2.5 font-mono text-base font-bold">{r.candidateNumber ?? <span className="text-amber-700 dark:text-amber-400">—</span>}</td>
              <td className="px-2 py-2.5">
                <Name className="font-semibold">{r.legalName ?? r.name}</Name>
                {!r.legalName && <p className="text-xs text-amber-700 print:hidden dark:text-amber-400">No legal name as on ID</p>}
              </td>
              <td className="px-2 py-2.5 font-mono font-semibold" dir="ltr">{r.seatLabel ?? '—'}</td>
              <td className="px-2 py-2.5">{r.accessArrangements.length ? <ArrangementBadges list={r.accessArrangements} /> : <span className="text-muted-foreground">—</span>}</td>
              <td className="px-2 py-2.5">
                {r.mark ? (
                  <span className="font-semibold">
                    <span>{ATTENDANCE_STATUS_LABELS[r.mark.status as keyof typeof ATTENDANCE_STATUS_LABELS] ?? r.mark.status}</span>
                    {r.mark.status === 'late' && r.mark.minutesLate ? <> <Minutes n={r.mark.minutesLate} /></> : null}
                  </span>
                ) : null}
              </td>
              <td className="px-2 py-2.5" />
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <p><span className="text-muted-foreground">Candidates</span> <span className="font-semibold tabular-nums">{rows.length}</span></p>
        <p><span className="text-muted-foreground">Present</span> <span className="font-semibold tabular-nums">{counts.present}</span></p>
        <p><span className="text-muted-foreground">Late</span> <span className="font-semibold tabular-nums">{counts.late}</span></p>
        <p><span className="text-muted-foreground">Absent</span> <span className="font-semibold tabular-nums">{counts.absent}</span></p>
      </div>
      <div className="mt-8 grid gap-6 text-sm sm:grid-cols-2">
        <p className="border-t border-foreground/60 pt-1 text-muted-foreground">Invigilator&apos;s name</p>
        <p className="border-t border-foreground/60 pt-1 text-muted-foreground">Invigilator&apos;s signature</p>
      </div>
    </article>
  );
}
