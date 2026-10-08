/**
 * Exceptions (RESERVATIONS_REWORK.md §3.7, §4.7): grant, list, revoke, and "Check these".
 * The form offers only what the policy registry lets this role grant (GET /v1/policies).
 */

import { requireAuth } from '~/lib/auth/session';
import ExceptionsAdminClient from './exceptions-admin.client';

export const metadata = {
  title: 'Exceptions — IGCSE Admin',
};

export default async function ExceptionsAdminPage(): Promise<React.JSX.Element> {
  const session = await requireAuth();
  return <ExceptionsAdminClient viewerRole={session.user.role ?? null} />;
}
