/**
 * The exam catalogue (FEATURES_PLAN.md F0b): boards, qualifications, units
 * and the unit-to-award map, and what each registrable subject enters — the
 * coordinator's and the admin's (exams/layout.tsx).
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { apiResponse } from '@repo/validations';
import CatalogueClient, { type CatalogueTab } from './catalogue.client';

const TABS: CatalogueTab[] = ['registrable', 'qualifications', 'units'];

export const metadata = {
  title: 'Exam catalogue — IGCSE',
};

export default async function CataloguePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }): Promise<React.JSX.Element> {
  const { tab } = await searchParams;
  const initialTab = TABS.find((t) => t === tab) ?? 'registrable';
  const queryClient = getQueryClient();
  const api = await getServerApi();
  await queryClient.prefetchQuery({ queryKey: ['catalogue'], queryFn: () => apiResponse(api.v1.catalogue.$get()) });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <CatalogueClient initialTab={initialTab} />
    </HydrationBoundary>
  );
}
