/**
 * A student's academic page (FEATURES_PLAN.md F0a)
 *
 * Name, student ID and contact, then the academic record: grade, cohort,
 * section, standing, the series open now, and the actions the viewer's
 * role allows. The desk, the coordinator and the admin (students/layout.tsx).
 */

import { requireStudentRecords } from '~/lib/auth/session';
import StudentClient from './student.client';

export const metadata = {
  title: 'Student — IGCSE',
};

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await requireStudentRecords();
  return <StudentClient studentId={id} viewerRole={session.user.role ?? ''} />;
}
