/**
 * The timetable's rules (FEATURES_PLAN.md F1) — the coordinator's and the admin's.
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { apiResponse } from '@repo/validations';
import RulesClient from './rules.client';

export const metadata = {
  title: 'Timetable rules — IGCSE',
};

export default async function RulesPage(): Promise<React.JSX.Element> {
  const queryClient = getQueryClient();
  const api = await getServerApi();
  await queryClient.prefetchQuery({ queryKey: ['academic', 'years'], queryFn: () => apiResponse(api.v1.academic.years.$get()) });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RulesClient />
    </HydrationBoundary>
  );
}
