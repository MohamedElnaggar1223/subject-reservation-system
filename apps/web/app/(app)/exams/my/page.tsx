/**
 * The family's exams (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §5):
 * a student's own, a parent's linked children's — and, for the desk, the
 * coordinator and the admin, any student's (?student=), so a parent asking
 * at the desk is answered from the same screen they would see.
 */

import { Suspense } from 'react';
import { ROLES } from '@repo/validations';
import { requireRole } from '~/lib/auth/session';
import { LoadingState } from '~/components/ui/query-state';
import MyExamsClient from './my-exams.client';

export const metadata = {
  title: 'Exams — IGCSE',
};

export default async function MyExamsPage(): Promise<React.JSX.Element> {
  const session = await requireRole([ROLES.STUDENT, ROLES.PARENT, ROLES.FINANCE_OFFICER, ROLES.FINANCE_ADMIN, ROLES.COORDINATOR, ROLES.ADMIN]);
  return (
    <Suspense fallback={<LoadingState label="Loading your exams…" />}>
      <MyExamsClient role={session.user.role ?? ''} viewerId={session.user.id} />
    </Suspense>
  );
}
