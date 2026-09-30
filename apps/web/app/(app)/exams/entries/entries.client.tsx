'use client';

/**
 * Exam entries (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §2).
 *
 * The spreadsheet version: a sheet per series, one row per student per
 * subject, typed by hand from the confirmed-registration list; the option
 * code looked up in each syllabus PDF and typed beside it; a "sent?" column
 * ticked after the rows are keyed into the board's portal; a withdrawal
 * struck through, with the fee looked up in the handbook and written in a
 * comment; forecast grades chased from teachers by email and pasted in; and
 * nothing that says a row is missing the tier or the option until the board
 * refuses it.
 *
 * Here: the entries are derived from the confirmed registrations in one
 * click, with a preview that says what each registration enters and what it
 * cannot; each entry carries its option code as a choice of the syllabus's
 * own codes (saved as it changes), and beside it what the board would
 * refuse today. Rows are ticked per entry, per candidate or all, and marked
 * as sent or withdrawn together; the board's fee for a withdrawal or a
 * change after sending is worked out from its rules and the series' dates,
 * and shown before and after. A change to a sent entry asks why (an
 * amendment). Past the entry deadline nothing new is made — the screen says
 * so at the top instead of letting a late entry through.
 */

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, LoadingState } from '~/components/ui/query-state';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/tone';
import { EXAMS_KEY, SeriesSelect, fetchCandidate, useSeriesChoice, type BoardSeriesRow } from '../exam-f4-shared';
import { SeriesDeadlineStatus } from './entries-shared';
import { DerivePanel } from './derive.client';
import { AddEntryPanel } from './add-entry.client';
import { EntriesTable } from './entries-table.client';

export default function EntriesClient(): React.JSX.Element {
  const { series, chosen, choose, isLoading } = useSeriesChoice();
  const params = useSearchParams();
  const studentId = params.get('student');

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 animate-fade-up">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Exam entries</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            What each candidate is entered for with the board in a series, made from the confirmed registrations. Tick entries to mark them as sent to the board or to withdraw them; each row says what the board would refuse.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <SeriesSelect series={series} value={chosen?.id} onChange={choose} />
          {chosen && (
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/exams/entry-lists?series=${chosen.id}` as Route}>The board&apos;s entry list</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/exams/forecasts?series=${chosen.id}` as Route}>Forecast grades</Link>
              </Button>
            </div>
          )}
        </div>
      </header>

      {isLoading ? (
        <LoadingState label="Loading the series…" />
      ) : !chosen ? (
        <EmptyState
          title="No board series yet"
          message="Entries belong to a board series. Add the boards' sittings on the Board series page first; the entries of each come from its confirmed registrations."
          action={<Button asChild variant="outline"><Link href="/exams/series">Board series</Link></Button>}
        />
      ) : (
        <>
          {studentId && <StudentBanner studentId={studentId} current={chosen} all={series} onChoose={choose} />}
          <SeriesDeadlineStatus series={chosen} />
          <DerivePanel key={`derive-${chosen.id}-${studentId ?? ''}`} series={chosen} studentId={studentId} />
          <AddEntryPanel key={`add-${chosen.id}-${studentId ?? ''}`} series={chosen} studentId={studentId} />
          <EntriesTable key={`table-${chosen.id}-${studentId ?? ''}`} series={chosen} studentId={studentId} />
        </>
      )}
    </div>
  );
}

/** One candidate's entries: their name, the way back, and the other series they are entered in. */
function StudentBanner({ studentId, current, all, onChoose }: { studentId: string; current: BoardSeriesRow; all: BoardSeriesRow[]; onChoose: (id: string) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data, isError } = useQuery({ queryKey: [...EXAMS_KEY, 'candidate', studentId], queryFn: () => fetchCandidate(studentId) });
  const back = () => {
    const next = new URLSearchParams(params.toString());
    next.delete('student');
    router.replace(`${pathname}?${next.toString()}` as Route, { scroll: false });
  };
  const elsewhere = [...new Set((data?.entriesBySeries ?? []).filter((e) => e.status !== 'withdrawn').map((e) => e.boardSeriesId))]
    .filter((id) => id !== current.id)
    .map((id) => all.find((s) => s.id === id))
    .filter((s): s is BoardSeriesRow => !!s);

  return (
    <Notice
      tone="info"
      className="mb-6"
      title={
        <span className="flex flex-wrap items-center gap-x-2">
          <span>Only one candidate:</span>
          <bdi data-i18n-skip="true">{data?.student.name ?? '…'}</bdi>
        </span>
      }
    >
      {isError && <p>This candidate could not be found. Go back to every candidate in the series.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={back}>Every candidate in the series</Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/exams/candidates?series=${current.id}&student=${studentId}` as Route}>Candidate details</Link>
        </Button>
      </div>
      {elsewhere.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span>Also entered in</span>
          {elsewhere.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onChoose(s.id)}
              className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-accent"
            >
              <bdi data-i18n-skip="true">{s.name}</bdi>
            </button>
          ))}
        </div>
      )}
    </Notice>
  );
}
