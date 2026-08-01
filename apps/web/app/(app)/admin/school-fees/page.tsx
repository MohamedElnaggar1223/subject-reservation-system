/**
 * Admin School Fees Page (V3 §6.2)
 *
 * Manage annual school-fee schedules: one uniform amount per academic
 * year, or per-grade amounts. Paying the fee gates subject registration
 * for that year (D-H).
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { apiResponse } from '@repo/validations';
import SchoolFeesAdminClient from './school-fees-admin.client';

export const metadata = {
  title: 'School Fees — IGCSE Admin',
};

export default async function SchoolFeesAdminPage(): Promise<React.JSX.Element> {
  const queryClient = getQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: ['school-fees', 'schedules'],
    queryFn: () => apiResponse(api.v1['school-fees'].schedules.$get()),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SchoolFeesAdminClient />
    </HydrationBoundary>
  );
}
