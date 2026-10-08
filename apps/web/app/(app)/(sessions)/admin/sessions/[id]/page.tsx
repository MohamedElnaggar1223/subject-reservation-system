/**
 * Session (RESERVATIONS_REWORK.md §4.2): the links sheet and its tabs.
 */

import { getSession } from '~/lib/auth/session';
import SessionClient from './session.client';

export const metadata = {
  title: 'Session',
};

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  return <SessionClient id={id} viewerRole={session?.user.role ?? ''} />;
}
