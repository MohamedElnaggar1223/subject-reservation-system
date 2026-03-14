/**
 * Admin — Subject Management Page
 *
 * Server component that:
 * 1. Enforces admin-only access (redirects otherwise)
 * 2. Pre-fetches all subjects (including inactive) on the server
 * 3. Passes dehydrated data to the interactive client component
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireAdmin } from '~/lib/auth/session';
import { apiResponse } from '@repo/validations';
import SubjectsAdminClient from './subjects-admin.client';

export const metadata = {
  title: 'Subject Management — Admin',
};

export default async function AdminSubjectsPage(): Promise<React.JSX.Element> {
  await requireAdmin();

  const queryClient = getQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: ['subjects', 'admin'],
    queryFn: async () =>
      apiResponse(api.v1.subjects.$get({ query: {} })),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SubjectsAdminClient />
    </HydrationBoundary>
  );
}
