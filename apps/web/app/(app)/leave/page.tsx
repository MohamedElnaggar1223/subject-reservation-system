/**
 * Campus leave (FEATURES_PLAN.md F2): a family's screen. Staff land on their
 * own screens: the gate on /gate, the desk and the academic staff on
 * /leave/manage.
 */

import { redirect } from 'next/navigation';
import { requireAuth } from '~/lib/auth/session';
import FamilyLeaveClient from './family.client';

export const metadata = {
  title: 'Campus leave — IGCSE',
};

export default async function LeavePage(): Promise<React.JSX.Element> {
  const session = await requireAuth();
  const role = session.user.role;
  if (role === 'gate') redirect('/gate');
  if (role !== 'parent' && role !== 'student') redirect('/leave/manage');
  return <FamilyLeaveClient role={role} />;
}
