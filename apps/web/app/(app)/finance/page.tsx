/**
 * Finance Workbench — the single screen for finance-desk staff.
 *
 * One search box, everything pending, one click to resolve (V3_PLAN §5.1):
 * - In-school payments awaiting the desk (record instrument, confirm)
 * - InstaPay payments awaiting bank-statement verification
 * - Escrow withdrawal (cash refund) requests to fulfill or reject
 *
 * Access: finance_officer, finance_admin, admin.
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { apiResponse } from '@repo/validations';
import { requireFinance } from '~/lib/auth/session';
import FinanceWorkbenchClient from './finance.client';

export const metadata = {
  title: 'Finance Workbench — IGCSE',
};

export default async function FinanceWorkbenchPage(): Promise<React.JSX.Element> {
  await requireFinance();

  const queryClient = getQueryClient();
  const api = await getServerApi();

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ['finance', 'pending-manual'],
      queryFn: () => apiResponse(api.v1.payments['pending-manual'].$get()),
    }),
    queryClient.prefetchQuery({
      queryKey: ['finance', 'withdrawals'],
      queryFn: () => apiResponse(api.v1.escrow.admin.withdrawals.$get()),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <FinanceWorkbenchClient />
    </HydrationBoundary>
  );
}
