/**
 * Admin Escrow Page — Admins Only
 *
 * Server component for managing pending withdrawal requests (ESC-005, ESC-006).
 * Pre-fetches all pending/partially-fulfilled withdrawal requests.
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { apiResponse } from '@repo/validations';
import EscrowAdminClient from './escrow-admin.client';

export const metadata = {
  title: 'Withdrawal Requests — Admin',
};

export default async function AdminEscrowPage(): Promise<React.JSX.Element> {
  const queryClient = getQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: ['admin', 'escrow', 'withdrawals'],
    queryFn: () => apiResponse(api.v1.escrow.admin.withdrawals.$get()),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <EscrowAdminClient />
    </HydrationBoundary>
  );
}
