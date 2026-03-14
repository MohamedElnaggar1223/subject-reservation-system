/**
 * Admin — Report Generator Page
 *
 * Server component that enforces admin-only access.
 * All data fetching is client-driven (on-demand) since reports require
 * user-specified filters (sessionId, grade, etc.) that are unknown at render time.
 */

import { requireAdmin } from '~/lib/auth/session';
import ReportsClient from './reports.client';

export const metadata = {
  title: 'Reports — Admin',
};

export default async function AdminReportsPage(): Promise<React.JSX.Element> {
  await requireAdmin();
  return <ReportsClient />;
}
