/**
 * Checkout Page — Parents Only
 *
 * Handles the payment flow for registrations in 'pending_payment' status.
 * Accessed via: /checkout?ids=regId1,regId2,...
 *
 * Server component responsibilities:
 * 1. Enforce parent-only access (payment is parent-only — financial control)
 * 2. Validate and parse registrationIds from query params
 * 3. Pre-fetch checkout summary (registration details + escrow balance) on the server
 * 4. Hand off to CheckoutClient for interactive payment method selection
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireParent } from '~/lib/auth/session';
import { redirect } from 'next/navigation';
import { apiResponse } from '@repo/validations';
import CheckoutClient from './checkout.client';

export const metadata = {
  title: 'Checkout — IGCSE Reservation',
};

interface CheckoutPageProps {
  searchParams: Promise<{ ids?: string }>;
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps): Promise<React.JSX.Element> {
  await requireParent();

  const params = await searchParams;
  const rawIds = params.ids ?? '';
  const registrationIds = rawIds
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (registrationIds.length === 0) {
    redirect('/registrations');
  }

  const queryClient = getQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: ['payments', 'checkout-summary', registrationIds.join(',')],
    queryFn: () =>
      apiResponse(
        api.v1.payments['checkout-summary'].$get({
          query: { registrationIds: registrationIds.join(',') },
        })
      ),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CheckoutClient registrationIds={registrationIds} />
    </HydrationBoundary>
  );
}
