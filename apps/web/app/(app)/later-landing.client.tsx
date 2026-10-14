'use client';

/**
 * F6b — the landing of a role with nothing in the reservation cycle yet: the teacher and the gate
 * (FEATURES_PLAN.md §1 F6b, point 2). The sentence that their screens come later, their latest
 * notifications (GET /v1/notifications) and their profile — nothing else, so nobody lands on a
 * screen the school is not using yet. Their own screens (teaching, the day's leave list) stay
 * reachable by URL and come back with RESERVATION_CYCLE_ONLY off.
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import { apiResponse, ROLES } from '@repo/validations';
import { Button } from '~/components/ui/button';
import { Notice } from '~/components/ui/tone';
import { ErrorState, LoadingState } from '~/components/ui/query-state';
import { InstantText } from '~/app/(app)/exams/exams-shared';

const fetchLatest = () => apiResponse(api.v1.notifications.$get({ query: { unreadOnly: 'false', limit: '5', offset: '0' } }));

export default function LaterLanding({ viewerRole, userName }: { viewerRole: string; userName: string }): React.JSX.Element {
  const latest = useQuery({ queryKey: ['notifications', 'latest'], queryFn: fetchLatest });
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 animate-fade-up">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          <span>Welcome back,</span> <bdi data-i18n-skip="true">{userName}</bdi>
        </h1>
      </div>

      <Notice tone="info" title="Your screens come later">
        <p>
          {viewerRole === ROLES.GATE
            ? 'The school is starting with reservations and fees. The gate’s screens — the day’s leave list and check-out — come after them.'
            : 'The school is starting with reservations and fees. Your teaching screens — your lessons, attendance and forecasts — come after them.'}
        </p>
        <p className="mt-1">Until then, your notifications and your profile are here.</p>
      </Notice>

      <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-foreground">Notifications</h2>
          <Button asChild variant="outline" size="sm"><Link href="/notifications">See every notification</Link></Button>
        </div>
        {latest.isLoading ? <LoadingState /> : latest.isError || !latest.data ? <ErrorState onRetry={() => latest.refetch()} /> : latest.data.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No notifications yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {latest.data.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  {!n.readAt && <span className="me-2 inline-block size-2 rounded-full bg-primary align-middle" aria-label="Unread" />}
                  <span className="font-medium text-foreground" dir="auto">{n.title}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground"><InstantText iso={String(n.createdAt)} /></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground">Profile</h2>
          <p className="mt-1 text-sm text-muted-foreground">Manage your account information</p>
        </div>
        <Button asChild variant="outline" size="sm"><Link href="/profile">Open your profile</Link></Button>
      </section>
    </div>
  );
}
