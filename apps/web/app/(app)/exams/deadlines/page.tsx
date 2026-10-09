/**
 * The exam deadlines dashboard (FEATURES_PLAN.md F4, "A deadlines dashboard
 * across all series"; docs/features/EXAM_ENTRIES.md): every date every board
 * set, in date order, with what the school still has to do for it. The
 * coordinator's and the admin's.
 */

import { Suspense } from 'react';
import { requireAcademic } from '~/lib/auth/session';
import DeadlinesClient from './deadlines.client';

export const metadata = {
  title: 'Exam deadlines — IGCSE',
};

export default async function DeadlinesPage(): Promise<React.JSX.Element> {
  await requireAcademic();
  // The board filter lives in the address (useSearchParams).
  return (
    <Suspense>
      <DeadlinesClient />
    </Suspense>
  );
}
