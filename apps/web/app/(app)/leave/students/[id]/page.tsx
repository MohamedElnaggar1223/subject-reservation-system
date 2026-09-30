/**
 * One student's campus leave (FEATURES_PLAN.md F2): the desk, the coordinator
 * and the admin. Custody restrictions are the coordinator's and the admin's.
 */

import { requireRole } from '~/lib/auth/session';
import StudentLeaveClient from './student-leave.client';

export const metadata = {
  title: 'Student leave — IGCSE',
};

export default async function StudentLeavePage({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await requireRole(['coordinator', 'admin', 'finance_officer', 'finance_admin']);
  return <StudentLeaveClient studentId={id} role={session.user.role ?? ''} />;
}
