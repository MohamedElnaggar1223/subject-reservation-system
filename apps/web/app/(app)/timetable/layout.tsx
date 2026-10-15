import { requireAcademic } from '~/lib/auth/session';

/**
 * The timetable (F1): groups, rules, versions, the grid, the generator and
 * cover — the coordinator's and the admin's. Every endpoint checks its own
 * role; families read theirs on /my-timetable and teachers on My teaching.
 */
export default async function TimetableLayout({ children }: { children: React.ReactNode }) {
  await requireAcademic();
  return <>{children}</>;
}
