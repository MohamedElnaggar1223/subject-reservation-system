/**
 * My timetable (FEATURES_PLAN.md F1): a student's own, a parent's children's.
 * The API answers only the student themself and a linked parent.
 */

import { requireRole } from '~/lib/auth/session';
import { ROLES } from '@repo/validations';
import MyTimetableClient from './my-timetable.client';

export const metadata = {
  title: 'Timetable — IGCSE',
};

export default async function MyTimetablePage(): Promise<React.JSX.Element> {
  const session = await requireRole([ROLES.STUDENT, ROLES.PARENT]);
  return <MyTimetableClient role={session.user.role ?? ''} userId={session.user.id} />;
}
