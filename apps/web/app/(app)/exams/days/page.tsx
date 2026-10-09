/**
 * Exam days (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §4): each
 * sitting's rooms, seating plan, invigilators and the boards' attendance
 * registers, and special consideration — the coordinator's and the admin's.
 */

import { requireAcademic } from '~/lib/auth/session';
import DaysClient from './days.client';

export const metadata = {
  title: 'Exam days — IGCSE',
};

export default async function ExamDaysPage(): Promise<React.JSX.Element> {
  await requireAcademic();
  return <DaysClient />;
}
