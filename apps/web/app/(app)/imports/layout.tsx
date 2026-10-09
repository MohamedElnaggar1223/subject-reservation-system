import { requireAcademic } from '~/lib/auth/session';

/**
 * The day-one import (FEATURES_PLAN.md F7): the admin's and the
 * coordinator's. Every endpoint still checks its own role (registering
 * families in a window and adding catalogue rows are the admin's).
 */
export default async function ImportsLayout({ children }: { children: React.ReactNode }) {
  await requireAcademic();
  return <>{children}</>;
}
