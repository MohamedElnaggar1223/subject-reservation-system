/**
 * The timetable grid editor (FEATURES_PLAN.md F1): the coordinator's and the
 * admin's (the timetable layout checks the role; the API checks it again).
 */

import { dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { getQueryClient } from '~/lib/query-client';
import { getServerApi } from '~/lib/hono-server';
import { apiResponse } from '@repo/validations';
import EditorClient from './editor.client';

export const metadata = {
  title: 'Timetable — IGCSE',
};

export default async function TimetableEditorPage({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const { id } = await params;
  const queryClient = getQueryClient();
  const api = await getServerApi();
  await queryClient.prefetchQuery({
    queryKey: ['timetable', 'editor', id],
    queryFn: () => apiResponse(api.v1.timetables[':id'].$get({ param: { id } })),
  });
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <EditorClient id={id} />
    </HydrationBoundary>
  );
}
