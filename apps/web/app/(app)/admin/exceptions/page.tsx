/**
 * Admin Exceptions Page (V3 §6.3)
 *
 * Grant and revoke per-student exceptions — discounts, custom prices,
 * fee waivers, deadline extensions, custom refund percentages.
 */

import { requireAuth } from '~/lib/auth/session';
import ExceptionsAdminClient from './exceptions-admin.client';

export const metadata = {
  title: 'Exceptions — IGCSE Admin',
};

export default async function ExceptionsAdminPage(): Promise<React.JSX.Element> {
  // Each exception type names who may grant it (F0a): the form offers only those.
  const session = await requireAuth();
  return <ExceptionsAdminClient viewerRole={session.user.role ?? null} />;
}
