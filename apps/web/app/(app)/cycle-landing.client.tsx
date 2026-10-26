'use client';

/**
 * Her Home (COORDINATOR_REWORK.md §9.3, §5; the coordinator's and the admin's landing): each session she
 * is running or preparing, with its check list and what families are doing — and nothing she cannot act
 * on. A line she can act on has its button here (Looks right, Keep them, Switch it on) or takes her to
 * the place that fixes it; a blocker that is someone else's reads "Waiting for the admin", with no button
 * (the lead's decision on the mock). The admin enters a missing board date here.
 *
 * Her spreadsheet version: open the links sheet and each form, scan for a missing teacher or price,
 * open each response sheet to count who has paid, and remember which board has not published its dates.
 * Here the scan is done for her, per session. A closed session still shows while a reservation in it waits for
 * payment or for a parent's approval (main's "still in progress"), under its own heading, with what families are doing.
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, ROLES } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/tone';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { Day, fetchSession, sessionKey, STATUS_TONE } from '~/app/(app)/(sessions)/admin/sessions/sessions-shared';
import { STATUS_WORDS } from '~/app/(app)/(sessions)/admin/sessions/setup-shared';
import { CheckList } from '~/app/(app)/(sessions)/admin/sessions/check-list.client';

const fetchSessions = () => apiResponse(api.v1.sessions.$get({ query: {} }));
type SessionRow = Awaited<ReturnType<typeof fetchSessions>>[number];

export default function CycleLanding({ viewerRole, userName }: { viewerRole: string; userName: string }): React.JSX.Element {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['sessions', 'admin'], queryFn: fetchSessions });
  const canSetUp = viewerRole === ROLES.ADMIN || viewerRole === ROLES.COORDINATOR;
  // The one taking reservations first, then those being prepared, newest year first.
  const rank = (s: SessionRow) => (s.status === 'active' ? 0 : 1);
  const shown = (data ?? []).filter((s) => s.status !== 'closed').sort((a, b) => rank(a) - rank(b) || b.seriesYear - a.seriesYear);
  // Closed, but a reservation still waits for payment or a parent's approval (the summary's unpaid: pending payment and
  // pending approval; a dropped line waiting for its receipt, or a preregistration, is neither).
  const inProgress = (data ?? []).filter((s) => s.status === 'closed' && s.summary.unpaid > 0)
    .sort((a, b) => b.seriesYear - a.seriesYear);
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            <span>Welcome back,</span> <bdi data-i18n-skip="true">{userName}</bdi>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Your sessions, and what to do in each before it opens.</p>
        </div>
        <Button asChild variant="outline"><Link href="/admin/sessions">All sessions</Link></Button>
      </div>
      {isLoading ? <LoadingState label="Reading the sessions…" /> : isError || !data ? <ErrorState message="The sessions did not load; nothing is lost. Try again." onRetry={() => refetch()} /> : (
        <div className="space-y-5">
          {shown.length === 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-700 dark:bg-amber-900/20">
              <div>
                <p className="font-semibold text-amber-900 dark:text-amber-200">No session is open or being prepared.</p>
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">Start the next one: copy the last session of its type, and its subjects, teachers and policy come across.</p>
              </div>
              {canSetUp && <Button asChild><Link href="/admin/sessions">New session</Link></Button>}
            </div>
          )}
          {shown.map((s) => <SessionCard key={s.id} row={s} viewerRole={viewerRole} />)}
          {inProgress.length > 0 && (
            <section aria-labelledby="home-in-progress" className="space-y-3 pt-2">
              <div>
                <h2 id="home-in-progress" className="font-display text-base font-semibold text-foreground">Closed to new reservations — still in progress</h2>
                <p className="text-sm text-muted-foreground">Reservations here still wait for payment, or for a parent to approve them.</p>
              </div>
              {inProgress.map((s) => <ClosedCard key={s.id} row={s} />)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function SessionCard({ row, viewerRole }: { row: SessionRow; viewerRole: string }) {
  const { data: s, isLoading, isError, refetch } = useQuery({ queryKey: sessionKey(row.id), queryFn: () => fetchSession(row.id) });
  const href = `/admin/sessions/${row.id}`;
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby={`home-${row.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`home-${row.id}`} className="font-display text-lg font-semibold text-foreground"><bdi>{row.name}</bdi></h2>
            <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{STATUS_WORDS[row.status] ?? row.status}</Badge>
          </div>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span><span>Reservations close</span> {row.endDate ? <Day iso={row.endDate} /> : <span>— (optional)</span>}</span>
            <span><span>Payment due</span> <Day iso={row.paymentDueAt} /></span>
            <span><span>First lesson</span> <Day iso={`${row.courseStartsOn}T12:00:00.000Z`} /></span>
          </p>
        </div>
        <Button asChild><Link href={href as never}>{`Open ${row.name}`}</Link></Button>
      </div>
      {(row.status === 'active' || row.summary.lines > 0) && (
        <p className="mt-3 text-sm text-foreground">
          <span>What families are doing:</span> <strong>{row.summary.lines}</strong> <span>{row.summary.lines === 1 ? 'reservation' : 'reservations'}</span> · <strong>{row.summary.paid}</strong> <span>paid</span> · <strong>{row.summary.unpaid}</strong> <span>waiting for payment</span>
        </p>
      )}
      <div className="mt-4">
        {isLoading ? <LoadingState /> : isError || !s ? <ErrorState onRetry={() => refetch()} /> : <CheckList s={s} viewerRole={viewerRole} place="home" headingLevel="h3" />}
      </div>
    </section>
  );
}

/** A closed session still in progress: what families are doing, and the session to open. */
function ClosedCard({ row }: { row: SessionRow }) {
  const href = `/admin/sessions/${row.id}`;
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby={`home-${row.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`home-${row.id}`} className="font-display text-lg font-semibold text-foreground"><bdi>{row.name}</bdi></h3>
            <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{STATUS_WORDS[row.status] ?? row.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground"><span>Payment due</span> <Day iso={row.paymentDueAt} /></p>
        </div>
        <Button asChild variant="outline"><Link href={href as never}>{`Open ${row.name}`}</Link></Button>
      </div>
      <p className="mt-3 text-sm text-foreground">
        <span>What families are doing:</span> <strong>{row.summary.lines}</strong> <span>{row.summary.lines === 1 ? 'reservation' : 'reservations'}</span> · <strong>{row.summary.paid}</strong> <span>paid</span> · <strong>{row.summary.unpaid}</strong> <span>waiting for payment or approval</span>
      </p>
    </section>
  );
}
