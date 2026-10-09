/**
 * The boards' entry lists (FEATURES_PLAN.md F4; docs/features/EXAM_ENTRIES.md
 * §3): one row per live entry in the board portal's fields, what each row is
 * missing, the paid reservations with no entry, and the board's rules —
 * the coordinator's and the admin's. The series lives in the address.
 */

import { Suspense } from 'react';
import { requireAcademic } from '~/lib/auth/session';
import EntryListsClient from './entry-lists.client';

export const metadata = {
  title: 'Entry lists — IGCSE',
};

export default async function EntryListsPage(): Promise<React.JSX.Element> {
  await requireAcademic();
  return (
    <Suspense>
      <EntryListsClient />
    </Suspense>
  );
}
