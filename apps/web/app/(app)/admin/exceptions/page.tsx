/**
 * Admin Exceptions Page (V3 §6.3)
 *
 * Grant and revoke per-student exceptions — discounts, custom prices,
 * fee waivers, deadline extensions, custom refund percentages.
 */

import ExceptionsAdminClient from './exceptions-admin.client';

export const metadata = {
  title: 'Exceptions — IGCSE Admin',
};

export default function ExceptionsAdminPage(): React.JSX.Element {
  return <ExceptionsAdminClient />;
}
