/**
 * Board series and their dates (FEATURES_PLAN.md F0b): the coordinator's and
 * the admin's (exams/layout.tsx); the entry deadline is the admin's alone.
 */

import { requireAcademic } from '~/lib/auth/session';
import SeriesClient from './series.client';

export const metadata = {
  title: 'Board series — IGCSE',
};

export default async function SeriesPage(): Promise<React.JSX.Element> {
  const session = await requireAcademic();
  return <SeriesClient viewerRole={session.user.role ?? ''} />;
}
