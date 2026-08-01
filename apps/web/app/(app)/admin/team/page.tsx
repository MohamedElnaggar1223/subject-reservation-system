/**
 * Admin Team Page (UX_AUDIT G7)
 *
 * Create staff accounts and assign roles — no API knowledge required.
 */

import TeamAdminClient from './team-admin.client';

export const metadata = {
  title: 'Team — IGCSE Admin',
};

export default function TeamAdminPage(): React.JSX.Element {
  return <TeamAdminClient />;
}
