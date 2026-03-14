/**
 * Registrations Page — Students & Parents
 *
 * Server component that:
 * 1. Enforces authentication (student or parent)
 * 2. Pre-fetches current registrations on the server
 * 3. Passes dehydrated data and user context to the client component
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireAuth } from '~/lib/auth/session';
import { redirect } from 'next/navigation';
import { apiResponse } from '@repo/validations';
import RegistrationsClient from './registrations.client';

export const metadata = {
  title: 'My Registrations — IGCSE Reservation',
};

export default async function RegistrationsPage(): Promise<React.JSX.Element> {
  const session = await requireAuth();
  const role = session.user.role;

  if (role === 'admin') redirect('/admin/subjects');

  const queryClient = getQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: ['registrations', 'list'],
    queryFn: () => apiResponse(api.v1.registrations.$get({ query: {} })),
  });

  // Parents also need their children list for the grouped view
  if (role === 'parent') {
    await queryClient.prefetchQuery({
      queryKey: ['links', 'children'],
      queryFn: () => apiResponse(api.v1.links.children.$get()),
    });
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RegistrationsClient
        userRole={role ?? null}
        userId={session.user.id}
      />
    </HydrationBoundary>
  );
}
