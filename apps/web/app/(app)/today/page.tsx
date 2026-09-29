/**
 * Today (FEATURES_PLAN.md F0a): where every member of staff lands — what
 * kind of day it is at the school and the bells that ring. The today layout
 * checks the viewer is staff; the role comes from the session (GET
 * /v1/session) and decides whether the "set up the year" link is offered.
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireStaff } from '~/lib/auth/session';
import { ACADEMIC_ROLES, apiResponse, hasRole } from '@repo/validations';
import TodayClient from './today.client';

export const metadata = {
  title: 'Today — IGCSE',
};

export default async function TodayPage(): Promise<React.JSX.Element> {
  const session = await requireStaff();
  const queryClient = getQueryClient();
  const api = await getServerApi();
  await queryClient.prefetchQuery({
    queryKey: ['academic', 'day', 'today'],
    queryFn: () => apiResponse(api.v1.academic.calendar.day.$get({ query: {} })),
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TodayClient manages={hasRole(session.user.role, ...ACADEMIC_ROLES)} />
    </HydrationBoundary>
  );
}
