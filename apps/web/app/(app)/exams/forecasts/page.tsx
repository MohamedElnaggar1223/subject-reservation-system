/**
 * Forecast grades (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md §2):
 * any member of staff opens it; a teacher sees only the candidates they teach
 * the subject (the API filters by F0b's teacherOf), the coordinator and the
 * admin every entry whose board asks for one, and only they mark a series'
 * forecasts as sent to the board.
 */

import { Suspense } from 'react';
import { requireStaff } from '~/lib/auth/session';
import ForecastsClient from './forecasts.client';

export const metadata = {
  title: 'Forecast grades — IGCSE',
};

export default async function ForecastsPage(): Promise<React.JSX.Element> {
  const session = await requireStaff();
  return (
    <Suspense>
      <ForecastsClient viewerRole={session.user.role ?? ''} />
    </Suspense>
  );
}
