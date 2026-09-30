/**
 * Exam entries (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §2): what
 * each candidate is entered for with a board in a series — the coordinator's
 * and the admin's. The series and one candidate live in the address
 * (?series=, ?student=).
 */

import { Suspense } from 'react';
import { requireAcademic } from '~/lib/auth/session';
import EntriesClient from './entries.client';

export const metadata = {
  title: 'Exam entries — IGCSE',
};

export default async function EntriesPage(): Promise<React.JSX.Element> {
  await requireAcademic();
  return (
    <Suspense>
      <EntriesClient />
    </Suspense>
  );
}
