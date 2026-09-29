import { requireStudentRecords } from '~/lib/auth/session';

/**
 * The student record (F0a): the desk, the coordinator and admin read it;
 * the actions on it check their own roles in the API.
 */
export default async function StudentsLayout({ children }: { children: React.ReactNode }) {
  await requireStudentRecords();
  return <>{children}</>;
}
