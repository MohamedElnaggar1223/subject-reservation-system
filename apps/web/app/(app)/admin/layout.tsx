import { requireRole } from '~/lib/auth/session';
import { ROLES } from '@repo/validations';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin',
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Finance admins reach the money-policy pages (school fees, refund
  // windows, exceptions) — every API endpoint still enforces its own
  // permission, so admin-only pages simply fail closed for them.
  await requireRole([ROLES.ADMIN, ROLES.FINANCE_ADMIN]);
  return <>{children}</>;
}
