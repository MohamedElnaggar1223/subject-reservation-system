/**
 * Timetables (FEATURES_PLAN.md F1): each term's drafts and published
 * versions — the coordinator's and the admin's.
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { apiResponse } from '@repo/validations';
import VersionsClient from './versions.client';

export const metadata = {
  title: 'Timetables — IGCSE',
};

export default async function VersionsPage(): Promise<React.JSX.Element> {
  const queryClient = getQueryClient();
  const api = await getServerApi();
  await queryClient.prefetchQuery({ queryKey: ['academic', 'years'], queryFn: () => apiResponse(api.v1.academic.years.$get()) });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <VersionsClient />
    </HydrationBoundary>
  );
}
