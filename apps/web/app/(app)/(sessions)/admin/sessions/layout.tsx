import { requireRole } from '~/lib/auth/session';
import { ROLES } from '@repo/validations';

/**
 * Sessions and the Session screen (RESERVATIONS_REWORK.md §4.1, §4.2): the admin's, the
 * coordinator's (subjects, teachers, items, grade 10), finance's (fees, money). Outside the
 * admin layout, which admits only the admin and finance admin; every endpoint still checks its
 * own role, and each tab shows only to those who may read it.
 */
export default async function SessionsLayout({ children }: { children: React.ReactNode }) {
  await requireRole([ROLES.ADMIN, ROLES.COORDINATOR, ROLES.FINANCE_ADMIN, ROLES.FINANCE_OFFICER]);
  return <>{children}</>;
}
