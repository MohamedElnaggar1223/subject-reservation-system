/**
 * Exam results (FEATURES_PLAN.md F4, "Results"; docs/features/EXAM_ENTRIES.md
 * §5): a board's results file read through a column mapping, every attempt
 * kept, publication to families — the coordinator's and the admin's.
 */

import { Suspense } from 'react';
import { requireAcademic } from '~/lib/auth/session';
import { LoadingState } from '~/components/ui/query-state';
import ResultsClient from './results.client';

export const metadata = {
  title: 'Exam results — IGCSE',
};

export default async function ResultsPage(): Promise<React.JSX.Element> {
  await requireAcademic();
  return (
    <Suspense fallback={<LoadingState label="Loading the results…" />}>
      <ResultsClient />
    </Suspense>
  );
}
