/**
 * Rooms (FEATURES_PLAN.md F0a): the coordinator's and admin's (the academic
 * layout checks the role; the API checks it again).
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { apiResponse } from '@repo/validations';
import RoomsClient from './rooms.client';

export const metadata = {
  title: 'Rooms — IGCSE',
};

export default async function RoomsPage(): Promise<React.JSX.Element> {
  const queryClient = getQueryClient();
  const api = await getServerApi();
  await queryClient.prefetchQuery({
    queryKey: ['academic', 'rooms'],
    queryFn: () => apiResponse(api.v1.academic.rooms.$get()),
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RoomsClient />
    </HydrationBoundary>
  );
}
