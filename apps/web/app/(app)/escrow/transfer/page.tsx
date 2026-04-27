/**
 * Escrow Transfer Page — Parents Only
 *
 * Server component for transferring escrow funds between linked children (ESC-003).
 * Pre-fetches all children with current balances for the selector.
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireParent } from '~/lib/auth/session';
import { apiResponse } from '@repo/validations';
import TransferClient from './transfer.client';

export const metadata = {
  title: 'Transfer Escrow — IGCSE Reservation',
};

export default async function TransferPage(): Promise<React.JSX.Element> {
  await requireParent();

  const queryClient = getQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: ['escrow', 'children'],
    queryFn: () => apiResponse(api.v1.escrow.children.$get()),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TransferClient />
    </HydrationBoundary>
  );
}
