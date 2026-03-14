/**
 * Admin Payments Page — Bank Transfer Confirmations
 *
 * Admin-only page for manually confirming bank transfer payments (PAY-007).
 *
 * Server component responsibilities:
 * 1. Enforce admin-only access
 * 2. Pre-fetch pending bank transfers on the server
 * 3. Pass dehydrated data to the client component
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireAdmin } from '~/lib/auth/session';
import { apiResponse } from '@repo/validations';
import AdminPaymentsClient from './payments-admin.client';

export const metadata = {
  title: 'Bank Transfer Confirmations — IGCSE Admin',
};

export default async function AdminPaymentsPage(): Promise<React.JSX.Element> {
  await requireAdmin();

  const queryClient = getQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: ['payments', 'pending-bank'],
    queryFn: () => apiResponse(api.v1.payments['pending-bank'].$get()),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AdminPaymentsClient />
    </HydrationBoundary>
  );
}
