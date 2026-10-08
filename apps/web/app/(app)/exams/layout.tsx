import { requireAuth } from '~/lib/auth/session';

/**
 * The exam screens. F0b's catalogue and board series and most of F4's are
 * the coordinator's and the admin's; F4's certificates are the desk's too,
 * and "My exams" is the family's — so each page names its own roles
 * (requireAcademic, requireStudentRecords, …). Every endpoint still checks
 * its own role (the entry deadline is the admin's alone; the national ID the
 * coordinator's and the admin's).
 */
export default async function ExamsLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  return <>{children}</>;
}
