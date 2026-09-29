/**
 * Registration Page — Students & Parents
 *
 * Server component that:
 * 1. Enforces authentication (student or parent only; admins redirected)
 * 2. Pre-fetches active sessions on the server
 * 3. Pre-fetches linked children for parents
 * 4. Passes user context to the interactive client component
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireAuth } from '~/lib/auth/session';
import { redirect } from 'next/navigation';
import { apiResponse } from '@repo/validations';
import RegisterClient from './register.client';

export const metadata = {
  title: 'Register Subjects — IGCSE Reservation',
};

export default async function RegisterPage(): Promise<React.JSX.Element> {
  const session = await requireAuth();
  const role = session.user.role;

  // Admins do not have a personal registration flow
  if (role === 'admin') redirect('/admin/subjects');

  // Unauthenticated or unrecognised roles cannot register
  if (role !== 'student' && role !== 'parent') redirect('/sign-in');

  const queryClient = getQueryClient();
  const api = await getServerApi();

  // Pre-fetch active sessions so the page renders instantly
  await queryClient.prefetchQuery({
    queryKey: ['sessions', 'active'],
    queryFn: () => apiResponse(api.v1.sessions.active.$get()),
  });

  // A student whose grade is not recorded (no cohort, F0a) finishes setup
  // first; who may register for which series is the API's call
  // (mayRegisterFor), shown on the page once a window is chosen.
  let studentGrade: number | null = null;
  if (role === 'student') {
    try {
      const profile = await apiResponse(api.v1.users.me.$get()) as { grade: number | null };
      studentGrade = profile.grade;
    } catch {
      // Fallback: unable to fetch grade
    }

    if (studentGrade === null) {
      redirect('/complete-setup');
    }
  }

  // Parents also need their linked children list for child selection
  if (role === 'parent') {
    await queryClient.prefetchQuery({
      queryKey: ['links', 'children'],
      queryFn: () => apiResponse(api.v1.links.children.$get()),
    });
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RegisterClient
        userId={session.user.id}
        userRole={role}
      />
    </HydrationBoundary>
  );
}
