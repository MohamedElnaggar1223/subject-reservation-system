/**
 * School Fee Page — Parents (V3 §6.2)
 *
 * Shows the annual school-fee status for a linked child and lets the
 * parent pay it (in school or via InstaPay) through the shared payments
 * pipeline. Paying unlocks subject registration for the year (D-H).
 */

import { requireParent } from '~/lib/auth/session';
import SchoolFeeClient from './school-fee.client';

export const metadata = {
  title: 'School Fee — IGCSE',
};

export default async function SchoolFeePage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}): Promise<React.JSX.Element> {
  await requireParent();
  const { studentId } = await searchParams;
  return <SchoolFeeClient initialStudentId={studentId ?? null} />;
}
