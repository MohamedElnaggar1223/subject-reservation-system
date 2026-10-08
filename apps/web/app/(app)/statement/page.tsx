/**
 * Statement (RESERVATIONS_REWORK.md §4.5): a family's every line, payment and balance — for a
 * child, or the whole family. Students read their own; parents their linked children (one, or
 * all); staff with student records open it for a student or a family (`?studentId=`,
 * `?familyId=`) — the desk's Student 360 shows the same statement.
 */

import { redirect } from 'next/navigation';
import { requireAuth } from '~/lib/auth/session';
import { STUDENT_RECORD_ROLES, hasRole } from '@repo/validations';
import StatementClient from './statement.client';

export const metadata = {
  title: 'Statement — IGCSE',
};

export default async function StatementPage({ searchParams }: { searchParams: Promise<{ studentId?: string; familyId?: string }> }): Promise<React.JSX.Element> {
  const session = await requireAuth();
  const role = session.user.role ?? '';
  const q = await searchParams;
  const staff = hasRole(role, ...STUDENT_RECORD_ROLES);
  if (!staff && role !== 'student' && role !== 'parent') redirect('/unauthorized');
  if (staff && !q.studentId && !q.familyId) redirect('/desk');
  return <StatementClient role={role} studentId={q.studentId ?? null} familyId={q.familyId ?? null} />;
}
