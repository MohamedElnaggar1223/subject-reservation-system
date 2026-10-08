import { requireRole } from '~/lib/auth/session';
import { ROLES } from '@repo/validations';

/**
 * Messages and reminders (RESERVATIONS_REWORK.md §4.8): the admin's, and finance's for the
 * payment reminders (§5: "finance for payment batches") — outside the admin layout, which admits
 * only the admin and the finance admin, so the finance officer reaches it too. Every endpoint
 * still checks its own role and audience; the screen offers each role only what it may send.
 */
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  await requireRole([ROLES.ADMIN, ROLES.FINANCE_ADMIN, ROLES.FINANCE_OFFICER]);
  return <>{children}</>;
}
