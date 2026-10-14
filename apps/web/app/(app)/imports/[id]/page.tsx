/**
 * The staged review of one import (FEATURES_PLAN.md F7): problems, rows,
 * people and conflicts, the mapping, then the commit and what it did.
 */
import { Suspense } from 'react';
import ReviewClient from './review.client';
import { getSession } from '~/lib/auth/session';

export const metadata = {
  title: 'Import review — IGCSE',
};

export default async function ImportReviewPage({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  // The tab and the row filters live in the address (useSearchParams).
  return (
    <Suspense>
      <ReviewClient id={id} isAdmin={session?.user.role === 'admin'} />
    </Suspense>
  );
}
