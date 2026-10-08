import { requireRole } from '~/lib/auth/session';
import { ROLES } from '@repo/validations';

/**
 * Board services: the coordinator's and the admin's (the catalogue, the dates) and the finance
 * admin's (the fees) — outside the exams layout, which admits only the academic roles. Every
 * endpoint still checks its own role.
 */
export default async function BoardServicesLayout({ children }: { children: React.ReactNode }) {
  await requireRole([ROLES.ADMIN, ROLES.COORDINATOR, ROLES.FINANCE_ADMIN]);
  return <>{children}</>;
}
