import { requireAcademic } from '~/lib/auth/session';

/**
 * The academic structure (F0a): years and terms, the calendar, bell
 * schedules, rooms and sections — the coordinator's and the admin's.
 * Every endpoint still checks its own role.
 */
export default async function AcademicLayout({ children }: { children: React.ReactNode }) {
  await requireAcademic();
  return <>{children}</>;
}
