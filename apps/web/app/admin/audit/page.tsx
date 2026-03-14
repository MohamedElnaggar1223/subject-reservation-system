/**
 * Admin — Audit Log Viewer Page
 *
 * Server component that:
 * 1. Enforces admin-only access
 * 2. Pre-fetches the first page of audit logs on the server for instant display
 * 3. Passes dehydrated data to the interactive client component
 *
 * Implements REP-006: Admin can view the audit trail of all system actions
 * with full chain-of-custody visibility.
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { requireAdmin } from '~/lib/auth/session';
import { apiResponse } from '@repo/validations';
import AuditLogClient from './audit-log.client';

export const metadata = {
  title: 'Audit Log — Admin',
};

export default async function AdminAuditPage(): Promise<React.JSX.Element> {
  await requireAdmin();

  const queryClient = getQueryClient();
  const api = await getServerApi();

  await queryClient.prefetchQuery({
    queryKey: ['audit', 'logs', {}],
    queryFn: () =>
      apiResponse(api.v1.audit.logs.$get({ query: {} })),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AuditLogClient />
    </HydrationBoundary>
  );
}
