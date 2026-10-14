/**
 * Exam certificates (FEATURES_PLAN.md F4, "Certificates"; docs/features/EXAM_ENTRIES.md
 * §5): the desk hands them over; the coordinator and the admin also receive
 * them for a series and return or destroy unclaimed ones.
 */

import { Suspense } from 'react';
import { ACADEMIC_ROLES, type Role } from '@repo/validations';
import { requireStudentRecords } from '~/lib/auth/session';
import { LoadingState } from '~/components/ui/query-state';
import CertificatesClient from './certificates.client';

export const metadata = {
  title: 'Certificates — IGCSE',
};

export default async function CertificatesPage(): Promise<React.JSX.Element> {
  const session = await requireStudentRecords();
  const academic = (ACADEMIC_ROLES as readonly Role[]).includes((session.user.role ?? '') as Role);
  return (
    <Suspense fallback={<LoadingState label="Loading the certificates…" />}>
      <CertificatesClient academic={academic} />
    </Suspense>
  );
}
