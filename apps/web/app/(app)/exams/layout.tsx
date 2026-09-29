import { requireAcademic } from '~/lib/auth/session';

/**
 * The exam screens (F0b): the catalogue and the board series — the
 * coordinator's and the admin's. Every endpoint still checks its own role
 * (the entry deadline is the admin's alone).
 */
export default async function ExamsLayout({ children }: { children: React.ReactNode }) {
  await requireAcademic();
  return <>{children}</>;
}
