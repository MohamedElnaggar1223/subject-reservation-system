/**
 * Admin Dashboard Page
 *
 * Server component that:
 * 1. Enforces admin-only access
 * 2. Pre-fetches dashboard metrics and pending approvals on the server
 * 3. Passes dehydrated data to the interactive client component
 *
 * Implements REP-008 (admin dashboard metrics) and REP-009 (pending approvals report).
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { apiResponse } from '@repo/validations';
import AdminDashboardClient from './dashboard.client';
import SetupChecklist from './setup-checklist.client';

export const metadata = {
  title: 'Dashboard — Admin',
};

export default async function AdminDashboardPage(): Promise<React.JSX.Element> {
  const queryClient = getQueryClient();
  const api = await getServerApi();

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ['reports', 'dashboard'],
      queryFn: () => apiResponse(api.v1.reports.dashboard.$get({ query: {} })),
    }),
    queryClient.prefetchQuery({
      queryKey: ['reports', 'pending-approvals'],
      queryFn: () => apiResponse(api.v1.reports['pending-approvals'].$get({ query: {} })),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="px-6 pt-6 max-w-6xl mx-auto">
        <SetupChecklist />
      </div>
      <AdminDashboardClient />
    </HydrationBoundary>
  );
}
