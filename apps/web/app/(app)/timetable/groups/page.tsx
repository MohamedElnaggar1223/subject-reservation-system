/**
 * Teaching groups (FEATURES_PLAN.md F1) — the coordinator's and the admin's.
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { apiResponse } from '@repo/validations';
import GroupsClient from './groups.client';

export const metadata = {
  title: 'Teaching groups — IGCSE',
};

export default async function GroupsPage(): Promise<React.JSX.Element> {
  const queryClient = getQueryClient();
  const api = await getServerApi();
  await queryClient.prefetchQuery({ queryKey: ['academic', 'years'], queryFn: () => apiResponse(api.v1.academic.years.$get()) });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <GroupsClient />
    </HydrationBoundary>
  );
}
