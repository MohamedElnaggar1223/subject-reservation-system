'use client';

/**
 * Exam days (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §4).
 *
 * The spreadsheet version: for each morning and afternoon of the exam season
 * the coordinator counts who sits what from the entries sheet, draws the
 * hall on squared paper and writes a candidate number in each desk, copies
 * the board's attendance register by hand per paper and per room, pins a rota
 * of invigilators on the staffroom wall (and counts on a calculator whether
 * each room has enough), and keeps special consideration requests in an
 * email folder. When a candidate is added or moves, the drawing, the register
 * and the rota are all redone, and two candidates can end up on one desk.
 *
 * Here: every sitting (a date and session, across boards) is one card saying
 * how many candidates, how many seated and whether each room has its
 * invigilators. Opening one: pick the rooms and their grids, "Seat everyone"
 * places candidates of one paper together in candidate-number order (a
 * preview first), a candidate is moved with two clicks, the database refuses
 * a desk for two (the refusal names who sits there), invigilators are chosen
 * per room with the lead, and each paper's board register prints per room in
 * candidate-number order with a column to mark and sign. Nothing is copied by
 * hand, and nothing has to be remembered: the card says what is missing.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '~/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '~/components/ui/query-state';
import { Badge, Notice } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { DateText } from '../../academic/calendar/academic-shared';
import {
  fetchSittingPlan, fetchSittings, useSeriesChoice, SeriesSelect, SessionBadge, BoardText, Code, EXAMS_KEY,
  type SittingsData, type SittingPlan,
} from '../exam-f4-shared';
import { Minutes, Name, TimeSpan, endOf, parseSitting, sittingParam, useAddress } from '../timetable/timetable-shared';
import { RoomsEditor, SeatingSection } from './seating.client';
import { RegisterSheet } from './register.client';
import { SpecialConsideration } from './special.client';

type Sitting = SittingsData['sittings'][number];

export default function DaysClient(): React.JSX.Element {
  const { series, chosen, choose, isLoading: seriesLoading } = useSeriesChoice();
  const address = useAddress();
  const range = address.get('range') === 'next' ? 'next' : 'series';
  const sitting = parseSitting(address.get('sitting'));
  const seriesId = chosen?.id ?? '';
  const q = useQuery({
    queryKey: [...EXAMS_KEY, 'sittings', range === 'next' ? 'next-60-days' : seriesId],
    queryFn: () => fetchSittings(range === 'next' ? {} : { boardSeriesId: seriesId }),
    enabled: range === 'next' || !!seriesId,
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const sittingKey = sitting ? sittingParam(sitting.examDate, sitting.session) : null;
  useEffect(() => {
    if (sittingKey) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [sittingKey]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 animate-fade-up">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Exam days</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Each sitting is a date and session across every board: its rooms, who sits where, its invigilators and the boards&apos; attendance registers. Open one to seat it.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div role="group" aria-label="Which sittings" className="flex gap-1">
            <Button variant={range === 'series' ? 'default' : 'outline'} onClick={() => address.set({ range: null, sitting: null, register: null, room: null })} aria-pressed={range === 'series'}>
              This series
            </Button>
            <Button variant={range === 'next' ? 'default' : 'outline'} onClick={() => address.set({ range: 'next', sitting: null, register: null, room: null })} aria-pressed={range === 'next'}>
              Next 60 days
            </Button>
          </div>
          <SeriesSelect series={series} value={chosen?.id} onChange={(id) => { choose(id); }} />
        </div>
      </div>

      <div className="print:hidden">
        {seriesLoading || q.isLoading ? (
          <LoadingState label="Loading the sittings…" />
        ) : range === 'series' && !chosen ? (
          <EmptyState title="No board series yet" message="Add the board's series on the Board series screen, then its timetable on the Exam timetable screen." />
        ) : q.isError || !q.data ? (
          <ErrorState title="The sittings did not load" message={q.error?.message ?? 'This is a connection problem, not an empty list. Try again.'} onRetry={() => q.refetch()} />
        ) : !q.data.sittings.length ? (
          <EmptyState
            title={range === 'next' ? 'No exams in the next 60 days' : 'No papers in this series yet'}
            message="Sittings come from the exam timetable: paste the board's timetable on the Exam timetable screen first."
          />
        ) : (
          <SittingList data={q.data} chosenKey={sittingKey} onChoose={(s) => address.set({ sitting: sittingParam(s.examDate, s.session), register: null, room: null })} />
        )}
      </div>

      <div ref={panelRef} className="scroll-mt-4">
        {sitting && (
          <SittingPanel
            key={sittingKey}
            examDate={sitting.examDate}
            session={sitting.session}
            onClose={() => address.set({ sitting: null, register: null, room: null })}
          />
        )}
      </div>

      {chosen && (
        <div className="print:hidden">
          <SpecialConsideration key={chosen.id} series={chosen} />
        </div>
      )}
    </div>
  );
}

// ─── The sittings ────────────────────────────────────────────────────────────

function SittingList({ data, chosenKey, onChoose }: { data: SittingsData; chosenKey: string | null; onChoose: (s: Sitting) => void }) {
  return (
    <div className="mb-8">
      <p className="mb-3 text-xs text-muted-foreground">
        <span>One invigilator for every</span> <span className="tabular-nums">{data.candidatesPerInvigilator}</span> <span>candidates in a room (Settings).</span>
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.sittings.map((s) => (
          <li key={sittingParam(s.examDate, s.session)}>
            <SittingCard s={s} chosen={chosenKey === sittingParam(s.examDate, s.session)} onChoose={() => onChoose(s)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SittingCard({ s, chosen, onChoose }: { s: Sitting; chosen: boolean; onChoose: () => void }) {
  const unseated = s.candidates - s.seated;
  const short = s.rooms.filter((r) => r.invigilators < r.invigilatorsNeeded);
  const capacity = s.rooms.reduce((n, r) => n + r.capacity, 0);
  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={chosen}
      className={cn(
        'flex h-full w-full flex-col gap-2 rounded-xl border bg-card p-4 text-start shadow-sm outline-none transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        chosen ? 'border-primary ring-2 ring-primary' : 'border-border',
      )}
    >
      <span className="flex flex-wrap items-center gap-2">
        <DateText date={s.examDate} weekday long className="font-semibold text-foreground" />
        <SessionBadge session={s.session} />
      </span>
      <span className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {s.papers.map((p) => (
          <span key={p.id} className="flex flex-wrap items-center gap-1">
            <Code className="font-semibold text-foreground">{p.code}</Code>
            <BoardText className="truncate">{p.boardName}</BoardText>
            <span>·</span>
            <span dir="ltr" className="tabular-nums">{p.startTime}</span>
            <span>·</span>
            <span className="tabular-nums">{p.candidates}</span>
          </span>
        ))}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge tone="neutral"><span className="tabular-nums">{s.candidates}</span>&nbsp;<span>candidates</span></Badge>
        {s.candidates > 0 && (
          unseated > 0
            ? <Badge tone="warning"><span className="tabular-nums">{unseated}</span>&nbsp;<span>without a seat</span></Badge>
            : <Badge tone="success">Everyone seated</Badge>
        )}
        {s.candidates > 0 && !s.rooms.length && <Badge tone="warning">No rooms yet</Badge>}
        {s.rooms.length > 0 && capacity < s.candidates && <Badge tone="danger">Not enough seats</Badge>}
      </span>
      {s.rooms.length > 0 && (
        <span className="flex flex-col gap-0.5 text-xs">
          {s.rooms.map((r) => (
            <span key={r.roomId} className="flex flex-wrap items-center gap-1 text-muted-foreground">
              <Name className="font-medium text-foreground">{r.name}</Name>
              <span>·</span>
              <span><span className="tabular-nums">{r.seated}</span>/<span className="tabular-nums">{r.capacity}</span> <span>seats</span></span>
              <span>·</span>
              <span className={cn(r.invigilators < r.invigilatorsNeeded && 'font-semibold text-amber-700 dark:text-amber-400')}>
                <span className="tabular-nums">{r.invigilators}</span> <span>of</span> <span className="tabular-nums">{r.invigilatorsNeeded}</span> <span>invigilators</span>
              </span>
            </span>
          ))}
        </span>
      )}
      {short.length > 0 && <Badge tone="warning" className="self-start">Invigilators missing</Badge>}
    </button>
  );
}

// ─── One sitting ─────────────────────────────────────────────────────────────

function SittingPanel({ examDate, session, onClose }: { examDate: string; session: SittingPlan['sitting']['session']; onClose: () => void }) {
  const address = useAddress();
  const q = useQuery({ queryKey: [...EXAMS_KEY, 'plan', examDate, session], queryFn: () => fetchSittingPlan(examDate, session) });
  const registerPaper = address.get('register');
  const registerRoom = address.get('room');

  return (
    <section className="mb-10 rounded-2xl border border-primary/30 bg-card p-5 shadow-sm print:border-0 print:p-0 print:shadow-none" aria-labelledby="sitting-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h2 id="sitting-title" className="flex flex-wrap items-center gap-2 font-display text-xl font-bold text-foreground">
            <DateText date={examDate} weekday long />
            <SessionBadge session={session} />
          </h2>
          {q.data && (
            <ul className="mt-2 space-y-0.5 text-sm">
              {q.data.papers.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <Code className="font-semibold text-foreground">{p.code}</Code>
                  <BoardText className="text-foreground">{p.title}</BoardText>
                  <TimeSpan start={p.startTime} end={endOf(p.startTime, p.durationMinutes)} className="text-muted-foreground" />
                  <span className="text-muted-foreground">(<Minutes n={p.durationMinutes} />)</span>
                  <Badge tone="neutral"><span className="tabular-nums">{p.candidates}</span>&nbsp;<span>candidates</span></Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button variant="outline" onClick={onClose}>Close the sitting</Button>
      </div>

      {q.isLoading ? (
        <LoadingState label="Loading the seating plan…" />
      ) : q.isError || !q.data ? (
        <ErrorState title="The seating plan did not load" message={q.error?.message} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="print:hidden">
            {q.data.seatedElsewhere > 0 && (
              <Notice tone="warning" className="mb-4">
                <span className="tabular-nums">{q.data.seatedElsewhere}</span>{' '}
                <span>{q.data.seatedElsewhere === 1 ? 'seat is held by a candidate who no longer sits a paper in this sitting (an entry was withdrawn or a paper moved).' : 'seats are held by candidates who no longer sit a paper in this sitting (an entry was withdrawn or a paper moved).'}</span>
              </Notice>
            )}
            <RoomsEditor plan={q.data} />
            <SeatingSection plan={q.data} />
            <RegisterList plan={q.data} openPaper={registerPaper} openRoom={registerRoom} onOpen={(paperId, roomId) => address.set({ register: paperId, room: roomId })} />
          </div>
          {registerPaper && q.data.papers.some((p) => p.id === registerPaper) && (
            <RegisterSheet key={`${registerPaper}-${registerRoom ?? 'all'}`} paperId={registerPaper} roomId={registerRoom} onClose={() => address.set({ register: null, room: null })} />
          )}
        </>
      )}
    </section>
  );
}

/** Per paper, the rooms its candidates sit in: each opens the board's register for that room. */
function RegisterList({ plan, openPaper, openRoom, onOpen }: {
  plan: SittingPlan; openPaper: string | null; openRoom: string | null; onOpen: (paperId: string, roomId: string | null) => void;
}) {
  const rooms = useMemo(() => {
    const out = new Map<string, { roomId: string; name: string; n: number }[]>();
    for (const p of plan.papers) {
      out.set(p.id, plan.rooms
        .map((r) => ({ roomId: r.roomId, name: r.name, n: r.seats.filter((s) => s.papers.some((x) => x.id === p.id)).length }))
        .filter((r) => r.n > 0));
    }
    return out;
  }, [plan]);
  return (
    <div className="mt-8">
      <h3 className="font-display text-lg font-bold text-foreground">Attendance registers</h3>
      <p className="mb-3 text-sm text-muted-foreground">The board&apos;s register for each paper, one page per room, in candidate-number order. The invigilators mark it on their tablet; print it for the room as well.</p>
      <ul className="space-y-2">
        {plan.papers.map((p) => {
          const unseated = plan.unseated.filter((u) => u.papers.some((x) => x.id === p.id)).length;
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
              <Code className="font-semibold text-foreground">{p.code}</Code>
              <BoardText className="text-sm text-foreground">{p.title}</BoardText>
              <span className="ms-auto flex flex-wrap items-center gap-1">
                {(rooms.get(p.id) ?? []).map((r) => (
                  <Button key={r.roomId} size="sm" variant={openPaper === p.id && openRoom === r.roomId ? 'default' : 'outline'} onClick={() => onOpen(p.id, r.roomId)}>
                    <span><Name>{r.name}</Name> (<span className="tabular-nums">{r.n}</span>)</span>
                  </Button>
                ))}
                <Button size="sm" variant={openPaper === p.id && !openRoom ? 'default' : 'ghost'} onClick={() => onOpen(p.id, null)}>Every room</Button>
                {unseated > 0 && <Badge tone="warning"><span className="tabular-nums">{unseated}</span>&nbsp;<span>without a seat</span></Badge>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
