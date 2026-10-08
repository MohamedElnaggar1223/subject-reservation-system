/**
 * The reservation slip (RESERVATIONS_REWORK.md §4.3, G-20): what the desk just reserved, printed
 * with the consent texts the parent read and signs — the refund steps frozen on each line and the
 * declaration. Any signed-in user may open it; the statement it reads is scoped by the API.
 */

import { requireAuth } from '~/lib/auth/session';
import SlipClient from './slip.client';

export const metadata = {
  title: 'Reservation slip — IGCSE',
};

export default async function SlipPage({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<{ ids?: string }> }): Promise<React.JSX.Element> {
  await requireAuth();
  const { studentId } = await params;
  const { ids } = await searchParams;
  return <SlipClient studentId={studentId} ids={(ids ?? '').split(',').filter(Boolean)} />;
}
