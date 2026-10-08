import { requireRole } from '~/lib/auth/session';
import { ROLES } from '@repo/validations';

/**
 * The Exceptions screen is the finance admin's, the admin's and the coordinator's (the academic
 * gates are the coordinator's to grant, §3.7) — outside the admin layout, which admits only the
 * admin and the finance admin. Every endpoint still checks its own role, and the form offers only
 * the policies the registry lets this role grant.
 */
export default async function ExceptionsLayout({ children }: { children: React.ReactNode }) {
  await requireRole([ROLES.ADMIN, ROLES.FINANCE_ADMIN, ROLES.COORDINATOR]);
  return <>{children}</>;
}
