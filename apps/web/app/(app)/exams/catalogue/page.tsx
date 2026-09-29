/**
 * The exam catalogue (FEATURES_PLAN.md F0b): boards, qualifications, units
 * and the unit-to-award map, and what each registrable subject enters — the
 * coordinator's and the admin's (exams/layout.tsx).
 */

import { Suspense } from 'react';
import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { apiResponse } from '@repo/validations';
import CatalogueClient from './catalogue.client';

export const metadata = {
  title: 'Exam catalogue — IGCSE',
};

export default async function CataloguePage(): Promise<React.JSX.Element> {
  const queryClient = getQueryClient();
  const api = await getServerApi();
  await queryClient.prefetchQuery({ queryKey: ['catalogue'], queryFn: () => apiResponse(api.v1.catalogue.$get()) });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {/* The tab lives in the address (useSearchParams). */}
      <Suspense>
        <CatalogueClient />
      </Suspense>
    </HydrationBoundary>
  );
}
