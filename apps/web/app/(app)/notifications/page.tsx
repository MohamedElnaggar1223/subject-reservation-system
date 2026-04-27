/**
 * Notification Center — All Roles
 *
 * Server component responsibilities:
 * 1. Enforce authentication (any role)
 * 2. Pre-fetch first page of notifications (newest 50)
 * 3. Pre-fetch unread count for immediate badge rendering
 * 4. Hand off interactive list, read-marking, and pagination to the client component
 *
 * NOT-001 to NOT-011: All notification types created by the system are surfaced here.
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireAuth } from '~/lib/auth/session';
import { apiResponse } from '@repo/validations';
import NotificationsClient from './notifications.client';

export const metadata = {
  title: 'Notifications — IGCSE Reservation',
};

export default async function NotificationsPage(): Promise<React.JSX.Element> {
  await requireAuth();

  const queryClient = getQueryClient();
  const api = await getServerApi();

  // Prefetch first page of notifications (all, not unread-only)
  await queryClient.prefetchQuery({
    queryKey: ['notifications', { unreadOnly: false, limit: 50, offset: 0 }],
    queryFn: () =>
      apiResponse(
        api.v1.notifications.$get({
          query: { unreadOnly: 'false', limit: '50', offset: '0' },
        })
      ),
  });

  // Prefetch unread count for the badge
  await queryClient.prefetchQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiResponse(api.v1.notifications['unread-count'].$get()),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <NotificationsClient />
    </HydrationBoundary>
  );
}
