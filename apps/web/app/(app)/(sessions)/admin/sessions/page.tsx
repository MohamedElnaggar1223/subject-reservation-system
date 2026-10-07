/**
 * Sessions (RESERVATIONS_REWORK.md §4.1): the list, prefetched on the server.
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { getSession } from '~/lib/auth/session';
import { apiResponse } from '@repo/validations';
import SessionsListClient from './sessions-list.client';

export const metadata = {
  title: 'Sessions',
};

export default async function SessionsPage(): Promise<React.JSX.Element> {
  const queryClient = getQueryClient();
  const api = await getServerApi();
  const session = await getSession();
  await queryClient.prefetchQuery({
    queryKey: ['sessions', 'admin'],
    queryFn: async () => apiResponse(api.v1.sessions.$get({ query: {} })),
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SessionsListClient viewerRole={session?.user.role ?? ''} />
    </HydrationBoundary>
  );
}
