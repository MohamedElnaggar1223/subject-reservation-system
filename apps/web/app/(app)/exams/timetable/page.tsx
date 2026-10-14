/**
 * The exam timetable (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §4):
 * a series' papers pasted from the board's timetable or typed, the clashes,
 * and publication to families — the coordinator's and the admin's.
 */

import { requireAcademic } from '~/lib/auth/session';
import TimetableClient from './timetable.client';

export const metadata = {
  title: 'Exam timetable — IGCSE',
};

export default async function TimetablePage(): Promise<React.JSX.Element> {
  await requireAcademic();
  return <TimetableClient />;
}
