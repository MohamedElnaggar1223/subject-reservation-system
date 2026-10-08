/**
 * My invigilation (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §4): a
 * teacher's own duties and the board's register of their room, marked on a
 * tablet. Any member of staff may open it; the API answers with the signed-in
 * teacher's duties only and refuses another room's register.
 */

import { requireStaff } from '~/lib/auth/session';
import InvigilationClient from './invigilation.client';

export const metadata = {
  title: 'My invigilation — IGCSE',
};

export default async function InvigilationPage(): Promise<React.JSX.Element> {
  await requireStaff();
  return <InvigilationClient />;
}
