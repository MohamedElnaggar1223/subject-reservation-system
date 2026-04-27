/**
 * Registration History Page — Students and Parents
 *
 * Server component for viewing the full registration audit trail.
 *
 * Displays ALL registrations across ALL sessions (including closed ones), with:
 * - Complete approval chain: requested by → approved/rejected by
 * - Drop and swap requests made against each registration
 * - Timestamps for every state transition
 * - Payment context (confirmed/pending/failed)
 *
 * Student: sees own history.
 * Parent: must provide ?studentId= to view a specific linked child's history.
 * Prefetches on the server so the initial render is instant.
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireAuth } from '~/lib/auth/session';
import { redirect } from 'next/navigation';
import { apiResponse } from '@repo/validations';
import HistoryClient from './history.client';

export const metadata = {
  title: 'Registration History — IGCSE Reservation',
};

interface PageProps {
  searchParams: Promise<{ studentId?: string }>;
}

export default async function RegistrationHistoryPage({
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const session = await requireAuth();
  const role = session.user.role;

  if (role === 'admin') redirect('/');

  const params = await searchParams;
  const targetStudentId = role === 'student' ? session.user.id : (params.studentId ?? null);

  const queryClient = getQueryClient();
  const api = await getServerApi();

  if (targetStudentId) {
    await queryClient.prefetchQuery({
      queryKey: ['registrations', 'history', targetStudentId],
      queryFn: () =>
        apiResponse(
          api.v1.registrations.history.$get({
            query: role === 'parent' ? { studentId: targetStudentId } : {},
          })
        ),
    });
  }

  // Parents also need children list to render the selector
  if (role === 'parent') {
    await queryClient.prefetchQuery({
      queryKey: ['links', 'children'],
      queryFn: () => apiResponse(api.v1.links.children.$get()),
    });
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <HistoryClient
        userRole={role ?? null}
        userId={session.user.id}
        initialStudentId={targetStudentId}
      />
    </HydrationBoundary>
  );
}
