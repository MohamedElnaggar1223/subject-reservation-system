/**
 * Approvals Page — Parents Only
 *
 * Server component that:
 * 1. Enforces parent-only access
 * 2. Pre-fetches pending approval requests on the server
 * 3. Passes dehydrated data to the interactive client component
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireParent } from '~/lib/auth/session';
import { apiResponse } from '@repo/validations';
import ApprovalsClient from './approvals.client';

export const metadata = {
  title: 'Pending Approvals — IGCSE Reservation',
};

export default async function ApprovalsPage(): Promise<React.JSX.Element> {
  await requireParent();

  const queryClient = getQueryClient();
  const api = await getServerApi();

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ['registrations', 'pending'],
      queryFn: () => apiResponse(api.v1.registrations.pending.$get()),
    }),
    queryClient.prefetchQuery({
      queryKey: ['change-requests', 'pending-for-parent'],
      queryFn: () => apiResponse(api.v1['change-requests'].$get({ query: {} })),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ApprovalsClient />
    </HydrationBoundary>
  );
}
