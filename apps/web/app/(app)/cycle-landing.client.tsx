'use client';

/**
 * F6b — the admin's and the coordinator's landing (FEATURES_PLAN.md §1 F6b, point 2;
 * docs/features/RESERVATION_FOCUS.md §3): the session she is running — open, or the next one being
 * prepared — with what its sheet still needs and what families are doing, each with the one action
 * that does it, in the cycle's order: the sheet (teachers, papers, fees, the boards' dates), the
 * sittings to verify, the families (reserved, unpaid, overdue), the entries to the board.
 *
 * Her spreadsheet version: open the links sheet, scan each row for a missing teacher or fee, open
 * the response sheet to count who has paid, keep the boards' dates in her head. Here the scan is
 * done for her and each finding opens the place that fixes it.
 *
 * Existing endpoints only: GET /v1/sessions (the list with its series and money summary),
 * GET /v1/sessions/:id/offers (the sheet's rows and their warnings), GET /v1/sessions/:id/to-verify.
 * Text that carries a number, a name or a date is split into its own nodes for the page translator
 * (lib/i18n-focus.ts).
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, ROLES } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge, type Tone } from '~/components/ui/tone';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { cn } from '~/lib/utils';
import { SeriesName } from '~/app/(app)/exams/exams-shared';
import { Day, Money, StatusBadge } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';

const fetchSessions = () => apiResponse(api.v1.sessions.$get({ query: {} }));
type SessionRow = Awaited<ReturnType<typeof fetchSessions>>[number];
const fetchOffers = (id: string) => apiResponse(api.v1.sessions[':id'].offers.$get({ param: { id } }));
const fetchToVerify = (id: string) => apiResponse(api.v1.sessions[':id']['to-verify'].$get({ param: { id }, query: { show: 'awaiting' } }));

/** One finding on the card: what it is, how it stands, and the action that deals with it. */
type Row = { key: string; tone: Tone; body: React.ReactNode; action?: { label: string; href: string } };

const DOT: Record<Tone, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-violet-500',
  neutral: 'bg-muted-foreground/40',
};

/**
 * The sessions the landing shows: every open one and every one being prepared (the next), then the
 * closed ones whose cycle is not over — families still owing, or paid lines whose entries have not
 * reached the board's deadline (or whose deadline is not set). With none open or being prepared it
 * says so; with nothing in progress at all, it shows the last session, the one the next starts from.
 */
function current(sessions: SessionRow[]): { shown: SessionRow[]; noneRunning: boolean; fallback?: boolean } {
  const byStart = (a: SessionRow, b: SessionRow) => +new Date(a.startDate) - +new Date(b.startDate);
  const open = sessions.filter((s) => s.status === 'active').sort(byStart);
  const drafts = sessions.filter((s) => s.status === 'draft').sort(byStart);
  const tail = sessions.filter((s) => s.status === 'closed' && (s.summary.unpaid > 0
    || (s.summary.paid > 0 && s.boardSeries.some((b) => !b.entryDeadline || !b.entryDeadlinePassed)))).sort(byStart);
  const shown = [...open, ...drafts, ...tail];
  const noneRunning = open.length === 0 && drafts.length === 0;
  if (shown.length) return { shown, noneRunning };
  const last = [...sessions].sort(byStart).at(-1);
  return { shown: last ? [last] : [], noneRunning, fallback: true };
}

export default function CycleLanding({ viewerRole, userName }: { viewerRole: string; userName: string }): React.JSX.Element {
  const isAdmin = viewerRole === ROLES.ADMIN;
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['sessions', 'admin'], queryFn: fetchSessions });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 animate-fade-up">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <span>Welcome back,</span> <bdi data-i18n-skip="true">{userName}</bdi>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">The reservation cycle: where each session stands, and what comes next.</p>
      </div>

      {isLoading ? <LoadingState /> : isError || !data ? <ErrorState onRetry={() => refetch()} /> : (() => {
        const { shown, noneRunning, fallback } = current(data);
        return (
          <div className="space-y-5">
            {noneRunning && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-700 dark:bg-amber-900/20">
                <div>
                  <p className="font-semibold text-amber-900 dark:text-amber-200">No session is open or being prepared.</p>
                  <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                    {isAdmin
                      ? 'Start the next one: copy the last session of its kind and its subjects, teachers and course fees come across.'
                      : 'The admin starts the next session; it appears here with what its sheet still needs.'}
                  </p>
                </div>
                {isAdmin && (
                  <Button asChild><Link href="/admin/sessions">Start the next session</Link></Button>
                )}
              </div>
            )}
            {/* One action is in front of her: the banner's when it has one, else the first card's first. */}
            {shown.map((s, i) => (
              <SessionCard key={s.id} s={s} viewerRole={viewerRole} closedTail={!!fallback} lead={i === 0 && !(noneRunning && isAdmin)} />
            ))}
          </div>
        );
      })()}
    </div>
  );
}

function SessionCard({ s, viewerRole, closedTail, lead }: { s: SessionRow; viewerRole: string; closedTail: boolean; lead: boolean }) {
  const isAdmin = viewerRole === ROLES.ADMIN;
  const sheet = `/admin/sessions/${s.id}`;
  const offers = useQuery({ queryKey: ['sessions', s.id, 'offers'], queryFn: () => fetchOffers(s.id), enabled: s.status !== 'closed' });
  const verify = useQuery({ queryKey: ['sessions', s.id, 'to-verify', 'awaiting'], queryFn: () => fetchToVerify(s.id) });

  // ── What the sheet still needs (a draft or an open session) ──
  const sheetRows: Row[] = [];
  if (s.status !== 'closed' && offers.data) {
    const rows = offers.data.offers;
    if (rows.length === 0) {
      sheetRows.push({ key: 'empty', tone: 'warning', body: <span>No subjects on the sheet yet.</span>, action: { label: 'Add the subjects', href: `${sheet}#subjects` } });
    }
    // As the Subjects tab reads them (F6a): a subject with no teacher asks "Who teaches it?" — open
    // with none, or brought across by a copy with none; a self-study-only subject is taught by nobody.
    const noTeacher = rows.filter((o) => o.teachers.length === 0 && o.availability !== 'self_study_only' && (o.availability === 'closed' || o.warnings.includes('no_teacher'))).length;
    if (noTeacher) {
      sheetRows.push({
        key: 'teacher', tone: 'warning',
        body: <span><span>{noTeacher}</span> <span>{noTeacher === 1 ? 'subject has no teacher: who teaches it?' : 'subjects have no teacher: who teaches them?'}</span></span>,
        action: { label: 'Name the teachers', href: `${sheet}#subjects` },
      });
    }
    const unmapped = rows.filter((o) => o.warnings.includes('unmapped')).length;
    if (unmapped) {
      sheetRows.push({
        key: 'papers', tone: 'warning',
        body: <span><span>{unmapped}</span> <span>{unmapped === 1 ? 'subject needs its papers set on the Catalogue' : 'subjects need their papers set on the Catalogue'}</span></span>,
        action: { label: 'Open the Catalogue', href: '/exams/catalogue' },
      });
    }
    const live = (o: (typeof rows)[number]) => o.availability !== 'closed';
    const noFee = rows.filter((o) => live(o) && o.warnings.includes('no_fee')).length;
    if (noFee) {
      sheetRows.push({
        key: 'fee', tone: 'warning',
        body: <span><span>{noFee}</span> <span>{noFee === 1 ? 'subject has no board fee' : 'subjects have no board fee'}</span></span>,
        action: { label: 'Set the fees', href: `${sheet}#fees` },
      });
    }
    const provisional = rows.filter((o) => live(o) && o.items.some((i) => i.availability !== 'closed' && i.boardFee.provisional)).length;
    if (provisional) {
      sheetRows.push({
        key: 'provisional', tone: 'info',
        body: (
          <span>
            <span><span>{provisional}</span> <span>{provisional === 1 ? 'board fee not published yet' : 'board fees not published yet'}</span></span>
            <span className="block text-xs text-muted-foreground">Families can reserve these subjects, not pay for them, until the fee is confirmed.</span>
          </span>
        ),
        action: { label: 'Confirm the fees', href: `${sheet}#fees` },
      });
    }
  }
  // The boards' dates, from the session's own series (no dates: no line can be taken in it).
  if (s.status !== 'closed') {
    for (const b of s.boardSeries.filter((x) => !x.entryDeadline && !x.examsStart)) {
      sheetRows.push({
        key: `dates-${b.id}`, tone: 'warning',
        body: <span><SeriesName boardName={b.boardName} month={b.month} year={b.year} label={b.label} /> <span>—</span> <span>Dates not set</span></span>,
        action: { label: 'Set the dates', href: sheet },
      });
    }
  }
  const sheetReady = s.status !== 'closed' && offers.data && offers.data.offers.length > 0 && sheetRows.length === 0;

  // ── The sittings families declared, waiting for the school ──
  const toVerify = verify.data?.lines.length ?? 0;
  const verifyRows: Row[] = toVerify
    ? [{
        key: 'verify', tone: 'warning',
        body: <span><span>{toVerify}</span> <span>{toVerify === 1 ? 'declared sitting to verify' : 'declared sittings to verify'}</span></span>,
        action: { label: 'Verify them', href: `${sheet}#verify` },
      }]
    : [];

  // ── What families are doing ──
  const m = s.summary;
  const familyRows: Row[] = [];
  if (m.lines === 0) {
    if (s.status === 'active') {
      familyRows.push({
        key: 'none', tone: 'neutral', body: <span>No family has reserved yet.</span>,
        ...(isAdmin ? { action: { label: 'Reserve for a family at the desk', href: '/desk' } } : {}),
      });
    }
  } else {
    familyRows.push({
      key: 'counts', tone: m.overdue ? 'danger' : m.unpaid ? 'warning' : 'success',
      body: (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span><span>{m.lines}</span> <span>{m.lines === 1 ? 'reservation' : 'reservations'}</span></span>
          <span className="text-muted-foreground">·</span>
          <span><span>{m.paid}</span> <span>paid</span></span>
          <span className="text-muted-foreground">·</span>
          <span><span>{m.unpaid}</span> <span>unpaid</span></span>
          {isAdmin && m.outstanding > 0 && <span className="text-muted-foreground">(<Money amount={m.outstanding} /> <span>outstanding</span>)</span>}
          {m.overdue > 0 && <Badge tone="danger"><span>{m.overdue}</span>&nbsp;<span>overdue</span></Badge>}
        </span>
      ),
      // The Money tab is the admin's (and finance's): who has not paid, and Remind.
      ...(isAdmin && m.unpaid > 0
        ? { action: { label: m.overdue > 0 ? 'Remind the overdue families' : 'See who has not paid', href: `${sheet}#money` } }
        : {}),
    });
  }

  // ── The entries to the board: each series' entry deadline, the school's hard stop ──
  const boardRows: Row[] = [];
  for (const b of s.boardSeries) {
    const name = <SeriesName boardName={b.boardName} month={b.month} year={b.year} label={b.label} />;
    if (b.entryDeadline) {
      boardRows.push({
        key: `board-${b.id}`, tone: b.entryDeadlinePassed ? 'neutral' : 'info',
        body: <span>{name}<span>:</span> <span>entries by</span> <Day iso={b.entryDeadline} />{b.entryDeadlinePassed && <> (<span>passed</span>)</>}</span>,
        ...(m.paid > 0 ? { action: { label: 'Exam entries', href: `/exams/entries?series=${b.id}` } } : {}),
      });
    } else if (b.examsStart || (s.status === 'closed' && m.paid > 0)) {
      // A series with no dates at all is on the sheet's list while the session runs.
      boardRows.push({
        key: `board-${b.id}`, tone: 'warning',
        body: <span>{name}<span>:</span> <span>no entry deadline yet</span></span>,
        action: { label: 'Set the dates', href: sheet },
      });
    }
  }

  const groups: { title: string; rows: Row[]; done?: React.ReactNode }[] = [];
  if (s.status !== 'closed') {
    groups.push({
      title: 'What the sheet still needs',
      rows: sheetRows,
      done: offers.isLoading ? <span className="text-muted-foreground">Checking the sheet…</span>
        : sheetReady ? <span>Nothing is missing: every subject has its teachers, its fees and its dates.</span> : null,
    });
  }
  if (verifyRows.length) groups.push({ title: 'Sittings to verify', rows: verifyRows });
  if (familyRows.length) groups.push({ title: 'What families are doing', rows: familyRows });
  if (boardRows.length) groups.push({ title: 'Entries to the board', rows: boardRows });

  // The first action, in the cycle's order, is the one in front of her.
  const firstAction = lead ? groups.flatMap((g) => g.rows).find((r) => r.action)?.key : undefined;

  return (
    <section className="animate-fade-up rounded-xl border border-border bg-card p-5 shadow-sm" aria-label={s.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={sheet as never} className="font-display text-lg font-semibold text-foreground hover:underline"><bdi>{s.name}</bdi></Link>
            <StatusBadge status={s.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {s.status === 'draft' && (
              <>
                <span>Being prepared: not open to families yet.</span>{' '}
                <span>Families reserve from</span> <Day iso={s.startDate} /> <span>to</span> <Day iso={s.endDate} />.
              </>
            )}
            {s.status === 'active' && (
              <>
                <span>Open: families reserve until</span> <Day iso={s.endDate} />. <span>Payment due</span> <Day iso={s.paymentDueAt} />.
              </>
            )}
            {s.status === 'closed' && (
              <>
                <span>Closed to new reservations.</span>{closedTail && <> <span>The last session; the next one starts from it.</span></>}
              </>
            )}
          </p>
        </div>
        <Button asChild variant="outline" size="sm"><Link href={sheet as never}>Open the sheet</Link></Button>
      </div>

      <div className="mt-4 space-y-4">
        {groups.map((g) => (
          <div key={g.title}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h3>
            {g.rows.length === 0 && g.done ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-foreground">
                <span className={cn('size-2 shrink-0 rounded-full', DOT.success)} aria-hidden />
                {g.done}
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-border">
                {g.rows.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-start gap-2 text-sm text-foreground">
                      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[r.tone])} aria-hidden />
                      {r.body}
                    </div>
                    {r.action && (
                      <Button asChild size="sm" variant={r.key === firstAction ? 'default' : 'outline'}>
                        <Link href={r.action.href as never}>{r.action.label}</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {(offers.isError || verify.isError) && (
          <p className="text-sm text-destructive">Part of this session could not be read. Open the sheet to see it.</p>
        )}
      </div>
    </section>
  );
}
