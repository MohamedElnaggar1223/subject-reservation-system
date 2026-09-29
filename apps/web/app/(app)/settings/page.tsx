/**
 * School Settings (FEATURES_PLAN.md F0a, "Settings store")
 *
 * The rules the school can change without a developer. The layout admits
 * the roles that may read settings; each key names who may change it and
 * the API decides.
 */

import SettingsClient from './settings.client';

export const metadata = {
  title: 'Settings — IGCSE',
};

export default function SettingsPage(): React.JSX.Element {
  return <SettingsClient />;
}
