/**
 * Escrow Page — Students (read-only) & Parents (full view)
 *
 * Server component responsibilities:
 * 1. Enforce student or parent access (admins redirected)
 * 2. Pre-fetch escrow balance and transaction history on the server
 * 3. For parents: also pre-fetch all children's balances for the overview
 * 4. Hand off to client component for the interactive view
 *
 * ESC-001: Students see own balance + transactions (read-only)
 * ESC-002: Parents see all linked children with balances
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireAuth } from '~/lib/auth/session';
import { redirect } from 'next/navigation';
import { apiResponse } from '@repo/validations';
import EscrowClient from './escrow.client';

export const metadata = {
  title: 'Escrow — IGCSE Reservation',
};

export default async function EscrowPage(): Promise<React.JSX.Element> {
  const session = await requireAuth();
  const role = session.user.role;

  if (role === 'admin') redirect('/admin/escrow');

  const queryClient = getQueryClient();
  const api = await getServerApi();

  // Fetch own balance (works for both student and parent)
  await queryClient.prefetchQuery({
    queryKey: ['escrow', 'balance', session.user.id],
    queryFn: () => apiResponse(api.v1.escrow.$get({ query: {} })),
  });

  // Own transaction history
  await queryClient.prefetchQuery({
    queryKey: ['escrow', 'transactions', session.user.id],
    queryFn: () => apiResponse(api.v1.escrow.transactions.$get({ query: {} })),
  });

  // Parents additionally see all children's balances
  if (role === 'parent') {
    await queryClient.prefetchQuery({
      queryKey: ['escrow', 'children'],
      queryFn: () => apiResponse(api.v1.escrow.children.$get()),
    });
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <EscrowClient userRole={role ?? null} userId={session.user.id} />
    </HydrationBoundary>
  );
}
