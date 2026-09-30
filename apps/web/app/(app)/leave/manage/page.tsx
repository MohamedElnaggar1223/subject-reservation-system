/**
 * Campus leave for staff (FEATURES_PLAN.md F2): the coordinator's and the
 * admin's approval queue, the day's leave and the collectors to approve; the
 * desk's requests for families. Each endpoint checks its own role.
 */

import { requireRole } from '~/lib/auth/session';
import ManageClient from './manage.client';

export const metadata = {
  title: 'Campus leave — IGCSE',
};

export default async function ManageLeavePage(): Promise<React.JSX.Element> {
  const session = await requireRole(['coordinator', 'admin', 'finance_officer', 'finance_admin']);
  return <ManageClient role={session.user.role ?? ''} />;
}
