/**
 * The candidate register (FEATURES_PLAN.md F4, "Candidates";
 * docs/features/EXAM_ENTRIES.md §1, §6): what the boards ask of each student —
 * the name as on the ID, date of birth, gender, Pearson's UCI, access
 * arrangements, the ID document and a candidate number per series. The
 * coordinator's and the admin's; the national ID is read one candidate at a
 * time, each read audited by the API.
 */

import { Suspense } from 'react';
import { requireAcademic } from '~/lib/auth/session';
import CandidatesClient from './candidates.client';

export const metadata = {
  title: 'Candidates — IGCSE',
};

export default async function CandidatesPage(): Promise<React.JSX.Element> {
  await requireAcademic();
  // The filters live in the address (useSearchParams), so Back returns to them.
  return (
    <Suspense>
      <CandidatesClient />
    </Suspense>
  );
}
