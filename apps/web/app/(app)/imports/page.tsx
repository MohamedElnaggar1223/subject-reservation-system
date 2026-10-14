/**
 * Day-one import: upload a file, and the list of every import
 * (FEATURES_PLAN.md F7). The coordinator's and the admin's
 * (imports/layout.tsx).
 */
import ImportsClient from './imports.client';
import { getSession } from '~/lib/auth/session';

export const metadata = {
  title: 'Day-one import — IGCSE',
};

export default async function ImportsPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  return <ImportsClient isAdmin={session?.user.role === 'admin'} />;
}
