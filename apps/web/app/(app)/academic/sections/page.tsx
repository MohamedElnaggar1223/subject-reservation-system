/**
 * Sections (FEATURES_PLAN.md F0a)
 *
 * The homeroom sections of an academic year by grade, with their homeroom
 * teacher, room and members; adding and taking out students; the
 * roll-over into the next year. The coordinator's and the admin's
 * (academic/layout.tsx).
 */

import { Suspense } from 'react';
import SectionsClient from './sections.client';

export const metadata = {
  title: 'Sections — IGCSE',
};

export default function SectionsPage(): React.JSX.Element {
  // The year, the open section and the roll-over live in the address (useSearchParams).
  return (
    <Suspense>
      <SectionsClient />
    </Suspense>
  );
}
