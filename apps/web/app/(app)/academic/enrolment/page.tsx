/**
 * Course enrolment (FEATURES_PLAN.md F0b)
 *
 * What each student is taught in an academic year, by which teacher, in
 * school or as self-study: the year started in bulk, by section as a grid,
 * by student, and checked against the exam registrations. The
 * coordinator's and the admin's (academic/layout.tsx).
 */

import { Suspense } from 'react';
import EnrolmentClient from './enrolment.client';

export const metadata = {
  title: 'Course enrolment — IGCSE',
};

export default function EnrolmentPage(): React.JSX.Element {
  // The year, the tab and the open student live in the address (useSearchParams).
  return (
    <Suspense>
      <EnrolmentClient />
    </Suspense>
  );
}
