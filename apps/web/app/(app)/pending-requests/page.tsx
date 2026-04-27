/**
 * Pending Requests Page — Students Only (SWAP-007)
 *
 * Students can view all their pending drop/swap requests here.
 * Shows status, subject details, financial impact, and parent comments.
 * Pre-fetches change requests on the server for instant display.
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireStudent } from '~/lib/auth/session';
import { apiResponse } from '@repo/validations';
import PendingRequestsClient from './pending-requests.client';

export const metadata = {
  title: 'My Pending Requests — IGCSE Reservation',
};

export default async function PendingRequestsPage(): Promise<React.JSX.Element> {
  await requireStudent();

  const queryClient = getQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: ['change-requests', 'mine'],
    queryFn: () => apiResponse(api.v1['change-requests'].$get({ query: {} })),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <PendingRequestsClient />
    </HydrationBoundary>
  );
}
