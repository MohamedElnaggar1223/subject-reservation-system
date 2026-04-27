'use client';

/**
 * Notification Center Client Component
 *
 * Displays paginated notifications for the authenticated user (any role).
 *
 * Features:
 * - Unread badge count (refetched after mark-read actions)
 * - Toggle between "All" and "Unread only" views
 * - Click a notification to mark it as read
 * - "Mark all as read" bulk action
 * - Infinite scroll-style "Load more" pagination
 * - Type-specific icons and colour coding (using NOTIFICATION_TYPE_ICONS)
 * - Relative timestamps ("2 hours ago")
 *
 * Covers NOT-001 to NOT-011 display requirements.
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse,
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_TYPE_ICONS,
  type NotificationType,
} from '@repo/validations';
import { Button } from '~/components/ui/button';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Background colours per notification type (unread indicator styling)
const TYPE_COLOUR: Partial<Record<NotificationType, string>> = {
  SESSION_OPENED:                   'bg-brand-50 border-brand-200 dark:bg-brand-900/20 dark:border-brand-700',
  SESSION_CLOSED:                   'bg-muted border-border',
  SESSION_CLOSING_SOON:             'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700',
  REGISTRATION_REQUEST_RECEIVED:    'bg-violet-50 border-violet-200 dark:bg-violet-900/20 dark:border-violet-700',
  REGISTRATION_APPROVED:            'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700',
  REGISTRATION_REJECTED:            'bg-destructive/5 border-destructive/20',
  PAYMENT_CONFIRMED:                'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700',
  DROP_SWAP_REQUEST_RECEIVED:       'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700',
  DROP_SWAP_PROCESSED:              'bg-brand-50 border-brand-200 dark:bg-brand-900/20 dark:border-brand-700',
  ESCROW_BALANCE_CHANGED:           'bg-teal-50 border-teal-200 dark:bg-teal-900/20 dark:border-teal-700',
  ESCROW_WITHDRAWAL_FULFILLED:      'bg-cyan-50 border-cyan-200 dark:bg-cyan-900/20 dark:border-cyan-700',
  ESCROW_WITHDRAWAL_REJECTED:       'bg-destructive/5 border-destructive/20',
  GRADE_CHANGED:                    'bg-violet-50 border-violet-200 dark:bg-violet-900/20 dark:border-violet-700',
  BULK_ANNOUNCEMENT:                'bg-muted border-border',
};

const DEFAULT_COLOUR = 'bg-muted border-border';

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  data?: Record<string, unknown> | null;
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NotificationsClient() {
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const LIMIT = 50;

  // ── Notification list query (infinite pagination) ──
  // useInfiniteQuery accumulates pages so "Load more" APPENDS to the list
  // instead of replacing it. A page that returns fewer than LIMIT rows is
  // the last page (we pass `undefined` from getNextPageParam to signal it).
  const {
    data: notificationsPages,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['notifications', { unreadOnly, limit: LIMIT }],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      apiResponse(
        api.v1.notifications.$get({
          query: {
            unreadOnly: unreadOnly ? 'true' : 'false',
            limit: String(LIMIT),
            offset: String(pageParam),
          },
        })
      ),
    getNextPageParam: (lastPage, allPages) => {
      const lastCount = Array.isArray(lastPage) ? lastPage.length : 0;
      if (lastCount < LIMIT) return undefined;
      return allPages.reduce((acc, p) => acc + (Array.isArray(p) ? p.length : 0), 0);
    },
  });

  // ── Unread count query (for the badge and "mark all" button context) ──
  const { data: countData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiResponse(api.v1.notifications['unread-count'].$get()),
    refetchInterval: 30_000, // Refresh badge every 30s
  });

  // ── Mark single as read ──
  const markRead = useMutation({
    mutationFn: (id: string) =>
      apiResponse(
        api.v1.notifications[':id'].read.$put({ param: { id } })
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // ── Mark all as read ──
  const markAllRead = useMutation({
    mutationFn: () =>
      apiResponse(api.v1.notifications['read-all'].$put()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const handleNotificationClick = useCallback(
    (n: Notification) => {
      if (!n.readAt) {
        markRead.mutate(n.id);
      }
    },
    [markRead]
  );

  const unreadCount = countData?.count ?? 0;
  const items: Notification[] = useMemo(() => {
    const pages = notificationsPages?.pages as Notification[][] | undefined;
    return pages ? pages.flat() : [];
  }, [notificationsPages]);

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto animate-fade-up">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground font-display tracking-tight">Notifications</h1>
          {unreadCount > 0 && (
            <span className="inline-flex items-center justify-center h-6 min-w-6 px-2 rounded-full bg-primary text-primary-foreground text-xs font-bold">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Unread filter toggle — toggling filter invalidates the infinite
              query (the key includes `unreadOnly`) so React Query automatically
              refetches the first page; no manual reset needed. */}
          <button
            onClick={() => setUnreadOnly((v) => !v)}
            className={`text-sm px-3 py-1.5 rounded-full border font-medium transition-colors ${
              unreadOnly
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:border-primary/40'
            }`}
          >
            {unreadOnly ? 'Unread only' : 'All'}
          </button>

          {/* Mark all as read */}
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              {markAllRead.isPending ? 'Marking...' : 'Mark all read'}
            </Button>
          )}
        </div>
      </div>

      {/* ── Notification List ── */}
      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto mb-3" />
          Loading notifications...
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
            </svg>
          </div>
          <p className="text-foreground font-medium">
            {unreadOnly ? 'No unread notifications' : 'No notifications yet'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {unreadOnly
              ? 'Switch to "All" to see past notifications.'
              : 'Notifications will appear here when there is activity on your account.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => {
            const isUnread = !n.readAt;
            const icon = NOTIFICATION_TYPE_ICONS[n.type as NotificationType] ?? '🔔';
            const label = NOTIFICATION_TYPE_LABELS[n.type as NotificationType] ?? n.type;
            const colourClass = TYPE_COLOUR[n.type as NotificationType] ?? DEFAULT_COLOUR;

            return (
              <button
                key={n.id}
                onClick={() => handleNotificationClick(n)}
                className={`w-full text-left rounded-xl border p-4 transition-all ${
                  isUnread
                    ? `${colourClass} shadow-sm`
                    : 'bg-card border-border opacity-75 hover:opacity-100'
                } hover:shadow-md`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon + unread dot */}
                  <div className="relative shrink-0 mt-0.5">
                    <span className="text-xl">{icon}</span>
                    {isUnread && (
                      <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary border-2 border-white dark:border-card" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {label}
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                        {relativeTime(n.createdAt)}
                      </span>
                    </div>
                    <p className={`text-sm font-semibold mb-0.5 ${isUnread ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {n.title}
                    </p>
                    <p className="text-sm text-muted-foreground leading-snug">
                      {n.body}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Pagination ── */}
      {hasNextPage && (
        <div className="mt-6 text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
