/**
 * Admin — Registration Session Management Page
 *
 * Server component that:
 * 1. Enforces admin-only access
 * 2. Pre-fetches all sessions on the server for instant display
 * 3. Passes dehydrated data to the interactive client component
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireAdmin } from '~/lib/auth/session';
import { apiResponse } from '@repo/validations';
import SessionsAdminClient from './sessions-admin.client';

export const metadata = {
  title: 'Session Management — Admin',
};

export default async function AdminSessionsPage(): Promise<React.JSX.Element> {
  await requireAdmin();

  const queryClient = getQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: ['sessions', 'admin'],
    queryFn: async () =>
      apiResponse(api.v1.sessions.$get({ query: {} })),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SessionsAdminClient />
    </HydrationBoundary>
  );
}
