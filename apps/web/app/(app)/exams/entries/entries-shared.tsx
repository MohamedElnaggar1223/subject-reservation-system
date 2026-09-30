'use client';

/**
 * Shared by the entries, entry-list and forecast screens (F4,
 * docs/features/EXAM_ENTRIES.md §2–3): the fetchers for the writes those
 * screens make (typed by the API through the RPC client, never by hand —
 * PATTERNS.md), a dialog shell, the series' deadline status and the API's
 * sentences that carry a code or a name, split into their own text nodes so
 * the page translator (lib/i18n.tsx) finds the words.
 */

import { useEffect, useId } from 'react';
import { api } from '~/lib/hono';
import {
  apiResponse, feeTierOn, schoolDateString, FEE_TIER_LABELS,
  type CreateEntryType, type DeriveEntriesType, type UpdateBoardRuleType, type UpdateEntryType,
} from '@repo/validations';
import { Badge, Notice, type Tone } from '~/components/ui/tone';
import { cn } from '~/lib/utils';
import { daysFrom } from '../../academic/calendar/academic-shared';
import { DeadlineBadge, InstantText, MaybeDate } from '../exams-shared';
import { BoardText, Code, type BoardSeriesRow } from '../exam-f4-shared';

// ─── Writes (types come from the API) ────────────────────────────────────────

export const deriveEntries = (json: DeriveEntriesType) => apiResponse(api.v1.exams.entries.derive.$post({ json }));
export type DeriveResult = Awaited<ReturnType<typeof deriveEntries>>;
export type DeriveRowData = DeriveResult['rows'][number];

export const updateEntry = (id: string, json: UpdateEntryType) => apiResponse(api.v1.exams.entries[':id'].$put({ param: { id }, json }));
export type UpdateEntryResult = Awaited<ReturnType<typeof updateEntry>>;

/** `submittedAt` is an ISO instant; the API refuses one after the series' entry deadline. */
export const submitEntries = (entryIds: string[], submittedAt?: string) =>
  apiResponse(api.v1.exams.entries.submit.$post({ json: submittedAt ? { entryIds, submittedAt } : { entryIds } }));

export const withdrawEntry = (id: string, reason: string) => apiResponse(api.v1.exams.entries[':id'].withdraw.$post({ param: { id }, json: { reason } }));
export type WithdrawResult = Awaited<ReturnType<typeof withdrawEntry>>;

export const createEntry = (json: CreateEntryType) => apiResponse(api.v1.exams.entries.$post({ json }));

export const setForecast = (entryId: string, grade: string | null) =>
  apiResponse(api.v1.exams.entries[':id'].forecast.$put({ param: { id: entryId }, json: { grade } }));

export const submitForecasts = (boardSeriesId: string) => apiResponse(api.v1.exams.forecasts.submit.$post({ json: { boardSeriesId } }));

export const updateBoardRule = (boardCode: string, json: UpdateBoardRuleType) =>
  apiResponse(api.v1.exams['board-rules'][':boardCode'].$put({ param: { boardCode: boardCode as 'cambridge' }, json }));

// ─── Small helpers ───────────────────────────────────────────────────────────

export const todayInSchool = () => schoolDateString(new Date());

/** A sent entry: a change to what the board sees is an amendment. */
export const isSent = (status: string) => status === 'submitted' || status === 'amended';

/** A datetime-local value (the browser's clock) from an instant. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── A dialog ────────────────────────────────────────────────────────────────

/** The reason modal's shell (components/ui/reason-modal.tsx) for dialogs that show more than one sentence. */
export function Dialog({
  title, children, onClose, busy = false, wide = false,
}: { title: React.ReactNode; children: React.ReactNode; onClose: () => void; busy?: boolean; wide?: boolean }): React.JSX.Element {
  const id = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby={id}>
      <div className={cn('max-h-[90vh] w-full overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl', wide ? 'max-w-2xl' : 'max-w-md')}>
        <h2 id={id} className="mb-2 font-display text-lg font-bold text-foreground">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ─── The series' deadline, as the entry screens show it ──────────────────────

/**
 * The entry deadline with days left (or passed: the school's hard stop,
 * MO-10), the board's fee tier today and the forecast grades' due date.
 */
export function SeriesDeadlineStatus({ series, className }: { series: BoardSeriesRow; className?: string }): React.JSX.Element {
  const tier = feeTierOn(series, todayInSchool());
  const passed = series.entryDeadlinePassed;
  return (
    <div className={cn('mb-6 space-y-3', className)}>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div>
          <p className="text-xs text-muted-foreground">Entry deadline</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            {series.entryDeadline && <InstantText iso={series.entryDeadline} />}
            <DeadlineBadge iso={series.entryDeadline} />
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">The board&apos;s fee today</p>
          <p className="mt-0.5"><Badge tone={tier === 'standard' ? 'neutral' : 'warning'}>{FEE_TIER_LABELS[tier]}</Badge></p>
        </div>
        {series.forecastGradesDue && (
          <div>
            <p className="text-xs text-muted-foreground">Forecast grades due</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
              <MaybeDate date={series.forecastGradesDue} />
              <DaysLeftBadge date={series.forecastGradesDue} />
            </p>
          </div>
        )}
      </div>
      {passed && (
        <Notice tone="danger" title="The entry deadline has passed">
          No new entries are made for this series, and none is marked as sent after the deadline. A withdrawal is still recorded, with what the board does with its fee.
        </Notice>
      )}
    </div>
  );
}

/** Days left to a board date (a calendar date), amber inside a fortnight. */
export function DaysLeftBadge({ date }: { date: string }): React.JSX.Element {
  const left = daysFrom(todayInSchool(), date);
  if (left < 0) return <Badge tone="danger">Passed</Badge>;
  if (left === 0) return <Badge tone="danger">Today</Badge>;
  return (
    <Badge tone={left <= 14 ? 'warning' : 'success'}>
      <span>{left}</span>&nbsp;<span>{left === 1 ? 'day left' : 'days left'}</span>
    </Badge>
  );
}

// ─── The API's sentences with a code or a name in them ───────────────────────

/**
 * A derivation's note. The two notes that carry a name or a code are split
 * so their words translate (a whole sentence would be caught by another
 * screen's broader rule first); any other note is shown as the API wrote it.
 */
export function DeriveNote({ note }: { note: string }): React.JSX.Element {
  const choose = /^Choose the unit for (.+) and add it on the entry list$/.exec(note);
  if (choose) {
    return (
      <span>
        <span>Choose the unit for</span> <Code className="font-sans">{choose[1]}</Code> <span>and add it on the entry list</span>
      </span>
    );
  }
  const unmapped = /^(.+) is not mapped on the Catalogue: say what it enters with (.+) first$/.exec(note);
  if (unmapped) {
    return (
      <span>
        <BoardText>{unmapped[1]}</BoardText> <span>is not mapped on the Catalogue.</span> <span>Say what it enters with</span> <BoardText>{unmapped[2]}</BoardText>{' '}
        <span>on the Catalogue first.</span>
      </span>
    );
  }
  return <span>{note}</span>;
}

/** A result line: "0610 Biology — Omar Tarek: <the API's sentence>". */
export function EntryLine({ code, title, name, children }: { code: string; title: string; name?: string | null; children?: React.ReactNode }): React.JSX.Element {
  return (
    <span>
      <Code>{code}</Code> <BoardText>{title}</BoardText>
      {name ? <> <span className="text-muted-foreground">·</span> <bdi data-i18n-skip="true">{name}</bdi></> : null}
      {children ? <>: {children}</> : null}
    </span>
  );
}

export type Flash = { tone: Tone; title: string; lines?: React.ReactNode[] } | null;

/** What just happened (sent, withdrawn, made), with a way to put it away. */
export function FlashNotice({ flash, onClose, className }: { flash: Flash; onClose: () => void; className?: string }): React.JSX.Element | null {
  if (!flash) return null;
  return (
    <Notice tone={flash.tone} className={cn('mb-4', className)} title={
      <span className="flex items-start justify-between gap-3">
        <span>{flash.title}</span>
        <button type="button" onClick={onClose} className="text-xs font-medium underline-offset-2 hover:underline print:hidden">Dismiss</button>
      </span>
    }>
      {flash.lines?.length ? (
        <ul className="list-disc space-y-1 ps-5">
          {flash.lines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      ) : null}
    </Notice>
  );
}
