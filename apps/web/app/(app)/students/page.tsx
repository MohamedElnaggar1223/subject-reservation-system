/**
 * Students (FEATURES_PLAN.md F0a)
 *
 * Every student with today's grade, standing and section: search by name,
 * email or student ID, filter, open one. The desk, the coordinator and the
 * admin read it (students/layout.tsx); the coordinator's way in to a
 * student, since the Student 360 carries money.
 */

import { Suspense } from 'react';
import StudentsClient from './students.client';

export const metadata = {
  title: 'Students — IGCSE',
};

export default function StudentsPage(): React.JSX.Element {
  // The filters live in the address (useSearchParams), so Back returns to them.
  return (
    <Suspense>
      <StudentsClient />
    </Suspense>
  );
}
