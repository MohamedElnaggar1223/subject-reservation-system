/**
 * Campus-leave history and reports (FEATURES_PLAN.md F2): the desk, the
 * coordinator and the admin.
 */

import { requireRole } from '~/lib/auth/session';
import ReportsClient from './reports.client';

export const metadata = {
  title: 'Leave reports — IGCSE',
};

export default async function LeaveReportsPage(): Promise<React.JSX.Element> {
  const session = await requireRole(['coordinator', 'admin', 'finance_officer', 'finance_admin']);
  return <ReportsClient academic={session.user.role === 'coordinator' || session.user.role === 'admin'} />;
}
