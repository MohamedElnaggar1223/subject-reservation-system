/**
 * Escrow Withdrawal Request Page — Parents Only
 *
 * Server component for requesting a cash withdrawal from a child's escrow (ESC-004).
 * Pre-fetches children and withdrawal history.
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireParent } from '~/lib/auth/session';
import { apiResponse } from '@repo/validations';
import WithdrawClient from './withdraw.client';

export const metadata = {
  title: 'Request Withdrawal — IGCSE Reservation',
};

export default async function WithdrawPage(): Promise<React.JSX.Element> {
  await requireParent();

  const queryClient = getQueryClient();
  const api = await getServerApi();

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ['escrow', 'children'],
      queryFn: () => apiResponse(api.v1.escrow.children.$get()),
    }),
    queryClient.prefetchQuery({
      queryKey: ['escrow', 'withdrawals'],
      queryFn: () => apiResponse(api.v1.escrow.withdrawals.$get({ query: {} })),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WithdrawClient />
    </HydrationBoundary>
  );
}
