/**
 * My teaching (FEATURES_PLAN.md F0a)
 *
 * Teaching is a capability: any member of staff linked to a teacher record
 * (a coordinator or admin who teaches, or a teacher) sees the record they
 * teach as, its subjects and the homeroom sections they lead this year.
 */

import { getSession } from '~/lib/auth/session';
import TeachingClient from './teaching.client';

export const metadata = {
  title: 'My teaching — IGCSE',
};

export default async function TeachingPage(): Promise<React.JSX.Element> {
  // teaching/layout.tsx already admits staff only; the role decides whether names open the student's page.
  const session = await getSession();
  return <TeachingClient viewerRole={session?.user.role ?? ''} />;
}
