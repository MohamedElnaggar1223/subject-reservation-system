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

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '~/lib/hono';
import {
  apiResponse,
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_TYPE_ICONS,
  type NotificationType,
} from '@repo/validations';

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
  SESSION_OPENED:                   'bg-blue-50 border-blue-200',
  SESSION_CLOSING_SOON:             'bg-yellow-50 border-yellow-200',
  REGISTRATION_REQUEST_RECEIVED:    'bg-purple-50 border-purple-200',
  REGISTRATION_APPROVED:            'bg-green-50 border-green-200',
  REGISTRATION_REJECTED:            'bg-red-50 border-red-200',
  PAYMENT_CONFIRMED:                'bg-emerald-50 border-emerald-200',
  DROP_SWAP_REQUEST_RECEIVED:       'bg-orange-50 border-orange-200',
  DROP_SWAP_PROCESSED:              'bg-indigo-50 border-indigo-200',
  ESCROW_BALANCE_CHANGED:           'bg-teal-50 border-teal-200',
  ESCROW_WITHDRAWAL_FULFILLED:      'bg-cyan-50 border-cyan-200',
  GRADE_CHANGED:                    'bg-violet-50 border-violet-200',
  BULK_ANNOUNCEMENT:                'bg-gray-50 border-gray-200',
};

const DEFAULT_COLOUR = 'bg-gray-50 border-gray-200';

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
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  // ── Notification list query ──
  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications', { unreadOnly, limit: LIMIT, offset }],
    queryFn: () =>
      apiResponse(
        api.v1.notifications.$get({
          query: {
            unreadOnly: unreadOnly ? 'true' : 'false',
            limit: String(LIMIT),
            offset: String(offset),
          },
        })
      ),
    placeholderData: (prev) => prev,
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
  const items: Notification[] = (notifications as Notification[] | undefined) ?? [];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          {unreadCount > 0 && (
            <span className="inline-flex items-center justify-center h-6 min-w-6 px-2 rounded-full bg-blue-600 text-white text-xs font-bold">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Unread filter toggle */}
          <button
            onClick={() => { setUnreadOnly((v) => !v); setOffset(0); }}
            className={`text-sm px-3 py-1.5 rounded-full border font-medium transition-colors ${
              unreadOnly
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            {unreadOnly ? 'Unread only' : 'All'}
          </button>

          {/* Mark all as read */}
          {unreadCount > 0 && (
            <button
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
            >
              {markAllRead.isPending ? 'Marking…' : 'Mark all read'}
            </button>
          )}
        </div>
      </div>

      {/* ── Notification List ── */}
      {isLoading ? (
        <div className="text-center py-16 text-gray-500">Loading notifications…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">🔔</p>
          <p className="text-gray-500 font-medium">
            {unreadOnly ? 'No unread notifications' : 'No notifications yet'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
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
                className={`w-full text-left rounded-lg border p-4 transition-all ${
                  isUnread
                    ? `${colourClass} shadow-sm`
                    : 'bg-white border-gray-100 opacity-75 hover:opacity-100'
                } hover:shadow-md`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon + unread dot */}
                  <div className="relative shrink-0 mt-0.5">
                    <span className="text-xl">{icon}</span>
                    {isUnread && (
                      <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-blue-600 border-2 border-white" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                        {label}
                      </span>
                      <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
                        {relativeTime(n.createdAt)}
                      </span>
                    </div>
                    <p className={`text-sm font-semibold mb-0.5 ${isUnread ? 'text-gray-900' : 'text-gray-600'}`}>
                      {n.title}
                    </p>
                    <p className="text-sm text-gray-500 leading-snug">
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
      {items.length === LIMIT && (
        <div className="mt-6 text-center">
          <button
            onClick={() => setOffset((o) => o + LIMIT)}
            className="px-4 py-2 text-sm font-medium text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 transition-colors"
          >
            Load more
          </button>
        </div>
      )}
      {offset > 0 && (
        <div className="mt-2 text-center">
          <button
            onClick={() => setOffset(0)}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Back to top
          </button>
        </div>
      )}
    </div>
  );
}
