/**
 * The subject editor (COORDINATOR_REWORK.md §5.4): one subject of a session — what can be entered and
 * how it is studied, its fees, teachers, earlier exams, note, questions, switch and close date, with the
 * live preview of what families see.
 */

import { getSession } from '~/lib/auth/session';
import SubjectEditor from './subject-editor.client';

export const metadata = {
  title: 'Subject',
};

export default async function SubjectPage({ params }: { params: Promise<{ id: string; offeringId: string }> }): Promise<React.JSX.Element> {
  const { id, offeringId } = await params;
  const session = await getSession();
  return <SubjectEditor sessionId={id} offeringId={offeringId} viewerRole={session?.user.role ?? ''} />;
}
