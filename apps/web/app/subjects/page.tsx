/**
 * Subject Browse Page — Students & Parents
 *
 * Server component that:
 * 1. Enforces authentication (any authenticated user)
 * 2. Pre-fetches active subjects on the server for instant display
 * 3. Passes dehydrated data to the interactive client component
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireAuth } from '~/lib/auth/session';
import { apiResponse } from '@repo/validations';
import SubjectsBrowseClient from './subjects-browse.client';

export const metadata = {
  title: 'Subjects — IGCSE Reservation',
};

export default async function SubjectsPage(): Promise<React.JSX.Element> {
  const session = await requireAuth();

  const queryClient = getQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: ['subjects', 'browse'],
    queryFn: async () =>
      apiResponse(api.v1.subjects.$get({ query: {} })),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SubjectsBrowseClient userRole={session.user.role ?? null} />
    </HydrationBoundary>
  );
}
