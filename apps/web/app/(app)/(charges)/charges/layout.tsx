import { requireRole } from '~/lib/auth/session';
import { ROLES } from '@repo/validations';

/** The finance desk's and finance admin's (and the admin's); every endpoint checks its own role. */
export default async function ChargesLayout({ children }: { children: React.ReactNode }) {
  await requireRole([ROLES.ADMIN, ROLES.FINANCE_ADMIN, ROLES.FINANCE_OFFICER]);
  return <>{children}</>;
}
