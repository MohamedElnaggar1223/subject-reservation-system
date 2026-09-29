/**
 * Academic years and terms (FEATURES_PLAN.md F0a): the coordinator's and
 * admin's (the academic layout checks the role; the API checks it again).
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { apiResponse } from '@repo/validations';
import AcademicYearsClient from './academic-years.client';

export const metadata = {
  title: 'Academic Years — IGCSE',
};

export default async function AcademicYearsPage(): Promise<React.JSX.Element> {
  const queryClient = getQueryClient();
  const api = await getServerApi();
  await queryClient.prefetchQuery({
    queryKey: ['academic', 'years'],
    queryFn: () => apiResponse(api.v1.academic.years.$get()),
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AcademicYearsClient />
    </HydrationBoundary>
  );
}
