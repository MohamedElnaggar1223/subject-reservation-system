import { requireStaff } from '~/lib/auth/session';

/**
 * My teaching (F0a): teaching is a capability, so any member of staff may
 * open it; the API answers only an account linked to a teacher record.
 */
export default async function TeachingLayout({ children }: { children: React.ReactNode }) {
  await requireStaff();
  return <>{children}</>;
}
