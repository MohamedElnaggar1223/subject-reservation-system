import { requireStaff } from '~/lib/auth/session';

/** The school's day (F0a): every member of staff. */
export default async function TodayLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return <>{children}</>;
}
